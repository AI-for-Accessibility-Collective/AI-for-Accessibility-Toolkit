// The adapter marketplace — CONTRACT.md's "Adapter marketplace" section.
//
// A registry where a host application (the browser extension, the XR app, any
// future host) publishes the adapters it offers, so a developer interface or
// another host can discover them grouped by app. Two kinds of entry:
//
//   kind 'data' — a manifest only: id, name, description, the settings keys it
//     applies, support areas, links. The code stays in the app's own repo.
//   kind 'code' — a manifest PLUS a JavaScript source blob stored alongside,
//     for hosts that run third-party adapter code (the extension installs
//     these as Chrome user scripts, after linting them itself — the server
//     never runs or vouches for code, it stores and serves bytes).
//
// Storage: one shared document `adapters/catalog.json` (every mutation is a
// conditional write with retry, the same pattern as admin/tokens.json, because
// every token holder on the instance can write it), one code document per
// code entry at `adapters/code/<appId>/<id>.json`, and one per-user document
// `users/<uid>/adapters.json` holding that user's install state — the global
// marketplace plus the person's own view of it. Deleting a user (admin) wipes
// the partition, so their install state and registrations' per-user half go
// with it; catalog entries they registered stay (a marketplace listing outlives
// the session that posted it) and remain editable by admin.
//
// Authorization: every route needs a user bearer token; writes to an entry
// (update/delete/sync-over) need the token whose uid registered it, or the
// admin password (moderation). Registration itself is open to any valid token
// — that is the marketplace's point.

import crypto from 'node:crypto';
import { verifyToken, verifyAdminHeader } from './auth.js';
import { assertSafeUid } from './store.js';
import { checkDescriptor, descriptorDigest } from '../../toolkit/protocol/adapter/index.js';

const CATALOG_DOC = 'adapters/catalog.json';
const CODE_DOC = (appId, id) => `adapters/code/${appId}/${id}.json`;
const USER_DOC = 'users/%UID%/adapters.json';

// App ids and adapter ids are path segments and document-name fragments, so
// each is one safe slug: lowercase, no separators, no '..'.
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SUPPORT_AREAS = new Set(['vision', 'motor', 'hearing', 'cognitive', 'sensory', 'reading']);
const MAX_CODE_CHARS = 256_000;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
const MAX_SETTINGS_KEYS = 100;
const MAX_DESCRIPTOR_CHARS = 64_000;

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── catalog document mutations ──────────────────────────────────────────────
// Same two-layer protection as auth.js's token document: an in-process queue
// (the per-uid lock in app.js does not cover this shared document), and across
// processes a conditional write that reloads and retries on conflict.
let catalogQueue = Promise.resolve();
function withCatalogLock(fn) {
  const run = catalogQueue.then(fn, fn);
  catalogQueue = run.catch(() => {});
  return run;
}

const MAX_ATTEMPTS = 5;

function emptyCatalog() {
  return { version: 1, apps: {}, entries: {} };
}

/** Run `change(catalog)` against the current document and save it. `change`
 *  returns `{ save, result }`; `save` false skips the write. */
function mutateCatalog(store, change) {
  const conditional = typeof store.readDoc === 'function' && typeof store.writeJSONIf === 'function';
  return withCatalogLock(async () => {
    if (!conditional) {
      const catalog = (await store.readJSON(CATALOG_DOC)) || emptyCatalog();
      const { save, result } = change(catalog);
      if (save) await store.writeJSON(CATALOG_DOC, catalog);
      return result;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const doc = await store.readDoc(CATALOG_DOC);
        const catalog = doc.value && doc.value.entries ? doc.value : emptyCatalog();
        const { save, result } = change(catalog);
        if (save) await store.writeJSONIf(CATALOG_DOC, catalog, doc.version);
        return result;
      } catch (e) {
        if (e?.code !== 'CONFLICT' || attempt >= MAX_ATTEMPTS) throw e;
      }
    }
  });
}

// ── validation ──────────────────────────────────────────────────────────────

function requireSlug(value, what) {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    throw new ClientError(400, `${what} must match ${SLUG} (lowercase letters, digits, dot, dash, underscore)`);
  }
  return value;
}

function optionalString(value, what, max) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new ClientError(400, `${what} must be a string.`);
  if (value.length > max) throw new ClientError(400, `${what} must be at most ${max} characters.`);
  return value.trim();
}

function optionalUrl(value, what) {
  const s = optionalString(value, what, 500);
  if (!s) return '';
  let url;
  try { url = new URL(s); } catch { throw new ClientError(400, `${what} must be a valid URL.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ClientError(400, `${what} must be an HTTP(S) URL.`);
  return url.href;
}

/** Validate one adapter manifest from a register/update/sync body. Returns the
 *  storable field set (without identity/ownership/timestamps, which callers
 *  add). `code` is handled separately: present-and-string means "set the code
 *  to this" (empty string removes it); absent means "leave as is". */
function validateManifest(body, { appId, id } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ClientError(400, 'Adapter must be a JSON object.');
  const resolvedAppId = appId ?? body.appId;
  // 'sync' is a route segment (POST /v1/adapters/sync), so it can never be an
  // app id — reject it here rather than shadow the route with an unreachable
  // listing.
  if (resolvedAppId === 'sync') throw new ClientError(400, 'appId "sync" is reserved.');
  const out = {
    appId: requireSlug(resolvedAppId, 'appId'),
    id: requireSlug(id ?? body.id, 'id'),
    name: (() => {
      const n = optionalString(body.name, 'name', MAX_NAME);
      if (!n) throw new ClientError(400, 'name is required.');
      return n;
    })(),
    description: optionalString(body.description, 'description', MAX_DESCRIPTION),
    version: optionalString(body.version, 'version', 32),
    sourceUrl: optionalUrl(body.sourceUrl, 'sourceUrl'),
    docsUrl: optionalUrl(body.docsUrl, 'docsUrl'),
    requiresAI: body.requiresAI === true,
  };
  if (body.settingsKeys != null) {
    if (!Array.isArray(body.settingsKeys) || body.settingsKeys.length > MAX_SETTINGS_KEYS
      || body.settingsKeys.some(k => typeof k !== 'string' || !k.trim() || k.length > 100)) {
      throw new ClientError(400, `settingsKeys must be an array of up to ${MAX_SETTINGS_KEYS} non-empty strings.`);
    }
    out.settingsKeys = body.settingsKeys.map(k => k.trim());
  } else out.settingsKeys = [];
  if (body.supportAreas != null) {
    if (!Array.isArray(body.supportAreas) || body.supportAreas.some(a => !SUPPORT_AREAS.has(a))) {
      throw new ClientError(400, `supportAreas must be an array of: ${[...SUPPORT_AREAS].join(', ')}.`);
    }
    out.supportAreas = [...new Set(body.supportAreas)];
  } else out.supportAreas = [];
  // An optional Adapter MCP descriptor (docs/design/adapter-mcp.md §10.5). A
  // listing without one stays discoverable and is shown as a legacy,
  // metadata-only listing. A present one must be valid and must describe
  // this very listing; its digest is computed here, not trusted.
  if (body.descriptor != null) {
    const d = body.descriptor;
    if (typeof d !== 'object' || Array.isArray(d)) throw new ClientError(400, 'descriptor must be an object.');
    if (JSON.stringify(d).length > MAX_DESCRIPTOR_CHARS) throw new ClientError(400, `descriptor must be at most ${MAX_DESCRIPTOR_CHARS} characters of JSON.`);
    const errs = checkDescriptor(d);
    if (d.appId !== out.appId || d.id !== out.id) errs.push({ path: '/appId', message: `must describe ${out.appId}/${out.id}` });
    if (errs.length) throw new ClientError(400, `descriptor is not a valid Adapter MCP descriptor: ${errs.slice(0, 3).map(e => `${e.path} ${e.message}`).join('; ')}`);
    const { descriptorDigest: _claimed, ...clean } = d;
    out.descriptor = clean;
  }
  if (body.code != null && typeof body.code !== 'string') throw new ClientError(400, 'code must be a string.');
  if (typeof body.code === 'string' && body.code.length > MAX_CODE_CHARS) {
    throw new ClientError(400, `code must be at most ${MAX_CODE_CHARS} characters.`);
  }
  return out;
}

/** Store the descriptor with the digest this service computed. */
async function withDescriptorDigest(m) {
  if (!m.descriptor) return m;
  const digest = await descriptorDigest(m.descriptor, m.descriptor.executionArtifactDigest ?? null);
  return { ...m, descriptor: { ...m.descriptor, descriptorDigest: digest } };
}

function codeMeta(code) {
  return {
    kind: 'code',
    codeSize: code.length,
    codeSha256: crypto.createHash('sha256').update(code, 'utf8').digest('hex'),
  };
}

// Public shape: the stored entry minus nothing (registeredBy is an admin-chosen
// uid, not a secret — a marketplace listing names its publisher).
const publicEntry = (entry) => ({ ...entry });

// ── router ──────────────────────────────────────────────────────────────────

function bearerFrom(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

/**
 * @param {Object} config
 * @param {import('./store.js').fileStore} config.store
 * @param {string} config.adminPassword
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} config.withUserLock
 * @returns {(req, res, method: string, pathname: string, url: URL) => Promise<void>}
 */
export function createAdaptersRouter({ store, adminPassword, withUserLock }) {
  return async function handleAdapters(req, res, method, pathname, url) {
    // Auth: a user token for everything; the admin password additionally lets
    // an operator moderate (update/delete anything).
    const header = req.headers['authorization'];
    const isAdmin = verifyAdminHeader(adminPassword, header);
    const rec = !isAdmin && bearerFrom(req) ? await verifyToken(store, bearerFrom(req)) : null;
    if (!rec && !isAdmin) return sendJSON(res, 401, { error: 'unauthorized' });
    // For the request log: who, never the token.
    if (rec) req.auth = { uid: rec.uid, kind: rec.kind, tokenId: rec.id };

    let segments;
    try {
      segments = decodeSegments(pathname);
      if (segments.length === 0) {
        if (method === 'GET') return await listAdapters(req, res, url, rec);
        if (method === 'POST') return await registerAdapter(req, res, rec);
        return methodNotAllowed(res);
      }
      if (segments[0] === 'sync' && segments.length === 1) {
        if (method === 'POST') return await syncCatalog(req, res, rec);
        return methodNotAllowed(res);
      }
      if (segments.length === 2) {
        const [appId, id] = segments;
        if (method === 'GET') return await getAdapter(res, appId, id);
        if (method === 'PUT') return await updateAdapter(req, res, appId, id, rec, isAdmin);
        if (method === 'DELETE') return await deleteAdapter(res, appId, id, rec, isAdmin);
        return methodNotAllowed(res);
      }
      if (segments.length === 3 && segments[2] === 'code' && method === 'GET') {
        return await getAdapterCode(res, segments[0], segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'install' && rec) {
        if (method === 'PUT') return await setInstalled(req, res, rec, segments[0], segments[1], true);
        if (method === 'DELETE') return await setInstalled(req, res, rec, segments[0], segments[1], false);
        return methodNotAllowed(res);
      }
      return sendJSON(res, 404, { error: 'not-found' });
    } catch (e) {
      if (e instanceof ClientError) return sendJSON(res, e.status, { error: e.message });
      throw e;
    }
  };

  // ── routes ────────────────────────────────────────────────────────────────

  async function listAdapters(req, res, url, rec) {
    const catalog = (await store.readJSON(CATALOG_DOC)) || emptyCatalog();
    const installed = rec ? await readUserState(rec.uid) : { installed: {} };
    const appFilter = url.searchParams.get('app');
    const kindFilter = url.searchParams.get('kind');
    const mine = url.searchParams.get('mine') === '1';
    const justInstalled = url.searchParams.get('installed') === '1';
    const entries = Object.values(catalog.entries)
      .filter(e => !appFilter || e.appId === appFilter)
      .filter(e => !kindFilter || e.kind === kindFilter)
      .map(e => ({ ...publicEntry(e), mine: !!rec && e.registeredBy === rec.uid, installed: !!installed.installed[`${e.appId}/${e.id}`] }))
      .filter(e => (!mine || e.mine) && (!justInstalled || e.installed))
      .sort((a, b) => a.appId.localeCompare(b.appId) || a.id.localeCompare(b.id));
    const counts = new Map();
    for (const e of entries) counts.set(e.appId, (counts.get(e.appId) || 0) + 1);
    const apps = [...counts.entries()].map(([appId, count]) => ({
      appId,
      name: catalog.apps[appId]?.name || appId,
      count,
    }));
    return sendJSON(res, 200, { adapters: entries, apps });
  }

  async function registerAdapter(req, res, rec) {
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized', message: 'Registering an adapter needs a user token.' });
    const body = await readBody(req);
    const m = await withDescriptorDigest(validateManifest(body));
    const key = `${m.appId}/${m.id}`;
    const now = new Date().toISOString();
    const created = await mutateCatalog(store, (catalog) => {
      if (catalog.entries[key]) return { save: false, result: null };
      const entry = {
        ...m,
        kind: 'data', codeSize: 0, codeSha256: '',
        registeredBy: rec.uid, registeredByLabel: rec.label || '',
        createdAt: now, updatedAt: now,
      };
      catalog.entries[key] = entry;
      touchApp(catalog, body.appName, m.appId, now);
      return { save: true, result: entry };
    });
    if (!created) return sendJSON(res, 409, { error: `adapter ${key} already exists — update it with PUT` });
    if (typeof body.code === 'string' && body.code) await attachCode(created, body.code);
    return sendJSON(res, 201, { adapter: publicEntry(created) });
  }

  async function getAdapter(res, appId, id) {
    const catalog = (await store.readJSON(CATALOG_DOC)) || emptyCatalog();
    const entry = catalog.entries[`${appId}/${id}`];
    if (!entry) return sendJSON(res, 404, { error: 'not-found' });
    return sendJSON(res, 200, { adapter: publicEntry(entry) });
  }

  async function updateAdapter(req, res, appId, id, rec, isAdmin) {
    const body = await readBody(req);
    const validated = await withDescriptorDigest(validateManifest(body, { appId, id }));
    const now = new Date().toISOString();
    const outcome = await mutateCatalog(store, (catalog) => {
      const key = `${appId}/${id}`;
      const entry = catalog.entries[key];
      if (!entry) return { save: false, result: { missing: true } };
      if (!isAdmin && entry.registeredBy !== rec?.uid) {
        return { save: false, result: { forbidden: true } };
      }
      const m = validated;
      Object.assign(entry, {
        name: m.name, description: m.description, version: m.version,
        settingsKeys: m.settingsKeys, supportAreas: m.supportAreas,
        requiresAI: m.requiresAI, sourceUrl: m.sourceUrl, docsUrl: m.docsUrl,
        updatedAt: now,
      });
      if (m.descriptor) entry.descriptor = m.descriptor; else delete entry.descriptor;
      touchApp(catalog, body.appName, appId, now);
      return { save: true, result: { entry, code: typeof body.code === 'string' ? body.code : undefined } };
    });
    if (outcome.missing) return sendJSON(res, 404, { error: 'not-found' });
    if (outcome.forbidden) return sendJSON(res, 403, { error: 'forbidden', message: 'only the registering uid (or admin) can update this adapter' });
    if (outcome.code !== undefined) await attachCode(outcome.entry, outcome.code);
    return sendJSON(res, 200, { adapter: publicEntry(outcome.entry) });
  }

  async function deleteAdapter(res, appId, id, rec, isAdmin) {
    const now = new Date().toISOString();
    const removed = await mutateCatalog(store, (catalog) => {
      const key = `${appId}/${id}`;
      const entry = catalog.entries[key];
      if (!entry) return { save: false, result: null };
      if (!isAdmin && entry.registeredBy !== rec?.uid) return { save: false, result: { forbidden: true } };
      delete catalog.entries[key];
      pruneApp(catalog, appId, now);
      return { save: true, result: entry };
    });
    if (!removed) return sendJSON(res, 404, { error: 'not-found' });
    if (removed.forbidden) return sendJSON(res, 403, { error: 'forbidden', message: 'only the registering uid (or admin) can delete this adapter' });
    await store.writeJSON(CODE_DOC(appId, id), null).catch(() => {});
    return sendJSON(res, 200, { ok: true });
  }

  async function getAdapterCode(res, appId, id) {
    const catalog = (await store.readJSON(CATALOG_DOC)) || emptyCatalog();
    const entry = catalog.entries[`${appId}/${id}`];
    if (!entry) return sendJSON(res, 404, { error: 'not-found' });
    if (entry.kind !== 'code') return sendJSON(res, 404, { error: 'no-code', message: `${appId}/${id} is a data-only listing` });
    const doc = await store.readJSON(CODE_DOC(appId, id));
    if (!doc || typeof doc.code !== 'string') return sendJSON(res, 404, { error: 'code-missing' });
    return sendJSON(res, 200, { appId, id, code: doc.code, sha256: entry.codeSha256, size: entry.codeSize, updatedAt: doc.updatedAt || entry.updatedAt });
  }

  // An app (host) publishing its whole catalog in one call. Upsert semantics:
  // entries the caller owns are updated, new ones created, entries owned by
  // another uid skipped (one app's sync cannot overwrite another publisher),
  // and with `full: true` the caller's own entries missing from the payload
  // are removed — so an app that drops an adapter stops listing it.
  async function syncCatalog(req, res, rec) {
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized', message: 'syncing a catalog needs a user token.' });
    const body = await readBody(req);
    const appId = requireSlug(body.appId, 'appId');
    if (!Array.isArray(body.adapters)) throw new ClientError(400, 'adapters must be an array.');
    const now = new Date().toISOString();
    const seen = new Set();
    const result = { created: 0, updated: 0, removed: [], skipped: [] };
    const codeWrites = [];
    // Validate (and digest) outside the catalog lock: the digest is async and
    // the mutation below may run more than once on a conflict.
    const validated = [];
    for (const raw of body.adapters) {
      try {
        validated.push({ raw, m: await withDescriptorDigest(validateManifest(raw, { appId })) });
      } catch (e) {
        if (e instanceof ClientError) validated.push({ raw, error: e.message });
        else throw e;
      }
    }
    const final = await mutateCatalog(store, (catalog) => {
      result.created = 0; result.updated = 0; result.removed = []; result.skipped = [];
      codeWrites.length = 0;
      for (const { raw, m, error } of validated) {
        if (error) { result.skipped.push({ id: raw?.id, reason: error }); continue; }
        const key = `${appId}/${m.id}`;
        seen.add(key);
        const existing = catalog.entries[key];
        if (existing && existing.registeredBy !== rec.uid) {
          result.skipped.push({ id: m.id, reason: 'registered by another uid' });
          continue;
        }
        if (existing) {
          Object.assign(existing, {
            name: m.name, description: m.description, version: m.version,
            settingsKeys: m.settingsKeys, supportAreas: m.supportAreas,
            requiresAI: m.requiresAI, sourceUrl: m.sourceUrl, docsUrl: m.docsUrl,
            updatedAt: now,
          });
          if (m.descriptor) existing.descriptor = m.descriptor; else delete existing.descriptor;
          result.updated++;
        } else {
          catalog.entries[key] = {
            ...m,
            kind: 'data', codeSize: 0, codeSha256: '',
            registeredBy: rec.uid, registeredByLabel: rec.label || '',
            createdAt: now, updatedAt: now,
          };
          result.created++;
        }
        if (typeof raw.code === 'string' && raw.code) codeWrites.push([appId, m.id, raw.code]);
      }
      touchApp(catalog, body.appName, appId, now);
      if (body.full === true) {
        for (const [key, entry] of Object.entries(catalog.entries)) {
          if (entry.appId === appId && entry.registeredBy === rec.uid && !seen.has(key)) {
            delete catalog.entries[key];
            result.removed.push(entry.id);
          }
        }
        pruneApp(catalog, appId, now);
      }
      return { save: true, result };
    });
    for (const [a, i, code] of codeWrites) {
      const entry = ((await store.readJSON(CATALOG_DOC)) || emptyCatalog()).entries[`${a}/${i}`];
      if (entry) await attachCode(entry, code);
    }
    return sendJSON(res, 200, { appId, ...final });
  }

  // ── per-user install state ────────────────────────────────────────────────

  async function readUserState(uid) {
    assertSafeUid(uid);
    const doc = await store.readJSON(USER_DOC.replace('%UID%', uid));
    return doc && doc.installed ? doc : { installed: {} };
  }

  async function setInstalled(req, res, rec, appId, id, installed) {
    requireSlug(appId, 'appId');
    requireSlug(id, 'id');
    const catalog = (await store.readJSON(CATALOG_DOC)) || emptyCatalog();
    const key = `${appId}/${id}`;
    if (!catalog.entries[key]) return sendJSON(res, 404, { error: 'not-found' });
    return withUserLock(rec.uid, async () => {
      const state = await readUserState(rec.uid);
      if (installed) state.installed[key] = { installedAt: new Date().toISOString() };
      else delete state.installed[key];
      await store.writeJSON(USER_DOC.replace('%UID%', rec.uid), state);
      return sendJSON(res, 200, { ok: true, appId, id, installed });
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  // Write (or remove, for an empty string) the code document and keep the
  // entry's kind/size/hash in step. Runs inside the catalog lock's caller,
  // after the entry is saved: the blob is a separate document, and a crash
  // between the two leaves a data-only listing, never a lying one.
  async function attachCode(entry, code) {
    if (!code) {
      entry.kind = 'data';
      entry.codeSize = 0;
      entry.codeSha256 = '';
      await store.writeJSON(CODE_DOC(entry.appId, entry.id), null);
    } else {
      Object.assign(entry, codeMeta(code));
      await store.writeJSON(CODE_DOC(entry.appId, entry.id), {
        code, ...codeMeta(code), updatedAt: new Date().toISOString(),
      });
    }
    // Re-save the entry with its new code metadata.
    await mutateCatalog(store, (catalog) => {
      const live = catalog.entries[`${entry.appId}/${entry.id}`];
      if (!live) return { save: false, result: null };
      Object.assign(live, { kind: entry.kind, codeSize: entry.codeSize, codeSha256: entry.codeSha256 });
      return { save: true, result: null };
    });
  }

  function touchApp(catalog, appName, appId, now) {
    const name = typeof appName === 'string' && appName.trim() ? appName.trim().slice(0, 120) : null;
    if (!catalog.apps[appId]) catalog.apps[appId] = { name: name || appId, updatedAt: now };
    else if (name && catalog.apps[appId].name !== name) catalog.apps[appId] = { name, updatedAt: now };
  }

  function pruneApp(catalog, appId, now) {
    const stillThere = Object.values(catalog.entries).some(e => e.appId === appId);
    if (!stillThere && catalog.apps[appId]) delete catalog.apps[appId];
  }
}

function decodeSegments(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ClientError(400, 'malformed path');
  }
  // ['/v1/adapters', 'browser-extension', 'dark-mode', 'code'] -> rest segments.
  const parts = decoded.split('/').filter(Boolean).slice(2);
  if (parts.some(p => !SLUG.test(p))) throw new ClientError(404, 'not-found');
  return parts;
}

function methodNotAllowed(res) {
  return sendJSON(res, 405, { error: 'method-not-allowed' });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

const MAX_BODY_BYTES = 1e6;
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw new ClientError(400, 'body too large');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ClientError(400, 'invalid-json');
  }
}
