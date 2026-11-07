import { createGeminiHostedTranscriber } from './gemini-asr.mjs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { validateTranscript } from '../contracts.mjs';

/** Generic provider contract, not a claim that hackathon tokens fit this API.
 * POST multipart/form-data {file, videoId, language}; expect CaptionFlow V1 transcript JSON.
 * Configure an adapter for the actual event API once its specification is known.
 */
/** Resolve a server-side credential without copying the event key into a second .env variable.
 * CaptionFlow's dedicated token wins when both variables are configured.
 * This only selects a secret; it does not imply any API protocol compatibility.
 */
export function resolveHostedApiKey(env = process.env) {
  const key = env.CAPTIONFLOW_HOSTED_TOKEN?.trim() || env.API_KEY?.trim();
  return key || undefined;
}

export function createHostedTranscriber({
  endpoint = process.env.CAPTIONFLOW_HOSTED_URL,
  token = resolveHostedApiKey(),
  fetchImpl = fetch,
  readMedia = readFile,
  timeoutMs = 120_000,
} = {}) {
  if (!endpoint) throw new Error('CAPTIONFLOW_HOSTED_URL is required');
  const url = new URL(endpoint);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new Error('Hosted ASR endpoint must be HTTPS (HTTP is permitted for loopback test servers only)');
  }
  if (!token && !isLocal) throw new Error('CAPTIONFLOW_HOSTED_TOKEN is required for a nonlocal endpoint');
  return {
    async transcribe({ videoId, media }) {
      if (media?.kind !== 'local-file' || typeof media.path !== 'string') {
        throw new Error('Hosted ASR requires a server-side local media path');
      }
      const language = media.language || 'auto';
      if (!['en', 'sw', 'auto'].includes(language)) throw new Error('Unsupported speech language');
      const bytes = await readMedia(media.path);
      const form = new FormData();
      const extension = extname(media.path) || '.mp4';
      form.append('file', new Blob([bytes], { type: media.contentType || 'video/mp4' }), `captionflow-upload${extension}`);
      form.append('videoId', videoId);
      form.append('language', language);
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(`Hosted ASR connection failed: ${error.message}`);
      }
      if (!response.ok) throw new Error(`Hosted ASR returned HTTP ${response.status}`);
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error('Hosted ASR did not return JSON'); }
      // Deliberately strict: an endpoint returning raw vendor output requires an explicit adapter.
      return validateTranscript(payload);
    },
  };
}

/** Recognize the hackathon's Gemini-compatible gateway without using its key. */
export function isGeminiGatewayUrl(endpoint) {
  if (!endpoint) return false;
  try {
    const path = new URL(endpoint).pathname.replace(/\/+$/, '');
    return path.endsWith('/gemini') || /\/v1beta\/models\/[^/]+:generateContent$/.test(path);
  } catch { return false; }
}

/** Select a hosted wire protocol. An explicit setting wins. When not configured,
 * infer Gemini from a recognized Gemini gateway URL; other endpoints stay generic.
 * Never accidentally send Bearer/multipart requests to Gemini's generateContent API.
 */
export function createConfiguredHostedTranscriber(options = {}) {
  const endpoint = options.endpoint ?? process.env.CAPTIONFLOW_HOSTED_URL;
  const configured = options.protocol || process.env.CAPTIONFLOW_HOSTED_PROTOCOL;
  const protocol = configured || (isGeminiGatewayUrl(endpoint) ? 'gemini' : 'generic');
  if (protocol === 'gemini') return createGeminiHostedTranscriber(options);
  if (protocol === 'generic') {
    if (isGeminiGatewayUrl(endpoint)) {
      throw new Error('Gemini gateway configured with generic ASR protocol. Set CAPTIONFLOW_HOSTED_PROTOCOL=gemini in captionflow/.env');
    }
    return createHostedTranscriber(options);
  }
  throw new Error('CAPTIONFLOW_HOSTED_PROTOCOL must be generic or gemini');
}