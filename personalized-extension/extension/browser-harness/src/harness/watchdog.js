// Event-driven watchdog framework + the two built-in watchdogs (popups,
// crash). Mirrors the pattern in browser_use/browser/watchdog_base.py:
// each watchdog registers handlers keyed by CDP method, _dispatch runs
// them under try/catch, and the circuit breaker skips dispatch entirely
// when the tab is no longer attached -- preventing a stale event from
// re-driving handlers against a dead session.
//
// Lifecycle.js's chrome.debugger.onEvent listener walks BH_WATCHDOGS and
// calls _dispatch on each. New watchdogs can register at any time after
// SW boot via BH_WATCHDOGS.push(new _BhWatchdog(...)).

import { BH_AUTO_DISMISS_MS, BH_NET_TRACKED_TYPES, BH_EVENT_LIMIT } from './constants.js';
import {
  BH_ATTACHED,
  BH_EVENTS,
  BH_PENDING_DIALOGS,
  BH_DIALOG_AUTO_TIMERS,
  BH_NET_INFLIGHT,
  BH_HEALTH,
  BH_WATCHDOGS,
  bhAutoDialogIsEnabled,
  bhHealthIsEnabled,
} from './state.js';
import { bhHandleDialog } from './dialog.js';

export class _BhWatchdog {
  constructor(name) {
    this.name = name;
    this.handlers = new Map();
  }
  on(method, handler) {
    this.handlers.set(method, handler);
    return this;
  }
  _dispatch(tabId, method, params) {
    if (!BH_ATTACHED.has(tabId)) return; // circuit breaker
    const h = this.handlers.get(method);
    if (!h) return;
    try {
      const r = h(tabId, params);
      if (r && typeof r.catch === 'function') {
        r.catch((e) => console.warn(
          `[BrowserHarness] watchdog ${this.name}.${method} failed:`,
          e && e.message,
        ));
      }
    } catch (e) {
      console.warn(
        `[BrowserHarness] watchdog ${this.name}.${method} threw:`,
        e && e.message,
      );
    }
  }
}

const _bhPopupsWatchdog = new _BhWatchdog('popups')
  .on('Page.javascriptDialogOpening', (tabId, params) => {
    BH_PENDING_DIALOGS.set(tabId, params);
    if (bhAutoDialogIsEnabled() && !BH_DIALOG_AUTO_TIMERS.has(tabId)) {
      const handle = setTimeout(
        () => _bhAutoDismissDialog(tabId, params),
        BH_AUTO_DISMISS_MS,
      );
      BH_DIALOG_AUTO_TIMERS.set(tabId, handle);
    }
  })
  .on('Page.javascriptDialogClosed', (tabId) => {
    BH_PENDING_DIALOGS.delete(tabId);
    const t = BH_DIALOG_AUTO_TIMERS.get(tabId);
    if (t) clearTimeout(t);
    BH_DIALOG_AUTO_TIMERS.delete(tabId);
  });

const _bhCrashWatchdog = new _BhWatchdog('crash')
  .on('Target.targetCrashed', (tabId) => {
    if (bhHealthIsEnabled()) BH_HEALTH.crashed.add(tabId);
  })
  .on('Inspector.targetCrashed', (tabId) => {
    if (bhHealthIsEnabled()) BH_HEALTH.crashed.add(tabId);
  })
  .on('Network.requestWillBeSent', (tabId, params) => {
    const rid = params && params.requestId;
    const type = params && params.type;
    if (rid && BH_NET_TRACKED_TYPES.has(type)) {
      BH_NET_INFLIGHT.set(rid, { tabId, t: Date.now() });
    }
  })
  // Streaming responses (Server-Sent Events, chunked event-stream) never
  // fire loadingFinished -- the connection stays open by design. Drop
  // them as soon as the response headers reveal the streaming mime type
  // so they don't accumulate as false-positive stalls.
  .on('Network.responseReceived', (_tabId, params) => {
    const rid = params && params.requestId;
    if (!rid || !BH_NET_INFLIGHT.has(rid)) return;
    const mime = (params && params.response && params.response.mimeType) || '';
    if (mime === 'text/event-stream' || mime === 'application/grpc') {
      BH_NET_INFLIGHT.delete(rid);
    }
  })
  .on('Network.loadingFinished', (_tabId, params) => {
    const rid = params && params.requestId;
    if (rid) BH_NET_INFLIGHT.delete(rid);
  })
  .on('Network.loadingFailed', (_tabId, params) => {
    const rid = params && params.requestId;
    if (rid) BH_NET_INFLIGHT.delete(rid);
  })
  // Main-frame navigation invalidates any still-in-flight entries from the
  // previous page -- those requests were torn down with the renderer and
  // won't fire loadingFinished/Failed cleanly. Without this, every fresh
  // navigation leaks a few orphan entries that hit the stall threshold
  // forever. Sub-frame navigations are ignored: they don't invalidate the
  // parent frame's pending work.
  .on('Page.frameNavigated', (tabId, params) => {
    const frame = params && params.frame;
    if (!frame || frame.parentId) return;
    for (const [rid, e] of BH_NET_INFLIGHT) {
      if (e.tabId === tabId) BH_NET_INFLIGHT.delete(rid);
    }
  });

BH_WATCHDOGS.push(_bhPopupsWatchdog, _bhCrashWatchdog);

// Auto-dismiss policy mirrors browser_use's popups_watchdog: alert/confirm/
// beforeunload are accepted (the agent's task usually wants the page to
// keep going); prompt() is dismissed because there's no safe value to
// supply automatically. The agent can still see what the dialog said via
// the synthetic `bh.autoDialog` event recorded into the buffer.
async function _bhAutoDismissDialog(tabId, params) {
  BH_DIALOG_AUTO_TIMERS.delete(tabId);
  if (!BH_PENDING_DIALOGS.has(tabId)) return; // agent already handled it
  const type = (params && params.type) || 'alert';
  const accept = (type !== 'prompt');
  try {
    await bhHandleDialog(tabId, accept, null);
  } catch {
    // The dialog may have closed itself between schedule and fire (page
    // navigated, tab closed). Either way, the listener cleared state.
    return;
  }
  // Surface what we just did into the event buffer so the next bhPageInfo /
  // drain reveals it to the agent. Mirrors python's structured event log.
  const buf = BH_EVENTS.get(tabId);
  if (buf) {
    buf.push({
      method: 'bh.autoDialog',
      params: {
        type,
        message: (params && params.message) || '',
        defaultPrompt: (params && params.defaultPrompt) || '',
        accept,
      },
      t: Date.now(),
    });
    if (buf.length > BH_EVENT_LIMIT) buf.shift();
  }
}
