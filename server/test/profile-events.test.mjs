// Which profile is selected, and the stream that says when it changes.
//
//   node server/test/profile-events.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'profile-events-test-'));
const store = fileStore(dir);
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: ADMIN, toolkitHost }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}
async function call(method, url, { token, admin, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function account(uid) {
  assert.equal((await call('POST', '/admin/accounts', { admin: true, body: { uid, password: `${uid}-password` } })).status, 201);
  const r = await call('POST', '/v1/auth/login', { body: { username: uid, password: `${uid}-password` } });
  sessions.set(r.body.defaultToken, r.body.token);
  return r.body.defaultToken;
}
const sessions = new Map(); // default token -> that account's sign-in session
const librarian = (token, method, ...args) => call('POST', `/v1/librarian/${method}`, { token, body: { args } });

// An open /v1/profile/events: the events seen so far, and a way to wait for the next one.
async function listen(token) {
  const controller = new AbortController();
  const res = await fetch(`${base}/v1/profile/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const seen = [];
  (async () => {
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = block.split('\n').find(l => l.startsWith('data: '));
          if (block.includes('event: profile') && data) seen.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  const next = async (count) => {
    const end = Date.now() + 3000;
    while (seen.length < count) {
      if (Date.now() > end) throw new Error(`timed out: ${seen.length} of ${count} events`);
      await new Promise(r => setTimeout(r, 20));
    }
    return seen[count - 1];
  };
  return { seen, next, close: () => controller.abort() };
}

const alice = await account('alice');
const bob = await account('bob');

await test('the stream and the selection need a token', async () => {
  assert.equal((await call('GET', '/v1/profile/selection')).status, 401);
  assert.equal((await fetch(`${base}/v1/profile/events`)).status, 401);
});

await test('nothing is selected at first, and the stream opens with that', async () => {
  assert.equal((await call('GET', '/v1/profile/selection', { token: alice })).body.selected, null);
  const events = await listen(alice);
  assert.equal((await events.next(1)).selected, null);
  events.close();
});

await test('loading a preset announces it, with no profile content', async () => {
  const events = await listen(alice);
  const first = await events.next(1);
  const profile = { freeText: 'I need large text', fields: { fontScale: 1.5 } };
  assert.equal((await librarian(alice, 'replaceProfile', profile, { id: 'custom-1', name: 'Large text' })).body.ok, true);
  const second = await events.next(2);
  assert.ok(second.revision > first.revision);
  assert.deepEqual(second.selected, { id: 'custom-1', name: 'Large text', edited: false });
  assert.ok(!JSON.stringify(second).includes('large text'));
  assert.deepEqual((await call('GET', '/v1/profile/selection', { token: alice })).body.selected, second.selected);
  events.close();
});

await test('editing a field keeps the name and marks it edited; replacing without a preset clears it', async () => {
  const events = await listen(alice);
  await events.next(1);
  assert.equal((await librarian(alice, 'setProfileField', 'freeText', 'Bigger still')).body.ok, true);
  assert.deepEqual((await events.next(2)).selected, { id: 'custom-1', name: 'Large text', edited: true });
  assert.equal((await librarian(alice, 'replaceProfile', { freeText: 'Plain' })).body.ok, true);
  assert.equal((await events.next(3)).selected, null);
  events.close();
});

await test('replacing with a preset marked edited keeps the mark (the console\'s temporary profile)', async () => {
  const events = await listen(alice);
  await events.next(1);
  assert.equal((await librarian(alice, 'replaceProfile', { freeText: 'Large, and bold' }, { id: 'custom-1', name: 'Large text', edited: true })).body.ok, true);
  assert.deepEqual((await events.next(2)).selected, { id: 'custom-1', name: 'Large text', edited: true });
  await librarian(alice, 'replaceProfile', { freeText: 'x' }, { id: 'custom-1', name: 'Large text', edited: 'yes' });
  assert.equal((await events.next(3)).selected.edited, false, 'only true marks it');
  events.close();
});

await test('a bad selection is ignored, and a failed write announces nothing', async () => {
  const events = await listen(alice);
  await events.next(1);
  await librarian(alice, 'replaceProfile', { freeText: 'x' }, { id: 5, name: [] });
  assert.equal((await events.next(2)).selected, null);
  const failed = await librarian(alice, 'replaceProfile', 'not an object', { id: 'custom-2', name: 'Nope' });
  assert.equal(failed.body.ok, false);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(events.seen.length, 2);
  events.close();
});

await test('one account never hears another account', async () => {
  const events = await listen(bob);
  await events.next(1);
  await librarian(alice, 'replaceProfile', { freeText: 'alice again' }, { id: 'custom-9', name: 'Alice only' });
  await new Promise(r => setTimeout(r, 150));
  assert.equal(events.seen.length, 1);
  assert.equal((await call('GET', '/v1/profile/selection', { token: bob })).body.selected, null);
  events.close();
});

await test('presets: the built-in ones, then the account\'s saved ones, without their content', async () => {
  const profile = { freeText: 'Saved by alice', fields: {} };
  const put = await call('PUT', '/v1/account/presets', { token: sessions.get(alice), body: { presets: [{ id: 'custom-mine', name: 'Mine', description: 'My own', profile }] } });
  assert.equal(put.status, 200);
  const { status, body } = await call('GET', '/v1/profile/presets', { token: alice }); // a default token, not a session
  assert.equal(status, 200);
  assert.equal(body.presets.filter(p => p.builtIn).length, 9);
  assert.deepEqual(body.presets.at(-1), { id: 'custom-mine', name: 'Mine', description: 'My own', builtIn: false });
  assert.ok(!JSON.stringify(body).includes('Saved by alice'));
  assert.equal((await call('GET', '/v1/profile/presets', { token: bob })).body.presets.length, 9, 'not another account\'s presets');
});

await test('select loads a preset like the console does, and announces it', async () => {
  const events = await listen(alice);
  await events.next(1);
  const built = await call('POST', '/v1/profile/select', { token: alice, body: { id: 'wai-2' } });
  assert.equal(built.status, 200);
  assert.deepEqual(built.body.selected, { id: 'wai-2', name: 'Profile 2', edited: false });
  assert.match(built.body.profile.freeText, /remove distracting motion/);
  assert.deepEqual((await events.next(2)).selected, built.body.selected);
  assert.match((await librarian(alice, 'getProfile')).body.result.freeText, /remove distracting motion/);
  const mine = await call('POST', '/v1/profile/select', { token: alice, body: { id: 'custom-mine' } });
  assert.equal(mine.body.profile.freeText, 'Saved by alice');
  assert.equal((await events.next(3)).selected.name, 'Mine');
  events.close();
});

await test('select refuses an unknown preset, another account\'s preset, a missing id and no token', async () => {
  assert.equal((await call('POST', '/v1/profile/select', { token: alice, body: { id: 'wai-99' } })).status, 404);
  assert.equal((await call('POST', '/v1/profile/select', { token: bob, body: { id: 'custom-mine' } })).status, 404);
  assert.equal((await call('POST', '/v1/profile/select', { token: alice, body: {} })).status, 400);
  assert.equal((await call('POST', '/v1/profile/select', { body: { id: 'wai-2' } })).status, 401);
  assert.equal((await call('GET', '/v1/profile/select', { token: alice })).status, 405);
  assert.equal((await call('GET', '/v1/profile/selection', { token: alice })).body.selected.id, 'custom-mine', 'a refused select changes nothing');
});

await test('the selection survives a restart', async () => {
  await librarian(alice, 'replaceProfile', { freeText: 'kept' }, { id: 'custom-3', name: 'Kept' });
  const again = http.createServer(createApp({ store, adminPassword: ADMIN, toolkitHost: createToolkitHost({ store, geminiCaller: async () => { throw new Error('off'); } }) }));
  await new Promise(resolve => again.listen(0, '127.0.0.1', resolve));
  const res = await fetch(`http://127.0.0.1:${again.address().port}/v1/profile/selection`, { headers: { authorization: `Bearer ${alice}` } });
  assert.deepEqual((await res.json()).selected, { id: 'custom-3', name: 'Kept', edited: false });
  again.closeAllConnections?.();
  await new Promise(r => again.close(r));
});

server.closeAllConnections?.();
await new Promise(r => server.close(r));
await rm(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
