// Toolkit datastore — the single place that knows where every store
// physically lives (storage area + key + version). Everything else resolves
// stores by logical name through the catalog, so a store can be resharded,
// renamed, or moved between areas with one catalog edit plus one migration.
//
// Two tiers, mirroring the architecture diagram:
//   global — read-only data shipped with the host (built-in tools registry,
//            site taxonomy, bundled skills manifest). Provided via the
//            globalTier port; exposed here so consumers have one API.
//   mine   — the user's own datastore. Area-aware: small high-value records
//            (ability profile, suppressions) roam via `sync`; bulky stores
//            stay in `local`.
//
// Platform-agnostic ES module. Storage enters through the `areas` port
// (see ports.js); the Chrome adapter wraps chrome.storage. WRITE access to
// `mine.*` is reserved for the Librarian (single-writer discipline) — UI
// surfaces go through librarian.* messages, never this facade.

/**
 * @param {Object} deps
 * @param {import('./ports.js').Areas} deps.areas
 * @param {import('./ports.js').GlobalTier} deps.globalTier
 * @param {import('./ports.js').Clock} [deps.clock]
 */
export function createDatastore({ areas, globalTier, clock = { now: () => Date.now() } }) {
  // --- Catalog -------------------------------------------------------------
  // Logical name → physical location. `reserved: true` marks stores declared
  // ahead of their writer so names, areas, and versions are stable from day
  // one.
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

    // -- Librarian stores --
    // Ability profile: semi-structured, schema-versioned, SMALL — lives in
    // sync so it roams across the user's devices. Includes the
    // metaPreferences block (consent boundary, interaction style).
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

    // -- Phase 3: cross-app permission broker --
    // Capability grants roam (a revocation must hold on every device);
    // the share audit log stays local.
    'mine.grants':       { area: 'sync',  key: 'aa.mine.grants',       version: 1, def: [] },
    'mine.shareAudit':   { area: 'local', key: 'aa.mine.shareAudit',   version: 1, def: [] },

    // -- Skill layer: the "Skills db" from the diagrams --
    // The user's own skills (SKILL.md playbooks the Engineer built, as parsed
    // Skill objects). Distinct from `mine.skills` (legacy customSkills =
    // user-built adapter *code*). Roams so a skill built on one device applies
    // on all of them.
    'mine.skillDocs':    { area: 'sync',  key: 'aa.mine.skillDocs',    version: 1, def: [] },
  };

  // Memory fact shards are dynamic (one key per scope) and share this
  // version. Scope grammar:
  //   general | category:<id> | context:<id> | origin:<host> | tool:<id>
  // Precedence at merge time: origin > category > context > general.
  const MEMORY_SHARD_PREFIX = 'aa.mine.memory.';
  const MEMORY_VERSION = 1;

  const META_KEY = 'aa.meta'; // local: { storeVersions, taxonomyVersion, lastMigratedAt }

  function areaOf(name) {
    const d = CATALOG[name];
    if (!d) throw new Error(`Datastore: unknown store "${name}"`);
    return areas[d.area];
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
  ];

  async function runMigrations() {
    const meta = (await areas.local.get(META_KEY, null)) || { lastMigration: 0 };
    let applied = false;
    for (const m of MIGRATIONS) {
      if (m.id <= (meta.lastMigration || 0)) continue;
      await m.run(api);
      meta.lastMigration = m.id;
      applied = true;
    }
    meta.storeVersions = Object.fromEntries(
      Object.entries(CATALOG).map(([n, d]) => [n, d.version])
    );
    meta.memoryVersion = MEMORY_VERSION;
    const tax = globalTier.taxonomy();
    meta.taxonomyVersion = tax ? tax.version : null;
    if (applied || !meta.lastMigratedAt) meta.lastMigratedAt = clock.now();
    await areas.local.set(META_KEY, meta);
    return meta;
  }

  // --- Public surface --------------------------------------------------------
  const api = {
    catalog() {
      // Copy, so callers can't mutate the source of truth.
      return JSON.parse(JSON.stringify(CATALOG));
    },

    async get(name) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      return await areaOf(name).get(d.key, structuredClone(d.def));
    },

    async set(name, value) {
      const d = CATALOG[name];
      if (!d) throw new Error(`Datastore: unknown store "${name}"`);
      await areaOf(name).set(d.key, value);
    },

    // Read-modify-write. fn receives the current value and returns the new
    // one (or mutates and returns the same reference). Writes are atomic per
    // key; this does NOT guard against concurrent patchers — single-writer
    // discipline is what makes it safe.
    async patch(name, fn) {
      const cur = await this.get(name);
      const next = await fn(cur);
      await this.set(name, next === undefined ? cur : next);
      return next === undefined ? cur : next;
    },

    // Memory fact shards. One local key per scope so recall reads only the
    // shards the current page needs.
    memoryShardKey(scope) {
      if (!/^(general|category:[a-z-]+|context:[a-z-]+|origin:[a-z0-9.-]+|tool:[a-zA-Z0-9_-]+)$/.test(scope)) {
        throw new Error(`Datastore: invalid memory scope "${scope}"`);
      }
      return MEMORY_SHARD_PREFIX + scope;
    },

    async getMemoryShard(scope) {
      return await areas.local.get(this.memoryShardKey(scope), []);
    },

    async setMemoryShard(scope, records) {
      await areas.local.set(this.memoryShardKey(scope), records);
    },

    // Global tier — read-only, shipped with the host.
    global: {
      tools() { return globalTier.tools(); },
      taxonomy() { return globalTier.taxonomy(); },
      // Built-in skills (SKILL.md playbooks) shipped with the host. Returns
      // an array of parsed Skill objects, or [] if the host ships none.
      skills() { return (globalTier.skills && globalTier.skills()) || []; },
    },

    runMigrations,
  };

  return api;
}
