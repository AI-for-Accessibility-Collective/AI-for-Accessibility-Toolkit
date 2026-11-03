// The person's own settings the blocks read, from their toolkit profile.
//
// What a builder sets is a default: where the profile says something about
// the same thing (how fast speech is, text size, reduced motion, contrast,
// the reading level), the profile wins. The names are the settings
// vocabulary's (toolkit/registry/tools.js settingsMeta), and so are the
// blocks' config keys for the same things: `speechRate` is one thing,
// whether the person or the builder sets it.
//
// The values come from the web surface's own derivation (deriveWebSettings,
// the one place the profile's needs become web settings), so the blocks and
// every other web host read a profile the same way. Only what the profile
// actually says is here; a missing key means "not asked for".
//
// Pure: the browser runtime computes this once per sync from profile_get and
// hands it to every adapter's blocks.

import { toAbilityModel } from '../core/ability.js';
import { deriveWebSettings } from '../platforms/chrome/web-surface.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** What each personal key means, for the docs. */
export const PERSONAL_KEYS = Object.freeze({
  speechRate: 'Speaking rate, 0.5-2. speech.say({ speechRate }) uses the profile\'s over yours.',
  fontScale: 'Text size in percent, 100-200. Tooltips and panels scale their text by it (their `fontScale`).',
  motionReducer: 'true when the profile asks for reduced motion. Bands and scrolling stop animating, as with the system setting.',
  contrastMode: "'light' or 'yellow-black' when the profile asks for more contrast.",
  darkMode: 'true when the profile asks for a dark theme.',
  readingLevel: "'plain', 'easy-read' or a grade 1-12 (the profile's reading level, or plain language). ai.text({ readingLevel }) uses the profile's over yours.",
});

/** @param {object} profile  what profile_get returns as `profile` */
export function personalFromProfile(profile) {
  const model = toAbilityModel(profile || null);
  const { settings } = deriveWebSettings(model);
  const out = {};
  if (Number.isFinite(Number(settings.speechRate))) out.speechRate = clamp(Number(settings.speechRate), 0.5, 2);
  if (Number.isFinite(Number(settings.fontScale))) out.fontScale = clamp(Math.round(Number(settings.fontScale)), 100, 200);
  if (settings.motionReducer) out.motionReducer = true;
  if (settings.contrastMode && settings.contrastMode !== 'none') out.contrastMode = String(settings.contrastMode);
  if (settings.darkMode) out.darkMode = true;
  const level = model.readingLevel;
  if (level === 'plain' || level === 'easy-read') out.readingLevel = level;
  else if (level !== null && level !== undefined && Number.isFinite(parseInt(level, 10))) out.readingLevel = clamp(parseInt(level, 10), 1, 12);
  else if (model.language === 'plain' || settings.autoSimplify) out.readingLevel = 'plain';
  return Object.freeze(out);
}
