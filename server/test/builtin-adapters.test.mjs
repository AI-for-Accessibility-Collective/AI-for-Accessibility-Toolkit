// The toolkit's own adapters (server/src/builtin-adapters.js): the core set,
// published at start under the reserved owner `toolkit`, app "Toolkit",
// shared with every account.
//
//   node server/test/builtin-adapters.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { loadBuiltinAdapters, seedBuiltinAdapters, summaryOf, BUILTIN_OWNER } from '../src/builtin-adapters.js';
import { createAccounts } from '../src/accounts.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = 'test-admin';
const dir = await mkdtemp(path.join(tmpdir(), 'builtin-test-'));
const store = fileStore(dir);
const host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

const CORE = readdirSync(path.join(ROOT, 'tools/core-adapters')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();

// Off unless asked for: the other tests' counts stay as they are.
await test('createApp publishes nothing of its own unless asked', async () => {
  const plain = createApp({ store: fileStore(await mkdtemp(path.join(tmpdir(), 'builtin-off-'))), adminPassword: ADMIN, toolkitHost: host });
  assert.equal(await plain.builtins, null);
});

const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host, builtinAdapters: true });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const tokenFor = async (uid) => (await (await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid }) })).json()).token;

try {
  await test('every core adapter loads, with a one-sentence description and the support areas it is suggested for', async () => {
    const all = loadBuiltinAdapters();
    assert.deepEqual(all.map(a => a.descriptor.id).sort(), CORE);
    assert.equal(all.length, 11);
    const briefs = JSON.parse(readFileSync(path.join(ROOT, 'scripts/verify-adapters/core-adapters.json'), 'utf8')).adapters;
    for (const a of all) {
      assert.ok(a.descriptor.description.length > 10 && !a.descriptor.description.includes('//'), a.descriptor.description);
      assert.deepEqual(a.descriptor.supportAreas, briefs.find(b => b.id === a.descriptor.id).suggestedFor);
    }
    assert.equal(summaryOf('// x.js — Makes a thing\n// work well.\n// Barrier: no.\n'), 'Makes a thing work well.');
  });

  await test('at start, all 11 are published under toolkit, shared, and any account finds them under Toolkit', async () => {
    const seeded = await app.builtins;
    assert.deepEqual(seeded, { published: 11, unchanged: 0, failed: 0 });
    const ada = createRegistryClient({ url: base, token: await tokenFor('ada') });
    const { adapters } = await ada.search({ scope: 'shared' });
    const ours = adapters.filter(a => a.owner === BUILTIN_OWNER);
    assert.deepEqual(ours.map(a => a.adapter.id).sort(), CORE);
    for (const a of ours) {
      assert.deepEqual([a.adapter.appId, a.appName, a.shared, a.portable, a.mine, a.urlPatterns], ['toolkit', 'Toolkit', true, true, false, ['*://*/*']]);
    }
    // Found by support area, like any shared adapter.
    const motor = (await ada.search({ supportArea: 'motor', portable: true })).adapters.map(a => a.adapter.id);
    assert.ok(motor.includes('bigger-targets') && motor.includes('focus-keyboard'));
  });

  await test('an account installs one into the browser runtime and gets its code', async () => {
    const bo = createRegistryClient({ url: base, token: await tokenFor('bo') });
    const r = await bo.install('browser-runtime', { owner: BUILTIN_OWNER, appId: 'toolkit', id: 'text-size' });
    assert.equal(r.install.revision, 1);
    const listed = await bo.installed('browser-runtime', { includeCode: true });
    const got = listed.adapters.find(a => a.adapter.owner === BUILTIN_OWNER && a.adapter.id === 'text-size');
    assert.ok(got, 'installed');
    assert.equal(got.available, true);
    assert.equal(got.package.code, readFileSync(path.join(ROOT, 'tools/core-adapters/text-size.js'), 'utf8'));
  });

  await test('seeding again (a restart) makes no new revisions', async () => {
    assert.deepEqual(await seedBuiltinAdapters(app.registry), { published: 0, unchanged: 11, failed: 0 });
    const ada = createRegistryClient({ url: base, token: await tokenFor('ada') });
    const got = await ada.get({ owner: BUILTIN_OWNER, appId: 'toolkit', id: 'contrast' }, { includeCode: false });
    assert.equal(got.revision, 1);
  });

  await test('nobody can take the name toolkit', async () => {
    const accounts = createAccounts({ store, secret: 'test-secret' });
    await assert.rejects(accounts.create({ uid: 'toolkit' }), (e) => e.code === 'reserved-username');
    await assert.rejects(accounts.create({ uid: 'Toolkit' }), (e) => e.code === 'reserved-username');
  });
} finally {
  app.relay.closeAll();
  server.closeAllConnections?.();
  server.close();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nBuilt-in adapters: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
