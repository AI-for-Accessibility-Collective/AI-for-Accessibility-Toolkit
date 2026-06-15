// Demo trace emitter. A thin append log in chrome.storage.local that the
// two diagram pages (extension/demo/*.html) tail to light up the part of
// the architecture currently being invoked. Demo-only instrumentation —
// every call site is guarded so removing this file can't break anything.
//
// Classic script (assigns globalThis.aaDemoTrace); loaded by background.js
// via importScripts. Service-worker code (background, librarian, agent)
// calls globalThis.aaDemoTrace(...) directly; page/content contexts send
// { type: 'aaDemoTrace', diagram, region, label } and background relays.

// Writes are serialized through a promise chain: back-to-back calls (e.g.
// the four onboarding traces) would otherwise all read the same stored
// array and clobber each other, leaving only the last event.
let _aaDemoTraceQueue = Promise.resolve();
globalThis.aaDemoTrace = function (diagram, region, label) {
  try {
    const ev = { diagram, region, label: label || '', t: Date.now() };
    _aaDemoTraceQueue = _aaDemoTraceQueue
      .then(() => new Promise((resolve) => {
        chrome.storage.local.get('aaDemoTrace', (d) => {
          const arr = (d && d.aaDemoTrace) || [];
          arr.push(ev);
          if (arr.length > 200) arr.splice(0, arr.length - 200);
          chrome.storage.local.set({ aaDemoTrace: arr }, resolve);
        });
      }))
      .catch(() => {});
    console.log('[aaDemo]', diagram, '→', region, label || '');
  } catch (_) { /* demo logging must never throw */ }
};
