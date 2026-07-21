// Ability profiles — data integrity, merge semantics, and evidence-based
// regression guards. Pure (no DOM, no AI). Exercises the real settings.js
// merge/apply logic against the real settings.json data.
//
// Run: node tools/test/profiles-test.js
import {
  profiles, defaults, mergeProfileTools, applyProfiles, getSettings,
  getEnabledAdapters, getAllProfiles,
} from '../profiles/settings.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// Every setting a profile is allowed to enable. Kept in sync with the settings
// vocabulary (personalized-extension/skills/registry.js `settingsMeta`) plus
// `fixContrast`, which the basic extension + CLI consume directly. A profile key
// outside this set is a dead setting nothing applies.
const RECOGNIZED = new Set([
  'autoCaptions', 'autoDescribe', 'autoFixLabels', 'autoSimplify', 'autoSummarize',
  'autoVideoDescribe', 'autoWcagFix', 'bigTargets', 'colorBlindMode', 'contrastMode', 'darkMode',
  'dismissOverlays', 'dyslexiaFont', 'enhanceFocus', 'focusMode', 'fontScale', 'hideDistractions',
  'keyboardNav', 'largeCursor', 'letterSpacing', 'lineHeight', 'motionReducer',
  'readerMode', 'readingGuide', 'showProgress', 'speechRate', 'voiceCommands',
  'fixContrast',
]);
const NUMERIC_RANGE = { fontScale: [50, 300], lineHeight: [1, 3], letterSpacing: [0, 1], speechRate: [0.3, 4] };
const EXPECTED_PROFILES = ['blind', 'lowVision', 'colorBlind', 'deaf', 'motor', 'dyslexia', 'adhd', 'cognitive', 'elderly', 'anxiety', 'sensory', 'photosensitive'];

// ── SHAPE / INTEGRITY ─────────────────────────────────────────────────────────
check('all 12 expected profiles are present', EXPECTED_PROFILES.every(id => profiles[id]) && Object.keys(profiles).length === 12);

for (const id of EXPECTED_PROFILES) {
  const p = profiles[id];
  check(`${id}: has a name and description`, typeof p.name === 'string' && p.name.length > 0 && typeof p.description === 'string' && p.description.length > 0);
  check(`${id}: has a tools object`, p.tools && typeof p.tools === 'object' && Object.keys(p.tools).length > 0);
  for (const [key, val] of Object.entries(p.tools || {})) {
    check(`${id}.${key}: is a recognized setting`, RECOGNIZED.has(key));
    if (NUMERIC_RANGE[key]) {
      const [lo, hi] = NUMERIC_RANGE[key];
      check(`${id}.${key}=${val}: is a number in [${lo}, ${hi}]`, typeof val === 'number' && val >= lo && val <= hi);
    } else {
      // Non-numeric known keys are booleans or short enum strings, never junk.
      check(`${id}.${key}: is boolean or string`, typeof val === 'boolean' || typeof val === 'string');
    }
  }
}

check('defaults exists and is an object', defaults && typeof defaults === 'object');
check('getAllProfiles lists all 12 with id/name', getAllProfiles().length === 12 && getAllProfiles().every(p => p.id && p.name));

// ── EVIDENCE-BASED REGRESSION GUARDS ──────────────────────────────────────────
// Deaf/HoH is about sound, not sight: captions ON, visual description OFF.
check('deaf: captions on', profiles.deaf.tools.autoCaptions === true);
check('deaf: image description OFF (regression guard)', profiles.deaf.tools.autoDescribe === false);
check('deaf: video description OFF (regression guard)', profiles.deaf.tools.autoVideoDescribe === false);
check('deaf: getEnabledAdapters never enables alt-text', !getEnabledAdapters('deaf').includes('generate-alt'));
// Blind: the full screen-reader stack.
check('blind: image description ON', profiles.blind.tools.autoDescribe === true);
check('blind: wcag fixes + labels ON', profiles.blind.tools.autoWcagFix === true && profiles.blind.tools.autoFixLabels === true);
check('blind: getEnabledAdapters enables alt-text + labels + wcag', (() => {
  const a = getEnabledAdapters('blind');
  return a.includes('generate-alt') && a.includes('generate-labels') && a.includes('wcag-fixes');
})());
// Photosensitive: reduce motion + dark by default.
check('photosensitive: motion reduced + dark mode', profiles.photosensitive.tools.motionReducer === true && profiles.photosensitive.tools.darkMode === true);
// Color blindness: contrast fixing on.
check('colorBlind: fixContrast on → fix-contrast adapter', profiles.colorBlind.tools.fixContrast === true && getEnabledAdapters('colorBlind').includes('fix-contrast'));

// ── MERGE SEMANTICS ───────────────────────────────────────────────────────────
// Numeric settings take the MAX across combined profiles (biggest text wins).
{
  const a = 'lowVision', b = 'dyslexia';
  const fa = profiles[a].tools.fontScale, fb = profiles[b].tools.fontScale;
  if (typeof fa === 'number' && typeof fb === 'number') {
    check('merge: fontScale takes the max of combined profiles', mergeProfileTools([a, b]).fontScale === Math.max(fa, fb));
  } else {
    check('merge: fontScale present when either profile sets it', typeof mergeProfileTools([a, b]).fontScale === 'number' || (fa === undefined && fb === undefined));
  }
}
// Booleans are a union: any profile enabling a feature wins, regardless of order.
check('merge: boolean union — deaf+blind enables description (blind wins over deaf false)',
  mergeProfileTools(['deaf', 'blind']).autoDescribe === true && mergeProfileTools(['blind', 'deaf']).autoDescribe === true);
check('merge: boolean union keeps deaf captions when combined with blind',
  mergeProfileTools(['deaf', 'blind']).autoCaptions === true);
check('merge: an enabled feature is never turned back off by a profile that omits it',
  mergeProfileTools(['photosensitive', 'motor']).motionReducer === true);
check('merge: empty list merges to nothing', Object.keys(mergeProfileTools([])).length === 0);
check('merge: unknown profile id is ignored, not thrown', (() => { try { return typeof mergeProfileTools(['nope']) === 'object'; } catch { return false; } })());

// ── APPLY ─────────────────────────────────────────────────────────────────────
// applyProfiles must layer merged tools over defaults into the live settings.
{
  const ok = applyProfiles(['blind']);
  const s = getSettings();
  check('apply: applyProfiles(["blind"]) succeeds', ok === true);
  check('apply: live settings reflect the profile (autoDescribe on)', s.autoDescribe === true);
  check('apply: live settings still carry the defaults', Object.keys(defaults).every(k => k in s));
}
{
  applyProfiles(['deaf', 'photosensitive']);
  const s = getSettings();
  check('apply: combined profiles union into live settings', s.autoCaptions === true && s.motionReducer === true && s.darkMode === true);
  check('apply: deaf’s description-off survives the combination', s.autoDescribe === false || s.autoDescribe === undefined ? true : false);
}
check('apply: empty selection clears profile overrides back to defaults', (() => {
  applyProfiles(['deaf']);                         // deaf forces autoDescribe:false (default is true)
  const overridden = getSettings().autoDescribe === false;
  applyProfiles([]);                               // reset
  return overridden && getSettings().autoDescribe === defaults.autoDescribe;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
