// Toolkit datastore facade — the single place that knows where every store
// physically lives (storage area + key + version). Everything else resolves
// stores by logical name through the catalog, so a store can be resharded,
// renamed, or moved between storage areas with one catalog edit plus one
// migration.
//
// Platform-agnostic: all persistence goes through an injected `KVStore` port
// (see ../ports). The Chrome host wires `chrome.storage.*` behind it and
// assigns the result to `globalThis.Datastore`
// (adapters/chrome/datastore.entry.js); other hosts supply their own KVStore.
//
// Two tiers, mirroring the architecture diagram:
//   global — read-only data shipped with the host (built-in tools registry,
//            site taxonomy). Code/assets, not the KVStore; exposed here so
//            consumers have one API. Injected at construction.
//   mine   — the user's own datastore. KVStore-backed, area-aware: small
//            high-value records (ability profile, suppressions) roam via the
//            'sync' area; bulky stores stay in 'local'.
//
// WRITE access to `mine.memory*`, `mine.profile`, `mine.suppressions`,
// `mine.proposals`, `mine.episodicLog` is reserved for the Librarian module
// (single-writer discipline). UI surfaces go through librarian.* messages,
// never this facade.

/**
 * @param {Object} deps
 * @param {import('../ports/index.js').KVStore} deps.kv
 * @param {import('../ports/index.js').Clock} deps.clock
 * @param {Object} deps.taxonomy       The site taxonomy object (../core/taxonomy).
 * @param {Object|null} [deps.toolsRegistry]  The built-in tools registry (AA_TOOLS), or null.
 * @returns the Datastore facade.
 */
import { coerceSettings } from './units.js';

export function createDatastore({ kv, clock, taxonomy, toolsRegistry = null }) {
  if (!kv) throw new Error('createDatastore: kv port is required');
  if (!clock) throw new Error('createDatastore: clock port is required');

  // --- Catalog -------------------------------------------------------------
  // Logical name → physical location. `reserved: true` marks stores declared
  // ahead of the Librarian so names, areas, and versions are stable from day
  // one; nothing writes them yet.
  //
  // Existing keys (customSkills, customProfiles, userProfile, bhSkills) keep
  // their legacy physical names — no data migration; the catalog is the
  // mapping layer.
  const CATALOG = {
    // -- existing stores (legacy physical keys) --
    'mine.skills':            { area: 'local', key: 'customSkills',   version: 1, def: [] },
    'mine.profiles':          { area: 'local', key: 'customProfiles', version: 1, def: [] },
    'mine.onboardingProfile': { area: 'local', key: 'userProfile',    version: 1, def: null },
    'mine.harnessSkills':     { area: 'local', key: 'bhSkills',       version: 1, def: {} },

    // -- reserved for the Librarian --
    // Ability profile: semi-structured, schema-versioned, SMALL — lives in
    // sync so it roams across the user's devices (Lakshmi case). Includes
    // the metaPreferences block (consent boundary, interaction style).
    'mine.profile':      { area: 'sync',  key: 'aa.mine.profile',      version: 1, def: null, reserved: true },
    // Suppressions roam too: "don't suggest font changes" must hold on
    // every device.
    'mine.suppressions': { area: 'sync',  key: 'aa.mine.suppressions', version: 1, def: [],   reserved: true },
    // Append-only observation log + extraction cursor (the WAL of the
    // memory pipeline). The no-memory-zone check happens BEFORE writes
    // land here — see taxonomy.noMemoryCategories().
    'mine.episodicLog':  { area: 'local', key: 'aa.mine.episodicLog',  version: 1, def: { cursor: 0, entries: [] }, reserved: true },
    'mine.proposals':    { area: 'local', key: 'aa.mine.proposals',    version: 1, def: [],   reserved: true },
    // origin → {category, source: 'hostmap'|'llm'|'user', classifiedAt,
    // taxonomyVersion}. Classify once, cache; user overrides are sticky.
    'mine.siteIndex':    { area: 'local', key: 'aa.mine.siteIndex',    version: 1, def: {},   reserved: true },
    // Materialized presentation views (core memory block, review-page
    // groups, category playbooks) rendered by the reflection job.
    'mine.views':        { area: 'local', key: 'aa.mine.views',        version: 1, def: {},   reserved: true },
  };

  // Memory fact shards are dynamic (one key per scope) and share this
  // version. Scope grammar:
  //   general | category:<id> | context:<id> | origin:<host> | tool:<id>
  // Precedence at merge time: origin > category > context > general.
  const MEMORY_SHARD_PREFIX = 'aa.mine.memory.';
  const MEMORY_VERSION = 1;

  const META_KEY = 'aa.meta'; // local: { storeVersions, taxonomyVersion, lastMigratedAt }

  // --- KVStore promise helpers ---------------------------------------------
  async function rawGet(area, key, def) {
    const v = await kv.get(area, key);
    return v === undefined ? def : v;
  }

  async function rawSet(area, key, value) {
    await kv.set(area, key, value);
  }

  // --- Migrations scaffold ---------------------------------------------------
  // Forward-only, idempotent, run lazily at host startup. Add entries as
  //   { id: 2, run: async (ds) => { ... } }
  // and bump the relevant CATALOG version in the same change. Keep each
  // migration small enough to re-run safely if the host dies mid-way.
  const MIGRATIONS = [
    {
      id: 1,
      // Baseline: stamp meta so future migrations know where they started.
      run: async () => { /* no-op — stamping happens in runMigrations */ },
    },
    {
      id: 2,
      // Normalize legacy memory-record settings to canonical units. The read
      // path is now clamp-only (the `>10` %-vs-multiplier heuristic was deleted
      // from reads), so any value an old un-coerced writer stored as a
      // multiplier (e.g. fontScale:1.5) is normalized once here (→ 150) instead
      // of being second-guessed on every read. Idempotent: canonical values are
      // unchanged by coercion.
      run: async (ds) => {
        const meta = (ds.global.tools() && ds.global.tools().settingsMeta) || {};
        if (!Object.keys(meta).length) return; // no registry → nothing to normalize
        const shards = await ds.allMemoryShards();
        for (const [scope, recs] of Object.entries(shards)) {
          let dirty = false;
          for (const r of (recs || [])) {
            if (r && r.settings && typeof r.settings === 'object') {
              const norm = coerceSettings(r.settings, meta);
              if (JSON.stringify(norm) !== JSON.stringify(r.settings)) { r.settings = norm; dirty = true; }
            }
          }
          if (dirty) await ds.setMemoryShard(scope, recs);
        }
      },
    },
  ];

  async function runMigrations() {
    const meta = (await rawGet('local', META_KEY, null)) || { lastMigration: 0 };
    let applied = false;
    for (const m of MIGRATIONS) {
      if (m.id <= (meta.lastMigration || 0)) continue;
      await m.run(Datastore);
      meta.lastMigration = m.id;
      applied = true;
    }
    meta.storeVersions = Object.fromEntries(
      Object.entries(CATALOG).map(([n, d]) => [n, d.version])
    );
    meta.memoryVersion = MEMORY_VERSION;
    meta.taxonomyVersion = taxonomy ? taxonomy.version : null;
    if (applied || !meta.lastMigratedAt) meta.lastMigratedAt = clock.now();
    await rawSet('local', META_KEY, meta);
    return meta;
  }

  // --- Public surface --------------------------------------------------------
  const Datastore = {
    catalog() {
      // Copy, so callers can't mutate the source of truth.
      return JSON.parse(JSON.stringify(CATALOG));
    },

    async get(name) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      return await rawGet(d.area, d.key, structuredClone(d.def));
    },

    async set(name, value) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      await rawSet(d.area, d.key, value);
    },

    // Read-modify-write. fn receives the current value and returns the new
    // one (or mutates and returns the same reference). KVStore writes are
    // atomic per key; this does NOT guard against concurrent patchers —
    // single-writer discipline (host background only) is what makes it safe.
    async patch(name, fn) {
      const cur = await this.get(name);
      const next = await fn(cur);
      await this.set(name, next === undefined ? cur : next);
      return next === undefined ? cur : next;
    },

    // Memory fact shards. One KVStore 'local' key per scope so recall reads
    // only the shards the current page needs.
    memoryShardKey(scope) {
      if (!/^(general|category:[a-z-]+|context:[a-z-]+|origin:[a-z0-9.-]+|tool:[a-zA-Z0-9_-]+)$/.test(scope)) {
        throw new Error(`Datastore: invalid memory scope "${scope}"`);
      }
      return MEMORY_SHARD_PREFIX + scope;
    },

    async getMemoryShard(scope) {
      return await rawGet('local', this.memoryShardKey(scope), []);
    },

    async setMemoryShard(scope, records) {
      await rawSet('local', this.memoryShardKey(scope), records);
    },

    // Every memory shard, as { scope: records }. Replaces the Librarian's
    // former direct `chrome.storage.local.get(null)` scans, keeping the
    // facade the single place that knows the shard prefix.
    async allMemoryShards() {
      const all = await kv.getAll('local');
      const out = {};
      for (const [key, recs] of Object.entries(all || {})) {
        if (key.startsWith(MEMORY_SHARD_PREFIX)) {
          out[key.slice(MEMORY_SHARD_PREFIX.length)] = recs || [];
        }
      }
      return out;
    },

    // Global tier — read-only, supplied by the host at construction.
    global: {
      tools() { return toolsRegistry || null; },
      taxonomy() { return taxonomy || null; },
    },

    runMigrations,
  };

  return Datastore;
}

export default createDatastore;
