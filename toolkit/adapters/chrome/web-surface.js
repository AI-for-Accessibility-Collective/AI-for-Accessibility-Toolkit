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

export default createWebSurface;
