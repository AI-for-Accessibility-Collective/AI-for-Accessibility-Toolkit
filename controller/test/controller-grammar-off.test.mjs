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
