// Request router — implements CONTRACT.md exactly. `createApp(config)`
// returns a plain `(req, res) => void` listener (no `http.createServer` /
// `.listen()` inside it) so tests can boot the app in-process on an
// ephemeral port, or with no port at all (a raw request/response pair).
//
// The toolkit is reached ONLY through `toolkitHost` (server/src/
// toolkit-host.js, itself barrel-only) and `LIBRARIAN_ROUTES`/
// `invokeLibrarianRoute` (server/src/routes.js) — this file never imports
// anything under toolkit/ directly.

import { verifyToken, verifyAdminHeader, issueToken, listTokens, revokeToken } from './auth.js';
import { LIBRARIAN_ROUTES_BY_NAME, invokeLibrarianRoute } from './routes.js';
import { buildMeta } from './meta.js';
import { renderAdminPage } from './admin-page.js';

const ADMIN_TOKENS_PREFIX = '/admin/tokens';
const ADMIN_USERS_PREFIX = '/admin/users';
const LIBRARIAN_PREFIX = '/v1/librarian/';

/** @param {Object} config
 *  @param {import('./store.js').fileStore} config.store
 *  @param {string} config.adminPassword
 *  @param {import('./toolkit-host.js').createToolkitHost extends (...a:any)=>infer R ? R : never} config.toolkitHost
 *  @param {string} [config.version]
 *  @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createApp({ store, adminPassword, toolkitHost, version = '0.0.0' }) {
  if (!store) throw new Error('createApp: store is required');
  if (!adminPassword) throw new Error('createApp: adminPassword is required');
  if (!toolkitHost) throw new Error('createApp: toolkitHost is required');

  // Built once at app-creation time (still "at runtime", per the boot
  // process's live route table + a real librarian instance — just not
  // recomputed on every request, since neither ever changes while the
  // process is up).
  const metaPayload = buildMeta({ version });
  const adminPageHtml = renderAdminPage();

  return function listener(req, res) {
    handle(req, res).catch((e) => {
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal-error', message: e.message });
      else res.end();
    });
  };

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://internal');
    } catch {
      return sendJSON(res, 400, { error: 'bad-request' });
    }
    const { pathname } = url;
    const method = req.method;

    // /v1/healthz is the canonical liveness path: the bare /healthz works in
    // local/dev but is intercepted at the *.run.app edge before reaching the
    // container (observed empirically: 404 with no Server/trace headers), so
    // deployed probes must use the /v1-prefixed form.
    if (method === 'GET' && (pathname === '/healthz' || pathname === '/v1/healthz')) {
      return sendJSON(res, 200, { ok: true, version });
    }

    if (method === 'GET' && pathname === '/v1/meta') {
      return sendJSON(res, 200, metaPayload);
    }

    // The admin page itself is behind the browser's native auth popup (HTTP
    // Basic): an unauthenticated GET gets 401 + WWW-Authenticate, the browser
    // prompts, caches the credential for the session (remembered by default,
    // and offered to the password manager), and every same-origin fetch the
    // page makes then carries it automatically.
    if (method === 'GET' && pathname === '/admin') {
      if (!verifyAdminHeader(adminPassword, req.headers['authorization'])) {
        return sendAdminChallenge(res);
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(adminPageHtml);
    }

    if (pathname === ADMIN_TOKENS_PREFIX || pathname.startsWith(ADMIN_TOKENS_PREFIX + '/')) {
      return handleAdminTokens(req, res, method, pathname);
    }

    if (pathname === ADMIN_USERS_PREFIX || pathname.startsWith(ADMIN_USERS_PREFIX + '/')) {
      return handleAdminUsers(req, res, method, pathname);
    }

    if (method === 'GET' && pathname === '/v1/whoami') {
      const rec = await requireUser(req, res);
      if (!rec) return;
      return sendJSON(res, 200, { uid: rec.uid, label: rec.label });
    }

    if (method === 'POST' && pathname.startsWith(LIBRARIAN_PREFIX)) {
      return handleLibrarianCall(req, res, pathname);
    }

    return sendJSON(res, 404, { error: 'not-found' });
  }

  async function handleAdminTokens(req, res, method, pathname) {
    // Basic (browser popup credential, auto-attached to the page's fetches)
    // or Bearer (curl/scripts) — see verifyAdminHeader.
    if (!verifyAdminHeader(adminPassword, req.headers['authorization'])) {
      return sendJSON(res, 401, { error: 'unauthorized' });
    }

    if (method === 'POST' && pathname === ADMIN_TOKENS_PREFIX) {
      let body;
      try {
        body = await readJSONBody(req);
      } catch {
        return sendJSON(res, 400, { error: 'invalid-json' });
      }
      if (!body || typeof body.uid !== 'string' || !body.uid.trim()) {
        return sendJSON(res, 400, { error: 'uid is required' });
      }
      const result = await issueToken(store, { uid: body.uid, label: body.label });
      return sendJSON(res, 200, result);
    }

    if (method === 'GET' && pathname === ADMIN_TOKENS_PREFIX) {
      return sendJSON(res, 200, await listTokens(store));
    }

    if (method === 'DELETE' && pathname.startsWith(ADMIN_TOKENS_PREFIX + '/')) {
      const id = decodeURIComponent(pathname.slice((ADMIN_TOKENS_PREFIX + '/').length));
      if (!id) return sendJSON(res, 404, { error: 'not-found' });
      const ok = await revokeToken(store, id);
      if (!ok) return sendJSON(res, 404, { error: 'not-found' });
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: 'not-found' });
  }

  // Admin: the user PROFILES themselves (a uid's `users/<uid>/` partition),
  // distinct from the access tokens above. GET lists every stored profile;
  // DELETE wipes one profile's data entirely (revoking a token only cuts off
  // access — this removes the ability profile + memory). Same admin auth.
  async function handleAdminUsers(req, res, method, pathname) {
    if (!verifyAdminHeader(adminPassword, req.headers['authorization'])) {
      return sendJSON(res, 401, { error: 'unauthorized' });
    }

    if (method === 'GET' && pathname === ADMIN_USERS_PREFIX) {
      const uids = await store.listUsers();
      return sendJSON(res, 200, { users: uids });
    }

    if (method === 'DELETE' && pathname.startsWith(ADMIN_USERS_PREFIX + '/')) {
      const uid = decodeURIComponent(pathname.slice((ADMIN_USERS_PREFIX + '/').length));
      if (!uid) return sendJSON(res, 404, { error: 'not-found' });
      let deleted;
      try {
        deleted = await store.deleteUser(uid);
      } catch (e) {
        return sendJSON(res, 400, { error: e.message });
      }
      if (!deleted) return sendJSON(res, 404, { error: 'not-found' });
      return sendJSON(res, 200, { ok: true, uid });
    }

    return sendJSON(res, 404, { error: 'not-found' });
  }

  async function handleLibrarianCall(req, res, pathname) {
    const rec = await requireUser(req, res);
    if (!rec) return;

    const routeName = decodeURIComponent(pathname.slice(LIBRARIAN_PREFIX.length));
    const entry = LIBRARIAN_ROUTES_BY_NAME.get(routeName);
    if (!entry) return sendJSON(res, 404, { error: 'unknown-method' });

    let body;
    try {
      body = await readJSONBody(req);
    } catch {
      return sendJSON(res, 400, { error: 'invalid-json' });
    }
    const args = Array.isArray(body?.args) ? body.args : [];

    let instance;
    try {
      instance = await toolkitHost.getInstance(rec.uid);
    } catch (e) {
      return sendJSON(res, 500, { error: 'internal-error', message: e.message });
    }

    try {
      const result = await invokeLibrarianRoute(entry, instance, args);
      return sendJSON(res, 200, { ok: true, result });
    } catch (e) {
      // Application errors are data, not transport failures (CONTRACT.md).
      return sendJSON(res, 200, { ok: false, error: e.message });
    }
  }

  async function requireUser(req, res) {
    const presented = bearerFrom(req);
    const rec = presented ? await verifyToken(store, presented) : null;
    if (!rec) {
      sendJSON(res, 401, { error: 'unauthorized' });
      return null;
    }
    return rec;
  }
}

function sendAdminChallenge(res) {
  res.writeHead(401, {
    'content-type': 'text/html; charset=utf-8',
    'www-authenticate': 'Basic realm="Toolkit Service Admin", charset="UTF-8"',
  });
  res.end('<!doctype html><meta charset="utf-8"><title>Authentication required</title>'
    + '<p>Authentication required — enter the admin password (any username).</p>');
}

function bearerFrom(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readJSONBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}
