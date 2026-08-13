// Server-side Gemini caller, wired to `librarian.setGeminiCaller(fn)` in
// toolkit-host.js. Matches the EXACT input/output contract every host's
// caller must satisfy (see toolkit/core/librarian.js: `let _gemini = null;
// // async (prompt) => string`, invoked as `await _gemini(prompt)` in
// getSiteCategory/extract/reflect/buildSkill) and the exact request/response
// shape the extension's own caller uses (personalized-extension/extension/
// background.js: GEMINI_MODEL, getApiUrl, callGemini, wired at
// `globalThis.Librarian.setGeminiCaller(async (prompt) => {...})`), so
// extraction/reflection/skill-building behave identically whether the key
// lives in the browser or here.
//
// Caller contract: `async (prompt: string) => string` — one positional arg
// in, the model's raw text out (never the parsed JSON candidate envelope).
// Throwing is fine: every call site in librarian.js catches and turns it into
// a data result (`{ran:false, reason: e.message}`), never an unhandled
// rejection.

const GEMINI_MODEL = 'gemini-3.5-flash';
const REQUEST_TIMEOUT_MS = 30_000;

function apiUrl(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

/** Build the caller function `toolkit-host.js` hands to `setGeminiCaller`.
 *  With no `apiKey` the returned function still exists (so `_gemini` is
 *  always set — extract()/reflect() take the "ran the LLM lane but it threw"
 *  path, not the "no llm wired at all" `{ran:false, reason:'no-llm'}` path)
 *  but throws a clear, stable-message error the instant it's invoked — the
 *  fast lane (everything except extract/reflect/buildSkill/
 *  interpretNeedsPrompt) is completely unaffected. */
export function createGeminiCaller({ apiKey } = {}) {
  return async function serverGeminiCaller(prompt) {
    if (!apiKey) {
      throw new Error('no-server-key');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(apiUrl(apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini API error ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(data)}`);
    return text;
  };
}
