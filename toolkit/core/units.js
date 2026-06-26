// Typed units — the contract that stops surfaces misreading each other.
//
// The same adaptation can be expressed in different units on different
// surfaces: web text size is a **percent** (fontScale 150), XR text size is an
// **angular height in degrees**, a raw model might emit a bare **multiplier**
// (1.5). Phase 1 makes the unit explicit per setting so a value carried
// between surfaces (XR ⇄ web ⇄ ArtInsight) can't be silently misinterpreted,
// and so the old "a number below its range is probably a multiplier" guess has
// a named home instead of being an inline heuristic.
//
// Pure + dependency-free. The numeric ranges still come from the host's
// `settingsMeta` (passed in), so this module stays the single *unit* authority
// without duplicating the registry.

/** Canonical unit tags. */
export const UNIT = Object.freeze({
  percent: 'percent', // 100 = no change (fontScale)
  ratio: 'ratio',     // a unitless multiple (lineHeight, speechRate)
  em: 'em',           // typographic em (letterSpacing)
  boolean: 'boolean',
  enum: 'enum',
});

// Canonical unit per setting key. Only the numeric settings need
// disambiguation; booleans/enums are pass-through and may be omitted here.
// Surfaces that introduce their own dimensions (e.g. XR `angularTextHeight` in
// degrees) extend this in their own adapter, not here.
export const SETTING_UNITS = Object.freeze({
  fontScale: UNIT.percent,
  lineHeight: UNIT.ratio,
  letterSpacing: UNIT.em,
  speechRate: UNIT.ratio,
});

/** The canonical unit for a setting key, or null if untyped here. */
export function unitOf(key) {
  return SETTING_UNITS[key] || null;
}

// Coerce a raw value into the canonical unit/range declared by `meta` (the
// settingsMeta entry map). Preserves the legacy sanitizeSettings behaviour
// exactly: for a numeric setting with a [min,max] range, a value below the
// range whose ×100 lands inside it is read as a multiplier (1.5 → 150); then
// the result is clamped to range. Non-numeric or unknown keys pass through.
//
// This is still a *guess* for values that arrive without a declared unit. Once
// every writer tags units end-to-end the multiplier branch can be dropped; for
// now it is the safety net the extension already depends on.
export function coerceSetting(key, value, meta) {
  const m = meta && meta[key];
  if (!(m && m.type === 'number' && Array.isArray(m.range) && typeof value === 'number')) {
    return value;
  }
  const [min, max] = m.range;
  let val = value;
  if (val < min && val * 100 >= min && val * 100 <= max) val = val * 100;
  return Math.min(max, Math.max(min, val));
}

/** Coerce every key in a settings object. Non-object input passes through.
 *  This is the INGEST normalizer — run once where untrusted/raw values enter
 *  (record writes, the LLM extract ops, the one-time migration). */
export function coerceSettings(settings, meta) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = {};
  for (const [k, v] of Object.entries(settings)) out[k] = coerceSetting(k, v, meta);
  return out;
}

// Clamp-only normalization for the READ/merge path. Trusts that values were
// already coerced to canonical units at write time (the typed-unit contract),
// so it does NOT guess multipliers — it only bounds a numeric to its declared
// range. This is what replaced the old read-side `>10` %-vs-multiplier heuristic.
export function clampSetting(key, value, meta) {
  const m = meta && meta[key];
  if (!(m && m.type === 'number' && Array.isArray(m.range) && typeof value === 'number')) {
    return value;
  }
  const [min, max] = m.range;
  return Math.min(max, Math.max(min, value));
}

/** Clamp every key in a settings object. Non-object input passes through. */
export function clampSettings(settings, meta) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = {};
  for (const [k, v] of Object.entries(settings)) out[k] = clampSetting(k, v, meta);
  return out;
}
