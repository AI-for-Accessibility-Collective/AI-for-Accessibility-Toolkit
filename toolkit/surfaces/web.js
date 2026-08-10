// Web SurfaceAdapter — renders an AbilityModel as web extension settings.
//
// The model here is the LIVE needs AbilityModel — the exact object
// `librarian.getAbilityModel()` returns (see toolkit/core/ability.js):
// `{ schemaVersion, supportAreas, freeText, language, readingLevel,
// confidence, needs[] }`. The needs→web-settings mapping itself lives in ONE
// place — `WEB_DERIVATION` / `deriveWebSettings` in
// toolkit/adapters/chrome/web-surface.js — this module just exposes that
// derivation under the SurfaceAdapter shape the other surfaces (XR, …) use,
// so there is a single source of truth for "what does this need render as
// on the web".
//
// Only emits keys a needs[] entry actually produced, so the result can be
// merged over a user's existing settings without stomping unrelated choices.
// An empty `needs[]` (every current user, until structured needs are
// written) renders the empty object.

import { deriveWebSettings } from '../adapters/chrome/web-surface.js';

/**
 * @param {ReturnType<import('../core/ability.js').toAbilityModel>} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns {object} web settings (subset of the registry's settingsMeta keys)
 */
export function renderWebSettings(model) {
  return deriveWebSettings(model).settings;
}
