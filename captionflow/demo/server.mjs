/**
 * Local-only CaptionFlow prototype. No video upload, no live AI.
 * Reuses Role 1 pipeline and Role 5 toolkit-backed font preference provider.
 */
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolkit } from '../../toolkit/index.js';
import { fileKV } from '../../toolkit/platforms/node/kv.js';
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { validatePreferences } from '../src/contracts.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createToolkitPreferenceProvider } from '../src/toolkit-preferences.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
async function parseJson(req) {
  let input = '';
  for await (const chunk of req) {
    input += chunk.toString('utf8');
    if (input.length > 4096) throw new Error('Request body too large');
  }
  return JSON.parse(input);
}

export async function createCaptionFlowDemoServer({ storageDir = join(directory, '..', '.captionflow-storage'), userId = 'captionflow-demo' } = {}) {
  const kv = fileKV(storageDir);
  const { librarian } = createToolkit({ kv });
  const switchResult = await librarian.setActingUser(userId);
  if (!switchResult.ok) throw new Error(`Could not set demo acting user: ${switchResult.reason}`);
  const toolkitPrefs = createToolkitPreferenceProvider({ librarian, actingUserId: userId, historyKV: kv });
  const transcriber = createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) });
  const captionProcessor = createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) });

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname in staticFiles) {
        const [filename, mime] = staticFiles[url.pathname];
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await readFile(join(directory, filename)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/captions') {
        const language = url.searchParams.get('lang') ?? 'en';
        const mode = url.searchParams.get('mode') ?? 'plain';
        // Validate user input before passing it to our pipeline.
        validatePreferences({ captionLanguage: language, mode });
        const preferenceProvider = {
          async getPreferences() {
            return { ...(await toolkitPrefs.getPreferences()), captionLanguage: language, mode };
          },
        };
        const pipeline = createCaptionFlowPipeline({ transcriber, captionProcessor, preferenceProvider });
        send(res, 200, await pipeline.run({ videoId: 'fictional-notice-001', media: { kind: 'fixture' } }));
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
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      // This server is intentionally a development-only, loopback-bound prototype.
      send(res, error.name === 'ContractError' || error instanceof SyntaxError ? 400 : 500, { error: error.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = await createCaptionFlowDemoServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`CaptionFlow local prototype: http://127.0.0.1:${port}`);
    console.log('Mock caption data only; local video stays in your browser. Never assume timing matches an arbitrary video.');
  });
}
