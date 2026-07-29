// Platform Ports — the contracts a host must provide to run the toolkit core.
// Pure documentation module (JSDoc typedefs); nothing to import at runtime.
//
// Design rule: the core never touches chrome.*, the DOM, or Date.now()
// directly. Every platform capability enters through one of these ports, so
// a new host (XR, iOS, mobile, tests) only implements this file's contracts.

/**
 * One keyed storage area (get/set a single logical key).
 * @typedef {Object} StorageArea
 * @property {(key: string, def: any) => Promise<any>} get - value or `def` when unset
 * @property {(key: string, value: any) => Promise<void>} set
 */

/**
 * Keyed storage areas. `sync` roams across the user's devices (small,
 * high-value records: ability profile, suppressions); `local` stays on
 * device (bulky stores: episodic log, memory shards).
 * @typedef {Object} Areas
 * @property {StorageArea} local
 * @property {StorageArea} sync
 */

/**
 * Bulk key/value access to the *local* area — used to enumerate dynamic
 * memory-shard keys (prefix `aa.mine.memory.`) that the catalog can't list.
 * @typedef {Object} KV
 * @property {() => Promise<Record<string, any>>} getAll
 * @property {(items: Record<string, any>) => Promise<void>} set
 */

/**
 * Periodic job scheduling. The host guarantees `fn` keeps firing even if the
 * process sleeps (Chrome: alarms; iOS: BGTaskScheduler; XR: frame loop).
 * @typedef {Object} Scheduler
 * @property {(id: string, periodInMinutes: number, fn: () => void) => void} every
 */

/**
 * Injectable time source — the core never calls Date.now() directly, which
 * keeps decay/cooldown/promotion logic deterministic under test.
 * @typedef {Object} Clock
 * @property {() => number} now
 */

/**
 * Surface for "you have N pending proposals" (Chrome: action badge).
 * @typedef {Object} Notifier
 * @property {(count: number) => Promise<void>} pending
 */

/**
 * Read-only data shipped with the host: the tools registry, taxonomy, and
 * built-in skills (SKILL.md playbooks parsed to Skill objects).
 * @typedef {Object} GlobalTier
 * @property {() => any} tools
 * @property {() => any} taxonomy
 * @property {() => any[]} [skills]
 */

/**
 * Demo-mode hooks (optional). `active()` loosens consent gates for scripted
 * demos; `trace()` emits presentation beats. Both no-op in normal use.
 * @typedef {Object} Demo
 * @property {() => boolean} active
 * @property {(diagram: string, region: string, label: string) => void} trace
 */

export {};
