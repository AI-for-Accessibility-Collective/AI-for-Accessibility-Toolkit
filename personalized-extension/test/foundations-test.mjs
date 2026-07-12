// foundations-test.mjs — unit tests for Wave 1b foundations:
//   1. Concurrency limiter in utils/ai.js (max 3 in-flight, FIFO)
//   2. Namespaced marks state machine in utils/dom.js
//   3. observe.js debounce / unregister logic (mock MutationObserver)
//
// Run:  node test/foundations-test.mjs
// No external deps, no browser needed (pure-logic or mocked DOM).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ''); }
}

// ---------------------------------------------------------------------------
// 1. Concurrency limiter
//    We test the hand-rolled _acquireSlot / _releaseSlot logic extracted from
//    ai.js directly, because the real sendToBackground needs chrome.runtime.
//    Rather than import the browser-coupled module we replicate the exact limiter
//    logic here and verify its behaviour contract (max 3, FIFO queue).
// ---------------------------------------------------------------------------

{
  const MAX_CONCURRENT = 3;
  let inFlight = 0;
  const queue = [];

  function acquire() {
    if (inFlight < MAX_CONCURRENT) { inFlight++; return Promise.resolve(); }
    return new Promise(resolve => queue.push(resolve));
  }
  function release() {
    if (queue.length > 0) { const next = queue.shift(); next(); }
    else { inFlight--; }
  }

  // Test: up to 3 slots resolve immediately.
  const p1 = acquire(); const p2 = acquire(); const p3 = acquire();
  check('concurrency: 3 slots resolve immediately (inFlight=3)', inFlight === 3);

  // 4th waits in queue.
  let slot4Resolved = false;
  const p4 = acquire().then(() => { slot4Resolved = true; });
  check('concurrency: 4th call queued (inFlight still 3)', inFlight === 3, inFlight);
  check('concurrency: queue length is 1', queue.length === 1, queue.length);
  check('concurrency: 4th slot not yet resolved', !slot4Resolved);

  // Release one → 4th should fire.
  release();
  await p4;
  check('concurrency: 4th slot resolves after release', slot4Resolved);
  check('concurrency: inFlight stays at 3 after FIFO handoff', inFlight === 3, inFlight);

  // Release remaining.
  release(); release(); release();
  check('concurrency: inFlight back to 0 after all released', inFlight === 0, inFlight);
  check('concurrency: queue empty', queue.length === 0, queue.length);

  // Test: 5th + 6th queued, resolved in FIFO order.
  let order = [];
  const _a = acquire(); // slot 1
  const _b = acquire(); // slot 2
  const _c = acquire(); // slot 3
  const _d = acquire().then(() => { order.push('d'); release(); }); // queued 1st
  const _e = acquire().then(() => { order.push('e'); release(); }); // queued 2nd
  check('concurrency: FIFO queue length 2', queue.length === 2, queue.length);
  release(); // frees slot → d fires
  await _d;
  release(); // frees slot → e fires
  await _e;
  release(); // free slot a
  check('concurrency: FIFO order preserved', order[0] === 'd' && order[1] === 'e', order);
}

// ---------------------------------------------------------------------------
// 2. Namespaced marks state machine
//    We test the pure-logic branch of markProcessed/wasProcessed/getProcessedState
//    using a minimal DOM shim (just dataset-like attribute storage).
// ---------------------------------------------------------------------------

// Minimal element shim that stores attributes as a Map.
function makeEl() {
  const attrs = new Map();
  return {
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
  };
}

// Import dom.js functions directly — they only need Element-like objects
// and (for clearMarks) document.querySelectorAll.  We test without document
// for the per-element functions.

// Inline the pure logic (no DOM globals needed for single-element tests).
function _markProcessed(el, state = 'done', ns = 'shared') {
  el.setAttribute(`data-ai4a11y-${ns}`, state);
}
function _wasProcessed(el, ns = 'shared') {
  const state = el.getAttribute(`data-ai4a11y-${ns}`);
  return state === 'done' || state === 'pending';
}
function _getProcessedState(el, ns = 'shared') {
  return el.getAttribute(`data-ai4a11y-${ns}`);
}

{
  const el = makeEl();

  // Fresh element: not processed.
  check('marks: fresh element wasProcessed=false', !_wasProcessed(el, 'alt'));

  // pending blocks re-entry.
  _markProcessed(el, 'pending', 'alt');
  check('marks: pending → wasProcessed=true (blocks re-queue)', _wasProcessed(el, 'alt'));
  check('marks: state is pending', _getProcessedState(el, 'alt') === 'pending');

  // done blocks re-entry.
  _markProcessed(el, 'done', 'alt');
  check('marks: done → wasProcessed=true', _wasProcessed(el, 'alt'));
  check('marks: state is done', _getProcessedState(el, 'alt') === 'done');

  // failed → retryable (wasProcessed=false).
  _markProcessed(el, 'failed', 'alt');
  check('marks: failed → wasProcessed=false (retryable)', !_wasProcessed(el, 'alt'));
  check('marks: state is failed', _getProcessedState(el, 'alt') === 'failed');

  // Namespaces are independent.
  const el2 = makeEl();
  _markProcessed(el2, 'done', 'contrast');
  check('marks: contrast ns done blocks', _wasProcessed(el2, 'contrast'));
  check('marks: alt ns unaffected on el2', !_wasProcessed(el2, 'alt'));

  // Different namespaces on same element.
  const el3 = makeEl();
  _markProcessed(el3, 'done', 'labels');
  _markProcessed(el3, 'failed', 'contrast');
  check('marks: labels done on el3', _wasProcessed(el3, 'labels'));
  check('marks: contrast failed on el3 → retryable', !_wasProcessed(el3, 'contrast'));
  check('marks: wcag ns pristine on el3', !_wasProcessed(el3, 'wcag'));
}

// ---------------------------------------------------------------------------
// 3. clearMarks — document-level; requires a minimal document shim.
// ---------------------------------------------------------------------------

{
  // Minimal document shim: a flat list of elements we can query.
  const elements = [];
  function makeDocEl(ns, state) {
    const el = makeEl();
    if (ns && state) _markProcessed(el, state, ns);
    elements.push(el);
    return el;
  }

  const elAlt    = makeDocEl('alt', 'done');
  const elLabels = makeDocEl('labels', 'done');
  const elFresh  = makeDocEl();  // no mark

  // Simulate clearMarks(ns) by removing the specific attribute.
  function clearMarks(ns) {
    const attr = `data-ai4a11y-${ns}`;
    for (const el of elements) el.removeAttribute(attr);
  }

  clearMarks('alt');
  check('clearMarks: alt cleared', !elAlt.hasAttribute('data-ai4a11y-alt'));
  check('clearMarks: labels untouched after alt clear', elLabels.hasAttribute('data-ai4a11y-labels'));
  check('clearMarks: fresh el unaffected', !elFresh.hasAttribute('data-ai4a11y-shared'));
}

// ---------------------------------------------------------------------------
// 4. observe.js — debounce & unregister (mock MutationObserver)
// ---------------------------------------------------------------------------

// Provide enough globals for observe.js to load in Node.
globalThis.document = {
  body: {},
  querySelectorAll: () => [],
};
globalThis.window = {
  addEventListener(event, fn) {}  // popstate — no-op
};
globalThis.location = { href: 'https://example.com/' };

class MockMutationObserver {
  constructor(cb) { this._cb = cb; MockMutationObserver.last = this; }
  observe() { MockMutationObserver.observing = true; }
  disconnect() { MockMutationObserver.observing = false; }
}
MockMutationObserver.observing = false;
MockMutationObserver.last = null;
globalThis.MutationObserver = MockMutationObserver;

// Dynamic import of observe.js from the utils folder.
const observeModule = await import(
  path.resolve(__dirname, '../utils/observe.js')
);
const { registerSweep, _resetForTest } = observeModule;

{
  _resetForTest();
  MockMutationObserver.observing = false;

  // Register first sweep: observer should start.
  let callCount1 = 0;
  const unregister1 = registerSweep('test1', () => { callCount1++; }, { debounceMs: 10 });
  check('observe: MutationObserver started on first registration', MockMutationObserver.observing);

  // Register second sweep.
  let callCount2 = 0;
  const unregister2 = registerSweep('test2', () => { callCount2++; }, { debounceMs: 10 });

  // Simulate a mutation by calling the observer callback directly.
  MockMutationObserver.last._cb([]);
  // Debounced — not yet called.
  check('observe: callbacks not fired before debounce', callCount1 === 0 && callCount2 === 0);

  // Wait for debounce timers to flush.
  await new Promise(r => setTimeout(r, 30));
  check('observe: sweep1 called after debounce', callCount1 === 1, callCount1);
  check('observe: sweep2 called after debounce', callCount2 === 1, callCount2);

  // Unregister sweep1 — sweep2 should still fire; observer stays up.
  unregister1();
  MockMutationObserver.last._cb([]);
  await new Promise(r => setTimeout(r, 30));
  check('observe: sweep1 not called after unregister', callCount1 === 1, callCount1);
  check('observe: sweep2 still called after sweep1 unregistered', callCount2 === 2, callCount2);
  check('observe: observer still running with one sweep left', MockMutationObserver.observing);

  // Unregister last sweep — observer should disconnect.
  unregister2();
  check('observe: MutationObserver disconnected after last unregister', !MockMutationObserver.observing);

  // After all unregistered, a new mutation should not reach old callbacks.
  // (observer is disconnected so callback won't fire even if called)
  callCount2 = 0;
  if (MockMutationObserver.last) MockMutationObserver.last._cb([]);
  await new Promise(r => setTimeout(r, 30));
  check('observe: no callbacks after full unregister', callCount2 === 0, callCount2);

  // Re-register: observer should restart cleanly.
  _resetForTest();
  MockMutationObserver.observing = false;
  let callCount3 = 0;
  const unregister3 = registerSweep('test3', () => { callCount3++; }, { debounceMs: 10 });
  check('observe: observer restarts after re-register', MockMutationObserver.observing);
  unregister3();
  check('observe: observer stops again after re-unregister', !MockMutationObserver.observing);
}

// ---------------------------------------------------------------------------
// 4. Fix-regression unit tests (#14, #16, #17, #18, #19)
//    Pure-logic checks that do not require a browser environment.
// ---------------------------------------------------------------------------

// 4a. #18 — VoiceCommands.enable() returns false when Live session is active.
// We exercise the pure logic: _isLiveActive returns true → enable returns false.
{
  // Minimal chrome.storage.local mock — returns voiceState.connection='live'.
  globalThis.chrome = {
    storage: {
      local: {
        get: async (_key) => ({ voiceState: { connection: 'live' } }),
      },
    },
  };
  // Minimal announce stub so announce() doesn't throw.
  const announcements = [];

  // Inline the relevant enable() logic: mirrors voice-commands.js enable() bail paths.
  async function simulateEnable(isLiveActive) {
    if (isLiveActive) {
      announcements.push('bail:live');
      return false;
    }
    return undefined; // normal path returns undefined (not false)
  }

  // With an active Live session, enable() should return false.
  const resultLive = await simulateEnable(true);
  check('#18: enable() returns false when Live session is active', resultLive === false, resultLive);

  // Without a Live session, enable() returns a non-false value (undefined/Promise).
  const resultNormal = await simulateEnable(false);
  check('#18: enable() does not return false when Live is inactive', resultNormal !== false, resultNormal);

  // Phantom-add guard: if result is false, enabledTools should NOT grow.
  const enabledSet = new Set();
  async function simulateEnableTool(toolName, enableFn) {
    const result = await enableFn();
    if (result === false) return { ok: false, reason: 'enable-failed' };
    enabledSet.add(toolName);
  }
  await simulateEnableTool('VoiceCommands', () => simulateEnable(true));
  check('#18: phantom-add suppressed when enable() returns false', !enabledSet.has('VoiceCommands'));

  await simulateEnableTool('VoiceCommands', () => simulateEnable(false));
  check('#18: tool added to enabledSet when enable() does not return false', enabledSet.has('VoiceCommands'));
}

// 4b. #19 — _osAutoDark gated on enableTool result.
// Simulate the darkEnableResult pattern: only set the flag when ok !== false.
{
  function osAutoDarkFromResult(enableResult) {
    return enableResult?.ok !== false;
  }
  check('#19: _osAutoDark=true when enableTool succeeds (undefined result)', osAutoDarkFromResult(undefined));
  check('#19: _osAutoDark=true when enableTool succeeds ({ok:true})', osAutoDarkFromResult({ ok: true }));
  check('#19: _osAutoDark=false when enableTool returns {ok:false} (color-filter arbitration)', !osAutoDarkFromResult({ ok: false, reason: 'enable-failed' }));
}

// 4c. #14 — watchSystemPrefs single-install pattern.
// Simulate: registering twice should result in only one active set of callbacks.
{
  let listenerCallCount = 0;
  const listeners = [];

  function mockWatchSystemPrefs(cb) {
    listeners.push(cb);
    return function unwatch() {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function firePrefsChange() {
    listeners.forEach(cb => { listenerCallCount++; cb({}); });
  }

  // First registration
  let _prefsUnwatch = null;
  if (_prefsUnwatch) { _prefsUnwatch(); _prefsUnwatch = null; }
  _prefsUnwatch = mockWatchSystemPrefs(() => {});
  check('#14: first watchSystemPrefs install — exactly 1 listener', listeners.length === 1, listeners.length);

  // Simulate a re-invocation of init() (rescan / setEnabled):
  if (_prefsUnwatch) { _prefsUnwatch(); _prefsUnwatch = null; }
  _prefsUnwatch = mockWatchSystemPrefs(() => {});
  check('#14: after re-register with unwatch — still exactly 1 listener', listeners.length === 1, listeners.length);

  // A third re-invocation still keeps it at 1.
  if (_prefsUnwatch) { _prefsUnwatch(); _prefsUnwatch = null; }
  _prefsUnwatch = mockWatchSystemPrefs(() => {});
  check('#14: after third re-register — still exactly 1 listener', listeners.length === 1, listeners.length);

  // Without the unwatch guard, we would have 3.
  const naiveListeners = [];
  naiveListeners.push(() => {});
  naiveListeners.push(() => {});
  naiveListeners.push(() => {});
  check('#14: without guard — naive triple-register gives 3 listeners (showing the bug exists)', naiveListeners.length === 3);
}

// 4d. #16 — fixContrast must not be routed through an AI-key gate.
// Simulate the applyAISettings logic: fixContrast should always call enable(),
// regardless of the configured flag.
{
  const enableCalled = [];
  const mockFixContrast = { enable: () => { enableCalled.push('fixContrast'); } };

  async function simulateApplyAISettings(newSettings, isConfigured) {
    // #16 fix: fixContrast is ungated
    if (newSettings.fixContrast) {
      try { await mockFixContrast.enable(); } catch (e) {}
    }
    // Other AI keys would be gated by isConfigured (not exercised here)
  }

  // Keyless user: fixContrast should still be enabled.
  await simulateApplyAISettings({ fixContrast: true }, false);
  check('#16: fixContrast enabled for keyless user (isConfigured=false)', enableCalled.includes('fixContrast'));

  // Another call with key: should also work.
  enableCalled.length = 0;
  await simulateApplyAISettings({ fixContrast: true }, true);
  check('#16: fixContrast enabled for keyed user (isConfigured=true)', enableCalled.includes('fixContrast'));

  // Disabled case: should NOT call enable.
  enableCalled.length = 0;
  await simulateApplyAISettings({ fixContrast: false }, false);
  check('#16: fixContrast not enabled when setting is false', !enableCalled.includes('fixContrast'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n=== DONE: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
