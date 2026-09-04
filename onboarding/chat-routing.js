// chat-routing.js — the PURE routing heuristics behind /chat, split out so they
// can be unit-tested in node (chat.js itself imports browser-only modules).
//
// One job: decide whether a message is the person DESCRIBING THEMSELVES ("I'm
// blind") — which updates their profile — or something else (a command, a
// request) that belongs to the grammar / the receiving app.
//
// The bias is deliberately toward "not onboarding": a false positive silently
// rewrites someone's accessibility profile, which is far worse than passing a
// message through. That's why the gate below is a self-description lead-in or a
// bare condition — an earlier "any short message containing a condition word"
// rule turned "stop live captions" into a hearing profile.

// A self-description lead-in: "I'm blind", "I have dyslexia", "my hearing…",
// "I can't use a mouse".
export const SELF = /\b(i['’]?m|i am|i['’]?ve|i have|i use|i get|i can'?t|i cannot|i need|i struggle|i find|my|me)\b/i;

// A message that is JUST the condition still counts, with no lead-in. Strict
// whitelist ON PURPOSE — see the note above.
export const BARE_CONDITION = /^(blind|deaf|dyslexi[ac]|adhd|autistic|autism|low vision|partially sighted|colou?r ?blind|hard of hearing|visually impaired|screen ?reader user)\.?$/i;

// Keywords are self-DESCRIPTION words. Words that also appear in COMMANDS
// ("captions", "reading", bare "hearing", "magnify") are deliberately excluded:
// those are the grammar's job, and here they only cause false onboarding.
export const AREA_RULES = [
  { area: 'vision', re: /\bblind\b|low vision|partially sighted|visually impaired|can'?t see|cannot see|screen ?reader|voice ?over|nvda|jaws|talkback/i },
  { area: 'reading', re: /dyslexi|trouble reading|hard to read|letters (move|jump)/i },
  { area: 'cognitive', re: /cognitive|memory|plain language|simple language|trouble understanding|comprehen/i },
  { area: 'motor', re: /motor|tremor|parkinson|keyboard only|can'?t use (a |the )?mouse|switch access|shaky hands|dexterity/i },
  { area: 'hearing', re: /\bdeaf\b|hard of hearing|hearing (loss|impair|aid)|\bhoh\b/i },
  { area: 'sensory', re: /sensory|overwhelm|overload|autis|flashing/i },
  { area: 'attention', re: /adhd|attention deficit|can'?t focus|hard to focus|distracted|can'?t concentrate|trouble concentrat/i },
];

/**
 * Which visual population does this describe? A blind screen-reader user needs
 * the OPPOSITE of magnification, so "vision" must never be treated as one
 * answer. Mirrors the server's isBlindText.
 * @returns {'blind'|'lowVision'|null}
 */
export function visionKindOf(text) {
  const s = String(text || '').toLowerCase();
  if (/colou?r[- ]?blind/.test(s)) return null; // a colour-vision deficiency, not blindness
  if (/screen ?reader|voice ?over|nvda|jaws|talkback|can'?t see|cannot see|totally blind|completely blind|\bblind\b/.test(s)
      && !/legally blind/.test(s)) return 'blind';
  if (/low vision|partially sighted|bigger text|magnif|too small|hard to see/.test(s)) return 'lowVision';
  return null;
}

// "Forget what I've changed, go back to my profile." A PROFILE operation, not a
// setting — it drops the durable user-explicit overrides so the profile is the
// source again. Kept here (not in the grammar) because the chat owns profile
// operations, and it must not be confused with `undo` (LIFO, one step) or with
// the Reset-profile button (which forgets WHO you are, not just what you changed).
// "go to settings" and "take me back to the settings page" are navigation,
// not a reset: a bare go/return needs "back to" and a settings noun that is
// not a page, tab, or screen; reset/restore/revert stand on their own.
const RESET_TO_PROFILE = /\b(reset|restore|revert)\b[^.]*\b(to |back to )?(my |the )?(profile|preferences|settings|defaults)\b|\bback to (my |the )?(profile|preferences|settings|defaults)\b(?!\s*(page|tab|screen|menu|section|view))|\bstart over\b|\bstart again\b|\bforget (what i('ve| have)? )?changed\b/i;
// …but "what are my settings" is a QUESTION the grammar answers, and "undo" is
// its own thing — never treat those as a reset. Matched as question FORMS, not
// bare keywords: a plain "what" must not veto "forget what I changed".
const NOT_RESET = /\bundo\b|\bwhat('?s| is| are)\b|\b(show|tell|list|check) (me )?(my |the )?(settings?|preferences?)\b|\b(go|navigate|take me|open|switch) to (the |my )?(profile|preferences|settings)\b(?! defaults)|\b(navigate|open|switch)\b[^.]*\b(profile|preferences|settings)\b/i;

/**
 * Does this message ask to go back to the profile?
 * @param {string} text
 * @returns {boolean}
 */
export function isResetToProfile(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (NOT_RESET.test(t)) return false;
  return RESET_TO_PROFILE.test(t);
}

/**
 * @param {string} text
 * @returns {{supportAreas:string[], freeText:string, visionKind?:string}|null}
 *   null when the message is NOT a self-description (i.e. leave it alone).
 */
export function detectOnboarding(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const areas = [];
  for (const r of AREA_RULES) if (r.re.test(t)) areas.push(r.area);
  if (!areas.length) return null;
  // It must READ as a self-description, or be nothing but the condition itself.
  if (!SELF.test(t) && !BARE_CONDITION.test(t)) return null;
  const visionKind = areas.includes('vision') ? (visionKindOf(t) || undefined) : undefined;
  return { supportAreas: [...new Set(areas)], freeText: t, visionKind };
}
