/** Headless provider smoke test; real media never sent remotely without --consent-hosted=yes. */
import { resolve } from 'node:path';
import { mediaContentTypeForFile } from '../src/media-content-type.mjs';
import { loadCaptionFlowEnv } from '../src/runtime-config.mjs';

loadCaptionFlowEnv();
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createLocalWhisperTranscriber } from '../src/providers/local-whisper.mjs';
import { createConfiguredHostedTranscriber } from '../src/providers/hosted-asr.mjs';
import { createPlainCaptionProcessor } from '../src/providers/plain-captions.mjs';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const provider = option('provider', process.env.CAPTIONFLOW_AI_BACKEND || 'fixture');
const file = option('file');
const language = option('lang', 'en');
const mode = option('mode', 'original');
if (!['fixture','local','hosted'].includes(provider)) throw new Error('--provider must be fixture, local or hosted');
if (!['en','sw','auto'].includes(language)) throw new Error('--lang must be en, sw, or auto');
if (!['original','plain'].includes(mode)) throw new Error('--mode must be original or plain');
if (provider !== 'fixture' && !file) throw new Error('--file=PATH is required for local/hosted ASR');
if (provider === 'hosted' && option('consent-hosted') !== 'yes') throw new Error('Hosted upload requires --consent-hosted=yes');

const fixture = provider === 'fixture';
const transcriber = fixture
  ? createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) })
  : provider === 'local' ? createLocalWhisperTranscriber() : createConfiguredHostedTranscriber();
const captionProcessor = fixture
  ? createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) })
  : createPlainCaptionProcessor();
const preferenceProvider = { async getPreferences({ sourceLanguage }) {
  return { captionLanguage: language === 'auto' ? (sourceLanguage === 'sw' ? 'sw' : 'en') : language, mode, fontScale: 1.3, paceMode: 'normal', contrastMode: 'high' };
}};
const pipeline = createCaptionFlowPipeline({transcriber,captionProcessor,preferenceProvider});
try {
  const videoId = fixture ? 'fictional-notice-001' : 'local-video';
  const media = fixture ? {kind:'fixture'} : {kind:'local-file',path:resolve(file),language,contentType:mediaContentTypeForFile(file)};
  const result = await pipeline.run({videoId,media});
  console.error(`Provider=${provider}; ${result.captions.length} captions; ${result.warnings.length} review/fallback warnings.`);
  console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(error.message);process.exitCode=1; }