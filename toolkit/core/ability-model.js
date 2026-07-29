// AbilityModel — the modality-agnostic understanding of a person's abilities.
//
// Phase 1 of the toolkit refactor plan: the ability profile used to blend
// *what we understand* ("needs larger text") with *how the web renders it*
// (`fontScale: 150`, a CSS percentage). That welds the understanding to one
// surface. This module is the split:
//
//   AbilityModel  (this file)         — device-independent understanding
//   SurfaceProfile (toolkit/surfaces) — per-app rendering of that model
//
// The same model renders as fontScale on the web, angular text size in XR
// (FOV-aware), and verbosity/prompt context in a describe-the-world app.
//
// Conventions:
// - All magnitudes are RELATIVE multipliers around 1.0 (1.5 = "50% more than
//   a typical default"), never device units (no CSS %, no degrees, no pt).
// - Enums name the need, not the mechanism ('reduced' motion, not
//   'motionReducer: true').
// - Every dimension carries a confidence in model.confidence so consumers
//   can decide whether to act, suggest, or ask.

export const ABILITY_MODEL_VERSION = 1;

// Web setting ranges (mirror personalized-extension/skills/registry.js
// settingsMeta). The clamp bounds below are derived from these so the model
// never pins a legal web value to a boundary that renders back to a
// different number — deriveAbilityModel ∘ renderWebSettings must round-trip.
const WEB_LINE_HEIGHT_MIN = 1.0;
const WEB_LINE_HEIGHT_MAX = 3.0;
const WEB_LETTER_SPACING_MAX = 0.5; // em

// letterSpacing (em) → model multiplier; shared with the ceiling derivation.
function letterSpacingToModel(em) {
  return 1 + (em / 0.12) * 0.5;
}

/** A neutral model: typical defaults, zero confidence. */
export function emptyAbilityModel() {
  return {
    schemaVersion: ABILITY_MODEL_VERSION,
    supportAreas: [],
    freeText: '',
    text: {
      size: 1.0,          // relative multiplier (0.5–2.0)
      lineSpacing: 1.0,   // relative multiplier (1.0 = typical)
      letterSpacing: 1.0, // relative multiplier (1.0 = typical)
      font: 'standard',   // 'standard' | 'dyslexia-friendly'
    },
    vision: {
      contrast: 'standard',      // 'standard' | 'high' (device-independent)
      contrastStyle: null,       // the specific high-contrast variant, when known ('light' | 'yellow-black') — preserved so the web polarity round-trips
      lightPreference: 'standard', // 'standard' | 'dark'
      colorVision: 'typical',    // 'typical' | 'protanopia' | 'deuteranopia' | 'tritanopia'
      descriptions: false,       // needs described visuals (images, video)
    },
    motion: 'standard',          // 'standard' | 'reduced'
    audio: {
      captions: false,           // needs visual alternative to audio
      speechRate: 1.0,           // TTS rate multiplier
    },
    input: {
      pointer: 'standard',       // 'standard' | 'large-target'
      keyboard: false,           // relies on keyboard navigation
      voice: false,              // relies on voice control
    },
    cognition: {
      simplify: false,           // simpler language helps
      summarize: false,          // summaries of long content help
      focusSupport: false,       // reduced distraction helps
      progressCues: null,        // true = wants them, false = avoid (sensory), null = no signal
      language: 'standard',      // 'standard' | 'plain'
    },
    confidence: {},              // dimension path → 0..1
    derivedAt: null,
    sources: [],                 // provenance: 'profile' | 'settings' | 'memory'
  };
}

// Web settings → model derivation table for booleans/enums. Numbers are
// handled explicitly below because they need unit conversion.
const BOOLEAN_MAP = [
  ['dyslexiaFont',    (m) => { m.text.font = 'dyslexia-friendly'; },     'text.font'],
  ['darkMode',        (m) => { m.vision.lightPreference = 'dark'; },     'vision.lightPreference'],
  ['autoDescribe',    (m) => { m.vision.descriptions = true; },          'vision.descriptions'],
  ['autoVideoDescribe', (m) => { m.vision.descriptions = true; },        'vision.descriptions'],
  ['motionReducer',   (m) => { m.motion = 'reduced'; },                  'motion'],
  ['autoCaptions',    (m) => { m.audio.captions = true; },               'audio.captions'],
  ['largeCursor',     (m) => { m.input.pointer = 'large-target'; },      'input.pointer'],
  ['keyboardNav',     (m) => { m.input.keyboard = true; },               'input.keyboard'],
  ['voiceCommands',   (m) => { m.input.voice = true; },                  'input.voice'],
  ['autoSimplify',    (m) => { m.cognition.simplify = true; m.cognition.language = 'plain'; }, 'cognition.simplify'],
  ['autoSummarize',   (m) => { m.cognition.summarize = true; },          'cognition.summarize'],
  ['focusMode',       (m) => { m.cognition.focusSupport = true; },       'cognition.focusSupport'],
  ['hideDistractions',(m) => { m.cognition.focusSupport = true; },       'cognition.focusSupport'],
];

/**
 * Derive an AbilityModel from what exists today: the ability profile
 * (supportAreas + freeText + metaPreferences) and the person's effective
 * *general-scope* web settings (the strongest available signal of need —
 * they chose these values, on whatever surface they were using).
 *
 * Deterministic and lossy-by-design in one direction only: web settings are
 * one RENDERING of the model, so deriving model-from-settings then
 * re-rendering settings-from-model must round-trip (tested).
 *
 * @param {object} profile  - Librarian ability profile (mine.profile shape)
 * @param {object} settings - general-scope web settings (fontScale, darkMode, ...)
 * @param {{ now?: number }} [opts]
 */
export function deriveAbilityModel(profile = {}, settings = {}, opts = {}) {
  const m = emptyAbilityModel();
  m.supportAreas = profile.supportAreas || [];
  m.freeText = profile.freeText || '';
  m.derivedAt = opts.now ?? null;

  const conf = (path, value, source) => {
    m.confidence[path] = Math.max(m.confidence[path] || 0, value);
    if (!m.sources.includes(source)) m.sources.push(source);
  };

  // Profile-declared understanding (onboarding): moderate confidence.
  if (m.supportAreas.length || m.freeText) conf('supportAreas', 0.8, 'profile');
  if (profile.metaPreferences?.language === 'plain') {
    m.cognition.language = 'plain';
    conf('cognition.language', 0.9, 'profile');
  }

  // Settings-derived understanding: the person (or their accepted proposals)
  // set these — high confidence.
  if (typeof settings.fontScale === 'number' && settings.fontScale !== 100) {
    m.text.size = clamp(settings.fontScale / 100, 0.5, 2.0);
    conf('text.size', 0.9, 'settings');
  }
  if (typeof settings.lineHeight === 'number' && settings.lineHeight !== 1.5) {
    // Web default line-height baseline is 1.5 → relative multiplier. Clamp
    // bounds are the web range [1.0, 3.0] mapped through /1.5, so every
    // legal lineHeight round-trips through renderWebSettings.
    m.text.lineSpacing = clamp(settings.lineHeight / 1.5, WEB_LINE_HEIGHT_MIN / 1.5, WEB_LINE_HEIGHT_MAX / 1.5);
    conf('text.lineSpacing', 0.9, 'settings');
  }
  if (typeof settings.letterSpacing === 'number' && settings.letterSpacing > 0) {
    // 0.12em is the WCAG 1.4.12 reference amount → maps to 1.5x. Ceiling is
    // the model value at the web max (0.5em) so the legal maximum round-trips.
    m.text.letterSpacing = clamp(1 + (settings.letterSpacing / 0.12) * 0.5, 1.0, letterSpacingToModel(WEB_LETTER_SPACING_MAX));
    conf('text.letterSpacing', 0.9, 'settings');
  }
  if (settings.contrastMode && settings.contrastMode !== 'none') {
    m.vision.contrast = 'high';
    // Keep the specific variant so a chosen polarity (e.g. yellow-on-black for
    // photosensitivity) isn't silently flipped to white-on-black on round-trip.
    m.vision.contrastStyle = settings.contrastMode;
    conf('vision.contrast', 0.9, 'settings');
  }
  const colorFilter = settings.colorFilter || settings.colorBlindMode;
  if (colorFilter && colorFilter !== 'none') {
    m.vision.colorVision = colorFilter;
    conf('vision.colorVision', 0.9, 'settings');
  }
  if (typeof settings.speechRate === 'number' && settings.speechRate !== 1) {
    m.audio.speechRate = clamp(settings.speechRate, 0.5, 2.0);
    conf('audio.speechRate', 0.9, 'settings');
  }
  if (settings.showProgress === true) m.cognition.progressCues = true;
  if (settings.showProgress === false) m.cognition.progressCues = false;

  for (const [key, apply, path] of BOOLEAN_MAP) {
    if (settings[key] === true) {
      apply(m);
      conf(path, 0.9, 'settings');
    }
  }

  return m;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
