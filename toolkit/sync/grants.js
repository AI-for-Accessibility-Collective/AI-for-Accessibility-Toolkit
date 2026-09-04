// Cross-app grant model (Phase 3, increment 1) — pure, platform-agnostic. A
// GRANT is the durable, user-approved record that one first-party app may READ
// a scoped, modality-neutral slice of the AbilityModel. Mostly no I/O and no
// ports: the Librarian owns persistence (mine.grants) and the consent flow;
// this module is the schema, the scope whitelist, and the boundary filter.
// The one deliberate exception is the audit trail below (mine.shareAudit) —
// folded in from the now-deleted toolkit/core/broker.js, which was never
// constructed at runtime. Its writers take the datastore explicitly, same
// lazy-getter shape (`() => datastore`) the Librarian and the broker used.
//
// Threat model is MISTAKES, NOT MALICE — the consuming apps (web ext, XR,
// ArtInsight) are our own / collaborators'. So the safeguards here are
// proportionate: a CLOSED scope whitelist, a READ-ONLY categories-only
// projection, and "revoke = delete" (the Librarian's job). On-the-wire signing
// / encryption / write-quarantine are deliberately out of scope
// (product-hardening — see docs/toolkit-refactor-plan.md §6).

// The closed whitelist of readable scopes. COARSE by design: an app reads a
// CATEGORY of understanding, never a concrete diagnosis and never a raw
// SurfaceProfile (web fontScale / XR angular height stay device-local).
export const GRANT_SCOPES = [
  'ability.categories', // coarse support-area labels (vision/hearing/motor/cognitive)
  'reading.level',      // the reading-level hint
  'language',           // 'standard' | 'plain'
  'settings.text',      // structured, modality-NEUTRAL display needs (needs[]) — never web fontScale
];

// Per-scope projection of an AbilityModel (see core/ability.js). Each granted
// scope unlocks a NON-OVERLAPPING subset of AbilityModel fields. Deliberately
// conservative: `freeText` and `confidence` are NEVER exported (the most
// free-form / least structured fields stay device-local), and no SurfaceProfile
// value is reachable from any scope. `needs` are the modality-neutral display
// requirements (e.g. {dimension:'textSize', value:1.6}), not web settings.
//
// READ-ONLY at the boundary: every array/object value is COPIED, never aliased,
// so a consuming app that mutates the exported object can never write back into
// the user's stored profile. (The Chrome backend serializes on read, but the
// toolkit is platform-agnostic and the cross-app target is an in-process KV —
// the export must isolate regardless of backend.)
/** @typedef {import('../core/ability.js').AbilityModel} AbilityModel */
/** @type {Record<string, (am: Partial<AbilityModel>) => Partial<AbilityModel>>} */
const SCOPE_PROJECTION = {
  'ability.categories': (am) => ({ supportAreas: Array.isArray(am.supportAreas) ? am.supportAreas.map(String) : [] }),
  'reading.level':      (am) => ({ readingLevel: am.readingLevel ?? null }),
  'language':           (am) => ({ language: am.language || 'standard' }),
  'settings.text':      (am) => ({ needs: Array.isArray(am.needs) ? am.needs.map(n => ({ ...n })) : [] }),
};

/**
 * @typedef {Object} Grant
 * The durable, user-approved record that one app may read a scoped slice.
 * @property {string|null} id
 * @property {string} appId
 * @property {string} appLabel
 * @property {string[]} scopes        Only whitelisted GRANT_SCOPES survive normalization.
 * @property {string} audience        One of AUDIENCES.
 * @property {number} grantedAt       Epoch milliseconds, 0 when unknown.
 */

/** True iff `scopes` is a non-empty array of whitelisted scopes. Unknown or
 *  empty → false (default-deny: requestGrant rejects rather than over-granting).
 *  @param {unknown} scopes
 *  @returns {boolean} */
export function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  return scopes.every(s => GRANT_SCOPES.includes(s));
}

/** Canonicalize a grant record. Drops any non-whitelisted scope defensively
 *  (validateScopes gates creation, but a stored grant is trusted loosely).
 *  @param {any} raw
 *  @returns {Grant} */
export function normalizeGrant(raw) {
  const g = raw || {};
  return {
    id: g.id || null,
    appId: String(g.appId || ''),
    appLabel: String(g.appLabel || g.appId || ''),
    scopes: Array.isArray(g.scopes) ? g.scopes.filter(/** @param {string} s */ s => GRANT_SCOPES.includes(s)) : [],
    // Who this grant's holder is to the person (broker.js's audience-ceiling
    // model, folded in — see AUDIENCES below). Defaults to the narrowest tier
    // so a grant minted before this field existed, or one with a missing/
    // corrupt audience, never widens past self.
    audience: AUDIENCES.includes(g.audience) ? g.audience : 'personal',
    grantedAt: Number(g.grantedAt) || 0,
  };
}

// ============================ Audience ceiling ============================
// Who holds a grant, relative to the person: an app acting for the person
// themself, someone in their circle (family, friends, carers), or anyone
// beyond it. The profile's sharing level ('personal' | 'friends' | 'anyone',
// stored at metaPreferences.sharing — see popup's sharingSelect) is the
// CEILING: a grant whose audience sits above the current level exports
// nothing until the person raises it. Meant to be re-checked on every
// export, so lowering the level immediately cuts off out-of-level grants
// without needing to revoke them. Ported from toolkit/core/broker.js.
export const AUDIENCES = ['personal', 'friends', 'anyone'];
/** @type {Readonly<Record<string, number | undefined>>} */
const AUDIENCE_ORDER = { personal: 0, friends: 1, anyone: 2 };

/** True iff `audience` is covered by the profile's current `sharing` level.
 *  Fail CLOSED on unrecognized values: an unknown/missing sharing level
 *  counts as 'personal' (the narrowest ceiling), and an unknown audience
 *  never passes — a corrupted field must narrow access, never widen it.
 *
 *  Pure by design (no I/O), so it composes wherever both operands are in
 *  scope: core/librarian.js's exportAbilityModel calls it directly — the
 *  portable enforcement point every host gets for free — and
 *  background.js's grant routes are now thin pass-throughs to the Librarian
 *  rather than re-implementing the check.
 *  @param {string} audience  The grant holder's audience tier.
 *  @param {string} sharing   The profile's current sharing level. Pass the
 *    stored value as is: an unknown label (or '' for a missing one) reads as
 *    'personal' below.
 *  @returns {boolean} */
export function audienceAllowed(audience, sharing) {
  const ceiling = AUDIENCE_ORDER[sharing] ?? 0;
  const need = AUDIENCE_ORDER[audience] ?? Infinity;
  return need <= ceiling;
}

// ============================== Audit trail ================================
// mine.shareAudit: an append-only, capped log of cross-app sharing events —
// { ts, appId, action, scopes, audience, result }, action ∈ 'grant-created' |
// 'grant-revoked' | 'export' | 'export-blocked' | 'insight-import'. Same
// shape broker.js's getAuditLog exposed (kind → action here), ported here
// since the broker is deleted. `datastore` is the lazy getter (`() =>
// store`) the Librarian and the old broker both took. core/librarian.js is
// the writer now: requestGrant's accept path (grant-created), revokeGrant
// (grant-revoked), exportAbilityModel (export / export-blocked), and the
// cross-app-insight accept path (insight-import) all call recordShareAudit
// directly, right where the action becomes real — no host-specific route
// needs to duplicate the write.
const AUDIT_STORE = 'mine.shareAudit';
const AUDIT_MAX = 500;

/**
 * @typedef {Object} ShareAuditEntry
 * @property {number} ts
 * @property {string} appId
 * @property {'grant-created'|'grant-revoked'|'export'|'export-blocked'|'insight-import'} action
 * @property {string[]} [scopes]
 * @property {string} [audience]
 * @property {string} [result]
 */

/**
 * @typedef {Object} AuditStore
 * The two datastore-facade methods the audit trail uses (core/datastore.js
 * `mine`-tier `get` and `patch`).
 * @property {(name: string) => Promise<any>} get
 * @property {(name: string, fn: (current: any) => any) => Promise<any>} patch
 */

/**
 * Append one entry (stamping `ts`), capped to the most recent AUDIT_MAX.
 * @param {() => AuditStore} datastore  Lazy getter for the datastore facade.
 * @param {Omit<ShareAuditEntry, 'ts'>} entry
 */
export async function recordShareAudit(datastore, entry) {
  const DS = datastore;
  await DS().patch(AUDIT_STORE, (log) => {
    log = Array.isArray(log) ? log : [];
    log.push({ ts: Date.now(), ...entry });
    if (log.length > AUDIT_MAX) log.splice(0, log.length - AUDIT_MAX);
    return log;
  });
}

/** The full audit trail, oldest first (as stored).
 *  @param {() => AuditStore} datastore  Lazy getter for the datastore facade.
 *  @returns {Promise<ShareAuditEntry[]>} */
export async function getShareAudit(datastore) {
  const DS = datastore;
  return (await DS().get(AUDIT_STORE)) || [];
}

/** A grant is active iff it has an appId and at least one valid scope. Revoke
 *  is a DELETE, so there is no revoked/expired state to check — a stored grant
 *  that still exists is active.
 *  @param {Partial<Grant>|null|undefined} grant
 *  @returns {boolean} */
export function isActive(grant) {
  return !!(grant && grant.appId && Array.isArray(grant.scopes) && grant.scopes.length > 0);
}

/** Project an AbilityModel down to ONLY the fields the granted scopes unlock.
 *  READ-ONLY; always includes `schemaVersion` so a consumer can version-check.
 *  Unknown scopes are ignored. Never emits freeText / confidence or any
 *  SurfaceProfile value.
 *  @param {Partial<AbilityModel>|null|undefined} abilityModel
 *  @param {string[]|null|undefined} scopes
 *  @returns {Partial<AbilityModel> & { schemaVersion: number }} */
export function filterAbilityModelByScopes(abilityModel, scopes) {
  /** @type {Partial<AbilityModel>} */
  const am = abilityModel || {};
  /** @type {Partial<AbilityModel> & { schemaVersion: number }} */
  const out = { schemaVersion: am.schemaVersion ?? 1 };
  for (const s of (scopes || [])) {
    const project = SCOPE_PROJECTION[s];
    if (project) Object.assign(out, project(am));
  }
  return out;
}
