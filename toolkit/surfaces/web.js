// Web SurfaceAdapter — renders an AbilityModel as web extension settings.
//
// The inverse of ability-model.js's derivation: model magnitudes (relative
// multipliers) become the CSS-unit settings the browser adapters consume
// (fontScale percentage, lineHeight, letterSpacing em). deriveAbilityModel ∘
// renderWebSettings must round-trip (tested in toolkit/test/).
//
// Only emits keys that differ from the neutral default, so the result can be
// merged over a user's existing settings without stomping unrelated choices.

/**
 * @param {ReturnType<import('../core/ability-model.js').emptyAbilityModel>} model
 * @returns {object} web settings (subset of the registry's settingsMeta keys)
 */
export function renderWebSettings(model) {
  const s = {};

  if (model.text.size !== 1.0) s.fontScale = Math.round(model.text.size * 100);
  if (model.text.lineSpacing !== 1.0) s.lineHeight = round2(model.text.lineSpacing * 1.5);
  if (model.text.letterSpacing !== 1.0) {
    // Inverse of the derivation: 1.5x ↔ 0.12em (WCAG 1.4.12 reference).
    s.letterSpacing = round2(((model.text.letterSpacing - 1) / 0.5) * 0.12);
  }
  if (model.text.font === 'dyslexia-friendly') s.dyslexiaFont = true;

  // Render the exact variant the user chose when we know it; fall back to
  // 'light' only for models that arrived from another surface without one.
  if (model.vision.contrast === 'high') s.contrastMode = model.vision.contrastStyle || 'light';
  if (model.vision.lightPreference === 'dark') s.darkMode = true;
  if (model.vision.colorVision !== 'typical') s.colorFilter = model.vision.colorVision;
  if (model.vision.descriptions) {
    s.autoDescribe = true;
    s.autoVideoDescribe = true;
  }

  if (model.motion === 'reduced') s.motionReducer = true;

  if (model.audio.captions) s.autoCaptions = true;
  if (model.audio.speechRate !== 1.0) s.speechRate = round2(model.audio.speechRate);

  if (model.input.pointer === 'large-target') s.largeCursor = true;
  if (model.input.keyboard) s.keyboardNav = true;
  if (model.input.voice) s.voiceCommands = true;

  if (model.cognition.simplify) s.autoSimplify = true;
  if (model.cognition.summarize) s.autoSummarize = true;
  if (model.cognition.focusSupport) {
    s.focusMode = true;
    s.hideDistractions = true;
  }
  if (model.cognition.progressCues === true) s.showProgress = true;
  if (model.cognition.progressCues === false) s.showProgress = false;

  return s;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
