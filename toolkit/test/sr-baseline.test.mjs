// Screen-reader baseline test — a blind profile's structured needs must render
// to STRUCTURE/announcement settings (not magnification), and the two settings
// that were unreachable (fixLandmarks, readAloud) must now exist in the
// vocabulary. Mirrors the derivation onboarding writes for a blind user.
//
//   node toolkit/test/sr-baseline.test.mjs

import { renderWebSettings } from '../surfaces/web.js';
import { settingsMeta } from '../registry/tools.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

const blindModel = {
  schemaVersion: 1, supportAreas: ['vision'], freeText: "I'm blind", language: 'standard', needs: [
    { dimension: 'describeImages', value: true, strength: 'floor' },
    { dimension: 'labelControls', value: true, strength: 'floor' },
    { dimension: 'repairLandmarks', value: true, strength: 'floor' },
    { dimension: 'announceUpdates', value: true, strength: 'floor' },
    { dimension: 'spaAnnounce', value: true, strength: 'floor' },
    { dimension: 'skipLinks', value: true, strength: 'floor' },
  ],
};

const s = renderWebSettings(blindModel);

// ── The screen-reader baseline renders to real, wired settings ──
check('describeImages → autoDescribe', s.autoDescribe === true);
check('labelControls → autoFixLabels', s.autoFixLabels === true);
check('repairLandmarks → fixLandmarks', s.fixLandmarks === true);
check('announceUpdates → announceUpdates', s.announceUpdates === true);
check('spaAnnounce → spaFocus', s.spaFocus === true);
check('skipLinks → skipLinks', s.skipLinks === true);

// ── It must NOT be low-vision magnification (the whole point) ──
check('blind baseline has NO fontScale', !('fontScale' in s));
check('blind baseline has NO contrastMode', !('contrastMode' in s));
check('blind baseline has NO readAloud (screen reader owns the voice)', !('readAloud' in s));
// #9: an on-page heading navigator and keyboard-nav shortcuts are NOT in the
// blind baseline (a screen reader has its own heading nav; shortcuts can collide).
check('blind baseline has NO pageOutline (#9)', !('pageOutline' in s));
check('blind baseline has NO keyboardNav (#9)', !('keyboardNav' in s));

// The pageStructure/keyboardAccess dimensions still exist for OTHER profiles.
check('pageStructure → pageOutline dimension still available', renderWebSettings({ needs: [{ dimension: 'pageStructure', value: true }] }).pageOutline === true);
check('keyboardAccess → keyboardNav dimension still available', renderWebSettings({ needs: [{ dimension: 'keyboardAccess', value: true }] }).keyboardNav === true);

// ── The previously-unreachable settings now exist in the vocabulary ──
check('settingsMeta has fixLandmarks', !!settingsMeta.fixLandmarks && settingsMeta.fixLandmarks.type === 'boolean');
check('settingsMeta has readAloud', !!settingsMeta.readAloud && settingsMeta.readAloud.type === 'boolean');

// ── readAloud dimension is reachable for low-vision/dyslexic/cognitive ──
check('readAloud dimension → readAloud setting', renderWebSettings({ needs: [{ dimension: 'readAloud', value: true }] }).readAloud === true);

// ── Low-vision still gets magnification (regression guard) ──
const lowVision = renderWebSettings({ needs: [{ dimension: 'textSize', value: 1.5 }, { dimension: 'contrast', value: 'yellow-black' }] });
check('low-vision → fontScale 150', lowVision.fontScale === 150);
check('low-vision → contrastMode yellow-black', lowVision.contrastMode === 'yellow-black');

console.log(`\nScreen-reader baseline: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
