// XR SurfaceAdapter — renders an AbilityModel as XR presentation parameters.
//
// The flagship cross-surface scenario from the architecture diagrams and the
// refactor plan: the person onboards ONCE (web, mobile, anywhere), and an XR
// host renders the same understanding with device-appropriate units — angular
// text size instead of CSS percentages, world-locked captions instead of
// <track> elements.
//
// The model here is the LIVE needs AbilityModel — the exact object
// `librarian.getAbilityModel()` returns (see toolkit/core/ability.js):
// `{ schemaVersion, supportAreas, freeText, language, readingLevel,
// confidence, needs[] }`, where each `needs[]` entry is a modality-neutral
// `{ dimension, value, strength, unit?, confidence?, source? }`. There is no
// separate "dimension model" (text.size / vision.contrast / …) anymore —
// this module reads needs[] directly.
//
// The host supplies sensor readings through its Sensors port (see
// toolkit/ports/index.js); this module is pure math over model + sensors.

import { rankOf } from '../core/strength.js';

// Comfortable reading is ~0.35° of visual angle per lowercase x-height for
// typical vision (legibility threshold ≈0.2°; comfort sits well above it).
const BASE_TEXT_ANGULAR_DEG = 0.35;

// Resolve needs[] into a dimension → winning-value map. A collision (two
// needs targeting the same dimension) resolves the same way the web
// derivation does: stronger strength wins, ties go to the later entry.
function resolveNeeds(model) {
  const winners = {};
  const strengthByDim = {};
  const needs = (model && model.needs) || [];
  for (const need of needs) {
    if (!need || !need.dimension) continue;
    const s = need.strength || 'preference';
    if (need.dimension in winners && rankOf(s) < rankOf(strengthByDim[need.dimension])) continue;
    winners[need.dimension] = need.value;
    strengthByDim[need.dimension] = s;
  }
  return winners;
}

// Collapse the needs AbilityModel into the plain magnitudes this module's
// geometry consumes, defaulting every unset dimension to its neutral value.
// The dimension names mirror platforms/chrome/web-surface.js's WEB_DERIVATION
// (the live needs→web mapping) so XR and web read the exact same vocabulary
// — one set of need names, two renderings.
function needsToMagnitudes(model) {
  const w = resolveNeeds(model);
  return {
    textSize: typeof w.textSize === 'number' ? w.textSize : 1.0,
    lineSpacing: typeof w.lineSpacing === 'number' ? w.lineSpacing : 1.0,
    dyslexiaFont: !!w.dyslexiaFont,
    contrast: w.contrast ?? false,        // false | true | a variant string ('light' | 'yellow-black' | …)
    darkTheme: !!w.darkTheme,
    reduceMotion: !!w.reduceMotion,
    captions: !!w.captions,
    simplify: !!w.simplify,
    readAloudRate: typeof w.readAloudRate === 'number' ? w.readAloudRate : 1.0,
    // No needs dimension names a pointer-size preference yet; 'motor'
    // support is the closest available signal for this XR-only affordance
    // (there is no web equivalent — large hit-targets are ambient there).
    largeTarget: ((model && model.supportAreas) || []).includes('motor'),
  };
}

/**
 * @param {ReturnType<import('../core/ability.js').toAbilityModel>} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @param {object} [sensors]
 * @param {number} [sensors.fovDegrees=90]        - headset horizontal FOV
 * @param {number} [sensors.viewingDistanceM=1.5] - typical UI panel distance
 * @returns {object} XR rendering parameters
 */
export function renderXRSettings(model, sensors = {}) {
  const fov = sensors.fovDegrees ?? 90;
  const distance = sensors.viewingDistanceM ?? 1.5;
  const mags = needsToMagnitudes(model);

  // Angular size scales with the model's relative text need — the XR
  // equivalent of fontScale. Also expressed as world height at the panel
  // distance so engines can size text meshes directly.
  const textAngularSizeDeg = BASE_TEXT_ANGULAR_DEG * mags.textSize;
  const textWorldHeightM = 2 * distance * Math.tan((textAngularSizeDeg * Math.PI / 180) / 2);
  const highContrast = !!mags.contrast;

  return {
    text: {
      angularSizeDeg: round3(textAngularSizeDeg),
      worldHeightM: round3(textWorldHeightM),
      lineSpacing: mags.lineSpacing,
      font: mags.dyslexiaFont ? 'dyslexia-friendly' : 'standard',
    },
    // Keep primary UI inside the comfortable central cone; narrower FOV or
    // low-vision users get UI pulled further toward the gaze center.
    ui: {
      maxEccentricityDeg: round3(Math.min(fov / 2, mags.textSize > 1.2 ? 20 : 30)),
      largeTargets: mags.largeTarget,
      highContrast,
      darkEnvironmentPreferred: mags.darkTheme,
    },
    captions: {
      enabled: mags.captions,
      // World-locked at panel distance, sized like body text.
      placement: 'world-locked',
      distanceM: distance,
    },
    // No needs dimension carries a "describe visuals aloud" request yet —
    // kept in the output shape (neutral false) so consumers don't need a
    // presence check.
    describeScene: false,
    motion: {
      reduced: mags.reduceMotion,
      // Vection (illusory self-motion) is the XR-specific hazard behind
      // "reduce motion": cut locomotion acceleration and vignette instead.
      comfortVignette: mags.reduceMotion,
      snapTurning: mags.reduceMotion,
    },
    speech: { rate: mags.readAloudRate },
    simplifyLanguage: mags.simplify,
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
