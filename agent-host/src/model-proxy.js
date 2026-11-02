// The sandboxes' only way to a model. A sandbox sends its own token as the
// API key; the proxy checks it, pins the model, limits the rate per account,
// and sends the request on with the real key, which never enters a sandbox.
// Nothing of a request or reply is logged: only the account, method and size.

const METHODS = new Set(['generateContent', 'streamGenerateContent', 'countTokens']);
const PATH = /^\/model\/(v1beta|v1)\/models\/([^/:]+):([A-Za-z]+)$/;

export function createModelProxy({ apiKey, model = 'gemini-3.8-flash', uidForToken, upstream = 'https://generativelanguage.googleapis.com', fetch = globalThis.fetch, perMinute = 60, log }) {
  const recent = new Map(); // uid -> timestamps in the last minute

  function allow(uid) {
    const now = Date.now();
    const times = (recent.get(uid) || []).filter(t => now - t < 60_000);
    if (times.length >= perMinute) { recent.set(uid, times); return false; }
    times.push(now);
    recent.set(uid, times);
    return true;
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://sandbox');
    const m = PATH.exec(url.pathname);
    if (req.method !== 'POST' || !m || !METHODS.has(m[3])) return send(res, 404, { error: { message: 'not a model call this proxy makes' } });
    const uid = uidForToken(String(req.headers['x-goog-api-key'] || url.searchParams.get('key') || ''));
    if (!uid) return send(res, 401, { error: { message: 'unknown sandbox' } });
    if (!apiKey) return send(res, 503, { error: { message: 'the host has no model key' } });
    if (!allow(uid)) return send(res, 429, { error: { message: 'too many model calls this minute; wait a moment' } });
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 20_000_000) return send(res, 413, { error: { message: 'request too large' } }); chunks.push(c); }
    // Every call, whatever model opencode asked for (it asks a small one for titles), goes to the one model.
    const target = new URL(`${upstream}/${m[1]}/models/${model}:${m[3]}`);
    for (const [k, v] of url.searchParams) if (k !== 'key') target.searchParams.set(k, v);
    const started = Date.now();
    let up;
    try {
      up = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: Buffer.concat(chunks) });
    } catch (e) {
      log?.warn('model.unreachable', { uid, error: e.message });
      return send(res, 502, { error: { message: 'could not reach the model' } });
    }
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
    let out = 0;
    if (up.body) for await (const c of up.body) { out += c.length; res.write(c); }
    res.end();
    log?.info('model.call', { uid, method: m[3], status: up.status, requestBytes: size, responseBytes: out, ms: Date.now() - started });
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
