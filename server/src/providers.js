// Apps built with the Adapter MCP SDK connect here, per account.
//
//   POST   /v1/providers                     register an app instance (app token)
//   GET    /v1/providers/{providerId}/channel  its request stream (SSE)
//   POST   /v1/providers/{providerId}/channel  its JSON-RPC responses
//   DELETE /v1/providers/{providerId}          sign off
//   POST   /v1/mcp/providers/{providerId}      MCP endpoint for one instance
//   POST   /v1/mcp/apps/{appId}                MCP endpoint for the app's one live instance
//   GET    /v1/apps                            the account's apps, grouped by app
//   PUT    /v1/apps/{appId}/hidden             hide an app in the console
//   DELETE /v1/apps/{appId}/hidden             show it again
//   DELETE /v1/apps/{appId}                    forget an app that is not connected
//
// Everything is scoped to the token's uid. A provider is reachable only by
// clients holding a token of the same account — the developer console's
// session, or an app/default token handed to an MCP client. That is the
// "explicitly configured, trusted connection" the design requires: a
// marketplace listing never makes anyone connect to anything.
//
// Registration re-validates what the SDK already checked (application,
// descriptors, digests), because the service must not store or show a
// descriptor the contract would reject.

import crypto from 'node:crypto';
import { checkApplication, checkDescriptor, descriptorDigest, PROFILE_VERSION, SLUG } from '../../toolkit/protocol/adapter/index.js';
import { HttpError, sendJSON, readJSON, segmentsAfter } from './http.js';
import { RelayError } from './relay.js';

const APPS_DOC = (uid) => `users/${uid}/apps.json`;
const RECENT_CALLS = 20;
export const CONSOLE_DOC = (uid) => `users/${uid}/console.json`;
const MAX_ADAPTERS = 100;
const MAX_HIDDEN = 200;

export const PROVIDERS_PREFIX = '/v1/providers';
export const MCP_PREFIX = '/v1/mcp';
export const APPS_PREFIX = '/v1/apps';

/** Read the console preferences document for a uid. */
export async function readConsolePrefs(store, uid) {
  const doc = await store.readJSON(CONSOLE_DOC(uid));
  return {
    hiddenApps: Array.isArray(doc?.hiddenApps) ? doc.hiddenApps.filter(a => typeof a === 'string') : [],
    presets: Array.isArray(doc?.presets) ? doc.presets : [],
  };
}

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {ReturnType<import('./relay.js').createRelay>} config.relay
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} config.withUserLock
 * @param {(req) => Promise<object|null>} config.authenticate  token record or null
 */
export function createProviderRoutes({ store, relay, withUserLock, authenticate, activity = null, onApplication = null }) {
  async function requireRecord(req, { appToken = false } = {}) {
    const rec = await authenticate(req);
    if (!rec) throw new HttpError(401, 'unauthorized', 'Send a toolkit token: Authorization: Bearer aat_…');
    if (appToken && rec.kind === 'session') {
      throw new HttpError(403, 'app-token-required', 'Apps connect with an app token (your default token from the developer console), not a console sign-in.');
    }
    return rec;
  }

  async function readApps(uid) {
    const doc = await store.readJSON(APPS_DOC(uid));
    return doc && typeof doc.apps === 'object' && doc.apps ? doc : { apps: {} };
  }

  // ── registration ─────────────────────────────────────────────────────────

  async function register(req, res, rec) {
    const body = await readJSON(req);
    const application = body?.application;
    const errors = checkApplication(application);
    if (!Array.isArray(body?.adapters)) errors.push({ path: '/adapters', message: 'must be a list of descriptors' });
    else if (body.adapters.length > MAX_ADAPTERS) errors.push({ path: '/adapters', message: `at most ${MAX_ADAPTERS} adapters per app` });
    if (body?.providerId !== undefined && (typeof body.providerId !== 'string' || !SLUG.test(body.providerId))) {
      errors.push({ path: '/providerId', message: `must match ${SLUG}` });
    }
    const adapters = [];
    if (!errors.length) {
      for (const [i, d] of body.adapters.entries()) {
        const errs = checkDescriptor(d, { application });
        if (d?.exposure !== 'mcp') errs.push({ path: '/exposure', message: 'only adapters exported over MCP ("exposure": "mcp") are registered' });
        const artifact = d?.executionArtifactDigest ?? null;
        if (artifact !== null && typeof artifact !== 'string') errs.push({ path: '/executionArtifactDigest', message: 'must be a string or null' });
        if (!errs.length) {
          const expected = await descriptorDigest(d, artifact);
          if (d.descriptorDigest !== expected) errs.push({ path: '/descriptorDigest', message: `does not match the descriptor (expected ${expected})` });
        }
        errors.push(...errs.map(e => ({ path: `/adapters/${i}${e.path}`, message: e.message })));
        adapters.push(d);
      }
      const ids = adapters.map(d => d.id);
      if (new Set(ids).size !== ids.length) errors.push({ path: '/adapters', message: 'adapter ids must be unique' });
    }
    if (!errors.length && rec.kind === 'app' && rec.appId && application.appId !== rec.appId) {
      throw new HttpError(403, 'forbidden', `This token is for the app ${rec.appId}, not ${application.appId}.`);
    }
    if (errors.length) {
      throw new HttpError(400, 'invalid-registration', `The app's registration does not follow Adapter MCP ${PROFILE_VERSION}: ${errors.slice(0, 3).map(e => `${e.path} ${e.message}`).join('; ')}`, { errors: errors.slice(0, 50) });
    }

    // The app's name, and who can read what it gives the toolkit if it says (access.js).
    if (onApplication) await onApplication(rec, application);
    const providerId = body.providerId || `p-${crypto.randomBytes(6).toString('hex')}`;
    const label = typeof body.label === 'string' ? body.label.slice(0, 300) : '';
    try {
      relay.register({ uid: rec.uid, tokenId: rec.id, providerId, label, application, adapters });
    } catch (e) {
      if (e instanceof RelayError) throw new HttpError(409, e.code, e.message);
      throw e;
    }
    const now = new Date().toISOString();
    await withUserLock(rec.uid, async () => {
      const doc = await readApps(rec.uid);
      const { platform, providerId: _ignored, ...appInfo } = application;
      doc.apps[application.appId] = { ...appInfo, adapters, updatedAt: now, lastSeenAt: now };
      await store.writeJSON(APPS_DOC(rec.uid), doc);
    });
    return sendJSON(res, 200, {
      ok: true,
      providerId,
      appId: application.appId,
      endpoints: {
        channel: `${PROVIDERS_PREFIX}/${providerId}/channel`,
        mcp: `${MCP_PREFIX}/providers/${providerId}`,
        app: `${MCP_PREFIX}/apps/${application.appId}`,
      },
    });
  }

  function providerFor(rec, providerId) {
    const p = relay.get(rec.uid, providerId);
    if (!p) throw new HttpError(404, 'not-found', `No app instance ${providerId} is registered for this account.`);
    return p;
  }

  async function channel(req, res, rec, providerId, method) {
    const p = providerFor(rec, providerId);
    if (method === 'GET') {
      if (p.tokenId !== rec.id) throw new HttpError(403, 'forbidden', 'Open the channel with the token that registered this app instance.');
      return relay.attach(rec.uid, providerId, res);
    }
    if (method === 'POST') {
      if (p.tokenId !== rec.id) throw new HttpError(403, 'forbidden', 'Only the app instance itself can answer its requests.');
      const response = await readJSON(req);
      if (!response || response.jsonrpc !== '2.0' || typeof response.id !== 'string') throw new HttpError(400, 'invalid-response', 'Post one JSON-RPC response for a relayed request.');
      if (!relay.complete(p, response)) throw new HttpError(404, 'unknown-request', 'That request already timed out or was answered.');
      res.writeHead(204);
      return res.end();
    }
    throw new HttpError(405, 'method-not-allowed');
  }

  // ── MCP endpoints (Streamable HTTP, request/response only) ───────────────

  async function mcp(req, res, rec, provider, method) {
    if (method !== 'POST') {
      // No server-initiated stream and no session to delete.
      res.setHeader('allow', 'POST');
      throw new HttpError(405, 'method-not-allowed', 'This MCP endpoint takes POST only.');
    }
    const message = await readJSON(req);
    if (Array.isArray(message)) return sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'JSON-RPC batches are not supported.' } });
    if (!message || message.jsonrpc !== '2.0') return sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    if (typeof message.method !== 'string') {
      // A client's response to a server request: the relay sends none.
      res.writeHead(202);
      return res.end();
    }
    const isRequest = Object.hasOwn(message, 'id');
    try {
      const response = await relay.forward(provider, message, { client: rec.kind === 'session' ? 'developer console' : rec.label || 'MCP client' });
      if (!isRequest) { res.writeHead(202); return res.end(); }
      return sendJSON(res, 200, response);
    } catch (e) {
      if (!(e instanceof RelayError)) throw e;
      if (!isRequest) { res.writeHead(202); return res.end(); }
      return sendJSON(res, e.code === 'provider-timeout' ? 504 : 503, { jsonrpc: '2.0', id: message.id, error: { code: e.rpcCode, message: e.message, data: { reason: e.code } } });
    }
  }

  function liveProviderForApp(rec, appId) {
    const live = relay.forUid(rec.uid).filter(p => p.appId === appId && p.channel);
    if (live.length === 1) return live[0];
    const message = live.length
      ? `${appId} has ${live.length} connected instances; use one instance's endpoint: ${live.map(p => `${MCP_PREFIX}/providers/${p.providerId} (${p.label || 'no label'})`).join(', ')}.`
      : `${appId} is not connected right now. Open the app with your token and it connects.`;
    throw Object.assign(new HttpError(503, live.length ? 'provider-ambiguous' : 'provider-offline', message), { rpc: true });
  }

  // ── apps ─────────────────────────────────────────────────────────────────

  async function listApps(res, rec) {
    const [doc, prefs, calls] = await Promise.all([readApps(rec.uid), readConsolePrefs(store, rec.uid), activity ? activity.recent(rec.uid) : []]);
    const live = relay.list(rec.uid);
    const liveEntries = relay.forUid(rec.uid);
    const ids = new Set([...Object.keys(doc.apps), ...live.map(p => p.appId)]);
    const apps = [...ids].map((appId) => {
      const saved = doc.apps[appId];
      const conns = live.filter(p => p.appId === appId);
      const newestLive = liveEntries.filter(p => p.appId === appId && p.channel).sort((a, b) => b.connectedAt - a.connectedAt)[0];
      const source = newestLive ? { ...newestLive.application, adapters: newestLive.adapters } : saved;
      const lastSeen = [saved?.lastSeenAt ? Date.parse(saved.lastSeenAt) : 0, ...conns.map(c => c.lastSeenAt || 0)];
      return {
        appId,
        name: source?.name || appId,
        version: source?.version || '',
        description: source?.description || '',
        surfaces: source?.surfaces || [],
        supportedPlatforms: source?.supportedPlatforms || [],
        hidden: prefs.hiddenApps.includes(appId),
        live: conns.some(c => c.live),
        lastSeenAt: new Date(Math.max(...lastSeen)).toISOString(),
        connections: conns,
        // Stored, so they outlive a restart; newest first.
        recentCalls: calls.filter(c => c.appId === appId).slice(-RECENT_CALLS).reverse(),
        adapters: source?.adapters || [],
        endpoint: `${MCP_PREFIX}/apps/${appId}`,
      };
    }).sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));
    return sendJSON(res, 200, { profileVersion: PROFILE_VERSION, apps, hiddenApps: prefs.hiddenApps });
  }

  async function setHidden(res, rec, appId, hidden) {
    if (!SLUG.test(appId)) throw new HttpError(400, 'invalid-app-id', `An app id matches ${SLUG}.`);
    const hiddenApps = await withUserLock(rec.uid, async () => {
      const doc = (await store.readJSON(CONSOLE_DOC(rec.uid))) || {};
      const set = new Set(Array.isArray(doc.hiddenApps) ? doc.hiddenApps : []);
      if (hidden) set.add(appId); else set.delete(appId);
      if (set.size > MAX_HIDDEN) throw new HttpError(400, 'too-many-hidden', `At most ${MAX_HIDDEN} hidden apps.`);
      doc.hiddenApps = [...set].sort();
      await store.writeJSON(CONSOLE_DOC(rec.uid), doc);
      return doc.hiddenApps;
    });
    return sendJSON(res, 200, { ok: true, appId, hidden, hiddenApps });
  }

  async function forgetApp(res, rec, appId) {
    if (relay.forUid(rec.uid).some(p => p.appId === appId && p.channel)) {
      throw new HttpError(409, 'app-connected', `${appId} is connected right now. Close it first, or hide it instead.`);
    }
    for (const p of relay.forUid(rec.uid)) if (p.appId === appId) relay.remove(rec.uid, p.providerId);
    const removed = await withUserLock(rec.uid, async () => {
      const doc = await readApps(rec.uid);
      if (!doc.apps[appId]) return false;
      delete doc.apps[appId];
      await store.writeJSON(APPS_DOC(rec.uid), doc);
      return true;
    });
    if (!removed) throw new HttpError(404, 'not-found', `No app ${appId} on this account.`);
    return sendJSON(res, 200, { ok: true, appId });
  }

  // ── dispatch ─────────────────────────────────────────────────────────────

  return async function handle(req, res, method, pathname) {
    try {
      if (pathname === PROVIDERS_PREFIX || pathname.startsWith(`${PROVIDERS_PREFIX}/`)) {
        const segs = segmentsAfter(pathname, PROVIDERS_PREFIX);
        const rec = await requireRecord(req, { appToken: true });
        if (!segs.length && method === 'POST') return await register(req, res, rec);
        if (segs.length === 1 && method === 'DELETE') {
          providerFor(rec, segs[0]);
          relay.remove(rec.uid, segs[0]);
          return sendJSON(res, 200, { ok: true });
        }
        if (segs.length === 2 && segs[1] === 'channel') return await channel(req, res, rec, segs[0], method);
        throw new HttpError(404, 'not-found');
      }
      if (pathname.startsWith(`${MCP_PREFIX}/`)) {
        const segs = segmentsAfter(pathname, MCP_PREFIX);
        const rec = await requireRecord(req);
        if (segs.length === 2 && segs[0] === 'providers') return await mcp(req, res, rec, providerFor(rec, segs[1]), method);
        if (segs.length === 2 && segs[0] === 'apps') {
          if (method !== 'POST') return await mcp(req, res, rec, null, method);
          let provider;
          try { provider = liveProviderForApp(rec, segs[1]); } catch (e) {
            if (!e.rpc) throw e;
            const message = await readJSON(req);
            return sendJSON(res, e.status, { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32000, message: e.message, data: { reason: e.error } } });
          }
          return await mcp(req, res, rec, provider, method);
        }
        throw new HttpError(404, 'not-found');
      }
      if (pathname === APPS_PREFIX || pathname.startsWith(`${APPS_PREFIX}/`)) {
        const segs = segmentsAfter(pathname, APPS_PREFIX);
        const rec = await requireRecord(req);
        if (!segs.length && method === 'GET') return await listApps(res, rec);
        if (segs.length === 1 && method === 'DELETE') return await forgetApp(res, rec, segs[0]);
        if (segs.length === 2 && segs[1] === 'hidden' && (method === 'PUT' || method === 'DELETE')) return await setHidden(res, rec, segs[0], method === 'PUT');
        throw new HttpError(404, 'not-found');
      }
      throw new HttpError(404, 'not-found');
    } catch (e) {
      if (e instanceof HttpError) {
        if (res.headersSent) return res.end();
        return sendJSON(res, e.status, { error: e.error, message: e.message, ...e.extra });
      }
      throw e;
    }
  };
}
