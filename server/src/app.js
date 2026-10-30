// Request router — implements CONTRACT.md exactly. `createApp(config)`
// returns a plain `(req, res) => void` listener (no `http.createServer` /
// `.listen()` inside it) so tests can boot the app in-process on an
// ephemeral port, or with no port at all (a raw request/response pair).
//
// The toolkit is reached ONLY through `toolkitHost` (server/src/
// toolkit-host.js, itself barrel-only) and `LIBRARIAN_ROUTES`/
// `invokeLibrarianRoute` (server/src/routes.js) — this file never imports
// anything under toolkit/ directly.

import { verifyToken, verifyAdminHeader, issueToken, listTokens, revokeToken, revokeTokensFor, TOKEN_KINDS } from './auth.js';
import { assertSafeUid } from './store.js';
import { LIBRARIAN_ROUTES_BY_NAME, invokeLibrarianRoute } from './routes.js';
import { createAdaptersRouter } from './adapters.js';
import { buildMeta } from './meta.js';
import { ADMIN_ASSETS, serveAdminPage, serveAdminAsset } from './admin-page.js';
import { DEVELOPER_ASSETS, serveDeveloperAsset } from './developer-page.js';
import { SDK_ASSETS, serveSdkAsset } from './sdk-assets.js';
import { createAccounts } from './accounts.js';
import { createRelay } from './relay.js';
import { createProviderRoutes } from './providers.js';
import { createAccountRoutes } from './account-routes.js';
import { createAdminAccountRoutes } from './admin-accounts.js';
import { sendJSON, sendHttpError, bearerFrom, readJSON as readBody } from './http.js';
import { silentLogger, safeErrorText } from './log.js';
import { createActivityLog } from './activity.js';
import { createRegistry, REGISTRY_PATH } from './registry.js';
import { createProfileEvents, cleanSelection, PROFILE_WRITES } from './profile-events.js';
import { auditAccounts } from './audit.js';

const ADMIN_TOKENS_PREFIX = '/admin/tokens';
const ADMIN_USERS_PREFIX = '/admin/users';
const ADMIN_ACCOUNTS_PREFIX = '/admin/accounts';
const ADMIN_ASSETS_PREFIX = '/admin/assets/';
const LIBRARIAN_PREFIX = '/v1/librarian/';
const ADAPTERS_PREFIX = '/v1/adapters';
const AUTH_PREFIX = '/v1/auth/';
const ACCOUNT_PREFIX = '/v1/account';
const PROVIDERS_PREFIX = '/v1/providers';
const PROFILE_PREFIX = '/v1/profile';
const MCP_PREFIX = '/v1/mcp/';
const APPS_PREFIX = '/v1/apps';
const SDK_PREFIX = '/sdk/';
const SKILL_PREFIX = '/skill/';

/** @param {Object} config
 *  @param {import('./store.js').fileStore} config.store
 *  @param {string} config.adminPassword
 *  @param {import('./toolkit-host.js').createToolkitHost extends (...a:any)=>infer R ? R : never} config.toolkitHost
 *  @param {string} [config.version]
 *  @param {string[]} [config.corsOrigins]  browser origins allowed to call /v1/; ['*'] allows any
 *  @param {string} [config.tokenSecret]  HMAC key for account default tokens (defaults to adminPassword)
 *  @param {ReturnType<typeof createRelay>} [config.relay]
 *  @param {ReturnType<import('./log.js').createLogger>} [config.log]  structured logger (silent by default)
 *  @returns {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) & {relay: ReturnType<typeof createRelay>, accounts: ReturnType<typeof createAccounts>, activity: ReturnType<typeof createActivityLog>}}
 */
export function createApp({ store, adminPassword, toolkitHost, version = '0.0.0', corsOrigins = [], tokenSecret, relay = createRelay(), log = silentLogger }) {
  if (!store) throw new Error('createApp: store is required');
  if (!adminPassword) throw new Error('createApp: adminPassword is required');
  if (!toolkitHost) throw new Error('createApp: toolkitHost is required');

  // Built once at app-creation time (still "at runtime", per the boot
  // process's live route table + a real librarian instance — just not
  // recomputed on every request, since neither ever changes while the
  // process is up).
  // ── one uid at a time ──────────────────────────────────────────────────
  // Authenticating and then writing are two steps, and a delete can land
  // between them. Revoking tokens stops a request that has not authenticated
  // YET; it does nothing about one that already did and is still on its way to
  // the datastore. That request gets a fresh toolkit instance after the evict
  // and writes the wiped partition straight back, so a person who asked for
  // their disability data to be deleted still has a profile afterwards.
  //
  // So every librarian call and every delete for a uid runs in a queue of one.
  // The librarian call re-checks its credential AFTER taking its turn, which is
  // what actually closes the window: either it finishes before the delete
  // starts, or it takes its turn afterwards and finds its token revoked.
  //
  // It buys a second thing for free. The KVStore reads a whole area, mutates,
  // and writes it back with no compare-and-set, so two concurrent writes to one
  // uid could already lose one of them. Serializing per uid removes that too.
  //
  // Single process only. Two containers behind the same bucket still race, and
  // closing THAT needs a conditional write at the store (a GCS generation
  // precondition) or a deletion tombstone the write path checks. Flagged in the
  // PR rather than papered over: this is the fix that fits one process, and the
  // service runs as one today.
  const userQueues = new Map(); // uid -> promise for the tail of its queue

  function withUserLock(uid, fn) {
    const prev = userQueues.get(uid) || Promise.resolve();
    const result = prev.then(fn);
    // The queue tail must never reject, or the next waiter inherits the
    // rejection and its turn never runs.
    const tail = result.then(() => {}, () => {});
    userQueues.set(uid, tail);
    // Drop the entry once the queue drains, so a long-lived server does not
    // keep one promise per uid it has ever seen.
    tail.then(() => { if (userQueues.get(uid) === tail) userQueues.delete(uid); });
    return result;
  }

  const metaPayload = buildMeta({ version });
  const adaptersRouter = createAdaptersRouter({ store, adminPassword, withUserLock });
  const accounts = auditAccounts(createAccounts({ store, secret: tokenSecret || adminPassword, relay }), log);
  const authenticate = async (req) => {
    const presented = bearerFrom(req);
    return noteAuth(req, presented ? await verifyToken(store, presented) : null);
  };
  // Every MCP call is logged and kept in the account's stored activity; the
  // other relay events (apps connecting, disconnecting) are logged.
  const activity = createActivityLog({ store, withUserLock, log });
  relay.subscribe((type, { uid, ...fields }) => {
    if (type === 'mcp.call') {
      activity.record(uid, fields);
      (fields.outcome === 'timeout' ? log.warn : log.info)('mcp.call', { uid, ...fields });
    } else {
      log.info(type, { uid, ...fields });
    }
  });
  const providerRoutes = createProviderRoutes({ store, relay, withUserLock, authenticate, activity });
  const profileEvents = createProfileEvents({ store, authenticate, toolkitHost, withUserLock });
  const registry = createRegistry({ store, withUserLock, authenticate, log, version });
  const accountRoutes = createAccountRoutes({ store, accounts, relay, withUserLock, authenticate, log });
  const adminAccountRoutes = createAdminAccountRoutes({ store, accounts, relay, wipeUser });
  const anyOrigin = corsOrigins.includes('*');

  // The whole deletion story for one uid, used by DELETE /admin/users/{uid}
  // and DELETE /admin/accounts/{uid}. Inside the uid's queue, so an
  // already-authenticated write either lands entirely before this runs or is
  // rejected after it.
  function wipeUser(uid) {
    return withUserLock(uid, async () => {
      // Order still matters within the turn: cut off the ways the partition
      // could be rewritten (cached instance, live tokens, connected apps)
      // before removing the data. If the revoke fails, the data is untouched
      // and the call can simply be repeated.
      toolkitHost.evict?.(uid);
      relay.dropUser(uid);
      profileEvents.dropUser(uid);
      activity.forget(uid);
      await registry.dropUser(uid);
      const revoked = await revokeTokensFor(store, uid);
      const wiped = await store.deleteUser(uid);
      // Evict again. Anything that read the partition during the wipe could
      // have re-cached an instance holding pre-delete state.
      toolkitHost.evict?.(uid);
      log.info('user.deleted', { uid, deleted: wiped, revokedTokens: revoked, by: 'admin' });
      return { deleted: wiped, revokedTokens: revoked };
    });
  }

  function listener(req, res) {
    const started = process.hrtime.bigint();
    res.once('close', () => logRequest(req, res, started));
    handle(req, res).catch((e) => {
      const path = pathOf(req);
      // A token-document write that lost the race to another instance, or a
      // lock that never freed: the request is fine, the moment was not.
      if (e?.code === 'CONFLICT' || e?.code === 'LOCK_TIMEOUT') {
        log.warn('http.busy', { method: req.method, path, uid: req.auth?.uid, error: e });
        if (res.headersSent) return res.end();
        res.setHeader('Retry-After', '1');
        return sendJSON(res, 503, { error: 'busy', message: e.message });
      }
      log.error('http.error', { method: req.method, path, uid: req.auth?.uid, error: e });
      if (res.headersSent) return res.end();
      sendJSON(res, 500, { error: 'internal-error', message: e.message });
    });
  }
  listener.relay = relay;
  listener.accounts = accounts;
  listener.activity = activity;
  listener.registry = registry;
  return listener;

  // One entry per request, after it ends: method, path (never the query
  // string), status, duration and the authenticated uid. Liveness checks are
  // left out and successful static files are debug-level, so the log is
  // about what people and apps did.
  function logRequest(req, res, started) {
    const path = pathOf(req);
    if (path === '/v1/healthz' || path === '/favicon.ico') return;
    const status = res.statusCode;
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const fields = {
      method: req.method, path, status, ms,
      uid: req.auth?.uid, tokenKind: req.auth?.kind,
      ...(res.writableFinished ? {} : { aborted: true }),
      client: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200) || undefined,
      message: `${req.method} ${path} ${status} ${ms}ms${req.auth?.uid ? ` uid=${req.auth.uid}` : ''}`,
    };
    const isStatic = req.method === 'GET' && (path.startsWith(SDK_PREFIX) || path.startsWith(SKILL_PREFIX) || path.startsWith(ADMIN_ASSETS_PREFIX) || path.startsWith('/developer'));
    if (status >= 500) log.error('http.request', fields);
    else if (status >= 400) log.warn('http.request', fields);
    else if (isStatic) log.debug('http.request', fields);
    else log.info('http.request', fields);
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://internal');
    } catch {
      return sendJSON(res, 400, { error: 'bad-request' });
    }
    const { pathname } = url;
    const method = req.method;

    // Only explicitly allowed browser origins may call the bearer-auth API.
    // Same-origin requests work without configuration; admin routes stay local.
    // `*` (a workshop setting) allows any origin: every /v1/ route
    // authenticates with a bearer token the page must hold itself — never a
    // cookie or other credential the browser attaches on its own — so a
    // foreign page gains nothing it did not already have.
    if (pathname.startsWith('/v1/')) {
      const origin = req.headers.origin;
      if (origin && (anyOrigin || corsOrigins.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
            'Access-Control-Max-Age': '600',
            // A public page reaching a toolkit on localhost (Chrome's
            // private-network preflight).
            ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
          });
          return res.end();
        }
      } else if (method === 'OPTIONS') {
        return sendJSON(res, 403, { error: 'origin-not-allowed' });
      }
    }

    // The Adapter MCP SDK, for apps to import straight from their toolkit,
    // and the coding-agent skill (the same explicit list of files).
    if (pathname.startsWith(SDK_PREFIX) || pathname.startsWith(SKILL_PREFIX)) {
      if (method === 'OPTIONS') return serveSdkAsset(res, null, req);
      if ((method === 'GET' || method === 'HEAD') && SDK_ASSETS.has(pathname)) return serveSdkAsset(res, SDK_ASSETS.get(pathname), req);
      return sendJSON(res, 404, { error: 'not-found' });
    }

    if (method === 'GET' && DEVELOPER_ASSETS.has(pathname)) {
      return serveDeveloperAsset(res, DEVELOPER_ASSETS.get(pathname));
    }

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
      return serveAdminPage(res);
    }
    // The console's script and styles: public code, no data.
    if (method === 'GET' && pathname.startsWith(ADMIN_ASSETS_PREFIX)) {
      const asset = ADMIN_ASSETS.get(pathname);
      return asset ? serveAdminAsset(res, asset) : sendJSON(res, 404, { error: 'not-found' });
    }

    // The browser attaches the cached Basic credential to ANY request to this
    // origin, including one a foreign page triggers with a form post. A POST
    // carrying that ambient credential must therefore be same-origin JSON
    // (which a cross-site form cannot send without a CORS preflight these
    // routes never answer). Bearer callers (scripts, tests) are unaffected.
    if (pathname.startsWith('/admin/') && method === 'POST' && /^Basic\s/i.test(String(req.headers['authorization'] || ''))) {
      const type = String(req.headers['content-type'] || '');
      const origin = req.headers.origin;
      let sameOrigin = true;
      if (origin) {
        try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
      }
      if (!type.toLowerCase().startsWith('application/json') || !sameOrigin) {
        return sendJSON(res, 403, { error: 'forbidden', message: 'Admin changes from a browser must be same-origin JSON requests.' });
      }
    }

    if (pathname === ADMIN_ACCOUNTS_PREFIX || pathname.startsWith(ADMIN_ACCOUNTS_PREFIX + '/')) {
      if (!verifyAdminHeader(adminPassword, req.headers['authorization'])) {
        return sendJSON(res, 401, { error: 'unauthorized' });
      }
      return adminAccountRoutes(req, res, method, pathname);
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
      return sendJSON(res, 200, { uid: rec.uid, label: rec.label, kind: rec.kind });
    }

    // Developer sign-in and the signed-in account's own settings.
    if (pathname.startsWith(AUTH_PREFIX) || pathname === ACCOUNT_PREFIX || pathname.startsWith(ACCOUNT_PREFIX + '/')) {
      return accountRoutes(req, res, method, pathname);
    }

    // Adapter MCP. The toolkit's own MCP server (the adapter registry, where
    // apps share adapters) is /v1/mcp itself; under it, live control of apps
    // that are connected right now: their providers, their MCP endpoints and
    // the account's grouped view of them.
    if (pathname === REGISTRY_PATH) {
      try { return await registry.handle(req, res, method); } catch (e) { return sendHttpError(res, e); }
    }
    if (pathname === PROVIDERS_PREFIX || pathname.startsWith(PROVIDERS_PREFIX + '/')
      || pathname.startsWith(MCP_PREFIX)
      || pathname === APPS_PREFIX || pathname.startsWith(APPS_PREFIX + '/')) {
      return providerRoutes(req, res, method, pathname);
    }

    // The adapter marketplace (CONTRACT.md "Adapter marketplace"). Its own
    // router owns auth: user bearer for everything, admin password additionally
    // for moderation.
    if (pathname === ADAPTERS_PREFIX || pathname.startsWith(ADAPTERS_PREFIX + '/')) {
      return adaptersRouter(req, res, method, pathname, url);
    }

    if (pathname.startsWith(PROFILE_PREFIX + '/')) {
      return profileEvents.route(req, res, method, pathname);
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
      // A uid is one path segment: the store lists and deletes partitions by
      // it, so a uid with a separator would be listed under, and deleted with,
      // another user's partition.
      try { assertSafeUid(body.uid); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      // Admin-minted tokens are app tokens unless the caller says otherwise; a
      // session is a sign-in and cannot be minted here.
      const kind = body.kind === undefined ? 'app' : body.kind;
      if (!TOKEN_KINDS.includes(kind) || kind === 'session') return sendJSON(res, 400, { error: 'kind must be app or default' });
      const result = await issueToken(store, { uid: body.uid, label: body.label, kind });
      log.info('token.issued', { uid: result.uid, tokenId: result.id, kind, by: 'admin' });
      return sendJSON(res, 200, { token: result.token, uid: result.uid });
    }

    if (method === 'GET' && pathname === ADMIN_TOKENS_PREFIX) {
      return sendJSON(res, 200, await listTokens(store));
    }

    if (method === 'DELETE' && pathname.startsWith(ADMIN_TOKENS_PREFIX + '/')) {
      const id = decodeURIComponent(pathname.slice((ADMIN_TOKENS_PREFIX + '/').length));
      if (!id) return sendJSON(res, 404, { error: 'not-found' });
      const ok = await revokeToken(store, id);
      if (!ok) return sendJSON(res, 404, { error: 'not-found' });
      relay.dropTokens([id]);
      log.info('token.revoked', { tokenId: id, by: 'admin' });
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: 'not-found' });
  }

  // Admin: the user PROFILES themselves (a uid's `users/<uid>/` partition),
  // distinct from the access tokens above. GET lists every stored profile;
  // DELETE is the whole deletion story in one place: evict the cached toolkit
  // instance (so a stale in-memory instance cannot write the partition back),
  // revoke the uid's tokens (so a still-valid credential cannot recreate it),
  // then wipe the data. Same admin auth.
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
      // The only client error here is a uid that is not one path segment.
      // Anything the store throws after this point is the server's problem
      // and goes to the listener's handler.
      try { assertSafeUid(uid); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      const { deleted, revokedTokens } = await wipeUser(uid);
      // 404 only when there was nothing at all: no data AND no live tokens.
      if (!deleted && !revokedTokens) return sendJSON(res, 404, { error: 'not-found' });
      return sendJSON(res, 200, { ok: true, uid, revokedTokens });
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

    return await withUserLock(rec.uid, async () => {
      // Re-check the credential now that it is our turn. requireUser ran before
      // the body was read and before any queue wait, and a delete may have
      // revoked this token in between. Without this the whole queue is just
      // ordering, not safety.
      if (!(await verifyToken(store, bearerFrom(req)))) {
        return sendJSON(res, 401, { error: 'unauthorized' });
      }

      let instance;
      try {
        instance = await toolkitHost.getInstance(rec.uid);
      } catch (e) {
        log.error('librarian.instance.failed', { uid: rec.uid, error: e });
        return sendJSON(res, 500, { error: 'internal-error', message: e.message });
      }

      try {
        const result = await invokeLibrarianRoute(entry, instance, args);
        if (PROFILE_WRITES.has(routeName)) {
          // The console passes the preset it loaded as replaceProfile's second argument.
          // A failure to announce must not turn a stored write into an error.
          try { await profileEvents.changed(rec.uid, routeName === 'replaceProfile' ? cleanSelection(args[1]) : undefined); }
          catch (e) { log.warn('profile.announce.failed', { uid: rec.uid, errorCode: safeErrorText(e) }); }
        }
        return sendJSON(res, 200, { ok: true, result });
      } catch (e) {
        // Application errors are data, not transport failures (CONTRACT.md).
        // Logged by method and error code only: the message may quote the profile.
        log.warn('librarian.call.failed', { uid: rec.uid, method: routeName, errorCode: safeErrorText(e) });
        return sendJSON(res, 200, { ok: false, error: e.message });
      }
    });
  }

  async function requireUser(req, res) {
    const presented = bearerFrom(req);
    const rec = noteAuth(req, presented ? await verifyToken(store, presented) : null);
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

// readJSONBody keeps its old contract for the handlers above: a plain Error on
// bad JSON (they answer 400 invalid-json themselves).
async function readJSONBody(req) {
  try {
    return await readBody(req);
  } catch (e) {
    throw new Error(e.message);
  }
}

// Who the request authenticated as, for the request log (never the token).
function noteAuth(req, rec) {
  if (rec) req.auth = { uid: rec.uid, kind: rec.kind, tokenId: rec.id };
  return rec;
}

function pathOf(req) {
  return String(req.url || '').split('?')[0].slice(0, 300);
}

// Cloud Run puts the caller first in X-Forwarded-For.
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || undefined;
}
