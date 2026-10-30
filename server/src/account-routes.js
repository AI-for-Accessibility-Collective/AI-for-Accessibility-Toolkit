// Developer sign-in and the signed-in account's own settings.
//
//   POST   /v1/auth/login            {username, password} -> session + default token
//   POST   /v1/auth/logout           end this session
//   GET    /v1/account               account, default token, app tokens
//   PUT    /v1/account               {displayName} rename the account
//   POST   /v1/account/default-token regenerate the default token
//   POST   /v1/account/tokens        {label} -> a new app token (shown once)
//   DELETE /v1/account/tokens/{id}   revoke one of the account's app tokens
//   POST   /v1/account/password      {current, next}
//   GET    /v1/account/presets       saved profile presets
//   PUT    /v1/account/presets       {presets: [...]} replace them
//
// Everything under /v1/account needs a SESSION token: an app holding the
// default token can use the toolkit, but cannot mint tokens, read the default
// token back, or change the password.

import { HttpError, sendJSON, readJSON, segmentsAfter } from './http.js';
import { AccountError } from './accounts.js';
import { issueToken, revokeToken } from './auth.js';
import { silentLogger } from './log.js';
import { CONSOLE_DOC, readConsolePrefs } from './providers.js';

export const AUTH_PREFIX = '/v1/auth';
export const ACCOUNT_PREFIX = '/v1/account';
const MAX_PRESETS = 100;
const MAX_PRESETS_BYTES = 200_000;

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {ReturnType<import('./accounts.js').createAccounts>} config.accounts
 * @param {ReturnType<import('./relay.js').createRelay>} config.relay
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} config.withUserLock
 * @param {(req) => Promise<object|null>} config.authenticate
 */
export function createAccountRoutes({ store, accounts, relay, withUserLock, authenticate, log = silentLogger }) {
  async function requireSession(req) {
    const rec = await authenticate(req);
    if (!rec) throw new HttpError(401, 'unauthorized', 'Sign in again.');
    if (rec.kind !== 'session') throw new HttpError(403, 'session-required', 'Account settings need a developer console sign-in, not an app token.');
    return rec;
  }

  function clientAddress(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket?.remoteAddress || 'unknown';
  }

  function validatePresets(presets) {
    if (!Array.isArray(presets) || presets.length > MAX_PRESETS) throw new HttpError(400, 'invalid-presets', `presets must be a list of at most ${MAX_PRESETS}.`);
    for (const p of presets) {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id.startsWith('custom-') || p.id.length > 100
        || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120
        || (p.description !== undefined && (typeof p.description !== 'string' || p.description.length > 240))
        || !p.profile || typeof p.profile !== 'object' || Array.isArray(p.profile)) {
        throw new HttpError(400, 'invalid-presets', 'Each preset needs an id starting with custom-, a name, and a profile object.');
      }
    }
    if (JSON.stringify(presets).length > MAX_PRESETS_BYTES) throw new HttpError(400, 'invalid-presets', 'Saved presets are too large.');
    return presets.map(({ id, name, description, profile }) => ({ id, name: name.trim(), description: description || '', profile }));
  }

  async function route(req, res, method, pathname) {
    if (pathname === `${AUTH_PREFIX}/login` && method === 'POST') {
      const body = await readJSON(req);
      const result = await accounts.login({ username: body?.username, password: typeof body?.password === 'string' ? body.password : '', client: clientAddress(req) });
      return sendJSON(res, 200, { ok: true, ...result });
    }
    if (pathname === `${AUTH_PREFIX}/logout` && method === 'POST') {
      const rec = await requireSession(req);
      await accounts.logout(rec.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (!(pathname === ACCOUNT_PREFIX || pathname.startsWith(`${ACCOUNT_PREFIX}/`))) throw new HttpError(404, 'not-found');

    const rec = await requireSession(req);
    const segs = segmentsAfter(pathname, ACCOUNT_PREFIX);
    if (!segs.length && method === 'GET') {
      const overview = await accounts.overview(rec.uid);
      return sendJSON(res, 200, { ok: true, ...overview, session: { expiresAt: rec.expiresAt }, liveApps: relay.liveCount(rec.uid) });
    }
    if (!segs.length && method === 'PUT') {
      const body = await readJSON(req);
      const name = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 120) : '';
      if (!name) throw new HttpError(400, 'invalid-display-name', 'Send a displayName.');
      const account = await accounts.setDisplayName(rec.uid, name, 'account');
      return sendJSON(res, 200, { ok: true, account });
    }
    if (segs.length === 1 && segs[0] === 'default-token' && method === 'POST') {
      const defaultToken = await accounts.rotateDefaultToken(rec.uid);
      return sendJSON(res, 200, { ok: true, defaultToken });
    }
    if (segs[0] === 'tokens') {
      if (segs.length === 1 && method === 'POST') {
        const body = await readJSON(req);
        const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : 'App token';
        const issued = await issueToken(store, { uid: rec.uid, label, kind: 'app' });
        log.info('token.issued', { uid: rec.uid, tokenId: issued.id, kind: 'app', by: 'account' });
        return sendJSON(res, 200, { ok: true, token: issued.token, id: issued.id, label });
      }
      if (segs.length === 2 && method === 'DELETE') {
        const ok = await revokeToken(store, segs[1], { uid: rec.uid });
        if (!ok) throw new HttpError(404, 'not-found', 'No such token on this account.');
        relay.dropTokens([segs[1]]);
        log.info('token.revoked', { uid: rec.uid, tokenId: segs[1], by: 'account' });
        return sendJSON(res, 200, { ok: true });
      }
    }
    if (segs.length === 1 && segs[0] === 'password' && method === 'POST') {
      const body = await readJSON(req);
      await accounts.changePassword(rec.uid, { current: body?.current, next: body?.next }, rec.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (segs.length === 1 && segs[0] === 'presets') {
      if (method === 'GET') return sendJSON(res, 200, { ok: true, presets: (await readConsolePrefs(store, rec.uid)).presets });
      if (method === 'PUT') {
        const body = await readJSON(req);
        const presets = validatePresets(body?.presets);
        await withUserLock(rec.uid, async () => {
          const doc = (await store.readJSON(CONSOLE_DOC(rec.uid))) || {};
          doc.presets = presets;
          await store.writeJSON(CONSOLE_DOC(rec.uid), doc);
        });
        return sendJSON(res, 200, { ok: true, presets });
      }
    }
    throw new HttpError(404, 'not-found');
  }

  return async function handle(req, res, method, pathname) {
    try {
      return await route(req, res, method, pathname);
    } catch (e) {
      if (e instanceof AccountError) return sendJSON(res, e.status, { error: e.code, message: e.message });
      if (e instanceof HttpError) return sendJSON(res, e.status, { error: e.error, message: e.message, ...e.extra });
      throw e;
    }
  };
}
