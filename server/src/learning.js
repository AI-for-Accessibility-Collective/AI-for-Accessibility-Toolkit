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
// It also serves the profile_* tools on the toolkit's MCP endpoint
// (toolkit/protocol/adapter/profile.js) and the developer console's reset.
//
// What an app or adapter declared app- or adapter-level is learned in a
// Librarian of its own (access.js); a caller reads the memories of the
// partitions it may read, next to the account's own.

import { withAiContext } from './ai-context.js';
import { PROFILE_TOOL_SCHEMAS, PROFILE_TOOL_DESCRIPTIONS, PROFILE_READ_ONLY, BROWSER_RUNTIME_APP } from '../../toolkit/protocol/adapter/index.js';

const EXTRACT_DELAY_MS = 30_000;
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

export function createLearning({ toolkitHost, withUserLock, profileEvents, access, log, extractDelayMs = EXTRACT_DELAY_MS, now = () => Date.now() }) {
  const timers = new Map(); // uid + partition -> pending extract
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
        proposalsPerWeek: profile.metaPreferences?.maxProposalsPerWeek ?? 3,
        pendingObservations,
      };
    });
  }

  async function respond(uid, id, response) {
    const result = await withToolkit(uid, ({ librarian }) => librarian.respondToProposal(id, response));
    if (response === 'accept' && result?.ok !== false) {
      try { await profileEvents.changed(uid); } catch (e) { log.warn('profile.announce.failed', { uid, errorCode: e?.code || 'error' }); }
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
    });
  }

  // ── what the adapter registry says about the person ───────────────────────
  // Only the browser runtime: what runs in the person's own browser is about
  // them; installing into an app is a developer setting the app up. Each one
  // follows the adapter's visibility.
  function fromRegistry(uid, event) {
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
  };
  const tools = Object.fromEntries(Object.keys(PROFILE_TOOL_SCHEMAS).map(name => [name, {
    schema: PROFILE_TOOL_SCHEMAS[name], description: PROFILE_TOOL_DESCRIPTIONS[name],
    readOnly: PROFILE_READ_ONLY.includes(name), run: run[name],
  }]));

  return { observe, scheduleExtract, learnNow, learned, respond, reset, forget, fromRegistry, tools };
}
