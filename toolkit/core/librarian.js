// Librarian — the personal memory/profile agent. Sole writer of the
// Librarian-owned stores (mine.profile, mine.suppressions, mine.episodicLog,
// mine.proposals, mine.siteIndex, mine.views, memory shards). Everything
// else — popup, content script, onboarding, the browser agent — goes through
// the host's message handlers or calls the constructed Librarian directly
// from the same background context. Never write these stores elsewhere.
//
// Platform-agnostic: the engine touches no `chrome.*`, no `Date.now()`, no
// DOM. It depends only on injected ports — a `datastore`, the `taxonomy`, a
// `clock`, a `scheduler`, a `consent` channel, and a `demo` hook (see
// ../ports). The Chrome host wires these and assigns the result to
// `globalThis.Librarian` (adapters/chrome/librarian.entry.js). Gemini access
// is still injected post-construction via `setGeminiCaller`, the pre-existing
// seam (unchanged in this refactor).
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
// government — see taxonomy), paused origins, or while globally paused are
// dropped at logObservation, the single entry point. Profile-tier changes
// NEVER auto-apply: they become proposals the user accepts, declines ("not
// now" → cooldown), or suppresses — and a suppression is itself a preference
// the extraction pipeline consults before drafting.

import { noopDemo, noopConsent, noopScheduler } from '../ports/index.js';
import { coerceSettings, clampSettings } from './units.js';
import { STRENGTH_RANK, rankOf } from './strength.js';
import { toAbilityModel } from './ability.js';
import { memoryClassOf } from './memory-class.js';
import { GRANT_SCOPES, validateScopes, normalizeGrant, isActive, filterAbilityModelByScopes } from '../sync/grants.js';

/**
 * @param {Object} deps
 * @param {Object} deps.datastore   The Datastore facade (../core/datastore).
 * @param {Object} deps.taxonomy    The site taxonomy (../core/taxonomy).
 * @param {import('../ports/index.js').Clock} deps.clock
 * @param {import('../ports/index.js').Scheduler} [deps.scheduler]
 * @param {import('../ports/index.js').Consent} [deps.consent]
 * @param {import('../ports/index.js').DemoHook} [deps.demo]
 * @returns the Librarian.
 */
export function createLibrarian({
  datastore,
  taxonomy,
  clock,
  scheduler = noopScheduler,
  consent = noopConsent,
  demo = noopDemo,
}) {
  if (!datastore) throw new Error('createLibrarian: datastore is required');
  if (!taxonomy) throw new Error('createLibrarian: taxonomy is required');
  if (!clock) throw new Error('createLibrarian: clock port is required');

  const DS = () => datastore;
  const TAX = () => taxonomy;

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
    const age = now - (r.lastConfirmedAt || r.updatedAt || r.createdAt || now);
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

  // Coerce a settings object into the canonical units/ranges declared in the
  // registry's settingsMeta. Guards against LLM-written values in the wrong
  // unit — e.g. an extracted memory with `fontScale: 1.5` (a multiplier) when
  // the pipeline expects a percentage (`150`); applied raw, 1.5 / 100 collapses
  // the font. A value far below its range whose ×100 lands in range is treated
  // as a multiplier; everything is then clamped to range.
  function settingsMeta() {
    try { return DS().global.tools().settingsMeta || {}; } catch (_) { return {}; }
  }

  // INGEST normalizer — runs where untrusted/raw values enter (record writes,
  // LLM extract ops). Coerces to canonical units incl. the multiplier guess
  // (e.g. a model emitting fontScale:1.5 → 150) so nothing non-canonical is
  // ever stored.
  function sanitizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    return coerceSettings(settings, settingsMeta());
  }

  // READ/merge normalizer — clamp-only. The old `>10` %-vs-multiplier heuristic
  // used to run here on every read; now that writes coerce at ingest (and a
  // one-time migration normalized legacy data), the read path trusts the unit
  // tags and only bounds to range. This is the deleted read-side heuristic.
  function clampForRead(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    return clampSettings(settings, settingsMeta());
  }

  function normalizeRecord(raw, now) {
    const r = { ...raw };
    r.id = r.id || newId('mem');
    r.text = String(r.text || '').slice(0, 500);
    r.tier = ['profile', 'preference', 'site', 'task'].includes(r.tier) ? r.tier : 'preference';
    r.scope = VALID_SCOPE.test(r.scope || '') ? r.scope : 'general';
    r.kind = ['preference', 'procedural', 'suppression', 'rule', 'observation'].includes(r.kind) ? r.kind : 'preference';
    // Requirement strength (Phase 1): floor (a hard need — a screen-reader
    // user's needs, Marta's captions) > preference (a soft choice) > hint (a
    // weak nudge). Floors are applied so a narrower soft preference can't
    // silently drop them. Defaults to 'preference' so existing data is
    // unchanged.
    r.strength = ['floor', 'preference', 'hint'].includes(r.strength) ? r.strength : 'preference';
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
    // Decay is measured from last CONFIRMATION, not last surfacing: recall()
    // bumps lastAccessed on every navigation, which must NOT keep a
    // never-reconfirmed belief alive forever.
    r.lastConfirmedAt = r.lastConfirmedAt || r.createdAt || now;
    r.status = ['active', 'superseded', 'expired'].includes(r.status) ? r.status : 'active';
    r.supersededBy = r.supersededBy || null;
    r.source = r.source || 'inferred';
    // Reflection grounding (Phase 2): the episodic-log entry ids this derived
    // fact was distilled from. Lineage only — a separate id-space from a
    // proposal's `evidence` (which carries memory-record ids for the accept
    // confidence boost). Additive: absent on legacy records, defaults to []
    // (no migration). Capped so a long-lived record can't grow it unbounded.
    r.evidence = Array.isArray(r.evidence) ? r.evidence.slice(-20) : [];
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

    // The modality-agnostic AbilityModel view (../core/ability). Pure read,
    // fast lane — what a non-web surface (XR, ArtInsight) reads to derive its
    // own rendering. Today's profiles project to an empty `needs[]`.
    //
    // READ-ONLY by design: it must NOT materialize mine.profile. It runs on the
    // per-navigation effective-prefs hot path (via resolveWebPreferences); using
    // getOrInitProfile() would add a first-call write to sync storage and race
    // onboarding/popup. So we read the stored profile and, if absent, project
    // the legacy seed in-memory without persisting anything.
    async getAbilityModel() {
      let p = await DS().get('mine.profile');
      if (!p) {
        const legacy = await DS().get('mine.onboardingProfile');
        p = legacy
          ? { supportAreas: legacy.supportAreas || [], freeText: legacy.freeText || '', fields: {}, metaPreferences: {} }
          : null;
      }
      return toAbilityModel(p);
    },

    // User-initiated edit — bypasses the proposal gate by design (the gate
    // exists for *inferred* changes; explicit user intent needs no consent).
    async setProfileField(path, value) {
      return await DS().patch('mine.profile', async (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        const parts = String(path).split('.');
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
          rec.settings = sanitizeSettings({ [key]: value }); // coerce at the write boundary
          rec.text = text;
          rec.occurrenceCount = (rec.occurrenceCount || 1) + 1;
          rec.updatedAt = now;
          rec.lastAccessed = now;
          rec.lastConfirmedAt = now; // an explicit user re-set is a confirmation
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
    // background's classify handler fall through to Gemini for unknown hosts.
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
      // Strength gate: a stronger requirement (floor > preference > hint) is
      // never overwritten by a weaker one, regardless of scope specificity;
      // equal strength keeps the existing precedence (later assign wins). A
      // missing strength reads as 'preference', so today's all-preference data
      // merges byte-for-byte as before. (STRENGTH_RANK / rankOf are shared with
      // the surface derivations — see ./strength.js.)
      const strengthAt = {}; // key -> winning strength rank
      const assign = (src, scope, strength = 'preference') => {
        const clean = clampForRead(src) || {};
        const r = rankOf(strength);
        for (const [k, v] of Object.entries(clean)) {
          if (k in merged && r < (strengthAt[k] ?? STRENGTH_RANK.preference)) continue; // weaker: keep the stronger value
          merged[k] = v;
          provenance[k] = scope;
          strengthAt[k] = r;
        }
      };
      // Manual user choices (recordExplicitSetting) are deferred and applied
      // after everything else: a deliberate toggle must beat profiles and
      // learned records at any scope, or the user's change reverts on the
      // next page load.
      const explicit = [];
      // clampForRead bounds values to range on the way out; it trusts the unit
      // tags (writes coerce at ingest + the migration normalized legacy data),
      // so it no longer guesses multipliers here.
      const applyShard = (scope) => {
        const recs = (shards[scope] || [])
          .filter(r => r.status === 'active' && r.settings && conditionsMet(r, now))
          .sort((a, b) => (a.kind === 'rule') - (b.kind === 'rule')); // rules last
        for (const r of recs) {
          if (r.source === 'user-explicit') { explicit.push({ r, scope }); continue; }
          assign(r.settings, scope, r.strength);
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
        assign(r.settings, scope, r.strength);
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
          // _memoryClass is a derived CoALA label (episodic/semantic/procedural),
          // additive and non-persisted — see ./memory-class.js.
          facts.push({ ...r, _scope: s, _score: scoreRecord(r, now), _memoryClass: memoryClassOf(r) });
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

      return { block: lines.join('\n'), facts: top, profile, category, origin };
    },

    async listMemories(filter = {}) {
      const out = [];
      const shards = await DS().allMemoryShards();
      for (const [scope, recs] of Object.entries(shards)) {
        for (const r of (recs || [])) {
          if (filter.status && r.status !== filter.status) continue;
          if (filter.scope && scope !== filter.scope) continue;
          // memoryClass: derived CoALA label, additive (see ./memory-class.js).
          out.push({ ...r, scope, memoryClass: memoryClassOf(r) });
        }
      }
      const supp = await DS().get('mine.suppressions');
      return { memories: out, suppressions: supp };
    },

    async deleteMemory(id) {
      const shards = await DS().allMemoryShards();
      for (const [scope, recs] of Object.entries(shards)) {
        const idx = (recs || []).findIndex(r => r.id === id);
        if (idx >= 0) {
          recs.splice(idx, 1);
          await DS().setMemoryShard(scope, recs);
          return true;
        }
      }
      // Suppressions are deletable too (un-suppress).
      const removed = await DS().patch('mine.suppressions', (s) =>
        s.filter(x => x.id !== id));
      return Array.isArray(removed);
    },

    async listProposals(status = 'pending') {
      const props = await DS().get('mine.proposals');
      return status ? props.filter(p => p.status === status) : props;
    },

    // ====================== CROSS-APP GRANTS (Phase 3) ======================
    // A first-party app reads a scoped, modality-neutral slice of the
    // AbilityModel ONLY behind a grant the user approved and can see.
    // DEFAULT-DENY: no grant, no read. A request is NOT a grant — it is drafted
    // as an ordinary proposal through the SAME consent machinery (suppression /
    // cooldown / weekly cap), and only respondToProposal('accept') on the local
    // user surface mints the grant. The requesting app has no code path that
    // resolves its own request (sender-cannot-self-resolve, structurally).

    // Ask the user (via a proposal) for read access to `scopes` of the
    // AbilityModel. Validates against the closed GRANT_SCOPES whitelist; if an
    // active grant already covers every requested scope, does nothing. Returns
    // the pending proposal's id, or {ok:false} when rejected/suppressed.
    async requestGrant(appId, scopes, opts = {}) {
      appId = String(appId || '').trim();
      if (!appId) return { ok: false, reason: 'bad-app' };
      if (!validateScopes(scopes)) return { ok: false, reason: 'bad-scope' };
      const grants = (await DS().get('mine.grants')) || [];
      const existing = grants.find(g => g.appId === appId && isActive(g));
      if (existing && scopes.every(s => existing.scopes.includes(s))) {
        return { ok: false, reason: 'already-granted' };
      }
      const appLabel = String(opts.appLabel || appId).slice(0, 100); // bound like rationale; guards the sync quota
      const now = clock.now();
      const suppressions = await DS().get('mine.suppressions');
      const profile = await getOrInitProfile();
      // Reuse the existing draft gate: suppression / cooldown / weekly-cap /
      // dedup-against-pending all apply to a `grant:<appId>` aspect for free.
      await this._draftProposals([{
        aspect: `grant:${appId}`,
        aspectLabel: `let ${appLabel} read your ${scopes.join(', ')}`,
        change: { op: 'grant-request', appId, appLabel, scopes },
        rationale: String(opts.rationale
          || `${appLabel} wants to read part of your accessibility profile so it can adapt itself for you.`).slice(0, 300),
        evidence: [],
      }], { suppressions, profile, now });
      await updateBadge();
      // Reflect reality: the draft may have been dropped (suppressed/cooldown)
      // or deduped against an already-pending request for this app.
      const props = await DS().get('mine.proposals');
      const pending = props.find(p => p.status === 'pending'
        && p.aspect === `grant:${appId}` && p.change && p.change.op === 'grant-request');
      return pending ? { ok: true, proposalId: pending.id } : { ok: false, reason: 'suppressed' };
    },

    // The "what each app can see" panel's data: live (active) grants only —
    // revoke is a delete, so anything still stored is active.
    async listGrants() {
      const grants = (await DS().get('mine.grants')) || [];
      return grants.filter(isActive);
    },

    // Revoke = LOCAL DELETE (no tombstone, no propagation). Idempotent.
    async revokeGrant(appId) {
      appId = String(appId || '').trim();
      await DS().patch('mine.grants', (grants) => (grants || []).filter(g => g.appId !== appId));
      return { ok: true };
    },

    // Read-only, default-deny export of the granted AbilityModel slice. No
    // active grant for `appId` → no data. Never writes; never includes a
    // SurfaceProfile (web fontScale etc.) — only the modality-neutral,
    // categories-only AbilityModel, filtered to the grant's scopes.
    async exportAbilityModel(appId) {
      appId = String(appId || '').trim();
      const grants = (await DS().get('mine.grants')) || [];
      const grant = grants.find(g => g.appId === appId && isActive(g));
      if (!grant) return { ok: false, reason: 'no-grant' };
      const abilityModel = await this.getAbilityModel();
      return { ok: true, abilityModel: filterAbilityModelByScopes(abilityModel, grant.scopes) };
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
      // `let`, not `const`: the demo-mode fallback below reassigns this when an
      // agent-task arrives with no origin. (The original declared it `const`,
      // which only ever survived because that reassignment path is unreached
      // outside demo mode; esbuild's static check surfaced the latent bug.)
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
        // id must stay strictly above BOTH the last entry and the cursor. The
        // cursor floor matters once the evidence-discard prune (reflect) can
        // drop processed tail entries: without it, a pruned log could reissue an
        // id <= cursor, and extract (which only sees id > cursor) would silently
        // skip the new observation. Monotonic by construction.
        const lastId = log.entries.length ? log.entries[log.entries.length - 1].id : 0;
        const id = Math.max(lastId, log.cursor) + 1;
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
      if (demo.isOn() && obs.type === 'agent-task') {
        if (!origin) origin = 'youtube.com';
        if (!category) category = 'video';
      }
      const taskSucceeded = obs.data?.success
        || (demo.isOn() && obs.type === 'agent-task');
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
      if (exists && !demo.isOn()) return;
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
        } else if (prop.change?.op === 'grant-request') {
          // Cross-app read grant (Phase 3): minting a grant happens ONLY here,
          // on the local user surface accepting the request — never in the
          // requesting app's requestGrant. One grant per app (a re-grant with
          // wider scopes replaces the prior entry).
          const { appId, appLabel, scopes } = prop.change;
          await DS().patch('mine.grants', (grants) => {
            grants = (grants || []).filter(g => g.appId !== appId);
            grants.push(normalizeGrant({ id: newId('grant'), appId, appLabel, scopes, grantedAt: now }));
            return grants;
          });
        }
        // Validated inference → boost the evidence memories' confidence.
        for (const evId of (prop.evidence || [])) {
          const shards = await DS().allMemoryShards();
          for (const [scope, recs] of Object.entries(shards)) {
            const r = (recs || []).find(x => x.id === evId);
            if (r) { r.confidence = Math.min(1, (r.confidence ?? 0.7) + 0.1); r.lastConfirmedAt = now; await DS().setMemoryShard(scope, recs); }
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

## New observations (weight 3 = deliberate user action, 1 = ambient)
${JSON.stringify(pending.map(e => ({ type: e.type, weight: e.weight, origin: e.origin, category: e.category, text: e.text, data: e.data })), null, 1)}

## Existing memories (compare candidates against these)
${JSON.stringify(existing, null, 1)}

## Suppressed aspects (NEVER propose about these)
${JSON.stringify(activeSuppressed)}

Rules:
- Extract only durable, useful facts: preferences, repeated patterns, how-to knowledge. Ignore one-off low-weight noise (a single weight-1 event is exploration, not preference).
- scope: "general" | "category:<${TAX().categoryIds().join('|')}>" | "origin:<hostname>" | "context:<video|form|document>". Prefer the narrowest scope the evidence supports.
- For each candidate, compare to existing memories: same fact → {"op":"NOOP","id":<existing id>} (we bump its count); refines/strengthens → {"op":"UPDATE","id":...,"text":...,"settings":...}; CONFIDENTLY contradicts and should replace → {"op":"SUPERSEDE","id":...,"record":{...}}; the user did the OPPOSITE of an inferred record but you are NOT sure it's permanent → {"op":"CONTRADICT","id":<existing id>} (lowers its confidence, no replacement); genuinely new → {"op":"ADD","record":{...}}.
- record fields: text (one plain sentence), tier ("preference"|"site"|"task"), scope, kind ("preference"|"procedural"), importance 1-10, confidence 0-1, decayClass ("stable"|"slow"|"fast"), settings (object of extension setting keys like fontScale/darkMode/autoCaptions if directly actionable, else null).
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

      // Reflection grounding: the raw episodic entries this extraction batch
      // consumed. Every fact ADDed/UPDATEd/superseded in this run cites them as
      // its evidence (episodic-log id-space) so the evidence-discard policy can
      // later tell which raw observations a surviving fact still depends on.
      const evidenceIds = pending.map(e => e.id);

      const applied = { ADD: 0, UPDATE: 0, SUPERSEDE: 0, NOOP: 0, CONTRADICT: 0 };
      for (const op of (parsed.operations || [])) {
        try {
          if (op.op === 'ADD' && op.record) {
            const rec = normalizeRecord({ ...op.record, evidence: evidenceIds }, now);
            const shard = await DS().getMemoryShard(rec.scope);
            shard.push(rec);
            await DS().setMemoryShard(rec.scope, shard);
            applied.ADD++;
          } else if ((op.op === 'UPDATE' || op.op === 'NOOP' || op.op === 'SUPERSEDE' || op.op === 'CONTRADICT') && op.id) {
            const target = existing.find(x => x.id === op.id);
            if (!target) continue;
            const shard = await DS().getMemoryShard(target.scope);
            const r = shard.find(x => x.id === op.id);
            if (!r) continue;
            if (op.op === 'NOOP') {
              r.occurrenceCount = (r.occurrenceCount || 1) + 1;
              r.lastConfirmedAt = now; // a repeat sighting reconfirms the belief
              r.evidence = [...new Set([...(r.evidence || []), ...evidenceIds])].slice(-20);
              r.updatedAt = now;
            } else if (op.op === 'UPDATE') {
              if (op.text) r.text = String(op.text).slice(0, 500);
              if (op.settings && typeof op.settings === 'object') r.settings = sanitizeSettings(op.settings); // coerce LLM output at ingest
              r.occurrenceCount = (r.occurrenceCount || 1) + 1;
              r.confidence = Math.min(1, (r.confidence ?? 0.7) + 0.05);
              r.lastConfirmedAt = now; // a refinement reconfirms the belief
              r.evidence = [...new Set([...(r.evidence || []), ...evidenceIds])].slice(-20);
              r.updatedAt = now;
            } else if (op.op === 'CONTRADICT') {
              // The user did the OPPOSITE of an inferred belief but not
              // confidently enough to replace it: LOWER confidence. The engine
              // must be able to grow LESS sure of a contradicted value, not only
              // ever more sure. Disconfirmation — so NO occurrenceCount or
              // lastConfirmedAt bump.
              r.confidence = Math.max(0, (r.confidence ?? 0.7) - 0.2);
              r.updatedAt = now;
            } else if (op.op === 'SUPERSEDE' && op.record) {
              if (r.strength === 'floor') {
                // A hard need (a screen-reader user's needs, Marta's captions) is
                // never auto-retired by one LLM-judged contradiction — downgrade
                // to a confidence drop instead of superseding it away.
                r.confidence = Math.max(0, (r.confidence ?? 0.7) - 0.2);
                r.updatedAt = now;
              } else {
                const rec = normalizeRecord({ ...op.record, evidence: evidenceIds }, now);
                r.status = 'superseded';
                r.supersededBy = rec.id;
                r.updatedAt = now;
                const destShard = rec.scope === target.scope ? shard : await DS().getMemoryShard(rec.scope);
                destShard.push(rec);
                if (rec.scope !== target.scope) await DS().setMemoryShard(rec.scope, destShard);
              }
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
      const demoOn = demo.isOn();
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
      const shards = await DS().allMemoryShards();

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
          // Transitive grounding: a promoted category fact inherits the episodic
          // evidence of the origin records it consolidates, so its lineage to raw
          // observations survives even after those origin copies are superseded.
          evidence: [...new Set(group.flatMap(g => g.record.evidence || []))].slice(-20),
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
      // NOTE: hygiene ages off `updatedAt` (the GC / last-touched clock) on
      // purpose — distinct from `lastConfirmedAt` (the belief clock that drives
      // decay/recall ranking). They are intentionally separate: a CONTRADICT
      // lowers a belief's recall score without resetting its GC lifetime, and a
      // supersede's purge timer keys off when it was retired. Don't collapse them.
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
      // 3b. Behavior-summary view (deterministic, NO LLM — works offline and is
      //     demo-reliable). A lossy, human-facing digest of HOW the user adapts
      //     pages, deliberately distinct from the lossless fact store: counts by
      //     memory class, the settings they most consistently choose, and the
      //     site categories they adapt. Naive LLM summarization drops ~20% of
      //     facts, so the digest is derived, the shards stay the source of truth.
      // Read the CURRENT shard set (not the stale `shards` snapshot from the
      // top of reflect): a fact promotion just created in step 1 should be
      // counted in this run's digest, not only the next one.
      const summaryShards = await DS().allMemoryShards();
      const activeRecs = [];
      for (const [scope, recs] of Object.entries(summaryShards)) {
        for (const r of (recs || [])) {
          if (r.status === 'active') activeRecs.push({ ...r, _scope: scope });
        }
      }
      const classCounts = { episodic: 0, semantic: 0, procedural: 0 };
      const settingTally = {};       // key -> { JSON(value) -> count }
      const categoriesAdapted = new Set();
      for (const r of activeRecs) {
        classCounts[memoryClassOf(r)]++;
        if (r._scope.startsWith('category:')) categoriesAdapted.add(r._scope.slice('category:'.length));
        for (const [k, v] of Object.entries(r.settings || {})) {
          (settingTally[k] = settingTally[k] || {});
          const vk = JSON.stringify(v);
          settingTally[k][vk] = (settingTally[k][vk] || 0) + 1;
        }
      }
      // Modal value per setting key, most-used first.
      const topSettings = Object.entries(settingTally).map(([key, vals]) => {
        const [vk, count] = Object.entries(vals).sort((a, b) => b[1] - a[1])[0];
        return { key, value: JSON.parse(vk), count };
      }).sort((a, b) => b.count - a.count).slice(0, 8);
      const reflectLog = await DS().get('mine.episodicLog');
      const pendingObs = reflectLog.entries.filter(e => e.id > reflectLog.cursor).length;
      // The line reports semantic + procedural only: episodic memory lives in
      // the LOG, not the shards (a consolidated record is never kind
      // 'observation'), so classCounts.episodic is structurally 0 here — the
      // episodic dimension surfaces instead as `pendingObservations`.
      const summaryLines = [
        `Tracking ${activeRecs.length} consolidated ${activeRecs.length === 1 ? 'memory' : 'memories'}`
        + ` (${classCounts.semantic} preference, ${classCounts.procedural} how-to)`
        + (pendingObs ? `; ${pendingObs} new observation${pendingObs === 1 ? '' : 's'} awaiting consolidation.` : '.'),
      ];
      if (topSettings.length) {
        summaryLines.push('Most consistent adaptations:');
        for (const s of topSettings) summaryLines.push(`- ${s.key} = ${JSON.stringify(s.value)} (${s.count}×)`);
      }
      if (categoriesAdapted.size) {
        summaryLines.push(`Site-specific adaptations on: ${[...categoriesAdapted].sort().join(', ')}.`);
      }
      views.behaviorSummary = {
        text: summaryLines.join('\n'),
        counts: { ...classCounts, pendingObservations: pendingObs },
        topSettings,
        categories: [...categoriesAdapted].sort(),
        renderedAt: now,
      };

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

      // 5. Evidence-discard policy (the XR note "store all observations →
      //    validate → discard evidence"). Once an observation has been
      //    consolidated, the raw episodic entry is redundant with the grounded
      //    fact — UNLESS a surviving fact still cites it. So we drop a processed
      //    entry (id <= cursor) only when it is (a) past a 7-day grace AND (b)
      //    not cited by any ACTIVE record's evidence[]. Unprocessed entries
      //    (id > cursor) are always kept; the 500-cap on write is the hard
      //    backstop. Runs LAST so it sees the post-promotion/hygiene shard state:
      //    a superseded origin copy no longer cites its evidence, but the
      //    promoted category fact that inherited that evidence still does.
      // Scan the CURRENT shard set, not the stale `shards` snapshot from the top
      // of reflect(): promotion (step 1) may have just created a new category
      // shard whose promoted fact carries inherited evidence. Missing that scope
      // here would wrongly discard raw entries a live fact still grounds — and
      // discard is destructive, so completeness matters.
      const cited = new Set();
      const freshShards = await DS().allMemoryShards();
      for (const recs of Object.values(freshShards)) {
        for (const r of (recs || [])) {
          if (r.status === 'active' && Array.isArray(r.evidence)) {
            for (const id of r.evidence) cited.add(id);
          }
        }
      }
      const grace = DECAY_HALF_LIFE.fast; // ~7 days
      let discarded = 0;
      await DS().patch('mine.episodicLog', (log) => {
        const before = log.entries.length;
        log.entries = log.entries.filter(e =>
          e.id > log.cursor            // unprocessed: always keep
          || cited.has(e.id)           // still grounds a live fact: keep its lineage
          || (now - e.t) < grace);     // within the grace window: keep
        discarded = before - log.entries.length;
        return log;
      });

      await updateBadge();
      return { ran: true, promoted, expired, purged, discarded };
    },
  };

  // ---- scheduling -------------------------------------------------------------
  // Debounced extraction after observation bursts + periodic safety nets.
  // The host background may die before the debounce fires; the periodic jobs
  // are the guarantee, the debounce is the fast path.
  function scheduleExtraction() {
    scheduler.debounce('aaLibrarianExtract', 20000, () => {
      Librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
    });
  }

  async function updateBadge() {
    try {
      const pending = await Librarian.listProposals('pending');
      await consent.notifyPending(pending.length);
    } catch { /* no consent surface in some contexts */ }
  }

  // Periodic safety nets: drain the log every 30 min, consolidate daily.
  scheduler.every('aaLibrarianExtract', 30, () => {
    Librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
  });
  scheduler.every('aaLibrarianReflect', 60 * 24, () => {
    Librarian.reflect().catch(e => console.warn('[Librarian] reflect failed:', e.message));
  });

  return Librarian;
}

export default createLibrarian;
