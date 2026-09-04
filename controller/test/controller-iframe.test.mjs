// Controller — the IFRAME receiver. A third implementation of the same
// ControlPort shape, for the case CDP can't reach: a screen reader on a hosted
// Windows VM reads the page in ITS browser, so the page is served from
// localhost into an iframe and driven by postMessage.
//
// The stub below plays the role of browser-harness-a11y's
// scripts/iframe-host/bridge.js, so this exercises the real wire contract
// (bh-iframe-req / -res / -ready / -navigate) without a browser.
//
//   node controller/test/controller-iframe.test.mjs
import { createIframeReceiver, BROWSER_ONLY_KEYS } from '../web/iframe-receiver.js';
import { createController } from '../createController.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// A window that fans 'message' events to listeners, standing in for the browser.
function fakeWin() {
  const listeners = new Set();
  return {
    addEventListener(t, fn) { if (t === 'message') listeners.add(fn); },
    removeEventListener(t, fn) { listeners.delete(fn); },
    _deliver(data) { for (const fn of [...listeners]) fn({ data }); },
    _count: () => listeners.size,
  };
}

// The frame side: answers the bridge's method names.
function fakeFrame(win, { settingKeys, actions, dead = false, silent = false } = {}) {
  const settings = {};
  const undoStack = [];
  const frame = {
    src: null,
    contentWindow: dead ? null : {
      postMessage(msg) {
        if (silent) return;                       // never replies → timeout path
        if (!msg || msg.kind !== 'bh-iframe-req') return;
        const reply = (result, error) => win._deliver({ kind: 'bh-iframe-res', id: msg.id, result, error });
        const [a0, a1] = msg.args || [];
        switch (msg.method) {
          case 'describeCapabilities':
            return reply({
              platform: 'browser-harness-iframe',
              settingKeys: settingKeys || ['fontScale', 'darkMode', 'liveCaptions'],
              actions: actions || ['activate', 'scroll', 'back', 'forward', 'navigate'],
              canReadContent: true, targets: ['Docs'],
            });
          case 'getContext':
            return reply({ focus: 'Example', url: 'https://example.com/', activeSettings: { ...settings } });
          case 'applySettings': {
            const previous = {}, applied = {};
            for (const [k, v] of Object.entries(a0 || {})) { previous[k] = settings[k] ?? null; settings[k] = v; applied[k] = v; }
            if (!Object.keys(applied).length) return reply({ error: 'nothing applied', rejected: [] });
            undoStack.push(previous);
            return reply({ applied, previous, rejected: [] });
          }
          case 'undoLast': {
            if (!undoStack.length) return reply({ error: 'nothing to undo' });
            const prev = undoStack.pop();
            for (const [k, v] of Object.entries(prev)) { if (v === null) delete settings[k]; else settings[k] = v; }
            return reply({ reverted: prev, remainingUndos: undoStack.length });
          }
          case 'getContent':
            return reply({ source: 'untrusted-content', title: 'Example', outline: ['Example', 'Details'] });
          case 'performAction':
            return reply({ ok: true, detail: `${a0}${a1 ? ' ' + a1 : ''}` });
          default:
            return reply(undefined, `unknown method: ${msg.method}`);
        }
      },
    },
    _settings: settings,
  };
  return frame;
}

async function run() {
  // ── honesty: what this mode cannot do is declared, not discovered ──────────
  {
    const win = fakeWin();
    const frame = fakeFrame(win);
    const rx = createIframeReceiver(frame, { win });
    const caps = await rx.describeCapabilities();
    check('caps: browser-only keys are reported unsupported', !caps.settingKeys.includes('liveCaptions'), caps.settingKeys);
    check('caps: page-level keys survive', caps.settingKeys.includes('fontScale') && caps.settingKeys.includes('darkMode'));
    check('caps: no `task` (there is no agent here)', !caps.actions.includes('task'));
    check('caps: page actions survive', caps.actions.includes('scroll') && caps.actions.includes('activate'));
    check('caps: canStop false', caps.canStop === false);
    check('BROWSER_ONLY_KEYS is exported for hosts to adjust', Array.isArray(BROWSER_ONLY_KEYS) && BROWSER_ONLY_KEYS.includes('liveCaptions'));
    rx.destroy();
  }

  // ── driving it: the same ControlPort the router already speaks ─────────────
  {
    const win = fakeWin();
    const frame = fakeFrame(win);
    const rx = createIframeReceiver(frame, { win });
    const c = createController({ control: rx });

    const r = await c.handle('text size 150');
    check('adapt: applies through the frame', r.ok && frame._settings.fontScale === 150, r.say);

    const u = await c.handle('undo');
    check('undo: reverts through the frame', u.ok && frame._settings.fontScale === undefined);

    const rd = await c.handle('read this');
    check('getContent: reads the framed page', rd.ok && /example/i.test(rd.say), rd.say);

    const sc = await c.handle('scroll down');
    check('performAction: scrolls the framed page', sc.ok);

    rx.destroy();
  }

  // ── a browser-level key is refused, not silently swallowed ────────────────
  {
    const win = fakeWin();
    const frame = fakeFrame(win);
    const rx = createIframeReceiver(frame, { win });
    const res = await rx.applySettings({ liveCaptions: false });
    check('applySettings: browser-only key refused with a reason', !!res.error && res.rejected.includes('liveCaptions'), res);
    check('applySettings: and it never reached the frame', !('liveCaptions' in frame._settings));

    // Mixed: the page-level half still applies, the rest is rejected.
    const mixed = await rx.applySettings({ fontScale: 130, liveCaptions: true });
    check('applySettings: mixed request applies what it can', mixed.applied && mixed.applied.fontScale === 130);
    check('applySettings: and reports the rest rejected', (mixed.rejected || []).includes('liveCaptions'), mixed);
    rx.destroy();
  }

  // ── a task has nowhere to go, and says so ─────────────────────────────────
  {
    const win = fakeWin();
    const rx = createIframeReceiver(fakeFrame(win), { win });
    const t = await rx.performAction('task', null, 'book me a flight');
    check('task: refused with an actionable reason (not silence)', t.ok === false && /no agent/i.test(t.detail), t);
    check('stop: honest no-op', (await rx.stop()).stopped === false);
    rx.destroy();
  }

  // ── failure modes resolve to { error }, never throw ───────────────────────
  {
    const win = fakeWin();
    const rx = createIframeReceiver(fakeFrame(win, { dead: true }), { win });
    const r = await rx.applySettings({ fontScale: 120 });
    check('dead frame: resolves to an error result', !!r.error, r);
    const caps = await rx.describeCapabilities();
    check('dead frame: capabilities degrade to nothing supported', caps.settingKeys.length === 0 && caps.actions.length === 0);
    rx.destroy();
  }
  {
    const win = fakeWin();
    const rx = createIframeReceiver(fakeFrame(win, { silent: true }), { win, timeoutMs: 40 });
    // The receiver unrefs its timeout (copied from remote.js so a host's tests
    // never hang on it). In node that means an otherwise-idle loop would exit
    // before it fires, so hold the loop open while we wait for it.
    const keepalive = setInterval(() => {}, 10);
    const r = await rx.getContent('outline');
    clearInterval(keepalive);
    check('unresponsive frame: times out to an error result', !!r.error, r);
    rx.destroy();
  }

  // ── ready + navigate: the frame's own signals ─────────────────────────────
  {
    const win = fakeWin();
    const frame = fakeFrame(win);
    const rx = createIframeReceiver(frame, { win, proxyBase: 'http://127.0.0.1:8124/' });
    let readyFired = false;
    rx.ready.then(() => { readyFired = true; });
    win._deliver('bh-iframe-ready');
    await new Promise((r) => setTimeout(r, 0));
    check('ready: resolves when the frame signals it', readyFired);

    // A link click inside the frame must reload THROUGH the proxy, or the next
    // page arrives unadapted and unframed.
    // The host's fetch route is /go?url=… — a path-appended URL 404s, and the
    // frame then silently never answers (found in a live check, not here).
    win._deliver({ kind: 'bh-iframe-navigate', url: 'https://example.org/next' });
    check('navigate: reloads the frame through the proxy /go route',
      frame.src === 'http://127.0.0.1:8124/go?url=' + encodeURIComponent('https://example.org/next'), frame.src);

    rx.load('https://example.com/a?x=1&y=2');
    check('load(): uses /go and encodes the whole URL (query included)',
      frame.src === 'http://127.0.0.1:8124/go?url=' + encodeURIComponent('https://example.com/a?x=1&y=2'), frame.src);

    // A trailing-slash-less base must not produce '//go'.
    const rx2 = createIframeReceiver({ src: null, contentWindow: null }, { win, proxyBase: 'http://127.0.0.1:8124' });
    check('proxyUrl: tolerates a base with no trailing slash',
      rx2.proxyUrl('https://a.test') === 'http://127.0.0.1:8124/go?url=' + encodeURIComponent('https://a.test'), rx2.proxyUrl('https://a.test'));
    rx2.destroy();

    rx.destroy();
    check('destroy: unsubscribes from the window', win._count() === 0);
  }

  console.log(`\nController iframe receiver: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
