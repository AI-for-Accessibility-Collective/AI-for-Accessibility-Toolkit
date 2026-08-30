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
const base = `http://127.0.0.1:${server.address().port}`;

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

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\nDelete cascade: ${pass} passed, 0 failed`);
