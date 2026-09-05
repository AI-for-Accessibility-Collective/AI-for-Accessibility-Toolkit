// iframe-receiver.js — a ControlPort over an IFRAME, via postMessage.
//
// The remote receiver drives a browser from outside over CDP. That is
// unavailable when a screen reader runs on a hosted Windows VM (Assistiv Labs):
// the page under test must render in THAT machine's browser, which nothing on
// this side can attach to. So the page is served from localhost by a proxy that
// injects the adapter bundle plus a bridge, and the chat speaks to it by
// postMessage. Chat and page then sit in ONE accessibility tree — which is what
// lets a screen reader move between them.
//
// This is a third implementation of the same ControlPort shape (mock-receiver =
// in-process, dom-receiver = same document, remoteControl = over a channel), so
// the router, grammar and chat logic drive it unchanged.
//
// Wire contract (browser-harness-a11y scripts/iframe-host/bridge.js):
//   → frame: { kind:'bh-iframe-req',  id, method, args }
//   ← frame: { kind:'bh-iframe-res',  id, result, error }
//   ← frame: 'bh-iframe-ready'                 (scripts have run)
//   ← frame: { kind:'bh-iframe-navigate', url } (link click; the HOST must reload
//                                                through the proxy or the next
//                                                page arrives unadapted+unframed)

const REQ = 'bh-iframe-req';
const RES = 'bh-iframe-res';
const READY = 'bh-iframe-ready';
const NAVIGATE = 'bh-iframe-navigate';

// Settings that are BROWSER preferences (reached via chrome://settings), not
// anything a page can do. A page-level bundle can't touch them, so they're
// subtracted from whatever the frame reports — reported unsupported up front
// rather than accepted and silently ignored. Overridable per host.
export const BROWSER_ONLY_KEYS = ['liveCaptions', 'caretBrowsing', 'hideProfanity', 'liveTranslate'];

/**
 * @param {HTMLIFrameElement} iframe   The frame showing the proxied page.
 * @param {Object} [opts]
 * @param {string} [opts.proxyBase]    Iframe-host base, e.g. 'http://127.0.0.1:8124/'.
 *   Used to (re)load a URL through the proxy — including link clicks the frame
 *   forwards as `bh-iframe-navigate`.
 * @param {number} [opts.timeoutMs]    Per-call timeout (default 5000).
 * @param {string[]} [opts.browserOnlyKeys]  Keys to report unsupported (see above).
 * @param {Window} [opts.win]          Window to listen on (default: globalThis).
 * @returns {import('../control-port.js').ControlPort & {
 *   ready: Promise<void>, proxyUrl(url:string): string, destroy(): void }}
 */
export function createIframeReceiver(iframe, {
  proxyBase = 'http://127.0.0.1:8124/',
  timeoutMs = 5000,
  browserOnlyKeys = BROWSER_ONLY_KEYS,
  win = (typeof globalThis !== 'undefined' ? globalThis : undefined),
} = {}) {
  let seq = 0;
  const waiting = new Map();
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const blocked = new Set(browserOnlyKeys);

  // The iframe host's fetch route (scripts/iframe-host/server.py): /go?url=…
  const proxyUrl = (url) => proxyBase.replace(/\/+$/, '') + '/go?url=' + encodeURIComponent(String(url || ''));

  function onMessage(ev) {
    const m = ev && ev.data;
    if (!m) return;
    if (m === READY || m.kind === READY) { readyResolve(); return; }
    if (m.kind === NAVIGATE) { if (m.url) iframe.src = proxyUrl(m.url); return; }
    if (m.kind !== RES || !waiting.has(m.id)) return;
    const { resolve, timer } = waiting.get(m.id);
    waiting.delete(m.id);
    if (timer) clearTimeout(timer);
    resolve(m.error ? { error: m.error } : m.result);
  }
  if (win && win.addEventListener) win.addEventListener('message', onMessage);

  // Never throws: a dead frame resolves to an { error } result like every other
  // ControlPort failure (control-port.js), so the router reports it honestly.
  function call(method, args = []) {
    return new Promise((resolve) => {
      const id = String(++seq);
      const target = iframe && iframe.contentWindow;
      if (!target) { resolve({ error: 'the framed page is not loaded' }); return; }
      const timer = (timeoutMs > 0 && typeof setTimeout === 'function')
        ? setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ error: 'the framed page did not respond' }); } }, timeoutMs)
        : null;
      if (timer && timer.unref) timer.unref();
      waiting.set(id, { resolve, timer });
      // '*' is what the bridge replies with; the frame is a localhost proxy whose
      // port this side shouldn't have to know.
      try { target.postMessage({ kind: REQ, id, method, args }, '*'); }
      catch (e) { waiting.delete(id); if (timer) clearTimeout(timer); resolve({ error: (e && e.message) || 'could not reach the framed page' }); }
    });
  }

  // What this mode can HONESTLY do — corrected before the Controller ever offers
  // it to the person, rather than discovered when a change silently does nothing:
  //   • no `task`: the agent drives a browser over CDP, and there is none here.
  //   • no browser-level settings: a page cannot reach chrome://settings.
  //   • no `stop`: nothing long-running to interrupt.
  async function describeCapabilities() {
    const caps = await call('describeCapabilities');
    if (!caps || caps.error) {
      return { platform: 'iframe', settingKeys: [], actions: [], canReadContent: false, canStop: false, error: caps && caps.error };
    }
    return {
      ...caps,
      platform: caps.platform || 'iframe',
      settingKeys: (caps.settingKeys || []).filter((k) => !blocked.has(k)),
      actions: (caps.actions || []).filter((a) => a !== 'task'),
      canReadContent: caps.canReadContent !== false,
      canStop: false,
    };
  }

  return {
    ready,
    proxyUrl,
    describeCapabilities,
    async getContext() {
      const ctx = await call('getContext');
      if (!ctx || ctx.error) return { focus: null, activeSettings: {}, capabilities: await describeCapabilities() };
      return { ...ctx, capabilities: await describeCapabilities() };
    },
    async applySettings(changes, scope) {
      // Refuse browser-level keys here too, not just in the capability list — a
      // caller that skipped describeCapabilities still gets an honest answer.
      const wanted = {}, rejected = [];
      for (const [k, v] of Object.entries(changes || {})) (blocked.has(k) ? rejected.push(k) : (wanted[k] = v));
      if (!Object.keys(wanted).length) {
        return { error: 'a page cannot change browser settings — try the remote receiver', rejected };
      }
      const r = await call('applySettings', [wanted, scope]);
      if (r && r.rejected) r.rejected = [...r.rejected, ...rejected];
      else if (r && !r.error && rejected.length) r.rejected = rejected;
      return r;
    },
    async undoLast() { return await call('undoLast'); },
    async resetUndo() {
      // The frame owns the undo journal and the bridge exposes no reset; a fresh
      // control session is all this promises, and nothing depends on the frame's
      // stack being emptied.
      const r = await call('resetUndo');
      return (r && r.error && /unknown method/i.test(r.error)) ? { ok: true } : (r || { ok: true });
    },
    async getContent(mode = 'outline', chunk = 0) { return await call('getContent', [mode, chunk]); },
    async performAction(actionId, target, text, meta) {
      if (actionId === 'task') {
        return { ok: false, detail: 'there is no agent in this mode — try a setting, or connect the remote receiver' };
      }
      return await call('performAction', [actionId, target, text, meta]);
    },
    async stop() { return { ok: true, stopped: false, detail: 'nothing long-running in this mode' }; },
    /** Point the frame at a URL through the proxy (so it stays adapted + framed). */
    load(url) { iframe.src = proxyUrl(url); },
    destroy() {
      if (win && win.removeEventListener) win.removeEventListener('message', onMessage);
      for (const { timer } of waiting.values()) if (timer) clearTimeout(timer);
      waiting.clear();
    },
  };
}

export default createIframeReceiver;
