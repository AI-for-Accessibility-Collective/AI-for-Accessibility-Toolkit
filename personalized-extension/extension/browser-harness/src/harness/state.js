// Mutable harness state. Module-scoped so other modules see consistent reads;
// the index module re-exports getter wrappers as part of the public API
// (healthSnapshot, healthClear, setAgentBusy) but leaves the raw maps
// internal.

// Set of tabIds + iframe targetIds that are currently chrome.debugger-attached.
// Authoritative source of truth: chrome.debugger.onDetach updates this when
// the user clicks "Cancel" on the warning bar, so the next CDP call re-attaches.
export const BH_ATTACHED = new Set();

// Per-tab CDP event buffer. Filled by lifecycle's chrome.debugger.onEvent
// listener; drained by bhDrainEvents() / surfaced by bhPageInfo via the
// pending-dialog path.
export const BH_EVENTS = new Map();          // tabId -> [{method, params, t}, ...]

// Pending native dialog state. Set by the popups watchdog on
// Page.javascriptDialogOpening; cleared on Page.javascriptDialogClosed or
// when bhHandleDialog runs.
export const BH_PENDING_DIALOGS = new Map(); // tabId -> CDP Page.javascriptDialogOpening params

// setTimeout handles for the auto-dismiss path. Cleared on dialogClosed +
// when bhSetAutoDialog(false) runs.
export const BH_DIALOG_AUTO_TIMERS = new Map(); // tabId -> setTimeout handle

// Network in-flight + per-tab consecutive-ping-failure tracker. The crash
// watchdog populates BH_NET_INFLIGHT; liveness sweep reads it.
export const BH_NET_INFLIGHT = new Map();    // requestId -> {tabId, t}
export const BH_UNRESP_COUNT = new Map();    // tabId -> consecutive ping failures

// Per-tab snapshot of the last enumerate's items[]. Used by stale-index
// recovery: when click_index/type_index/etc. fail with stale_index, we look
// up the original target's identity (tag/role/text/bbox), re-enumerate,
// and find the closest matching element in the new state. Cleared when a
// new enumerate runs.
export const _BH_LAST_ITEMS = new Map(); // tabId -> items array

// Watchdog registry. Lives in state.js (not watchdog.js) to break a
// circular import: lifecycle.js's onEvent listener needs to iterate this
// array but watchdog.js depends on dialog.js which depends on lifecycle.js.
// Pushed into by watchdog.js at module-eval time; iterated lazily by the
// onEvent listener at fire time.
export const BH_WATCHDOGS = [];

// Health watchdog flags. Per-tab flags accumulate between agent steps;
// the agent reads them via healthSnapshot() at the end of each step and
// reacts. Mirrors the union of browser_use's crash_watchdog (crashed,
// unresponsive) and network-stall portion of dom_watchdog.
export const BH_HEALTH = {
  crashed: new Set(),       // tabId set
  unresponsive: new Set(),  // tabId set
  networkStall: new Map(),  // tabId -> oldest in-flight age (ms)
};

// Toggle for the entire health subsystem (alarm handler + ping). Set false
// to neuter the wiring without removing the registrations.
export let BH_HEALTH_ENABLED = true;
export function bhSetHealthEnabled(v) { BH_HEALTH_ENABLED = !!v; }
export function bhHealthIsEnabled() { return BH_HEALTH_ENABLED; }

// Toggle for auto-dismiss of native dialogs. Defensive escape hatch for
// sites where blocking on a prompt is the intended flow.
export let BH_AUTO_DIALOG_ENABLED = true;
export function bhSetAutoDialog(enabled) {
  BH_AUTO_DIALOG_ENABLED = !!enabled;
  if (!enabled) {
    for (const t of BH_DIALOG_AUTO_TIMERS.values()) clearTimeout(t);
    BH_DIALOG_AUTO_TIMERS.clear();
  }
}
export function bhAutoDialogIsEnabled() { return BH_AUTO_DIALOG_ENABLED; }

// Toggled by the agent module so liveness pings don't contend for the per-tab
// CDP queue while a step is mid-flight (the agent's own CDP work is the best
// possible liveness signal, so skipping is safe).
export let BH_AGENT_BUSY = false;
export function bhSetAgentBusy(busy) { BH_AGENT_BUSY = !!busy; }
export function bhAgentIsBusy() { return BH_AGENT_BUSY; }

// --- public read-side health helpers -----------------------------------
export function bhHealthSnapshot(tabId) {
  return {
    crashed: BH_HEALTH.crashed.has(tabId),
    unresponsive: BH_HEALTH.unresponsive.has(tabId),
    networkStall: BH_HEALTH.networkStall.get(tabId) || 0,
  };
}

export function bhHealthClear(tabId) {
  BH_HEALTH.crashed.delete(tabId);
  BH_HEALTH.unresponsive.delete(tabId);
  BH_HEALTH.networkStall.delete(tabId);
  BH_UNRESP_COUNT.delete(tabId);
  for (const [rid, e] of BH_NET_INFLIGHT) {
    if (e.tabId === tabId) BH_NET_INFLIGHT.delete(rid);
  }
}

// Drain the per-tab CDP event buffer. Returns the events accumulated since
// the last drain; resets the buffer to empty. Used by bhWaitForNetworkIdle
// and any other quiescence detector.
export function bhDrainEvents(tabId) {
  const buf = BH_EVENTS.get(tabId) || [];
  BH_EVENTS.set(tabId, []);
  return buf;
}

// Read (without clearing) the pending native dialog for a tab. Returns the
// CDP Page.javascriptDialogOpening params or null. Surfacing via the
// pending-dialog branch in bhPageInfo lets the agent see the dialog before
// the next Runtime.evaluate hangs on the frozen JS thread.
export function bhPendingDialog(tabId) {
  return BH_PENDING_DIALOGS.get(tabId) || null;
}
