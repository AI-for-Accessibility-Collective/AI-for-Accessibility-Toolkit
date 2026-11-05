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
// For quick sorting the runtime does on many pages (the pageType task).
export const GEMINI_LITE_MODEL = 'gemini-3.5-flash-lite';

// What a call costs, in US dollars per million tokens, from Google's Gemini
// API pricing page (standard tier, paid; checked 2026-11-03:
// https://ai.google.dev/gemini-api/docs/pricing). Thinking tokens are billed
// as output. Each model's list runs oldest first; an entry applies before its
// `until` date (UTC). AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK
// override it (server/index.js), for another model or a price change.
export const GEMINI_PRICES = {
  'gemini-3.8-flash': [
    { until: '2027-01-01', input: 0.75, output: 3.75 }, // introductory rate
    { input: 1.5, output: 7.5 },
  ],
  // checked 2026-11-05
  'gemini-3.5-flash-lite': [{ input: 0.3, output: 2.5 }],
};

/** {input, output} dollars per million tokens for `model` at `when`. A model
 *  not in the table is priced at the highest rate the table knows, so a
 *  budget errs toward stopping early rather than late. */
export function priceFor(model, when = Date.now()) {
  const list = GEMINI_PRICES[model];
  if (!list) {
    const all = Object.values(GEMINI_PRICES).flat();
    return { input: Math.max(...all.map(p => p.input)), output: Math.max(...all.map(p => p.output)), known: false };
  }
  const day = new Date(when).toISOString().slice(0, 10);
  const p = list.find(e => !e.until || day < e.until) || list[list.length - 1];
  return { input: p.input, output: p.output, known: true };
}

/** Dollars for one call's usage ({promptTokens, outputTokens, thoughtsTokens}). */
export function costOf(usage, price) {
  const input = Number(usage?.promptTokens) || 0;
  const output = (Number(usage?.outputTokens) || 0) + (Number(usage?.thoughtsTokens) || 0);
  return (input * price.input + output * price.output) / 1e6;
}
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
  // onUsage({model, promptTokens, outputTokens, thoughtsTokens}) hears what
  // each answered call used, for a caller that keeps a budget (ai.js).
  return Object.assign(async function serverGeminiCaller(prompt, { images = [], onUsage } = {}) {
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
    // Billed whether or not it gave text.
    try { onUsage?.({ model, promptTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, thoughtsTokens: u.thoughtsTokenCount }); } catch { /* the listener's problem */ }
    if (!text) {
      done('warn', 'no-text', fields);
      throw new Error(`Gemini returned no text (${fields.finishReason || 'no candidate'})`);
    }
    done('info', 'ok', fields);
    return text;
  }, { model });
}
