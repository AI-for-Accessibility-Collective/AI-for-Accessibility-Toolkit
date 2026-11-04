/**
 * CaptionFlow V1 contracts, independent of ASR, LLM and player providers.
 * Times are seconds relative to the beginning of the video (not wall-clock time).
 */

export class ContractError extends Error {
  constructor(field, problem) {
    super(`${field}: ${problem}`);
    this.name = 'ContractError';
    this.field = field;
  }
}

const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = x => typeof x === 'string' && x.trim().length > 0;
const finiteNumber = x => typeof x === 'number' && Number.isFinite(x);

export function normalizeLanguage(value, field = 'language', { allowUndetermined = false } = {}) {
  if (!nonEmpty(value)) throw new ContractError(field, 'must be a language tag');
  const code = value.trim().toLowerCase().split('-')[0];
  if (code !== 'en' && code !== 'sw' && !(allowUndetermined && code === 'und')) {
    throw new ContractError(field, 'CaptionFlow V1 supports en and sw (or und for source detection)');
  }
  return code;
}

/** Validate and copy the contract produced by the transcription component. */
export function validateTranscript(input) {
  if (!record(input)) throw new ContractError('transcript', 'must be an object');
  if (!nonEmpty(input.videoId)) throw new ContractError('transcript.videoId', 'is required');
  const sourceLanguage = normalizeLanguage(input.sourceLanguage, 'transcript.sourceLanguage', { allowUndetermined: true });
  if (!Array.isArray(input.segments)) throw new ContractError('transcript.segments', 'must be an array');
  if (input.segments.length === 0) throw new ContractError('transcript.segments', 'no speech/caption segments available');

  const seen = new Set();
  let previousStart = -Infinity;
  const segments = input.segments.map((item, i) => {
    const path = `transcript.segments[${i}]`;
    if (!record(item)) throw new ContractError(path, 'must be an object');
    if (!nonEmpty(item.id)) throw new ContractError(`${path}.id`, 'is required');
    if (seen.has(item.id)) throw new ContractError(`${path}.id`, 'must be unique');
    seen.add(item.id);
    if (!finiteNumber(item.start) || item.start < 0) throw new ContractError(`${path}.start`, 'must be a nonnegative finite number');
    if (!finiteNumber(item.end) || item.end <= item.start) throw new ContractError(`${path}.end`, 'must be greater than start');
    if (item.start < previousStart) throw new ContractError(`${path}.start`, 'segments must be ordered by start time');
    previousStart = item.start;
    if (!nonEmpty(item.text)) throw new ContractError(`${path}.text`, 'must contain text');
    const language = normalizeLanguage(item.language ?? sourceLanguage, `${path}.language`, { allowUndetermined: true });
    return { id: item.id.trim(), start: item.start, end: item.end, text: item.text.trim(), language };
  });
  return { videoId: input.videoId.trim(), sourceLanguage, segments };
}

/** App-level preferences. These are NOT names of existing toolkit AbilityModel dimensions. */
export function validatePreferences(input = {}, sourceLanguage = 'en') {
  if (!record(input)) throw new ContractError('preferences', 'must be an object');
  const allowed = new Set(['captionLanguage', 'mode', 'fontScale', 'paceMode', 'contrastMode']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new ContractError(`preferences.${key}`, 'unsupported key');
  }
  const captionLanguage = normalizeLanguage(
    input.captionLanguage ?? (sourceLanguage === 'und' ? 'en' : sourceLanguage),
    'preferences.captionLanguage',
  );
  const mode = input.mode ?? 'original';
  const fontScale = input.fontScale ?? 1.0;
  const paceMode = input.paceMode ?? 'normal';
  const contrastMode = input.contrastMode ?? 'normal';
  if (!['original', 'plain'].includes(mode)) throw new ContractError('preferences.mode', 'must be original or plain');
  if (!finiteNumber(fontScale) || fontScale < 0.8 || fontScale > 2.5) {
    throw new ContractError('preferences.fontScale', 'must be between 0.8 and 2.5');
  }
  if (!['normal', 'slow', 'manual'].includes(paceMode)) {
    throw new ContractError('preferences.paceMode', 'must be normal, slow, or manual');
  }
  if (!['normal', 'high'].includes(contrastMode)) {
    throw new ContractError('preferences.contrastMode', 'must be normal or high');
  }
  return { captionLanguage, mode, fontScale, paceMode, contrastMode };
}

/**
 * V1 contract: caption processing must not drop, reorder, or retime ASR segments.
 * Later caption re-segmentation will need a versioned contract and tests.
 */
export function validateProcessedCaptions(input, transcript) {
  if (!Array.isArray(input)) throw new ContractError('captions', 'must be an array');
  if (input.length !== transcript.segments.length) {
    throw new ContractError('captions', 'must contain one output per input segment in V1');
  }
  const statuses = new Set(['ready', 'needs-review', 'fallback']);
  return input.map((cue, i) => {
    const original = transcript.segments[i];
    const path = `captions[${i}]`;
    if (!record(cue)) throw new ContractError(path, 'must be an object');
    if (cue.id !== original.id) throw new ContractError(`${path}.id`, 'must match the source segment ID/order');
    if (cue.start !== original.start || cue.end !== original.end) {
      throw new ContractError(`${path}.start/end`, 'must preserve source timing in V1');
    }
    if (cue.originalText !== original.text) throw new ContractError(`${path}.originalText`, 'must preserve source text');
    if (!nonEmpty(cue.displayText)) throw new ContractError(`${path}.displayText`, 'cannot be empty');
    const language = normalizeLanguage(cue.language, `${path}.language`, { allowUndetermined: true });
    if (!['original', 'plain'].includes(cue.mode)) throw new ContractError(`${path}.mode`, 'must be original or plain');
    if (!statuses.has(cue.status)) throw new ContractError(`${path}.status`, 'must be ready, needs-review, or fallback');
    if (cue.mode === 'original' && cue.status === 'ready' &&
        (cue.displayText !== original.text || language !== original.language)) {
      throw new ContractError(path, 'unaltered original must not claim a translated/reworded caption as original');
    }
    return {
      id: cue.id, start: cue.start, end: cue.end, originalText: cue.originalText,
      displayText: cue.displayText.trim(), language, mode: cue.mode, status: cue.status,
    };
  });
}
