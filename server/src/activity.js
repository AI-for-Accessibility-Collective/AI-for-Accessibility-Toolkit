// The account's recent MCP calls, kept in the store so the developer
// console's "Recent calls" survive a restart: `users/<uid>/activity.json`,
// `{entries: [{at, appId, providerId, tool?, adapter?, method, client, outcome, ms}]}`,
// newest last, at most LIMIT entries.
//
// Calls arrive faster than an object store wants to be written (GCS allows
// about one write per second per object), so entries are buffered per uid and
// written at most every FLUSH_MS, inside the uid's queue, and on shutdown
// (`flush()`). An entry only records which tool ran and how it ended, never
// its arguments or results.
//
// Deleting a user: `forget(uid)` drops the buffer. It runs inside the same
// per-uid queue as the wipe, and a flush takes its entries only once it holds
// that queue, so nothing is written back after the partition is gone.

export const ACTIVITY_DOC = (uid) => `users/${uid}/activity.json`;
const LIMIT = 200;
const FLUSH_MS = 3000;

/**
 * @param {Object} options
 * @param {{readJSON: Function, writeJSON: Function}} options.store
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} options.withUserLock
 * @param {{warn: Function, error: Function}} options.log
 * @param {number} [options.flushMs]
 * @param {number} [options.limit]
 */
export function createActivityLog({ store, withUserLock, log, flushMs = FLUSH_MS, limit = LIMIT }) {
  const pending = new Map(); // uid -> entries not yet written
  const timers = new Map();  // uid -> flush timer

  function record(uid, entry) {
    const list = pending.get(uid) || [];
    list.push({ at: new Date().toISOString(), ...entry });
    if (list.length > limit) list.splice(0, list.length - limit);
    pending.set(uid, list);
    if (!timers.has(uid)) {
      const t = setTimeout(() => { timers.delete(uid); flushUser(uid).catch(() => {}); }, flushMs);
      t.unref?.();
      timers.set(uid, t);
    }
  }

  async function read(uid) {
    const doc = await store.readJSON(ACTIVITY_DOC(uid));
    return Array.isArray(doc?.entries) ? doc.entries : [];
  }

  function flushUser(uid) {
    return withUserLock(uid, async () => {
      const entries = pending.get(uid);
      if (!entries?.length) return;
      pending.delete(uid);
      try {
        const merged = [...(await read(uid)), ...entries].slice(-limit);
        await store.writeJSON(ACTIVITY_DOC(uid), { entries: merged });
      } catch (e) {
        // Put them back for the next try, still capped.
        pending.set(uid, [...entries, ...(pending.get(uid) || [])].slice(-limit));
        log.warn('activity.flush.failed', { uid, error: e });
        throw e;
      }
    });
  }

  /** Write every buffered entry now (shutdown). */
  async function flush() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await Promise.allSettled([...pending.keys()].map(flushUser));
  }

  /** Stored and buffered entries for one uid, newest last. */
  async function recent(uid) {
    return [...(await read(uid)), ...(pending.get(uid) || [])].slice(-limit);
  }

  function forget(uid) {
    pending.delete(uid);
    clearTimeout(timers.get(uid));
    timers.delete(uid);
  }

  return { record, flush, recent, forget };
}
