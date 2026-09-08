// AbilityModel — the modality-agnostic understanding of the user, projected
// from the stored profile. This is the shape XR / ArtInsight / web all read
// and contribute to; each surface derives its own concrete rendering from it
// (web: fontScale/…; XR: angular text height; ArtInsight: verbosity).
//
// Phase 1 increment 2 makes the model a first-class, NAMED concept without a
// new store and without a migration: it is a pure VIEW over the existing
// profile. The only structured sub-tree it reads — `profile.fields.needs` —
// is absent for 100% of current users (profile.fields is `{}` and was never
// read), so today the model is just { supportAreas, freeText, language } with
// an empty `needs[]`. Writing structured needs later uses the existing
// `setProfileField('fields.needs', …)` path — zero new plumbing.
//
// Pure + platform-agnostic.

// The support-area vocabulary: the areas of support a person's profile can
// name (`supportAreas` on the profile and the AbilityModel), and the areas a
// registry entry or a skill says it helps. One list, so the Librarian's
// retrieval (matchSkill overlaps a skill's areas with the profile's) never
// compares two vocabularies that drifted apart. Skills are checked against it
// at runtime (validateSkill in core/skill.js), so a value outside the list
// fails at authoring time instead of scoring zero at retrieval time
// (issue #34); registry entries (toolkit/registry/tools.js) are checked by
// toolkit/test/skill-test.js, which fails the build if the two drift.
// FLAG(review): onboarding/server.js keeps its own list with a seventh value,
// 'attention' (routed there by onboarding/chat-routing.js and read by
// controller/presentation.js), that no registry entry or builtin skill uses.
// Profiles are not validated here, so that list is left alone; see the PR
// for the tradeoff.
export const SUPPORT_AREAS = Object.freeze(['vision', 'hearing', 'motor', 'cognitive', 'reading', 'sensory']);

// A modality-NEUTRAL need: a dimension of support the user requires, expressed
// without committing to any one surface's units. Surfaces translate dimensions
// into their own settings (see adapters/*/derive*). `value` is interpreted per
// dimension (e.g. textSize: a unitless multiplier 1.0–2.0; reduceMotion: bool).
const VALID_STRENGTH = ['floor', 'preference', 'hint'];
const VALID_UNIT = ['ratio', 'em', 'percent', 'boolean', 'enum'];

/**
 * @typedef {'floor'|'preference'|'hint'} NeedStrength
 * @typedef {import('./units.js').Unit} NeedUnit
 */

/**
 * @typedef {Object} Need
 * One modality-neutral need. `value` is read per dimension by each surface (a
 * number for textSize, a boolean for reduceMotion, a variant string for
 * contrast), so it stays `unknown` here and every reader narrows it.
 * FLAG(review): a per-dimension union would be tighter; it belongs here if
 * consumers want it, and the surfaces' `Record<string, unknown>` maps follow.
 * @property {string} dimension
 * @property {unknown} value
 * @property {NeedStrength} strength
 * @property {NeedUnit} [unit]
 * @property {number} [confidence]
 * @property {string} [source]
 */

/**
 * @typedef {Object} ProfileRecord
 * The stored ability profile (`mine.profile`), as far as the pure helpers read
 * it. Every field is optional because a stored record can predate any of them.
 * @property {string[]} [supportAreas]
 * @property {string} [freeText]
 * @property {{ language?: string, sharing?: string } & Record<string, unknown>} [metaPreferences]
 * @property {{ needs?: unknown[], readingLevel?: string|null, confidence?: number|null } & Record<string, unknown>} [fields]
 * @property {number|null} [updatedAt]
 */

/**
 * @typedef {Object} AbilityModel
 * The modality-neutral view `librarian.getAbilityModel()` returns.
 * @property {number} schemaVersion
 * @property {string[]} supportAreas
 * @property {string} freeText
 * @property {string} language
 * @property {string|null} readingLevel
 * @property {number|null} confidence
 * @property {Need[]} needs
 */

/**
 * Canonicalize one raw need. Anything that is not an object with a
 * `dimension` comes back null.
 * @param {any} n
 * @returns {Need|null}
 */
export function normalizeNeed(n) {
  if (!n || typeof n !== 'object' || !n.dimension) return null;
  /** @type {Need} */
  const need = {
    dimension: String(n.dimension),
    value: n.value,
    strength: VALID_STRENGTH.includes(n.strength) ? n.strength : 'preference',
  };
  if (VALID_UNIT.includes(n.unit)) need.unit = n.unit;
  if (n.confidence != null) need.confidence = n.confidence;
  if (n.source) need.source = String(n.source);
  return need;
}

/**
 * Project a stored profile into the AbilityModel view. Reads ONLY the specific
 * fresh sub-keys (fields.needs / fields.readingLevel / fields.confidence) so
 * unrelated legacy data in `fields` can never leak in.
 * @param {ProfileRecord|null|undefined} profile
 * @returns {AbilityModel}
 */
export function toAbilityModel(profile) {
  /** @type {NonNullable<ProfileRecord['fields']>} */
  const fields = (profile && profile.fields) || {};
  const needs = Array.isArray(fields.needs)
    // filter(Boolean) drops the nulls at runtime; the cast tells the checker so.
    ? /** @type {Need[]} */ (fields.needs.map(normalizeNeed).filter(Boolean))
    : [];
  return {
    schemaVersion: 1,
    supportAreas: (profile && profile.supportAreas) || [],
    freeText: (profile && profile.freeText) || '',
    language: (profile && profile.metaPreferences && profile.metaPreferences.language) || 'standard',
    readingLevel: fields.readingLevel != null ? fields.readingLevel : null,
    confidence: fields.confidence != null ? fields.confidence : null,
    needs,
  };
}

export default toAbilityModel;
