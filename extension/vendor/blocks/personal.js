// The person's own settings the blocks read, from their toolkit profile.
//
// What a builder sets is a default: where the profile says something about
// the same thing (how fast speech is, the reading level, text size, reduced
// motion, contrast), the profile wins. Only what the profile actually says
// is here; a missing key means "not asked for", and the builder's value or
// the block's default applies.
//
// Pure: the browser runtime computes this once per sync from profile_get and
// hands it to every adapter's blocks.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** @param {object} profile  what profile_get returns as `profile` */
export function personalFromProfile(profile) {
  const out = {};
  const fields = (profile && profile.fields) || {};
  const needs = Array.isArray(fields.needs) ? fields.needs : [];
  for (const need of needs) {
    if (!need || typeof need !== 'object') continue;
    const v = need.value;
    switch (need.dimension) {
      case 'readAloudRate': if (Number.isFinite(Number(v))) out.speechRate = clamp(Number(v), 0.5, 2); break;
      case 'textSize': if (Number.isFinite(Number(v))) out.textScale = clamp(Number(v), 1, 3); break;
      case 'reduceMotion': out.reduceMotion = !!v; break;
      case 'darkTheme': out.darkTheme = !!v; break;
      case 'contrast': if (v) out.contrast = v === true ? 'more' : String(v); break;
      case 'simplify': if (v) out.simplify = true; break;
      default: break;
    }
  }
  const level = fields.readingLevel;
  if (level === 'plain' || level === 'easy-read') out.readingLevel = level;
  else if (level !== null && level !== undefined && Number.isFinite(parseInt(level, 10))) out.readingLevel = clamp(parseInt(level, 10), 1, 12);
  const style = profile && profile.metaPreferences && profile.metaPreferences.language;
  if (!out.readingLevel && (style === 'plain' || out.simplify)) out.readingLevel = 'plain';
  delete out.simplify;
  return Object.freeze(out);
}

/** What each personal key means, for the docs. */
export const PERSONAL_KEYS = Object.freeze({
  speechRate: 'Speaking rate, 0.5-2 (profile need readAloudRate). Overrides speech.say({ rate }).',
  readingLevel: "'plain', 'easy-read' or a grade 1-12 (profile readingLevel, or plain language). Overrides ai.text({ readingLevel }).",
  textScale: 'Text size multiplier, 1-3 (profile need textSize). Tooltips and panels scale their text by it.',
  reduceMotion: 'true when the profile asks for reduced motion. Bands and scrolling stop animating, as with the system setting.',
  contrast: "'more' or a contrast mode when the profile asks for more contrast.",
  darkTheme: 'true when the profile asks for a dark theme.',
});
