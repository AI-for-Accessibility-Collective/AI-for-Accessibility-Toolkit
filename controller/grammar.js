// Deterministic grammar — maps a controlled vocabulary of phrases onto Intents,
// with ZERO dependencies and no LLM. This is the always-on first lane of the
// router (see DESIGN.md); the optional LLM lane only runs when the grammar
// returns null.
//
// Rules are ordered; the first whose pattern matches wins. Negations ("light
// mode", "no contrast") are placed before their positive counterparts so they
// aren't shadowed. Every setting the grammar can touch is a real key in the
// registry `settingsMeta`, so the vocabulary and the receiver's honesty checks
// stay in sync automatically.

import { settingsMeta } from '../toolkit/registry/tools.js';
import { adapt, undo, query, command, unrecognized } from './intent.js';

// Relative numeric nudges use these step sizes; the router resolves them
// against the receiver's current value and clamps to the settingsMeta range.
const STEP = { fontScale: 10, lineHeight: 0.2, letterSpacing: 0.05, speechRate: 0.2 };

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Determiners a person naturally puts in front of the setting's noun: "turn
// off MY dark mode", "without A dark theme". Defined once and shared by every
// off rule, for the same reason the builder below exists at all: a determiner
// group hand-copied into each rule drifts, and the rule that gets missed does
// the OPPOSITE of what the person asked. Accepting only "the" is how "turn off
// my dark mode" turned dark mode ON.
const DET = '(?:(?:the|my|your|a|an)\\s+)?';

// Build the "off" rule for one boolean toggle. Matches the common off
// phrasings for the toggle's noun: "<noun> off" (which also covers "turn the
// <noun> off"), "turn off / switch off / disable / stop / remove / no /
// no more / without <noun>", each allowing a determiner, plus any per-toggle
// aliases in `extraSrc`.
// One shared builder instead of a hand-kept phrase list per setting: the
// hand-kept list is how "dark mode off" turned dark mode ON.
function offRule(nounSrc, changes, say, extraSrc) {
  const noun = `(?:${nounSrc})`;
  const parts = [
    `\\b${noun}\\s+off\\b`,
    `\\b(?:turn off|switch off|disable|stop|remove|no more|no|without)\\s+${DET}${noun}\\b`,
  ];
  if (extraSrc) parts.push(extraSrc);
  return { re: new RegExp(parts.join('|')), build: (_m, u) => adapt(u, { changes, say }) };
}

/** @type {Array<{re: RegExp, build: (m: RegExpMatchArray, u: string) => import('./intent.js').Intent}>} */
const RULES = [
  // — meta —
  { re: /\b(undo|revert)\b/, build: (_m, u) => undo(u) },

  // — read / query — (before settings so "read this" isn't caught by a font rule)
  { re: /\bread (this|it|the page|aloud|out ?loud|to me)\b/, build: (_m, u) => query(u, { ask: 'content', mode: 'text', say: 'Reading it aloud' }) },
  { re: /\bwhat('?s| is) (on (the )?screen|here|this)\b/, build: (_m, u) => query(u, { ask: 'content', mode: 'outline', say: 'Reading what is on screen' }) },
  { re: /\b((my|current) settings|what('?s| is) set)\b/, build: (_m, u) => query(u, { ask: 'context', say: 'Checking your settings' }) },
  { re: /\bhelp\b|\bwhat can i (say|do)\b|\b(list )?commands\b/, build: (_m, u) => query(u, { ask: 'help', say: 'Here are some things you can say' }) },

  // — speech rate — (before the generic spacing/font rules)
  { re: /\b(speak|read|talk|voice)\b.*\b(slow(er|ly)?)\b|\bslow(er)? (speech|voice|reading)\b/, build: (_m, u) => adapt(u, { deltas: { speechRate: -STEP.speechRate }, say: 'Slowing the speech down' }) },
  { re: /\b(speak|read|talk|voice)\b.*\b(fast(er)?|quick(er|ly)?)\b|\bfast(er)? (speech|voice|reading)\b/, build: (_m, u) => adapt(u, { deltas: { speechRate: +STEP.speechRate }, say: 'Speeding the speech up' }) },

  // — text size — absolute wins over relative
  { re: /\b(text|font)( size)?( to)? (\d{2,3}) ?%?\b/, build: (m, u) => adapt(u, { changes: { fontScale: Number(m[4]) }, say: `Setting text size to ${m[4]} percent` }) },
  { re: /\b(bigger|larger|increase|grow)\b.*\b(text|font)\b|\b(text|font)\b.*\b(bigger|larger)\b|\bzoom in\b/, build: (_m, u) => adapt(u, { deltas: { fontScale: +STEP.fontScale }, say: 'Making text bigger' }) },
  { re: /\b(smaller|reduce|decrease|shrink)\b.*\b(text|font)\b|\b(text|font)\b.*\bsmaller\b|\bzoom out\b/, build: (_m, u) => adapt(u, { deltas: { fontScale: -STEP.fontScale }, say: 'Making text smaller' }) },

  // — spacing —
  { re: /\b(more |extra )?(line )?spacing\b|\bspace out the lines\b/, build: (_m, u) => adapt(u, { deltas: { lineHeight: +STEP.lineHeight }, say: 'Increasing line spacing' }) },

  // — toggles off — before every positive toggle rule, so an off phrasing can
  // never fall through to the positive rule and do the opposite of what the
  // person asked. Contrast keeps its own line further down, next to the
  // positive contrast rule, but is built the same way.
  //
  // Distractions is the one toggle that CANNOT use the shared builder: the
  // builder's verb list contains "remove", and "remove distractions" means
  // HIDE them, not show them again. So it keeps a narrower hand-written rule.
  // Motion is safe in the builder because its noun is the compound
  // ("motion reducer" / "reduced motion"), so "stop motion" and "no motion"
  // still fall through to the positive rule and reduce motion, as intended.
  offRule('dark(?: mode| theme)?', { darkMode: false }, 'Turning dark mode off', '\\blight mode\\b'),
  offRule('focus mode', { focusMode: false }, 'Turning focus mode off'),
  offRule('dyslexi[ac](?: friendly)?(?: font)?', { dyslexiaFont: false }, 'Back to the standard font'),
  offRule('reading (?:guide|ruler)', { readingGuide: false }, 'Turning the reading guide off'),
  offRule('(?:large|big|bigger) cursor', { largeCursor: false }, 'Back to the normal cursor', '\\bnormal cursor\\b'),
  offRule('(?:big|large|bigger) (?:targets|buttons|controls)', { bigTargets: false }, 'Back to normal-size controls'),
  offRule('motion reducer|reduced? motion', { motionReducer: false }, 'Allowing motion again', '\\ballow (?:motion|animations?)(?: again)?\\b'),
  { re: new RegExp(`\\b(?:show|bring back|stop hiding) ${DET}(?:distractions?|ads)\\b`), build: (_m, u) => adapt(u, { changes: { hideDistractions: false }, say: 'Showing everything again' }) },

  // — dark / light —
  { re: /\bdark( mode| theme)?\b/, build: (_m, u) => adapt(u, { changes: { darkMode: true }, say: 'Turning on dark mode' }) },

  // — contrast — negation first
  offRule('(?:high[- ]?)?contrast', { contrastMode: 'none' }, 'Removing high contrast', `\\bless ${DET}(?:high[- ]?)?contrast\\b`),
  { re: /\bhigh[- ]?contrast\b|\bmore contrast\b/, build: (_m, u) => adapt(u, { changes: { contrastMode: 'yellow-black' }, say: 'Turning on high contrast' }) },

  // — motion —
  { re: /\b(reduce|stop|less|no) (motion|animation|animations)\b|\bmotion reducer\b/, build: (_m, u) => adapt(u, { changes: { motionReducer: true }, say: 'Reducing motion' }) },

  // — focus / distraction —
  { re: /\bfocus mode\b/, build: (_m, u) => adapt(u, { changes: { focusMode: true }, say: 'Turning on focus mode' }) },
  { re: /\b(hide|remove|dim) (distraction|distractions|ads|clutter)\b/, build: (_m, u) => adapt(u, { changes: { hideDistractions: true }, say: 'Hiding distractions' }) },

  // — reading aids —
  { re: /\bdyslexi[ac]( font)?\b/, build: (_m, u) => adapt(u, { changes: { dyslexiaFont: true }, say: 'Switching to a dyslexia-friendly font' }) },
  { re: /\breading (guide|ruler)\b/, build: (_m, u) => adapt(u, { changes: { readingGuide: true }, say: 'Turning on the reading guide' }) },

  // — motor —
  { re: /\b(large|big|bigger) cursor\b/, build: (_m, u) => adapt(u, { changes: { largeCursor: true }, say: 'Enlarging the cursor' }) },
  { re: /\b(big|large|bigger) (targets|buttons|controls)\b/, build: (_m, u) => adapt(u, { changes: { bigTargets: true }, say: 'Enlarging clickable controls' }) },

  // — commands (M4) — app actions through performAction —
  { re: /\bscroll (?:to (?:the )?)?(top|bottom|up|down)\b/, build: (m, u) => command(u, { action: 'scroll', target: m[1], say: `Scrolling ${m[1]}` }) },
  { re: /\bgo forward\b/, build: (_m, u) => command(u, { action: 'forward', say: 'Going forward' }) },
  { re: /\bgo back\b/, build: (_m, u) => command(u, { action: 'back', say: 'Going back' }) },
  // Navigation & search (before the generic activate rule, since "open" is
  // shared). navigate only fires when the target looks like a URL/domain, so
  // "open the menu" still falls through to activate. Both are gated at dispatch
  // on the receiver declaring the action.
  { re: /\b(?:go to|open|navigate to|visit|load)\s+((?:https?:\/\/)?[^\s]+\.[^\s]+)/, build: (m, u) => { const url = m[1].replace(/[.,!?]+$/, ''); return command(u, { action: 'navigate', target: url, text: url, say: `Opening ${url}` }); } },
  { re: /\bsearch(?:\s+for)?\s+(.+)/, build: (m, u) => { const q = m[1].replace(/[.?!]+$/, '').trim(); return command(u, { action: 'search', target: q, text: q, say: `Searching for ${q}` }); } },
  { re: /\b(?:click|press|tap|activate|open|select) (?:the |on |a )?(.+)/, build: (m, u) => { const t = cleanTarget(m[1]); return command(u, { action: 'activate', target: t, say: `Activating ${t}` }); } },
];

// Normalize a spoken target label: drop trailing punctuation and generic nouns.
function cleanTarget(s) {
  return String(s || '').replace(/["'.?!]+$/, '').replace(/\s+(link|button|tab|control|option)$/, '').trim();
}

// A handful of example phrases for the "didn't catch that" reply.
export const SUGGESTIONS = [
  'bigger text', 'dark mode', 'high contrast', 'reduce motion',
  'read this', "what's on screen", 'undo',
];

// First rule whose pattern matches the normalized utterance, with the match
// object (so callers can see WHERE in the utterance it matched, not just that
// it did).
function firstMatch(u) {
  for (const rule of RULES) {
    const m = u.match(rule.re);
    if (m) return { rule, m };
  }
  return null;
}

/**
 * Parse one utterance deterministically.
 * @param {string} utterance
 * @returns {import('./intent.js').Intent|null} an Intent, or null if nothing matched.
 */
export function parse(utterance) {
  const u = norm(utterance);
  if (!u) return null;
  const hit = firstMatch(u);
  return hit ? hit.rule.build(hit.m, utterance) : null;
}

// Lead-in words allowed before a whole-utterance command without making it
// "compound": politeness, articles, and imperative verbs ("make the text
// bigger"). A clause connector is deliberately NOT in here.
const PREFIX_FILLER = new Set([
  'please', 'could', 'can', 'would', 'will', 'you', 'hey', 'ok', 'okay', 'now',
  'i', "i'd", 'id', "i'll", 'like', 'want', 'to', "let's", 'lets', 'just',
  'make', 'set', 'turn', 'on', 'the', 'a', 'an', 'my', 'this', 'some', 'more',
  'it', 'them', 'give', 'me', 'use', 'put', 'go',
]);
// A second clause: another instruction tacked on. Any of these downstream of a
// match means the utterance is compound and must go to the app whole.
const CONNECTOR = /\b(and|then|also|plus|after that)\b|[,;]/;

/**
 * Does the grammar match consume (essentially) the WHOLE utterance?
 *
 * This is the guard that lets the Controller keep a deterministic fast path for
 * the settings vocabulary while it's driving a URL (`rawToTask`) WITHOUT
 * reintroducing the compound-instruction bug: "bigger text" / "dark mode" /
 * "undo" / "read this to me" map cleanly and stay deterministic; "open google
 * and search for apples" carries a second clause and is left for the app.
 *
 * True only when: a rule matched, it reaches the end (allowing trailing
 * punctuation/politeness), the lead-in is nothing but filler, and there is no
 * clause connector anywhere in the utterance.
 * @param {string} utterance
 * @returns {boolean}
 */
export function consumesWholeUtterance(utterance) {
  const u = norm(utterance);
  if (!u) return false;
  const hit = firstMatch(u);
  if (!hit || hit.m.index == null) return false;
  // A second clause (…and…, …then…, a comma) → compound → not whole.
  if (CONNECTOR.test(u)) return false;
  const start = hit.m.index;
  const end = start + hit.m[0].length;
  // Must reach the end, ignoring trailing punctuation and benign tails
  // (politeness + addressee/manner words like "to me", "aloud" that some rules
  // leave dangling, e.g. "read this" out of "read this to me").
  const suffix = u.slice(end)
    .replace(/\b(please|thanks|thank you|for me|to me|out ?loud|aloud|now)\b/g, '')
    .replace(/[.?!,;\s]+/g, '')
    .trim();
  if (suffix) return false;
  // The lead-in (if any) may only be filler words.
  const prefix = u.slice(0, start).trim();
  if (prefix && !prefix.split(/\s+/).every((w) => PREFIX_FILLER.has(w))) return false;
  return true;
}

/** Numeric step sizes, exposed so the router can resolve `deltas`. */
export { STEP };

/** All setting keys the grammar can produce — handy for tests/introspection. */
export function vocabularyKeys() {
  const keys = new Set();
  for (const k of Object.keys(STEP)) if (settingsMeta[k]) keys.add(k);
  for (const k of ['darkMode', 'contrastMode', 'motionReducer', 'focusMode', 'hideDistractions', 'dyslexiaFont', 'readingGuide', 'largeCursor', 'bigTargets']) {
    if (settingsMeta[k]) keys.add(k);
  }
  return [...keys];
}

/** Build the standard unrecognized Intent (grammar + router share one shape). */
export function noMatch(utterance) {
  return unrecognized(utterance, SUGGESTIONS);
}
