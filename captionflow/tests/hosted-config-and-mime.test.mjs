import test from 'node:test';
import assert from 'node:assert/strict';
import { isGeminiGatewayUrl, createConfiguredHostedTranscriber } from '../src/providers/hosted-asr.mjs';
import { mediaContentTypeForFile } from '../src/media-content-type.mjs';

const endpoint = 'https://ai4a11y.lovable.app/api/public/gemini';

test('recognizes Gemini base and full generateContent endpoint', () => {
  assert.equal(isGeminiGatewayUrl(endpoint), true);
  assert.equal(isGeminiGatewayUrl(`${endpoint}/v1beta/models/gemini-3.8-flash:generateContent`), true);
  assert.equal(isGeminiGatewayUrl('https://example.com/api/asr'), false);
});

test('automatically chooses Gemini for its known gateway when protocol is unset', () => {
  const transcriber = createConfiguredHostedTranscriber({
    endpoint, protocol: '', token: 'fake', model: 'gemini-3.8-flash',
  });
  assert.equal(typeof transcriber.transcribe, 'function');
});

test('refuses generic multipart against a Gemini gateway with an actionable message', () => {
  assert.throws(() => createConfiguredHostedTranscriber({endpoint, protocol: 'generic',token:'fake'}),
    /Set CAPTIONFLOW_HOSTED_PROTOCOL=gemini/);
});

test('preserves the generic adapter for a compatible non-Gemini ASR endpoint', () => {
  const transcriber = createConfiguredHostedTranscriber({endpoint:'https://example.com/asr',protocol:'generic',token:'fake'});
  assert.equal(typeof transcriber.transcribe, 'function');
});

test('maps WebM and MP4 to actual MIME types in CLI', () => {
  assert.equal(mediaContentTypeForFile('/tmp/short-test.webm'),'video/webm');
  assert.equal(mediaContentTypeForFile('/tmp/short-test.mp4'),'video/mp4');
  assert.equal(mediaContentTypeForFile('/tmp/UPPER.WEBM'),'video/webm');
  assert.throws(()=>mediaContentTypeForFile('/tmp/file.bin'), /Unsupported video extension/);
});