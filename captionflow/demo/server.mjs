/** CaptionFlow local-only demo host; ASR providers are isolated and injected.
 * A selected browser video is uploaded only to the local loopback server for ASR.
 * Hosted mode forwards it to the explicitly configured remote endpoint with consent.
 */
import { createServer as createHttpServer } from 'node:http';
import { readFile, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolkit } from '../../toolkit/index.js';
import { fileKV } from '../../toolkit/platforms/node/kv.js';
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { ContractError, validatePreferences, validateProcessedCaptions } from '../src/contracts.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createPlainCaptionProcessor } from '../src/providers/plain-captions.mjs';
import { createLocalWhisperTranscriber } from '../src/providers/local-whisper.mjs';
import { createConfiguredHostedTranscriber, resolveHostedApiKey } from '../src/providers/hosted-asr.mjs';
import { createToolkitPreferenceProvider } from '../src/toolkit-preferences.mjs';
import { loadCaptionFlowEnv } from '../src/runtime-config.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/player-sync.mjs': ['../src/player-sync.mjs', 'text/javascript; charset=utf-8'],
  '/caption-view.mjs': ['../src/caption-view.mjs', 'text/javascript; charset=utf-8'],
};
const supportedMedia = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
};
async function parseJson(req) {
  let input = '';
  for await (const chunk of req) {
    input += chunk.toString('utf8');
    if (input.length > 4096) throw new HttpError(413, 'Request body too large');
  }
  try { return JSON.parse(input); }
  catch { throw new HttpError(400, 'Expected JSON body'); }
}
async function receiveVideo(req, { maxMediaBytes, uploadDir, contentType }) {
  if (!supportedMedia.has(contentType)) throw new HttpError(415, 'Supported video formats: MP4, WebM, Ogg, QuickTime');
  if (Number(req.headers['content-length']) > maxMediaBytes) throw new HttpError(413, 'Video exceeds local upload limit');
  const folder = await mkdtemp(join(uploadDir, 'captionflow-asr-'));
  const extensions = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v' };
  const path = join(folder, `input${extensions[contentType]}`);
  let file;
  try {
    file = await open(path, 'wx', 0o600);
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxMediaBytes) throw new HttpError(413, 'Video exceeds local upload limit');
      await file.write(chunk);
    }
    if (!bytes) throw new HttpError(400, 'Video file was empty');
    await file.close(); file = null;
    return { path, folder, contentType };
  } catch (error) {
    if (file) await file.close().catch(() => {});
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

/** Configurable MiB limit for local demo uploads; protects temp disk and remote memory use. */
export function configuredMaxMediaBytes(env = process.env) {
  const raw = env.CAPTIONFLOW_MAX_UPLOAD_MB ?? '75';
  const mib = Number(raw);
  if (!Number.isFinite(mib) || mib < 1 || mib > 512) {
    throw new Error('CAPTIONFLOW_MAX_UPLOAD_MB must be a number from 1 to 512 (MiB)');
  }
  return Math.floor(mib * 1024 * 1024);
}

export async function createCaptionFlowDemoServer({
  storageDir = join(directory, '..', '.captionflow-storage'),
  userId = 'captionflow-demo',
  uploadDir = tmpdir(),
  maxMediaBytes = configuredMaxMediaBytes(),
  providers = {}, // injectable local/hosted transcribers for tests
  hostedUrl = process.env.CAPTIONFLOW_HOSTED_URL,
  hostedToken = resolveHostedApiKey(),
  hostedProtocol = process.env.CAPTIONFLOW_HOSTED_PROTOCOL,
  hostedModel = process.env.CAPTIONFLOW_HOSTED_MODEL ?? 'gemini-3.8-flash',
} = {}) {
  const kv = fileKV(storageDir);
  const { librarian } = createToolkit({ kv });
  const switchResult = await librarian.setActingUser(userId);
  if (!switchResult.ok) throw new Error(`Could not set demo acting user: ${switchResult.reason}`);
  const toolkitPrefs = createToolkitPreferenceProvider({ librarian, actingUserId: userId, historyKV: kv });
  const fixtureTranscriber = createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) });
  const fixtureProcessor = createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) });
  const plainProcessor = createPlainCaptionProcessor();
  const localTranscriber = providers.local || createLocalWhisperTranscriber();
  const hostedTranscriber = providers.hosted || (hostedUrl ? createConfiguredHostedTranscriber({ endpoint: hostedUrl, token: hostedToken, protocol: hostedProtocol, model: hostedModel }) : null);
  let busy = false;

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname in staticFiles) {
        const [filename, mime] = staticFiles[url.pathname];
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await readFile(join(directory, filename)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/providers') {
        send(res, 200, { providers: { fixture: true, local: true, hosted: Boolean(hostedTranscriber) },
          defaultProvider: ['fixture', 'local', 'hosted'].includes(process.env.CAPTIONFLOW_AI_BACKEND) ? process.env.CAPTIONFLOW_AI_BACKEND : 'fixture',
          maxMediaBytes });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/captions') {
        const language = url.searchParams.get('lang') ?? 'en';
        const mode = url.searchParams.get('mode') ?? 'plain';
        validatePreferences({ captionLanguage: language, mode });
        const preferenceProvider = { async getPreferences() {
          return { ...(await toolkitPrefs.getPreferences()), captionLanguage: language, mode };
        }};
        const pipeline = createCaptionFlowPipeline({ transcriber: fixtureTranscriber, captionProcessor: fixtureProcessor, preferenceProvider });
        send(res, 200, await pipeline.run({ videoId: 'fictional-notice-001', media: { kind: 'fixture' } }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/transcribe') {
        const provider = url.searchParams.get('provider');
        if (!['local', 'hosted'].includes(provider)) throw new HttpError(400, 'Choose local or hosted provider for transcription');
        if (provider === 'hosted' && !hostedTranscriber) throw new HttpError(503, 'Hosted provider not configured');
        if (provider === 'hosted' && url.searchParams.get('consent') !== 'yes') {
          throw new HttpError(400, 'Explicit consent is required before sending a video to a hosted provider');
        }
        const speechLanguage = url.searchParams.get('language') ?? 'auto';
        if (!['en', 'sw', 'auto'].includes(speechLanguage)) throw new HttpError(400, 'Speech language must be en, sw or auto');
        const mode = url.searchParams.get('mode') ?? 'original';
        if (!['original', 'plain'].includes(mode)) throw new HttpError(400, 'Caption mode must be original or plain');
        if (busy) throw new HttpError(409, 'Transcription already running; try again after it completes');
        const contentType = (req.headers['content-type'] || '').split(';')[0].toLowerCase();
        if (!supportedMedia.has(contentType)) throw new HttpError(415, 'Upload a supported video file');
        busy = true;
        let uploaded;
        let result;
        try {
          uploaded = await receiveVideo(req, { maxMediaBytes, uploadDir, contentType });
          const videoId = `clip-${randomUUID()}`; // generated server-side; not the sample fixture ID
          const transcriber = provider === 'local' ? localTranscriber : hostedTranscriber;
          const pipeline = createCaptionFlowPipeline({
            transcriber,
            captionProcessor: plainProcessor,
            preferenceProvider: { async getPreferences({ sourceLanguage }) {
              return { ...(await toolkitPrefs.getPreferences()), captionLanguage: sourceLanguage === 'und' ? 'en' : sourceLanguage, mode };
            }},
          });
          result = await pipeline.run({ videoId, media: { kind: 'local-file', path: uploaded.path, language: speechLanguage, contentType } });
          // Pre-compute the conservative plain-language variant without a second
          // (expensive) ASR run. The player can switch text modes instantly.
          const plainVariant = validateProcessedCaptions(await plainProcessor.process({
            transcript: result.transcript,
            preferences: { ...result.preferences, mode: 'plain' },
          }), result.transcript);
          result = { ...result, captionVariants: { plain: plainVariant } };
        } finally {
          if (uploaded) await rm(uploaded.folder, { recursive: true, force: true });
          busy = false;
        }
        send(res, 200, { ...result, provider });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/preferences') {
        send(res, 200, validatePreferences(await toolkitPrefs.getPreferences(), 'en'));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/font-scale') {
        const body = await parseJson(req);
        await toolkitPrefs.setTextSize({ value: body.value, unit: 'ratio' });
        send(res, 200, validatePreferences(await toolkitPrefs.getPreferences(), 'en'));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/undo-font-scale') {
        const result = await toolkitPrefs.undoTextSize();
        send(res, 200, { ...result, preferences: validatePreferences(await toolkitPrefs.getPreferences(), 'en') });
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      const status = error.status || (error.name === 'ContractError' || error instanceof SyntaxError ? 400 : 500);
      if (!res.headersSent) send(res, status, { error: error.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadCaptionFlowEnv();
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = await createCaptionFlowDemoServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`CaptionFlow demo: http://127.0.0.1:${port}`);
    console.log('Fixture, local faster-whisper and configured hosted ASR supported; localhost only.');
  });
}