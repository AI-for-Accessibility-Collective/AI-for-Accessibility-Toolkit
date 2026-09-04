// Onboarding derivation test — the first-class blind vs low-vision distinction.
// The EXPLICIT visionKind must drive the baseline; the free-text keyword
// heuristic is only a fallback. Pure (no server boot beyond importing the module).
//
//   node onboarding/test/derive-needs.test.mjs

import { deriveDefaultNeeds, isBlindText } from '../server.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

const dims = (needs) => needs.map((n) => n.dimension).sort();
const isBlindBaseline = (needs) => needs.some((n) => n.dimension === 'describeImages') && needs.every((n) => n.strength === 'floor') && !needs.some((n) => n.dimension === 'textSize');
const isLowVisionBaseline = (needs) => needs.some((n) => n.dimension === 'textSize') && needs.some((n) => n.dimension === 'contrast') && !needs.some((n) => n.dimension === 'describeImages');

// ── Explicit visionKind drives the baseline ───────────────────────────────
check('explicit blind → screen-reader baseline (floor)', isBlindBaseline(deriveDefaultNeeds(['vision'], "I'm blind", 'blind')));
check('explicit lowVision → magnification baseline', isLowVisionBaseline(deriveDefaultNeeds(['vision'], 'text is small', 'lowVision')));

// ── The explicit choice WINS over a misleading sentence (the whole point) ──
check('explicit lowVision overrides blind-sounding text', isLowVisionBaseline(deriveDefaultNeeds(['vision'], "I'm blind", 'lowVision')));
check('explicit blind overrides bigger-text text', isBlindBaseline(deriveDefaultNeeds(['vision'], 'I need bigger text', 'blind')));

// ── Fallback to the keyword heuristic when no explicit kind ────────────────
check('no kind + "I\'m blind" → falls back to blind', isBlindBaseline(deriveDefaultNeeds(['vision'], "I'm blind", undefined)));
check('no kind + "bigger text" → falls back to low vision', isLowVisionBaseline(deriveDefaultNeeds(['vision'], 'I need bigger text', undefined)));
check('no kind + no text → low-vision default', isLowVisionBaseline(deriveDefaultNeeds(['vision'], '', undefined)));

// ── Non-vision areas unaffected by visionKind ──────────────────────────────
check('reading area unaffected', dims(deriveDefaultNeeds(['reading'], '', 'blind')).join(',') === 'dyslexiaFont,lineSpacing,simplify');

// ── isBlindText heuristic sanity (still the fallback) ──────────────────────
check('isBlindText: "I am blind" true', isBlindText('I am blind') === true);
check('isBlindText: "colour blind" false', isBlindText('I am colour blind') === false);
check('isBlindText: "legally blind" false (retains vision)', isBlindText('I am legally blind') === false);
check('isBlindText: "screen reader" true', isBlindText('I use a screen reader') === true);

console.log(`\nOnboarding derivation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
