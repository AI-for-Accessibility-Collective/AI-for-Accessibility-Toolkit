// Who can read what an app or adapter gives the toolkit (server/src/access.js):
// app tokens bound to one app, declared and narrowed visibility, the
// partitions the toolkit learns in, adapters' own data, and observations with
// images.
//
//   node server/test/access.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createLogger } from '../src/log.js';
import { defineDescriptor } from '../../toolkit/protocol/adapter/index.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin';
const dir = await mkdtemp(path.join(tmpdir(), 'access-test-'));
const store = fileStore(dir);
// The stub LLM remembers the first observation it is shown, and always
// suggests one profile change.
const calls = [];
const host = createToolkitHost({
  store,
  geminiCaller: async (prompt, opts) => {
    calls.push({ prompt, images: opts?.images || [] });
    const first = JSON.parse(`"${prompt.match(/"text": "((?:[^"\\]|\\.)*)"/)?.[1] || 'something'}"`);
    return JSON.stringify({
      operations: [{ op: 'ADD', record: { text: `Remembers: ${first}`, scope: 'general', tier: 'preference' } }],
      proposals: [{ aspect: 'profile.largeTargets', aspectLabel: 'Bigger buttons', change: { op: 'profile-set', path: 'fields.largeTargets', value: true }, rationale: 'Seen often.' }],
    });
  },
});
const lines = [];
const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host, log, learningDelayMs: 60_000 });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}
async function mint(uid, extra = {}) {
  const r = await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid, ...extra }) });
  return r.json();
}
const librarian = (token, method, ...args) => fetch(`${base}/v1/librarian/${method}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ args }),
}).then(r => r.json());
const texts = (state) => state.memories.map(m => m.text).sort();
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64').replace(/=+$/, '') + 'AAAA'.repeat(400);

try {
  const account = (await mint('ada', { kind: 'default' })).token;
  const redbirdToken = (await mint('ada', { appId: 'redbird', label: 'Redbird' })).token;
  const otherToken = (await mint('ada', { appId: 'other', label: 'Other app' })).token;
  const me = createRegistryClient({ url: base, token: account });
  const redbird = createRegistryClient({ url: base, token: redbirdToken });
  const other = createRegistryClient({ url: base, token: otherToken });
  const learnAll = () => me.profile.learnNow();

  await test('an app token is bound to its app id, and says so', async () => {
    const who = await fetch(`${base}/v1/whoami`, { headers: { authorization: `Bearer ${redbirdToken}` } }).then(r => r.json());
    assert.equal(who.kind, 'app');
    const bad = await mint('ada', { appId: 'Not An Id' });
    assert.match(bad.error, /appId/);
    const tokens = await fetch(`${base}/admin/tokens`, { headers: { authorization: `Bearer ${ADMIN}` } }).then(r => r.json());
    assert.ok(tokens.some(t => t.appId === 'redbird' && t.label === 'Redbird'));
  });

  await test('an app declares its own visibility, and only its own', async () => {
    const declared = await redbird.access.declare('redbird', 'app', { name: 'Redbird demo' });
    assert.deepEqual(declared, { app: 'redbird', declared: 'app', visibility: 'app' });
    await assert.rejects(redbird.access.declare('other', 'app'), (e) => e.code === 'forbidden');
    await assert.rejects(redbird.access.restrict({ app: 'other' }, 'app'), (e) => e.code === 'forbidden');
  });

  await test('what an app-level app gives is learned apart: only that app and the account read it', async () => {
    const kept = await redbird.profile.observe({ text: 'Turned on Calm urgency in the store.', type: 'setting-change' });
    assert.equal(kept.visibility, 'app');
    await other.profile.observe({ text: 'Made the text bigger in the other app.', type: 'setting-change' });
    await learnAll();
    assert.deepEqual(texts(await redbird.profile.learned()), ['Remembers: Made the text bigger in the other app.', 'Remembers: Turned on Calm urgency in the store.']);
    assert.deepEqual(texts(await other.profile.learned()), ['Remembers: Made the text bigger in the other app.'], 'the other app reads user level only');
    const all = await me.profile.learned();
    assert.deepEqual(texts(all), ['Remembers: Made the text bigger in the other app.', 'Remembers: Turned on Calm urgency in the store.']);
    const scoped = all.memories.find(m => m.text.includes('Calm urgency'));
    assert.deepEqual([scoped.visibility, scoped.app], ['app', 'redbird']);
    // One suggestion, from the user-level observation; none from the app's partition.
    assert.equal(all.proposals.length, 1);
  });

  await test('the Librarian routes follow the same rules: logObservation lands by visibility, listMemories and recall merge what the caller may read', async () => {
    const logged = await librarian(redbirdToken, 'logObservation', { type: 'setting-change', text: 'Hid countdown timers in the store.', origin: 'https://redbird.example' });
    assert.equal(logged.result.visibility, 'app');
    await learnAll();
    const mine = (await librarian(redbirdToken, 'listMemories', { status: 'active' })).result.memories.map(m => m.text);
    assert.ok(mine.includes('Remembers: Hid countdown timers in the store.'));
    const theirs = (await librarian(otherToken, 'listMemories', { status: 'active' })).result.memories.map(m => m.text);
    assert.ok(!theirs.some(t => t.includes('countdown') || t.includes('Calm urgency')));
    const recalled = (await librarian(redbirdToken, 'recall', 'https://redbird.example/', '')).result;
    assert.match(recalled.block, /### Only for the app redbird\n(- .*\n)*- Remembers: Hid countdown timers in the store\./);
    assert.ok(!(await librarian(otherToken, 'recall', 'https://redbird.example/', '')).result.block.includes('countdown'));
  });

  await test('the console narrows an app; the app cannot widen it back', async () => {
    const narrowed = await me.access.restrict({ app: 'other' }, 'app');
    assert.equal(narrowed.visibility, 'app');
    assert.equal((await other.profile.observe({ text: 'Switched on captions in the other app.' })).visibility, 'app');
    await other.access.declare('other', 'user');
    const view = await me.access.get();
    assert.deepEqual(view.apps.find(a => a.app === 'other'), { app: 'other', name: 'other', declared: 'user', restricted: 'app', visibility: 'app' });
    await learnAll();
    assert.ok(!texts(await redbird.profile.learned()).some(t => t.includes('captions')));
    await me.access.restrict({ app: 'other' }, null);
    assert.equal((await me.access.get()).apps.find(a => a.app === 'other').visibility, 'user');
    await assert.rejects(me.access.restrict({ app: 'other' }, 'adapter'), (e) => e.code === 'invalid-arguments');
  });

  // An adapter in the account's registry, declared adapter-level.
  const secret = { appId: 'agent', id: 'reading-ruler' };
  await me.publish({
    appName: 'Coding agent', code: 'export default { enable() {}, disable() {} };',
    descriptor: defineDescriptor({ ...secret, name: 'Reading ruler', version: '1.0.0', visibility: 'adapter', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }] }),
  });

  await test('an adapter declares its visibility in its descriptor, and the registry shows it', async () => {
    const [found] = (await me.search({ scope: 'mine' })).adapters.filter(a => a.adapter.id === 'reading-ruler');
    assert.equal(found.visibility, 'adapter');
    await assert.rejects(me.publish({ descriptor: defineDescriptor({ appId: 'agent', id: 'bad', name: 'Bad', version: '1', visibility: 'everyone' }) }), /visibility/);
  });

  await test('an adapter keeps its own data; at adapter level only its own app and the apps that run it read it', async () => {
    const data = me.data(secret);
    await data.set('height', 48);
    await data.set('colors', { line: 'yellow' });
    assert.deepEqual(await data.get(), { height: 48, colors: { line: 'yellow' } });
    assert.equal(await data.get('height'), 48);
    await assert.rejects(redbird.data(secret).get('height'), (e) => e.code === 'forbidden');
    await me.install('redbird', secret);
    assert.equal(await redbird.data(secret).get('height'), 48, 'redbird runs it now');
    await assert.rejects(other.data(secret).set('height', 10), (e) => e.code === 'forbidden');
    assert.deepEqual(await redbird.data(secret).delete('colors'), { adapter: { owner: 'ada', ...secret }, deleted: 1 });
    await assert.rejects(data.set('big', 'x'.repeat(4_000_001)), (e) => e.code === 'data-too-large');
  });

  await test('a user-level adapter\'s data is read by any app of the account', async () => {
    const open = { appId: 'agent', id: 'open-ruler' };
    await me.publish({ code: 'export default { enable() {}, disable() {} };', descriptor: defineDescriptor({ ...open, name: 'Open ruler', version: '1', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }] }) });
    await me.data(open).set('on', true);
    assert.equal(await other.data(open).get('on'), true);
    await me.access.restrict({ adapter: open }, 'adapter');
    await assert.rejects(other.data(open).get('on'), (e) => e.code === 'forbidden');
    const view = (await me.access.get()).adapters.find(a => a.adapter.id === 'open-ruler');
    assert.deepEqual([view.declared, view.restricted, view.visibility], ['user', 'adapter', 'adapter']);
  });

  await test('what an adapter-level adapter does in the browser is learned for it alone', async () => {
    await me.install('browser-runtime', secret);
    await me.profile.observe({ text: 'Moved the reading ruler down the page.', app: 'browser-runtime', adapter: secret });
    await learnAll();
    const all = await me.profile.learned();
    // Both observations went to the adapter's partition, and were learned from in one pass.
    const ruler = all.memories.filter(m => m.adapter === 'ada/agent/reading-ruler');
    assert.deepEqual(ruler.map(m => [m.visibility, m.text]), [['adapter', 'Remembers: Chose to run the adapter "Reading ruler" in their browser.']]);
    assert.match(calls.at(-1).prompt, /Moved the reading ruler down the page\./);
    assert.ok(texts(await redbird.profile.learned()).some(t => t.includes('Reading ruler')), 'redbird installed the adapter, so it reads it');
    assert.ok(!texts(await other.profile.learned()).some(t => t.includes('Reading ruler')));
  });

  await test('learning paused in the account holds for every partition', async () => {
    await me.profile.pause(true);
    assert.deepEqual(await redbird.profile.observe({ text: 'Anything.' }), { logged: false, reason: 'paused', visibility: 'app' });
    await me.profile.pause(false);
  });

  await test('an observation can carry images: kept with it, shown to the model, logged by size only', async () => {
    calls.length = 0;
    lines.length = 0;
    const logged = await librarian(account, 'logObservation', { type: 'observation', text: 'Zoomed into a chart they could not read.', images: [{ mimeType: 'image/png', data: PNG }] });
    assert.equal(logged.ok, true);
    const media = await readdir(path.join(dir, 'users', 'ada', 'media'));
    assert.equal(media.length, 1);
    const kept = JSON.parse(await readFile(path.join(dir, 'users', 'ada', 'media', media[0]), 'utf8'));
    assert.deepEqual([kept.mimeType, kept.data.length], ['image/png', PNG.length]);
    await learnAll();
    const withImage = calls.find(c => c.images.length);
    assert.deepEqual(withImage.images.map(i => [i.mimeType, i.data.length]), [['image/png', PNG.length]]);
    assert.match(withImage.prompt, /"images": \[\n\s+"image 1"\n\s+\]/);
    const all = lines.join('\n');
    assert.ok(!all.includes(PNG.slice(0, 200)), 'no image data in the log');
    assert.match(all, /\[base64, \d+ characters\]/);
    const bad = await librarian(account, 'logObservation', { text: 'x', images: [{ mimeType: 'text/html', data: 'AAAA' }] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /mimeType/);
    const viaMcp = await redbird.profile.observe({ text: 'Took a photo of a menu to read it.', images: [{ mimeType: 'image/jpeg', data: PNG }] });
    assert.equal(viaMcp.visibility, 'app');
    assert.equal((await readdir(path.join(dir, 'users', 'ada', 'scoped', 'app~redbird', 'media'))).length, 1);
  });

  await test('reset with memories clears the partitions this caller reads, and only those', async () => {
    const before = texts(await me.profile.learned()).length;
    assert.ok(before > 2);
    await other.profile.reset({ memories: true });
    assert.ok(texts(await redbird.profile.learned()).some(t => t.includes('Calm urgency')), 'redbird\'s partition stays');
    await me.profile.reset({ memories: true });
    assert.deepEqual(texts(await me.profile.learned()), []);
  });

  await test('an app token can only connect its own app for live control', async () => {
    const r = await fetch(`${base}/v1/providers`, {
      method: 'POST', headers: { authorization: `Bearer ${redbirdToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ application: { appId: 'other', name: 'Other', version: '1', supportedPlatforms: [{ environment: 'web-page' }], surfaces: ['web'] }, adapters: [] }),
    });
    assert.equal(r.status, 403);
    const ok = await fetch(`${base}/v1/providers`, {
      method: 'POST', headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ application: { appId: 'other', name: 'Other', version: '1', visibility: 'app', supportedPlatforms: [{ environment: 'web-page' }], surfaces: ['web'] }, adapters: [] }),
    });
    assert.equal(ok.status, 200, await ok.text());
    assert.equal((await me.access.get()).apps.find(a => a.app === 'other').declared, 'app', 'connecting declares the app\'s visibility');
  });
} finally {
  app.registry?.closeAll?.();
  app.relay?.closeAll?.();
  server.closeAllConnections?.();
  server.close();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nAccess: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
