// What the toolkit learns about the person over time, on the server.
//
// Apps and the adapter registry tell the Librarian what the person did
// (logObservation, its privacy floor: paused, per-site pauses, no-memory
// zones). The Librarian turns observations into memories and suggested
// profile changes with extract(), which the browser extension runs on a
// timer. The service's Librarian instances have no scheduler (toolkit-host.js:
// they are stateless), so this module runs extract itself, a little after the
// last observation for an account. A suggestion changes the profile only when
// the person accepts it; then the apps following the profile hear about it.
//
// Needs: adapters declare the needs they meet and apps register theirs
// (profile_need_register). A little after a need is registered or the
// profile changes, the profile agent decides whether the person's profile
// calls for each (Librarian.decideNeeds); a decision is a suggestion the
// person answers, and accepting one switches on the adapter that meets it.
// Switching an adapter on in their browser is the person saying they have
// its needs (Librarian.chooseNeed).
//
// It also serves the profile_* tools on the toolkit's MCP endpoint
// (toolkit/protocol/adapter/profile.js) and the developer console's reset.
//
// What an app or adapter declared app- or adapter-level is learned in a
// Librarian of its own (access.js); a caller reads the memories of the
// partitions it may read, next to the account's own.

import { withAiContext } from './ai-context.js';
import { DEFAULT_PROPOSALS_PER_WEEK } from '../../toolkit/index.js';
import { PROFILE_TOOL_SCHEMAS, PROFILE_TOOL_DESCRIPTIONS, PROFILE_READ_ONLY, BROWSER_RUNTIME_APP, checkNeeds } from '../../toolkit/protocol/adapter/index.js';

const EXTRACT_DELAY_MS = 30_000;
const DECIDE_DELAY_MS = 5_000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const hostOf = (origin) => {
  if (!origin) return null;
  try { return new URL(origin.includes('://') ? origin : `https://${origin}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const parseKey = (full) => { const [owner, appId, id] = String(full || '').split('/'); return owner && appId && id ? { owner, appId, id } : null; };

/**
 * A scoped observation is kept by its partition's Librarian, but the person's
 * pauses live in their own: learning paused, or that site paused. Checked here,
 * for the partitions. (The account's own Librarian checks itself.)
 */
export async function pausedFor(mainLibrarian, mainDatastore, obs) {
  const profile = await mainLibrarian.getProfile();
  if (profile.memoryPaused) return 'paused';
  const host = hostOf(obs.origin || obs.url);
  if (host && (await mainDatastore.get('mine.siteIndex'))?.[host]?.paused) return 'origin-paused';
  return null;
}

/** What an observation looks like to the Librarian: the who-gave-it fields go into its data. */
export function librarianObservation(obs) {
  const { app: named, appId, adapter, ...rest } = obs;
  const app = named ?? appId;
  if (!app && !adapter) return rest;
  return { ...rest, data: { ...(rest.data || {}), ...(app ? { app } : {}), ...(adapter ? { adapter: typeof adapter === 'string' ? adapter : `${adapter.owner}/${adapter.appId}/${adapter.id}` } : {}) } };
}

export function createLearning({ toolkitHost, withUserLock, profileEvents, access, log, extractDelayMs = EXTRACT_DELAY_MS, decideDelayMs = Math.min(extractDelayMs, DECIDE_DELAY_MS), builtinNeeds = [], now = () => Date.now() }) {
  const timers = new Map(); // uid + partition -> pending extract
  const deciding = new Map(); // uid -> pending decideNeeds
  let registry = null;      // set once the registry exists (useRegistry), to switch adapters on
  const timerKey = (uid, partition) => `${uid}\u0000${partition || ''}`;

  // purpose: what any AI call inside is logged as (gemini.js, ai.call).
  // Every partition of an account queues behind the account's one lock.
  const withToolkit = (uid, fn, purpose = 'learning', partition = null) => withUserLock(uid, async () => {
    const instance = await toolkitHost.getInstance(uid, partition);
    return withAiContext(uid, purpose, () => fn(instance));
  });

  /** Run extract a little after the last observation (one run per quiet spell, per partition). */
  function scheduleExtract(uid, partition = null) {
    const key = timerKey(uid, partition);
    clearTimeout(timers.get(key));
    const timer = setTimeout(() => {
      timers.delete(key);
      extractIn(uid, partition).catch(e => log.warn('learning.extract.failed', { uid, partition, errorCode: e?.code || e?.name || 'error' }));
    }, extractDelayMs);
    timer.unref?.();
    timers.set(key, timer);
  }

  /** Let the profile agent decide on the registered needs a little after the last change. */
  function scheduleDecide(uid) {
    clearTimeout(deciding.get(uid));
    const timer = setTimeout(() => {
      deciding.delete(uid);
      decideIn(uid).catch(e => log.warn('learning.needs.failed', { uid, errorCode: e?.code || e?.name || 'error' }));
    }, decideDelayMs);
    timer.unref?.();
    deciding.set(uid, timer);
  }

  async function decideIn(uid) {
    clearTimeout(deciding.get(uid));
    deciding.delete(uid);
    const result = await withToolkit(uid, async ({ librarian }) => {
      // The toolkit's own adapters' needs, for every person.
      for (const b of builtinNeeds) await librarian.registerNeeds(b.from, b.needs);
      return librarian.decideNeeds();
    }, 'learning.needs');
    log.info('learning.needs', { uid, ran: !!result?.ran, reason: result?.reason, decided: result?.decided || 0, suggested: result?.suggested || 0 });
    return result;
  }

  /** An app registers the needs it meets, for this person. */
  async function registerNeeds(uid, app, needs) {
    const result = await withToolkit(uid, ({ librarian }) => librarian.registerNeeds({ appId: app, app }, needs), 'learning.needs');
    scheduleDecide(uid);
    return result;
  }

  /** Keep one observation where its visibility says: the account's own Librarian, or a partition. */
  async function observe(uid, obs, auth = null) {
    const { partition } = await access.resolveWrite(uid, auth, { app: obs.app, adapter: obs.adapter });
    const result = await withUserLock(uid, async () => {
      if (partition) {
        const main = await toolkitHost.getInstance(uid);
        const paused = await pausedFor(main.librarian, main.datastore, obs);
        if (paused) return { logged: false, reason: paused };
      }
      const { librarian } = await toolkitHost.getInstance(uid, partition);
      return librarian.logObservation(librarianObservation(obs));
    });
    if (result?.logged !== false) scheduleExtract(uid, partition);
    return partition ? { ...result, visibility: partition.split('~')[0] } : result;
  }

  async function extractIn(uid, partition) {
    clearTimeout(timers.get(timerKey(uid, partition)));
    timers.delete(timerKey(uid, partition));
    const result = await withToolkit(uid, async ({ librarian, datastore }) => {
      const r = await librarian.extract();
      // What one app or adapter gave never becomes a suggestion for the shared profile.
      if (partition) await datastore.set('mine.proposals', []);
      return r;
    }, 'learning.extract', partition);
    log.info('learning.extract', { uid, ...(partition ? { partition } : {}), ran: !!result?.ran, reason: result?.reason, observations: result?.observations || 0 });
    return result;
  }

  /** Learn now: the account's own Librarian, then each partition this caller may read. */
  async function learnNow(uid, auth = null) {
    const main = await extractIn(uid, null);
    let observations = main?.ran ? main.observations || 0 : 0;
    let ran = !!main?.ran;
    for (const p of await access.readable(uid, auth)) {
      const r = await extractIn(uid, p.partition);
      if (r?.ran) { ran = true; observations += r.observations || 0; }
    }
    return ran ? { ran: true, observations } : main;
  }

  const memoryView = (m, where) => ({
    id: m.id, text: m.text, scope: m.scope, kind: m.kind, strength: m.strength,
    occurrenceCount: m.occurrenceCount, updatedAt: m.updatedAt,
    visibility: where ? where.level : 'user', ...(where?.app ? { app: where.app } : {}), ...(where?.adapter ? { adapter: where.adapter } : {}), ...(where?.name ? { name: where.name } : {}),
  });
  const pendingIn = (episodic) => (episodic?.entries || []).filter(e => e.id > (episodic.cursor || 0)).length;

  async function learned(uid, auth = null) {
    const scoped = await access.readable(uid, auth);
    return withUserLock(uid, async () => {
      const { librarian, datastore } = await toolkitHost.getInstance(uid);
      const profile = await librarian.getProfile();
      const { memories } = await librarian.listMemories({ status: 'active' });
      const proposals = await librarian.listProposals(null);
      const needs = await librarian.listRegisteredNeeds();
      let pendingObservations = pendingIn(await datastore.get('mine.episodicLog'));
      const all = memories.map(m => memoryView(m, null));
      for (const p of scoped) {
        const part = await toolkitHost.getInstance(uid, p.partition);
        all.push(...(await part.librarian.listMemories({ status: 'active' })).memories.map(m => memoryView(m, p)));
        pendingObservations += pendingIn(await part.datastore.get('mine.episodicLog'));
      }
      const since = now() - WEEK_MS;
      return {
        paused: !!profile.memoryPaused,
        memories: all,
        proposals: proposals.filter(p => p.status === 'pending').map(p => ({
          id: p.id, aspect: p.aspect, label: p.aspectLabel || p.aspect, change: p.change,
          rationale: p.rationale, createdAt: p.createdAt, source: p.source,
        })),
        proposalsThisWeek: proposals.filter(p => p.createdAt > since).length,
        proposalsPerWeek: profile.metaPreferences?.maxProposalsPerWeek ?? DEFAULT_PROPOSALS_PER_WEEK,
        pendingObservations,
        // The needs adapters and apps registered, and the profile agent's last decision on each.
        needs: needs.map(n => ({
          key: n.key, phrase: n.phrase, description: n.description, abilities: n.abilities, value: n.value, from: n.from,
          included: (profile.fields?.needs || []).some(x => x?.dimension === n.key),
          ...(n.decision ? { decision: { include: n.decision.include, by: n.decision.by, reason: n.decision.reason || '', at: n.decision.at } } : {}),
        })),
      };
    });
  }

  async function respond(uid, id, response) {
    const result = await withToolkit(uid, ({ librarian }) => librarian.respondToProposal(id, response));
    if (response === 'accept' && result?.ok !== false) {
      try { await profileEvents.changed(uid); } catch (e) { log.warn('profile.announce.failed', { uid, errorCode: e?.code || 'error' }); }
      scheduleDecide(uid);
      // A need the person accepted: switch on the adapter that meets it, in their browser.
      const key = parseKey(result?.need?.adapter);
      if (key && registry) {
        try { await registry.call(uid, 'adapter_install', { app: BROWSER_RUNTIME_APP, adapter: key, enabled: true }); }
        catch (e) { log.warn('learning.needs.switch-on-failed', { uid, adapter: result.need.adapter, errorCode: e?.code || 'error' }); }
      }
    }
    return result;
  }

  /** Forget one memory, wherever this caller may read it. */
  async function forget(uid, id, auth = null) {
    const scoped = await access.readable(uid, auth);
    return withUserLock(uid, async () => {
      if (await (await toolkitHost.getInstance(uid)).librarian.deleteMemory(id)) return true;
      for (const p of scoped) if (await (await toolkitHost.getInstance(uid, p.partition)).librarian.deleteMemory(id)) return true;
      return false;
    });
  }

  /**
   * Start learning over. Clears the proposals (so the weekly count starts at
   * zero) and the suppressions; with `memories`, also the memories (the
   * person's own notes stay) and the observations not learned from yet, in the
   * account's own Librarian and every partition this caller may read. The
   * profile is left as it is.
   */
  async function reset(uid, { memories = false } = {}, auth = null) {
    const scoped = await access.readable(uid, auth);
    for (const partition of [null, ...scoped.map(p => p.partition)]) {
      clearTimeout(timers.get(timerKey(uid, partition)));
      timers.delete(timerKey(uid, partition));
    }
    return withUserLock(uid, async () => {
      const cleared = { proposals: 0, suppressions: 0, memories: 0, observations: 0 };
      for (const partition of [null, ...scoped.map(p => p.partition)]) {
        const { datastore } = await toolkitHost.getInstance(uid, partition);
        cleared.proposals += (await datastore.get('mine.proposals')).length;
        cleared.suppressions += (await datastore.get('mine.suppressions')).length;
        await datastore.set('mine.proposals', []);
        await datastore.set('mine.suppressions', []);
        // The profile agent decides on the registered needs afresh; what the person chose stays.
        await datastore.patch('mine.registeredNeeds', (all) => {
          for (const n of Object.values(all || {})) if (n.decision?.by !== 'person') delete n.decision;
          return all;
        });
        if (!memories) continue;
        for (const [scope, recs] of Object.entries(await datastore.allMemoryShards())) {
          const kept = (recs || []).filter(r => r.kind === 'note');
          cleared.memories += (recs || []).length - kept.length;
          if (kept.length !== (recs || []).length) await datastore.setMemoryShard(scope, kept);
        }
        await datastore.patch('mine.episodicLog', (l) => {
          cleared.observations += l.entries.filter(e => e.id > l.cursor).length;
          l.cursor = l.entries.length ? Math.max(l.cursor, l.entries[l.entries.length - 1].id) : l.cursor;
          return l;
        });
      }
      return { reset: true, cleared };
    }).finally(() => scheduleDecide(uid));
  }

  // ── what the adapter registry says about the person ───────────────────────
  // Only the browser runtime: what runs in the person's own browser is about
  // them; installing into an app is a developer setting the app up. Each one
  // follows the adapter's visibility.
  function fromRegistry(uid, event) {
    // The needs an installed adapter meets are the profile agent's to decide on, whichever app installed it.
    if (event.needs?.length && event.kind !== 'uninstalled') {
      const on = event.app === BROWSER_RUNTIME_APP && (event.kind === 'installed' || event.enabled === true);
      withToolkit(uid, async ({ librarian }) => {
        await librarian.registerNeeds({ appId: event.appId, adapter: event.adapter }, event.needs);
        // Switched on in their own browser: the person has these needs.
        if (on) for (const n of event.needs) await librarian.chooseNeed(`${event.appId}/${n.id}`);
      }, 'learning.needs').then(() => scheduleDecide(uid), e => log.warn('learning.needs.register-failed', { uid, errorCode: e?.code || 'error' }));
    }
    if (event.app !== BROWSER_RUNTIME_APP) return;
    const what = `the adapter "${event.name}"${event.supportAreas?.length ? ` (for ${event.supportAreas.join(', ')})` : ''}`;
    const data = { adapter: event.adapter, supportAreas: event.supportAreas || [] };
    const about = { app: BROWSER_RUNTIME_APP, adapter: parseKey(event.adapter) || undefined };
    const observations = [];
    if (event.kind === 'installed') observations.push({ type: 'adapter-installed', weight: 3, text: `Chose to run ${what} in their browser.`, data });
    if (event.kind === 'uninstalled') observations.push({ type: 'adapter-removed', weight: 3, text: `Removed ${what} from their browser.`, data });
    if (event.enabled === false) observations.push({ type: 'setting-change', text: `Switched off ${what} in their browser.`, data: { ...data, on: false } });
    if (event.enabled === true) observations.push({ type: 'setting-change', text: `Switched ${what} back on in their browser.`, data: { ...data, on: true } });
    for (const [origin, on] of Object.entries(event.sites || {})) {
      observations.push({ type: 'setting-change', origin, text: `Switched ${what} ${on ? 'back on' : 'off'} on ${origin}.`, data: { ...data, on } });
    }
    for (const obs of observations) {
      // An uninstalled adapter that is gone resolves to user level.
      observe(uid, { ...obs, ...about }).catch(() => observe(uid, obs))
        .catch(e => log.warn('learning.observe.failed', { uid, errorCode: e?.code || 'error' }));
    }
  }

  // ── the profile_* MCP tools ──────────────────────────────────────────────
  const run = {
    profile_get: (uid) => withToolkit(uid, async ({ librarian }) => ({ profile: await librarian.getProfile() })),
    profile_observe: (uid, args, auth) => {
      if (args.data && JSON.stringify(args.data).length > 1000) throw Object.assign(new Error('Keep data small: under 1000 characters as JSON.'), { code: 'data-too-large' });
      return observe(uid, { ...args, type: args.type || 'observation' }, auth);
    },
    profile_learned: (uid, args, auth) => learned(uid, auth),
    profile_learn_now: (uid, args, auth) => learnNow(uid, auth),
    profile_proposal_respond: (uid, args) => respond(uid, args.id, args.response),
    profile_memory_delete: (uid, args, auth) => forget(uid, args.id, auth),
    profile_learning_pause: (uid, args) => withToolkit(uid, async ({ librarian }) => {
      await librarian.setMemoryPaused(args.paused);
      return { paused: args.paused };
    }),
    profile_learning_reset: (uid, args, auth) => reset(uid, args, auth),
    profile_need_register: (uid, args, auth) => {
      // An app token speaks for its own app.
      const app = auth?.kind === 'app' && auth.appId ? auth.appId : args.app;
      const errs = checkNeeds(args.needs);
      if (errs.length) throw Object.assign(new Error(`The needs do not fit: ${errs.slice(0, 3).map(e => `${e.path} ${e.message}`).join('; ')}`), { code: 'invalid-needs' });
      if (!app) throw Object.assign(new Error('Name the app that meets these needs: app, or use the app\'s token.'), { code: 'app-required' });
      return registerNeeds(uid, app, args.needs);
    },
  };
  const tools = Object.fromEntries(Object.keys(PROFILE_TOOL_SCHEMAS).map(name => [name, {
    schema: PROFILE_TOOL_SCHEMAS[name], description: PROFILE_TOOL_DESCRIPTIONS[name],
    readOnly: PROFILE_READ_ONLY.includes(name), run: run[name],
  }]));

  return {
    observe, scheduleExtract, scheduleDecide, decideIn, learnNow, learned, respond, reset, forget, fromRegistry, tools,
    useRegistry: (r) => { registry = r; },
  };
}
