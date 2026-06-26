// The web SurfaceAdapter — how the Chrome extension renders the merged
// settings. The browser natively supports every key in the host's settings
// registry (that's what `applyProfileSettings` in content.js already does), so
// the web surface reports `unmet` only for keys it has no rendering for — e.g.
// an XR-originated need like `angularTextHeight` that arrives via cross-app
// flow but has no web equivalent. This is where Phase 1's "move the web
// settings mapping into adapters/chrome" lands.
//
// Not yet wired into content.js — getEffectivePreferences().settings is still
// applied directly, unchanged. This makes the seam available (and gives XR /
// ArtInsight a template) without altering the live web apply path.
import { createSurfaceAdapter } from '../../core/surface.js';
import { rankOf } from '../../core/strength.js';
import { coerceSetting } from '../../core/units.js';

/**
 * Build the web surface from the host's settingsMeta (AA_TOOLS.settingsMeta).
 * Every registry key is natively representable; numeric keys additionally
 * range-check so an out-of-range cross-app value is reported, not silently
 * clamped away.
 * @param {Record<string, {type:string, range?:[number,number]}>} settingsMeta
 */
export function createWebSurface(settingsMeta = {}) {
  const supports = {};
  for (const [key, meta] of Object.entries(settingsMeta)) {
    if (meta.type === 'number' && Array.isArray(meta.range)) {
      const [min, max] = meta.range;
      supports[key] = {
        unit: meta.type,
        representable: (v) => typeof v === 'number' && v >= min && v <= max,
        // Out-of-range numbers degrade to the nearest bound rather than failing.
        degrade: (v) => (typeof v === 'number' ? Math.min(max, Math.max(min, v)) : undefined),
      };
    } else {
      supports[key] = { unit: meta.type };
    }
  }
  return createSurfaceAdapter({ id: 'web', supports });
}

// ---------------------------------------------------------------------------
// abilityModel → webSettings : the web SurfaceProfile, as a pure derivation
// ---------------------------------------------------------------------------
// The web SurfaceProfile is NOT a stored object — it is the rendering of the
// AbilityModel's modality-neutral `needs[]` into the web settings vocabulary.
// Each entry maps one neutral dimension to one or more web settings. A
// dimension with no entry simply isn't rendered on web (the surface will then
// report it as `unmet`, the honest cannot-satisfy signal).
export const WEB_DERIVATION = {
  textSize:      (v) => ({ fontScale: Math.round(Number(v) * 100) }), // multiplier → %
  lineSpacing:   (v) => ({ lineHeight: Number(v) }),
  letterSpacing: (v) => ({ letterSpacing: Number(v) }),
  reduceMotion:  (v) => ({ motionReducer: !!v }),
  darkTheme:     (v) => ({ darkMode: !!v }),
  captions:      (v) => ({ autoCaptions: !!v }),
  simplify:      (v) => ({ autoSimplify: !!v }),
  contrast:      (v) => ({ contrastMode: v === true ? 'light' : v }),
  dyslexiaFont:  (v) => ({ dyslexiaFont: !!v }),
  readAloudRate: (v) => ({ speechRate: Number(v) }),
};

/**
 * Derive baseline web settings from an AbilityModel. Returns
 * `{ settings, strengthByKey, unmet }`. Empty `needs[]` (every current user)
 * returns the empty triple — the inertness short-circuit. On a collision the
 * stronger need wins (ties: last need wins). `unmet` lists ability needs whose
 * dimension has NO web rendering (e.g. a cross-app dimension) — that is the
 * genuine web cannot-satisfy signal. Values are left raw; the caller clamps.
 */
export function deriveWebSettings(abilityModel) {
  const settings = {};
  const strengthByKey = {};
  const unmet = [];
  const needs = (abilityModel && abilityModel.needs) || [];
  if (!needs.length) return { settings, strengthByKey, unmet };
  for (const need of needs) {
    const fn = WEB_DERIVATION[need.dimension];
    if (!fn) { unmet.push({ key: need.dimension, value: need.value, reason: 'unsupported' }); continue; }
    const out = fn(need.value);
    const s = need.strength || 'preference';
    for (const [k, v] of Object.entries(out)) {
      if (k in settings && rankOf(s) < rankOf(strengthByKey[k])) continue; // weaker loses
      settings[k] = v;
      strengthByKey[k] = s;
    }
  }
  return { settings, strengthByKey, unmet };
}

/**
 * Resolve the web surface's view of the user's preferences. Composes the
 * authoritative merge (`getEffectivePreferences`, UNCHANGED) with the derived
 * ability baseline UNDER it, then runs the result through the web
 * SurfaceAdapter for an honest cannot-satisfy verdict.
 *
 * Identity by construction: the response starts from the authoritative merge
 * VERBATIM and never drops or alters a key the merge produced — so for today's
 * empty-needs data, `settings === prefs.settings` exactly (same keys, values,
 * and order), regardless of whether a key is in the registry, a string-typed
 * numeric, etc. The derived baseline only FILLS keys the merge did NOT set (a
 * real record at any strength beats it; derived values are clamped to range).
 * `surface.unmet` reports ABILITY NEEDS the web can't render — NOT arbitrary
 * merge keys — so it is empty for every current user and the content.js
 * cannot-satisfy branch stays silent. Full strength-aware composition (a derived
 * FLOOR tightening a soft pref) is deferred until structured needs exist.
 *
 * @param {{ librarian: object, settingsMeta: object, url: string, contexts?: string[] }} args
 */
export async function resolveWebPreferences({ librarian, settingsMeta, url, contexts = [] }) {
  const prefs = await librarian.getEffectivePreferences(url, contexts);
  const model = await librarian.getAbilityModel();
  const { settings: derived, unmet } = deriveWebSettings(model);

  const settings = { ...prefs.settings };
  const provenance = { ...(prefs.provenance || {}) };
  for (const [k, v] of Object.entries(derived)) {
    if (!(k in settings)) {
      settings[k] = coerceSetting(k, v, settingsMeta);
      provenance[k] = 'derived:ability';
    }
  }
  return {
    ...prefs,
    settings,
    provenance,
    surface: { unmet, satisfied: unmet.length === 0 },
  };
}

export default createWebSurface;
