// Per-uid Toolkit instances. This is the one file that actually calls
// `createToolkit()` — everything else in server/ reaches the toolkit only
// through this seam (or, for meta.js's static introspection, the barrel
// directly). Follows toolkit/platforms/node/host.js's own pattern (its
// `bootToolkit`: fileKV + nodeClock + a minimal toolsRegistry +
// datastore.runMigrations() before first use) adapted to:
//   - a KVStore over `server/src/store.js`'s doc store instead of raw
//     per-area files, so the same code path serves both fileStore and
//     gcsStore;
//   - `noopScheduler`/`noopConsent` instead of nodeScheduler/consoleConsent —
//     createToolkit's own doc comment calls noopScheduler the right default
//     for a host that "drive[s] the slow lane yourself", which is exactly
//     what a request/response server does via the extractNow/reflectNow
//     routes. Real interval/debounce timers per uid would also fight the LRU
//     cache below (an evicted instance's timers would leak); a stateless
//     instance has none to leak.
//   - an LRU cap so a long-running server with many uids doesn't hold every
//     toolkit instance (and its in-memory closures) forever — eviction only
//     drops the in-memory object, never data (the KVStore always re-reads
//     from the durable store on the next access).

import { createToolkit, noopScheduler, noopConsent } from '../../toolkit/index.js';
import { nodeClock } from '../../toolkit/platforms/node/ports.js';
import { asAATools } from '../../toolkit/registry/tools.js';

const DEFAULT_CAP = 50;

// The real canonical tools registry, relocated into the toolkit
// (toolkit/registry/tools.js) so the server shares the exact settings
// vocabulary and tool catalog the extension bakes into AA_TOOLS — this is
// what powers interpretNeedsPrompt / extract / buildSkill prompts.
const TOOLS_REGISTRY = asAATools();

/** A KVStore (get/set/getAll per area — see toolkit/ports/index.js) backed by
 *  one store-document per `users/<uid>/<area>.json`. Same read-whole/
 *  mutate/write-whole algorithm as toolkit/platforms/node/kv.js's fileKV,
 *  retargeted at the store's doc interface so it works over fileStore OR
 *  gcsStore unchanged. */
function kvStoreFor(store, uid) {
  async function readArea(area) {
    return (await store.readJSON(`users/${uid}/${area}.json`)) || {};
  }
  return {
    async get(area, key) {
      const data = await readArea(area);
      return data[key];
    },
    async set(area, key, value) {
      const data = await readArea(area);
      if (value === undefined) delete data[key];
      else data[key] = value;
      await store.writeJSON(`users/${uid}/${area}.json`, data);
    },
    async getAll(area) {
      return await readArea(area);
    },
  };
}

/** @param {Object} deps
 *  @param {import('./store.js').fileStore|import('./store.js').gcsStore} deps.store
 *  @param {(prompt: string) => Promise<string>} deps.geminiCaller
 *  @param {number} [deps.cap]
 *  @returns {{ getInstance: (uid: string) => Promise<{librarian:object, datastore:object}> }}
 */
export function createToolkitHost({ store, geminiCaller, cap = DEFAULT_CAP }) {
  if (!store) throw new Error('createToolkitHost: store is required');
  if (typeof geminiCaller !== 'function') throw new Error('createToolkitHost: geminiCaller is required');

  const cache = new Map(); // uid -> Promise<{librarian, datastore}>, insertion order = recency

  async function build(uid) {
    const instance = createToolkit({
      kv: kvStoreFor(store, uid),
      clock: nodeClock(),
      scheduler: noopScheduler,
      consent: noopConsent,
      toolsRegistry: TOOLS_REGISTRY,
    });
    instance.librarian.setGeminiCaller(geminiCaller);
    await instance.datastore.runMigrations();
    return instance;
  }

  async function getInstance(uid) {
    if (typeof uid !== 'string' || !uid) throw new Error('getInstance: uid is required');
    if (cache.has(uid)) {
      // Refresh recency: delete + re-set moves this key to the end of
      // Map's iteration order, which the eviction below reads as "oldest
      // first".
      const existing = cache.get(uid);
      cache.delete(uid);
      cache.set(uid, existing);
      return existing;
    }
    const built = build(uid);
    cache.set(uid, built);
    // Build failures shouldn't wedge an evicted slot into the cache forever.
    built.catch(() => cache.delete(uid));
    while (cache.size > cap) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    return built;
  }

  return { getInstance, _cacheSizeForTest: () => cache.size };
}
