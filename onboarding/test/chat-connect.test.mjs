// When a receiver counts as connected, and so when the profile may be applied
// to it.
//
// /chat applies the person's profile to whatever it drives. For a remote
// receiver that has to wait for the socket to open: useRemote() returns before
// the connection exists, and a request posted then waits in the channel's
// outbox with its timeout already running. And a socket the person
// has since replaced (they clicked Connect twice, or fell back to the preview)
// must never apply anything, or a slow first connection could stomp the second.
// watchConnection() is the small piece of chat.js that decides both, lifted out
// so this file can reach it. The wiring that calls applyProfileSettings() from
// onConnected stays in chat.js and is covered by chat-e2e.mjs.
//
//   node onboarding/test/chat-connect.test.mjs

import { watchConnection } from '../chat-connect.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// A socket that opens only when the test says so. readyState follows the
// WebSocket constants: 0 connecting, 1 open, 3 closed.
class FakeSocket {
  constructor(readyState = 0) { this.readyState = readyState; this._l = {}; }
  addEventListener(t, fn) { (this._l[t] || (this._l[t] = [])).push(fn); }
  emit(t) { (this._l[t] || []).forEach((fn) => fn({})); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
}

// Count what a socket reported. `live` defaults to true; a test that models a
// replaced socket passes its own.
function watch(sock, live = () => true) {
  const seen = { connected: 0, failed: 0, lost: 0 };
  watchConnection(sock, {
    live,
    onConnected: () => { seen.connected++; },
    onFailed: () => { seen.failed++; },
    onLost: () => { seen.lost++; },
  });
  return seen;
}

// ── the profile waits for the socket ─────────────────────────────────────────
{
  const s = new FakeSocket();
  const seen = watch(s);
  check('nothing is reported before the socket opens', seen.connected === 0 && seen.failed === 0 && seen.lost === 0);
  s.open();
  check('the open event is the connected moment', seen.connected === 1);
  check('…reported once', seen.failed === 0 && seen.lost === 0);
}

// ── a socket that is already open counts as connected now ────────────────────
// websocketChannel accepts a socket the host already opened; there is no open
// event still to come, so waiting for one would wait forever.
{
  const s = new FakeSocket(1);
  const seen = watch(s);
  check('an already-open socket is connected at once', seen.connected === 1);
  s.close();
  check('…and its later close is still a loss', seen.lost === 1 && seen.failed === 0);
}

// ── a replaced socket never reports, so it can never apply ───────────────────
// This is the guard the profile application rides on: the person connects,
// then connects again (or falls back to the preview) before the first socket
// opens. When the first one finally opens it is nobody's socket any more.
{
  let current = null;
  const first = new FakeSocket();
  const seenFirst = watch(first, () => current === first);
  current = first;

  const second = new FakeSocket();
  const seenSecond = watch(second, () => current === second);
  current = second; // replaced before `first` ever opened

  first.open();
  check('a replaced socket opening reports nothing', seenFirst.connected === 0);
  second.open();
  check('the socket now driven reports connected', seenSecond.connected === 1);

  first.close();
  check('a replaced socket closing reports nothing either', seenFirst.lost === 0 && seenFirst.failed === 0);
}

// ── failure before open is failed; loss after open is lost ───────────────────
// The two states offer different actions in the page (retry vs reconnect), so
// the difference is whether the socket had ever opened.
{
  const s = new FakeSocket();
  const seen = watch(s);
  s.emit('error');
  check('an error before open is a failure', seen.failed === 1 && seen.connected === 0);
  s.close();
  check('the close that follows is a failure too, not a loss', seen.failed === 2 && seen.lost === 0);
}
{
  const s = new FakeSocket();
  const seen = watch(s);
  s.open();
  s.close();
  check('a close after open is a loss', seen.lost === 1 && seen.failed === 0);
}
{
  const s = new FakeSocket();
  const seen = watch(s);
  s.open();
  s.emit('error');
  check('an error after open is not reported as a failure', seen.failed === 0);
}

// ── a replaced socket that was open is not a loss the page should show ───────
{
  let current = null;
  const s = new FakeSocket();
  const seen = watch(s, () => current === s);
  current = s;
  s.open();
  current = null; // the person went back to the preview
  s.close();
  check('closing the socket the person left does not report a loss', seen.lost === 0 && seen.connected === 1);
}

console.log(`\nChat connect: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
