// AbilityModel + surfaces unit test (Phase 1 exit gate).
// Run: node toolkit/test/ability-model-test.js
import { emptyAbilityModel, deriveAbilityModel } from '../core/ability-model.js';
import { renderWebSettings } from '../surfaces/web.js';
import { renderXRSettings } from '../surfaces/xr.js';
import { createLibrarian } from '../core/librarian.js';
import { createDatastore } from '../core/datastore.js';
import { TAXONOMY } from '../core/taxonomy.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ---- derivation --------------------------------------------------------
const webSettings = {
  fontScale: 150, lineHeight: 2.0, letterSpacing: 0.12,
  darkMode: true, motionReducer: true, autoCaptions: true,
  largeCursor: true, keyboardNav: true, autoSimplify: true,
  colorFilter: 'deuteranopia', speechRate: 1.5, showProgress: false,
};
const profile = { supportAreas: ['vision', 'hearing'], freeText: 'small text is hard', metaPreferences: { language: 'plain' } };
const model = deriveAbilityModel(profile, webSettings, { now: 1000 });

check('text.size 150% → 1.5', model.text.size === 1.5);
check('lineHeight 2.0 → lineSpacing ~1.33', Math.abs(model.text.lineSpacing - 2.0 / 1.5) < 1e-9);
check('letterSpacing 0.12em → 1.5x', Math.abs(model.text.letterSpacing - 1.5) < 1e-9);
check('darkMode → lightPreference dark', model.vision.lightPreference === 'dark');
check('colorFilter → colorVision', model.vision.colorVision === 'deuteranopia');
check('motionReducer → motion reduced', model.motion === 'reduced');
check('autoCaptions → audio.captions', model.audio.captions === true);
check('largeCursor → pointer large-target', model.input.pointer === 'large-target');
check('keyboardNav → input.keyboard', model.input.keyboard === true);
check('autoSimplify → cognition plain language', model.cognition.simplify === true && model.cognition.language === 'plain');
check('speechRate carried', model.audio.speechRate === 1.5);
check('showProgress false → progressCues false (sensory)', model.cognition.progressCues === false);
check('supportAreas carried', model.supportAreas.join(',') === 'vision,hearing');
check('confidence recorded for text.size', model.confidence['text.size'] === 0.9);
check('sources include settings + profile', model.sources.includes('settings') && model.sources.includes('profile'));

// ---- web round-trip ------------------------------------------------------
const rendered = renderWebSettings(model);
check('round-trip fontScale', rendered.fontScale === 150);
check('round-trip lineHeight', rendered.lineHeight === 2.0);
check('round-trip letterSpacing', rendered.letterSpacing === 0.12);
check('round-trip darkMode', rendered.darkMode === true);
check('round-trip colorFilter', rendered.colorFilter === 'deuteranopia');
check('round-trip motionReducer', rendered.motionReducer === true);
check('round-trip autoCaptions', rendered.autoCaptions === true);
check('round-trip speechRate', rendered.speechRate === 1.5);
check('round-trip showProgress false', rendered.showProgress === false);
check('neutral model renders empty settings', Object.keys(renderWebSettings(emptyAbilityModel())).length === 0);

// Boundary round-trips: every legal web value must survive derive→render at
// the edges of its real range (registry.js settingsMeta), not just the middle.
function roundTrips(setting, value) {
  const m = deriveAbilityModel({}, { [setting]: value });
  const back = renderWebSettings(m)[setting];
  // A value equal to the neutral default is intentionally omitted on render.
  const neutral = { fontScale: 100, lineHeight: 1.5, letterSpacing: 0 }[setting];
  return value === neutral ? back === undefined : back === value;
}
check('round-trip lineHeight min 1.0', roundTrips('lineHeight', 1.0));
check('round-trip lineHeight max 3.0', roundTrips('lineHeight', 3.0));
check('round-trip lineHeight 1.1 (was collapsing to 1.13)', roundTrips('lineHeight', 1.1));
check('round-trip letterSpacing max 0.5', roundTrips('letterSpacing', 0.5));
check('round-trip letterSpacing 0.3', roundTrips('letterSpacing', 0.3));
check('round-trip fontScale min 50', roundTrips('fontScale', 50));
check('round-trip fontScale max 200', roundTrips('fontScale', 200));

// ---- XR surface -----------------------------------------------------------
const xr = renderXRSettings(model, { fovDegrees: 90, viewingDistanceM: 1.5 });
check('XR text angular size scales with model (0.35*1.5)', Math.abs(xr.text.angularSizeDeg - 0.525) < 1e-9);
check('XR world height positive and plausible (<5cm at 1.5m)', xr.text.worldHeightM > 0 && xr.text.worldHeightM < 0.05);
check('XR captions enabled + world-locked', xr.captions.enabled === true && xr.captions.placement === 'world-locked');
check('XR motion comfort measures on', xr.motion.reduced && xr.motion.comfortVignette && xr.motion.snapTurning);
check('XR large-text pulls UI toward center (20°)', xr.ui.maxEccentricityDeg === 20);
check('XR plain language flag', xr.simplifyLanguage === true);
const xrNeutral = renderXRSettings(emptyAbilityModel());
check('XR neutral: base angular size 0.35°', Math.abs(xrNeutral.text.angularSizeDeg - 0.35) < 1e-9);
check('XR neutral: captions off, motion standard', !xrNeutral.captions.enabled && !xrNeutral.motion.reduced);

// ---- Librarian integration (in-memory ports) --------------------------------
const mem = { local: {}, sync: {} };
function memArea(name) {
  return {
    get: async (key, def) => (mem[name][key] === undefined ? def : structuredClone(mem[name][key])),
    set: async (key, value) => { mem[name][key] = structuredClone(value); },
  };
}
const datastore = createDatastore({
  areas: { local: memArea('local'), sync: memArea('sync') },
  globalTier: {
    tools: () => ({
      settingsMeta: { fontScale: { type: 'number', range: [50, 200] } },
      settingsVocabularyLines: () => [],
      forPrompt: () => [],
    }),
    taxonomy: () => TAXONOMY,
  },
});
const librarian = createLibrarian({
  datastore: () => datastore,
  taxonomy: () => TAXONOMY,
  kv: {
    getAll: async () => structuredClone(mem.local),
    set: async (items) => { Object.assign(mem.local, structuredClone(items)); },
  },
});

(async () => {
  await librarian.setProfileField('supportAreas', ['vision']);
  await librarian.recordScopedSettings('general', { fontScale: 150, darkMode: true });
  const m = await librarian.getAbilityModel();
  check('librarian.getAbilityModel derives text.size from explicit settings', m.text.size === 1.5);
  check('librarian.getAbilityModel derives dark preference', m.vision.lightPreference === 'dark');
  check('librarian.getAbilityModel carries supportAreas', m.supportAreas.includes('vision'));
  check('model renders back to the same web settings', renderWebSettings(m).fontScale === 150);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
