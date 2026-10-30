// Who can read what an app or adapter gives the toolkit: the visibility levels
// of toolkit/protocol/adapter/access.js, enforced here.
//
// The caller. A console session, the default token and an app token without an
// app are the account's own tools: they read everything. An app token bound to
// one app (auth.js) reads user-level data plus its own app's.
//
// Where data goes. User-level observations and memories live in the account's
// own Librarian, as before. App- and adapter-level ones live in a Librarian of
// their own (a partition, toolkit-host.js), so the toolkit learns from them
// without any other app reading the result, and they never become suggested
// changes to the shared profile. Partitions are named
//   app~<appId>                        what one app gave
//   adapter~<owner>~<appId>~<id>       what one adapter gave
// and listed in users/<uid>/access.json with who may read them.
//
// Adapter data. Each adapter can keep a few values per account
// (users/<uid>/adapter-data/<owner>/<appId>/<id>.json, 4 MB in all). At user
// level any app of the account reads them; narrower, the adapter's own app and
// the apps that installed it.
//
// The person narrows, never widens: the narrowest of what the app or adapter
// declared and what the console chose wins.

import {
  ACCESS_TOOL_SCHEMAS, ACCESS_TOOL_DESCRIPTIONS, ACCESS_READ_ONLY, APP_VISIBILITY, narrowestVisibility,
} from '../../toolkit/protocol/adapter/index.js';
import { sharedDoc } from './shared-doc.js';

const ACCESS_DOC = (uid) => `users/${uid}/access.json`;
const DATA_DOC = (uid, k) => `users/${uid}/adapter-data/${k.owner}/${k.appId}/${k.id}.json`;
export const MAX_ADAPTER_DATA = 4_000_000;   // characters of JSON, about 4 MB

const keyString = (k) => `${k.owner}/${k.appId}/${k.id}`;
const normalizeAccess = (v) => ({
  apps: v?.apps && typeof v.apps === 'object' ? v.apps : {},
  adapters: v?.adapters && typeof v.adapters === 'object' ? v.adapters : {},
  partitions: v?.partitions && typeof v.partitions === 'object' ? v.partitions : {},
});
const normalizeData = (v) => ({ values: v?.values && typeof v.values === 'object' ? v.values : {} });

/** The account's own tools read everything; an app token bound to an app does not. */
export const accountLevel = (auth) => !auth || auth.kind !== 'app' || !auth.appId;

class AccessError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * @param {object} config
 * @param {object} config.store
 * @param {() => {lookup: Function, installedIn: Function}} config.registry
 *   late-bound: lookup(uid, key) -> {owner, rec} of an adapter the account can
 *   see (or throws not-found); installedIn(uid, fullKey) -> the apps that installed it
 */
export function createAccess({ store, registry }) {
  const docs = new Map();
  const accessDoc = (uid) => {
    if (!docs.has(uid)) docs.set(uid, sharedDoc(store, ACCESS_DOC(uid), normalizeAccess));
    return docs.get(uid);
  };
  const dataDoc = (uid, k) => sharedDoc(store, DATA_DOC(uid, k), normalizeData);

  const appLevel = (s, appId) => {
    const a = s.apps[appId];
    // An app reaches app level at most: adapter level is about one adapter.
    return narrowestVisibility(APP_VISIBILITY.includes(a?.declared) ? a.declared : 'user', a?.restricted === 'adapter' ? 'app' : a?.restricted);
  };
  const adapterLevel = (s, rec, full) => narrowestVisibility(rec?.visibility, s.adapters[full]?.restricted);

  async function adapterOf(uid, key) {
    const { owner, rec } = await registry().lookup(uid, key);
    return { key: { owner, appId: rec.appId, id: rec.id }, rec, full: `${owner}/${rec.appId}/${rec.id}` };
  }

  /** The app an app token writes as: always its own. */
  function writerApp(auth, app) {
    if (accountLevel(auth)) return app;
    if (app && app !== auth.appId) throw new AccessError('forbidden', `This token is for the app ${auth.appId}, not ${app}.`);
    return auth.appId;
  }

  /**
   * Where a write from this caller goes. Returns {level, partition} — partition
   * null is the account's own Librarian (user level).
   * @param {{app?: string, adapter?: {owner?: string, appId: string, id: string}}} about
   */
  async function resolveWrite(uid, auth, { app, adapter } = {}) {
    app = writerApp(auth, app);
    const s = await accessDoc(uid).read();
    let level = app ? appLevel(s, app) : 'user';
    let ad = null;
    if (adapter) {
      ad = await adapterOf(uid, adapter);
      level = narrowestVisibility(level, adapterLevel(s, ad.rec, ad.full));
    }
    const readerApp = app || ad?.key.appId;
    if (level === 'adapter' && !ad) level = 'app';
    if (level === 'app' && !readerApp) level = 'user';
    if (level === 'user') return { level, partition: null };
    const partition = level === 'app' ? `app~${readerApp}` : `adapter~${ad.key.owner}~${ad.key.appId}~${ad.key.id}`;
    const entry = { level, app: readerApp, ...(ad ? { adapter: ad.full } : {}) };
    const known = s.partitions[partition];
    if (!known || known.level !== entry.level || known.app !== entry.app) {
      await accessDoc(uid).mutate((doc) => { doc.partitions[partition] = entry; return { save: true }; });
    }
    return { level, partition };
  }

  /** The partitions (beyond the account's own Librarian) this caller may read, with what each is. */
  async function readable(uid, auth) {
    const { partitions } = await accessDoc(uid).read();
    const all = Object.entries(partitions).map(([partition, p]) => ({ partition, ...p }));
    if (accountLevel(auth)) return all;
    const out = [];
    for (const p of all) {
      if (p.app === auth.appId) { out.push(p); continue; }
      if (p.level === 'adapter' && p.adapter) {
        const [, appId] = p.adapter.split('/');
        if (appId === auth.appId || (await registry().installedIn(uid, p.adapter)).includes(auth.appId)) out.push(p);
      }
    }
    return out;
  }

  /** Every partition of the account (for learning and reset). */
  async function partitions(uid) {
    return Object.keys((await accessDoc(uid).read()).partitions);
  }

  async function mayUseData(uid, auth, ad, s) {
    if (accountLevel(auth)) return true;
    if (adapterLevel(s, ad.rec, ad.full) === 'user') return true;
    return ad.key.appId === auth.appId || (await registry().installedIn(uid, ad.full)).includes(auth.appId);
  }

  async function dataFor(uid, auth, adapter) {
    const ad = await adapterOf(uid, adapter);
    const s = await accessDoc(uid).read();
    if (!(await mayUseData(uid, auth, ad, s))) {
      throw new AccessError('forbidden', `Only the apps that run ${ad.full} can read its data: its visibility is ${adapterLevel(s, ad.rec, ad.full)}.`);
    }
    return ad;
  }

  // ── the MCP tools ──────────────────────────────────────────────────────────
  const run = {
    async app_declare(uid, args, auth) {
      const appId = writerApp(auth, args.appId);
      const result = await accessDoc(uid).mutate((doc) => {
        const prev = doc.apps[appId] || {};
        doc.apps[appId] = { ...prev, ...(args.name ? { name: args.name } : {}), declared: args.visibility, declaredAt: new Date().toISOString() };
        return { save: true, result: doc };
      });
      return { app: appId, declared: args.visibility, visibility: appLevel(result, appId) };
    },

    async access_get(uid, args, auth) {
      const s = await accessDoc(uid).read();
      const mine = (appId) => accountLevel(auth) || appId === auth.appId;
      const apps = Object.entries(s.apps).filter(([appId]) => mine(appId)).map(([appId, a]) => ({
        app: appId, name: a.name || appId, declared: a.declared || 'user', restricted: a.restricted || null, visibility: appLevel(s, appId),
      }));
      const adapters = [];
      for (const [full, a] of Object.entries(s.adapters)) {
        const [owner, appId, id] = full.split('/');
        if (!mine(appId)) continue;
        let declared = 'user';
        try { declared = (await adapterOf(uid, { owner, appId, id })).rec.visibility || 'user'; } catch { /* gone or no longer shared */ }
        adapters.push({ adapter: { owner, appId, id }, declared, restricted: a.restricted || null, visibility: narrowestVisibility(declared, a.restricted) });
      }
      return { apps, adapters };
    },

    async access_restrict(uid, args, auth) {
      if (!accountLevel(auth)) throw new AccessError('forbidden', 'Only the account\'s own tools (the developer console or the default token) can change who reads an app\'s data.');
      if (!!args.app === !!args.adapter) throw new AccessError('invalid-arguments', 'Name either an app or an adapter.');
      const restricted = args.visibility === 'user' ? null : args.visibility;
      if (args.app) {
        if (restricted === 'adapter') throw new AccessError('invalid-arguments', 'An app narrows to app level at most; narrow an adapter to adapter level.');
        const doc = await accessDoc(uid).mutate((d) => {
          d.apps[args.app] = { ...(d.apps[args.app] || {}) };
          if (restricted) d.apps[args.app].restricted = restricted; else delete d.apps[args.app].restricted;
          return { save: true, result: d };
        });
        return { app: args.app, restricted, visibility: appLevel(doc, args.app) };
      }
      const ad = await adapterOf(uid, args.adapter);
      const doc = await accessDoc(uid).mutate((d) => {
        if (restricted) d.adapters[ad.full] = { restricted }; else delete d.adapters[ad.full];
        return { save: true, result: d };
      });
      return { adapter: ad.key, restricted, visibility: adapterLevel(doc, ad.rec, ad.full) };
    },

    async adapter_data_get(uid, args, auth) {
      const ad = await dataFor(uid, auth, args.adapter);
      const { values } = await dataDoc(uid, ad.key).read();
      if (args.key === undefined) return { adapter: ad.key, values };
      return { adapter: ad.key, key: args.key, found: Object.hasOwn(values, args.key), value: values[args.key] ?? null };
    },

    async adapter_data_set(uid, args, auth) {
      const ad = await dataFor(uid, auth, args.adapter);
      const size = await dataDoc(uid, ad.key).mutate((doc) => {
        const next = { ...doc.values, [args.key]: args.value };
        const chars = JSON.stringify(next).length;
        if (chars > MAX_ADAPTER_DATA) throw new AccessError('data-too-large', `An adapter keeps at most ${MAX_ADAPTER_DATA} characters of data (as JSON); this would be ${chars}.`);
        doc.values = next;
        return { save: true, result: chars };
      });
      return { adapter: ad.key, key: args.key, saved: true, size };
    },

    async adapter_data_delete(uid, args, auth) {
      const ad = await dataFor(uid, auth, args.adapter);
      const deleted = await dataDoc(uid, ad.key).mutate((doc) => {
        if (args.key === undefined) { const n = Object.keys(doc.values).length; doc.values = {}; return { save: n > 0, result: n }; }
        if (!Object.hasOwn(doc.values, args.key)) return { save: false, result: 0 };
        delete doc.values[args.key];
        return { save: true, result: 1 };
      });
      return { adapter: ad.key, deleted };
    },
  };

  const tools = Object.fromEntries(Object.entries(run).map(([name, fn]) => [name, {
    schema: ACCESS_TOOL_SCHEMAS[name], description: ACCESS_TOOL_DESCRIPTIONS[name], readOnly: ACCESS_READ_ONLY.includes(name), run: fn,
  }]));

  return { resolveWrite, readable, partitions, accountLevel, tools, keyString };
}
