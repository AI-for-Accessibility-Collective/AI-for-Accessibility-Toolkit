// Admin: developer accounts (behind the admin password, like /admin/tokens).
//
//   GET    /admin/accounts                   every account, with token and live-app counts
//   GET    /admin/accounts?passwords=1       {passwords: [{uid, displayName, password|null, reason?}]}
//   GET    /admin/accounts?format=csv        the same accounts and passwords as a CSV download
//   GET    /admin/accounts/{uid}/password    {password|null, reason?}: the password an admin issued
//   POST   /admin/accounts                   {uid, displayName?, password?} -> {account, password?}
//   POST   /admin/accounts/bulk              {accounts: [{uid, displayName?}]} -> per-row results
//   PUT    /admin/accounts/{uid}             {displayName}
//   POST   /admin/accounts/{uid}/password    {password?} -> {password?} (generated when omitted)
//   POST   /admin/accounts/{uid}/disable     turn off; revokes every token
//   POST   /admin/accounts/{uid}/enable      turn back on (a new default token at next sign-in)
//   DELETE /admin/accounts/{uid}             delete the account AND its data and tokens
//
// Passwords are never stored in the clear: the one an admin issued is kept
// encrypted so a workshop host can look it up again, until the developer
// changes it themselves (see accounts.js). Password replies are not cached.

import { HttpError, sendJSON, readJSON, segmentsAfter } from './http.js';
import { AccountError, normalizeUsername } from './accounts.js';
import { listTokens } from './auth.js';

export const ADMIN_ACCOUNTS_PREFIX = '/admin/accounts';
const MAX_BULK = 200;
const NO_STORE = { 'cache-control': 'no-store' };
const CSV_NOTES = {
  'changed-by-account': 'changed by the account; reset to issue a new one',
  'not-kept': 'issued before passwords were kept; reset to issue a new one',
  'unreadable': 'kept under an earlier secret; reset to issue a new one',
};

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {ReturnType<import('./accounts.js').createAccounts>} config.accounts
 * @param {ReturnType<import('./relay.js').createRelay>} config.relay
 * @param {(uid: string) => Promise<{deleted: boolean, revokedTokens: number}>} config.wipeUser
 */
export function createAdminAccountRoutes({ store, accounts, relay, wipeUser }) {
  async function rows() {
    const [all, tokens, users] = await Promise.all([accounts.list({ admin: true }), listTokens(store), store.listUsers()]);
    const now = Date.now();
    return all.map((a) => {
      const mine = tokens.filter(t => t.uid === a.uid && !t.revoked && !(t.expiresAt && t.expiresAt <= now));
      return {
        ...a,
        appTokens: mine.filter(t => t.kind !== 'session').length,
        sessions: mine.filter(t => t.kind === 'session').length,
        liveApps: relay.liveCount(a.uid),
        hasData: users.includes(a.uid),
      };
    });
  }

  // Every account with its admin-issued password, for a workshop host's
  // records or a printed handout. Opened in a spreadsheet, so a field that
  // starts like a formula (a name a team chose) is made plain text.
  async function csv(res) {
    const [all, passwords] = await Promise.all([rows(), accounts.issuedPasswords()]);
    const byUid = new Map(passwords.map(p => [p.uid, p]));
    const cell = (value) => {
      let text = value == null ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const lines = [['username', 'name', 'password', 'password_note', 'status', 'last_sign_in', 'created', 'app_tokens', 'has_data']];
    for (const a of all) {
      const p = byUid.get(a.uid) || {};
      lines.push([a.uid, a.displayName, p.password ?? '', p.password == null ? CSV_NOTES[p.reason] || '' : '', a.disabled ? 'off' : 'on', iso(a.lastLoginAt), iso(a.createdAt), a.appTokens, a.hasData ? 'yes' : 'no']);
    }
    const body = `${lines.map(line => line.map(cell).join(',')).join('\r\n')}\r\n`;
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...NO_STORE,
    });
    res.end(body);
  }

  async function bulk(req, res) {
    const body = await readJSON(req);
    const rows = Array.isArray(body?.accounts) ? body.accounts : null;
    if (!rows || !rows.length || rows.length > MAX_BULK) throw new HttpError(400, 'invalid-bulk', `Send accounts: a list of 1–${MAX_BULK} {uid, displayName?}.`);
    const results = (await accounts.createMany(rows)).map(({ account, ...r }) => (r.ok ? { ...r, displayName: account.displayName } : r));
    return sendJSON(res, 200, { results });
  }

  async function route(req, res, method, pathname) {
    const segs = segmentsAfter(pathname, ADMIN_ACCOUNTS_PREFIX);
    if (!segs.length) {
      const query = new URL(req.url, 'http://admin').searchParams;
      if (method === 'GET' && query.get('format') === 'csv') return csv(res);
      if (method === 'GET' && query.get('passwords') === '1') {
        return sendJSON(res, 200, { passwords: await accounts.issuedPasswords() }, NO_STORE);
      }
      if (method === 'GET') return sendJSON(res, 200, { accounts: await rows() });
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
    if (segs.length === 2 && segs[1] === 'password' && method === 'GET') {
      return sendJSON(res, 200, { uid, ...(await accounts.issuedPassword(uid)) }, NO_STORE);
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
