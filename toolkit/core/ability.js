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

// A modality-NEUTRAL need: a dimension of support the user requires, expressed
// without committing to any one surface's units. Surfaces translate dimensions
// into their own settings (see adapters/*/derive*). `value` is interpreted per
// dimension (e.g. textSize: a unitless multiplier 1.0–2.0; reduceMotion: bool).
const VALID_STRENGTH = ['floor', 'preference', 'hint'];
const VALID_UNIT = ['ratio', 'em', 'percent', 'boolean', 'enum'];

export function normalizeNeed(n) {
  if (!n || typeof n !== 'object' || !n.dimension) return null;
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
 * @param {object|null} profile
 */
export function toAbilityModel(profile) {
  const fields = (profile && profile.fields) || {};
  const needs = Array.isArray(fields.needs)
    ? fields.needs.map(normalizeNeed).filter(Boolean)
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
