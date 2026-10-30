// Server-side Gemini caller, wired to `librarian.setGeminiCaller(fn)` in
// toolkit-host.js. Matches the EXACT input/output contract every host's
// caller must satisfy (see toolkit/core/librarian.js: `let _gemini = null;
// // async (prompt) => string`, invoked as `await _gemini(prompt)` in
// getSiteCategory/extract/reflect/buildSkill) and the exact request/response
// shape a host's own caller uses (
// background.js: GEMINI_MODEL, getApiUrl, callGemini, wired at
// `globalThis.Librarian.setGeminiCaller(async (prompt) => {...})`), so
// extraction/reflection/skill-building behave identically whether the key
// lives in the browser or here.
//
// Caller contract: `async (prompt: string, {images}?) => string` — the prompt,
// and for extract the observations' images ({mimeType, data: base64}), sent
// after the prompt in order; the model's raw text out (never the parsed JSON
// candidate envelope).
// Throwing is fine: every call site in librarian.js catches and turns it into
// a data result (`{ran:false, reason: e.message}`), never an unhandled
// rejection.
//
// Every call is logged as `ai.call`: the model, the account and purpose (from
// ai-context.js), the outcome, the time, the sizes and token counts, and
// (unless logContent is off) the prompt and the reply, with credentials
// redacted (log.js). Images are logged by type and size only.

import { aiContext } from './ai-context.js';
import { silentLogger, loggedContent } from './log.js';

export const GEMINI_MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 30_000;
// At the model's default thinking, learning from a few observations took
// about 27 seconds, against the 30-second limit; at low it took about 4,
// with the same memories and suggestions.
const THINKING_LEVEL = 'low';

// The key goes in the x-goog-api-key header, never the query string, so it
// stays out of access logs and error traces on the deployer's host.
function apiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/** Build the caller function `toolkit-host.js` hands to `setGeminiCaller`.
 *  With no `apiKey` the returned function still exists (so `_gemini` is
 *  always set — extract()/reflect() take the "ran the LLM lane but it threw"
 *  path, not the "no llm wired at all" `{ran:false, reason:'no-llm'}` path)
 *  but throws a clear, stable-message error the instant it's invoked — the
 *  fast lane (everything except extract/reflect/buildSkill/
 *  interpretNeedsPrompt) is completely unaffected. */
export function createGeminiCaller({ apiKey, model = GEMINI_MODEL, log = silentLogger, logContent = true, fetch: fetcher = (...a) => globalThis.fetch(...a) } = {}) {
  return async function serverGeminiCaller(prompt, { images = [] } = {}) {
    const { uid, purpose = 'unknown' } = aiContext.getStore() || {};
    const started = Date.now();
    const base = {
      provider: 'gemini', model, uid, purpose, promptChars: String(prompt).length,
      ...(images.length ? { images: images.map(i => ({ mimeType: i.mimeType, chars: i.data.length })) } : {}),
      ...(logContent ? { prompt: loggedContent(prompt) } : {}),
    };
    const done = (level, outcome, fields = {}) => {
      const ms = Date.now() - started;
      log[level]('ai.call', {
        ...base, outcome, ms, ...fields,
        message: `AI ${model} for ${purpose} ${outcome} ${ms}ms${fields.totalTokens ? ` ${fields.totalTokens} tokens` : ''}${uid ? ` uid=${uid}` : ''}`,
      });
    };
    if (!apiKey) {
      done('warn', 'no-key');
      throw new Error('no-server-key');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetcher(apiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mimeType, data: i.data } }))] }],
          generationConfig: { temperature: 0.7, thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
        }),
        signal: controller.signal,
      });
    } catch (e) {
      done('warn', e?.name === 'AbortError' ? 'timeout' : 'network-error');
      throw new Error(e?.name === 'AbortError' ? 'Gemini API timeout' : `Gemini API unreachable: ${e?.message || e}`);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      let errorStatus;
      try { errorStatus = JSON.parse(errBody)?.error?.status; } catch { /* not JSON */ }
      done(resp.status >= 500 ? 'error' : 'warn', 'http-error', { httpStatus: resp.status, errorStatus, ...(logContent ? { reply: loggedContent(errBody) } : {}) });
      throw new Error(`Gemini API error ${resp.status}${errorStatus ? ` ${errorStatus}` : ''}`);
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const u = data.usageMetadata || {};
    const fields = {
      httpStatus: resp.status, finishReason: data.candidates?.[0]?.finishReason, responseChars: text.length,
      ...(logContent ? { reply: loggedContent(text) } : {}),
      promptTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, thoughtsTokens: u.thoughtsTokenCount, totalTokens: u.totalTokenCount,
    };
    if (!text) {
      done('warn', 'no-text', fields);
      throw new Error(`Gemini returned no text (${fields.finishReason || 'no candidate'})`);
    }
    done('info', 'ok', fields);
    return text;
  };
}
