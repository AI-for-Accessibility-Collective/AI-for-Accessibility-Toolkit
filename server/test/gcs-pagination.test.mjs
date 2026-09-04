#!/usr/bin/env node
// gcsStore listings must follow nextPageToken to exhaustion. GCS caps each
// listing page (1,000 objects by default); before this, listUsers and
// deleteUser read one page, so a large partition would be partly deleted
// while DELETE reported {ok:true}, and the admin user list silently capped.
// Runs against a mocked fetch — no network, no GCS.
// Run: node server/test/gcs-pagination.test.mjs

import assert from 'node:assert/strict';
import { gcsStore } from '../src/store.js';

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log('PASS:', name);
}

// ── Mock GCS: three pages of users, three pages of objects per user ─────────
const USER_PAGES = [
  { prefixes: ['users/alice/', 'users/bob/'], nextPageToken: 'u2' },
  { prefixes: ['users/carol/'], nextPageToken: 'u3' },
  { prefixes: ['users/dave/'] },
];
const OBJECT_PAGES = [
  { items: [{ name: 'users/alice/profile.json' }, { name: 'users/alice/memory.json' }], nextPageToken: 'o2' },
  { items: [{ name: 'users/alice/notes.json' }], nextPageToken: 'o3' },
  { items: [{ name: 'users/alice/skills.json' }] },
];

const deleted = [];
const listRequests = [];

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

  if (u.startsWith('http://metadata.google.internal/')) {
    return json({ access_token: 'test-token', expires_in: 3600 });
  }
  if ((opts.method || 'GET') === 'DELETE') {
    deleted.push(decodeURIComponent(u.split('/o/')[1]));
    return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
  }
  if (u.includes('/o?')) {
    const params = new URL(u).searchParams;
    listRequests.push(u);
    const pages = params.get('delimiter') ? USER_PAGES : OBJECT_PAGES;
    const tokenMap = { u2: 1, u3: 2, o2: 1, o3: 2 };
    const page = pages[tokenMap[params.get('pageToken')] ?? 0];
    return json(page);
  }
  throw new Error('unexpected fetch: ' + u);
};

const store = gcsStore('test-bucket');

// listUsers walks all three pages.
const users = await store.listUsers();
ok('listUsers aggregates every page', users.join(',') === 'alice,bob,carol,dave');

// deleteUser walks all pages of the object listing and deletes every object.
const wiped = await store.deleteUser('alice');
ok('deleteUser reports true', wiped === true);
ok('deleteUser removes objects from every page (4 of 4)', deleted.length === 4);
ok('the last page\'s object is included', deleted.includes('users/alice/skills.json'));

// The pagination actually happened (more than one list request per walk).
const withToken = listRequests.filter((u) => u.includes('pageToken=')).length;
ok('follow-up pages were requested via pageToken', withToken === 4);

console.log(`\nGCS pagination: ${pass} passed, 0 failed`);
