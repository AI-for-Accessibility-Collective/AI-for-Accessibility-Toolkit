/**
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns {Record<string, any>} web settings (subset of the registry's settingsMeta keys)
 */
export function renderWebSettings(model: import("../core/ability.js").AbilityModel): Record<string, any>;
/**
 * Same derivation as renderWebSettings, but returns the full
 * `{ settings, strengthByKey, unmet }` triple, so a host can handle the
 * need dimensions the web surface cannot render instead of having them
 * dropped with only a console warning.
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns {ReturnType<typeof deriveWebSettings>} `{ settings, strengthByKey, unmet }`
 */
export function renderWebSettingsWithUnmet(model: import("../core/ability.js").AbilityModel): ReturnType<typeof deriveWebSettings>;
import { deriveWebSettings } from '../platforms/chrome/web-surface.js';
//# sourceMappingURL=web.d.ts.map