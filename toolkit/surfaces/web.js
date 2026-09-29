// Web SurfaceAdapter — renders an AbilityModel as web extension settings.
//
// The model here is the LIVE needs AbilityModel — the exact object
// `librarian.getAbilityModel()` returns (see toolkit/core/ability.js):
// `{ schemaVersion, supportAreas, freeText, language, readingLevel,
// confidence, needs[] }`. The needs→web-settings mapping itself lives in ONE
// place — `WEB_DERIVATION` / `deriveWebSettings` in
// toolkit/platforms/chrome/web-surface.js — this module just exposes that
// derivation under the SurfaceAdapter shape the other surfaces (XR, …) use,
// so there is a single source of truth for "what does this need render as
// on the web".
//
// Only emits keys a needs[] entry actually produced, so the result can be
// merged over a user's existing settings without stomping unrelated choices.
// An empty `needs[]` (every current user, until structured needs are
// written) renders the empty object. A dimension with no web rendering —
// a cross-app dimension, or a typo — is warned about, never silently
// dropped; renderWebSettingsWithUnmet returns it in `unmet` instead.

import { deriveWebSettings } from '../platforms/chrome/web-surface.js';

/**
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns {Record<string, any>} web settings (subset of the registry's settingsMeta keys)
 */
export function renderWebSettings(model) {
  const { settings, unmet } = deriveWebSettings(model);
  if (unmet.length) {
    // Cast because the platform-agnostic tsconfig loads no dom/node lib, so
    // `console` has no type here; every real host (browser, node) has one.
    /** @type {any} */ (globalThis).console?.warn?.(
      `[ai4a11y] renderWebSettings: dropped ${unmet.length} need dimension(s) with no web rendering: `
      + unmet.map((u) => u.key).join(', ')
      + '. An unexpected name here is usually a typo — check the needs vocabulary in docs/GLOSSARY.md,'
      + ' or call renderWebSettingsWithUnmet() to handle the unmet needs yourself.',
    );
  }
  return settings;
}

/**
 * Same derivation as renderWebSettings, but returns the full
 * `{ settings, strengthByKey, unmet }` triple, so a host can handle the
 * need dimensions the web surface cannot render instead of having them
 * dropped with only a console warning.
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns {ReturnType<typeof deriveWebSettings>} `{ settings, strengthByKey, unmet }`
 */
export function renderWebSettingsWithUnmet(model) {
  return deriveWebSettings(model);
}
