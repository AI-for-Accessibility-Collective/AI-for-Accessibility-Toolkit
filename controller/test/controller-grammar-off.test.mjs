// Grammar "off" coverage — every boolean toggle must recognize its common
// off phrasings, because a voice-first user who asks to turn a setting off
// and gets it turned ON hears a confident confirmation of the wrong action.
// Regression test for the class of bug where negation was a hand-kept phrase
// list per setting ("dark mode off" used to turn dark mode on).
//
//   node controller/test/controller-grammar-off.test.mjs

import { parse } from '../grammar.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ── off phrasings resolve to false ─────────────────────────────────────────
const offCases = [
  // [utterance, key]
  ['turn dark mode off', 'darkMode'],
  ['dark mode off', 'darkMode'],
  ['turn off dark mode', 'darkMode'],
  ['no more dark mode', 'darkMode'],
  ['disable dark mode', 'darkMode'],
  ['light mode', 'darkMode'],
  ['focus mode off', 'focusMode'],
  ['turn off focus mode', 'focusMode'],
  ['stop focus mode', 'focusMode'],
  ['dyslexia font off', 'dyslexiaFont'],
  ['turn off the dyslexia font', 'dyslexiaFont'],
  ['reading guide off', 'readingGuide'],
  ['remove the reading ruler', 'readingGuide'],
  ['big cursor off', 'largeCursor'],
  ['normal cursor', 'largeCursor'],
  ['turn off the large cursor', 'largeCursor'],
  ['big targets off', 'bigTargets'],
  ['turn off big buttons', 'bigTargets'],
  ['motion reducer off', 'motionReducer'],
  ['turn off reduce motion', 'motionReducer'],
  ['allow animations again', 'motionReducer'],
  ['show distractions', 'hideDistractions'],
  ['bring back the ads', 'hideDistractions'],
];
for (const [u, key] of offCases) {
  const i = parse(u);
  check(`off: "${u}" → ${key} false`, i && i.type === 'adapt' && i.changes[key] === false);
}

// contrast is an enum, off means 'none'
for (const u of ['contrast off', 'high contrast off', 'turn off high contrast', 'no contrast']) {
  const i = parse(u);
  check(`off: "${u}" → contrastMode none`, i && i.changes.contrastMode === 'none');
}

// ── determiners in front of the noun ───────────────────────────────────────
// "turn off MY dark mode" is how people actually speak, and a rule that
// accepted only "the" sent every one of these to the POSITIVE rule: the person
// asked for a setting off and heard a confident confirmation it was on. One
// case per (toggle x determiner) so a determiner accepted by one rule and not
// another fails loudly here rather than in someone's browser.
const DETERMINERS = ['', 'the', 'my', 'your', 'a', 'an'];
const detCases = [
  // [phrase with a DET slot, key, expected value when off]
  ['turn off DET dark mode', 'darkMode', false],
  ['without DET dark theme', 'darkMode', false],
  ['disable DET focus mode', 'focusMode', false],
  ['turn off DET dyslexia font', 'dyslexiaFont', false],
  ['remove DET reading guide', 'readingGuide', false],
  ['disable DET big cursor', 'largeCursor', false],
  ['turn off DET big buttons', 'bigTargets', false],
  ['turn off DET motion reducer', 'motionReducer', false],
  ['stop hiding DET ads', 'hideDistractions', false],
  ['turn off DET high contrast', 'contrastMode', 'none'],
];
for (const [tpl, key, want] of detCases) {
  for (const d of DETERMINERS) {
    // norm() collapses the double space the empty determiner leaves behind.
    const u = tpl.replace('DET', d);
    const i = parse(u);
    check(`det: "${u}" -> ${key} ${JSON.stringify(want)}`, !!i && i.type === 'adapt' && i.changes[key] === want);
  }
}

// Contrast phrasings that the hand-written contrast rule used to miss outright
// (it required "no contrast" adjacent, so "no HIGH contrast" fell through to
// the positive rule and turned contrast ON).
for (const u of ['no high contrast', 'without high contrast', 'disable high contrast', 'less contrast', 'less high contrast']) {
  const i = parse(u);
  check(`off: "${u}" -> contrastMode none`, !!i && i.changes.contrastMode === 'none');
}

// ── on phrasings still resolve to true (no over-negation) ──────────────────
const onCases = [
  ['dark mode please', 'darkMode'],
  ['turn on dark mode', 'darkMode'],
  ['focus mode', 'focusMode'],
  ['dyslexia font', 'dyslexiaFont'],
  ['reading guide', 'readingGuide'],
  ['big cursor', 'largeCursor'],
  ['bigger buttons', 'bigTargets'],
];
for (const [u, key] of onCases) {
  const i = parse(u);
  check(`on: "${u}" → ${key} true`, i && i.changes[key] === true);
}

// The two deliberately special toggles: their positive phrasings use verbs
// that read as negations elsewhere, and must keep meaning "turn it on".
check('on: "remove distractions" still hides them', parse('remove distractions').changes.hideDistractions === true);
check('on: "hide ads" still hides them', parse('hide ads').changes.hideDistractions === true);
check('on: "stop motion" still reduces motion', parse('stop motion').changes.motionReducer === true);
check('on: "reduce motion" still reduces motion', parse('please reduce motion').changes.motionReducer === true);
check('on: "high contrast" still turns contrast on', parse('high contrast').changes.contrastMode === 'yellow-black');

console.log(`\nGrammar off-coverage: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
