/** KVStore over `chrome.storage.<area>`. Defaulting is the datastore's job;
 *  this returns the raw stored value or `undefined`. */
export function chromeKV(): {
    get(areaName: any, key: any): Promise<any>;
    set(areaName: any, key: any, value: any): Promise<any>;
    getAll(areaName: any): Promise<any>;
};
/** Clock backed by the host wall clock. */
export function chromeClock(): {
    now: () => number;
};
/** Scheduler over `chrome.alarms` (periodic) + `setTimeout` (debounce).
 *  A single onAlarm listener dispatches to per-id handlers. Idempotent for
 *  the once-per-service-worker construction the extension does. */
export function chromeScheduler(): {
    every(id: any, periodMinutes: any, handler: any): void;
    debounce(id: any, delayMs: any, handler: any): void;
};
/** Consent surface — today, the toolbar badge that counts pending proposals.
 *  Failures (no `chrome.action` in some contexts) are swallowed. */
export function chromeConsent(): {
    notifyPending(count: any): Promise<void>;
};
/** Demo hook — bridges the core to the extension's live-diagram globals
 *  (`globalThis.AA_DEMO_MODE`, `globalThis.aaDemoTrace`), read live each call
 *  so a runtime demo-mode toggle is reflected immediately. */
export function chromeDemo(): {
    isOn: () => boolean;
    trace: (diagram: any, region: any, label: any) => void;
};
//# sourceMappingURL=ports.d.ts.map