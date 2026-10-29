// Admin: developer accounts (behind the admin password, like /admin/tokens).
//
//   GET    /admin/accounts                   every account, with token and live-app counts
//   POST   /admin/accounts                   {uid, displayName?, password?} -> {account, password?}
//   POST   /admin/accounts/bulk              {accounts: [{uid, displayName?}]} -> per-row results
//   PUT    /admin/accounts/{uid}             {displayName}
//   POST   /admin/accounts/{uid}/password    {password?} -> {password?} (generated when omitted)
//   POST   /admin/accounts/{uid}/disable     turn off; revokes every token
//   POST   /admin/accounts/{uid}/enable      turn back on (a new default token at next sign-in)
//   DELETE /admin/accounts/{uid}             delete the account AND its data and tokens
//
// A generated password is returned once and never stored in the clear.

import { HttpError, sendJSON, readJSON, segmentsAfter } from './http.js';
import { AccountError, normalizeUsername } from './accounts.js';
import { listTokens } from './auth.js';

export const ADMIN_ACCOUNTS_PREFIX = '/admin/accounts';
const MAX_BULK = 200;

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {ReturnType<import('./accounts.js').createAccounts>} config.accounts
 * @param {ReturnType<import('./relay.js').createRelay>} config.relay
 * @param {(uid: string) => Promise<{deleted: boolean, revokedTokens: number}>} config.wipeUser
 */
export function createAdminAccountRoutes({ store, accounts, relay, wipeUser }) {
  async function list(res) {
    const [all, tokens, users] = await Promise.all([accounts.list(), listTokens(store), store.listUsers()]);
    const now = Date.now();
    const rows = all.map((a) => {
      const mine = tokens.filter(t => t.uid === a.uid && !t.revoked && !(t.expiresAt && t.expiresAt <= now));
      return {
        ...a,
        appTokens: mine.filter(t => t.kind !== 'session').length,
        sessions: mine.filter(t => t.kind === 'session').length,
        liveApps: relay.liveCount(a.uid),
        hasData: users.includes(a.uid),
      };
    });
    return sendJSON(res, 200, { accounts: rows });
  }

  async function bulk(req, res) {
    const body = await readJSON(req);
    const rows = Array.isArray(body?.accounts) ? body.accounts : null;
    if (!rows || !rows.length || rows.length > MAX_BULK) throw new HttpError(400, 'invalid-bulk', `Send accounts: a list of 1–${MAX_BULK} {uid, displayName?}.`);
    const results = [];
    // One at a time: each hashes a password, and the shared document queues anyway.
    for (const row of rows) {
      const uid = normalizeUsername(row?.uid);
      try {
        const created = await accounts.create({ uid, displayName: row?.displayName });
        results.push({ uid, ok: true, displayName: created.account.displayName, password: created.password });
      } catch (e) {
        if (!(e instanceof AccountError)) throw e;
        results.push({ uid, ok: false, error: e.code, message: e.message });
      }
    }
    return sendJSON(res, 200, { results });
  }

  async function route(req, res, method, pathname) {
    const segs = segmentsAfter(pathname, ADMIN_ACCOUNTS_PREFIX);
    if (!segs.length) {
      if (method === 'GET') return list(res);
      if (method === 'POST') {
        const body = await readJSON(req);
        const created = await accounts.create({ uid: body?.uid, displayName: body?.displayName, password: body?.password });
        return sendJSON(res, 201, created);
      }
      throw new HttpError(405, 'method-not-allowed');
    }
    if (segs.length === 1 && segs[0] === 'bulk' && method === 'POST') return bulk(req, res);
    const uid = normalizeUsername(segs[0]);
    if (!(await accounts.get(uid))) throw new HttpError(404, 'not-found', `No account named ${uid}.`);
    if (segs.length === 1 && method === 'PUT') {
      const body = await readJSON(req);
      const name = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 120) : '';
      if (!name) throw new HttpError(400, 'invalid-display-name', 'Send a displayName.');
      const updated = await accounts.setDisplayName(uid, name);
      return sendJSON(res, 200, { ok: true, account: updated });
    }
    if (segs.length === 1 && method === 'DELETE') {
      relay.dropUser(uid);
      const { revokedTokens } = await wipeUser(uid);
      await accounts.remove(uid);
      return sendJSON(res, 200, { ok: true, uid, revokedTokens });
    }
    if (segs.length === 2 && method === 'POST') {
      if (segs[1] === 'password') {
        const body = await readJSON(req);
        return sendJSON(res, 200, { ok: true, uid, ...(await accounts.resetPassword(uid, body?.password)) });
      }
      if (segs[1] === 'disable' || segs[1] === 'enable') {
        return sendJSON(res, 200, { ok: true, account: await accounts.setDisabled(uid, segs[1] === 'disable') });
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
