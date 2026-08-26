#!/usr/bin/env node
// Boots the app in-process (fileStore under a temp dir, a test ADMIN_PASSWORD,
// NO Gemini key) and drives it over real HTTP against an ephemeral port —
// exercising createApp() exactly the way index.js does, minus env plumbing.
// Run: node server/test/server-test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createGeminiCaller } from '../src/gemini.js';
import { createToolkitHost } from '../src/toolkit-host.js';

// The 36 extension `librarian*` message routes, independently transcribed
// from a host's `librarian*` switch (~lines
// 1798-1929) — an oracle kept separate from server/src/routes.js so this test
// actually checks the server against the extension's alias table, not just
// against its own copy of it.
const EXTENSION_ALIAS_ROUTES = [
  'getProfile', 'getAbilityModel', 'listProcedural', 'setProfileField',
  'recordScopedSettings', 'getSiteCategory', 'setSiteCategory', 'effectivePreferences',
  'recall', 'listMemories', 'listProposals', 'logObservation', 'respondToProposal',
  'deleteMemory', 'setPause', 'extractNow', 'reflectNow', 'listGrants', 'revokeGrant',
  'setSharingPaused', 'requestGrant', 'importInsight', 'exportAbilityModel', 'shareAudit',
  'getActingUser', 'setActingUser', 'exportProfileBlob', 'importProfileBlob',
  'importInsightOutbox', 'listSkills', 'retrieveSkill', 'findSkill', 'buildSkill',
  'resolveSkill', 'saveSkill', 'deleteSkill',
];
assert.equal(EXTENSION_ALIAS_ROUTES.length, 36, 'the oracle itself must list 36 routes');

// Direct-surface routes (voice side panel / chrome-actuation call these on the
// Librarian object, no librarian* message equivalent).
const DIRECT_SURFACE_ROUTES = [
  'interpretNeedsPrompt', 'hasScopedSetting', 'getScopedSetting',
  'removeScopedSetting', 'recordExplicitSetting',
];
// Natural-language notes — routed under their own method names.
const NOTE_ROUTES = ['addNote', 'listNotes', 'updateNote', 'deleteNote', 'findNotes'];
const ALL_ROUTES = [...EXTENSION_ALIAS_ROUTES, ...DIRECT_SURFACE_ROUTES, ...NOTE_ROUTES];
assert.equal(ALL_ROUTES.length, 46, 'contract total must be 46 routes'); // CONTRACT.md "46 routes total"

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   - ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.error(`  FAIL - ${name}`);
    console.error('    ' + (e.stack || e.message).split('\n').join('\n    '));
  }
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkit-service-test-'));
  const ADMIN_PASSWORD = 'test-admin-pass16';

  const store = fileStore(dataDir);
  const geminiCaller = createGeminiCaller({ apiKey: null }); // NO gemini key for this run
  const toolkitHost = createToolkitHost({ store, geminiCaller });
  const listener = createApp({ store, adminPassword: ADMIN_PASSWORD, toolkitHost, version: 'test' });
  const server = http.createServer(listener);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function call(method, urlPath, { token, adminToken, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (adminToken) headers['authorization'] = `Bearer ${adminToken}`;
    const resp = await fetch(base + urlPath, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await resp.json(); } catch { /* non-JSON body, e.g. the admin HTML page */ }
    return { status: resp.status, body: json };
  }

  try {
    // ---- healthz -----------------------------------------------------------
    await test('GET /healthz', async () => {
      const r = await call('GET', '/healthz');
      const rv1 = await call('GET', '/v1/healthz');
      assert.equal(rv1.status, 200);
      assert.equal(rv1.body.ok, true);
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.version, 'test');
    });

    // ---- meta: the full route set --------------------------------------------
    await test('GET /v1/meta lists all 46 routes (36 extension aliases + 5 direct-surface + 5 notes), all supported', async () => {
      const r = await call('GET', '/v1/meta');
      assert.equal(r.status, 200);
      const methods = r.body.librarian.methods;
      assert.equal(methods.length, ALL_ROUTES.length);
      assert.equal(r.body.librarian.unsupportedCount, 0);
      const metaRoutes = methods.map((m) => m.route).sort();
      assert.deepEqual(metaRoutes, [...ALL_ROUTES].sort());
      for (const m of methods) assert.equal(m.supported, true, `${m.route} -> ${m.target} not supported`);

      const byRoute = Object.fromEntries(methods.map((m) => [m.route, m]));
      assert.equal(byRoute.effectivePreferences.target, 'getEffectivePreferences');
      assert.equal(byRoute.setPause.kind, 'custom-librarian'); // arg-shape dispatch, see routes.js
      assert.equal(byRoute.extractNow.target, 'extract');
      assert.equal(byRoute.reflectNow.target, 'reflect');
      assert.equal(byRoute.findSkill.target, 'findSkillForNeed');
      assert.equal(byRoute.setSiteCategory.target, 'setSiteCategoryOverride');
      assert.equal(byRoute.shareAudit.kind, 'datastore');
    });

    // ---- every one of the 36 routes actually dispatches ----------------------
    let sweepToken;
    await test('admin: create token for the dispatch sweep', async () => {
      const r = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'sweep-user', label: 'sweep' } });
      assert.equal(r.status, 200);
      assert.equal(r.body.uid, 'sweep-user');
      assert.ok(r.body.token.startsWith('aat_'));
      sweepToken = r.body.token;
    });

    await test('all 36 routes resolve (never unknown-method)', async () => {
      for (const route of ALL_ROUTES) {
        const r = await call('POST', `/v1/librarian/${route}`, { token: sweepToken, body: { args: [] } });
        assert.notEqual(r.status, 404, `route ${route} returned 404`);
        assert.equal(typeof r.body?.ok, 'boolean', `route ${route}: body was ${JSON.stringify(r.body)}`);
      }
    });

    await test('setPause disambiguates by arg shape (memory vs origin)', async () => {
      const obs = (url) => call('POST', '/v1/librarian/logObservation', {
        token: sweepToken, body: { args: [{ url, kind: 'setting-changed', detail: { key: 'fontScale', value: 120 } }] },
      });
      // [paused] -> setMemoryPaused: GLOBAL pause -> observations drop with 'paused'
      let r = await call('POST', '/v1/librarian/setPause', { token: sweepToken, body: { args: [true] } });
      assert.equal(r.body.ok, true);
      let o = await obs('https://neutral-site.org/page');
      assert.equal(o.body.result?.logged, false);
      assert.equal(o.body.result?.reason, 'paused', `expected global pause, got ${JSON.stringify(o.body.result)}`);
      await call('POST', '/v1/librarian/setPause', { token: sweepToken, body: { args: [false] } });
      // [origin, paused] -> setOriginPaused: ONLY that origin drops, with 'origin-paused'
      r = await call('POST', '/v1/librarian/setPause', { token: sweepToken, body: { args: ['example.com', true] } });
      assert.equal(r.body.ok, true);
      o = await obs('https://example.com/page');
      assert.equal(o.body.result?.logged, false);
      assert.equal(o.body.result?.reason, 'origin-paused', `expected origin pause, got ${JSON.stringify(o.body.result)}`);
      o = await obs('https://neutral-site.org/page');
      assert.notEqual(o.body.result?.reason, 'origin-paused', 'other origins must be unaffected');
      assert.notEqual(o.body.result?.reason, 'paused', 'global pause must be off again');
      // leave the sweep user clean
      await call('POST', '/v1/librarian/setPause', { token: sweepToken, body: { args: ['example.com', false] } });
    });

    // ---- admin token CRUD + 401s ---------------------------------------------
    let tokenA, tokenAId, tokenB;

    await test('admin: 401 with missing admin token', async () => {
      const r = await call('POST', '/admin/tokens', { body: { uid: 'user-a' } });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'unauthorized');
    });

    await test('admin: 401 with wrong admin token', async () => {
      const r = await call('POST', '/admin/tokens', { adminToken: 'not-the-real-token', body: { uid: 'user-a' } });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'unauthorized');
    });

    await test('admin: create tokens for user-a and user-b', async () => {
      const ra = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-a', label: 'A' } });
      assert.equal(ra.status, 200);
      assert.equal(ra.body.uid, 'user-a');
      assert.ok(ra.body.token.startsWith('aat_'));
      tokenA = ra.body.token;

      const rb = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-b', label: 'B' } });
      assert.equal(rb.status, 200);
      tokenB = rb.body.token;
    });

    await test('admin: list tokens (no token values)', async () => {
      const r = await call('GET', '/admin/tokens', { adminToken: ADMIN_PASSWORD });
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.body));
      const rec = r.body.find((t) => t.uid === 'user-a');
      assert.ok(rec, 'user-a token not in list');
      assert.equal(rec.label, 'A');
      assert.equal(rec.revoked, false);
      assert.ok(rec.id);
      assert.equal(rec.hash, undefined);
      assert.equal(rec.token, undefined);
      tokenAId = rec.id;
    });

    await test('GET /v1/whoami with a fresh token', async () => {
      const r = await call('GET', '/v1/whoami', { token: tokenA });
      assert.equal(r.status, 200);
      assert.equal(r.body.uid, 'user-a');
      assert.equal(r.body.label, 'A');
    });

    await test('GET /v1/whoami: 401 missing token', async () => {
      const r = await call('GET', '/v1/whoami');
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'unauthorized');
    });

    await test('GET /v1/whoami: 401 bogus/unknown token', async () => {
      const r = await call('GET', '/v1/whoami', { token: 'aat_' + 'x'.repeat(43) });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'unauthorized');
    });

    await test('admin: revoke token A', async () => {
      const r = await call('DELETE', `/admin/tokens/${tokenAId}`, { adminToken: ADMIN_PASSWORD });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
    });

    await test('GET /v1/whoami: 401 for a revoked token', async () => {
      const r = await call('GET', '/v1/whoami', { token: tokenA });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, 'unauthorized');
    });

    await test('admin: revoking an unknown id -> 404', async () => {
      const r = await call('DELETE', '/admin/tokens/does-not-exist', { adminToken: ADMIN_PASSWORD });
      assert.equal(r.status, 404);
    });

    // ---- per-uid isolation ----------------------------------------------------
    await test('per-uid isolation: two uids write distinct profiles, no cross-read', async () => {
      const rc = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-c' } });
      const rd = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-d' } });
      const tokenC = rc.body.token;
      const tokenD = rd.body.token;

      const setC = await call('POST', '/v1/librarian/setProfileField', { token: tokenC, body: { args: ['freeText', 'C-only data'] } });
      assert.equal(setC.body.ok, true);
      const setD = await call('POST', '/v1/librarian/setProfileField', { token: tokenD, body: { args: ['freeText', 'D-only data'] } });
      assert.equal(setD.body.ok, true);

      const getC = await call('POST', '/v1/librarian/getProfile', { token: tokenC, body: { args: [] } });
      const getD = await call('POST', '/v1/librarian/getProfile', { token: tokenD, body: { args: [] } });
      assert.equal(getC.body.result.freeText, 'C-only data');
      assert.equal(getD.body.result.freeText, 'D-only data');

      // Cross-read with the wrong token must not see the other uid's write.
      assert.notEqual(getC.body.result.freeText, getD.body.result.freeText);
    });

    // ---- real flow over HTTP ---------------------------------------------------
    await test('real flow: setProfileField -> getAbilityModel -> recordScopedSettings -> getEffectivePreferences -> exportProfileBlob', async () => {
      const rt = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-flow' } });
      const token = rt.body.token;

      const set1 = await call('POST', '/v1/librarian/setProfileField', {
        token,
        body: { args: ['fields.needs', [{ dimension: 'textSize', value: 1.5, strength: 'preference', source: 'test' }]] },
      });
      assert.equal(set1.status, 200);
      assert.equal(set1.body.ok, true);

      const ability = await call('POST', '/v1/librarian/getAbilityModel', { token, body: { args: [] } });
      assert.equal(ability.body.ok, true);
      assert.ok(ability.body.result.needs.some((n) => n.dimension === 'textSize' && n.value === 1.5));

      const scoped = await call('POST', '/v1/librarian/recordScopedSettings', {
        token,
        body: { args: ['general', { fontScale: 150 }] },
      });
      assert.equal(scoped.body.ok, true);
      assert.ok(Array.isArray(scoped.body.result) && scoped.body.result.length === 1);

      const eff = await call('POST', '/v1/librarian/effectivePreferences', {
        token,
        body: { args: ['https://example.test/article', []] },
      });
      assert.equal(eff.body.ok, true);
      assert.equal(eff.body.result.settings.fontScale, 150);

      const blob = await call('POST', '/v1/librarian/exportProfileBlob', { token, body: { args: [] } });
      assert.equal(blob.body.ok, true);
      assert.ok(blob.body.result.abilityModel.needs.some((n) => n.dimension === 'textSize'));
    });

    // ---- librarian error surfaces as {ok:false,error} --------------------------
    await test('a thrown librarian error surfaces as {ok:false, error}, HTTP 200', async () => {
      const rt = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-err' } });
      const token = rt.body.token;
      // getSiteCategory(origin, opts = {}) — passing `null` explicitly bypasses
      // the default parameter (only `undefined` triggers it), so `opts.allowLlm`
      // throws a real TypeError inside the method.
      const r = await call('POST', '/v1/librarian/getSiteCategory', { token, body: { args: ['example.com', null] } });
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, false);
      assert.equal(typeof r.body.error, 'string');
      assert.ok(r.body.error.length > 0);
    });

    // ---- unknown method -> 404 --------------------------------------------------
    await test('unknown method -> 404 {error:"unknown-method"}', async () => {
      const rt = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid: 'user-404' } });
      const token = rt.body.token;
      const r = await call('POST', '/v1/librarian/definitelyNotAMethod', { token, body: { args: [] } });
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'unknown-method');
    });

    // ---- admin page: browser-popup (Basic) auth, remembered by the browser ------
    await test('GET /admin without auth -> 401 + WWW-Authenticate (browser popup)', async () => {
      const resp = await fetch(base + '/admin');
      assert.equal(resp.status, 401);
      assert.match(resp.headers.get('www-authenticate') || '', /^Basic /);
    });

    await test('GET /admin with Basic credential serves the page (no in-page password field)', async () => {
      const basic = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
      const resp = await fetch(base + '/admin', { headers: { authorization: `Basic ${basic}` } });
      assert.equal(resp.status, 200);
      const text = await resp.text();
      assert.ok(text.includes('Toolkit Service'));
      assert.ok(!text.includes('type="password"'), 'page must not ask for the password itself');
      assert.ok(text.includes('Sign out') && text.includes('signOutBtn'), 'page must offer a Sign out button');
      assert.ok(!text.includes('signed in via'), 'the explanatory sentence under the heading is gone');
    });

    await test('admin token CRUD accepts Basic too (page fetches ride the popup credential)', async () => {
      const basic = Buffer.from(`x:${ADMIN_PASSWORD}`).toString('base64'); // any username
      const resp = await fetch(base + '/admin/tokens', { headers: { authorization: `Basic ${basic}` } });
      assert.equal(resp.status, 200);
      assert.ok(Array.isArray(await resp.json()));
      const bad = Buffer.from('x:wrong-password!').toString('base64');
      const r2 = await fetch(base + '/admin/tokens', { headers: { authorization: `Basic ${bad}` } });
      assert.equal(r2.status, 401);
    });

    // ---- admin: list + delete user PROFILES (distinct from tokens) ----------
    await test('admin/users: list includes onboarded profiles, delete wipes one, unauth is 401', async () => {
      // Onboard two profiles (writing a profile field creates users/<uid>/).
      for (const uid of ['profile-a', 'profile-b']) {
        const t = await call('POST', '/admin/tokens', { adminToken: ADMIN_PASSWORD, body: { uid, label: 'onboard' } });
        const w = await call('POST', '/v1/librarian/setProfileField', { token: t.body.token, body: { args: ['supportAreas', ['vision']] } });
        assert.equal(w.body.ok, true, `setProfileField for ${uid}`);
      }

      // Unauthorized listing is rejected.
      const noauth = await call('GET', '/admin/users');
      assert.equal(noauth.status, 401);

      // List shows both profiles.
      const list = await call('GET', '/admin/users', { adminToken: ADMIN_PASSWORD });
      assert.equal(list.status, 200);
      assert.ok(list.body.users.includes('profile-a'));
      assert.ok(list.body.users.includes('profile-b'));

      // Delete one; it disappears from the list, the other remains.
      const del = await call('DELETE', '/admin/users/profile-a', { adminToken: ADMIN_PASSWORD });
      assert.equal(del.status, 200);
      assert.equal(del.body.ok, true);
      const list2 = await call('GET', '/admin/users', { adminToken: ADMIN_PASSWORD });
      assert.ok(!list2.body.users.includes('profile-a'));
      assert.ok(list2.body.users.includes('profile-b'));

      // Deleting a non-existent profile -> 404.
      const missing = await call('DELETE', '/admin/users/nope', { adminToken: ADMIN_PASSWORD });
      assert.equal(missing.status, 404);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
