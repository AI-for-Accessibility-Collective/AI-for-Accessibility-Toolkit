// Platform Ports — the interfaces the Toolkit core depends on. A host
// (Chrome extension, iOS app, XR runtime, a test) supplies one concrete
// implementation of each; the core never touches `chrome.*`, `Date.now()`,
// the DOM, or any host API directly.
//
// Phase 0 scope: only the ports the *existing* engine actually needs are
// defined and consumed — KVStore, Clock, Scheduler, Consent, plus a small
// `demo` hook for the extension's own diagram instrumentation. The LLM is
// still injected post-construction via `librarian.setGeminiCaller(fn)` (the
// pre-existing seam), so it is NOT a constructor port yet. SecretStore,
// Sensors, and Surface are named in the refactor plan but are host-owned /
// later-phase and deliberately not wired here.
//
// This module is documentation + tiny no-op defaults. It has no runtime
// dependency on any platform.

/**
 * @typedef {Object} KVStore
 * Async key/value access over named storage areas. Mirrors the subset of
 * `chrome.storage.<area>` the datastore uses. `area` is a logical string the
 * host maps to a real backend (e.g. 'local' | 'sync').
 * @property {(area: string, key: string) => Promise<any>} get
 *   Resolve the raw stored value, or `undefined` when absent. (Defaulting is
 *   the datastore's job, not the port's.)
 * @property {(area: string, key: string, value: any) => Promise<void>} set
 *   Persist a value. MUST reject if the write fails.
 * @property {(area: string) => Promise<Record<string, any>>} getAll
 *   Every entry currently in the area, as a `{ key: value }` map. Equivalent
 *   to `chrome.storage.<area>.get(null)`. Used to enumerate the dynamic
 *   memory-shard keys the catalog can't name ahead of time.
 */

/**
 * @typedef {Object} Clock
 * The only source of "now" the core may read. Injecting it removes the last
 * hidden global from the engine and makes the slow-lane lifecycle testable.
 * @property {() => number} now  Epoch milliseconds, like `Date.now()`.
 */

/**
 * @typedef {Object} Scheduler
 * Deferred and recurring work. The host decides the real mechanism
 * (`chrome.alarms`, `BGTaskScheduler`, a frame loop, a test stub).
 * @property {(id: string, periodMinutes: number, handler: () => void) => void} every
 *   Run `handler` roughly every `periodMinutes`. Calling again with the same
 *   `id` re-registers, not duplicates.
 * @property {(id: string, delayMs: number, handler: () => void) => void} debounce
 *   Run `handler` once, `delayMs` after the most recent call for this `id`
 *   (later calls reset the timer). The fast path for "extract soon after a
 *   burst of observations".
 */

/**
 * @typedef {Object} Consent
 * The accessible channel for surfacing pending proposals to the user. In
 * Phase 0 the only need is the unread-proposal indicator (today: the toolbar
 * badge). The richer `present(proposal|grant)` / `capture(response)` surface
 * from the plan is Phase 3 and not defined yet — keeping this honest about
 * what actually exists.
 * @property {(count: number) => (void | Promise<void>)} notifyPending
 *   Reflect that `count` proposals await the user's decision (0 clears it).
 *   MUST NOT throw into the caller; failures are swallowed by the adapter.
 */

/**
 * @typedef {Object} DemoHook
 * The extension's live-diagram instrumentation, lifted out of the core so the
 * engine carries no `globalThis.AA_DEMO_MODE` / `globalThis.aaDemoTrace`
 * reads. Non-extension hosts pass the no-op default below.
 * @property {() => boolean} isOn   Live value of demo mode (read per call).
 * @property {(diagram: string, region: string, label: string) => void} trace
 *   Emit a diagram trace; no-op when no demo surface is attached.
 */

/** A DemoHook that does nothing — the default for every non-demo host. */
export const noopDemo = {
  isOn: () => false,
  trace: () => {},
};

/** A Consent port that silently ignores the count — for headless/test hosts. */
export const noopConsent = {
  notifyPending: () => {},
};

/** A Scheduler that never fires — for one-shot/test hosts that drive the slow
 *  lane manually. `every`/`debounce` are accepted and dropped. */
export const noopScheduler = {
  every: () => {},
  debounce: () => {},
};

/** A Clock backed by the host's real wall clock. Safe default everywhere
 *  `Date` exists; a deterministic test supplies its own instead. */
export const systemClock = {
  now: () => Date.now(),
};
