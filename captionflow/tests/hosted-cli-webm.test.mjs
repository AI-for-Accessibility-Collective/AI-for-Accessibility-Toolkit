import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/run-providers.mjs', import.meta.url));

test('CLI hosted WebM calls Gemini generateContent with video/webm and x-goog-api-key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'captionflow-cli-gemini-'));
  const file = join(directory, 'short-test.webm');
  const fakeGateway = createServer(async (req, res) => {
    assert.equal(req.url, '/api/public/gemini/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'example-test-token');
    assert.equal(req.headers['content-type'], 'application/json');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(payload.contents[0].parts[0].inlineData.mimeType, 'video/webm');
    assert.equal(Buffer.from(payload.contents[0].parts[0].inlineData.data, 'base64').toString(), 'fake-webm-bytes');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
      sourceLanguage: 'en', segments: [
        { start: 0, end: 1.8, text: 'Public health information.', language: 'en' },
        { start: 1.8, end: 3.4, text: 'Please listen carefully.', language: 'en' },
      ],
    }) }] } }] }));
  });
  try {
    await writeFile(file, 'fake-webm-bytes');
    fakeGateway.listen(0, '127.0.0.1');
    await once(fakeGateway, 'listening');
    const endpoint = `http://127.0.0.1:${fakeGateway.address().port}/api/public/gemini`;
    // No API token or real media leaves the test machine. No .env file is loaded.
    const { stdout, stderr } = await execFileAsync(process.execPath, [script,
      '--provider=hosted', `--file=${file}`, '--lang=en', '--consent-hosted=yes',
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CAPTIONFLOW_ENV_FILE: join(directory, 'does-not-exist.env'),
        CAPTIONFLOW_HOSTED_URL: endpoint,
        CAPTIONFLOW_HOSTED_TOKEN: 'example-test-token',
        CAPTIONFLOW_HOSTED_MODEL: 'gemini-3.8-flash',
        CAPTIONFLOW_HOSTED_PROTOCOL: '',
      },
      timeout: 10_000,
    });
    assert.match(stderr, /Provider=hosted; 2 captions/);
    const output = JSON.parse(stdout);
    assert.equal(output.captions.length, 2);
    assert.equal(output.transcript.segments[1].end, 3.4);
  } finally {
    await new Promise(resolve => fakeGateway.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});