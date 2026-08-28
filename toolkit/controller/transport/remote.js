// transport/remote.js — run a ControlPort OVER A CHANNEL, so the Controller and
// the receiving app can live in different processes or on different devices
// (see DESIGN.md, "Transport makes it a service"). This is what lets a web
// Controller drive a mobile/XR/desktop receiver: the receiver serves its local
// ControlPort; the Controller talks to a remote proxy that looks identical to a
// local port. The Controller core is unchanged — it never knows it went remote.
//
// The wire is a tiny JSON request/response over a transport-agnostic Channel:
//   Channel = { post(message), subscribe(handler) -> unsubscribe }
// Any duplex transport (WebSocket, postMessage, BroadcastChannel, an HTTP
// long-poll) can be wrapped to this shape. createDirectChannelPair() is the
// in-memory version used by tests and same-page mounts.

const REQ = 'aa-control-req';
const RES = 'aa-control-res';
// An OUT-OF-BAND receiver→Controller push (no id, not a reply to any request):
// a result that arrives after performAction already returned — e.g. a long task
// (30–120s) whose answer would otherwise have nowhere to go. Optional; ignored
// by receivers/Controllers that don't know it.
const NOTE = 'aa-control-note';
// The exact ControlPort surface we proxy. Each is async and returns a result
// object (never throws) — matching the contract in control-port.js.
const METHODS = ['describeCapabilities', 'getContext', 'applySettings', 'undoLast', 'resetUndo', 'getContent', 'performAction'];

/**
 * Serve a local ControlPort over a channel. Attach on the RECEIVER side.
 * @param {Channel} channel
 * @param {import('../control-port.js').ControlPort} port
 * @returns {() => void} detach
 */
export function serveControl(channel, port) {
  return channel.subscribe(async (msg) => {
    if (!msg || msg.kind !== REQ) return;
    let result, error;
    try {
      const fn = port[msg.method];
      result = typeof fn === 'function' ? await fn.apply(port, msg.args || []) : { error: `unknown method: ${msg.method}` };
    } catch (e) {
      error = (e && e.message) || String(e);
    }
    channel.post({ kind: RES, id: msg.id, result, error });
  });
}

/**
 * A ControlPort proxy that forwards to a receiver served over the channel.
 * Attach on the CONTROLLER side. Pass this as `control` to createController.
 * @param {{channel: Channel, timeoutMs?: number}} opts
 * @returns {import('../control-port.js').ControlPort}
 */
export function remoteControl({ channel, timeoutMs = 10000 }) {
  let seq = 0;
  const waiting = new Map();
  const noteHandlers = new Set();

  channel.subscribe((msg) => {
    if (!msg) return;
    // Out-of-band note (no id): a late result. Fan out to onNote subscribers.
    if (msg.kind === NOTE) {
      for (const h of [...noteHandlers]) { try { h(msg.text, msg); } catch { /* handler is best-effort */ } }
      return;
    }
    if (msg.kind !== RES || !waiting.has(msg.id)) return;
    const { resolve, timer } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (timer) clearTimeout(timer);
    resolve(msg.error ? { error: msg.error } : msg.result);
  });

  function call(method, args) {
    return new Promise((resolve) => {
      const id = ++seq;
      const timer = (timeoutMs > 0 && typeof setTimeout === 'function')
        ? setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ error: 'control channel timeout' }); } }, timeoutMs)
        : null;
      if (timer && timer.unref) timer.unref();
      waiting.set(id, { resolve, timer });
      channel.post({ kind: REQ, id, method, args });
    });
  }

  const port = {};
  for (const m of METHODS) port[m] = (...args) => call(m, args);
  // Beyond the ControlPort methods: register for out-of-band receiver notes.
  // Returns an unsubscribe fn. The Controller UI routes these into its live
  // region (see web/ui.js).
  port.onNote = (cb) => { noteHandlers.add(cb); return () => noteHandlers.delete(cb); };
  return port;
}

/** Alias — some hosts read better as connectControl(channel). */
export function connectControl(channel, opts = {}) {
  return remoteControl({ channel, ...opts });
}

/**
 * Wrap a WebSocket into the { post, subscribe } Channel shape, so the Controller
 * can connect OUT to a receiver that hosts a WS endpoint (e.g. a browser-harness
 * daemon). Messages are JSON text frames — the exact wire format serveControl /
 * remoteControl use (see PROTOCOL.md). Messages posted before the socket opens
 * are buffered and flushed on 'open'.
 *
 * @param {string|WebSocket} urlOrSocket  A ws(s):// URL, or an existing
 *   socket-like object (addEventListener/send/close/readyState) — the latter is
 *   handy for tests and for reusing a socket the host already opened.
 * @param {{WebSocketImpl?: any}} [opts]  A WebSocket constructor to use when a
 *   URL is passed and no global `WebSocket` exists (e.g. Node with a ws lib).
 * @returns {Channel & { close(): void, socket: any }}
 */
export function websocketChannel(urlOrSocket, { WebSocketImpl } = {}) {
  let ws;
  if (typeof urlOrSocket === 'string') {
    const WS = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) throw new Error('websocketChannel: no WebSocket implementation available (pass opts.WebSocketImpl)');
    ws = new WS(urlOrSocket);
  } else {
    ws = urlOrSocket;
  }
  const handlers = new Set();
  const outbox = [];
  let open = ws.readyState === 1;
  const flush = () => { open = true; while (outbox.length) ws.send(outbox.shift()); };
  ws.addEventListener('open', flush);
  if (open) flush();
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    for (const h of [...handlers]) h(msg);
  });
  return {
    post(message) {
      const s = JSON.stringify(message);
      if (open && ws.readyState === 1) ws.send(s); else outbox.push(s);
    },
    subscribe(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    close() { try { ws.close(); } catch {} },
    socket: ws,
  };
}

/**
 * Convenience: a ControlPort proxy talking to a receiver over a WebSocket.
 *   const control = connectRemoteReceiver('ws://127.0.0.1:9333');
 *   const c = createController({ control });
 * @returns {import('../control-port.js').ControlPort}
 */
export function connectRemoteReceiver(urlOrSocket, opts = {}) {
  return remoteControl({ channel: websocketChannel(urlOrSocket, opts), timeoutMs: opts.timeoutMs });
}

/**
 * An in-memory linked pair of channels (a ⇄ b). Deliver asynchronously so it
 * behaves like a real transport. Use for tests and same-document wiring.
 * @returns {[Channel, Channel]}
 */
export function createDirectChannelPair() {
  const aHandlers = new Set();
  const bHandlers = new Set();
  const deliver = (handlers, msg) => {
    const fn = (typeof queueMicrotask === 'function') ? queueMicrotask : (cb) => Promise.resolve().then(cb);
    fn(() => { for (const h of [...handlers]) h(msg); });
  };
  const a = { post: (m) => deliver(bHandlers, m), subscribe: (h) => { aHandlers.add(h); return () => aHandlers.delete(h); } };
  const b = { post: (m) => deliver(aHandlers, m), subscribe: (h) => { bHandlers.add(h); return () => bHandlers.delete(h); } };
  return [a, b];
}
