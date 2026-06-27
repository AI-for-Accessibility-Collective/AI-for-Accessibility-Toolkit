// Cross-app grant model (Phase 3, increment 1) — pure, platform-agnostic. A
// GRANT is the durable, user-approved record that one first-party app may READ
// a scoped, modality-neutral slice of the AbilityModel. No I/O and no ports:
// the Librarian owns persistence (mine.grants) and the consent flow; this
// module is just the schema, the scope whitelist, and the boundary filter.
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
const SCOPE_PROJECTION = {
  'ability.categories': (am) => ({ supportAreas: Array.isArray(am.supportAreas) ? am.supportAreas.map(String) : [] }),
  'reading.level':      (am) => ({ readingLevel: am.readingLevel ?? null }),
  'language':           (am) => ({ language: am.language || 'standard' }),
  'settings.text':      (am) => ({ needs: Array.isArray(am.needs) ? am.needs.map(n => ({ ...n })) : [] }),
};

/** True iff `scopes` is a non-empty array of whitelisted scopes. Unknown or
 *  empty → false (default-deny: requestGrant rejects rather than over-granting). */
export function validateScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  return scopes.every(s => GRANT_SCOPES.includes(s));
}

/** Canonicalize a grant record. Drops any non-whitelisted scope defensively
 *  (validateScopes gates creation, but a stored grant is trusted loosely). */
export function normalizeGrant(raw) {
  const g = raw || {};
  return {
    id: g.id || null,
    appId: String(g.appId || ''),
    appLabel: String(g.appLabel || g.appId || ''),
    scopes: Array.isArray(g.scopes) ? g.scopes.filter(s => GRANT_SCOPES.includes(s)) : [],
    grantedAt: Number(g.grantedAt) || 0,
  };
}

/** A grant is active iff it has an appId and at least one valid scope. Revoke
 *  is a DELETE, so there is no revoked/expired state to check — a stored grant
 *  that still exists is active. */
export function isActive(grant) {
  return !!(grant && grant.appId && Array.isArray(grant.scopes) && grant.scopes.length > 0);
}

/** Project an AbilityModel down to ONLY the fields the granted scopes unlock.
 *  READ-ONLY; always includes `schemaVersion` so a consumer can version-check.
 *  Unknown scopes are ignored. Never emits freeText / confidence or any
 *  SurfaceProfile value. */
export function filterAbilityModelByScopes(abilityModel, scopes) {
  const am = abilityModel || {};
  const out = { schemaVersion: am.schemaVersion ?? 1 };
  for (const s of (scopes || [])) {
    const project = SCOPE_PROJECTION[s];
    if (project) Object.assign(out, project(am));
  }
  return out;
}
