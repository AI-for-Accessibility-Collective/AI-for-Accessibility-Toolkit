import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createFixturePreferenceProvider } from '../src/mocks/fixture-preferences.mjs';

const flag = (name, fallback) => process.argv.find(s => s.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const transcriber = createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) });
const captionProcessor = createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) });
const preferenceProvider = createFixturePreferenceProvider({
  captionLanguage: flag('lang', 'en'),
  mode: flag('mode', 'plain'),
  fontScale: Number(flag('font-scale', '1.3')),
  paceMode: flag('pace', 'slow'),
  contrastMode: 'high',
});

const pipeline = createCaptionFlowPipeline({ transcriber, captionProcessor, preferenceProvider });
try {
  const output = await pipeline.run({ videoId: 'fictional-notice-001', media: { kind: 'fixture' } });
  // JSON on stdout is the stable interface for downstream dev tools; diagnostics go to stderr.
  console.error(`Mock only: ${output.captions.length} timed captions; ${output.warnings.length} require attention; no video/ASR/LLM call.`);
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
