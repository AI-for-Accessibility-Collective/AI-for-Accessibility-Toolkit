// Mobile SurfaceAdapter — renders an AbilityModel as mobile OS accessibility
// settings (the iOS "Accessibility > Display & Text Size / Motion / Spoken
// Content" and Android "Accessibility > Display size and text / Accessibility
// features" vocabulary), the third rendering of the SAME needs model web.js
// and xr.js already render.
//
// The model here is the LIVE needs AbilityModel — the exact object
// `librarian.getAbilityModel()` returns (see toolkit/core/ability.js):
// `{ schemaVersion, supportAreas, freeText, language, readingLevel,
// confidence, needs[] }`, where each `needs[]` entry is a modality-neutral
// `{ dimension, value, strength, unit?, confidence?, source? }`. Like xr.js,
// this module reads needs[] directly — there is no separate mobile-specific
// dimension model.
//
// Vocabulary grounding (real OS settings this module's output keys mirror):
//   - text.scalePercent  → iOS "Larger Text" (Dynamic Type, a %-of-default
//     scale) / Android "Font size" slider (also percent-based).
//   - text.boldText      → iOS "Bold Text" / Android "Bold text" — a legibility
//     toggle OSes group with high-contrast display settings, so it is derived
//     from the same `contrast` need as `display.highContrast` (there is no
//     separate "boldText" needs dimension — see the LIMITS note in
//     docs/design/cross-surface-analysis.md).
//   - display.darkMode        → iOS/Android system Dark Mode.
//   - display.highContrast    → iOS "Increase Contrast" / Android "High
//     contrast text".
//   - display.reduceTransparency → iOS "Reduce Transparency" / Android
//     "Remove animations"-adjacent clarity setting; grouped with contrast
//     because both exist to make foreground content easier to distinguish
//     from its background for the same low-vision need.
//   - motion.reduceMotion  → iOS "Reduce Motion" / Android "Remove animations".
//   - media.captions       → iOS "Closed Captions + SDH" / Android "Captions".
//   - speech.rate          → iOS "Spoken Content > Speaking Rate" / Android
//     TalkBack speech rate — a unitless multiplier like XR's, 1.0 = system
//     default.
//   - simplifyLanguage     → no direct OS toggle; carried through like XR's
//     `simplifyLanguage` for a host (or an in-app reader) that offers one.
//   - touch.largeTargets / minTargetPt → neither OS exposes a single "make
//     tap targets bigger" switch; this is the toolkit's own derived
//     affordance (mirrors xr.js's `ui.largeTargets`), sized against the two
//     real baselines developers already design to: iOS Human Interface
//     Guidelines' 44pt minimum tappable target, and the 48dp minimum Android's
//     accessibility guidance recommends. Neutral models get the 44pt
//     iOS-HIG baseline; a `motor` support area (the same heuristic xr.js
//     uses) bumps it to the larger 48 figure.
//
// Pure — no `navigator`, no `window`, no platform globals. A host (a React
// Native bridge, a native iOS/Android conformer) calls this with the model it
// already has and maps the returned plain object onto its own accessibility
// APIs.

import { rankOf } from '../core/strength.js';

// Resolve needs[] into a dimension → winning-value map. Identical collision
// rule to xr.js / web-surface.js's deriveWebSettings: stronger strength wins,
// ties go to the later entry — so all three surfaces agree on one outcome
// for the same needs[].
/** @param {import('../core/ability.js').AbilityModel|null|undefined} model */
function resolveNeeds(model) {
  /** @type {Record<string, unknown>} */
  const winners = {};
  /** @type {Record<string, string>} */
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
// derivations consume, defaulting every unset dimension to its neutral
// value. Deliberately the same shape xr.js's needsToMagnitudes produces —
// one set of need names, three renderings (web / XR / mobile) — kept as a
// local copy rather than an import so each surface stays a single, readable
// file a platform team can fork without pulling in XR's geometry code; the
// two are asserted in sync by toolkit/test/cross-surface-translation-test.js.
/** @param {import('../core/ability.js').AbilityModel|null|undefined} model */
function needsToMagnitudes(model) {
  const w = resolveNeeds(model);
  return {
    textSize: typeof w.textSize === 'number' ? w.textSize : 1.0,
    lineSpacing: typeof w.lineSpacing === 'number' ? w.lineSpacing : 1.0,
    contrast: w.contrast ?? false,        // false | true | a variant string ('light' | 'yellow-black' | …)
    darkTheme: !!w.darkTheme,
    reduceMotion: !!w.reduceMotion,
    captions: !!w.captions,
    simplify: !!w.simplify,
    readAloudRate: typeof w.readAloudRate === 'number' ? w.readAloudRate : 1.0,
    // No needs dimension names a touch-target-size preference yet; 'motor'
    // support is the closest available signal (same heuristic xr.js uses for
    // `ui.largeTargets` — there is no web equivalent, since ambient CSS
    // hit-target sizing has no toolkit-owned dial).
    largeTarget: ((model && model.supportAreas) || []).includes('motor'),
  };
}

const MIN_TARGET_PT_DEFAULT = 44; // iOS Human Interface Guidelines baseline
const MIN_TARGET_PT_LARGE = 48;   // Android accessibility-guidance minimum

/**
 * @param {import('../core/ability.js').AbilityModel} model - the needs AbilityModel (librarian.getAbilityModel() shape)
 * @returns mobile OS accessibility settings:
 *   { text: {scalePercent, lineSpacing, boldText},
 *     display: {darkMode, highContrast, reduceTransparency},
 *     motion: {reduceMotion},
 *     media: {captions},
 *     speech: {rate},
 *     simplifyLanguage,
 *     touch: {largeTargets, minTargetPt} }
 *   A neutral (empty-needs) model renders every value at its OS default —
 *   no phantom adaptations.
 */
export function renderMobileSettings(model) {
  const mags = needsToMagnitudes(model);
  const highContrast = !!mags.contrast;

  return {
    text: {
      scalePercent: Math.round(mags.textSize * 100),
      lineSpacing: mags.lineSpacing,
      // See the module header: OSes group "bold text" with high-contrast
      // display settings, so it rides the same `contrast` need rather than
      // needing its own dimension.
      boldText: highContrast,
    },
    display: {
      darkMode: mags.darkTheme,
      highContrast,
      reduceTransparency: highContrast,
    },
    motion: {
      reduceMotion: mags.reduceMotion,
    },
    media: {
      captions: mags.captions,
    },
    speech: {
      rate: mags.readAloudRate,
    },
    simplifyLanguage: mags.simplify,
    touch: {
      largeTargets: mags.largeTarget,
      minTargetPt: mags.largeTarget ? MIN_TARGET_PT_LARGE : MIN_TARGET_PT_DEFAULT,
    },
  };
}

export default renderMobileSettings;
