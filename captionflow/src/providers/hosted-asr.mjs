import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { validateTranscript } from '../contracts.mjs';

/** Generic provider contract, not a claim that hackathon tokens fit this API.
 * POST multipart/form-data {file, videoId, language}; expect CaptionFlow V1 transcript JSON.
 * Configure an adapter for the actual event API once its specification is known.
 */
export function createHostedTranscriber({
  endpoint = process.env.CAPTIONFLOW_HOSTED_URL,
  token = process.env.CAPTIONFLOW_HOSTED_TOKEN,
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