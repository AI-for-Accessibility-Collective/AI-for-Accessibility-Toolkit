// Adapter marketplace: registration, ownership, sync, code blobs, install
// state, and validation — against the real app over a real store.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';

const dir = await mkdtemp(path.join(tmpdir(), 'adapters-test-'));
const store = fileStore(dir);
const server = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } }) }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function token(uid) {
  const response = await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid }) });
  return (await response.json()).token;
}
async function api(method, pathname, { token: tok, admin, body } = {}) {
  const authorization = admin ? 'Bearer test-admin' : `Bearer ${tok}`;
  const response = await fetch(base + pathname, {
    method, headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

try {
  const ext = await token('browser-ext');
  const xr = await token('xr-app');
  const person = await token('person');

  // Auth floor.
  assert.equal((await fetch(base + '/v1/adapters')).status, 401, 'no token -> 401');
  assert.equal((await fetch(base + '/v1/adapters', { headers: { authorization: 'Bearer aat_nope' } })).status, 401);
  assert.equal((await api('GET', '/v1/adapters', { token: person })).status, 200);

  // Empty catalog.
  const empty = await api('GET', '/v1/adapters', { token: person });
  assert.deepEqual(empty.json, { adapters: [], apps: [] });

  // Register a data-only adapter.
  const dark = await api('POST', '/v1/adapters', { token: ext, body: {
    appId: 'browser-extension', appName: 'Browser Extension', id: 'dark-mode', name: 'Dark Mode',
    description: 'Inverts the page to a dark theme.', version: '1.0.0',
    settingsKeys: ['darkMode'], supportAreas: ['vision'], sourceUrl: 'https://example.test/ext',
  } });
  assert.equal(dark.status, 201);
  assert.equal(dark.json.adapter.kind, 'data');
  assert.equal(dark.json.adapter.registeredBy, 'browser-ext');
  assert.ok(dark.json.adapter.createdAt);

  // Duplicate -> 409.
  const dup = await api('POST', '/v1/adapters', { token: xr, body: { appId: 'browser-extension', id: 'dark-mode', name: 'Other' } });
  assert.equal(dup.status, 409);

  // Register with code -> kind 'code'.
  const CODE = 'const el = document.querySelector("h1"); if (el) el.style.letterSpacing = "0.12em";';
  const spaced = await api('POST', '/v1/adapters', { token: ext, body: {
    appId: 'browser-extension', id: 'letter-spacing', name: 'Letter Spacing', code: CODE, supportAreas: ['reading', 'vision'],
  } });
  assert.equal(spaced.status, 201);
  assert.equal(spaced.json.adapter.kind, 'code');
  assert.equal(spaced.json.adapter.codeSize, CODE.length);
  assert.match(spaced.json.adapter.codeSha256, /^[0-9a-f]{64}$/);

  // XR app registers its own adapters — same id, different app: no collision.
  const xrOneStep = await api('POST', '/v1/adapters', { token: xr, body: {
    appId: 'xr', appName: 'XR Task Guide', id: 'one-step', name: 'One Step at a Time',
    description: 'Speak one action, then wait.', supportAreas: ['cognitive'],
  } });
  assert.equal(xrOneStep.status, 201);
  const extOneStep = await api('POST', '/v1/adapters', { token: ext, body: { appId: 'browser-extension', id: 'one-step', name: 'One Step (web)' } });
  assert.equal(extOneStep.status, 201);

  // List: grouped metadata, per-caller mine/installed flags.
  const list = await api('GET', '/v1/adapters', { token: ext });
  assert.equal(list.json.adapters.length, 4);
  assert.deepEqual(list.json.apps.map(a => a.appId), ['browser-extension', 'xr']);
  assert.equal(list.json.apps.find(a => a.appId === 'browser-extension').name, 'Browser Extension');
  assert.equal(list.json.adapters.find(a => a.id === 'dark-mode').mine, true);
  assert.equal(list.json.adapters.find(a => a.appId === 'xr').mine, false);
  const personList = await api('GET', '/v1/adapters', { token: person });
  assert.equal(personList.json.adapters.every(a => a.mine === false), true);

  // Filters.
  assert.equal((await api('GET', '/v1/adapters?app=xr', { token: person })).json.adapters.length, 1);
  assert.deepEqual((await api('GET', '/v1/adapters?kind=code', { token: person })).json.adapters.map(a => a.id), ['letter-spacing']);
  assert.deepEqual((await api('GET', '/v1/adapters?mine=1', { token: xr })).json.adapters.map(a => a.id), ['one-step']);

  // Detail + code fetch.
  const one = await api('GET', '/v1/adapters/browser-extension/dark-mode', { token: person });
  assert.equal(one.status, 200);
  assert.equal(one.json.adapter.name, 'Dark Mode');
  const code = await api('GET', '/v1/adapters/browser-extension/letter-spacing/code', { token: person });
  assert.equal(code.json.code, CODE);
  assert.equal(code.json.size, CODE.length);
  assert.equal((await api('GET', '/v1/adapters/browser-extension/dark-mode/code', { token: person })).status, 404, 'data-only has no code');
  assert.equal((await api('GET', '/v1/adapters/browser-extension/missing', { token: person })).status, 404);

  // Ownership: another user's token cannot update or delete.
  assert.equal((await api('PUT', '/v1/adapters/browser-extension/dark-mode', { token: xr, body: { appId: 'browser-extension', id: 'dark-mode', name: 'Hijacked' } })).status, 403);
  assert.equal((await api('DELETE', '/v1/adapters/browser-extension/dark-mode', { token: xr })).status, 403);
  // Owner can update; code absent keeps the existing blob.
  const upd = await api('PUT', '/v1/adapters/browser-extension/letter-spacing', { token: ext, body: {
    appId: 'browser-extension', id: 'letter-spacing', name: 'Letter Spacing', version: '1.1.0', description: 'Wider letters.',
  } });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.adapter.version, '1.1.0');
  assert.equal(upd.json.adapter.kind, 'code', 'update without code keeps the blob');
  assert.equal((await api('GET', '/v1/adapters/browser-extension/letter-spacing/code', { token: person })).json.code, CODE);
  // Owner replaces code, then removes it with an empty string.
  const CODE2 = 'document.documentElement.style.wordSpacing = "0.1em";';
  assert.equal((await api('PUT', '/v1/adapters/browser-extension/letter-spacing', { token: ext, body: { appId: 'browser-extension', id: 'letter-spacing', name: 'Letter Spacing', code: CODE2 } })).status, 200);
  assert.equal((await api('GET', '/v1/adapters/browser-extension/letter-spacing/code', { token: person })).json.code, CODE2);
  const demoted = await api('PUT', '/v1/adapters/browser-extension/letter-spacing', { token: ext, body: { appId: 'browser-extension', id: 'letter-spacing', name: 'Letter Spacing', code: '' } });
  assert.equal(demoted.json.adapter.kind, 'data');
  assert.equal((await api('GET', '/v1/adapters/browser-extension/letter-spacing/code', { token: person })).status, 404);
  // Back to code for the sync tests below.
  await api('PUT', '/v1/adapters/browser-extension/letter-spacing', { token: ext, body: { appId: 'browser-extension', id: 'letter-spacing', name: 'Letter Spacing', code: CODE } });

  // Admin can moderate.
  assert.equal((await api('PUT', '/v1/adapters/xr/one-step', { admin: true, body: { appId: 'xr', id: 'one-step', name: 'One Step at a Time', description: 'admin edit' } })).status, 200);
  assert.equal((await api('DELETE', '/v1/adapters/browser-extension/one-step', { admin: true })).status, 200);

  // Sync: upsert own entries, skip another uid's, full prune of own stale ones.
  const sync = await api('POST', '/v1/adapters/sync', { token: xr, body: {
    appId: 'xr', appName: 'XR Task Guide', full: true,
    adapters: [
      { id: 'one-step', name: 'One Step at a Time', supportAreas: ['cognitive'] },
      { id: 'plain-words', name: 'Plain Words', supportAreas: ['cognitive', 'reading'] },
      { id: 'voice', name: 'Adapted Voice', code: '/* xr voice adapter */', supportAreas: ['hearing'] },
      { id: 'BAD ID', name: 'invalid slug gets skipped' },
    ],
  } });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.created, 2);
  assert.equal(sync.json.updated, 1);
  assert.equal(sync.json.skipped.length, 1);
  assert.match(sync.json.skipped[0].reason, /match/);
  const xrList = await api('GET', '/v1/adapters?app=xr', { token: person });
  assert.deepEqual(xrList.json.adapters.map(a => a.id), ['one-step', 'plain-words', 'voice']);
  assert.equal(xrList.json.adapters.find(a => a.id === 'voice').kind, 'code');
  assert.equal((await api('GET', '/v1/adapters/xr/voice/code', { token: person })).json.code, '/* xr voice adapter */');
  // full:true removes the caller's entries missing from the payload.
  const sync2 = await api('POST', '/v1/adapters/sync', { token: xr, body: { appId: 'xr', full: true, adapters: [{ id: 'one-step', name: 'One Step at a Time' }] } });
  assert.deepEqual(sync2.json.removed.sort(), ['plain-words', 'voice']);
  // Sync cannot overwrite another uid's entry under the same app.
  const cross = await api('POST', '/v1/adapters/sync', { token: person, body: { appId: 'browser-extension', adapters: [{ id: 'dark-mode', name: 'Not mine' }] } });
  assert.equal(cross.json.updated, 0);
  assert.equal(cross.json.skipped[0].reason, 'registered by another uid');
  // A non-full sync leaves existing entries alone.
  const sync3 = await api('POST', '/v1/adapters/sync', { token: xr, body: { appId: 'xr', adapters: [{ id: 'captions', name: 'Captions', supportAreas: ['hearing'] }] } });
  assert.equal(sync3.json.created, 1);
  assert.equal((await api('GET', '/v1/adapters?app=xr', { token: person })).json.adapters.length, 2);

  // Install state is per user.
  assert.equal((await api('PUT', '/v1/adapters/browser-extension/dark-mode/install', { token: person })).json.installed, true);
  assert.equal((await api('PUT', '/v1/adapters/browser-extension/dark-mode/install', { token: ext })).json.installed, true);
  const withInstall = await api('GET', '/v1/adapters?installed=1', { token: person });
  assert.deepEqual(withInstall.json.adapters.map(a => `${a.appId}/${a.id}`), ['browser-extension/dark-mode']);
  assert.equal((await api('GET', '/v1/adapters?installed=1', { token: xr })).json.adapters.length, 0, 'install state does not leak between users');
  assert.equal((await api('DELETE', '/v1/adapters/browser-extension/dark-mode/install', { token: person })).json.installed, false);
  assert.equal((await api('GET', '/v1/adapters?installed=1', { token: person })).json.adapters.length, 0);
  assert.equal((await api('PUT', '/v1/adapters/browser-extension/nope/install', { token: person })).status, 404);

  // Validation.
  const bad = [
    [{ appId: 'browser-extension', id: 'x' }, 'name required'],
    [{ appId: 'Bad App', id: 'x', name: 'n' }, 'appId slug'],
    [{ appId: 'sync', id: 'x', name: 'n' }, 'reserved appId'],
    [{ appId: 'a', id: 'bad id', name: 'n' }, 'id slug'],
    [{ appId: 'a', id: 'x', name: 'n', supportAreas: ['telepathy'] }, 'supportAreas set'],
    [{ appId: 'a', id: 'x', name: 'n', settingsKeys: [1] }, 'settingsKeys strings'],
    [{ appId: 'a', id: 'x', name: 'n', sourceUrl: 'javascript:alert(1)' }, 'url protocol'],
    [{ appId: 'a', id: 'x', name: 'n', code: 42 }, 'code string'],
    [{ appId: 'a', id: 'x', name: 'n', code: 'x'.repeat(256_001) }, 'code size'],
  ];
  for (const [body, why] of bad) {
    const r = await api('POST', '/v1/adapters', { token: person, body });
    assert.equal(r.status, 400, `400 expected (${why})`);
  }
  assert.equal((await fetch(base + '/v1/adapters/browser-extension/dark-mode/code/extra', { headers: { authorization: `Bearer ${person}` } })).status, 404, 'unknown shape -> 404');
  assert.equal((await api('PATCH', '/v1/adapters', { token: person, body: {} })).status, 405);

  // Path traversal and encoded slugs are refused.
  assert.equal((await api('GET', '/v1/adapters/..%2F..%2Fadmin/tokens', { token: person })).status, 404);
  assert.equal((await api('DELETE', '/v1/adapters/browser-extension/dark-mode', { token: ext })).status, 200, 'owner delete');
  assert.equal((await api('GET', '/v1/adapters/browser-extension/dark-mode', { token: person })).status, 404);

  // Deleting a user wipes their install state but leaves the catalog entry.
  await api('PUT', '/v1/adapters/browser-extension/letter-spacing/install', { token: person });
  assert.equal((await api('DELETE', '/admin/users/person', { admin: true })).status, 200);
  assert.equal((await store.readJSON('users/person/adapters.json')), null, 'per-user state gone with the partition');
  assert.equal((await api('GET', '/v1/adapters/browser-extension/letter-spacing', { token: ext })).status, 200, 'listing outlives the person');

  // The skill's helper packages an app's listing and submits it (adapter.mjs list-app).
  const helper = fileURLToPath(new URL('../../.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs', import.meta.url));
  const maker = await token('maker');
  const reader = await token('reader');
  const { TOOLKIT_URL: _u, TOOLKIT_TOKEN: _t, ...env } = process.env;
  const listApp = (...args) => promisify(execFile)(process.execPath, [helper, 'list-app', ...args], { cwd: dir, timeout: 30_000, env: { ...env, TOOLKIT_URL: base, TOOLKIT_TOKEN: maker } });
  const listingFile = path.join(dir, 'listing.json');
  await writeFile(path.join(dir, 'focus.js'), 'document.body.dataset.focus = "1";');
  const listing = { appId: 'museum-guide', appName: 'Museum guide', adapters: [
    { id: 'calm-audio', name: 'Calm audio', description: 'Speaks one step at a time, for people who lose track of long directions.', version: '1.2.0', supportAreas: ['cognitive'] },
    { id: 'focus-ring', name: 'Focus ring', description: 'Shows where the keyboard is.', supportAreas: ['motor'], codeFile: 'focus.js' },
  ] };
  await writeFile(listingFile, JSON.stringify(listing));
  const dry = await listApp(listingFile, '--dry-run');
  assert.match(dry.stdout, /Museum guide \(museum-guide\), 2 adapters:\n- Calm audio \(calm-audio 1\.2\.0, description only, for cognitive\)/);
  assert.match(dry.stdout, /Focus ring \(focus-ring, data \+ code, 34 characters, for motor\)/);
  assert.ok(!(await api('GET', '/v1/adapters', { token: maker })).json.adapters.some(a => a.appId === 'museum-guide'), 'a dry run submits nothing');
  const listed = await listApp(listingFile);
  assert.match(listed.stdout, /Listed: 2 new, 0 updated\./);
  const shown = (await api('GET', '/v1/adapters', { token: reader })).json;
  assert.deepEqual(shown.adapters.filter(a => a.appId === 'museum-guide').map(a => [a.id, a.kind, a.registeredBy]).sort(), [['calm-audio', 'data', 'maker'], ['focus-ring', 'code', 'maker']]);
  assert.equal(shown.apps.find(a => a.appId === 'museum-guide').name, 'Museum guide');
  assert.equal((await api('GET', '/v1/adapters/museum-guide/focus-ring/code', { token: reader })).json.code, 'document.body.dataset.focus = "1";');
  // A change: one adaptation left the app, so its listing is taken down.
  await writeFile(listingFile, JSON.stringify({ ...listing, adapters: [listing.adapters[0]] }));
  assert.match((await listApp(listingFile)).stdout, /Listed: 0 new, 1 updated, taken down: focus-ring\./);
  // A file that is not ready is refused before anything is sent.
  await writeFile(listingFile, JSON.stringify({ appId: 'Museum Guide', adapters: [{ id: 'x', name: 'X', supportAreas: ['eyes'] }] }));
  const refused = await listApp(listingFile).catch(e => e);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /appId: lowercase[\s\S]*appName[\s\S]*description: what it changes[\s\S]*eyes is not one of/);
  await writeFile(listingFile, JSON.stringify({ ...listing, adapters: [listing.adapters[0]] }));
  assert.match((await listApp(listingFile, '--remove')).stdout, /Took down Museum guide's listings: calm-audio\./);
  assert.ok(!(await api('GET', '/v1/adapters', { token: reader })).json.adapters.some(a => a.appId === 'museum-guide'));

  console.log('Adapter marketplace: full CRUD, sync, ownership, install state, validation, delete-cascade, and the skill\'s list-app passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
