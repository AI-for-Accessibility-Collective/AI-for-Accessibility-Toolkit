// Browser-harness constants. No state, no behaviour -- pure values referenced
// by other modules. Tunables live here so a single edit changes the knob and
// every consumer sees it.

export const BH_INTERNAL = ['chrome://', 'chrome-untrusted://', 'devtools://', 'chrome-extension://', 'about:'];
export const BH_DEBUGGER_VERSION = '1.3';

// Default cap for any single chrome.debugger.sendCommand. The raw API has no
// timeout: a wedged renderer can hang the agent loop forever. Mirrors the
// python reference's _cdp_timeout (60s default). Override per call via
// bhCdp(.., {timeoutMs}). Set to Number.POSITIVE_INFINITY to disable.
export const BH_CDP_TIMEOUT_MS = 60000;

// Per-tab CDP event buffer cap. Mirrors the python daemon's `BUF = 500` --
// enough headroom for SPA route transitions without unbounded growth on
// long-running tabs.
export const BH_EVENT_LIMIT = 500;

// Auto-dismiss any native dialog the agent doesn't act on within this many
// ms. Without this a stray confirm() / beforeunload freezes the page's JS
// thread and the next bhPageInfo Runtime.evaluate hangs (until the CDP
// timeout). Mirrors browser_use/browser/watchdogs/popups_watchdog.py.
export const BH_AUTO_DISMISS_MS = 500;

// Health watchdog tuning.
// 10s was too tight on real-world pages -- legitimate XHR that takes 12-15s
// (search APIs, slow analytics-blocked endpoints) tripped it constantly.
// 30s aligns with the alarm period and only flags genuinely-wedged
// requests, not normal slow ones.
export const BH_NETWORK_STALL_MS = 30000;
// Only track request types that *should* complete in bounded time.
// EventSource (SSE), Ping (sendBeacon), Manifest, websocket-adjacent, and
// most analytics flavours are persistent or fire-and-forget by design --
// counting them as in-flight produces false-positive "stall" reports on
// every real-world page (Google Analytics, Facebook Pixel, chat sites).
// XHR / Fetch / Document / Script / Stylesheet are the categories that
// matter for "did this page finish loading the things it needed".
export const BH_NET_TRACKED_TYPES = new Set(['Document', 'XHR', 'Fetch']);
export const BH_UNRESPONSIVE_THRESHOLD = 3;
export const BH_LIVENESS_PERIOD_MIN = 0.5;   // 30s -- MV3-safe minimum
export const BH_PING_TIMEOUT_MS = 2000;

// CDP error messages that mean "session is gone, re-attach and retry".
// Timeouts are deliberately excluded so they bubble up instead.
export const BH_REATTACH_RE = /detached|disconnected|target closed|no tab|not attached|debugger is not attached|session with given id not found/i;

// AX-tree fallback role set. Mirrors browser_use clickable_elements.py
// (interactive_ax_roles). Used by _bhAxFallback when the page-side
// findTarget heuristic missed at a click coordinate.
export const _BH_AX_INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'option', 'radio',
  'checkbox', 'tab', 'textbox', 'combobox', 'slider',
  'spinbutton', 'listbox', 'search', 'searchbox',
  'row', 'cell', 'gridcell',
]);

// Numbered overlay colour wheel. Cycled through by index so adjacent boxes
// are visually distinct without any colour carrying semantic meaning.
export const _BH_HIGHLIGHT_COLORS = [
  '#e6194B', '#3cb44b', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45',
];

// CDP key-event metadata. key -> [windowsVirtualKeyCode, code, text] where
// text is the printable character that ends up in input/keypress events
// (empty string for non-printing keys). For one-character `key`s not in
// this map, bhPressKey synthesises an entry from the codepoint.
export const BH_KEYS = {
  Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab', '\t'], Backspace: [8, 'Backspace', ''],
  Escape: [27, 'Escape', ''], Delete: [46, 'Delete', ''], ' ': [32, 'Space', ' '],
  ArrowLeft: [37, 'ArrowLeft', ''], ArrowUp: [38, 'ArrowUp', ''],
  ArrowRight: [39, 'ArrowRight', ''], ArrowDown: [40, 'ArrowDown', ''],
  Home: [36, 'Home', ''], End: [35, 'End', ''],
  PageUp: [33, 'PageUp', ''], PageDown: [34, 'PageDown', ''],
};

// keyCode-only table used by bhDispatchKey (the selector-based KeyboardEvent
// dispatcher). Smaller than BH_KEYS because it only needs the legacy keyCode
// field for synthesised KeyboardEvent payloads.
export const BH_KC = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
