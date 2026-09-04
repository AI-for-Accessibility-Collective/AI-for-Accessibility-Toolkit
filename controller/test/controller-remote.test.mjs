// Controller M5 test — the remote transport. The receiver is served over an
// in-memory channel; the Controller drives it through a remote proxy. The whole
// point: the SAME core produces the SAME behavior across a wire, with no change
// to the Controller — proving "the Controller is a service".
//
//   node toolkit/test/controller-remote.test.mjs

import { createDirectChannelPair, serveControl, remoteControl, websocketChannel, connectRemoteReceiver } from '../transport/remote.js';
import { createController } from '../createController.js';
import { createMockReceiver } from '../mock-receiver.js';

// A minimal linked WebSocket-like pair (opens asynchronously, like a real socket).
class FakeSocket {
  constructor() { this.readyState = 0; this._l = { open: [], message: [], close: [] }; this.peer = null; }
  addEventListener(t, fn) { (this._l[t] || (this._l[t] = [])).push(fn); }
  _emit(t, ev) { (this._l[t] || []).forEach((fn) => fn(ev)); }
  send(data) { const p = this.peer; queueMicrotask(() => p && p._emit('message', { data })); }
  close() { this.readyState = 3; this._emit('close', {}); }
}
function fakeSocketPair() {
  const a = new FakeSocket(), b = new FakeSocket();
  a.peer = b; b.peer = a;
  queueMicrotask(() => { a.readyState = 1; b.readyState = 1; a._emit('open', {}); b._emit('open', {}); });
  return [a, b];
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

async function run() {
  // Receiver on one end of the channel; Controller on the other.
  const receiver = createMockReceiver({ actions: ['activate', 'scroll'] });
  const [clientCh, serverCh] = createDirectChannelPair();
  const detach = serveControl(serverCh, receiver);
  const remote = remoteControl({ channel: clientCh });
  const c = createController({ control: remote });

  // capabilities round-trip
  const caps = await remote.describeCapabilities();
  check('remote: describeCapabilities round-trips', caps.platform === 'mock' && caps.settingKeys.includes('fontScale'));

  // adapt over the wire (dispatch reads context THEN applies — two round-trips)
  const r1 = await c.handle('text size 150');
  check('remote: adapt applies on the far receiver', r1.ok && receiver.settings.fontScale === 150);

  const r2 = await c.handle('bigger text'); // delta resolves against remote context → 160
  check('remote: relative delta uses remote context', receiver.settings.fontScale === 160);

  // read content over the wire
  const rd = await c.handle('read this');
  check('remote: getContent round-trips', rd.ok && /demo document/i.test(rd.say));

  // command over the wire
  const rc = await c.handle('click documentation');
  check('remote: performAction round-trips', rc.ok && receiver.focus === 'activate:documentation');

  // undo over the wire
  const ru = await c.handle('undo');
  check('remote: undoLast round-trips (fontScale back to 150)', ru.ok && receiver.settings.fontScale === 150);

  // honesty survives the wire: unsupported key still refused
  const recv2 = createMockReceiver({ settingKeys: ['fontScale'] }); // no darkMode
  const [cc, sc] = createDirectChannelPair();
  serveControl(sc, recv2);
  const c2 = createController({ control: remoteControl({ channel: cc }) });
  const rh = await c2.handle('dark mode');
  check('remote: honesty preserved — unsupported key refused across the wire', rh.ok === false && !('darkMode' in recv2.settings));

  detach();
  check('remote: detach returns a function', typeof detach === 'function');

  // ── websocketChannel: the same thing over a (fake) WebSocket ──────────────
  {
    const recv = createMockReceiver({ actions: ['scroll'] });
    const [clientSock, serverSock] = fakeSocketPair();
    serveControl(websocketChannel(serverSock), recv);           // receiver side hosts the endpoint
    const remoteWs = connectRemoteReceiver(clientSock);          // controller connects out (buffers until open)
    const c = createController({ control: remoteWs });

    const caps = await remoteWs.describeCapabilities();
    check('ws-channel: request sent before open is buffered then flushed', caps.settingKeys.includes('fontScale'));

    const r = await c.handle('text size 150');
    check('ws-channel: adapt applies across a WebSocket', r.ok && recv.settings.fontScale === 150);

    const rr = await c.handle('read this');
    check('ws-channel: getContent round-trips over the socket', rr.ok && /demo document/i.test(rr.say));

    clientSock.close();
    check('ws-channel: socket exposes close()', clientSock.readyState === 3);
  }

  // ── Out-of-band receiver→Controller note (a late task result) ─────────────
  {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const recv = createMockReceiver();
    const [cc, sc] = fakeSocketPair();
    const sChan = websocketChannel(sc);
    serveControl(sChan, recv);
    const remote = remoteControl({ channel: websocketChannel(cc) });

    let got = null;
    const off = remote.onNote((t) => { got = t; });
    sChan.post({ kind: 'aa-control-note', text: 'The top story is X' });
    await tick();
    check('onNote: receives an out-of-band note (no id)', got === 'The top story is X');

    // A note must not be mistaken for a response — normal calls still work.
    check('onNote: a note does not corrupt the request/response path', (await remote.describeCapabilities()).platform === 'mock');

    off(); got = null;
    sChan.post({ kind: 'aa-control-note', text: 'ignored' });
    await tick();
    check('onNote: unsubscribe stops delivery', got === null);
  }

  // ── stop(): interrupt a running task across the wire ──────────────────────
  {
    const recv = createMockReceiver({ actions: ['task'] });
    const [cc, sc] = createDirectChannelPair();
    serveControl(sc, recv);
    const remote = remoteControl({ channel: cc });
    const c = createController({ control: remote, rawToTask: true });

    const caps = await remote.describeCapabilities();
    check('stop: canStop advertised across the wire (task receiver)', caps.canStop === true);

    // Nothing running yet → stop is a no-op.
    check('stop: no-op when nothing is running', (await c.stop()).stopped === false);

    // Kick off a task, then stop it — the interrupt reaches the far receiver.
    await c.handle('find me a lasagna recipe');
    const s = await c.stop();
    check('stop: interrupts the running task across the wire', s.ok === true && s.stopped === true);
    check('stop: a second stop reports nothing running', (await c.stop()).stopped === false);
  }

  console.log(`\nController M5 (remote transport): ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
