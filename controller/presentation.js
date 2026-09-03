// presentation.js — the Controller renders ITSELF through the operator's
// AbilityModel. Same intent capture, N presentations (see DESIGN.md): the
// person operating the Controller picks its own I/O, not the app being driven.
//
// This is a PURE derivation (AbilityModel → a presentation spec). The web UI
// (M2) consumes the spec to decide which inputs to show, whether to speak
// feedback, how terse to be, how big the targets are. Keeping it pure means it
// is testable with no DOM and reusable by a future native Controller UI.
//
// Input is the needs AbilityModel — `librarian.getAbilityModel()` shape:
// `{ supportAreas[], freeText, needs[], … }`. We read supportAreas (the seven
// onboarding areas: vision, reading, cognitive, motor, hearing, sensory,
// attention) and combine them by "most accommodating wins" — if two areas ask
// for different things, offer both rather than pick one.

/**
 * @typedef {Object} ControllerPresentation
 * @property {{voice:boolean, text:boolean, scan:boolean, primary:'voice'|'text'}} input
 * @property {{speech:boolean, text:boolean, captions:boolean, primary:'speech'|'text'}} output
 * @property {'concise'|'normal'|'detailed'} verbosity
 * @property {'plain'|'standard'} language
 * @property {'normal'|'large'} targetSize
 * @property {number} stepsAtATime          How many options/steps to present at once (1 = one at a time).
 * @property {boolean} confirmActions        Ask before risky/final actions.
 */

/**
 * @param {{supportAreas?: string[]}} [model]  the needs AbilityModel.
 * @returns {ControllerPresentation}
 */
// Neutral needs dimensions that mean "this operator uses a screen reader" (from
// a blind profile). Their AT owns the voice.
const SCREEN_READER_DIMS = new Set([
  'describeImages', 'labelControls', 'repairLandmarks', 'announceUpdates',
  'spaAnnounce', 'skipLinks', 'pageStructure', 'keyboardAccess',
]);

export function deriveControllerPresentation(model = {}) {
  const areas = new Set(Array.isArray(model && model.supportAreas) ? model.supportAreas : []);
  const has = (a) => areas.has(a);
  // A screen-reader operator (their profile carries screen-reader needs). Their
  // own AT announces the live region in their voice — so the Controller must
  // NEVER speak feedback with a second speechSynthesis voice over it (issue #7).
  const needs = Array.isArray(model && model.needs) ? model.needs : [];
  const assistiveTech = needs.some((n) => n && SCREEN_READER_DIMS.has(n.dimension));

  // ── Output ──
  // Speak feedback when it helps (vision, reading) — but NOT for a screen-reader
  // user (assistiveTech), who gets it via the live region in their own voice.
  // ALWAYS show text; caption (force-show text) for hearing.
  const speech = !assistiveTech && (has('vision') || has('reading'));
  const captions = has('hearing');
  let outPrimary = 'text';
  if (has('vision') && !assistiveTech) outPrimary = 'speech';
  if (assistiveTech) outPrimary = 'text'; // deliver via the ARIA live region, not TTS
  if (has('hearing')) outPrimary = 'text'; // hearing pulls the primary channel back to text

  // ── Input ──
  // Voice + text always offered (no support area models speech-impairment, and
  // text is the universal fallback). Scan/switch for motor. Primary channel:
  // voice for vision/motor, but a calmer text-first default for cognitive/attention.
  const scan = has('motor');
  let inPrimary = 'text';
  if (has('vision') || has('motor')) inPrimary = 'voice';
  if (has('cognitive') || has('attention')) inPrimary = 'text';

  // ── Style ──
  const plain = has('cognitive') || has('reading') || has('attention');
  let verbosity = 'normal';
  if (has('cognitive') || has('attention') || has('sensory')) verbosity = 'concise';
  else if (has('vision')) verbosity = 'detailed'; // spoken-only users want fuller description

  const targetSize = has('motor') ? 'large' : 'normal';
  const stepsAtATime = (has('cognitive') || has('attention')) ? 1 : 6;
  const confirmActions = has('cognitive') || has('attention') || has('motor');

  return {
    input: { voice: true, text: true, scan, primary: inPrimary },
    // assistiveTech: the operator runs a screen reader — always show text in the
    // live region and never speak over their AT.
    output: { speech, text: true, captions, assistiveTech, primary: outPrimary },
    verbosity,
    language: plain ? 'plain' : 'standard',
    targetSize,
    stepsAtATime,
    confirmActions,
  };
}

/** A short human sentence describing a presentation — for logs, tests, and the
 *  future UI's "why does the controller look like this" affordance. */
export function describePresentation(p) {
  const inputs = [p.input.primary + ' (primary)']
    .concat(p.input.voice && p.input.primary !== 'voice' ? ['voice'] : [])
    .concat(p.input.text && p.input.primary !== 'text' ? ['text'] : [])
    .concat(p.input.scan ? ['scan'] : []);
  const outputs = []
    .concat(p.output.speech ? ['speech'] : [])
    .concat(p.output.captions ? ['captions'] : (p.output.text ? ['text'] : []));
  const bits = [
    `Input: ${inputs.join(', ')}`,
    `Output: ${outputs.join(' + ')} (primary ${p.output.primary})`,
    `Style: ${p.verbosity}, ${p.language} language`,
    p.targetSize === 'large' ? 'large targets' : null,
    p.stepsAtATime === 1 ? 'one step at a time' : null,
    p.confirmActions ? 'confirms actions' : null,
  ].filter(Boolean);
  return bits.join('. ') + '.';
}

export default deriveControllerPresentation;
