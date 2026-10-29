// One shared JSON document that several requests (and several service
// instances) may change at once: admin/tokens.json, admin/accounts.json,
// adapters/catalog.json. Every mutation is load → change → save, and two
// layers keep a concurrent change from being lost:
//
//   - In one process, mutations of the same document queue behind each other.
//     The per-uid lock in app.js does not cover a shared document (a change
//     for one uid can interleave with a change for another).
//   - Across processes (two service instances on one bucket or directory), the
//     save is a conditional write: store.writeJSONIf refuses when the document
//     moved since store.readDoc, and the mutation reloads and retries. A read
//     that catches the document mid-change reports the same conflict. Five
//     attempts is far more than these documents ever contend for.
//
// A store without the conditional pair falls back to the plain load and save,
// which is the single-process guarantee only.

const MAX_ATTEMPTS = 5;
const queues = new WeakMap(); // store -> Map<key, Promise>

function withQueue(store, key, fn) {
  if (!queues.has(store)) queues.set(store, new Map());
  const perStore = queues.get(store);
  const run = (perStore.get(key) || Promise.resolve()).then(fn, fn);
  perStore.set(key, run.catch(() => {}));
  return run;
}

/**
 * @param {object} store  the service store (readJSON/writeJSON, optionally readDoc/writeJSONIf)
 * @param {string} key    document key, e.g. 'admin/accounts.json'
 * @param {(value: any) => any} normalize  turns a stored value (or null) into a usable document
 */
export function sharedDoc(store, key, normalize) {
  const conditional = typeof store.readDoc === 'function' && typeof store.writeJSONIf === 'function';
  return {
    /** The current document, normalized. Not part of any mutation. */
    async read() {
      return normalize(await store.readJSON(key));
    },
    /**
     * Run `change(doc)` against the current document and save it. `change`
     * returns `{ save, result }`; `save` false skips the write, `result` is
     * handed back. `change` may run more than once (on a conflict), so it must
     * not have side effects outside the document.
     */
    mutate(change) {
      return withQueue(store, key, async () => {
        if (!conditional) {
          const doc = normalize(await store.readJSON(key));
          const { save, result } = change(doc);
          if (save) await store.writeJSON(key, doc);
          return result;
        }
        for (let attempt = 1; ; attempt++) {
          try {
            const current = await store.readDoc(key);
            const doc = normalize(current.value);
            const { save, result } = change(doc);
            if (save) await store.writeJSONIf(key, doc, current.version);
            return result;
          } catch (e) {
            if (e?.code !== 'CONFLICT' || attempt >= MAX_ATTEMPTS) throw e;
          }
        }
      });
    },
  };
}
