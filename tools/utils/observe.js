// utils/observe.js — shared debounced MutationObserver + SPA URL-change hook.
//
// Adapters call registerSweep(name, callback, {debounceMs}) in enable() and
// call the returned unregister fn in disable().  One module-level observer
// is started lazily on the first registration and disconnected when the last
// sweep unregisters — no per-adapter observers needed.
//
// SPA URL changes are detected two ways:
//   1. 'popstate' event (back/forward nav, pushState-based routers fire this)
//   2. Polling location.href inside the debounced mutation flush (captures
//      history.pushState() callers that don't dispatch popstate).
// No history monkey-patching is needed or used.

let _sweeps = new Map();     // name → { callback, debounceMs }
let _observer = null;
let _debounceTimers = new Map(); // name → timer id
let _lastHref = typeof location !== 'undefined' ? location.href : '';

function _flush(reason) {
  _lastHref = typeof location !== 'undefined' ? location.href : _lastHref;
  for (const [name, { callback }] of _sweeps) {
    try { callback({ reason }); }
    catch (e) { console.warn(`[AI4A11y] observe: sweep "${name}" error:`, e); }
  }
}

function _scheduleSweep(reason) {
  // Each registered sweep gets its own debounce timer keyed by name.
  for (const [name, { callback, debounceMs }] of _sweeps) {
    if (_debounceTimers.has(name)) clearTimeout(_debounceTimers.get(name));
    _debounceTimers.set(name, setTimeout(() => {
      _debounceTimers.delete(name);
      // Check for SPA URL change during the debounce window.
      const currentHref = typeof location !== 'undefined' ? location.href : _lastHref;
      const effectiveReason = currentHref !== _lastHref ? 'urlchange' : reason;
      _lastHref = currentHref;
      try { callback({ reason: effectiveReason }); }
      catch (e) { console.warn(`[AI4A11y] observe: sweep "${name}" error:`, e); }
    }, debounceMs));
  }
}

function _startObserver() {
  if (_observer || typeof MutationObserver === 'undefined') return;
  if (typeof document === 'undefined' || !document.body) return;
  _observer = new MutationObserver(() => _scheduleSweep('mutation'));
  _observer.observe(document.body, { childList: true, subtree: true });
}

function _stopObserver() {
  if (!_observer) return;
  _observer.disconnect();
  _observer = null;
  for (const t of _debounceTimers.values()) clearTimeout(t);
  _debounceTimers.clear();
}

// popstate covers browser back/forward and pushState routers that dispatch it.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const currentHref = typeof location !== 'undefined' ? location.href : _lastHref;
    if (_sweeps.size > 0 && currentHref !== _lastHref) {
      _lastHref = currentHref;
      _flush('urlchange');
    }
  });
}

/**
 * Register a sweep callback fired on DOM mutation or SPA URL change.
 *
 * @param {string}   name        Unique name for this sweep (adapter ID).
 * @param {Function} callback    fn({reason: 'mutation'|'urlchange'})
 * @param {object}   [opts]
 * @param {number}   [opts.debounceMs=500]
 * @returns {Function}  unregister — call in adapter's disable()
 */
export function registerSweep(name, callback, { debounceMs = 500 } = {}) {
  _sweeps.set(name, { callback, debounceMs });
  if (_sweeps.size === 1) _startObserver();
  return function unregister() {
    _sweeps.delete(name);
    if (_debounceTimers.has(name)) {
      clearTimeout(_debounceTimers.get(name));
      _debounceTimers.delete(name);
    }
    if (_sweeps.size === 0) _stopObserver();
  };
}

// Exposed for testing: reset module state between test runs.
export function _resetForTest() {
  _stopObserver();
  _sweeps.clear();
  _debounceTimers.clear();
  _lastHref = typeof location !== 'undefined' ? location.href : '';
}
