// Toolkit datastore facade — the single place that knows where every store
// physically lives (storage area + key + version). Everything else resolves
// stores by logical name through the catalog, so a store can be resharded,
// renamed, or moved between chrome.storage areas with one catalog edit plus
// one migration.
//
// Two tiers, mirroring the architecture diagram:
//   global — read-only data shipped with the extension (built-in tools
//            registry, site taxonomy, bundled skills manifest). Code/assets,
//            not chrome.storage; exposed here so consumers have one API.
//   mine   — the user's own datastore. chrome.storage-backed, area-aware:
//            small high-value records (ability profile, suppressions) roam
//            via `sync`; bulky stores stay in `local`.
//
// Classic script (assigns globalThis.Datastore): loaded by background.js via
// importScripts after taxonomy.js / tools-registry.js. Extension pages may
// also load it, but WRITE access to `mine.*` is reserved for the background
// service worker — and from Phase 1, `mine.memory*`, `mine.profile`,
// `mine.suppressions`, `mine.proposals`, `mine.episodicLog` are written by
// the Librarian module ONLY (single-writer discipline). UI surfaces go
// through librarian.* messages, never this facade.

(() => {
  // --- Catalog -------------------------------------------------------------
  // Logical name → physical location. `reserved: true` marks stores declared
  // ahead of the Phase 1 Librarian so names, areas, and versions are stable
  // from day one; nothing writes them yet.
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

    // -- reserved for the Phase 1 Librarian --
    // Ability profile: semi-structured, schema-versioned, SMALL — lives in
    // sync so it roams across the user's devices (Lakshmi case). Includes
    // the metaPreferences block (consent boundary, interaction style).
    'mine.profile':      { area: 'sync',  key: 'aa.mine.profile',      version: 1, def: null, reserved: true },
    // Suppressions roam too: "don't suggest font changes" must hold on
    // every device.
    'mine.suppressions': { area: 'sync',  key: 'aa.mine.suppressions', version: 1, def: [],   reserved: true },
    // Append-only observation log + extraction cursor (the WAL of the
    // memory pipeline). The no-memory-zone check happens BEFORE writes
    // land here — see AA_TAXONOMY.noMemoryCategories().
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

  // --- chrome.storage promise helpers --------------------------------------
  function areaOf(name) {
    const d = CATALOG[name];
    if (!d) throw new Error(`Datastore: unknown store "${name}"`);
    return chrome.storage[d.area];
  }

  function rawGet(storageArea, key, def) {
    return new Promise((resolve) => {
      storageArea.get(key, (data) => {
        const v = data ? data[key] : undefined;
        resolve(v === undefined ? def : v);
      });
    });
  }

  function rawSet(storageArea, key, value) {
    return new Promise((resolve, reject) => {
      storageArea.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  // --- Migrations scaffold ---------------------------------------------------
  // Forward-only, idempotent, run lazily at SW startup. Add entries as
  //   { id: 2, run: async (ds) => { ... } }
  // and bump the relevant CATALOG version in the same change. Keep each
  // migration small enough to re-run safely if the SW dies mid-way.
  const MIGRATIONS = [
    {
      id: 1,
      // Baseline: stamp meta so future migrations know where they started.
      run: async () => { /* no-op — stamping happens in runMigrations */ },
    },
  ];

  async function runMigrations() {
    const local = chrome.storage.local;
    const meta = (await rawGet(local, META_KEY, null)) || { lastMigration: 0 };
    let applied = false;
    for (const m of MIGRATIONS) {
      if (m.id <= (meta.lastMigration || 0)) continue;
      await m.run(globalThis.Datastore);
      meta.lastMigration = m.id;
      applied = true;
    }
    meta.storeVersions = Object.fromEntries(
      Object.entries(CATALOG).map(([n, d]) => [n, d.version])
    );
    meta.memoryVersion = MEMORY_VERSION;
    meta.taxonomyVersion = globalThis.AA_TAXONOMY ? globalThis.AA_TAXONOMY.version : null;
    if (applied || !meta.lastMigratedAt) meta.lastMigratedAt = Date.now();
    await rawSet(local, META_KEY, meta);
    return meta;
  }

  // --- Public surface --------------------------------------------------------
  globalThis.Datastore = {
    catalog() {
      // Copy, so callers can't mutate the source of truth.
      return JSON.parse(JSON.stringify(CATALOG));
    },

    async get(name) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      return await rawGet(areaOf(name), d.key, structuredClone(d.def));
    },

    async set(name, value) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      await rawSet(areaOf(name), d.key, value);
    },

    // Read-modify-write. fn receives the current value and returns the new
    // one (or mutates and returns the same reference). chrome.storage writes
    // are atomic per key; this does NOT guard against concurrent patchers —
    // single-writer discipline (background SW only) is what makes it safe.
    async patch(name, fn) {
      const cur = await this.get(name);
      const next = await fn(cur);
      await this.set(name, next === undefined ? cur : next);
      return next === undefined ? cur : next;
    },

    // Memory fact shards (Phase 1). One chrome.storage.local key per scope
    // so recall reads only the shards the current page needs.
    memoryShardKey(scope) {
      if (!/^(general|category:[a-z-]+|context:[a-z-]+|origin:[a-z0-9.-]+|tool:[a-zA-Z0-9_-]+)$/.test(scope)) {
        throw new Error(`Datastore: invalid memory scope "${scope}"`);
      }
      return MEMORY_SHARD_PREFIX + scope;
    },

    async getMemoryShard(scope) {
      return await rawGet(chrome.storage.local, this.memoryShardKey(scope), []);
    },

    async setMemoryShard(scope, records) {
      await rawSet(chrome.storage.local, this.memoryShardKey(scope), records);
    },

    // Global tier — read-only, shipped with the extension.
    global: {
      tools() { return globalThis.AA_TOOLS || null; },
      taxonomy() { return globalThis.AA_TAXONOMY || null; },
    },

    runMigrations,
  };
})();
