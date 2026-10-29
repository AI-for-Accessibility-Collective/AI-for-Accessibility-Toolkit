// Connect a provider to a toolkit service, so the app shows up in the
// developer console and MCP clients can reach its adapters.
//
// A browser page cannot listen for connections, so the provider dials out:
//
//   1. POST /v1/providers                 register: application + descriptors
//   2. GET  /v1/providers/<id>/channel    a server-sent-event stream; each
//                                         `request` event is one MCP JSON-RPC
//                                         message from a client
//   3. POST /v1/providers/<id>/channel    the JSON-RPC response
//
// The service relays MCP requests from clients of the SAME account — the
// developer console, or an MCP client such as a coding agent holding the
// account's token — to `provider.handle()`, and the response back. It never
// runs adapter code. The token is the account's app token (its default token,
// usually); a console sign-in session is refused here.
//
// The connection retries with backoff after a network failure or a service
// restart, re-registering each time. A 401/403 stops it: the token is wrong
// or was revoked, and retrying would not help.
//
// Works anywhere with fetch + streaming response bodies + Web Crypto:
// browsers, Node 18+, Deno.

const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];

/**
 * @param {Object} options
 * @param {string} options.url        toolkit service base URL, e.g. http://localhost:8080
 * @param {string} options.token      an app token for the account (aat_…)
 * @param {ReturnType<import('./provider.js').createAdapterProvider>} options.provider
 * @param {string} [options.providerId]  stable id for this running instance (a
 *        slug); keep it across reloads so MCP clients keep their endpoint
 * @param {string} [options.label]    what this instance is, for the console
 *        (e.g. the page it is on)
 * @param {(status: {state: string, message?: string, providerId?: string, endpoints?: object}) => void} [options.onStatus]
 * @param {typeof fetch} [options.fetch]
 */
export function connectToToolkit({ url, token, provider, providerId, label, onStatus = () => {}, fetch: fetcher = globalThis.fetch.bind(globalThis) }) {
  const base = String(url || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('connectToToolkit: url must be the http(s) address of a toolkit service');
  if (typeof token !== 'string' || !token.startsWith('aat_')) throw new Error('connectToToolkit: token must be a toolkit app token (aat_…)');

  let closed = false;
  let attempt = 0;
  let controller = null;
  let state = { state: 'connecting' };
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {});

  const headers = (extra = {}) => ({ authorization: `Bearer ${token}`, ...extra });
  const report = (next) => { state = next; try { onStatus({ ...next }); } catch { /* a status listener must not break the connection */ } };

  async function register() {
    await provider.ready;
    const response = await fetcher(`${base}/v1/providers`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ providerId, label, ...provider.advertisement(), adapters: provider.descriptors() }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(body?.message || body?.error || `registration failed (${response.status})`);
      err.status = response.status;
      err.details = body?.errors;
      throw err;
    }
    providerId = body.providerId;
    provider.providerId = providerId;
    return body;
  }

  async function respond(message) {
    const response = await provider.handle(message);
    if (!response) return;
    await fetcher(`${base}/v1/providers/${encodeURIComponent(providerId)}/channel`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(response),
    }).catch(() => { /* the client times out; the next request will tell */ });
  }

  // Minimal SSE reader over a fetch body: `event:` and `data:` lines, blank
  // line ends an event, `:` lines are keep-alive comments.
  async function readEvents(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message', data = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1));
        if (line === '') {
          if (data.length) onEvent(event, data.join('\n'));
          event = 'message'; data = [];
        } else if (line.startsWith(':')) {
          // keep-alive
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      }
    }
  }

  async function runOnce() {
    const registration = await register();
    controller = new AbortController();
    const response = await fetcher(`${base}/v1/providers/${encodeURIComponent(providerId)}/channel`, {
      headers: headers({ accept: 'text/event-stream' }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const err = new Error(`channel refused (${response.status})`);
      err.status = response.status;
      throw err;
    }
    attempt = 0;
    report({ state: 'connected', providerId, endpoints: registration.endpoints, appId: registration.appId });
    resolveReady({ providerId, endpoints: registration.endpoints });
    await readEvents(response.body, (event, text) => {
      if (event !== 'request') return;
      let message;
      try { message = JSON.parse(text); } catch { return; }
      respond(message).catch(() => {});
    });
  }

  (async () => {
    while (!closed) {
      try {
        await runOnce();
        if (closed) break;
        report({ state: 'reconnecting', providerId, message: 'The toolkit closed the connection.' });
      } catch (e) {
        if (closed) break;
        if (e?.status === 401 || e?.status === 403 || e?.status === 400) {
          report({ state: 'failed', providerId, message: e.message, details: e.details });
          rejectReady(e);
          return;
        }
        report({ state: 'reconnecting', providerId, message: e?.message || String(e) });
      }
      const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      await new Promise(r => setTimeout(r, wait));
    }
  })();

  return {
    ready,
    get status() { return { ...state }; },
    get providerId() { return providerId; },
    /** Stop relaying and tell the service this instance is gone. */
    async close() {
      if (closed) return;
      closed = true;
      controller?.abort();
      if (providerId) {
        await fetcher(`${base}/v1/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE', headers: headers(), keepalive: true }).catch(() => {});
      }
      report({ state: 'closed', providerId });
    },
  };
}

/** A best-effort description of the browser this page runs in, for the
 *  application advertisement's `platform`. Unknown facts are left out. */
export function detectBrowserPlatform(nav = globalThis.navigator) {
  const platform = { environment: 'web-page' };
  if (!nav) return platform;
  const ua = String(nav.userAgent || '');
  const hint = String(nav.userAgentData?.platform || nav.platform || '');
  const os = /android/i.test(ua) ? 'android'
    : /iphone|ipad|ipod/i.test(ua) ? 'ios'
    : /mac/i.test(hint) || /mac os/i.test(ua) ? 'macos'
    : /win/i.test(hint) ? 'windows'
    : /cros/i.test(ua) ? 'chromeos'
    : /linux/i.test(hint) ? 'linux' : null;
  if (os) platform.os = os;
  const browser = /firefox\//i.test(ua) ? 'firefox' : /edg\/|chrome\/|chromium\//i.test(ua) ? 'chromium' : /safari\//i.test(ua) ? 'webkit' : null;
  if (browser) platform.browser = browser;
  return platform;
}
