// The adapter registry: the toolkit's own MCP server, at /v1/mcp
// (docs/design/adapter-mcp.md §14, CONTRACT.md "Adapter registry").
//
// Applications built with the toolkit share adapters here. An app publishes
// an adapter (a descriptor, and for a portable one a web-module package); it
// stays private to the account until the owner shares it with everyone on
// this toolkit; any app of an account can install an adapter it can see, and
// a runtime (the browser extension, a web app) asks what it has installed and
// reports how running it went.
//
//   POST /v1/mcp   MCP JSON-RPC: initialize, ping, tools/list, tools/call,
//                  resources/list, resources/read
//   GET  /v1/mcp   an SSE stream of notifications/resources/list_changed,
//                  sent when something the account can see changes
//
// Storage, all JSON documents:
//   users/<uid>/registry.json                        the account's adapters (metadata, revision list)
//   users/<uid>/registry/<appId>/<id>/<rev>.json     one revision: descriptor and package
//   users/<uid>/installs.json                        what each of the account's apps installed
//   users/<uid>/runtime-status.json                  the latest runtime reports
//   registry/shared.json                             summaries of every shared adapter (instance-wide)
// The per-user documents go with the account. The shared index is cleaned by
// dropUser when an account is deleted.
//
// Never logged or stored outside these documents: package code, parameters,
// full page URLs (a report carries an origin only).

import crypto from 'node:crypto';
import {
  checkDescriptor, defineDescriptor, descriptorDigest, checkPackage, artifactDigest, webUrlPatterns, matchUrlPattern,
  validate, formatErrors, MCP_PROTOCOL_VERSION, PROFILE_VERSION, SLUG,
  REGISTRY_TOOL_SCHEMAS, REGISTRY_TOOLS, REGISTRY_READ_ONLY, REGISTRY_TOOL_DESCRIPTIONS,
} from '../../toolkit/protocol/adapter/index.js';
import { HttpError, sendJSON, readJSON } from './http.js';
import { sharedDoc } from './shared-doc.js';
import { assertSafeUid } from './store.js';

export const REGISTRY_PATH = '/v1/mcp';
const REGISTRY_DOC = (uid) => `users/${uid}/registry.json`;
const REVISION_DOC = (uid, appId, id, rev) => `users/${uid}/registry/${appId}/${id}/${rev}.json`;
const INSTALLS_DOC = (uid) => `users/${uid}/installs.json`;
const STATUS_DOC = (uid) => `users/${uid}/runtime-status.json`;
const SHARED_DOC = 'registry/shared.json';

const MAX_ADAPTERS = 200;       // per account
const KEEP_REVISIONS = 20;      // per adapter; older revision documents are removed
const MAX_INSTALLS = 200;       // per app
const MAX_RESULTS = 500;        // stored runtime reports per account
const INSTANCE_TTL_MS = 7 * 24 * 3600 * 1000;
const HEARTBEAT_MS = 25_000;
const COMPATIBLE_MCP = ['2025-11-25', '2025-06-18', '2025-03-26'];

/** A tool call that cannot go ahead: shown to the caller as a tool error. */
class ToolError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

const keyString = (k) => `${k.owner}/${k.appId}/${k.id}`;
function parseKey(s) {
  const [owner, appId, id, ...rest] = String(s).split('/');
  return rest.length || !owner || !appId || !id ? null : { owner, appId, id };
}
const isOrigin = (s) => {
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === s; } catch { return false; }
};

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} config.withUserLock
 * @param {(req) => Promise<object|null>} config.authenticate  token record or null
 * @param {{info: Function, warn: Function}} config.log
 * @param {string} [config.version]  the service version, for serverInfo
 */
export function createRegistry({ store, withUserLock, authenticate, log, version = '0.1.0', now = () => new Date() }) {
  const shared = sharedDoc(store, SHARED_DOC, (v) => (v && v.entries && typeof v.entries === 'object' ? v : { entries: {} }));
  const streams = new Map();   // uid -> Set<res>
  const listeners = new Set(); // (uids|'*', meta) => void, for tests and the console

  // ── documents ────────────────────────────────────────────────────────────

  async function readRegistry(uid) {
    assertSafeUid(uid);
    const doc = await store.readJSON(REGISTRY_DOC(uid));
    return doc && doc.adapters && typeof doc.adapters === 'object' ? doc : { adapters: {} };
  }
  async function readInstalls(uid) {
    const doc = await store.readJSON(INSTALLS_DOC(uid));
    return doc && doc.apps && typeof doc.apps === 'object' ? doc : { apps: {} };
  }
  async function readStatus(uid) {
    const doc = await store.readJSON(STATUS_DOC(uid));
    return {
      instances: doc?.instances && typeof doc.instances === 'object' ? doc.instances : {},
      results: doc?.results && typeof doc.results === 'object' ? doc.results : {},
    };
  }

  function summary(owner, rec) {
    return {
      adapter: { owner, appId: rec.appId, id: rec.id },
      name: rec.name, description: rec.description, appName: rec.appName, owner,
      shared: rec.shared === true, revision: rec.revision, version: rec.version,
      supportAreas: rec.supportAreas || [], urlPatterns: rec.urlPatterns || [],
      portable: !!rec.format, format: rec.format || null,
      createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    };
  }

  /** The record behind a key the caller may see: their own, or a shared one. */
  async function visible(caller, key) {
    const owner = key.owner || caller;
    let reg;
    try { reg = await readRegistry(owner); } catch { throw new ToolError('not-found', 'No such adapter.'); }
    const rec = reg.adapters[`${key.appId}/${key.id}`];
    if (!rec || (owner !== caller && !rec.shared)) {
      throw new ToolError('not-found', owner === caller
        ? `You have no adapter ${key.appId}/${key.id}.`
        : `${owner}/${key.appId}/${key.id} does not exist or is not shared.`);
    }
    return { owner, rec };
  }

  function ownOnly(caller, key, verb) {
    if (key.owner && key.owner !== caller) throw new ToolError('forbidden', `Only ${key.owner} can ${verb} ${key.owner}/${key.appId}/${key.id}.`);
  }

  // Keep the instance-wide index in step with one adapter's record.
  async function syncSharedIndex(owner, rec, appId, id) {
    const key = `${owner}/${appId}/${id}`;
    await shared.mutate((doc) => {
      if (rec && rec.shared) doc.entries[key] = summary(owner, rec);
      else if (doc.entries[key]) delete doc.entries[key];
      else return { save: false };
      return { save: true };
    });
  }

  // ── tools ────────────────────────────────────────────────────────────────

  async function search(caller, args) {
    const scope = args.scope || 'all';
    const [mine, index, installs] = await Promise.all([readRegistry(caller), shared.read(), readInstalls(caller)]);
    const installedIn = new Map();
    for (const [app, entries] of Object.entries(installs.apps)) {
      for (const key of Object.keys(entries)) installedIn.set(key, [...(installedIn.get(key) || []), app]);
    }
    let list = [];
    if (scope !== 'shared') list.push(...Object.values(mine.adapters).map(rec => summary(caller, rec)));
    if (scope !== 'mine') {
      list.push(...Object.values(index.entries).filter(e => scope === 'shared' || e.owner !== caller));
    }
    const q = (args.query || '').trim().toLowerCase();
    list = list.filter(s => (!args.appId || s.adapter.appId === args.appId)
      && (!q || `${s.name} ${s.description} ${s.appName} ${s.adapter.id} ${s.owner}`.toLowerCase().includes(q))
      && (!args.supportArea || (s.supportAreas || []).includes(args.supportArea))
      && (args.portable === undefined || s.portable === args.portable)
      && (!args.url || (s.urlPatterns || []).some(p => matchUrlPattern(p, args.url))));
    const adapters = list
      .map(s => ({ ...s, mine: s.owner === caller, installedIn: installedIn.get(keyString(s.adapter)) || [] }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { adapters, count: adapters.length };
  }

  async function revisionDoc(owner, rec, rev) {
    if (!rec.revisions.some(r => r.revision === rev)) throw new ToolError('revision-gone', `Revision ${rev} of ${owner}/${rec.appId}/${rec.id} is not kept any more (the latest is ${rec.revision}).`);
    const doc = await store.readJSON(REVISION_DOC(owner, rec.appId, rec.id, rev));
    if (!doc?.descriptor) throw new ToolError('revision-gone', `Revision ${rev} of ${owner}/${rec.appId}/${rec.id} could not be read.`);
    return doc;
  }

  async function get(caller, args) {
    const { owner, rec } = await visible(caller, args.adapter);
    const rev = args.revision ?? rec.revision;
    const doc = await revisionDoc(owner, rec, rev);
    const pkg = doc.package;
    return {
      ...summary(owner, rec), mine: owner === caller,
      revision: rev, latestRevision: rec.revision, revisions: rec.revisions,
      descriptor: doc.descriptor,
      package: pkg ? (args.includeCode === false ? { format: pkg.format, entry: pkg.entry, size: pkg.code.length } : pkg) : null,
      artifactDigest: doc.artifactDigest || null,
      publishedAt: doc.publishedAt,
    };
  }

  async function publish(caller, args) {
    const { descriptorDigest: _d, executionArtifactDigest: _e, ...given } = args.descriptor || {};
    // A short descriptor (no adapterProtocol) names the adapter, its pages
    // and who it is for; the rest takes defineDescriptor's defaults: an
    // on/off web adapter with no settings, version 1.0.0.
    const descriptor = given.adapterProtocol ? given : defineDescriptor({ version: '1.0.0', ...given });
    const errors = checkDescriptor(descriptor);
    const pkg = args.package;
    if (pkg) errors.push(...checkPackage(pkg, descriptor));
    if (errors.length) {
      throw new ToolError('invalid-adapter', `The adapter does not follow Adapter MCP ${PROFILE_VERSION}: ${formatErrors(errors, 4)}`, { errors: errors.slice(0, 50) });
    }
    const artifact = pkg ? await artifactDigest(pkg.code) : null;
    const digest = await descriptorDigest(descriptor, artifact);
    const stored = { ...descriptor, ...(artifact ? { executionArtifactDigest: artifact } : {}), descriptorDigest: digest };
    const { appId, id } = descriptor;
    const key = `${appId}/${id}`;
    const at = now().toISOString();

    const outcome = await withUserLock(caller, async () => {
      const reg = await readRegistry(caller);
      const existing = reg.adapters[key];
      if (!existing && Object.keys(reg.adapters).length >= MAX_ADAPTERS) {
        throw new ToolError('too-many-adapters', `An account keeps at most ${MAX_ADAPTERS} adapters; delete one first.`);
      }
      const sharedBefore = existing?.shared === true;
      const sharedNow = args.shared ?? sharedBefore;
      const latest = existing?.revisions.at(-1);
      // Publishing the same thing again (an app does this on every start) is
      // not a new revision.
      if (existing && latest?.descriptorDigest === digest && (latest.packageEntry ?? null) === (pkg?.entry ?? null)) {
        if (sharedNow !== sharedBefore) {
          existing.shared = sharedNow;
          existing.sharedAt = sharedNow ? at : null;
          existing.updatedAt = at;
          await store.writeJSON(REGISTRY_DOC(caller), reg);
          await syncSharedIndex(caller, existing, appId, id);
        }
        return { rec: existing, unchanged: true, sharedBefore };
      }
      const rev = (existing?.revision || 0) + 1;
      await store.writeJSON(REVISION_DOC(caller, appId, id, rev), {
        descriptor: stored, package: pkg ? { format: pkg.format, code: pkg.code, ...(pkg.entry ? { entry: pkg.entry } : {}) } : null,
        artifactDigest: artifact, publishedAt: at,
      });
      const revisions = [...(existing?.revisions || []), {
        revision: rev, version: descriptor.version, descriptorDigest: digest, artifactDigest: artifact,
        size: pkg ? pkg.code.length : 0, publishedAt: at, ...(pkg?.entry ? { packageEntry: pkg.entry } : {}),
      }];
      const dropped = revisions.splice(0, Math.max(0, revisions.length - KEEP_REVISIONS));
      const appName = (typeof args.appName === 'string' && args.appName.trim()) ? args.appName.trim().slice(0, 120) : (existing?.appName || appId);
      const rec = {
        appId, id, appName, name: descriptor.name, description: descriptor.description || '',
        version: descriptor.version, supportAreas: descriptor.supportAreas || [],
        urlPatterns: webUrlPatterns(descriptor.targets), format: pkg ? pkg.format : null,
        shared: sharedNow, sharedAt: sharedNow ? (existing?.shared ? existing.sharedAt : at) : null,
        revision: rev, revisions, createdAt: existing?.createdAt || at, updatedAt: at,
      };
      reg.adapters[key] = rec;
      await store.writeJSON(REGISTRY_DOC(caller), reg);
      for (const r of dropped) await store.writeJSON(REVISION_DOC(caller, appId, id, r.revision), null);
      if (sharedNow || sharedBefore) await syncSharedIndex(caller, rec, appId, id);
      return { rec, unchanged: false, sharedBefore };
    });
    const { rec } = outcome;
    notify(rec.shared || outcome.sharedBefore ? '*' : [caller], { reason: 'published', adapter: `${caller}/${key}` });
    return {
      adapter: { owner: caller, appId, id }, revision: rec.revision, unchanged: outcome.unchanged,
      shared: rec.shared, descriptorDigest: rec.revisions.at(-1).descriptorDigest, artifactDigest: rec.revisions.at(-1).artifactDigest,
    };
  }

  async function share(caller, args) {
    ownOnly(caller, args.adapter, 'share');
    const { appId, id } = args.adapter;
    const rec = await withUserLock(caller, async () => {
      const reg = await readRegistry(caller);
      const r = reg.adapters[`${appId}/${id}`];
      if (!r) throw new ToolError('not-found', `You have no adapter ${appId}/${id}.`);
      if (r.shared !== args.shared) {
        r.shared = args.shared;
        r.sharedAt = args.shared ? now().toISOString() : null;
        await store.writeJSON(REGISTRY_DOC(caller), reg);
      }
      await syncSharedIndex(caller, r, appId, id);
      return r;
    });
    notify('*', { reason: args.shared ? 'shared' : 'unshared', adapter: `${caller}/${appId}/${id}` });
    return { adapter: { owner: caller, appId, id }, shared: rec.shared };
  }

  async function remove(caller, args) {
    ownOnly(caller, args.adapter, 'delete');
    const { appId, id } = args.adapter;
    const full = `${caller}/${appId}/${id}`;
    const wasShared = await withUserLock(caller, async () => {
      const reg = await readRegistry(caller);
      const r = reg.adapters[`${appId}/${id}`];
      if (!r) throw new ToolError('not-found', `You have no adapter ${appId}/${id}.`);
      delete reg.adapters[`${appId}/${id}`];
      await store.writeJSON(REGISTRY_DOC(caller), reg);
      for (const x of r.revisions) await store.writeJSON(REVISION_DOC(caller, appId, id, x.revision), null);
      if (r.shared) await syncSharedIndex(caller, null, appId, id);
      // The account's own apps stop installing it; other accounts' installs
      // now resolve as unavailable.
      const installs = await readInstalls(caller);
      let changed = false;
      for (const entries of Object.values(installs.apps)) if (entries[full]) { delete entries[full]; changed = true; }
      if (changed) await store.writeJSON(INSTALLS_DOC(caller), installs);
      return r.shared;
    });
    notify(wasShared ? '*' : [caller], { reason: 'deleted', adapter: full });
    return { adapter: { owner: caller, appId, id }, deleted: true };
  }

  async function install(caller, args) {
    const { owner, rec } = await visible(caller, args.adapter);
    const full = `${owner}/${rec.appId}/${rec.id}`;
    const installs0 = await readInstalls(caller);
    const before = installs0.apps[args.app]?.[full];
    // Your own adapters follow your edits; someone else's stay on the revision
    // you installed until you choose to update.
    const revision = args.revision ?? before?.revision ?? (owner === caller ? 'latest' : rec.revision);
    if (revision !== 'latest' && !rec.revisions.some(r => r.revision === revision)) {
      throw new ToolError('revision-gone', `Revision ${revision} of ${full} is not kept (the latest is ${rec.revision}).`);
    }
    if (args.sites) {
      for (const origin of Object.keys(args.sites)) if (!isOrigin(origin)) throw new ToolError('invalid-site', `"${origin}" is not an origin such as https://example.com.`);
    }
    if (args.parameters !== undefined) {
      const doc = await revisionDoc(owner, rec, revision === 'latest' ? rec.revision : revision);
      const errs = validate(doc.descriptor.inputSchema || { type: 'object' }, args.parameters, '/parameters');
      if (errs.length) throw new ToolError('invalid-parameters', `The parameters do not fit the adapter's inputSchema: ${formatErrors(errs, 3)}`);
    }
    const entry = await withUserLock(caller, async () => {
      const installs = await readInstalls(caller);
      const entries = installs.apps[args.app] || (installs.apps[args.app] = {});
      const prev = entries[full];
      if (!prev && Object.keys(entries).length >= MAX_INSTALLS) throw new ToolError('too-many-installs', `An app installs at most ${MAX_INSTALLS} adapters.`);
      const at = now().toISOString();
      // A site is on unless switched off, so only the offs are kept.
      const sites = { ...(prev?.sites || {}) };
      for (const [origin, on] of Object.entries(args.sites || {})) { if (on) delete sites[origin]; else sites[origin] = false; }
      const next = {
        revision, enabled: args.enabled ?? prev?.enabled ?? true, sites,
        ...(args.parameters !== undefined ? { parameters: args.parameters } : prev?.parameters ? { parameters: prev.parameters } : {}),
        installedAt: prev?.installedAt || at, updatedAt: at,
      };
      entries[full] = next;
      await store.writeJSON(INSTALLS_DOC(caller), installs);
      return next;
    });
    notify([caller], { reason: 'installed', app: args.app, adapter: full });
    return { app: args.app, adapter: { owner, appId: rec.appId, id: rec.id }, install: entry };
  }

  async function uninstall(caller, args) {
    const owner = args.adapter.owner || caller;
    const full = `${owner}/${args.adapter.appId}/${args.adapter.id}`;
    const removed = await withUserLock(caller, async () => {
      const installs = await readInstalls(caller);
      const entries = installs.apps[args.app];
      if (!entries?.[full]) return false;
      delete entries[full];
      if (!Object.keys(entries).length) delete installs.apps[args.app];
      await store.writeJSON(INSTALLS_DOC(caller), installs);
      return true;
    });
    if (!removed) throw new ToolError('not-installed', `${args.app} has not installed ${full}.`);
    notify([caller], { reason: 'uninstalled', app: args.app, adapter: full });
    return { app: args.app, adapter: { owner, appId: args.adapter.appId, id: args.adapter.id }, uninstalled: true };
  }

  async function installed(caller, args) {
    const entries = (await readInstalls(caller)).apps[args.app] || {};
    const registries = new Map();
    const adapters = [];
    for (const [full, inst] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      const key = parseKey(full);
      if (!key) continue;
      const base = { adapter: key, enabled: inst.enabled !== false, sites: inst.sites || {}, follows: inst.revision === 'latest', ...(inst.parameters ? { parameters: inst.parameters } : {}) };
      if (!registries.has(key.owner)) registries.set(key.owner, await readRegistry(key.owner).catch(() => ({ adapters: {} })));
      const rec = registries.get(key.owner).adapters[`${key.appId}/${key.id}`];
      if (!rec || (key.owner !== caller && !rec.shared)) {
        adapters.push({ ...base, available: false, reason: rec ? 'not-shared' : 'deleted' });
        continue;
      }
      const rev = inst.revision === 'latest' ? rec.revision : inst.revision;
      let doc;
      try { doc = await revisionDoc(key.owner, rec, rev); } catch (e) {
        adapters.push({ ...base, name: rec.name, available: false, reason: e.code || 'revision-gone' });
        continue;
      }
      adapters.push({
        ...base, available: true, name: rec.name, appName: rec.appName, owner: key.owner, mine: key.owner === caller,
        revision: rev, latestRevision: rec.revision, updateAvailable: inst.revision !== 'latest' && rec.revision > rev,
        urlPatterns: webUrlPatterns(doc.descriptor.targets), descriptorDigest: doc.descriptor.descriptorDigest,
        artifactDigest: doc.artifactDigest || null, format: doc.package?.format || null,
        descriptor: doc.descriptor,
        ...(args.includeCode && doc.package ? { package: doc.package } : {}),
      });
    }
    const etag = `W/"${crypto.createHash('sha256').update(JSON.stringify(adapters.map(({ package: _p, ...a }) => a))).digest('hex').slice(0, 32)}"`;
    if (args.ifEtag && args.ifEtag === etag) return { app: args.app, etag, unchanged: true };
    return { app: args.app, etag, adapters };
  }

  async function report(caller, args) {
    const at = now();
    const stored = await withUserLock(caller, async () => {
      const doc = await readStatus(caller);
      doc.instances[args.instanceId] = { app: args.app, label: (args.label || '').slice(0, 120), lastSeenAt: at.toISOString() };
      for (const r of args.results) {
        const adapter = { owner: r.adapter.owner || caller, appId: r.adapter.appId, id: r.adapter.id };
        const slot = `${args.instanceId}|${keyString(adapter)}|${r.origin || ''}`;
        if (r.status === 'removed') { delete doc.results[slot]; continue; }
        doc.results[slot] = {
          app: args.app, instanceId: args.instanceId, adapter, revision: r.revision ?? null,
          origin: r.origin || '', status: r.status, message: (r.message || '').slice(0, 500),
          at: r.at && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : at.toISOString(),
        };
      }
      // Forget runtimes not seen for a week, and keep the newest reports.
      for (const [id, inst] of Object.entries(doc.instances)) {
        if (at - Date.parse(inst.lastSeenAt) > INSTANCE_TTL_MS) {
          delete doc.instances[id];
          for (const slot of Object.keys(doc.results)) if (slot.startsWith(`${id}|`)) delete doc.results[slot];
        }
      }
      const slots = Object.entries(doc.results).sort(([, a], [, b]) => b.at.localeCompare(a.at));
      for (const [slot] of slots.slice(MAX_RESULTS)) delete doc.results[slot];
      await store.writeJSON(STATUS_DOC(caller), doc);
      return Object.keys(doc.results).length;
    });
    notify([caller], { reason: 'status', app: args.app });
    return { ok: true, stored };
  }

  async function status(caller, args) {
    const doc = await readStatus(caller);
    const wanted = args.adapter ? keyString({ owner: args.adapter.owner || caller, ...args.adapter }) : null;
    const results = Object.values(doc.results)
      .filter(r => (!args.app || r.app === args.app) && (!wanted || keyString(r.adapter) === wanted))
      .map(r => ({ ...r, label: doc.instances[r.instanceId]?.label || '' }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const instances = Object.entries(doc.instances)
      .filter(([, i]) => !args.app || i.app === args.app)
      .map(([instanceId, i]) => ({ instanceId, ...i }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return { instances, results };
  }

  const TOOLS = {
    adapter_search: search, adapter_get: get, adapter_publish: publish, adapter_share: share,
    adapter_delete: remove, adapter_install: install, adapter_uninstall: uninstall,
    adapter_installed: installed, adapter_report: report, adapter_status: status,
  };

  /** The in-process binding: the same checks as tools/call, for the console's server code and tests. */
  async function call(caller, name, args = {}) {
    const run = TOOLS[name];
    if (!run) throw new ToolError('unknown-tool', `There is no tool ${name}.`);
    const errs = validate(REGISTRY_TOOL_SCHEMAS[name], args ?? {}, '');
    if (errs.length) throw new ToolError('invalid-arguments', `The arguments do not fit ${name}: ${formatErrors(errs, 3)}`, { errors: errs.slice(0, 20) });
    return run(caller, args ?? {});
  }

  // ── notifications ────────────────────────────────────────────────────────

  function notify(target, meta) {
    const message = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: { _meta: { 'ai4a11y/registry': meta } } });
    const sets = target === '*' ? [...streams.values()] : target.map(uid => streams.get(uid)).filter(Boolean);
    for (const set of sets) for (const res of set) res.write(`event: message\ndata: ${message}\n\n`);
    for (const fn of listeners) { try { fn(target, meta); } catch { /* a listener never breaks a write */ } }
  }

  function openStream(req, res, rec) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    if (!streams.has(rec.uid)) streams.set(rec.uid, new Set());
    streams.get(rec.uid).add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    beat.unref?.();
    res.on('close', () => {
      clearInterval(beat);
      const set = streams.get(rec.uid);
      set?.delete(res);
      if (set && !set.size) streams.delete(rec.uid);
    });
  }

  // ── MCP over HTTP ────────────────────────────────────────────────────────

  function toolResult(result) {
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
  }
  function toolError(e) {
    const result = { error: e.code, message: e.message, ...e.extra };
    return { content: [{ type: 'text', text: e.message }], structuredContent: result, isError: true };
  }

  async function rpc(rec, message) {
    const ok = (result) => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code, msg) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: msg } });
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    switch (message.method) {
      case 'initialize':
        return ok({
          protocolVersion: COMPATIBLE_MCP.includes(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: true } },
          serverInfo: { name: 'ai4a11y-toolkit-registry', title: 'AI for Accessibility toolkit: adapter registry', version },
          instructions: 'Share accessibility adapters between apps: publish yours, search what others shared, install into an app, and read what an app has installed. Adapters are private to your account until you share them.',
        });
      case 'ping': return ok({});
      case 'tools/list':
        return ok({ tools: REGISTRY_TOOLS.map(name => ({
          name, description: REGISTRY_TOOL_DESCRIPTIONS[name], inputSchema: REGISTRY_TOOL_SCHEMAS[name],
          annotations: { readOnlyHint: REGISTRY_READ_ONLY.includes(name), destructiveHint: name === 'adapter_delete' },
        })) });
      case 'tools/call': {
        if (typeof params.name !== 'string' || !TOOLS[params.name]) return fail(-32602, `Unknown tool: ${params.name}`);
        const started = Date.now();
        try {
          const result = await call(rec.uid, params.name, params.arguments ?? {});
          log.info('registry.call', { uid: rec.uid, tool: params.name, outcome: 'ok', ms: Date.now() - started });
          return ok(toolResult(result));
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          log.info('registry.call', { uid: rec.uid, tool: params.name, outcome: e.code, ms: Date.now() - started });
          return ok(toolError(e));
        }
      }
      case 'resources/list': {
        const { adapters } = await search(rec.uid, {});
        return ok({ resources: adapters.map(a => ({
          uri: `adapter://${keyString(a.adapter)}`, name: `${a.adapter.appId}/${a.adapter.id}`, title: a.name,
          description: a.description, mimeType: 'application/json',
        })) });
      }
      case 'resources/read': {
        const key = typeof params.uri === 'string' && params.uri.startsWith('adapter://') ? parseKey(params.uri.slice('adapter://'.length)) : null;
        if (!key || !SLUG.test(key.appId) || !SLUG.test(key.id)) return fail(-32602, 'Read adapter://<owner>/<appId>/<id>.');
        try {
          const result = await get(rec.uid, { adapter: key });
          return ok({ contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(result) }] });
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          return { jsonrpc: '2.0', id: message.id, error: { code: -32002, message: e.message } };
        }
      }
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  }

  async function handle(req, res, method) {
    const rec = await authenticate(req);
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized', message: 'Send a toolkit token: Authorization: Bearer aat_…' });
    if (method === 'GET') {
      if (!String(req.headers.accept || '').includes('text/event-stream')) {
        throw new HttpError(406, 'not-acceptable', 'GET opens the notification stream; send Accept: text/event-stream.');
      }
      return openStream(req, res, rec);
    }
    if (method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      throw new HttpError(405, 'method-not-allowed', 'This MCP endpoint takes POST, and GET for notifications.');
    }
    const message = await readJSON(req, { maxBytes: 2e6 });
    if (Array.isArray(message)) return sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON-RPC batches are not supported.' } });
    if (!message || message.jsonrpc !== '2.0') return sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    if (typeof message.method !== 'string' || !Object.hasOwn(message, 'id')) { res.writeHead(202); return res.end(); }
    return sendJSON(res, 200, await rpc(rec, message));
  }

  /** An account is being deleted: close its streams and take its adapters out of the shared index. */
  async function dropUser(uid) {
    for (const res of streams.get(uid) || []) res.end();
    streams.delete(uid);
    let removed = 0;
    await shared.mutate((doc) => {
      removed = 0;
      for (const [key, entry] of Object.entries(doc.entries)) if (entry.owner === uid) { delete doc.entries[key]; removed++; }
      return { save: removed > 0 };
    });
    if (removed) notify('*', { reason: 'deleted', owner: uid });
  }

  return {
    handle, call, dropUser,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    closeAll() { for (const set of streams.values()) for (const res of set) res.end(); streams.clear(); },
  };
}

export { ToolError as RegistryError };
