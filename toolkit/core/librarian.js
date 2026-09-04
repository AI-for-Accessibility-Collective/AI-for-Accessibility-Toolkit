// @ts-nocheck
// FLAG(review): 276 errors under toolkit/tsconfig.json's strict check at the
// time this header was added. Type declarations still emit from this file;
// remove these lines and fix the errors to opt it into the check.
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
// `globalThis.Librarian` (platforms/chrome/librarian.entry.js). Gemini access
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
import { GRANT_SCOPES, validateScopes, normalizeGrant, isActive, filterAbilityModelByScopes,
  audienceAllowed, recordShareAudit } from '../sync/grants.js';
import { buildProfileBlob, validateProfileBlob } from '../sync/blob.js';
import { resolveSkill, matchSkill, matchSkillToNeed, validateSkill } from './skill.js';
import { buildSkill } from './skill-builder.js';

/**
 * @param {Object} deps
 * @param {ReturnType<typeof import('./datastore.js').createDatastore>} deps.datastore   The Datastore facade (../core/datastore).
 * @param {import('./taxonomy.js').Taxonomy} deps.taxonomy    The site taxonomy (../core/taxonomy).
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

  // The explicit types are for the declaration emitter: with `lib` at ES2022
  // only, the checker does not know the URL global, so without them the
  // `origin` fields in types/core/librarian.d.ts fall back to `any`.
  /**
   * @param {string|null|undefined} url
   * @returns {string|null}
   */
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
  // ---- note helpers ------------------------------------------------------
  // `kind` value that marks a record as prose-primary; see addNote for why a
  // note carries no `settings`.
  const NOTE_KIND = 'note';
  const NOTE_TEXT_MAX = 500; // normalizeRecord's own cap — stated here so the
                             // truncation is visible at the call site too.

  // Topics are filing labels, not content: lower-cased, non-word runs collapsed
  // to a single dash. Returns null for anything that normalizes to nothing, so
  // `topic: '???'` files as untopiced rather than as a record with a junk aspect.
  function normalizeTopic(topic) {
    const t = String(topic == null ? '' : topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return t ? t.slice(0, 40) : null;
  }

  // The outward shape of a note. Deliberately NOT the raw record: callers get
  // prose plus its filing, never the scoring internals (decayClass, evidence,
  // supersededBy) that are the engine's business.
  function toNote(r, scope) {
    return {
      id: r.id,
      text: r.text,
      topic: r.aspect && r.aspect.startsWith('note.') ? r.aspect.slice(5) : null,
      scope,
      source: r.source,
      writer: r.writer || 'person', // who wrote it: person | agent | import (issue #6)
      importance: r.importance,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      occurrenceCount: r.occurrenceCount,
    };
  }

  // Query words worth matching on. Short function words are dropped so a query
  // like "I have trouble with small text" ranks on trouble/small/text rather
  // than matching every note that contains "with".
  const NOTE_STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from',
    'have', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'so', 'that',
    'the', 'to', 'up', 'was', 'we', 'when', 'with', 'you', 'your',
  ]);
  function tokenizeQuery(query) {
    return String(query == null ? '' : query).toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1 && !NOTE_STOPWORDS.has(t));
  }

  // Fraction of query terms present in `text`, plus which ones — returned so a
  // caller (or a person reading a debug dump) can see WHY a note ranked, rather
  // than being handed an opaque number. Prefix matching catches the common
  // plural/tense case ("read" ~ "reading") without a stemmer.
  function matchTerms(text, terms) {
    if (!terms.length) return { score: 1, matched: [] };
    const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const matched = terms.filter(t => words.some(w => w === t || w.startsWith(t) || t.startsWith(w)));
    return { score: matched.length / terms.length, matched };
  }

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

  // A cross-app `profile-set` may only touch `fields.*`, and every dot-segment
  // must be a plain identifier — never a prototype slot. This is the gate half
  // of the prototype-pollution defense (the sink half lives in setProfileField).
  const PROTO_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
  function isSafeFieldsPath(path) {
    if (typeof path !== 'string') return false;
    const parts = path.split('.');
    if (parts.length < 2 || parts[0] !== 'fields') return false;
    return parts.every(seg => /^[A-Za-z0-9_]+$/.test(seg) && !PROTO_SEGMENTS.has(seg));
  }

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
    // 'note' = prose the person wrote about themselves (see addNote). It is
    // the one kind that carries no `settings`, which is what keeps it out of
    // getEffectivePreferences.
    r.kind = ['preference', 'procedural', 'suppression', 'rule', 'observation', 'note'].includes(r.kind) ? r.kind : 'preference';
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
    // Global cross-app OFF switch (Phase 3): checked FIRST in every cross-app
    // entry point (requestGrant / exportAbilityModel / importInsight). Local
    // single-device operation is unaffected. Absent on older profiles → falsy
    // → sharing allowed (the per-app default-deny grant gate is the floor).
    sharingPaused: false,
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
      return await this.setProfileFields({ [path]: value });
    },

    // Set SEVERAL profile paths in ONE write. Every profile field lives in the
    // single `mine.profile` record, so N calls to setProfileField are N
    // read-modify-write round trips against the same document, and a caller
    // that loses the connection halfway through leaves a profile describing a
    // person who does not exist: cleared needs next to the support areas that
    // derived them, or a vision kind the needs no longer match. Anything that
    // must land together (onboarding writes four fields from one form) belongs
    // in one call, where the record is written once or not at all. Paths are
    // the same dotted strings setProfileField takes.
    async setProfileFields(fields) {
      // Prototype-pollution guard at the SINK: no path segment may name a
      // prototype slot, so neither the local extract profile-set path nor a
      // cross-app insight can walk into Object.prototype. A poisoned path is
      // silently dropped rather than thrown at the caller, and the clean paths
      // beside it still apply.
      // A plain object, or nothing happens. Object.entries() accepts a string
      // and enumerates its CHARACTERS, so a caller that passed a path where a
      // map belongs used to write `{0:'a',1:'b',...}` into the profile and get
      // a success back. Arrays enumerate their indices the same way. Neither is
      // a field map, and quietly storing junk under numeric keys is worse than
      // doing nothing.
      if (fields != null && (typeof fields !== 'object' || Array.isArray(fields))) {
        throw new TypeError('setProfileFields expects an object of path -> value');
      }
      const writes = Object.entries(fields || {})
        .map(([path, value]) => [String(path).split('.'), value])
        .filter(([parts]) => !parts.some(seg => seg === '__proto__' || seg === 'prototype' || seg === 'constructor'));
      // Nothing left to write: read, do not touch updatedAt. A dropped path
      // must not look like an edit.
      if (!writes.length) return await DS().get('mine.profile');
      return await DS().patch('mine.profile', async (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        for (const [parts, value] of writes) {
          let obj = p;
          for (let i = 0; i < parts.length - 1; i++) {
            if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] == null
              || !Object.prototype.hasOwnProperty.call(obj, parts[i])) obj[parts[i]] = {};
            obj = obj[parts[i]];
          }
          obj[parts[parts.length - 1]] = value;
        }
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
      // Who is writing this? 'person' (a real user action) vs 'agent' (a
      // Controller/verifier/insight loop) vs 'import'. Strength stays 'user
      // -explicit'/confidence 1 — this only lets review surfaces and the proposal
      // budget tell them apart (issue #6). Defaults to 'person'.
      const writer = ['person', 'agent', 'import'].includes(opts.writer) ? opts.writer : 'person';
      // A caller-supplied scopeLabel is user-facing record text; ensure it is
      // separated from the sentence (the built-in fallbacks already lead with a
      // space, a caller's "everywhere" would not) — issue #5.
      const label = opts.scopeLabel;
      const where = (label != null && label !== '')
        ? (/^\s/.test(String(label)) ? String(label) : ' ' + label)
        : (scope === 'general' ? '' :
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
          rec.writer = writer;
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
          rec.writer = writer;
          shard.push(rec);
        }
        ids.push(rec.id);
      }
      await DS().setMemoryShard(scope, shard);
      return ids;
    },

    // Whether a durable user-explicit record for `setting.<key>` exists at
    // `scope`. Lets a caller (e.g. voice undo) tell whether a write CREATED a
    // record or updated an existing one.
    async hasScopedSetting(scope, key) {
      scope = VALID_SCOPE.test(scope || '') ? scope : 'general';
      const shard = await DS().getMemoryShard(scope);
      const aspect = `setting.${key}`;
      return shard.some(r => r.source === 'user-explicit' && r.aspect === aspect && r.status === 'active');
    },

    // The current value of the user-explicit `setting.<key>` record at `scope`,
    // or undefined if none. Lets voice undo verify a record it created still
    // holds the value it wrote before deleting it (so a later re-confirmation
    // via the popup isn't blown away).
    async getScopedSetting(scope, key) {
      scope = VALID_SCOPE.test(scope || '') ? scope : 'general';
      const shard = await DS().getMemoryShard(scope);
      const aspect = `setting.${key}`;
      const rec = shard.find(r => r.source === 'user-explicit' && r.aspect === aspect && r.status === 'active');
      return rec && rec.settings ? rec.settings[key] : undefined;
    },

    // Delete the durable user-explicit record for `setting.<key>` at `scope` —
    // the true inverse of recordScopedSettings (which only ever upserts). Used
    // to UNDO a change that created a record: restoring the old value would
    // leave a shadowing record behind, so a created record is removed outright.
    // Returns { removed } (idempotent).
    async removeScopedSetting(scope, key) {
      scope = VALID_SCOPE.test(scope || '') ? scope : 'general';
      const aspect = `setting.${key}`;
      const shard = await DS().getMemoryShard(scope);
      const next = shard.filter(r => !(r.source === 'user-explicit' && r.aspect === aspect && r.status === 'active'));
      if (next.length === shard.length) return { removed: false };
      await DS().setMemoryShard(scope, next);
      return { removed: true };
    },

    // "Forget what I've changed, go back to my profile."
    //
    // undoLast is LIFO and per-session; resetUndo clears a journal without
    // restoring anything. Neither answers "start again from who I am" — and
    // that is the point of an ability model: once a session has drifted through
    // a dozen spoken adjustments there must be a way back to the person.
    //
    // Drops the durable `user-explicit` records for `setting.*` — the tier that
    // gets FINAL say in getEffectivePreferences (see the `explicit` deferral
    // there) — so the next read re-derives from the profile and learned records
    // alone. Nothing else is touched: notes, non-setting explicit records, and
    // every weaker tier survive; this forgets deliberate overrides, not the
    // person.
    //
    // @param {{scope?: string, url?: string, contexts?: string[]}} [opts]
    //   scope — limit to one scope ('general' | 'category:x' | 'origin:x' |
    //   'context:x' | 'tool:x'); omit to reset EVERY scope.
    //   url/contexts — what to compute the returned `restored` view for.
    // @returns {{forgotten: Array<{scope,key,value}>, scopes: string[], restored: object}}
    async resetToProfile(opts = {}) {
      // No scope means every scope. A scope that is supplied but invalid
      // narrows to 'general', the same as every other scope writer here; it
      // must never widen a scoped reset into a reset of everything.
      const only = opts.scope ? (VALID_SCOPE.test(opts.scope) ? opts.scope : 'general') : null;
      const shards = only
        ? { [only]: await DS().getMemoryShard(only) }
        : await DS().allMemoryShards();

      const forgotten = [];
      const touched = [];
      for (const [scope, recs] of Object.entries(shards || {})) {
        const keep = [];
        let dirty = false;
        for (const r of recs || []) {
          const isExplicitSetting = r && r.status === 'active' && r.source === 'user-explicit'
            && typeof r.aspect === 'string' && r.aspect.startsWith('setting.');
          if (!isExplicitSetting) { keep.push(r); continue; }
          const key = r.aspect.slice('setting.'.length);
          forgotten.push({ scope, key, value: r.settings ? r.settings[key] : undefined });
          dirty = true;
        }
        if (dirty) { await DS().setMemoryShard(scope, keep); touched.push(scope); }
      }

      // getEffectivePreferences computes on read, so dropping the records IS the
      // recompute; this returns the profile-derived view the person gets back.
      const restored = await this.getEffectivePreferences(opts.url || null, opts.contexts || []);
      return { forgotten, scopes: touched, restored };
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
      // Notes are the person's own words; the rest of `top` is the engine's
      // sentences about them ("You set fontScale to 150."). Keeping them in
      // separate sections stops a prompt from reading as though the system
      // said what the person said.
      const noteHits = top.filter(f => f.kind === NOTE_KIND);
      if (noteHits.length) {
        lines.push('### In their own words');
        for (const f of noteHits) lines.push(`- ${f.text}`);
      }
      const byScope = (pred, title) => {
        const hits = top.filter(f => f.kind !== NOTE_KIND).filter(pred);
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

    // ---- Natural-language notes ------------------------------------------
    //
    // What the person SAYS about their own needs, kept as prose. Everything
    // else the Librarian stores is machine-actionable (`settings`) or derived
    // from an inference; a note is neither. It is the "in their words" half of
    // the profile, which until now existed only as the single `profile.freeText`
    // string that onboarding overwrote each time.
    //
    // A note is a memory record like any other — same shards, same scope chain,
    // same decay/supersede machinery — distinguished by `kind: 'note'` and by
    // carrying NO `settings`. That absence is load-bearing: getEffectivePreferences
    // filters on `r.settings`, so a note can never leak into what gets applied
    // to a page. A note describes; it never actuates.
    //
    // DEVICE-LOCAL BY DESIGN. Notes are deliberately absent from GRANT_SCOPES
    // and from the AbilityModel, for the same reason `freeText` and `confidence`
    // are never exported (toolkit/sync/grants.js): free-form text is the hardest
    // thing to scope-limit once it has left. exportAbilityModel cannot reach a
    // note today, and adding a scope for one should be a deliberate, separate
    // decision — not a side effect of this API existing.

    // Store one note. `text` is the person's own words; everything in `opts`
    // is about filing it, not rewriting it.
    //   scope  — where it applies: general | category:<id> | origin:<host> |
    //            context:<id> (same chain as every other record).
    //   topic  — a short slug ('vision', 'reading', 'fatigue'). Notes sharing a
    //            topic AND scope are ONE note, updated in place, so re-answering
    //            "tell me about your vision" refines rather than accumulates.
    //            Omit it for a standalone note that should just pile up.
    //   source — 'user-explicit' (default: they wrote it) vs anything else,
    //            which reads as inferred and respects the memory pause.
    async addNote(text, opts = {}) {
      const body = String(text == null ? '' : text).trim();
      if (!body) return { ok: false, reason: 'empty-text' };
      const scope = VALID_SCOPE.test(opts.scope || '') ? opts.scope : 'general';
      const source = String(opts.source || 'user-explicit');
      const writer = ['person', 'agent', 'import'].includes(opts.writer) ? opts.writer : 'person'; // who wrote it (issue #6)
      // The pause is a floor for INFERENCE, never for direct user statements —
      // the same rule recordScopedSettings follows. A person typing a sentence
      // about themselves while memory is paused meant to type it.
      if (source !== 'user-explicit') {
        const profile = await getOrInitProfile();
        if (profile.memoryPaused) return { ok: false, reason: 'paused' };
      }
      const topic = normalizeTopic(opts.topic);
      const now = clock.now();
      const shard = await DS().getMemoryShard(scope);
      const aspect = topic ? `note.${topic}` : null;

      // Same-topic, same-scope note is a refinement, not a second opinion.
      let rec = aspect
        ? shard.find(r => r.kind === NOTE_KIND && r.aspect === aspect && r.status === 'active')
        : null;
      if (rec) {
        rec.text = body.slice(0, NOTE_TEXT_MAX);
        rec.writer = writer;
        rec.occurrenceCount = (rec.occurrenceCount || 1) + 1;
        rec.updatedAt = now;
        rec.lastAccessed = now;
        rec.lastConfirmedAt = now; // restating it is confirming it
        if (opts.importance != null) rec.importance = Math.min(10, Math.max(1, Number(opts.importance) || 5));
      } else {
        rec = normalizeRecord({
          kind: NOTE_KIND, tier: 'profile', scope, aspect,
          source,
          // A person's account of themselves does not go stale the way an
          // inferred preference does, so it decays only if something inferred it.
          decayClass: source === 'user-explicit' ? 'stable' : 'slow',
          confidence: source === 'user-explicit' ? 1 : 0.7,
          importance: opts.importance != null ? opts.importance : 6,
          settings: null,
          text: body,
        }, now);
        rec.writer = writer;
        shard.push(rec);
      }
      await DS().setMemoryShard(scope, shard);
      return { ok: true, id: rec.id, note: toNote(rec, scope) };
    },

    // Browse what is stored. Filters compose (all must match); omit them all
    // for every note at every scope.
    async listNotes(filter = {}) {
      const wantTopic = normalizeTopic(filter.topic);
      const status = filter.status === undefined ? 'active' : filter.status;
      const out = [];
      for (const [scope, recs] of Object.entries(await DS().allMemoryShards())) {
        for (const r of (recs || [])) {
          if (r.kind !== NOTE_KIND) continue;
          if (status && r.status !== status) continue;
          if (filter.scope && scope !== filter.scope) continue;
          if (wantTopic && r.aspect !== `note.${wantTopic}`) continue;
          if (filter.source && r.source !== filter.source) continue;
          out.push(toNote(r, scope));
        }
      }
      // Newest first: for prose, "what did I say most recently" beats any
      // relevance ordering when no query was asked.
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out;
    },

    // Re-file or reword one note. Only the keys present in `patch` change.
    // Moving a note's scope moves it between shards, since scope IS the shard.
    async updateNote(id, patch = {}) {
      const shards = await DS().allMemoryShards();
      for (const [scope, recs] of Object.entries(shards)) {
        const rec = (recs || []).find(r => r.id === id && r.kind === NOTE_KIND);
        if (!rec) continue;
        const now = clock.now();
        if (patch.text != null) {
          const body = String(patch.text).trim();
          if (!body) return { ok: false, reason: 'empty-text' };
          rec.text = body.slice(0, NOTE_TEXT_MAX);
          rec.lastConfirmedAt = now;
        }
        if (patch.topic !== undefined) {
          const t = normalizeTopic(patch.topic);
          rec.aspect = t ? `note.${t}` : null;
        }
        if (patch.importance != null) rec.importance = Math.min(10, Math.max(1, Number(patch.importance) || 5));
        if (patch.status && ['active', 'superseded', 'expired'].includes(patch.status)) rec.status = patch.status;
        rec.updatedAt = now;

        const target = patch.scope !== undefined && VALID_SCOPE.test(patch.scope || '') ? patch.scope : scope;
        if (target !== scope) {
          await DS().setMemoryShard(scope, recs.filter(r => r.id !== id));
          const dest = await DS().getMemoryShard(target);
          rec.scope = target;
          dest.push(rec);
          await DS().setMemoryShard(target, dest);
        } else {
          await DS().setMemoryShard(scope, recs);
        }
        return { ok: true, note: toNote(rec, target) };
      }
      return { ok: false, reason: 'not-found' };
    },

    // Forget one note outright. Restricted to notes by id, so a stray call
    // can never delete a preference record that happens to share an id space.
    async deleteNote(id) {
      const shards = await DS().allMemoryShards();
      for (const [scope, recs] of Object.entries(shards)) {
        const idx = (recs || []).findIndex(r => r.id === id && r.kind === NOTE_KIND);
        if (idx >= 0) {
          recs.splice(idx, 1);
          await DS().setMemoryShard(scope, recs);
          return { ok: true, removed: true };
        }
      }
      return { ok: false, removed: false, reason: 'not-found' };
    },

    // Query the prose. Ranking is LEXICAL, not semantic: word overlap with the
    // query, weighted by the same recency x importance x confidence score every
    // other record is ranked by, plus a bump for notes filed at a scope that
    // matches `opts.url`. No model call, so it is deterministic, offline, and
    // testable — but it will miss a paraphrase that shares no words ("tiny
    // print" vs "small text"). A caller that wants semantic matching should
    // rank `listNotes()` itself.
    //
    //   opts.url / opts.contexts — restrict + boost by the page's scope chain
    //   opts.scope               — restrict to exactly one scope
    //   opts.limit               — default 10
    async findNotes(query, opts = {}) {
      const asked = String(query == null ? '' : query).trim() !== '';
      const terms = tokenizeQuery(query);
      // A query that was asked but reduced to nothing rankable ("the and with")
      // is NOT the same as no query at all. Returning everything for it would
      // read as a match; returning nothing is the honest answer.
      if (asked && !terms.length) return [];
      const now = clock.now();
      const limit = Math.max(1, Math.min(100, Number(opts.limit) || 10));

      // With a url, search exactly the scope chain that applies to that page
      // (general -> context -> category -> origin) — the same chain recall and
      // the preference merge walk, so a note is findable in precisely the
      // places it would have been surfaced. Without one, every scope is fair game.
      let pool;
      if (opts.url) {
        const { shards } = await loadScopeShards(opts.url, opts.contexts || []);
        pool = shards;
      } else {
        pool = await DS().allMemoryShards();
      }
      if (opts.scope) pool = { [opts.scope]: await DS().getMemoryShard(opts.scope) };

      const hits = [];
      for (const [scope, recs] of Object.entries(pool)) {
        for (const r of (recs || [])) {
          if (r.kind !== NOTE_KIND || r.status !== 'active') continue;
          const { score: overlap, matched } = matchTerms(r.text, terms);
          if (terms.length && !matched.length) continue;
          const base = scoreRecord(r, now);
          const specific = scope === 'general' ? 1 : 1.25; // a note filed here beats a general one
          hits.push({
            ...toNote(r, scope),
            score: (terms.length ? overlap : 1) * base * specific,
            matched,
          });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
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

    /**
     * @param {import('./skill.js').Skill} skill
     * @returns {ReturnType<typeof resolveSkill>}
     */
    // Compile a skill to the deterministic apply-plan (settings + adapter ids)
    // the host's adapter layer consumes. No LLM at apply-time.
    // FLAG(review): the typed block above is for the declaration emitter and
    // sits above this line comment so scripts/introspect.mjs, which reads the
    // // lines directly above a method, still finds this description. The
    // file is opted out of the check, and @ts-nocheck also silences the error
    // tsc raises when an inferred type cannot be named from another module,
    // so without the block types/core/librarian.d.ts wrote a bare
    // SkillRecipeAction that no consumer could resolve.
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
      // Anchor to the partition active at entry: if the acting user switches
      // while this runs, fail safe rather than drafting into the wrong
      // partition (CLAUDE.md tradeoff #2).
      const partitionAt = DS().getActingUser().id;
      const profile = await getOrInitProfile();
      if (profile.sharingPaused) return { ok: false, reason: 'sharing-paused' };
      const grants = (await DS().get('mine.grants')) || [];
      const existing = grants.find(g => g.appId === appId && isActive(g));
      if (existing && scopes.every(s => existing.scopes.includes(s))) {
        return { ok: false, reason: 'already-granted' };
      }
      const appLabel = String(opts.appLabel || appId).slice(0, 100); // bound like rationale; guards the sync quota
      const now = clock.now();
      const suppressions = await DS().get('mine.suppressions');
      if (DS().getActingUser().id !== partitionAt) return { ok: false, reason: 'partition-switched' };
      // Reuse the existing draft gate: suppression / cooldown / weekly-cap /
      // dedup-against-pending all apply to a `grant:<appId>` aspect for free.
      await this._draftProposals([{
        aspect: `grant:${appId}`,
        aspectLabel: `let ${appLabel} read your ${scopes.join(', ')}`,
        change: { op: 'grant-request', appId, appLabel, scopes },
        rationale: String(opts.rationale
          || `${appLabel} wants to read part of your accessibility profile so it can adapt itself for you.`).slice(0, 300),
        evidence: [],
        source: appId, // the requesting app — it can never resolve its own request
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
    // Audited (best-effort) BEFORE the delete — that's the last point the
    // scopes/audience are still visible to record against.
    async revokeGrant(appId) {
      appId = String(appId || '').trim();
      const before = ((await DS().get('mine.grants')) || []).find(g => g.appId === appId);
      await DS().patch('mine.grants', (grants) => (grants || []).filter(g => g.appId !== appId));
      if (before) {
        await recordShareAudit(DS, {
          appId, action: 'grant-revoked', scopes: before.scopes, audience: before.audience || 'personal', result: 'ok',
        }).catch(() => {});
      }
      return { ok: true };
    },

    // Read-only, default-deny export of the granted AbilityModel slice. No
    // active grant for `appId` → no data. Never writes (beyond the audit
    // trail); never includes a SurfaceProfile (web fontScale etc.) — only the
    // modality-neutral, categories-only AbilityModel, filtered to the grant's
    // scopes.
    //
    // Audience ceiling (Phase 3, folded in from the now-deleted broker): a
    // grant whose audience sits above the profile's CURRENT sharing level
    // (metaPreferences.sharing) exports nothing — re-checked on every call, so
    // lowering the level cuts off an out-of-level app immediately without
    // needing to revoke its grant. This is the portable enforcement point:
    // every host (not just Chrome) gets it for free. Both the refusal and the
    // success are recorded to the audit trail.
    async exportAbilityModel(appId) {
      appId = String(appId || '').trim();
      const partitionAt = DS().getActingUser().id;
      const profile = await DS().get('mine.profile'); // read-only: no init write
      if (profile && profile.sharingPaused) return { ok: false, reason: 'sharing-paused' };
      const grants = (await DS().get('mine.grants')) || [];
      const grant = grants.find(g => g.appId === appId && isActive(g));
      if (!grant) return { ok: false, reason: 'no-grant' };
      const sharing = (profile && profile.metaPreferences && profile.metaPreferences.sharing) || 'personal';
      if (!audienceAllowed(grant.audience, sharing)) {
        await recordShareAudit(DS, {
          appId, action: 'export-blocked', scopes: grant.scopes, audience: grant.audience, result: 'blocked',
        }).catch(() => {});
        return { ok: false, reason: 'audience-ceiling' };
      }
      const abilityModel = await this.getAbilityModel();
      // Fail safe if the acting user switched mid-read: never hand one
      // partition's data out under another partition's grant.
      if (DS().getActingUser().id !== partitionAt) return { ok: false, reason: 'partition-switched' };
      const filtered = filterAbilityModelByScopes(abilityModel, grant.scopes);
      await recordShareAudit(DS, {
        appId, action: 'export', scopes: grant.scopes, audience: grant.audience, result: 'ok',
      }).catch(() => {});
      return { ok: true, abilityModel: filtered };
    },

    // ====================== CROSS-APP INSIGHT WRITE (Phase 3) ======================
    // The write half of cross-app flow: a granted app contributes something it
    // learned (XR's FOV→text-size, ArtInsight's preferred description style).
    // WRITE = A PROPOSAL, NEVER SILENT: the insight is drafted through the same
    // consent machinery as everything else, carries its source app, and NEVER
    // auto-applies. The sending app has no code path that resolves it — only
    // the local user surface (respondToProposal) can.
    //
    // insight = { kind: 'visual.textSize', confidence: 0..1, label?, rationale?,
    //             change: {op:'profile-set', path:'fields.…', value} |
    //                     {op:'add-memory', record:{…}} }
    // The inner change is whitelisted: profile-set may only touch `fields.*`
    // (the ability fields) — never metaPreferences / memoryPaused /
    // sharingPaused, so a cross-app write can't propose to loosen the user's
    // own safety switches.
    async importInsight(sourceAppId, insight = {}) {
      sourceAppId = String(sourceAppId || '').trim();
      if (!sourceAppId) return { ok: false, reason: 'bad-app' };
      const partitionAt = DS().getActingUser().id;
      const profile = await getOrInitProfile();
      if (profile.sharingPaused) return { ok: false, reason: 'sharing-paused' };
      // Writing requires the same visible grant reading does: an app the user
      // never approved can't even ask.
      const grants = (await DS().get('mine.grants')) || [];
      const grant = grants.find(g => g.appId === sourceAppId && isActive(g));
      if (!grant) return { ok: false, reason: 'no-grant' };
      const kind = String(insight.kind || '').slice(0, 60);
      const confidence = Math.min(1, Math.max(0, Number(insight.confidence ?? 0.5)));
      const change = insight.change;
      const validChange = change && (
        (change.op === 'profile-set' && isSafeFieldsPath(change.path))
        || (change.op === 'add-memory' && change.record && typeof change.record === 'object'));
      if (!kind || !validChange) return { ok: false, reason: 'bad-insight' };
      const suppressions = await DS().get('mine.suppressions');
      const now = clock.now();
      if (DS().getActingUser().id !== partitionAt) return { ok: false, reason: 'partition-switched' };
      await this._draftProposals([{
        aspect: `insight:${sourceAppId}:${kind}`,
        aspectLabel: String(insight.label || `${grant.appLabel} suggests an update to ${kind}`).slice(0, 120),
        change: { op: 'cross-app-insight', appId: sourceAppId, appLabel: grant.appLabel, kind, confidence, change },
        rationale: String(insight.rationale
          || `${grant.appLabel} noticed this while you used it. Nothing changes unless you say yes.`).slice(0, 300),
        evidence: [],
        source: sourceAppId,
      }], { suppressions, profile, now });
      await updateBadge();
      const props = await DS().get('mine.proposals');
      const pending = props.find(p => p.status === 'pending'
        && p.aspect === `insight:${sourceAppId}:${kind}` && p.change && p.change.op === 'cross-app-insight');
      return pending ? { ok: true, proposalId: pending.id } : { ok: false, reason: 'suppressed' };
    },

    // Batch entry for a user-carried insight OUTBOX (the ArtInsight→web return
    // path, or any consumer app's export). Each insight still goes through the
    // SAME grant-gated, never-silent importInsight — the outbox is just a
    // transport, it grants nothing. Returns per-insight results.
    async importInsightOutbox(outbox) {
      if (!outbox || outbox.kind !== 'aa-insight-outbox' || typeof outbox.sourceAppId !== 'string'
        || !Array.isArray(outbox.insights)) {
        return { ok: false, reason: 'bad-outbox' };
      }
      const results = [];
      for (const insight of outbox.insights.slice(0, 50)) {
        results.push(await this.importInsight(outbox.sourceAppId, insight));
      }
      return { ok: true, results };
    },

    // ====================== ACTING USER (Phase 3) ======================
    // A lightweight "who's using this now?" partition so two people on one
    // device/headset never cross-contaminate. The datastore owns the physical
    // key-derivation (every mine.* store + memory shard is namespaced by the
    // active partition; null = the default single-user data, unchanged); the
    // Librarian just exposes the switch and refreshes the badge, since the
    // pending-proposal count is per-partition.
    async setActingUser(id, opts = {}) {
      // Wait for any in-flight slow-lane job (extract/reflect) to finish so a
      // partition switch can never interleave with a job's awaited writes and
      // land data in the wrong partition (CLAUDE.md tradeoff #2 — this is the
      // "anchor jobs" half; the debounce-skip in scheduleExtraction is the
      // other). A new job can't start in between: the switch proceeds in the
      // same microtask turn the lane drains.
      await slowLaneDrained();
      const res = await DS().setActingUser(id, opts);
      await updateBadge();
      return res;
    },

    getActingUser() {
      return DS().getActingUser();
    },

    // ====================== USER-MEDIATED PROFILE BLOB (Phase 3) ======================
    // §6 transport (b): the user deliberately exports a portable JSON blob on
    // one device/app and imports it on another (the XR⇄web demo). The button
    // IS the consent, so this is NOT gated on sharingPaused (that switch
    // governs app-to-app flow, not the user moving their OWN data by hand).
    // Only the modality-neutral ability profile travels — never memories,
    // grants, proposals, or any SurfaceProfile (device-local by design).
    async exportProfileBlob() {
      const profile = await getOrInitProfile();
      const abilityModel = await this.getAbilityModel();
      return buildProfileBlob(profile, abilityModel, clock.now());
    },

    // Merge an imported blob into the ACTIVE partition's profile. Plain
    // last-write-wins by the blob's exportedAt vs the local profile.updatedAt
    // (plan §6 — no CRDT). Returns {ok, merged, reason?}. Never overwrites
    // with older data, never touches memories/grants/surfaces.
    async importProfileBlob(blob) {
      if (!validateProfileBlob(blob)) return { ok: false, reason: 'bad-blob' };
      const local = await getOrInitProfile();
      // LWW compares against the local profile's MEANINGFUL last write, not its
      // init timestamp: a fresh device auto-seeds a default profile at now, which
      // would otherwise always beat an older blob and break the very case this
      // path exists for (import onto a new device). An unwritten default always
      // yields to an import.
      // The "meaningful" set MUST match the set the merge overwrites, or an
      // older blob could silently revert a real local edit to a field the guard
      // ignored. Includes metaPreferences.language (a user-owned, exported field
      // the merge writes).
      const localMeaningful = (Array.isArray(local.supportAreas) && local.supportAreas.length)
        || (local.freeText && local.freeText.length)
        || (local.fields && Object.keys(local.fields).length)
        || (local.metaPreferences && local.metaPreferences.language && local.metaPreferences.language !== 'standard');
      const localAt = local.updatedAt || 0;
      if (localMeaningful && blob.exportedAt <= localAt) return { ok: true, merged: false, reason: 'older-or-equal' };
      await DS().patch('mine.profile', (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        const bp = blob.profile;
        p.supportAreas = Array.isArray(bp.supportAreas) ? bp.supportAreas.filter(x => typeof x === 'string') : p.supportAreas;
        p.freeText = typeof bp.freeText === 'string' ? bp.freeText : p.freeText;
        // fields (the ability-model source) — imported wholesale, but sanitized
        // through the same prototype-safe path constraints (plain object only).
        if (bp.fields && typeof bp.fields === 'object') {
          p.fields = JSON.parse(JSON.stringify(bp.fields));
        }
        p.metaPreferences = p.metaPreferences || {};
        if (bp.metaPreferences && typeof bp.metaPreferences.language === 'string') {
          p.metaPreferences.language = bp.metaPreferences.language;
        }
        p.updatedAt = blob.exportedAt; // adopt the blob's clock so re-import is idempotent
        return p;
      });
      return { ok: true, merged: true };
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

    // The global cross-app OFF switch. Hard-stops every cross-app read and
    // write (grant requests, exports, insight imports) while set; existing
    // grants are kept (paused, not revoked) so unpausing restores them.
    async setSharingPaused(paused) {
      await DS().patch('mine.profile', (p) => {
        p = p || structuredClone(PROFILE_DEFAULTS);
        p.sharingPaused = !!paused;
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
        // paths (metaPreferences, memoryPaused, sharingPaused, schemaVersion,
        // …): an inferred proposal the user only ever sees as friendly prose
        // must never silently rewrite consent or rate-limit settings. Reuses
        // the same prototype-safe path validator the cross-app insight path
        // enforces (isSafeFieldsPath, above).
        if (prop.change?.op === 'profile-set' && !isSafeFieldsPath(prop.change.path)) {
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
        } else if (prop.change?.op === 'grant-request') {
          // Cross-app read grant (Phase 3): minting a grant happens ONLY here,
          // on the local user surface accepting the request — never in the
          // requesting app's requestGrant. One grant per app (a re-grant with
          // wider scopes replaces the prior entry).
          const { appId, appLabel, scopes } = prop.change;
          let mintedAudience = 'personal';
          await DS().patch('mine.grants', (grants) => {
            grants = (grants || []).filter(g => g.appId !== appId);
            const grant = normalizeGrant({ id: newId('grant'), appId, appLabel, scopes, grantedAt: now });
            mintedAudience = grant.audience;
            grants.push(grant);
            return grants;
          });
          // The grant becomes real HERE, on accept — never in requestGrant,
          // which only drafts. This is the one place a 'grant-created' audit
          // entry can be recorded at the moment it actually takes effect.
          await recordShareAudit(DS, { appId, action: 'grant-created', scopes, audience: mintedAudience, result: 'ok' }).catch(() => {});
        } else if (prop.change?.op === 'cross-app-insight' && prop.change.change) {
          // Cross-app insight (Phase 3): applying the inner change happens ONLY
          // here, on the local user surface. The inner op is re-validated at
          // apply time (the whitelist importInsight enforced), so a stored
          // proposal can't smuggle a wider op in.
          const inner = prop.change.change;
          if (inner.op === 'profile-set' && isSafeFieldsPath(inner.path)) {
            // Same soft-by-default rule as add-memory below: a cross-app
            // insight may suggest a need but never impose a hard floor — cap
            // every needs-shaped entry in the value at 'preference' strength
            // and stamp its provenance, so a granted app's insight can never
            // permanently outrank the user's own explicit preferences.
            const capStrength = (v) => {
              if (Array.isArray(v)) return v.map(capStrength);
              if (v && typeof v === 'object') {
                const out = { ...v };
                if ('strength' in out && rankOf(out.strength) > STRENGTH_RANK.preference) {
                  out.strength = 'preference';
                }
                if ('dimension' in out && !out.source) out.source = `cross-app:${prop.change.appId}`;
                return out;
              }
              return v;
            };
            await this.setProfileField(inner.path, capStrength(inner.value));
          } else if (inner.op === 'add-memory' && inner.record && typeof inner.record === 'object') {
            // Soft-by-default: a cross-app insight never arrives as certainty
            // (confidence capped) and never as a hard, un-retirable requirement
            // (strength forced to 'preference', tier to 'preference', and the
            // control kinds suppression/rule refused). It carries its source app
            // for provenance. The user's OWN floors always dominate it.
            const insrec = { ...inner.record };
            insrec.source = `cross-app:${prop.change.appId}`;
            insrec.confidence = Math.min(0.9, Number(prop.change.confidence ?? 0.7));
            insrec.strength = 'preference';
            insrec.tier = 'preference';
            if (insrec.kind === 'suppression' || insrec.kind === 'rule') insrec.kind = 'preference';
            const rec = normalizeRecord(insrec, now);
            const shard = await DS().getMemoryShard(rec.scope);
            shard.push(rec);
            await DS().setMemoryShard(rec.scope, shard);
          }
          // The insight becomes real HERE, on accept — never in importInsight,
          // which only drafts. Mirrors the grant-request audit above.
          const grantForAudit = ((await DS().get('mine.grants')) || []).find(g => g.appId === prop.change.appId);
          await recordShareAudit(DS, {
            appId: prop.change.appId, action: 'insight-import',
            scopes: [prop.change.kind].filter(Boolean),
            audience: grantForAudit?.audience || 'personal', result: 'ok',
          }).catch(() => {});
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
          // Cross-app provenance (Phase 3): the appId that originated this
          // proposal, or null for locally-drafted ones. Display-only here —
          // resolution is always the local user surface.
          source: d.source || null,
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
  //
  // Slow-lane gate: extract/reflect register as in-flight so a partition
  // switch (setActingUser) waits for them to drain — a job's awaited writes
  // must never straddle a switch. Single JS thread + this gate = a job always
  // completes against the partition it started in.
  let _slowLaneRuns = 0;
  const _slowLaneWaiters = [];
  function slowLaneEnter() { _slowLaneRuns++; }
  function slowLaneExit() {
    if (--_slowLaneRuns === 0) _slowLaneWaiters.splice(0).forEach(resolve => resolve());
  }
  function slowLaneDrained() {
    return _slowLaneRuns === 0 ? Promise.resolve() : new Promise(r => _slowLaneWaiters.push(r));
  }

  function scheduleExtraction() {
    // Anchor the debounced run to the partition that enqueued it: if the
    // acting user switched during the 20s window, skip — the observation sits
    // safely in ITS partition's log and the periodic net drains it when that
    // partition is next active (CLAUDE.md tradeoff #2).
    const enqueuedFor = DS().getActingUser().id;
    scheduler.debounce('aaLibrarianExtract', 20000, () => {
      if (DS().getActingUser().id !== enqueuedFor) return;
      Librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
    });
  }

  async function updateBadge() {
    try {
      const pending = await Librarian.listProposals('pending');
      await consent.notifyPending(pending.length);
    } catch { /* no consent surface in some contexts */ }
  }

  // Register the partition-sensitive jobs with the drain gate: every call
  // holds the lane open until it completes, and setActingUser waits for the
  // lane to drain before flipping the partition. This covers not just the slow
  // lane (extract/reflect) but every method whose read→write spans an await
  // boundary and would otherwise straddle a switch (the cross-app writes and
  // proposal resolution do a get→…→set on partitioned stores). None of these
  // call setActingUser, so the wait can't deadlock. setActingUser itself is
  // NOT wrapped (it IS the switch).
  for (const job of ['extract', 'reflect', 'requestGrant', 'importInsight', 'respondToProposal', 'recordScopedSettings']) {
    const inner = Librarian[job].bind(Librarian);
    Librarian[job] = async (...args) => {
      slowLaneEnter();
      try { return await inner(...args); } finally { slowLaneExit(); }
    };
  }

  // Periodic safety nets: drain the log every 30 min, consolidate daily.
  // These are partition-agnostic by design: they drain whatever partition is
  // active when they fire — each partition's log simply waits its turn.
  scheduler.every('aaLibrarianExtract', 30, () => {
    Librarian.extract().catch(e => console.warn('[Librarian] extract failed:', e.message));
  });
  scheduler.every('aaLibrarianReflect', 60 * 24, () => {
    Librarian.reflect().catch(e => console.warn('[Librarian] reflect failed:', e.message));
  });

  return Librarian;
}

export default createLibrarian;
