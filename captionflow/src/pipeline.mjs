import { ContractError, validateTranscript, validatePreferences, validateProcessedCaptions } from './contracts.mjs';

export class PipelineError extends Error {
  constructor(stage, cause) {
    super(`CaptionFlow ${stage} failed: ${cause.message}`, { cause });
    this.name = 'PipelineError';
    this.stage = stage;
  }
}

async function stage(name, fn) {
  try { return await fn(); }
  catch (error) { throw new PipelineError(name, error instanceof Error ? error : new Error(String(error))); }
}

/**
 * Dependency-injected orchestration: no model, network, browser, or toolkit side effects.
 * Teammates replace one adapter at a time while keeping these contracts stable.
 */
export function createCaptionFlowPipeline({ transcriber, captionProcessor, preferenceProvider }) {
  if (typeof transcriber?.transcribe !== 'function') throw new ContractError('transcriber', 'must provide transcribe({videoId, media})');
  if (typeof captionProcessor?.process !== 'function') throw new ContractError('captionProcessor', 'must provide process({transcript, preferences})');
  if (typeof preferenceProvider?.getPreferences !== 'function') throw new ContractError('preferenceProvider', 'must provide getPreferences({videoId, sourceLanguage})');

  return {
    async run({ videoId, media }) {
      if (typeof videoId !== 'string' || !videoId.trim()) throw new ContractError('videoId', 'required');
      if (!media || typeof media !== 'object' || Array.isArray(media)) throw new ContractError('media', 'required');
      const transcript = await stage('transcription', async () => {
        const result = await transcriber.transcribe({ videoId, media });
        const checked = validateTranscript(result);
        if (checked.videoId !== videoId) throw new ContractError('transcript.videoId', 'must match request videoId');
        return checked;
      });
      const preferences = await stage('preferences', async () =>
        validatePreferences(await preferenceProvider.getPreferences({ videoId, sourceLanguage: transcript.sourceLanguage }), transcript.sourceLanguage),
      );
      const captions = await stage('caption processing', async () =>
        validateProcessedCaptions(await captionProcessor.process({ transcript, preferences }), transcript),
      );
      const warnings = captions
        .filter(c => c.status !== 'ready')
        .map(c => ({ captionId: c.id, status: c.status, message: c.status === 'fallback'
          ? 'Requested transformation unavailable; original speech text shown'
          : 'Caption wording was changed and requires human review' }));
      return { videoId, sourceLanguage: transcript.sourceLanguage, transcript, captions, preferences, warnings };
    },
  };
}