// Debugger session lifecycle + the reattach-on-detached CDP wrapper, plus
// the chrome.debugger.onEvent / onDetach listeners that feed watchdogs and
// the per-tab event buffer.
//
// Listener registration runs at module-evaluation time (top-level side
// effects), so this file MUST be imported transitively by the entry index.
// The `_bhInstalled` guards prevent double-registration when the SW
// evicts and resurrects.

import { BH_DEBUGGER_VERSION, BH_REATTACH_RE, BH_EVENT_LIMIT } from './constants.js';
import {
  BH_ATTACHED,
  BH_EVENTS,
  BH_PENDING_DIALOGS,
  BH_DIALOG_AUTO_TIMERS,
  BH_WATCHDOGS,
  bhHealthClear,
} from './state.js';
import { _bhSendRaw } from './cdp.js';

// --- attach lifecycle --------------------------------------------------
export async function bhAttach(tabId) {
  if (BH_ATTACHED.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, BH_DEBUGGER_VERSION);
  BH_ATTACHED.add(tabId);
  // Use the no-retry sender here. The retry path in bhCdp would call back
  // into bhAttach, and we're already mid-attach -- recursion risk if the
  // domain.enable fails for an unrelated reason. Accessibility domain
  // powers the AX-tree fallback in _bhSnapToInteractive (covers custom
  // Web Components and AX-only interactivity signals).
  for (const d of ['Page', 'DOM', 'Runtime', 'Network', 'Accessibility']) {
    try { await _bhSendRaw(tabId, `${d}.enable`); } catch {}
  }
}

export async function bhDetach(tabId) {
  if (!BH_ATTACHED.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch {}
  BH_ATTACHED.delete(tabId);
}

// Self-heals from a debugger detach (user clicked "Cancel" on the warning bar,
// the page navigated cross-process, the daemon-equivalent dropped the session)
// by re-attaching once and retrying. Mirrors browser-harness-orig's
// daemon.handle()'s "stale session, re-attaching" branch. Timeouts are
// deliberately excluded from BH_REATTACH_RE so they bubble up instead.
export async function bhCdp(tabId, method, params = {}, opts = {}) {
  const tm = opts.timeoutMs;
  try {
    return await _bhSendRaw(tabId, method, params, tm);
  } catch (e) {
    if (!BH_REATTACH_RE.test(e.message)) throw e;
    BH_ATTACHED.delete(tabId);
    try {
      await bhAttach(tabId);
    } catch {
      throw e; // re-attach failed -- surface the original error
    }
    return await _bhSendRaw(tabId, method, params, tm);
  }
}

// User can dismiss the yellow "is being debugged" bar at any time -- mirror
// that into our local set so the next call re-attaches instead of failing.
if (!chrome.debugger.onDetach._bhInstalled) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) {
      BH_ATTACHED.delete(source.tabId);
      BH_EVENTS.delete(source.tabId);
      BH_PENDING_DIALOGS.delete(source.tabId);
      const t = BH_DIALOG_AUTO_TIMERS.get(source.tabId);
      if (t) clearTimeout(t);
      BH_DIALOG_AUTO_TIMERS.delete(source.tabId);
      bhHealthClear(source.tabId);
    }
  });
  chrome.debugger.onDetach._bhInstalled = true;
}

// CDP event tap. Mirrors browser-harness-orig's daemon `tap()` -- buffers
// events for later drain (wait_for_network_idle, custom listeners) and
// captures any pending JS dialog so pageInfo can surface it before the
// next CDP call hangs on the frozen JS thread. Watchdogs run first; the
// circuit breaker inside _BhWatchdog._dispatch skips dispatch when the
// tab is no longer attached so a stale event can't re-drive handlers
// against a dead session.
if (!chrome.debugger.onEvent._bhInstalled) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source && source.tabId;
    if (tabId == null) return;
    for (const w of BH_WATCHDOGS) w._dispatch(tabId, method, params);
    let buf = BH_EVENTS.get(tabId);
    if (!buf) { buf = []; BH_EVENTS.set(tabId, buf); }
    buf.push({ method, params, t: Date.now() });
    if (buf.length > BH_EVENT_LIMIT) buf.shift();
  });
  chrome.debugger.onEvent._bhInstalled = true;
}
