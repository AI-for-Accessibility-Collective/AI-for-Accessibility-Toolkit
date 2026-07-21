// Librarian — the personal memory/profile agent. Sole writer of the
// Librarian-owned stores (mine.profile, mine.suppressions, mine.episodicLog,
// mine.proposals, mine.siteIndex, mine.views, memory shards). Everything
// else — popup, content script, onboarding, the browser agent — goes through
// the host's message handlers or calls the librarian instance directly from
// the same process. Never write these stores elsewhere.
//
// Two lanes:
//   FAST  — deterministic, no LLM, milliseconds: profile reads, cached site
//           classification, scope-chain preference merge, scored recall,
//           observation logging, proposal responses, explicit user edits.
//   SLOW  — LLM-driven, eventually consistent: extraction (episodic log →
//           facts/proposals via ADD/UPDATE/SUPERSEDE/NOOP gating) and
//           reflection (promotion, expiry, view rendering, proposal
//           drafting). Both are resumable: extraction is cursor-based over
//           the append-only log, reflection is idempotent.
//
// Privacy floor: observations on no-memory categories (finance/health/
// government — see taxonomy), paused origins, or while globally paused
// are dropped at logObservation, the single entry point. Profile-tier
// changes NEVER auto-apply: they become proposals the user accepts,
// declines ("not now" → cooldown), or suppresses — and a suppression is
// itself a preference the extraction pipeline consults before drafting.
//
// Platform-agnostic ES module: storage, scheduling, time, notification, and
// demo hooks enter through ports (see ports.js). Gemini access is injected
// via setGeminiCaller, same seam as always.

/**
 * @param {Object} deps
 * @param {() => any} deps.datastore - lazy getter for the Datastore instance
 * @param {() => any} deps.taxonomy  - lazy getter for the taxonomy
 * @param {import('./ports.js').KV} deps.kv
 * @param {import('./ports.js').Clock} [deps.clock]
 * @param {import('./ports.js').Notifier} [deps.notifier]
 * @param {import('./ports.js').Demo} [deps.demo]
 */
import { deriveAbilityModel } from './ability-model.js';
import { resolveSkill, matchSkill, matchSkillToNeed, validateSkill } from './skill.js';
import { buildSkill } from './skill-builder.js';

export function createLibrarian({
  datastore,
  taxonomy,
  kv,
  clock = { now: () => Date.now() },
  notifier = { pending: async () => {} },
  demo = { active: () => false, trace: () => {} },
}) {
  const DS = datastore;
  const TAX = taxonomy;

  // ---- LLM wiring -----------------------------------------------------------
  let _gemini = null; // async (prompt) => string

  // ---- helpers --------------------------------------------------------------
  function newId(prefix) {
    return `${prefix}-${clock.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function originOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return null; }
  }

  function parseJsonLoose(text) {
    if (!text) return null;
    let t = String(text).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '');
    try { return JSON.parse(t); } catch {}
    // Last resort: first {...} block.
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }

  // Decay half-lives per class (ms). Stable facts effectively don't decay.
  const DECAY_HALF_LIFE = {
    stable: Infinity,
    slow: 1000 * 60 * 60 * 24 * 90,  // ~90 days
    fast: 1000 * 60 * 60 * 24 * 7,   // ~7 days
  };

  // Retrieval score: recency x importance x confidence. Deterministic, no
  // embeddings — scope sharding already did the relevance cut (we only load
  // the shards the current page belongs to).
  function scoreRecord(r, now) {
    const half = DECAY_HALF_LIFE[r.decayClass] || DECAY_HALF_LIFE.slow;
    const age = now - (r.lastAccessed || r.updatedAt || r.createdAt || now);
    const recency = half === Infinity ? 1 : Math.pow(0.5, age / half);
    return recency * ((r.importance || 5) / 10) * (r.confidence ?? 0.7);
  }

  function conditionsMet(r, now) {
    if (!r.conditions) return true;
    const d = new Date(now);
    if (r.conditions.timeOfDay) {
      const h = d.getHours();
      const { fromHour = 0, toHour = 24 } = r.conditions.timeOfDay;
      const inWindow = fromHour <= toHour
        ? (h >= fromHour && h < toHour)
        : (h >= fromHour || h < toHour); // overnight window
      if (!inWindow) return false;
    }
    if (Array.isArray(r.conditions.daysOfWeek) && r.conditions.daysOfWeek.length) {
      if (!r.conditions.daysOfWeek.includes(d.getDay())) return false;
    }
    return true;
  }

  const VALID_SCOPE = /^(general|category:[a-z-]+|context:[a-z-]+|origin:[a-z0-9.-]+|tool:[a-zA-Z0-9_-]+)$/;
  const MEMORY_PREFIX = 'aa.mine.memory.';

  // Path segments that would let a write escape the target object into the
  // prototype chain. Guarded in setProfileField (the only path-walking
  // writer) so no caller — internal extraction or a broker insight — can
  // pollute Object.prototype via an accepted proposal.
  const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  // Coerce a settings object into the canonical units/ranges declared in the
  // registry's settingsMeta. Guards against LLM-written values in the wrong
  // unit — e.g. an extracted memory with `fontScale: 1.5` (a multiplier) when
  // the pipeline expects a percentage (`150`); applied raw, 1.5 / 100 collapses
  // the font. A value far below its range whose ×100 lands in range is treated
  // as a multiplier; everything is then clamped to range.
  function sanitizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    let meta = {};
    try { meta = DS().global.tools().settingsMeta || {}; } catch (_) {}
    const out = {};
    for (const [k, v] of Object.entries(settings)) {
      const m = meta[k];
      if (m && m.type === 'number' && Array.isArray(m.range) && typeof v === 'number') {
        const [min, max] = m.range;
        let val = v;
        if (val < min && val * 100 >= min && val * 100 <= max) val = val * 100;
        out[k] = Math.min(max, Math.max(min, val));
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function normalizeRecord(raw, now) {
    const r = { ...raw };
    r.id = r.id || newId('mem');
    r.text = String(r.text || '').slice(0, 500);
    r.tier = ['profile', 'preference', 'site', 'task'].includes(r.tier) ? r.tier : 'preference';
    r.scope = VALID_SCOPE.test(r.scope || '') ? r.scope : 'general';
    r.kind = ['preference', 'procedural', 'suppression', 'rule', 'observation'].includes(r.kind) ? r.kind : 'preference';
    r.importance = Math.min(10, Math.max(1, Number(r.importance) || 5));
    r.confidence = Math.min(1, Math.max(0, Number(r.confidence ?? 0.7)));
    r.decayClass = ['stable', 'slow', 'fast'].includes(r.decayClass) ? r.decayClass : 'slow';
    r.conditions = r.conditions || null;
    r.settings = (r.settings && typeof r.settings === 'object') ? sanitizeSettings(r.settings) : null;
    r.aspect = r.aspect || null;
    r.occurrenceCount = Math.max(1, Number(r.occurrenceCount) || 1);
    r.firstSeenAt = r.firstSeenAt || now;
    r.createdAt = r.createdAt || now;
    r.updatedAt = now;
    r.lastAccessed = r.lastAccessed || now;
    r.status = ['active', 'superseded', 'expired'].includes(r.status) ? r.status : 'active';
    r.supersededBy = r.supersededBy || null;
    r.source = r.source || 'inferred';
    // Reflection grounding (Phase 2): episodic-log entry ids this fact was
    // derived from. Raw evidence is discarded after consolidation (reflect);
    // the grounded ids remain as provenance.
    r.evidence = Array.isArray(r.evidence) ? r.evidence.slice(0, 20) : [];
    return r;
  }

  // Scopes relevant to a page, least → most specific (merge order).
  function scopesFor(url, contexts) {
    const scopes = ['general'];
    for (const c of contexts || []) {
      if (TAX().contexts.some(x => x.id === c)) scopes.push(`context:${c}`);
    }
    const origin = originOf(url);
    return { scopes, origin };
  }

  async function loadScopeShards(url, contexts) {
    const { scopes, origin } = scopesFor(url, contexts);
    let category = null;
    if (origin) {
      category = await Librarian.getSiteCategory(origin); // cached/deterministic only
      if (category) scopes.splice(scopes.length, 0, `category:${category}`);
      scopes.push(`origin:${origin}`);
    }
    const shards = {};
    for (const s of scopes) shards[s] = await DS().getMemoryShard(s);
    return { scopes, shards, origin, category };
  }

  // ---- profile ---------------------------------------------------------------
  const PROFILE_DEFAULTS = {
    schemaVersion: 1,
    supportAreas: [],
    freeText: '',
    fields: {},          // canonical ability fields, e.g. { vision: { fontScale: 130 } }
    metaPreferences: {
      consentBoundary: 'profile-only',  // 'profile-only' | 'all-tiers'
      language: 'standard',             // 'standard' | 'plain'
      maxProposalsPerWeek: 30,
      sharing: 'personal',              // 'personal' | 'friends' | 'anyone' — the
                                        // broker's export ceiling (privacy layer)
    },
    memoryPaused: false,
  };

  async function getOrInitProfile() {
    let p = await DS().get('mine.profile');
    if (!p) {
      // Seed from the legacy onboarding profile if present (it was written
      // once by onboarding and never read — give it a life).
      const legacy = await DS().get('mine.onboardingProfile');
      p = structuredClone(PROFILE_DEFAULTS);
      if (legacy) {
        p.supportAreas = legacy.supportAreas || [];
        p.freeText = legacy.freeText || '';
      }
      p.createdAt = clock.now();
      p.updatedAt = clock.now();
      await DS().set('mine.profile', p);
    }
    return p;
  }

  // ---- public surface ----------------------------------------------------------
  const Librarian = {
    setGeminiCaller(fn) { _gemini = fn; },

    // ====================== FAST LANE (no LLM) ======================

    async getProfile() {
      return await getOrInitProfile();
    },

    // The modality-agnostic AbilityModel (Phase 1): profile understanding +
    // the person's general-scope effective settings, expressed in
    // device-independent terms. Surfaces render it per-device — see
    // toolkit/surfaces/web.js and toolkit/surfaces/xr.js.
    async getAbilityModel() {
      const profile = await getOrInitProfile();
      // General scope only: a null URL yields no origin/category, so the
      // merge returns exactly the person's baseline preferences.
      const { settings } = await this.getEffectivePreferences(null, []);
      return deriveAbilityModel(profile, settings, { now: clock.now() });
    },

    // User-initiated edit — bypasses the proposal gate by design (the gate
    // exists for *inferred* changes; explicit user intent needs no consent).
    async setProfileField(path, value) {
      const parts = String(path).split('.');
      if (parts.some(seg => UNSAFE_KEYS.has(seg))) {
        throw new Error(`Librarian: refusing unsafe profile path "${path}"`);
      }
      return await DS().patch('mine.profile', async (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        let obj = p;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] == null) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
        p.updatedAt = clock.now();
        return p;
      });
    },

    // Fast lane for manual setting flips (popup toggle, onboarding choice).
    // A deliberate change is the strongest preference signal there is, so it
    // is recorded immediately as a durable user-explicit record that gets
    // FINAL say in getEffectivePreferences — without this, an auto-apply
    // profile or a learned record re-imposes the old value on the next page
    // and the user's change silently "doesn't stick". One record per setting
    // key, updated in place on subsequent changes. Recorded even while
    // memory is paused: this is a direct user command, not an inference.
    async recordExplicitSetting(key, value, origin) {
      return this.recordScopedSettings('general', { [key]: value }, { origin });
    },

    // Generalized explicit-setting writer: upserts one durable user-explicit
    // record PER setting key at the given scope (general | category:<id> |
    // origin:<host> | context:<id>). These get final say in
    // getEffectivePreferences, but a scoped record only loads when the page
    // matches that scope — so "make news sites easier to read" lands on
    // category:news and does NOT leak to every site. scopeLabel is a
    // human phrase for the record text. Returns the record ids.
    async recordScopedSettings(scope, settings, opts = {}) {
      const now = clock.now();
      scope = VALID_SCOPE.test(scope || '') ? scope : 'general';
      const where = opts.scopeLabel || (
        scope === 'general' ? '' :
        scope.startsWith('category:') ? ` on ${scope.slice(9)} sites` :
        scope.startsWith('origin:') ? ` on ${scope.slice(7)}` :
        scope.startsWith('context:') ? ` for ${scope.slice(8)} content` : '');
      const shard = await DS().getMemoryShard(scope);
      const ids = [];
      for (const [key, value] of Object.entries(settings || {})) {
        const aspect = `setting.${key}`;
        const text = `You set ${key} to ${JSON.stringify(value)}${where}.`;
        let rec = shard.find(r => r.source === 'user-explicit' && r.aspect === aspect && r.status === 'active');
        if (rec) {
          rec.settings = { [key]: value };
          rec.text = text;
          rec.occurrenceCount = (rec.occurrenceCount || 1) + 1;
          rec.updatedAt = now;
          rec.lastAccessed = now;
        } else {
          rec = normalizeRecord({
            kind: 'preference', tier: 'preference', scope, aspect,
            source: 'user-explicit', confidence: 1, importance: 8,
            decayClass: 'stable', settings: { [key]: value }, text,
          }, now);
          shard.push(rec);
        }
        ids.push(rec.id);
      }
      await DS().setMemoryShard(scope, shard);
      return ids;
    },

    // Classify once, cache forever; user override wins and is sticky.
    // Deterministic by default — pass {allowLlm: true, title} to let the
    // host's classify handler fall through to Gemini for unknown hosts.
    async getSiteCategory(origin, opts = {}) {
      origin = (origin || '').toLowerCase().replace(/^www\./, '');
      if (!origin) return null;
      const idx = await DS().get('mine.siteIndex');
      const hit = idx[origin];
      if (hit && (hit.source === 'user' || hit.taxonomyVersion === TAX().version)) {
        return hit.category;
      }
      let category = TAX().categoryForHost(origin);
      let source = 'hostmap';
      if (!category && opts.allowLlm && _gemini) {
        try {
          const valid = TAX().categoryIds();
          const out = await _gemini(
            `Classify this website into exactly one category. Hostname: "${origin}", Title: "${opts.title || ''}". Categories: ${valid.join(', ')}. Return ONLY the category word, nothing else.`
          );
          const cleaned = (out || '').trim().toLowerCase();
          category = valid.includes(cleaned) ? cleaned : 'other';
          source = 'llm';
        } catch { category = null; }
      }
      if (category) {
        await DS().patch('mine.siteIndex', (cur) => {
          cur[origin] = { category, source, classifiedAt: clock.now(), taxonomyVersion: TAX().version, ...(cur[origin]?.paused ? { paused: true } : {}) };
          return cur;
        });
      }
      return category;
    },

    async setSiteCategoryOverride(origin, category) {
      origin = (origin || '').toLowerCase().replace(/^www\./, '');
      await DS().patch('mine.siteIndex', (cur) => {
        cur[origin] = { ...(cur[origin] || {}), category, source: 'user', classifiedAt: clock.now(), taxonomyVersion: TAX().version };
        return cur;
      });
    },

    // Deterministic scope-chain merge of machine-actionable settings.
    // Order (later wins): general → context → category → explicit
    // customProfile (user-authored beats inferred at category level) →
    // origin. Rule records (kind 'rule') in a shard apply after that
    // shard's preferences. Conditions (time windows) filter throughout.
    async getEffectivePreferences(url, contexts = []) {
      const now = clock.now();
      const { scopes, shards, origin, category } = await loadScopeShards(url, contexts);
      const merged = {};
      const applied = [];
      // provenance: key -> scope of the record that set its final value, so a
      // consumer (the popup) can write a change back to the same scope rather
      // than clobbering the global baseline.
      const provenance = {};
      const assign = (src, scope) => {
        const clean = sanitizeSettings(src) || {};
        Object.assign(merged, clean);
        for (const k of Object.keys(clean)) provenance[k] = scope;
      };
      // Deliberate user choices are deferred and applied after everything
      // else: a toggle (user-explicit) or an ACCEPTED proposal
      // (accepted-proposal — the person said yes in the consent UI) must
      // beat profiles and learned records at any scope, or the user's
      // decision silently reverts on the next page load. Among them,
      // specificity then recency wins, so a newer accepted proposal
      // supersedes an older toggle at the same scope.
      const EXPLICIT_SOURCES = new Set(['user-explicit', 'accepted-proposal']);
      const explicit = [];
      // sanitizeSettings defensively here too: records written before the
      // unit-coercion fix may still hold a multiplier (fontScale 1.5), and we
      // must not collapse the font on read.
      const applyShard = (scope) => {
        const recs = (shards[scope] || [])
          .filter(r => r.status === 'active' && r.settings && conditionsMet(r, now))
          .sort((a, b) => (a.kind === 'rule') - (b.kind === 'rule')); // rules last
        for (const r of recs) {
          if (EXPLICIT_SOURCES.has(r.source)) { explicit.push({ r, scope }); continue; }
          assign(r.settings, scope);
          applied.push({ id: r.id, scope, text: r.text });
        }
      };
      for (const s of scopes) {
        if (s.startsWith('origin:')) continue; // origin applies last, below
        applyShard(s);
        // Explicit user profiles slot in right after their category.
        if (s.startsWith('category:') && category) {
          const profiles = (await DS().get('mine.profiles')) || [];
          const match = profiles.find(p => p.autoApply && p.siteTypes?.includes(category));
          if (match?.settings) {
            assign(match.settings, s);
            applied.push({ id: match.id, scope: s, text: `Profile "${match.name}"`, explicit: true });
          }
        }
      }
      if (origin) applyShard(`origin:${origin}`);
      // Among explicit records, the most SPECIFIC scope wins (origin > category
      // > context > general); ties broken by recency. Otherwise a newer global
      // toggle would override a site-scoped choice on its own site.
      const specificity = (sc) => sc.startsWith('origin:') ? 3 : sc.startsWith('category:') ? 2 : sc.startsWith('context:') ? 1 : 0;
      explicit.sort((a, b) => (specificity(a.scope) - specificity(b.scope))
        || ((a.r.updatedAt || 0) - (b.r.updatedAt || 0)));
      for (const { r, scope } of explicit) {
        assign(r.settings, scope);
        applied.push({ id: r.id, scope, text: r.text, explicit: true });
      }
      return { settings: merged, applied, provenance, category, origin };
    },

    // Context block for agent prompts: core memory block + scored facts for
    // this page + category playbook. Deterministic; markdown at the
    // boundary, records at rest.
    async recall(url, task = '', contexts = []) {
      const now = clock.now();
      const { scopes, shards, origin, category } = await loadScopeShards(url, contexts);
      const profile = await getOrInitProfile();
      const views = await DS().get('mine.views');

      const facts = [];
      for (const s of scopes) {
        for (const r of (shards[s] || [])) {
          if (r.status !== 'active' || r.kind === 'suppression' || !conditionsMet(r, now)) continue;
          facts.push({ ...r, _scope: s, _score: scoreRecord(r, now) });
        }
      }
      facts.sort((a, b) => b._score - a._score);
      const top = facts.slice(0, 12);

      // Touch lastAccessed on what we surfaced (recency feedback loop).
      const touched = new Set(top.map(r => r.id));
      for (const s of new Set(top.map(r => r._scope))) {
        const shard = shards[s].map(r => touched.has(r.id) ? { ...r, lastAccessed: now } : r);
        await DS().setMemoryShard(s, shard);
      }

      const lines = [];
      const core = views.coreBlock
        || `Support areas: ${profile.supportAreas.join(', ') || 'not specified'}.`
        + (profile.freeText ? ` Notes: ${profile.freeText}` : '');
      lines.push('### About this user', core);
      const byScope = (pred, title) => {
        const hits = top.filter(pred);
        if (hits.length) {
          lines.push(`### ${title}`);
          for (const f of hits) lines.push(`- ${f.text}`);
        }
      };
      byScope(f => f._scope === 'general', 'General preferences');
      byScope(f => f._scope.startsWith('context:'), 'For this kind of content');
      byScope(f => f._scope.startsWith('category:'), category ? `On ${category} sites` : 'On sites like this');
      byScope(f => f._scope.startsWith('origin:'), origin ? `On ${origin}` : 'On this site');
      const playbook = category && views.playbooks && views.playbooks[category];
      if (playbook) lines.push(`### Playbook: ${category} sites`, playbook);

      // Procedural memory (Phase 2): saved automations applicable here, so
      // an agent knows what it already knows how to do for this person.
      const procedural = await this.listProcedural(category);
      const actions = procedural.filter(p => p.kind === 'saved-action');
      if (actions.length) {
        lines.push('### Learned automations for sites like this');
        for (const a of actions.slice(0, 5)) lines.push(`- ${a.name}`);
      }

      return { block: lines.join('\n'), facts: top, profile, category, origin, procedural };
    },

    async listMemories(filter = {}) {
      const out = [];
      const all = await kv.getAll();
      for (const [key, recs] of Object.entries(all)) {
        if (!key.startsWith(MEMORY_PREFIX)) continue;
        const scope = key.slice(MEMORY_PREFIX.length);
        for (const r of (recs || [])) {
          if (filter.status && r.status !== filter.status) continue;
          if (filter.scope && scope !== filter.scope) continue;
          out.push({ ...r, scope });
        }
      }
      const supp = await DS().get('mine.suppressions');
      return { memories: out, suppressions: supp };
    },

    async deleteMemory(id) {
      const all = await kv.getAll();
      for (const [key, recs] of Object.entries(all)) {
        if (!key.startsWith(MEMORY_PREFIX)) continue;
        const idx = (recs || []).findIndex(r => r.id === id);
        if (idx >= 0) {
          recs.splice(idx, 1);
          await kv.set({ [key]: recs });
          return true;
        }
      }
      // Suppressions are deletable too (un-suppress). Report whether a record
      // actually went away — filter() always returns an array, so length is
      // the only honest signal.
      let found = false;
      await DS().patch('mine.suppressions', (s) => {
        const next = (s || []).filter(x => x.id !== id);
        found = next.length !== (s || []).length;
        return next;
      });
      return found;
    },

    async listProposals(status = 'pending') {
      const props = await DS().get('mine.proposals');
      return status ? props.filter(p => p.status === status) : props;
    },

    // Procedural memory (Phase 2): what the person's assistant KNOWS HOW TO
    // DO for them — custom adapters (mine.skills) and saved reusable actions
    // (mine.profiles[].actions). Storage stays where it is (no migration;
    // the catalog maps it); this is the unified read surface.
    async listProcedural(category = null) {
      const out = [];
      for (const s of (await DS().get('mine.skills')) || []) {
        if (s.enabled === false) continue;
        const scope = s.scope || 'general';
        if (category && scope.startsWith('category:') && scope.slice(9) !== category) continue;
        out.push({
          kind: 'custom-adapter', id: s.id, name: s.name,
          description: s.description || '', scope,
        });
      }
      for (const p of (await DS().get('mine.profiles')) || []) {
        if (!p.autoApply) continue;
        if (category && !(p.siteTypes || []).includes(category)) continue;
        for (const a of (p.actions || [])) {
          out.push({
            kind: 'saved-action', id: a.id, name: a.name,
            prompt: a.prompt, siteTypes: p.siteTypes || [], profileId: p.id,
          });
        }
      }
      return out;
    },

    // ====================== SKILLS (the Engineer + Skills db) ======================

    // All skills available to this person: built-in (global tier) + their own
    // (mine.skillDocs). Each is a parsed Skill object. This is the read side
    // of the diagrams' "Skills db".
    async listSkills() {
      const builtin = (DS().global.skills() || []).map(s => ({ ...s, source: 'builtin' }));
      const mine = (await DS().get('mine.skillDocs') || []).map(s => ({ ...s, source: 'mine' }));
      return [...builtin, ...mine];
    },

    // Retrieve the best-fitting skill for a page + this person (diagram:
    // "Librarian retrieves the skill for use"). Deterministic scoring over
    // the ability profile's support areas and the page category. Returns the
    // top match (or null), so the caller can apply it.
    async retrieveSkill(url, contexts = []) {
      const profile = await getOrInitProfile();
      const origin = originOf(url);
      const category = origin ? await this.getSiteCategory(origin) : null;
      const ctx = { supportAreas: profile.supportAreas || [], category };
      const scored = (await this.listSkills())
        .map(s => ({ skill: s, score: matchSkill(s, ctx) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);
      return scored.length ? scored[0].skill : null;
    },

    // The skill-creation flow's first diamond: "does the skill exist in the
    // db?" — checked BEFORE the Engineer builds anything. Built-in and the
    // person's own skills both count. Deterministic keyword match (no LLM),
    // so the reuse offer works without an API key. Returns the best fit or
    // null when nothing plausibly covers the need.
    async findSkillForNeed(need) {
      const scored = (await this.listSkills())
        .map(s => ({ skill: s, score: matchSkillToNeed(s, need) }))
        .filter(x => x.score >= 4)
        .sort((a, b) => b.score - a.score);
      return scored.length ? scored[0].skill : null;
    },

    // Compile a skill to the deterministic apply-plan (settings + adapter ids)
    // the host's adapter layer consumes. No LLM at apply-time.
    resolveSkill(skill) {
      return resolveSkill(skill);
    },

    // The Engineer: build a new skill from a plain-language need, grounded in
    // the real adapter catalog. Does NOT save — returns the skill for the
    // user to validate first (the adaptive evaluation interface). Consent
    // before persistence is the toolkit's rule. When validation fails, pass
    // the rejected attempt back as { previous, feedback } and the Engineer
    // revises it — the evaluation loop's "fail → back to the builder" arrow.
    async buildSkill(need, opts = {}) {
      const profile = await getOrInitProfile();
      return await buildSkill(need, {
        llm: _gemini,
        tools: DS().global.tools(),
        taxonomy: TAX(),
        profile,
        previous: opts.previous || null,
        feedback: opts.feedback || '',
      });
    },

    // Persist a user-validated skill to their Skills db (mine.skillDocs).
    // Re-validates against the registry so a malformed skill can't be stored.
    async saveSkill(skill) {
      const { valid, errors } = validateSkill(skill, { tools: DS().global.tools() });
      if (!valid) return { saved: false, errors };
      await DS().patch('mine.skillDocs', (skills) => {
        const idx = skills.findIndex(s => s.name === skill.name);
        const entry = { ...skill, savedAt: clock.now() };
        if (idx >= 0) skills[idx] = entry; else skills.push(entry);
        return skills;
      });
      // A saved skill is a strong signal about what helps this person. Record
      // the ability context (supportAreas) and the triggers (siteRelevance)
      // alongside it — the flow's final step, where the profile/memory db
      // learns e.g. "low vision + anxiety" and "news sites + videos" from the
      // skill the person just validated. Extraction folds it into the profile.
      await this.logObservation({
        type: 'saved-action',
        text: `Saved skill "${skill.name}" — helps with ${(skill.supportAreas || []).join(', ') || 'unspecified areas'};`
          + ` applies on ${(skill.siteRelevance || []).join(', ') || 'all'} sites`,
        data: { skill: skill.name, supportAreas: skill.supportAreas || [], triggers: skill.siteRelevance || [] },
      }).catch(() => {});
      return { saved: true, errors: [] };
    },

    async deleteSkill(name) {
      let removed = false;
      await DS().patch('mine.skillDocs', (skills) => {
        const next = skills.filter(s => s.name !== name);
        removed = next.length !== skills.length;
        return next;
      });
      return removed;
    },

    // Consent gateway for externally-sourced insights (the broker calls
    // this; nothing else writes proposals). Same suppression/cooldown/
    // weekly-cap gates as internal inferences; provenance is preserved so
    // the consent UI can say WHO is suggesting.
    async proposeInsight(draft, meta = {}) {
      const profile = await getOrInitProfile();
      const suppressions = await DS().get('mine.suppressions');
      const before = (await DS().get('mine.proposals')).filter(p => p.status === 'pending').length;
      await this._draftProposals([{
        ...draft,
        rationale: meta.source
          ? `[from ${meta.source}] ${draft.rationale || ''}`.trim()
          : (draft.rationale || ''),
      }], { suppressions, profile, now: clock.now() });
      const after = await DS().get('mine.proposals');
      const queued = after.filter(p => p.status === 'pending').length > before;
      if (queued && meta.source) {
        // Stamp provenance on the proposal we just created.
        const prop = after.filter(p => p.status === 'pending' && p.aspect === draft.aspect).pop();
        if (prop) {
          prop.origin = { source: meta.source, grantId: meta.grantId || null, confidence: meta.confidence ?? null };
          await DS().set('mine.proposals', after);
        }
      }
      await updateBadge();
      return queued;
    },

    // Prompt for the popup's "what support do you need?" flow. The Librarian
    // owns it so the "does this exist in the global db?" decision is grounded
    // in the actual tools registry (Datastore.global.tools) and conditioned
    // on the ability profile — not a hand-maintained vocabulary copy.
    // Fast lane: builds a string, never calls the LLM itself.
    async interpretNeedsPrompt(text) {
      const tools = DS().global.tools();
      const profile = await getOrInitProfile();
      const profileBlock = (profile.supportAreas.length || profile.freeText)
        ? `\n\nWhat we know about this user:\n- Support areas: ${profile.supportAreas.join(', ') || 'unspecified'}`
          + (profile.freeText ? `\n- In their words: "${profile.freeText}"` : '')
        : '';
      return `You are an accessibility assistant for a browser extension. The user describes what they need in plain language. Map their description to specific extension settings.

Available settings (use these exact keys):
${tools.settingsVocabularyLines().join('\n')}

Built-in tools these settings belong to (for context on what already exists):
${tools.forPrompt().map(t => `- ${t.name}: ${t.description}`).join('\n')}${profileBlock}

Site categories (for scoping): ${TAX().categoryIds().join(', ')}.

User says: "${text}"

Return ONLY valid JSON with:
{
  "summary": "One friendly sentence describing what you understood",
  "scope": "Where these settings should apply. Use 'general' for everywhere (the default). If the user limits it to a kind of site, use 'category:<id>' with one of the categories above (e.g. 'on news sites' -> 'category:news', 'when watching videos' -> 'category:video'). If they name a specific website, use 'origin:<hostname>' (e.g. 'on youtube.com'). Only narrow the scope when the user explicitly limits it.",
  "settings": { /* only keys that should change, with their values */ },
  "reasons": { /* same keys as settings, each with a short reason why */ },
  "newSkills": [ /* ONLY if the user's need CANNOT be fully met by the settings and built-in tools above, suggest custom skills to build. Each object has "name" (short) and "description" (1-2 sentences of what it would do). Leave as empty array [] if existing settings are sufficient. */ ]
}`;
    },

    // The single entry point for observations — and the privacy floor.
    // Drops (never logs) when globally paused, when the origin is paused,
    // or when the origin's category is a no-memory zone without an explicit
    // opt-in. The log is the pipeline's WAL: extraction consumes entries
    // behind a cursor, so a crash mid-extraction loses nothing.
    async logObservation(obs) {
      const profile = await getOrInitProfile();
      if (profile.memoryPaused) return { logged: false, reason: 'paused' };
      // `let`, not `const`: the demo fallback below reassigns these. (The
      // pre-toolkit original declared `origin` const and threw a TypeError
      // whenever demo mode hit that branch with no URL — fixed here.)
      let origin = obs.origin || originOf(obs.url || '');
      let category = obs.category || null;
      if (origin) {
        const idx = await DS().get('mine.siteIndex');
        const entry = idx[origin];
        if (entry?.paused) return { logged: false, reason: 'origin-paused' };
        category = category || entry?.category || TAX().categoryForHost(origin);
        if (category && TAX().noMemoryCategories().includes(category) && !entry?.memoryOptIn) {
          return { logged: false, reason: 'no-memory-zone' };
        }
      }
      // Deliberateness weight: explicit user actions are strong signal,
      // agent outcomes medium, ambient observations weak. Extraction uses
      // this to resist minting "preferences" out of misclicks (tremor) or
      // exploration (setting-flipping).
      const WEIGHTS = { 'setting-change': 3, 'profile-applied': 3, 'saved-action': 3, onboarding: 3, 'agent-task': 2 };
      await DS().patch('mine.episodicLog', (log) => {
        const id = (log.entries.length ? log.entries[log.entries.length - 1].id : log.cursor) + 1;
        log.entries.push({
          id,
          t: clock.now(),
          type: obs.type || 'observation',
          weight: obs.weight || WEIGHTS[obs.type] || 1,
          origin: origin || null,
          category: category || null,
          data: obs.data || {},
          text: String(obs.text || '').slice(0, 400),
        });
        if (log.entries.length > 500) log.entries.splice(0, log.entries.length - 500);
        return log;
      });
      scheduleExtraction();
      // Diagram 2's "is this a common reusable task?" diamond: a successful
      // agent run on a categorized site becomes a consent-gated proposal to
      // save it as an auto-replayed action. Deterministic (no LLM) so the
      // flow works without an API key and is demo-reliable. _draftProposals
      // applies the suppression/cooldown/weekly-cap gates.
      //
      // Demo mode loosens this so the scripted "suggestion" beat always fires:
      // any finished agent run counts as success, and a missing origin/category
      // falls back to a video site (the demo runs the agent on YouTube).
      if (demo.active() && obs.type === 'agent-task') {
        if (!origin) origin = 'youtube.com';
        if (!category) category = 'video';
      }
      const taskSucceeded = obs.data?.success
        || (demo.active() && obs.type === 'agent-task');
      if (obs.type === 'agent-task' && taskSucceeded && origin && category) {
        demo.trace('skill', 'reusable_q', 'common reusable task?');
        try { await this._maybeProposeReusableAction(obs, origin, category); }
        catch (e) { console.warn('[Librarian] reusable-action proposal failed:', e.message); }
      }
      return { logged: true };
    },

    async _maybeProposeReusableAction(obs, origin, category) {
      const task = (obs.data && obs.data.task) || '';
      if (!task) return;
      // Already saved as an action for this category? Don't re-propose.
      // (Demo mode skips this so the beat repeats across rehearsals.)
      const profiles = (await DS().get('mine.profiles')) || [];
      const exists = profiles.some(p => p.siteTypes?.includes(category)
        && (p.actions || []).some(a => (a.prompt || '').trim().toLowerCase() === task.trim().toLowerCase()));
      if (exists && !demo.active()) return;
      const profile = await getOrInitProfile();
      const suppressions = await DS().get('mine.suppressions');
      const shortTask = task.length > 60 ? task.slice(0, 57) + '…' : task;
      await this._draftProposals([{
        // Category-level aspect: "don't suggest this" silences automation
        // suggestions for this site category, not just this one task.
        aspect: `reusable-action.category:${category}`,
        aspectLabel: `running "${shortTask}" automatically on ${category} sites`,
        change: {
          op: 'add-profile-action',
          siteTypes: [category],
          action: { name: shortTask, prompt: task },
        },
        rationale: `You just had the agent do this on ${origin}. I can do it automatically whenever you visit a ${category} site.`,
        evidence: [],
      }], { suppressions, profile, now: clock.now() });
      demo.trace('skill', 'reusable_q', 'proposed: save as skill');
      await updateBadge();
    },

    async setMemoryPaused(paused) {
      await DS().patch('mine.profile', (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        p.memoryPaused = !!paused;
        p.updatedAt = clock.now();
        return p;
      });
    },

    async setOriginPaused(origin, paused) {
      origin = (origin || '').toLowerCase().replace(/^www\./, '');
      await DS().patch('mine.siteIndex', (cur) => {
        cur[origin] = { ...(cur[origin] || {}), paused: !!paused };
        return cur;
      });
    },

    // accept | declineOnce | suppress. Graduated consent: "not now" is a
    // 30-day cooldown; two soft declines escalate the NEXT proposal on this
    // aspect to offer permanent suppression; "suppress" writes a durable,
    // user-visible suppression record (a preference in its own right).
    async respondToProposal(id, response) {
      const props = await DS().get('mine.proposals');
      const prop = props.find(p => p.id === id);
      if (!prop || prop.status !== 'pending') return { ok: false, reason: 'not-pending' };
      const now = clock.now();

      if (response === 'accept') {
        // A profile-set proposal may only write ability fields (`fields.*`) —
        // the contract the extraction prompt promises. Refuse control-plane
        // paths (metaPreferences, memoryPaused, schemaVersion, …): an inferred
        // proposal the user only ever sees as friendly prose must never
        // silently rewrite consent or rate-limit settings. (The broker bans
        // profile-set outright for external apps; this closes the same hole on
        // the internal extraction path.)
        if (prop.change?.op === 'profile-set' && !/^fields\.[A-Za-z]/.test(String(prop.change.path || ''))) {
          return { ok: false, reason: 'profile-path-not-allowed' };
        }
        prop.status = 'accepted';
        if (prop.change?.op === 'profile-set') {
          await this.setProfileField(prop.change.path, prop.change.value);
        } else if (prop.change?.op === 'add-profile-action' && prop.change.action) {
          // Save into an existing auto-apply profile for the category, or
          // create one — same storage the popup's manual "Save to Profile"
          // uses, so auto-replay picks it up with no extra plumbing.
          const siteTypes = prop.change.siteTypes || [];
          await DS().patch('mine.profiles', (profiles) => {
            profiles = profiles || [];
            let target = profiles.find(p => p.autoApply && p.siteTypes?.some(t => siteTypes.includes(t)));
            if (!target) {
              target = {
                id: 'profile-' + now,
                name: `${siteTypes[0] ? siteTypes[0][0].toUpperCase() + siteTypes[0].slice(1) : 'Auto'} automations`,
                siteTypes,
                autoApply: true,
                settings: {},
                actions: [],
              };
              profiles.push(target);
            }
            if (!target.actions) target.actions = [];
            target.actions.push({
              id: 'action-' + now,
              name: prop.change.action.name,
              prompt: prop.change.action.prompt,
              savedAt: now,
            });
            return profiles;
          });
          // The implicit flow's last box: the accepted reusable task also
          // becomes a real SKILL.md in the Skills db (an action-step recipe),
          // so the person can see it, apply it, and share it like any other
          // skill. The profile action above stays — auto-replay reads it.
          const slug = String(prop.change.action.name || 'saved-task').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'saved-task';
          const cats = siteTypes.length ? siteTypes : ['all'];
          // Best-effort: the accept itself must still persist (line below the
          // branch) even if the skill-doc write fails — otherwise the proposal
          // stays pending on disk with the profile action already saved, and
          // a second accept would duplicate it.
          try {
            const prompt = prop.change.action.prompt;
            const skills = await this.listSkills();
            const sameCats = (s) =>
              JSON.stringify([...(s.siteRelevance || [])].sort()) === JSON.stringify([...cats].sort());
            // Idempotent: an action skill for this exact task already exists.
            const already = skills.some(s => sameCats(s)
              && (s.recipe?.adapters || []).length === 0
              && (s.recipe?.actions || []).length === 1
              && s.recipe.actions[0].prompt === prompt);
            if (!already) {
              // A proposal-sourced save must only ADD — never overwrite a
              // skill (the person's own or a built-in) that shares the name.
              // Proposal fields can be app-supplied through the broker, so a
              // name collision here could otherwise swap a trusted skill's
              // recipe for an attacker-chosen task.
              const names = new Set(skills.map(s => s.name));
              let name = slug;
              for (let n = 2; names.has(name); n++) name = `${slug}-${n}`;
              await this.saveSkill({
                name,
                description: `Runs "${prompt}" for you. Use it on ${cats.join(', ')} sites.`,
                supportAreas: [],
                siteRelevance: cats,
                recipe: { adapters: [], actions: [{ name: prop.change.action.name, prompt }] },
                body: `# ${prop.change.action.name}\n\nSaved from a task the assistant completed for you. Applying this skill runs the same task on the current page.`,
              });
            }
          } catch (e) {
            console.warn('[Librarian] could not save accepted task as a skill:', e.message);
          }
          demo.trace('skill', 'skillsdb', 'saved as skill.md');
          demo.trace('skill', 'autoenable', 'skill stored');
          demo.trace('skill', 'profiledb_skill', 'trigger registered');
          demo.trace('personal', 'continual', 'continual update');
        } else if (prop.change?.op === 'add-memory' && prop.change.record) {
          const rec = normalizeRecord({ ...prop.change.record, source: 'accepted-proposal', confidence: 0.95 }, now);
          await DS().patch('mine.profile', p => p); // ensure profile exists
          const shard = await DS().getMemoryShard(rec.scope);
          shard.push(rec);
          await DS().setMemoryShard(rec.scope, shard);
        }
        // Validated inference → boost the evidence memories' confidence.
        for (const evId of (prop.evidence || [])) {
          const all = await kv.getAll();
          for (const [key, recs] of Object.entries(all)) {
            if (!key.startsWith(MEMORY_PREFIX)) continue;
            const r = (recs || []).find(x => x.id === evId);
            if (r) { r.confidence = Math.min(1, (r.confidence ?? 0.7) + 0.1); await kv.set({ [key]: recs }); }
          }
        }
      } else if (response === 'declineOnce') {
        prop.status = 'declined';
        await DS().patch('mine.suppressions', (s) => {
          const existing = s.find(x => x.aspect === prop.aspect && x.mode === 'cooldown');
          if (existing) {
            existing.until = now + 30 * 24 * 3600 * 1000;
            existing.declineCount = (existing.declineCount || 1) + 1;
          } else {
            s.push({ id: newId('sup'), aspect: prop.aspect, mode: 'cooldown', until: now + 30 * 24 * 3600 * 1000, declineCount: 1, createdAt: now });
          }
          return s;
        });
      } else if (response === 'suppress') {
        prop.status = 'suppressed';
        await DS().patch('mine.suppressions', (s) => {
          s = s.filter(x => x.aspect !== prop.aspect); // replace any cooldown
          s.push({
            id: newId('sup'), aspect: prop.aspect, mode: 'permanent',
            text: `Don't suggest changes about: ${prop.aspectLabel || prop.aspect}`,
            source: 'explicit-user', createdAt: now,
          });
          return s;
        });
      } else {
        return { ok: false, reason: 'bad-response' };
      }
      prop.respondedAt = now;
      await DS().set('mine.proposals', props);
      await updateBadge();
      return { ok: true, status: prop.status };
    },

    // ====================== SLOW LANE (LLM) ======================

    // Drain the episodic log behind the cursor: one Gemini call extracts
    // candidate facts AND gates them against existing same-scope memories,
    // returning ADD/UPDATE/SUPERSEDE/NOOP operations plus profile-tier
    // proposal drafts. Idempotent: cursor advances only after ops apply.
    async extract() {
      if (!_gemini) return { ran: false, reason: 'no-llm' };
      const log = await DS().get('mine.episodicLog');
      const pending = log.entries.filter(e => e.id > log.cursor);
      if (!pending.length) return { ran: false, reason: 'empty' };
      const lastId = pending[pending.length - 1].id;

      // Existing memories for the scopes these observations touch.
      const scopes = new Set(['general']);
      for (const e of pending) {
        if (e.category) scopes.add(`category:${e.category}`);
        if (e.origin) scopes.add(`origin:${e.origin}`);
      }
      const existing = [];
      for (const s of scopes) {
        for (const r of await DS().getMemoryShard(s)) {
          if (r.status === 'active') existing.push({ id: r.id, scope: s, text: r.text, settings: r.settings, occurrenceCount: r.occurrenceCount });
        }
      }
      const suppressions = await DS().get('mine.suppressions');
      const now = clock.now();
      const activeSuppressed = suppressions
        .filter(s => s.mode === 'permanent' || (s.mode === 'cooldown' && s.until > now))
        .map(s => s.aspect);
      const profile = await getOrInitProfile();

      const prompt = `You maintain the memory of a browser accessibility assistant. Convert raw observations into durable memory operations.

## Setting keys and their EXACT units/ranges (use these units in every "settings" object)
${DS().global.tools().settingsVocabularyLines().join('\n')}

## User profile
${JSON.stringify({ supportAreas: profile.supportAreas, freeText: profile.freeText }, null, 1)}

## New observations (weight 3 = deliberate user action, 1 = ambient; cite ids as evidence)
${JSON.stringify(pending.map(e => ({ id: e.id, type: e.type, weight: e.weight, origin: e.origin, category: e.category, text: e.text, data: e.data })), null, 1)}

## Existing memories (compare candidates against these)
${JSON.stringify(existing, null, 1)}

## Suppressed aspects (NEVER propose about these)
${JSON.stringify(activeSuppressed)}

Rules:
- Extract only durable, useful facts: preferences, repeated patterns, how-to knowledge. Ignore one-off low-weight noise (a single weight-1 event is exploration, not preference).
- scope: "general" | "category:<${TAX().categoryIds().join('|')}>" | "origin:<hostname>" | "context:<video|form|document>". Prefer the narrowest scope the evidence supports.
- For each candidate, compare to existing memories: same fact → {"op":"NOOP","id":<existing id>} (we bump its count); refines/strengthens → {"op":"UPDATE","id":...,"text":...,"settings":...}; contradicts → {"op":"SUPERSEDE","id":...,"record":{...}}; genuinely new → {"op":"ADD","record":{...}}.
- record fields: text (one plain sentence), tier ("preference"|"site"|"task"), scope, kind ("preference"|"procedural"), importance 1-10, confidence 0-1, decayClass ("stable"|"slow"|"fast"), settings (object of extension setting keys like fontScale/darkMode/autoCaptions if directly actionable, else null), evidence (array of the observation ids above that support this fact).
- Changes to the user's ABILITY PROFILE (their disability/needs themselves, not site preferences) must NOT be memory records. Emit them under "proposals" instead: {aspect:"profile.<field>", aspectLabel:"plain words", change:{op:"profile-set",path:"fields.<field>",value:...}, rationale:"<1 plain sentence why>", evidence:[]}. Only propose when evidence is strong and repeated.
- Return ONLY JSON: {"operations":[...], "proposals":[...]}`;

      let parsed;
      try {
        parsed = parseJsonLoose(await _gemini(prompt));
      } catch (e) {
        console.warn('[Librarian] extract LLM call failed:', e.message);
        return { ran: false, reason: e.message };
      }
      if (!parsed) return { ran: false, reason: 'unparseable' };

      const applied = { ADD: 0, UPDATE: 0, SUPERSEDE: 0, NOOP: 0 };
      for (const op of (parsed.operations || [])) {
        try {
          if (op.op === 'ADD' && op.record) {
            const rec = normalizeRecord(op.record, now);
            const shard = await DS().getMemoryShard(rec.scope);
            shard.push(rec);
            await DS().setMemoryShard(rec.scope, shard);
            applied.ADD++;
          } else if ((op.op === 'UPDATE' || op.op === 'NOOP' || op.op === 'SUPERSEDE') && op.id) {
            const target = existing.find(x => x.id === op.id);
            if (!target) continue;
            const shard = await DS().getMemoryShard(target.scope);
            const r = shard.find(x => x.id === op.id);
            if (!r) continue;
            if (op.op === 'NOOP') {
              r.occurrenceCount = (r.occurrenceCount || 1) + 1;
              r.updatedAt = now;
            } else if (op.op === 'UPDATE') {
              if (op.text) r.text = String(op.text).slice(0, 500);
              if (op.settings && typeof op.settings === 'object') r.settings = op.settings;
              r.occurrenceCount = (r.occurrenceCount || 1) + 1;
              r.confidence = Math.min(1, (r.confidence ?? 0.7) + 0.05);
              r.updatedAt = now;
            } else if (op.op === 'SUPERSEDE' && op.record) {
              const rec = normalizeRecord(op.record, now);
              r.status = 'superseded';
              r.supersededBy = rec.id;
              r.updatedAt = now;
              const destShard = rec.scope === target.scope ? shard : await DS().getMemoryShard(rec.scope);
              destShard.push(rec);
              if (rec.scope !== target.scope) await DS().setMemoryShard(rec.scope, destShard);
            }
            await DS().setMemoryShard(target.scope, shard);
            applied[op.op]++;
          }
        } catch (e) {
          console.warn('[Librarian] op apply failed:', e.message);
        }
      }

      await this._draftProposals(parsed.proposals || [], { suppressions, profile, now });

      await DS().patch('mine.episodicLog', (l) => { l.cursor = Math.max(l.cursor, lastId); return l; });
      await updateBadge();
      return { ran: true, applied, observations: pending.length };
    },

    // Gate + persist proposal drafts: suppression/cooldown filter, weekly
    // cap from metaPreferences, dedup against pending, plain-language pass
    // when the profile asks for it.
    async _draftProposals(drafts, { suppressions, profile, now }) {
      if (!drafts.length) return;
      const demoOn = demo.active();
      const props = await DS().get('mine.proposals');
      const weekAgo = now - 7 * 24 * 3600 * 1000;
      let weekCount = props.filter(p => p.createdAt > weekAgo).length;
      // Demo mode lifts the weekly cap and ignores suppressions so the beat
      // stays repeatable; normal use honors both.
      const cap = demoOn ? Infinity : (profile.metaPreferences?.maxProposalsPerWeek ?? 3);
      for (const d of drafts) {
        if (!d.aspect || !d.change) continue;
        if (weekCount >= cap) break;
        const sup = demoOn ? null : suppressions.find(s => s.aspect === d.aspect && (s.mode === 'permanent' || s.until > now));
        if (sup) continue;
        if (props.some(p => p.status === 'pending' && p.aspect === d.aspect)) continue;
        props.push({
          id: newId('prop'),
          aspect: d.aspect,
          aspectLabel: d.aspectLabel || d.aspect,
          change: d.change,
          rationale: String(d.rationale || '').slice(0, 300),
          evidence: d.evidence || [],
          status: 'pending',
          createdAt: now,
          respondedAt: null,
        });
        weekCount++;
      }
      await DS().set('mine.proposals', props);
    },

    // Daily consolidation. Deterministic where possible; LLM only for the
    // category playbooks. Idempotent — safe to re-run.
    async reflect() {
      const now = clock.now();
      const all = await kv.getAll();
      const shards = {};
      for (const [key, recs] of Object.entries(all)) {
        if (key.startsWith(MEMORY_PREFIX)) shards[key.slice(MEMORY_PREFIX.length)] = recs || [];
      }

      // 1. Promotion: same actionable setting active on >=3 origins of one
      //    category → category-scoped fact; origin copies superseded.
      const idx = await DS().get('mine.siteIndex');
      const bySettingAndCat = {};
      for (const [scope, recs] of Object.entries(shards)) {
        if (!scope.startsWith('origin:')) continue;
        const origin = scope.slice('origin:'.length);
        const cat = idx[origin]?.category || TAX().categoryForHost(origin);
        if (!cat) continue;
        for (const r of recs) {
          if (r.status !== 'active' || !r.settings) continue;
          for (const [k, v] of Object.entries(r.settings)) {
            const key = `${cat}|${k}|${JSON.stringify(v)}`;
            (bySettingAndCat[key] = bySettingAndCat[key] || []).push({ scope, record: r, cat, k, v });
          }
        }
      }
      let promoted = 0;
      for (const group of Object.values(bySettingAndCat)) {
        const distinctOrigins = new Set(group.map(g => g.scope));
        if (distinctOrigins.size < 3) continue;
        const { cat, k, v } = group[0];
        const catScope = `category:${cat}`;
        const catShard = await DS().getMemoryShard(catScope);
        if (catShard.some(r => r.status === 'active' && r.settings && JSON.stringify(r.settings[k]) === JSON.stringify(v))) continue;
        const rec = normalizeRecord({
          text: `Prefers ${k} = ${JSON.stringify(v)} on ${cat} sites (seen on ${distinctOrigins.size} sites)`,
          tier: 'preference', scope: catScope, kind: 'preference',
          importance: 6, confidence: 0.85, decayClass: 'slow',
          settings: { [k]: v }, source: 'reflection-promotion',
          occurrenceCount: group.length,
        }, now);
        catShard.push(rec);
        await DS().setMemoryShard(catScope, catShard);
        for (const g of group) {
          const shard = await DS().getMemoryShard(g.scope);
          const r = shard.find(x => x.id === g.record.id);
          if (r) { r.status = 'superseded'; r.supersededBy = rec.id; r.updatedAt = now; }
          await DS().setMemoryShard(g.scope, shard);
        }
        promoted++;
      }

      // 2. Hygiene: expire decayed task-tier facts; purge superseded >30d;
      //    expire stale pending proposals (14d, weak signal — no cooldown).
      let expired = 0, purged = 0;
      for (const [scope, recs] of Object.entries(shards)) {
        let dirty = false;
        const kept = [];
        for (const r of (await DS().getMemoryShard(scope))) {
          if (r.status === 'active' && r.tier === 'task' && now - (r.updatedAt || r.createdAt) > DECAY_HALF_LIFE.fast * 2) {
            r.status = 'expired'; r.updatedAt = now; dirty = true; expired++;
          }
          if ((r.status === 'superseded' || r.status === 'expired') && now - r.updatedAt > 30 * 24 * 3600 * 1000) {
            purged++; dirty = true; continue;
          }
          kept.push(r);
        }
        if (dirty) await DS().setMemoryShard(scope, kept);
      }
      await DS().patch('mine.proposals', (props) => {
        for (const p of props) {
          if (p.status === 'pending' && now - p.createdAt > 14 * 24 * 3600 * 1000) p.status = 'expired';
        }
        return props;
      });

      // Evidence-discard policy (Phase 2): raw observations already consumed
      // by extraction (id <= cursor) are dropped once they're 7+ days old —
      // the grounded facts (with their evidence ids) are what persists, not
      // the raw behavioral log. Unconsumed entries are never touched.
      let discarded = 0;
      await DS().patch('mine.episodicLog', (log) => {
        const cutoff = now - 7 * 24 * 3600 * 1000;
        const before = log.entries.length;
        log.entries = log.entries.filter(e => e.id > log.cursor || e.t > cutoff);
        discarded = before - log.entries.length;
        return log;
      });

      // 3. Materialized views: core block (deterministic) + per-category
      //    playbooks (LLM, only for categories with enough material).
      const profile = await getOrInitProfile();
      const generalShard = await DS().getMemoryShard('general');
      const topGeneral = generalShard
        .filter(r => r.status === 'active')
        .sort((a, b) => scoreRecord(b, now) - scoreRecord(a, now))
        .slice(0, 6);
      const coreLines = [
        `Support areas: ${profile.supportAreas.join(', ') || 'not specified'}.`,
        profile.freeText ? `In their words: ${profile.freeText}` : null,
        ...topGeneral.map(r => `- ${r.text}`),
      ].filter(Boolean);
      const views = await DS().get('mine.views');
      views.coreBlock = coreLines.join('\n');
      views.playbooks = views.playbooks || {};
      if (_gemini) {
        for (const cat of TAX().categoryIds()) {
          const recs = (await DS().getMemoryShard(`category:${cat}`)).filter(r => r.status === 'active');
          if (recs.length < 3) continue;
          try {
            const md = await _gemini(
              `Write a short markdown playbook (max 120 words, plain language) for helping this user on ${cat} websites, based on these memories:\n`
              + recs.map(r => `- ${r.text}`).join('\n')
              + `\nUser support areas: ${profile.supportAreas.join(', ')}. Output only the playbook markdown.`
            );
            if (md) views.playbooks[cat] = md.trim().slice(0, 1500);
          } catch { /* keep old playbook */ }
        }
      }
      views.renderedAt = now;
      await DS().set('mine.views', views);

      // 4. Invariant repair: clear dangling supersededBy pointers.
      for (const scope of Object.keys(shards)) {
        const recs = await DS().getMemoryShard(scope);
        const ids = new Set(recs.map(r => r.id));
        let dirty = false;
        for (const r of recs) {
          if (r.supersededBy && !ids.has(r.supersededBy)) { r.supersededBy = null; dirty = true; }
        }
        if (dirty) await DS().setMemoryShard(scope, recs);
      }

      await updateBadge();
      return { ran: true, promoted, expired, purged, discarded };
    },
  };

  // ---- scheduling -------------------------------------------------------------
  // Debounced extraction after observation bursts. The host process may die
  // before a setTimeout fires; the host's Scheduler jobs (see the chrome
  // adapter) are the guarantee, the timeout is the fast path.
  let _extractTimer = null;
  function scheduleExtraction() {
    if (_extractTimer) clearTimeout(_extractTimer);
    _extractTimer = setTimeout(() => {
      _extractTimer = null;
      Librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
    }, 20000);
  }

  async function updateBadge() {
    try {
      const pending = await Librarian.listProposals('pending');
      await notifier.pending(pending.length);
    } catch { /* notifier optional in some hosts */ }
  }

  return Librarian;
}
