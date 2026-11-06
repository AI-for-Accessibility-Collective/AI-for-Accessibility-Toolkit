// The person's own settings the blocks read, from their toolkit profile.
//
// What a builder sets is a default: where the profile says something about
// the same thing (how fast speech is, text size, reduced motion, contrast,
// the reading level), the profile wins. The names are the settings
// vocabulary's (toolkit/registry/tools.js settingsMeta), and so are the
// blocks' config keys for the same things: `speechRate` is one thing,
// whether the person or the builder sets it.
//
// Two sources, as the Librarian's getEffectivePreferences merges them:
//   - the profile's needs, through the web surface's own derivation
//     (deriveWebSettings, the one place needs become web settings), so the
//     blocks and every other web host read a profile the same way;
//   - what the person set themselves (recordScopedSettings, "user-explicit"
//     records), for every site or for one site. These win over the needs,
//     and a site's own over every site's.
// Only what the profile actually says is here; a missing key means "not
// asked for".
//
// Pure: the browser runtime computes these once per sync and hands them to
// every adapter's blocks, which pick the page's site (personalForSite).

import { toAbilityModel } from '../core/ability.js';
import { deriveWebSettings } from '../platforms/chrome/web-surface.js';
import { personalFromSettings, clamp } from './personal-sites.js';

export { PERSONAL_KEYS, SETTABLE_KEYS, personalFromSettings, siteOf, explicitFromMemories, personalForSite } from './personal-sites.js';

/** @param {object} profile  what profile_get returns as `profile` */
export function personalFromProfile(profile) {
  const model = toAbilityModel(profile || null);
  const { settings } = deriveWebSettings(model);
  const out = personalFromSettings(settings);
  const level = model.readingLevel;
  if (level === 'plain' || level === 'easy-read') out.readingLevel = level;
  else if (level !== null && level !== undefined && Number.isFinite(parseInt(level, 10))) out.readingLevel = clamp(parseInt(level, 10), 1, 12);
  else if (model.language === 'plain' || settings.autoSimplify) out.readingLevel = 'plain';
  // The registered needs they have ("<appId>/<id>"), for the adapter that meets each.
  const needs = model.needs.filter(n => n.dimension.includes('/') && n.value !== false && n.value !== null && n.value !== undefined);
  if (needs.length) out.needs = Object.freeze(Object.fromEntries(needs.map(n => [n.dimension, n.value])));
  return Object.freeze(out);
}
