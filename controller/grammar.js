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

  // — dark / light — negation first
  { re: /\b(light mode|no dark|turn off dark)\b/, build: (_m, u) => adapt(u, { changes: { darkMode: false }, say: 'Turning dark mode off' }) },
  { re: /\bdark( mode| theme)?\b/, build: (_m, u) => adapt(u, { changes: { darkMode: true }, say: 'Turning on dark mode' }) },

  // — contrast — negation first, then LOW (the 'light' level), then HIGH.
  // Order matters: "no/remove contrast" turns it off; "low/lower/reduce/soft
  // contrast" selects the low-contrast level; "high/more contrast" the high one.
  { re: /\b(no|remove|turn off) contrast\b/, build: (_m, u) => adapt(u, { changes: { contrastMode: 'none' }, say: 'Removing the contrast setting' }) },
  { re: /\b(low|lower|reduce|reduced|less|soft|softer)( the| a)? contrast\b|\blow[- ]?contrast\b/, build: (_m, u) => adapt(u, { changes: { contrastMode: 'light' }, say: 'Lowering the contrast' }) },
  { re: /\bhigh[- ]?contrast\b|\b(more|high|higher|strong|stronger) contrast\b/, build: (_m, u) => adapt(u, { changes: { contrastMode: 'yellow-black' }, say: 'Turning on high contrast' }) },

  // — motion —
  { re: /\b(reduce|stop|less|no) (motion|animation|animations)\b|\bmotion reducer\b/, build: (_m, u) => adapt(u, { changes: { motionReducer: true }, say: 'Reducing motion' }) },

  // — LIVE captions — the browser's own on-device captioning (Chrome Live
  // Caption), which captions ANY audio, including media with no caption track.
  // A different thing from a media file's own captions, so it must precede the
  // generic caption rules below — those would otherwise swallow "live".
  { re: /\b(no|stop|hide|turn off|switch off|disable|remove|drop) (the )?live (captions?|cc)\b|\blive captions? off\b/, build: (_m, u) => adapt(u, { changes: { liveCaptions: false }, say: 'Turning live captions off' }) },
  { re: /\b(show|turn on|switch on|enable|start|give me|put on|with) (the )?live (captions?|cc)\b|\blive captions? on\b|^live captions?$/, build: (_m, u) => adapt(u, { changes: { liveCaptions: true }, say: 'Turning live captions on' }) },

  // — captions — the media's OWN track (incl. "closed captions"). Negation first.
  { re: /\b(no|stop|hide|turn off|switch off|disable|remove|drop) (the )?(closed )?(captions?|subtitles?|cc)\b|\b(captions?|subtitles?) off\b/, build: (_m, u) => adapt(u, { changes: { showCaptions: false }, say: 'Turning captions off' }) },
  { re: /\b(show|turn on|switch on|enable|start|give me|put on|with) (the )?(closed )?(captions?|subtitles?|cc)\b|\b(captions?|subtitles?) on\b|^(closed )?(captions?|subtitles?)$/, build: (_m, u) => adapt(u, { changes: { showCaptions: true }, say: 'Turning captions on' }) },

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
  // Question lead-ins, so "what are my settings" still reads as a whole query.
  // NOTE: "about" is deliberately absent — "tell me about dark mode" should go
  // to the app, not flip a setting.
  'what', "what's", 'whats', 'are', 'is', 'show', 'tell',
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
  for (const k of ['darkMode', 'contrastMode', 'motionReducer', 'focusMode', 'hideDistractions', 'dyslexiaFont', 'readingGuide', 'largeCursor', 'bigTargets', 'showCaptions', 'liveCaptions']) {
    if (settingsMeta[k]) keys.add(k);
  }
  return [...keys];
}

/** Build the standard unrecognized Intent (grammar + router share one shape). */
export function noMatch(utterance) {
  return unrecognized(utterance, SUGGESTIONS);
}
