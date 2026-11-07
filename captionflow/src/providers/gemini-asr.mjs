/** Gemini generateContent video transcription via the hackathon's Gemini-compatible gateway.
 * Uses JSON + base64 inlineData for SMALL videos, not multipart video uploads.
 * Gemini-generated cue boundaries are estimates; verify against actual speech.
 */
import { readFile, stat } from 'node:fs/promises';
import { validateTranscript } from '../contracts.mjs';

const VALID_MEDIA = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg', 'video/avi']);
const MAX_INLINE_MIB = 14; // 14 MiB * 4/3 plus JSON < 20 MB; recommended Gemini inline ceiling

export function geminiGenerateContentUrl(base, model = 'gemini-3.8-flash') {
  if (!base) throw new Error('CAPTIONFLOW_HOSTED_URL is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) throw new Error('Invalid Gemini model name');
  const url = new URL(base);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Hosted Gemini gateway must use HTTPS (loopback HTTP permitted for tests)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Gemini endpoint must not include credentials, query parameters or fragments');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(':generateContent')) {
    if (!path.includes('/v1beta/models/')) throw new Error('Expected /v1beta/models/{model}:generateContent');
    return url;
  }
  url.pathname = `${path}/v1beta/models/${model}:generateContent`;
  return url;
}

function seconds(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const pieces = value.split(':');
  if (pieces.length < 2 || pieces.length > 3 || pieces.some(p => !/^\d+(?:\.\d+)?$/.test(p))) return NaN;
  let result = 0;
  for (const part of pieces) result = result * 60 + Number(part);
  return result;
}

/** Extract only the text response, never include Gemini thought/signature parts. */
export function parseGeminiTranscript(payload, { videoId, language }) {
  const candidate = payload?.candidates?.[0];
  if (!candidate) throw new Error('Gemini did not return a transcription candidate');
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Gemini response incomplete or blocked (${candidate.finishReason})`);
  }
  const text = candidate.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n');
  if (!text?.trim()) throw new Error('Gemini returned no transcription text');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let decoded;
  try { decoded = JSON.parse(cleaned); }
  catch { throw new Error('Gemini did not return valid timestamped JSON. Retry with a shorter clip.'); }
  const sourceLanguage = decoded.sourceLanguage ?? (language === 'auto' ? 'und' : language);
  if (!Array.isArray(decoded.segments)) throw new Error('Gemini response has no timed segments array');
  // Our contracts own ID allocation and validation. Never invent missing timing.
  const transcript = {
    videoId,
    sourceLanguage,
    segments: decoded.segments.map((cue, i) => ({
      id: `seg-${String(i + 1).padStart(4, '0')}`,
      start: seconds(cue.start),
      end: seconds(cue.end),
      text: cue.text,
      language: cue.language ?? sourceLanguage,
    })),
  };
  return validateTranscript(transcript);
}

export function createGeminiHostedTranscriber({
  endpoint = process.env.CAPTIONFLOW_HOSTED_URL,
  model = process.env.CAPTIONFLOW_HOSTED_MODEL || 'gemini-3.8-flash',
  token = process.env.CAPTIONFLOW_HOSTED_TOKEN?.trim() || process.env.API_KEY?.trim(),
  maxInlineMiB = Number(process.env.CAPTIONFLOW_GEMINI_MAX_INLINE_MB || 12),
  fetchImpl = fetch,
  readMedia = readFile,
  mediaStat = stat,
  timeoutMs = 180_000,
} = {}) {
  const url = geminiGenerateContentUrl(endpoint, model);
  if (!token) throw new Error('Set API_KEY or CAPTIONFLOW_HOSTED_TOKEN in captionflow/.env');
  if (!Number.isFinite(maxInlineMiB) || maxInlineMiB <= 0 || maxInlineMiB > MAX_INLINE_MIB) {
    throw new Error(`CAPTIONFLOW_GEMINI_MAX_INLINE_MB must be greater than 0 and at most ${MAX_INLINE_MIB}`);
  }
  return {
    async transcribe({ videoId, media }) {
      if (media?.kind !== 'local-file' || typeof media.path !== 'string') {
        throw new Error('Gemini requires a temporary server-side local video file');
      }
      const language = media.language ?? 'auto';
      if (!['en', 'sw', 'auto'].includes(language)) throw new Error('Unsupported speech language');
      const mimeType = media.contentType || 'video/mp4';
      if (!VALID_MEDIA.has(mimeType)) {
        throw new Error(`Gemini inline video does not support ${mimeType}; convert to MP4 or WebM`);
      }
      const size = (await mediaStat(media.path)).size;
      if (size > maxInlineMiB * 1024 * 1024) {
        throw new Error(`Video is too large for inline Gemini input (${(size / 1048576).toFixed(1)} MiB). ` +
          `Use a 30–60 second compressed clip under ${maxInlineMiB} MiB, or select Local faster-whisper.`);
      }
      const data = (await readMedia(media.path)).toString('base64');
      const requested = language === 'auto'
        ? 'Detect whether speech is English or Swahili. Use en or sw for sourceLanguage.'
        : `The spoken language is ${language === 'sw' ? 'Swahili' : 'English'}. Use sourceLanguage ${language}.`;
      const prompt = `Transcribe only the SPOKEN WORDS in this video, from start to end. ${requested}\n` +
        'Do not summarize, simplify, translate, describe visuals, or invent speech. Preserve names, numbers, dates and original wording. ' +
        'Create short ordered caption segments (ideally 2–4 seconds and at most 50 characters), with start and end as numeric ' +
        'seconds from the beginning of the video. Times must follow speech, not arbitrary equal intervals. ' +
        'Return ONLY this JSON object: {"sourceLanguage":"en","segments":[{"start":0.0,"end":2.3,"text":"spoken words","language":"en"}]}. ' +
        'For Swahili use "sw". Replace example words/times with actual transcription. If no speech, use segments: [].';
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'x-goog-api-key': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType, data } },
              { text: prompt },
            ] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(`Gemini gateway connection failed: ${error.message}`);
      }
      if (!response.ok) {
        let detail = '';
        try {
          const remote = await response.json();
          const message = remote?.error?.message;
          if (typeof message === 'string') detail = `: ${message.slice(0, 200)}`;
        } catch { /* don't display unpredictable remote HTML or credentials */ }
        throw new Error(`Gemini gateway returned HTTP ${response.status}${detail}`);
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error('Gemini gateway returned invalid JSON'); }
      return parseGeminiTranscript(payload, { videoId, language });
    },
  };
}