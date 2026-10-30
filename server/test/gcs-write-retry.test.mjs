#!/usr/bin/env node
// gcsStore retries a write GCS rate limited (429) or could not take (503),
// with backoff. GCS allows about one write per second to an object; before
// this, a workshop's bulk account creation failed at the sixth account.
// Runs against a mocked fetch — no network, no GCS.
// Run: node server/test/gcs-write-retry.test.mjs

import assert from 'node:assert/strict';
import { gcsStore, StoreConflict } from '../src/store.js';

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log('PASS:', name);
}

let script = []; // statuses the next uploads answer with, in order
let uploads = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('http://metadata.google.internal/')) {
    return { ok: true, status: 200, json: async () => ({ access_token: 'test-token', expires_in: 3600 }) };
  }
  if (u.includes('/upload/')) {
    uploads++;
    const status = script.length ? script.shift() : 200;
    return { ok: status < 300, status, json: async () => ({}), text: async () => `status ${status}` };
  }
  throw new Error('unexpected fetch: ' + u);
};

const store = gcsStore('test-bucket', { retryBaseMs: 1 });

script = [429, 429, 503];
uploads = 0;
await store.writeJSON('admin/accounts.json', { accounts: {} });
ok('a write rate limited three times is retried until it lands', uploads === 4);

script = [429];
uploads = 0;
await store.writeJSONIf('admin/accounts.json', { accounts: {} }, '7');
ok('a conditional write is retried after a 429', uploads === 2);

script = [429, 412];
uploads = 0;
const conflict = await store.writeJSONIf('admin/accounts.json', {}, '7').catch(e => e);
ok('a 412 after a retry is still a conflict for the caller', conflict instanceof StoreConflict);

script = Array(10).fill(429);
uploads = 0;
const failed = await store.writeJSON('admin/accounts.json', {}).catch(e => e);
ok('a write that stays rate limited fails after six tries', failed instanceof Error && /429/.test(failed.message) && uploads === 6);

script = [500];
uploads = 0;
const broken = await store.writeJSON('admin/accounts.json', {}).catch(e => e);
ok('other errors are not retried', broken instanceof Error && uploads === 1);

console.log(`\nGCS write retry: ${pass} passed, 0 failed`);
