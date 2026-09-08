/** Clock backed by the real wall clock, the only source of "now" for a node
 *  host (a deterministic test supplies its own instead). */
export function nodeClock(): {
    now: () => number;
};
/** Scheduler over setInterval (periodic) + setTimeout (debounce). Timers are
 *  unref()'d so a host that never calls process.exit() itself isn't kept
 *  alive by the toolkit's own slow-lane scheduling, the same "don't block
 *  process exit" contract a short-lived script/demo needs. Calling `every`/
 *  `debounce` again with the same id re-registers, not duplicates (matches
 *  chromeScheduler's semantics). */
export function nodeScheduler(): {
    every(id: any, periodMinutes: any, handler: any): void;
    debounce(id: any, delayMs: any, handler: any): void;
};
/** Consent surface that prints pending-count changes to the console, the
 *  node equivalent of chromeConsent's toolbar badge, for a host with no UI
 *  of its own (a CLI, a service, this demo). Pass `{ silent: true }` for a
 *  fully quiet host (or just use the barrel's own `noopConsent`). */
export function consoleConsent({ silent }?: {
    silent?: boolean | undefined;
}): {
    notifyPending(count: any): void;
};
//# sourceMappingURL=ports.d.ts.map