// Chrome platform adapters — concrete implementations of the Toolkit ports
// backed by `chrome.*` and the service-worker globals. These are the ONLY
// place `chrome.*` appears in the Toolkit; the core stays platform-agnostic.
//
// Each factory returns a fresh port object. They work unchanged under the
// test's chrome mock (test/librarian-test.js) because they touch only the
// same `chrome.storage` / `chrome.alarms` / `chrome.action` / globals the
// mock provides.

/** KVStore over `chrome.storage.<area>`. Defaulting is the datastore's job;
 *  this returns the raw stored value or `undefined`. */
export function chromeKV() {
  const area = (name) => chrome.storage[name];
  return {
    get(areaName, key) {
      return new Promise((resolve) => {
        area(areaName).get(key, (data) => resolve(data ? data[key] : undefined));
      });
    },
    set(areaName, key, value) {
      return new Promise((resolve, reject) => {
        area(areaName).set({ [key]: value }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      });
    },
    getAll(areaName) {
      return new Promise((resolve) => {
        area(areaName).get(null, (data) => resolve(data || {}));
      });
    },
  };
}

/** Clock backed by the host wall clock. */
export function chromeClock() {
  return { now: () => Date.now() };
}

/** Scheduler over `chrome.alarms` (periodic) + `setTimeout` (debounce).
 *  A single onAlarm listener dispatches to per-id handlers. Idempotent for
 *  the once-per-service-worker construction the extension does. */
export function chromeScheduler() {
  const handlers = new Map(); // alarm name -> handler
  const timers = new Map();   // debounce id -> timeout handle
  let listenerInstalled = false;

  function ensureListener() {
    if (listenerInstalled) return;
    if (!(chrome.alarms && chrome.alarms.onAlarm)) return;
    chrome.alarms.onAlarm.addListener((alarm) => {
      const fn = handlers.get(alarm.name);
      if (fn) fn();
    });
    listenerInstalled = true;
  }

  return {
    every(id, periodMinutes, handler) {
      handlers.set(id, handler);
      ensureListener();
      if (chrome.alarms) chrome.alarms.create(id, { periodInMinutes: periodMinutes });
    },
    debounce(id, delayMs, handler) {
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      timers.set(id, setTimeout(() => { timers.delete(id); handler(); }, delayMs));
    },
  };
}

/** Consent surface — today, the toolbar badge that counts pending proposals.
 *  Failures (no `chrome.action` in some contexts) are swallowed. */
export function chromeConsent() {
  return {
    async notifyPending(count) {
      try {
        await chrome.action.setBadgeText({ text: count ? String(count) : '' });
        if (count) await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
      } catch { /* no action API in some contexts */ }
    },
  };
}

/** Demo hook — bridges the core to the extension's live-diagram globals
 *  (`globalThis.AA_DEMO_MODE`, `globalThis.aaDemoTrace`), read live each call
 *  so a runtime demo-mode toggle is reflected immediately. */
export function chromeDemo() {
  return {
    isOn: () => !!globalThis.AA_DEMO_MODE,
    trace: (diagram, region, label) => {
      try { if (globalThis.aaDemoTrace) globalThis.aaDemoTrace(diagram, region, label); }
      catch { /* tracing must never break the engine */ }
    },
  };
}
