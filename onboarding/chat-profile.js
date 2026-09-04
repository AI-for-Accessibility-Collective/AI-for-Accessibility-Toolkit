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

/** What to say after a profile update. Pure function of the server's answer. */
export function onboardingReply(d) {
  const areas = d.supportAreas && d.supportAreas.length ? d.supportAreas.join(', ') : 'none';
  const kind = d.visionKind
    ? ` (${d.visionKind === 'blind' ? 'screen-reader / no magnification' : 'low vision'})`
    : '';
  return `Got it — updated your profile. Support areas: ${areas}${kind}. Tell me more any time, or edit it on the onboarding page.`;
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
