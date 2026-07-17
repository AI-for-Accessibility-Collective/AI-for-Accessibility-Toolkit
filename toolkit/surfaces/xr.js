// XR SurfaceAdapter — renders an AbilityModel as XR presentation parameters.
//
// The flagship cross-surface scenario from the architecture diagrams and the
// refactor plan: the person onboards ONCE (web, mobile, anywhere), and an XR
// host renders the same understanding with device-appropriate units — angular
// text size instead of CSS percentages, world-locked captions instead of
// <track> elements.
//
// The host supplies sensor readings through its Sensors port (see
// toolkit/core/ports.js); this module is pure math over model + sensors.

// Comfortable reading is ~0.35° of visual angle per lowercase x-height for
// typical vision (legibility threshold ≈0.2°; comfort sits well above it).
const BASE_TEXT_ANGULAR_DEG = 0.35;

/**
 * @param {ReturnType<import('../core/ability-model.js').emptyAbilityModel>} model
 * @param {object} [sensors]
 * @param {number} [sensors.fovDegrees=90]        - headset horizontal FOV
 * @param {number} [sensors.viewingDistanceM=1.5] - typical UI panel distance
 * @returns {object} XR rendering parameters
 */
export function renderXRSettings(model, sensors = {}) {
  const fov = sensors.fovDegrees ?? 90;
  const distance = sensors.viewingDistanceM ?? 1.5;

  // Angular size scales with the model's relative text need — the XR
  // equivalent of fontScale. Also expressed as world height at the panel
  // distance so engines can size text meshes directly.
  const textAngularSizeDeg = BASE_TEXT_ANGULAR_DEG * model.text.size;
  const textWorldHeightM = 2 * distance * Math.tan((textAngularSizeDeg * Math.PI / 180) / 2);

  return {
    text: {
      angularSizeDeg: round3(textAngularSizeDeg),
      worldHeightM: round3(textWorldHeightM),
      lineSpacing: model.text.lineSpacing,
      font: model.text.font,
    },
    // Keep primary UI inside the comfortable central cone; narrower FOV or
    // low-vision users get UI pulled further toward the gaze center.
    ui: {
      maxEccentricityDeg: round3(Math.min(fov / 2, model.text.size > 1.2 ? 20 : 30)),
      largeTargets: model.input.pointer === 'large-target',
      highContrast: model.vision.contrast === 'high',
      darkEnvironmentPreferred: model.vision.lightPreference === 'dark',
    },
    captions: {
      enabled: model.audio.captions,
      // World-locked at panel distance, sized like body text.
      placement: 'world-locked',
      distanceM: distance,
    },
    describeScene: model.vision.descriptions, // narrate salient visuals aloud
    motion: {
      reduced: model.motion === 'reduced',
      // Vection (illusory self-motion) is the XR-specific hazard behind
      // "reduce motion": cut locomotion acceleration and vignette instead.
      comfortVignette: model.motion === 'reduced',
      snapTurning: model.motion === 'reduced',
    },
    speech: { rate: model.audio.speechRate },
    simplifyLanguage: model.cognition.language === 'plain',
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
