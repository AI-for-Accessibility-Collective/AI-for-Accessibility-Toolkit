// Developer accounts: admin management, sign-in, sessions vs app tokens, the
// derived default token, presets, and the admin CSRF guard.
//
//   node server/test/accounts.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { issueToken, verifyToken } from '../src/auth.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'accounts-test-'));
const store = fileStore(dir);
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: ADMIN, toolkitHost, corsOrigins: ['*'] }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}
async function call(method, url, { token, admin, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  if (admin) h.authorization = `Bearer ${ADMIN}`;
  const res = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = (username, password) => call('POST', '/v1/auth/login', { body: { username, password } });

try {
  let ada; // {password, session, defaultToken}

  await test('admin makes an account with a generated password (shown once)', async () => {
    const r = await call('POST', '/admin/accounts', { admin: true, body: { uid: 'Ada', displayName: 'Ada L.' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.account.uid, 'ada', 'usernames are lowercased');
    assert.match(r.body.password, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    assert.equal(r.body.account.passwordHash, undefined);
    ada = { password: r.body.password };
    const list = await call('GET', '/admin/accounts', { admin: true });
    assert.equal(list.body.accounts[0].uid, 'ada');
    assert.ok(!JSON.stringify(list.body).includes('scrypt'), 'no hashes in listings');
  });

  await test('admin account validation: duplicates, usernames, weak passwords, auth', async () => {
    assert.equal((await call('POST', '/admin/accounts', { admin: true, body: { uid: 'ada' } })).status, 409);
    assert.equal((await call('POST', '/admin/accounts', { admin: true, body: { uid: '../x' } })).status, 400);
    assert.equal((await call('POST', '/admin/accounts', { admin: true, body: { uid: 'bob', password: 'short' } })).status, 400);
    assert.equal((await call('POST', '/admin/accounts', { body: { uid: 'bob' } })).status, 401);
  });

  await test('sign-in returns a session and the default token; wrong password is 401', async () => {
    assert.equal((await login('ada', 'wrong-password')).status, 401);
    assert.equal((await login('nobody', 'whatever-123')).status, 401);
    const r = await login(' ADA ', ada.password);
    assert.equal(r.status, 200);
    assert.ok(r.body.token.startsWith('aat_') && r.body.defaultToken.startsWith('aat_'));
    assert.notEqual(r.body.token, r.body.defaultToken);
    assert.ok(r.body.expiresAt > Date.now());
    ada.session = r.body.token;
    ada.defaultToken = r.body.defaultToken;
  });

  await test('the default token is the same after every sign-in and is stored only as a hash', async () => {
    const again = await login('ada', ada.password);
    assert.equal(again.body.defaultToken, ada.defaultToken);
    const raw = JSON.stringify(await store.readJSON('admin/tokens.json')) + JSON.stringify(await store.readJSON('admin/accounts.json'));
    assert.ok(!raw.includes(ada.defaultToken) && !raw.includes(ada.session), 'no raw token at rest');
  });

  await test('sessions manage the account; app tokens use the toolkit but cannot manage', async () => {
    const who = await call('GET', '/v1/whoami', { token: ada.defaultToken });
    assert.deepEqual([who.body.uid, who.body.kind], ['ada', 'default']);
    const profile = await call('POST', '/v1/librarian/setProfileField', { token: ada.defaultToken, body: { args: ['freeText', 'from an app'] } });
    assert.equal(profile.body.ok, true);
    const fromSession = await call('POST', '/v1/librarian/getProfile', { token: ada.session, body: { args: [] } });
    assert.equal(fromSession.body.result.freeText, 'from an app', 'session and default token share the uid partition');
    const overview = await call('GET', '/v1/account', { token: ada.session });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.defaultToken, ada.defaultToken);
    assert.ok(overview.body.tokens.every(t => t.kind !== 'session'));
    assert.equal((await call('GET', '/v1/account', { token: ada.defaultToken })).status, 403);
    assert.equal((await call('POST', '/v1/account/tokens', { token: ada.defaultToken, body: { label: 'x' } })).status, 403);
  });

  await test('app tokens: make, use, revoke', async () => {
    const made = await call('POST', '/v1/account/tokens', { token: ada.session, body: { label: 'XR prototype' } });
    assert.equal(made.status, 200);
    assert.equal((await call('GET', '/v1/whoami', { token: made.body.token })).body.kind, 'app');
    assert.equal((await call('DELETE', `/v1/account/tokens/${made.body.id}`, { token: ada.session })).status, 200);
    assert.equal((await call('GET', '/v1/whoami', { token: made.body.token })).status, 401);
    assert.equal((await call('DELETE', '/v1/account/tokens/not-mine', { token: ada.session })).status, 404);
  });

  await test('regenerating the default token revokes the old one', async () => {
    const r = await call('POST', '/v1/account/default-token', { token: ada.session, body: {} });
    assert.notEqual(r.body.defaultToken, ada.defaultToken);
    assert.equal((await call('GET', '/v1/whoami', { token: ada.defaultToken })).status, 401);
    ada.defaultToken = r.body.defaultToken;
    assert.equal((await login('ada', ada.password)).body.defaultToken, ada.defaultToken, 'sign-in returns the new one');
  });

  await test('presets are stored in the account and validated', async () => {
    const presets = [{ id: 'custom-1', name: 'Large text', description: 'mine', profile: { fields: { needs: [] } } }];
    assert.equal((await call('PUT', '/v1/account/presets', { token: ada.session, body: { presets } })).status, 200);
    assert.deepEqual((await call('GET', '/v1/account/presets', { token: ada.session })).body.presets, presets);
    assert.equal((await call('PUT', '/v1/account/presets', { token: ada.session, body: { presets: [{ id: 'x', name: 'n', profile: {} }] } })).status, 400);
  });

  await test('changing the password keeps this session and signs out the others', async () => {
    const other = (await login('ada', ada.password)).body.token;
    assert.equal((await call('POST', '/v1/account/password', { token: ada.session, body: { current: 'nope', next: 'new-password-1' } })).status, 403);
    assert.equal((await call('POST', '/v1/account/password', { token: ada.session, body: { current: ada.password, next: 'new-password-1' } })).status, 200);
    ada.password = 'new-password-1';
    assert.equal((await call('GET', '/v1/account', { token: ada.session })).status, 200);
    assert.equal((await call('GET', '/v1/account', { token: other })).status, 401);
    assert.equal((await call('GET', '/v1/whoami', { token: ada.defaultToken })).status, 200, 'apps keep working');
  });

  await test('logout ends the session', async () => {
    const s = (await login('ada', ada.password)).body.token;
    assert.equal((await call('POST', '/v1/auth/logout', { token: s, body: {} })).status, 200);
    assert.equal((await call('GET', '/v1/account', { token: s })).status, 401);
  });

  await test('admin reset password signs the account out; disable cuts off every token; enable restores sign-in', async () => {
    const reset = await call('POST', '/admin/accounts/ada/password', { admin: true, body: {} });
    assert.ok(reset.body.password);
    assert.equal((await call('GET', '/v1/account', { token: ada.session })).status, 401);
    ada.password = reset.body.password;
    assert.equal((await call('POST', '/admin/accounts/ada/disable', { admin: true, body: {} })).status, 200);
    assert.equal((await login('ada', ada.password)).status, 403);
    assert.equal((await call('GET', '/v1/whoami', { token: ada.defaultToken })).status, 401);
    assert.equal((await call('POST', '/admin/accounts/ada/enable', { admin: true, body: {} })).status, 200);
    const back = await login('ada', ada.password);
    assert.equal(back.status, 200);
    assert.notEqual(back.body.defaultToken, ada.defaultToken, 'a new default token after re-enabling');
    assert.equal((await call('GET', '/v1/whoami', { token: back.body.defaultToken })).status, 200);
    ada.session = back.body.token; ada.defaultToken = back.body.defaultToken;
  });

  await test('admin rename and bulk create with per-row results', async () => {
    assert.equal((await call('PUT', '/admin/accounts/ada', { admin: true, body: { displayName: 'Ada Lovelace' } })).body.account.displayName, 'Ada Lovelace');
    const r = await call('POST', '/admin/accounts/bulk', { admin: true, body: { accounts: [{ uid: 'team-1', displayName: 'Team 1' }, { uid: 'team-2' }, { uid: 'ada' }, { uid: 'bad uid' }] } });
    assert.deepEqual(r.body.results.map(x => x.ok), [true, true, false, false]);
    assert.ok(r.body.results[0].password);
    assert.equal((await login('team-1', r.body.results[0].password)).status, 200);
  });

  await test('admin delete removes the account, its data and its tokens', async () => {
    const r = await call('DELETE', '/admin/accounts/ada', { admin: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.revokedTokens > 0);
    assert.equal((await login('ada', ada.password)).status, 401);
    assert.equal((await call('GET', '/v1/whoami', { token: ada.defaultToken })).status, 401);
    assert.ok(!(await store.listUsers()).includes('ada'));
  });

  await test('sign-in is rate limited after repeated failures', async () => {
    await call('POST', '/admin/accounts', { admin: true, body: { uid: 'limited', password: 'right-password' } });
    for (let i = 0; i < 10; i++) await login('limited', 'wrong-password');
    assert.equal((await login('limited', 'right-password')).status, 429);
  });

  await test('expired sessions do not verify; admins cannot mint sessions', async () => {
    const { token } = await issueToken(store, { uid: 'x', kind: 'session', expiresAt: Date.now() - 1 });
    assert.equal(await verifyToken(store, token), null);
    assert.equal((await call('POST', '/admin/tokens', { admin: true, body: { uid: 'x', kind: 'session' } })).status, 400);
  });

  await test('browser admin POSTs must be same-origin JSON (CSRF guard)', async () => {
    const basic = `Basic ${Buffer.from(`admin:${ADMIN}`).toString('base64')}`;
    const form = await fetch(base + '/admin/accounts', { method: 'POST', headers: { authorization: basic, 'content-type': 'text/plain' }, body: '{"uid":"evil","password":"evil-password"}' });
    assert.equal(form.status, 403);
    const foreign = await fetch(base + '/admin/accounts', { method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', origin: 'https://evil.test' }, body: '{"uid":"evil","password":"evil-password"}' });
    assert.equal(foreign.status, 403);
    const own = await fetch(base + '/admin/accounts', { method: 'POST', headers: { authorization: basic, 'content-type': 'application/json', origin: base }, body: '{"uid":"good","password":"good-password"}' });
    assert.equal(own.status, 201);
  });

  await test('CORS "*" answers any origin on /v1 and never on /admin', async () => {
    const pre = await fetch(base + '/v1/providers', { method: 'OPTIONS', headers: { origin: 'http://localhost:8000', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:8000');
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    assert.equal((await fetch(base + '/admin/accounts', { headers: { origin: 'http://localhost:8000' } })).headers.get('access-control-allow-origin'), null);
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nAccounts: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
