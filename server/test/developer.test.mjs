import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { BUILTIN_PROFILES } from '../developer/profiles.js';
import { createClient, profileRows, setKey, removeKey, readSaved, writeSaved, SAVED_KEY } from '../developer/client.js';

const dir = await mkdtemp(path.join(tmpdir(), 'developer-test-'));
const store = fileStore(dir);
const server = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } }), corsOrigins: ['http://developer.test'] }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const asset of ['/developer', '/developer/', '/developer/app.js', '/developer/adapters.js', '/developer/styles.css', '/developer/client.js', '/developer/value-editor.js', '/developer/profiles.js']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await fetch(base + '/developer/missing.js')).status, 404);
  assert.equal((await fetch(base + '/developer/%2e%2e/.env')).status, 404);
  assert.equal((await fetch(base + '/v1/librarian/replaceProfile', { method: 'POST', body: '{}' })).status, 401);
  const preflight = await fetch(base + '/v1/librarian/replaceProfile', { method: 'OPTIONS', headers: { origin: 'http://developer.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://developer.test');
  assert.equal((await fetch(base + '/v1/whoami', { method: 'OPTIONS', headers: { origin: 'http://evil.test' } })).status, 403);
  const noAuth = await fetch(base + '/v1/whoami', { headers: { origin: 'http://developer.test' } });
  assert.equal(noAuth.status, 401, 'CORS never replaces authentication');
  assert.equal(noAuth.headers.get('access-control-allow-origin'), 'http://developer.test');
  assert.equal((await fetch(base + '/admin/tokens', { headers: { origin: 'http://developer.test' } })).headers.get('access-control-allow-origin'), null);
  async function token(uid) {
    const response = await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid }) });
    return (await response.json()).token;
  }
  const first = createClient(base + '/v1/', await token('first'));
  const second = createClient(base, await token('second'));
  assert.equal((await first.whoami()).uid, 'first');
  await second.call('setProfileField', 'freeText', 'second user');
  assert.equal(BUILTIN_PROFILES.length, 9);
  for (const [index, preset] of BUILTIN_PROFILES.entries()) {
    assert.equal(preset.name, `Profile ${index + 1}`);
    assert.ok(preset.description);
    await first.call('replaceProfile', { leftover: true });
    await first.call('replaceProfile', preset.profile);
    const current = await first.call('getProfile');
    assert.equal(current.leftover, undefined, 'loading removes previous keys');
    assert.deepEqual(current.fields, preset.profile.fields);
    const model = await first.call('getAbilityModel');
    assert.deepEqual(model.supportAreas, preset.profile.supportAreas);
    assert.equal(model.needs.length, preset.profile.fields.needs.length);
  }
  assert.equal((await second.call('getProfile')).freeText, 'second user');
  await assert.rejects(() => first.call('replaceProfile', { supportAreas: 'invalid' }), /supportAreas/);
  await assert.rejects(() => createClient(base, 'invalid').whoami(), /unauthorized/);
  const profile = { fields: { needs: [], arbitrary: { value: false } }, 'literal.dot': 'works' };
  const literal = profileRows(profile).find(row => row.path[0] === 'literal.dot');
  setKey(profile, literal.path, 'edited');
  setKey(profile, ['fields', 'arbitrary', 'new'], 3);
  removeKey(profile, ['fields', 'arbitrary', 'value']);
  assert.deepEqual(profile.fields.arbitrary, { new: 3 });
  assert.equal(profile['literal.dot'], 'edited');
  assert.throws(() => setKey(profile, ['constructor', 'bad'], true), /valid key/);
  const storage = { value: null, getItem(key) { assert.equal(key, SAVED_KEY); return this.value; }, setItem(key, value) { assert.equal(key, SAVED_KEY); this.value = value; } };
  const saved = [{ id: 'custom-one', name: 'Test', profile }];
  writeSaved(storage, saved);
  assert.deepEqual(readSaved(storage), saved);
  storage.value = '{}'; assert.throws(() => readSaved(storage), /invalid format/);
  storage.value = '[{"id":"wai-1","name":"bad","profile":{}}]'; assert.throws(() => readSaved(storage), /invalid/);
  console.log('Developer interface: assets, auth, CORS, all nine presets, toolkit updates, key editing, and persistence passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
