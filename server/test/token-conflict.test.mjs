#!/usr/bin/env node
// Two service instances sharing one token document must not overwrite each
// other's revocations. The in-process queue in auth.js cannot see the other
// instance, so the save is a conditional write: the file backend checks a
// content hash under a lock file, the GCS backend uses ifGenerationMatch, and
// a mutation that loses the race reloads and retries.
//
// The race here: instance A reads the document to issue a token; before A
// writes, instance B revokes an existing token; A's first write must fail and
// its retry must carry B's revocation. B is played by direct store calls, which
// is exactly what another process's auth.js does. Runs against a temp dir and a
// mocked GCS; no network.
// Run: node server/test/token-conflict.test.mjs

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { fileStore, gcsStore, StoreConflict } from '../src/store.js';
import { issueToken, listTokens, revokeToken, revokeTokensFor, verifyToken } from '../src/auth.js';

const TOKENS_DOC = 'admin/tokens.json';
let pass = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `${name}${detail !== undefined ? ` (${detail})` : ''}`);
  pass++;
  console.log('PASS:', name);
}

// ── A mock bucket with generations and ifGenerationMatch ──────────────────
// `stripGeneration` plays a proxy that drops the x-goog-generation header, so
// readDoc has to take its metadata-then-pinned-download path. `state.afterMeta`
// runs after a metadata read, which is where another instance can slip in.
function mockBucket({ stripGeneration = false } = {}) {
  const objects = new Map(); // name -> { gen, body }
  let nextGen = 1;
  const state = { conflicts: 0, uploads: 0, afterMeta: null };
  const json = (body, status = 200) => ({
    ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://metadata.google.internal/')) {
      return json({ access_token: 'test-token', expires_in: 3600 });
    }
    if (u.includes('/upload/storage/v1/')) {
      const params = new URL(u).searchParams;
      const name = params.get('name');
      const want = params.get('ifGenerationMatch');
      const current = objects.get(name)?.gen ?? 0;
      state.uploads++;
      if (want !== null && String(current) !== want) {
        state.conflicts++;
        return json({ error: 'precondition failed' }, 412);
      }
      objects.set(name, { gen: nextGen++, body: opts.body });
      return json({ generation: String(objects.get(name).gen) });
    }
    if ((opts.method || 'GET') === 'GET' && u.includes('/o/')) {
      const name = decodeURIComponent(new URL(u).pathname.split('/o/')[1]);
      const o = objects.get(name);
      if (!o) return json({ error: 'not found' }, 404);
      const params = new URL(u).searchParams;
      if (params.get('fields') === 'generation') {
        const reply = json({ generation: String(o.gen) });
        if (state.afterMeta) { const hook = state.afterMeta; state.afterMeta = null; await hook(); }
        return reply;
      }
      const pinned = params.get('generation');
      if (pinned !== null && pinned !== String(o.gen)) return json({ error: 'not found' }, 404);
      return {
        ok: true, status: 200,
        headers: new Headers(stripGeneration ? {} : { 'x-goog-generation': String(o.gen) }),
        json: async () => JSON.parse(o.body), text: async () => o.body,
      };
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return state;
}

// Instance A, whose first read of the token document pauses so "instance B"
// can write in between. Later reads (the retry) go straight through.
function pausingBefore(store, between) {
  let paused = false;
  return {
    ...store,
    async readDoc(key) {
      const doc = await store.readDoc(key);
      if (!paused) {
        paused = true;
        await between();
      }
      return doc;
    },
  };
}

async function raceScenario(label, storeA, storeB) {
  const first = await issueToken(storeA, { uid: 'first-user', label: 'first' });
  const firstId = (await listTokens(storeA)).find((t) => t.uid === 'first-user').id;

  // Instance B revokes the first token while A is between its read and write.
  const between = async () => {
    const { value, version } = await storeB.readDoc(TOKENS_DOC);
    value.tokens.find((t) => t.id === firstId).revoked = true;
    await storeB.writeJSONIf(TOKENS_DOC, value, version);
  };
  const second = await issueToken(pausingBefore(storeA, between), { uid: 'second-user', label: 'second' });

  const tokens = await listTokens(storeA);
  ok(`${label}: both tokens are in the document`, tokens.length === 2, tokens.length);
  ok(`${label}: the revocation from the other instance survived the concurrent issue`,
    tokens.find((t) => t.id === firstId).revoked === true);
  ok(`${label}: the revoked token no longer verifies`, (await verifyToken(storeA, first.token)) === null);
  ok(`${label}: the token issued during the race verifies`, (await verifyToken(storeA, second.token))?.uid === 'second-user');

  // The other direction: A revokes while B issues.
  const between2 = async () => {
    const { value, version } = await storeB.readDoc(TOKENS_DOC);
    value.tokens.push({ id: 'b-issued', uid: 'third-user', label: '', hash: 'f'.repeat(64), createdAt: 1, revoked: false });
    await storeB.writeJSONIf(TOKENS_DOC, value, version);
  };
  const n = await revokeTokensFor(pausingBefore(storeA, between2), 'second-user');
  const after = await listTokens(storeA);
  ok(`${label}: revokeTokensFor reports one revocation`, n === 1, n);
  ok(`${label}: the token the other instance issued during the race is kept`, after.some((t) => t.id === 'b-issued'));
  ok(`${label}: and the revocation landed`, after.find((t) => t.uid === 'second-user').revoked === true);

  // A revoke of an unknown id does not write at all.
  ok(`${label}: revoking an unknown id returns false`, (await revokeToken(storeA, 'no-such-id')) === false);
}

// ── File backend: two stores over one directory ────────────────────────────
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-conflict-'));
  const a = fileStore(dir);
  const b = fileStore(dir);
  await raceScenario('file', a, b);

  const stale = await a.readDoc(TOKENS_DOC);
  await b.writeJSONIf(TOKENS_DOC, { tokens: [] }, stale.version);
  await assert.rejects(a.writeJSONIf(TOKENS_DOC, { tokens: [{ id: 'x' }] }, stale.version), StoreConflict);
  ok('file: a write with a stale version throws StoreConflict', true);
  ok('file: a write to a missing document needs the null version',
    await b.writeJSONIf('admin/other.json', { tokens: [] }, null).then(() => true));
  const leftovers = (await fs.readdir(path.join(dir, 'admin'))).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp'));
  ok('file: no lock or temp files are left behind', leftovers.length === 0, leftovers.join(','));

  // A lock left by a process that died is taken over, and the write lands.
  const lock = path.join(dir, TOKENS_DOC + '.lock');
  await fs.writeFile(lock, 'dead-process');
  const old = new Date(Date.now() - 60000);
  await fs.utimes(lock, old, old);
  const before = await a.readDoc(TOKENS_DOC);
  await a.writeJSONIf(TOKENS_DOC, { tokens: [{ id: 'after-stale' }] }, before.version);
  ok('file: a stale lock is taken over', (await a.readDoc(TOKENS_DOC)).value.tokens[0].id === 'after-stale');
  const afterStale = (await fs.readdir(path.join(dir, 'admin'))).filter((f) => f.includes('.lock'));
  ok('file: the taken-over lock is gone afterwards', afterStale.length === 0, afterStale.join(','));

  // A lock someone else still holds is never removed by a writer that does
  // not own it, and that writer does not rename over the document.
  await fs.writeFile(lock, 'other-owner');
  const stolen = await a.readDoc(TOKENS_DOC);
  const err = await a.writeJSONIf(TOKENS_DOC, { tokens: [] }, stolen.version).then(() => null, (e) => e);
  ok('file: a fresh lock held by another owner is not stolen', err?.code === 'LOCK_TIMEOUT', err?.message);
  ok('file: and that owner\'s lock is still there', (await fs.readFile(lock, 'utf8')) === 'other-owner');
  ok('file: and the document was not touched', (await a.readDoc(TOKENS_DOC)).version === stolen.version);
  await fs.rm(dir, { recursive: true, force: true });
}

// ── GCS backend: two stores over one mocked bucket ─────────────────────────
{
  const bucket = mockBucket();
  const a = gcsStore('test-bucket');
  const b = gcsStore('test-bucket');
  await raceScenario('gcs', a, b);
  ok('gcs: each race cost exactly one 412 and one retry', bucket.conflicts === 2, bucket.conflicts);
  const doc = await a.readDoc(TOKENS_DOC);
  ok('gcs: the version is the object generation', /^\d+$/.test(doc.version) && doc.version !== '0', doc.version);
  ok('gcs: a missing document reads as generation 0', (await a.readDoc('admin/none.json')).version === '0');
}

// ── GCS behind a proxy that strips x-goog-generation ───────────────────────
{
  const bucket = mockBucket({ stripGeneration: true });
  const a = gcsStore('test-bucket');
  const b = gcsStore('test-bucket');
  await raceScenario('gcs, no generation header', a, b);
  const doc = await a.readDoc(TOKENS_DOC);
  ok('gcs, no generation header: the version still comes from the metadata read', /^\d+$/.test(doc.version) && doc.version !== '0', doc.version);

  // Another instance writes between the metadata read and the pinned
  // download: the read must not pair the newer version with an older body.
  bucket.afterMeta = async () => {
    const { value, version } = await b.readDoc(TOKENS_DOC);
    value.tokens.push({ id: 'slipped-in', uid: 'fourth-user', label: '', hash: 'e'.repeat(64), createdAt: 1, revoked: false });
    await b.writeJSONIf(TOKENS_DOC, value, version);
  };
  const midRead = await a.readDoc(TOKENS_DOC).then(() => null, (e) => e);
  ok('gcs, no generation header: a document that moves mid-read is a conflict, not a stale body', midRead instanceof StoreConflict, midRead?.message);

  // And the mutation loop rides that conflict out: the token issued during
  // the read survives alongside the one issued after it.
  bucket.afterMeta = async () => {
    const { value, version } = await b.readDoc(TOKENS_DOC);
    value.tokens.push({ id: 'slipped-in-2', uid: 'fifth-user', label: '', hash: 'd'.repeat(64), createdAt: 1, revoked: false });
    await b.writeJSONIf(TOKENS_DOC, value, version);
  };
  await issueToken(a, { uid: 'sixth-user', label: 'after the slip' });
  const all = await listTokens(a);
  ok('gcs, no generation header: the write that slipped in mid-read is kept', all.some((t) => t.id === 'slipped-in-2'));
  ok('gcs, no generation header: and the token issued around it landed', all.some((t) => t.uid === 'sixth-user'));
}

// ── A store without the conditional pair still works, single-process ───────
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-plain-'));
  const base = fileStore(dir);
  const plain = { readJSON: base.readJSON, writeJSON: base.writeJSON };
  const { token } = await issueToken(plain, { uid: 'plain-user' });
  ok('plain store: a token issues and verifies', (await verifyToken(plain, token))?.uid === 'plain-user');
  const id = (await listTokens(plain))[0].id;
  ok('plain store: a token revokes', (await revokeToken(plain, id)) === true && (await verifyToken(plain, token)) === null);
  await fs.rm(dir, { recursive: true, force: true });
}

console.log(`\nToken conflict: ${pass} passed, 0 failed`);
