// Demonstrates the toolkit-backed preference provider end to end, with real
// disk persistence via the toolkit's own fileKV (toolkit/platforms/node/kv.js)
// instead of the --lang/--mode/--font-scale fixture flags that scripts/run-mock.mjs
// uses. Synthetic data only -- see captionflow/TOOLKIT_PREFERENCES.md. Not a
// player, not real ASR, no AI calls.
import { createToolkit } from '../../toolkit/index.js';
import { fileKV } from '../../toolkit/platforms/node/kv.js';
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createToolkitPreferenceProvider } from '../src/toolkit-preferences.mjs';

const flag = (name, fallback) => process.argv.find(s => s.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const storageDir = flag('storage-dir', new URL('../.captionflow-storage', import.meta.url).pathname);
const actingUserId = flag('user', null);
const setTextSize = flag('set-text-size', undefined);

const { librarian } = createToolkit({ kv: fileKV(storageDir) });
if (actingUserId !== null) {
  const switched = await librarian.setActingUser(actingUserId);
  if (!switched.ok) {
    console.error(`Could not switch to acting user ${JSON.stringify(actingUserId)}: ${switched.reason}`);
    process.exit(1);
  }
}

const preferenceProvider = createToolkitPreferenceProvider({ librarian, actingUserId });
if (setTextSize !== undefined) {
  await preferenceProvider.setTextSize({ value: Number(setTextSize), unit: 'ratio' });
  console.error(`Saved textSize=${setTextSize} for acting user ${JSON.stringify(actingUserId)} under ${storageDir}`);
}

const pipeline = createCaptionFlowPipeline({
  transcriber: createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) }),
  captionProcessor: createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) }),
  preferenceProvider,
});

try {
  const output = await pipeline.run({ videoId: 'fictional-notice-001', media: { kind: 'fixture' } });
  console.error(`Mock only: ${output.captions.length} timed captions; ${output.warnings.length} require attention; no video/ASR/LLM call. Toolkit preferences loaded from ${storageDir}.`);
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
