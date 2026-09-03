#!/usr/bin/env node
// Deleting a user must be the whole story: data wiped, tokens revoked, cached
// instance evicted. Regression test for the resurrection path where a
// still-valid token (or a stale cached instance) could write a wiped
// partition right back.
// Run: node server/test/delete-cascade.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'delete-cascade-'));
const store = fileStore(dir);
const toolkitHost = createToolkitHost({
  store,
  geminiCaller: async () => { throw new Error('no-llm-in-test'); },
});
const ADMIN = 'test-admin-password';
const listener = createApp({ store, adminPassword: ADMIN, toolkitHost, version: 'test' });
const server = http.createServer(listener);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function req(method, urlPath, { token, admin, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const resp = await fetch(base + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
}

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log('PASS:', name);
}

// Mint a token for alice and write profile data with it.
const mint = await req('POST', '/admin/tokens', { admin: true, body: { uid: 'alice', label: 'test' } });
ok('token minted', mint.status === 200 && typeof mint.body.token === 'string');
const token = mint.body.token;

const write = await req('POST', '/v1/librarian/setProfileField', { token, body: { args: ['supportAreas', ['vision']] } });
ok('authenticated write succeeds before delete', write.status === 200);

const listBefore = await req('GET', '/admin/users', { admin: true });
ok('alice is listed before delete', listBefore.body.users.includes('alice'));
ok('instance is cached before delete', toolkitHost._cacheSizeForTest() === 1);

// Delete alice.
const del = await req('DELETE', '/admin/users/alice', { admin: true });
ok('delete responds ok', del.status === 200 && del.body.ok === true);
ok('delete reports the revoked token', del.body.revokedTokens === 1);
ok('cached instance evicted', toolkitHost._cacheSizeForTest() === 0);

// The old token must be dead, and the partition must stay gone.
const writeAfter = await req('POST', '/v1/librarian/setProfileField', { token, body: { args: ['supportAreas', ['motor']] } });
ok('old token is rejected after delete', writeAfter.status === 401);

const listAfter = await req('GET', '/admin/users', { admin: true });
ok('alice stays deleted', !listAfter.body.users.includes('alice'));

// Deleting a uid that never existed is a 404, not a silent success.
const delMissing = await req('DELETE', '/admin/users/nobody', { admin: true });
ok('deleting an unknown uid is 404', delMissing.status === 404);

// ── the in-flight request ──────────────────────────────────────────────────
// Revoking tokens stops a request that has not authenticated yet. It does
// nothing about one that already did and is still on its way to the datastore:
// that request used to get a fresh toolkit instance after the evict and write
// the wiped partition straight back, so a person who asked for their disability
// data to be deleted still had a profile afterwards. Reproduced before the fix
// by holding a request between authentication and the write.
//
// A request's body is read AFTER the token is checked, so sending it in two
// pieces parks the request in exactly that gap without any test-only seam in
// the server.
function heldWrite(tok, value) {
  const payload = JSON.stringify({ args: ['freeText', value] });
  const cut = Math.floor(payload.length / 2);
  const r = http.request({
    port, host: '127.0.0.1', method: 'POST', path: '/v1/librarian/setProfileField',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tok}`,
      'content-length': Buffer.byteLength(payload),
    },
  });
  const done = new Promise((resolve) => r.on('response', async (res) => {
    let b = ''; for await (const c of res) b += c;
    resolve({ status: res.statusCode, body: JSON.parse(b || 'null') });
  }));
  r.write(payload.slice(0, cut));           // now past the token check, blocked on the body
  return { finish: () => r.end(payload.slice(cut)), done };
}

const bobToken = (await req('POST', '/admin/tokens', { admin: true, body: { uid: 'bob', label: 'test' } })).body.token;
await req('POST', '/v1/librarian/setProfileField', { token: bobToken, body: { args: ['supportAreas', ['vision']] } });
ok('bob exists before the race', (await req('GET', '/admin/users', { admin: true })).body.users.includes('bob'));

const held = heldWrite(bobToken, 'written by an in-flight request');
await new Promise((r) => setTimeout(r, 120));   // let it reach the gap
const delBob = await req('DELETE', '/admin/users/bob', { admin: true });
ok('delete during an in-flight write responds ok', delBob.status === 200);
held.finish();
const heldResult = await held.done;
ok('the in-flight write is refused after the delete', heldResult.status === 401);

await new Promise((r) => setTimeout(r, 150));   // give any stray write time to land
const afterRace = await req('GET', '/admin/users', { admin: true });
ok('bob is not resurrected by the in-flight write', !afterRace.body.users.includes('bob'));

// The other order must still work: a write that takes its turn BEFORE the
// delete completes normally, and the delete then removes it. Serializing must
// not turn a legitimate write into a 401.
const carolToken = (await req('POST', '/admin/tokens', { admin: true, body: { uid: 'carol', label: 'test' } })).body.token;
const carolWrite = await req('POST', '/v1/librarian/setProfileField', { token: carolToken, body: { args: ['freeText', 'hello'] } });
ok('a write with no delete racing it still succeeds', carolWrite.status === 200 && carolWrite.body.ok === true);
const delCarol = await req('DELETE', '/admin/users/carol', { admin: true });
ok('carol deletes cleanly afterwards', delCarol.status === 200);
ok('carol stays deleted', !(await req('GET', '/admin/users', { admin: true })).body.users.includes('carol'));

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nDelete cascade: ${pass} passed, 0 failed`);
