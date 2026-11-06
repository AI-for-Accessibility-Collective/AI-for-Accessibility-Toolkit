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

// What each of a person's profiles keeps on its own: its settings and its
// memory (observations, memories, suggestions, what not to suggest, the
// reflection's views). The rest is the account's, whichever profile is
// active: grants, skills, the sites learning is paused on, the needs apps
// registered, the datastore's migrations. The Default profile is the
// account's own folder, so it keeps what was there before profiles had
// their own.
const PROFILE_KEYS = new Set(['aa.mine.profile', 'aa.mine.suppressions', 'aa.mine.episodicLog', 'aa.mine.proposals', 'aa.mine.views']);
export function isProfileKey(key) {
  const k = String(key).replace(/^aa\.u\.[^:]+::/, ''); // the datastore's acting-user prefix
  return PROFILE_KEYS.has(k) || k.startsWith('aa.mine.memory.');
}

/** A profile's id as a folder name: a preset's id (wai-1, custom-…), or null for Default. */
export function profileFolder(id) {
  if (id == null || id === 'default') return null;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error(`unsafe profile ${JSON.stringify(id)}`);
  return id;
}

/** A KVStore (get/set/getAll per area — see toolkit/ports/index.js) backed by
 *  one store-document per `<root>/<area>.json`. Same read-whole/
 *  mutate/write-whole algorithm as toolkit/platforms/node/kv.js's fileKV,
 *  retargeted at the store's doc interface so it works over fileStore OR
 *  gcsStore unchanged. With `own` (a profile's folder), the profile's keys
 *  (isProfileKey) live there and the rest in `root`. */
function kvStoreFor(store, root, own = root) {
  const readDoc = async (doc) => (await store.readJSON(doc)) || {};
  const docOf = (area, key) => `${own !== root && isProfileKey(key) ? own : root}/${area}.json`;
  return {
    async get(area, key) {
      const data = await readDoc(docOf(area, key));
      return data[key];
    },
    async set(area, key, value) {
      const doc = docOf(area, key);
      const data = await readDoc(doc);
      if (value === undefined) delete data[key];
      else data[key] = value;
      await store.writeJSON(doc, data);
    },
    async getAll(area) {
      if (own === root) return readDoc(`${root}/${area}.json`);
      const [shared, mine] = await Promise.all([readDoc(`${root}/${area}.json`), readDoc(`${own}/${area}.json`)]);
      const all = {};
      for (const [k, v] of Object.entries(shared)) if (!isProfileKey(k)) all[k] = v;
      for (const [k, v] of Object.entries(mine)) if (isProfileKey(k)) all[k] = v;
      return all;
    },
  };
}

/** The Media port (toolkit/ports): one document per observation image,
 *  `<root>/media/<id>.json`, so the episodic log stays small. A deleted image
 *  is written as null (the store has no delete); the account's deletion
 *  removes the documents. */
function mediaFor(store, root) {
  const doc = (id) => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error(`media: unsafe id ${JSON.stringify(id)}`);
    return `${root}/media/${id}.json`;
  };
  return {
    put: (id, image) => store.writeJSON(doc(id), { mimeType: image.mimeType, data: image.data }),
    get: async (id) => (await store.readJSON(doc(id))) || null,
    delete: (id) => store.writeJSON(doc(id), null),
  };
}

/** Where one Librarian keeps its data: the account's own, or one of its
 *  partitions (access.js: what one app or adapter gave, kept apart). */
export function partitionRoot(uid, partition) {
  if (!partition) return `users/${uid}`;
  if (!/^(app|adapter)~[A-Za-z0-9._@~-]{1,300}$/.test(partition) || partition.includes('..')) throw new Error(`unsafe partition ${JSON.stringify(partition)}`);
  return `users/${uid}/scoped/${partition}`;
}

/** Where a profile other than Default keeps its own keys, for the account or one partition. */
export function profileRoot(uid, partition, profile) {
  const folder = profileFolder(profile);
  if (!folder) return partitionRoot(uid, partition);
  return `users/${uid}/profiles/${folder}${partition ? partitionRoot(uid, partition).slice(`users/${uid}`.length) : ''}`;
}

/** @param {Object} deps
 *  @param {import('./store.js').fileStore|import('./store.js').gcsStore} deps.store
 *  @param {(prompt: string) => Promise<string>} deps.geminiCaller
 *  @param {number} [deps.cap]
 *  @returns {{ getInstance: (uid: string, partition?: string|null, opts?: {profile?: string|null}) => Promise<{librarian:object, datastore:object}> }}
 *
 *  Each instance is one profile's: the account's active profile, which
 *  `followProfiles(uid => id)` says (Default, null, until it is set), or the
 *  one `opts.profile` names.
 */
export function createToolkitHost({ store, geminiCaller, cap = DEFAULT_CAP }) {
  if (!store) throw new Error('createToolkitHost: store is required');
  if (typeof geminiCaller !== 'function') throw new Error('createToolkitHost: geminiCaller is required');

  const cache = new Map(); // uid (or uid + partition + profile) -> Promise<{librarian, datastore}>, insertion order = recency
  const cacheKey = (uid, partition, profile) => (partition || profile ? `${uid}\u0000${partition || ''}\u0000${profile || ''}` : uid);
  let profileOf = async () => null;

  async function build(uid, partition, profile) {
    const root = partitionRoot(uid, partition);
    const own = profileRoot(uid, partition, profile);
    const instance = createToolkit({
      kv: kvStoreFor(store, root, own),
      media: mediaFor(store, own),
      clock: nodeClock(),
      scheduler: noopScheduler,
      consent: noopConsent,
      toolsRegistry: TOOLS_REGISTRY,
    });
    instance.librarian.setGeminiCaller(geminiCaller);
    await instance.datastore.runMigrations();
    return instance;
  }

  async function getInstance(uid, partition = null, opts = {}) {
    if (typeof uid !== 'string' || !uid) throw new Error('getInstance: uid is required');
    const profile = profileFolder(opts.profile !== undefined ? opts.profile : await profileOf(uid));
    const key = cacheKey(uid, partition, profile);
    if (cache.has(key)) {
      // Refresh recency: delete + re-set moves this key to the end of
      // Map's iteration order, which the eviction below reads as "oldest
      // first".
      const existing = cache.get(key);
      cache.delete(key);
      cache.set(key, existing);
      return existing;
    }
    const built = build(uid, partition, profile);
    cache.set(key, built);
    // Build failures shouldn't wedge an evicted slot into the cache forever.
    built.catch(() => cache.delete(key));
    while (cache.size > cap) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    return built;
  }

  /** Drop a uid's cached instance (e.g. after its data partition is deleted,
   *  so a stale in-memory instance cannot write the partition back). Safe
   *  because instances are stateless by construction (noopScheduler — no
   *  timers to leak, see the header); data is never touched, only the
   *  in-memory object. */
  function evict(uid) {
    let dropped = cache.delete(uid);
    for (const key of [...cache.keys()]) if (key.startsWith(`${uid}\u0000`)) dropped = cache.delete(key) || dropped;
    return dropped;
  }

  /** Which profile is the account's active one: `fn(uid)` resolves to its id, or null for Default. */
  function followProfiles(fn) { profileOf = fn; }

  return { getInstance, evict, followProfiles, _cacheSizeForTest: () => cache.size };
}
