// Cross-surface adaptation in ~20 lines — the toolkit's core idea, runnable
// with zero setup: no API key, no browser, no build.
//
//   node examples/cross-surface.mjs
//
// One person's abilities → one device-independent needs model → rendered
// natively for the web AND for XR. "Onboard once, adapt everywhere."

import { toAbilityModel } from '../toolkit/core/ability.js';
import { renderWebSettings } from '../toolkit/surfaces/web.js';
import { renderXRSettings } from '../toolkit/surfaces/xr.js';

// A low-vision person: what onboarding captured, projected the same way
// `librarian.getAbilityModel()` projects a stored profile — supportAreas /
// freeText plus modality-neutral needs[] (dimension, value, strength).
const profile = {
  supportAreas: ['vision'],
  freeText: 'small text is hard to read',
  fields: {
    needs: [
      { dimension: 'textSize', value: 1.5, strength: 'floor', source: 'onboarding' },
      { dimension: 'contrast', value: 'light', strength: 'preference', source: 'onboarding' },
      { dimension: 'darkTheme', value: true, strength: 'preference', source: 'onboarding' },
    ],
  },
  metaPreferences: {},
};

// One device-independent understanding of them.
const model = toAbilityModel(profile);
console.log('AbilityModel (device-independent, needs-based):');
console.log('  supportAreas:', model.supportAreas.join(', '));
console.log('  needs:', model.needs.map((n) => `${n.dimension}=${JSON.stringify(n.value)} (${n.strength})`).join(', '), '\n');

// The SAME model, rendered for two very different devices:
console.log('→ Web browser renders:');
console.log('  ', renderWebSettings(model), '\n');

const xr = renderXRSettings(model, { fovDegrees: 100, viewingDistanceM: 1.2 });
console.log('→ XR headset renders (FOV 100°, panel at 1.2m):');
console.log('   text', xr.text.angularSizeDeg + '° of visual angle',
            `(${(xr.text.worldHeightM * 1000).toFixed(0)}mm tall)`);
console.log('   dark environment:', xr.ui.darkEnvironmentPreferred,
            '| high contrast:', xr.ui.highContrast,
            '| UI within', xr.ui.maxEccentricityDeg + '° of gaze center');
