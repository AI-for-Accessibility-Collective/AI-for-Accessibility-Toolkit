// Needs-model surfaces unit test (Phase 1 exit gate).
// Covers the LIVE needs AbilityModel (toolkit/core/ability.js#toAbilityModel)
// rendered through the web and XR SurfaceAdapters — the dead dimension model
// this file used to test is gone; this validates its replacement.
// Run: node toolkit/test/ability-model-test.js
import { toAbilityModel } from '../core/ability.js';
import { renderWebSettings } from '../surfaces/web.js';
import { renderXRSettings } from '../surfaces/xr.js';
import { createToolkit } from '../index.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ---- toAbilityModel projection --------------------------------------------
const neutralModel = toAbilityModel(null);
check('neutral/absent profile -> empty needs', neutralModel.needs.length === 0);

const lowVisionProfile = {
  supportAreas: ['vision', 'motor'],
  freeText: 'small text is hard to read',
  fields: {
    needs: [
      { dimension: 'textSize', value: 1.6, strength: 'floor', source: 'onboarding' },
      { dimension: 'contrast', value: 'light', strength: 'preference', source: 'onboarding' },
      { dimension: 'darkTheme', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'reduceMotion', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'captions', value: true, strength: 'preference', source: 'onboarding' },
    ],
  },
  metaPreferences: {},
};
const lowVisionModel = toAbilityModel(lowVisionProfile);
check('low-vision profile -> all 5 needs carried', lowVisionModel.needs.length === 5);
check('supportAreas carried', lowVisionModel.supportAreas.join(',') === 'vision,motor');

// ---- web surface -----------------------------------------------------------
const neutralWeb = renderWebSettings(neutralModel);
check('neutral model renders empty web settings', Object.keys(neutralWeb).length === 0);

const web = renderWebSettings(lowVisionModel);
check('web fontScale derives from textSize need (1.6 -> 160)', web.fontScale === 160);
check('web contrastMode derives from contrast need', web.contrastMode === 'light');
check('web darkMode derives from darkTheme need', web.darkMode === true);
check('web motionReducer derives from reduceMotion need', web.motionReducer === true);
check('web autoCaptions derives from captions need', web.autoCaptions === true);

// ---- XR surface --------------------------------------------------------------
const xrNeutral = renderXRSettings(neutralModel, { fovDegrees: 90, viewingDistanceM: 1.5 });
check('XR neutral: base angular size 0.35°', Math.abs(xrNeutral.text.angularSizeDeg - 0.35) < 1e-9);
check('XR neutral: captions off, motion standard', !xrNeutral.captions.enabled && !xrNeutral.motion.reduced);
check('XR neutral: no high contrast / dark env', !xrNeutral.ui.highContrast && !xrNeutral.ui.darkEnvironmentPreferred);

const xr = renderXRSettings(lowVisionModel, { fovDegrees: 90, viewingDistanceM: 1.5 });
check('XR text angular size scales with textSize need (0.35*1.6)', Math.abs(xr.text.angularSizeDeg - 0.56) < 1e-9);
check('XR angular size larger than the neutral model', xr.text.angularSizeDeg > xrNeutral.text.angularSizeDeg);
check('XR world height positive and plausible (<5cm at 1.5m)', xr.text.worldHeightM > 0 && xr.text.worldHeightM < 0.05);
check('XR captions enabled + world-locked', xr.captions.enabled === true && xr.captions.placement === 'world-locked');
check('XR motion comfort measures on', xr.motion.reduced && xr.motion.comfortVignette && xr.motion.snapTurning);
check('XR high contrast on from contrast need', xr.ui.highContrast === true);
check('XR dark environment preferred from darkTheme need', xr.ui.darkEnvironmentPreferred === true);
check('XR large-text pulls UI toward center (20°)', xr.ui.maxEccentricityDeg === 20);
check('XR large targets from motor support area', xr.ui.largeTargets === true);

// A model with no needs at all but a 'motor' support area still gets large
// targets in XR (the support-area heuristic is independent of needs[]).
const motorOnly = toAbilityModel({ supportAreas: ['motor'] });
check('XR large targets from motor support area alone', renderXRSettings(motorOnly).ui.largeTargets === true);

// ---- Librarian integration (in-memory ports, via the public SDK entry) -----
function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}
const toolsRegistry = { settingsMeta: { fontScale: { type: 'number', range: [50, 200] } } };
const { librarian } = createToolkit({ kv: memKV(), toolsRegistry });

(async () => {
  await librarian.setProfileField('supportAreas', ['vision']);
  await librarian.setProfileField('fields.needs', [{ dimension: 'textSize', value: 1.5, strength: 'floor' }]);
  const m = await librarian.getAbilityModel();
  check('librarian.getAbilityModel carries supportAreas', m.supportAreas.includes('vision'));
  check('librarian.getAbilityModel carries the structured need', m.needs.some((n) => n.dimension === 'textSize' && n.value === 1.5));
  check('model renders to web fontScale 150', renderWebSettings(m).fontScale === 150);
  check('model renders to XR angular size 0.525', Math.abs(renderXRSettings(m).text.angularSizeDeg - 0.525) < 1e-9);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
