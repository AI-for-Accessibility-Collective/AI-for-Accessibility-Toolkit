// chat-profile.js — the profile half of the chat surface, lifted out of chat.js
// so it can be tested without a browser.
//
// Chat onboarding is ADDITIVE and conversational: a new self-description MERGES
// with what is already known rather than replacing it ("I'm blind", then later
// "I also have dyslexia" → vision + reading). That merge is the logic most
// likely to go wrong silently, and it had no test.
//
// The full onboarding FORM replaces instead (it shows every field, so what you
// submit is what you meant). The two must not be confused: this file is the
// chat path only.

/**
 * Merge a newly detected self-description into what is already known.
 *
 * Support areas are unioned. Free text keeps its history, appended as a new
 * sentence, and is left alone when the new phrasing is already contained in it
 * (so repeating yourself does not grow the string forever). The vision kind is
 * recomputed from the COMBINED text, so adding an unrelated need can never
 * silently flip a blind profile to low-vision or the other way round.
 *
 * Pure: visionKindOf is passed in.
 *
 * @param {{supportAreas?: string[], freeText?: string}} prev  what is stored now
 * @param {{supportAreas: string[], freeText: string}} next    what was just detected
 */
export function mergeOnboarding(prev, next, visionKindOf) {
  const prevAreas = (prev && prev.supportAreas) || [];
  const prevText = ((prev && prev.freeText) || '').trim();

  const supportAreas = [...new Set([...prevAreas, ...next.supportAreas])];

  const freeText = (prevText && !prevText.toLowerCase().includes(next.freeText.toLowerCase()))
    ? prevText.replace(/[.\s]+$/, '') + '. ' + next.freeText
    : (prevText || next.freeText);

  // Only ask about vision when vision is actually one of the areas; otherwise
  // the field stays absent rather than being sent as a stale value.
  const visionKind = supportAreas.includes('vision') ? (visionKindOf(freeText) || undefined) : undefined;

  return { supportAreas, freeText, visionKind };
}

// How many adaptations to name before summarizing the rest. A blind profile
// applies eight or so at once, and a wall of them is not a useful answer.
const NAMED_CHANGES = 3;

// What to CALL each adaptation when speaking to the person it was applied for.
//
// Deliberately not the registry's settingsMeta descriptions. Those are written
// for developers and for LLM system prompts, so they carry implementation
// detail a person does not need mid-sentence: fixLandmarks reads "Add missing
// ARIA landmarks (main, navigation, banner, contentinfo) so screen-reader users
// can navigate by region", and fontScale reads "Font size percentage". Same
// setting, different audience, different words.
//
// Several keys deliberately share a label: showCaptions, liveCaptions and
// autoCaptions are three mechanisms for one thing a person asked for, and
// listing them separately describes our plumbing rather than their page.
// Duplicates are collapsed below.
//
// These are the 15 keys onboarding can derive today (every support area, both
// vision kinds). Anything outside the list falls back to the registry.
export const CHANGE_LABELS = {
  fontScale:       'larger text',
  contrastMode:    'higher contrast',
  lineHeight:      'more line spacing',
  dyslexiaFont:    'a dyslexia-friendly font',
  autoSimplify:    'simpler wording',
  motionReducer:   'no animations',
  showCaptions:    'captions',
  liveCaptions:    'captions',
  autoCaptions:    'captions',
  autoDescribe:    'image descriptions',
  autoFixLabels:   'form and button labels',
  fixLandmarks:    'page landmarks',
  skipLinks:       'skip links',
  announceUpdates: 'screen-reader announcements',
  spaFocus:        'screen-reader announcements',
};

/**
 * Say what actually changed on the page, in the person's terms.
 *
 * Onboarding applies settings immediately, so it has to REPORT them: a page
 * that rearranges itself with no explanation is worse than one that does
 * nothing.
 *
 * @param {object} applied  what the receiver reported it applied ({key: value})
 * @param {object} [meta]   settingsMeta, used only for keys with no label yet
 * @returns {string} a phrase like "larger text, higher contrast and 2 more", or ''
 */
export function appliedSummary(applied, meta) {
  const keys = Object.keys(applied || {});
  if (!keys.length) return '';

  const label = (k) => {
    if (CHANGE_LABELS[k]) return CHANGE_LABELS[k];
    // Fallback: the registry's wording, lowercased to sit mid-sentence unless
    // its first word carries its own capitals ("OpenDyslexic", "AI").
    const d = (meta && meta[k] && meta[k].description) || k;
    const firstWord = d.split(' ')[0];
    return /[A-Z]/.test(firstWord.slice(1)) ? d : d.charAt(0).toLowerCase() + d.slice(1);
  };

  // Collapse the keys that mean one thing to a person (the three caption
  // mechanisms), so the sentence describes their page and not our plumbing.
  const labels = [...new Set(keys.map(label))];
  const named = labels.slice(0, NAMED_CHANGES);
  const rest = labels.length - named.length;

  // With a remainder the "and" belongs to the count, not to the last item, or
  // the sentence reads "a, b and c, and 2 more".
  if (rest) return `${named.join(', ')}, and ${rest} more`;
  return named.length > 1
    ? named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1]
    : named[0];
}

/**
 * What to say after a profile update. Pure function of the server's answer,
 * plus what the page actually applied.
 */
export function onboardingReply(d, appliedText = '') {
  const areas = d.supportAreas && d.supportAreas.length ? d.supportAreas.join(', ') : 'none';
  const kind = d.visionKind
    ? ` (${d.visionKind === 'blind' ? 'screen-reader / no magnification' : 'low vision'})`
    : '';
  // Only claim a change when one happened: a profile that derives nothing
  // (motor, today) must not say the page was adapted.
  const changed = appliedText ? ` I've changed this page to match: ${appliedText}.` : '';
  return `Got it — updated your profile. Support areas: ${areas}${kind}.${changed} Tell me more any time, or edit it on the onboarding page.`;
}

/**
 * What to say after dropping the durable setting overrides. Note this does NOT
 * forget who the person is: support areas, free text and needs all survive.
 * That is what the Reset-profile button in Settings does instead.
 */
export function resetReply(d) {
  const forgotten = (d && d.forgotten) || [];
  const n = forgotten.length;
  if (!n) return 'You’re already on your profile — there were no changes to forget.';
  const keys = [...new Set(forgotten.map((f) => f.key))];
  return `Back to your profile — I forgot ${n} change${n === 1 ? '' : 's'} you'd made (${keys.join(', ')}). Your profile itself is unchanged.`;
}

/** Said when a reset is asked for before any profile exists. */
export const NO_PROFILE_TO_RESET =
  'There’s no profile set yet, so there’s nothing to go back to. Tell me about your needs (like “I’m blind”) and I’ll set one up.';

/**
 * The parts of the always-visible profile pill, as data.
 *
 * chat.js renders these with text nodes rather than innerHTML — the free text
 * is the person's own words and must never be injected as HTML — so this
 * returns strings to place, never markup.
 *
 * @returns {{empty: true} | {empty: false, uid: string, detail: string}}
 */
export function profilePill(uid, model) {
  if (!uid || !model) return { empty: true };
  const bits = [];
  if (model.supportAreas && model.supportAreas.length) bits.push(model.supportAreas.join(', '));
  if (model.freeText) bits.push('“' + model.freeText + '”');
  return { empty: false, uid, detail: bits.length ? ' · ' + bits.join(' · ') : '' };
}
