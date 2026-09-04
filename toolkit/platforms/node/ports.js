// @ts-nocheck
// FLAG(review): 12 errors under toolkit/tsconfig.json's strict check at the
// time this count was taken. Type declarations still emit from this file;
// remove these lines and fix the errors to opt it into the check.
// Node platform adapters — Clock, Scheduler, Consent. Mirrors
// ../chrome/ports.js's chromeClock/chromeScheduler/chromeConsent, but built
// on plain Node globals instead of `chrome.*`, per toolkit/ports/index.js's
// port contracts.

/** Clock backed by the real wall clock, the only source of "now" for a node
 *  host (a deterministic test supplies its own instead). */
export function nodeClock() {
  return { now: () => Date.now() };
}

/** Scheduler over setInterval (periodic) + setTimeout (debounce). Timers are
 *  unref()'d so a host that never calls process.exit() itself isn't kept
 *  alive by the toolkit's own slow-lane scheduling, the same "don't block
 *  process exit" contract a short-lived script/demo needs. Calling `every`/
 *  `debounce` again with the same id re-registers, not duplicates (matches
 *  chromeScheduler's semantics). */
export function nodeScheduler() {
  const timers = new Map(); // id -> Timeout/Interval handle

  return {
    every(id, periodMinutes, handler) {
      const prev = timers.get(id);
      if (prev) clearInterval(prev);
      const handle = setInterval(handler, Math.max(1, periodMinutes) * 60_000);
      handle.unref?.();
      timers.set(id, handle);
    },
    debounce(id, delayMs, handler) {
      const prev = timers.get(id);
      if (prev) clearTimeout(prev);
      const handle = setTimeout(() => { timers.delete(id); handler(); }, delayMs);
      handle.unref?.();
      timers.set(id, handle);
    },
  };
}

/** Consent surface that prints pending-count changes to the console, the
 *  node equivalent of chromeConsent's toolbar badge, for a host with no UI
 *  of its own (a CLI, a service, this demo). Pass `{ silent: true }` for a
 *  fully quiet host (or just use the barrel's own `noopConsent`). */
export function consoleConsent({ silent = false } = {}) {
  return {
    notifyPending(count) {
      if (silent) return;
      console.log(count > 0
        ? `[toolkit] ${count} item(s) awaiting your decision.`
        : '[toolkit] no pending items.');
    },
  };
}
