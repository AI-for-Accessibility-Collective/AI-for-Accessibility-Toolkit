// What a disclosure actually DOES to the page.
//
// The chain is: support areas → deriveDefaultNeeds (server.js) → renderWebSettings
// (the toolkit's own web surface) → the settings a receiver applies. /chat runs
// exactly this on every onboarding turn and at boot, so a person who says "I'm
// blind" sees the page change rather than filling in a form that does nothing.
//
// Covered here rather than only in the browser because it is the promise the
// surface makes, and CI does not run a browser. The needs→settings mapping
// itself belongs to the toolkit and is tested there; what this pins is that the
// onboarding areas reach it and produce the right KIND of adaptation.
//
//   node onboarding/test/profile-to-settings.test.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'onboard-settings-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';
delete process.env.GEMINI_API_KEY;

const { deriveDefaultNeeds } = await import('../server.js');
const { renderWebSettings } = await import('../../toolkit/surfaces/web.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

/** The whole chain, the way chat.js runs it. */
const settingsFor = (areas, freeText = '', visionKind) =>
  renderWebSettings({ supportAreas: areas, freeText, needs: deriveDefaultNeeds(areas, freeText, visionKind) });

// ── the case that started this: a dyslexia disclosure ────────────────────────
{
  const s = settingsFor(['reading'], 'I have dyslexia');
  check('a reading profile turns the dyslexia font on', s.dyslexiaFont === true);
  check('…and opens up the line height', typeof s.lineHeight === 'number' && s.lineHeight > 1);
  check('…and asks for simplified text', s.autoSimplify === true);
}

// ── the two opposite vision populations ──────────────────────────────────────
// A blind screen-reader user needs the OPPOSITE of magnification, so this is
// the mapping most costly to get wrong.
{
  const blind = settingsFor(['vision'], "I'm blind", 'blind');
  check('a blind profile does NOT magnify', blind.fontScale === undefined);
  check('a blind profile repairs structure instead', blind.fixLandmarks === true || blind.pageOutline === true);
  check('…and describes images', blind.autoDescribe === true);

  const low = settingsFor(['vision'], 'I have low vision', 'lowVision');
  check('a low-vision profile DOES magnify', typeof low.fontScale === 'number' && low.fontScale > 100);
  check('…and raises contrast', typeof low.contrastMode === 'string');
  check('a low-vision profile does not ask for image descriptions', low.autoDescribe === undefined);
}

// ── the other areas produce something a receiver can act on ──────────────────
{
  const hearing = settingsFor(['hearing'], 'I am deaf');
  check('a hearing profile turns captions on', hearing.showCaptions === true);

  const sensory = settingsFor(['sensory'], 'I get sensory overload');
  check('a sensory profile reduces motion', sensory.motionReducer === true);

  const attention = settingsFor(['attention'], 'I have ADHD');
  check('an attention profile simplifies', attention.autoSimplify === true);
  check('…and reduces motion', attention.motionReducer === true);
}

// ── merged profiles keep both halves ─────────────────────────────────────────
// "I am deaf and I have dyslexia" used to lose the hearing half at the routing
// layer; this is the other end of that story.
{
  const s = settingsFor(['hearing', 'reading'], 'I am deaf and I have dyslexia');
  check('a merged profile keeps the captions', s.showCaptions === true);
  check('…and the dyslexia font', s.dyslexiaFont === true);
}

// ── nothing to say means nothing applied ─────────────────────────────────────
// applyProfileSettings() skips an empty object, so a person with no profile
// never has their page altered by an empty derivation.
{
  check('an empty profile derives no settings', Object.keys(settingsFor([])).length === 0);
  check('an unknown area derives no settings', Object.keys(settingsFor(['nonsense'])).length === 0);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nProfile to settings: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
