// Cross-surface adaptation in ~20 lines — the toolkit's core idea, runnable
// with zero setup: no API key, no browser, no build.
//
//   node examples/cross-surface.mjs
//
// One person's abilities → one device-independent model → rendered natively
// for the web AND for XR. "Onboard once, adapt everywhere."

import { deriveAbilityModel } from '../toolkit/core/ability-model.js';
import { renderWebSettings } from '../toolkit/surfaces/web.js';
import { renderXRSettings } from '../toolkit/surfaces/xr.js';

// A low-vision person: what they told us (profile) + what they've set (settings).
const profile = { supportAreas: ['vision'], freeText: 'small text is hard to read' };
const settings = { fontScale: 150, darkMode: true, letterSpacing: 0.12 };

// One device-independent understanding of them.
const model = deriveAbilityModel(profile, settings);
console.log('AbilityModel (device-independent):');
console.log('  text size ×', model.text.size, '| light:', model.vision.lightPreference,
            '| letter spacing ×', model.text.letterSpacing.toFixed(2), '\n');

// The SAME model, rendered for two very different devices:
console.log('→ Web browser renders:');
console.log('  ', renderWebSettings(model), '\n');

const xr = renderXRSettings(model, { fovDegrees: 100, viewingDistanceM: 1.2 });
console.log('→ XR headset renders (FOV 100°, panel at 1.2m):');
console.log('   text', xr.text.angularSizeDeg + '° of visual angle',
            `(${(xr.text.worldHeightM * 1000).toFixed(0)}mm tall)`);
console.log('   dark environment:', xr.ui.darkEnvironmentPreferred,
            '| UI within', xr.ui.maxEccentricityDeg + '° of gaze center');
