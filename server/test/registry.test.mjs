// The adapter registry at /v1/mcp: apps publishing, sharing and installing
// adapters through the toolkit's own MCP server (adapter-mcp.md §14).
//
//   node server/test/registry.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createLogger } from '../src/log.js';
import { defineDescriptor, descriptorDigest, PROFILE_TOOLS, ACCESS_TOOLS } from '../../toolkit/protocol/adapter/index.js';
import { createRegistryClient, loadInstalledAdapters, RegistryCallError } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin';
const dir = await mkdtemp(path.join(tmpdir(), 'registry-test-'));
const store = fileStore(dir);
const lines = [];
const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
const host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host, log });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

async function tokenFor(uid) {
  const r = await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid }) });
  return (await r.json()).token;
}
let nextId = 1;
async function rpc(token, method, params) {
  const r = await fetch(`${base}/v1/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
  });
  return r.json();
}
async function tool(token, name, args = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  assert.ok(r.result, `${name}: ${JSON.stringify(r.error)}`);
  return { ...r.result.structuredContent, isError: r.result.isError };
}

const CODE = `export const BigButtons = {
  enabled: false,
  enable(options = {}) { this.enabled = true; this.size = options.size || 44; },
  disable() { this.enabled = false; },
};
`;
const descriptor = (fields = {}) => defineDescriptor({
  appId: 'redbird', id: 'big-buttons', name: 'Big buttons', description: 'Makes buttons at least 44px.', version: '1.0.0',
  targets: [{ platforms: ['*'], urls: ['https://shop.example/*', 'http://localhost/*'] }],
  supportAreas: ['motor'],
  inputSchema: { type: 'object', properties: { size: { type: 'number', minimum: 24 } }, additionalProperties: false },
  ...fields,
});
const pkg = (code = CODE) => ({ format: 'web-module@1', code });

const ada = await tokenFor('ada');
const bo = await tokenFor('bo');
const KEY = { owner: 'ada', appId: 'redbird', id: 'big-buttons' };

try {
  await test('the endpoint needs a token and speaks MCP: initialize, tools/list, unknown methods', async () => {
    assert.equal((await fetch(`${base}/v1/mcp`, { method: 'POST', body: '{}' })).status, 401);
    const init = await rpc(ada, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-11-25');
    assert.deepEqual(init.result.capabilities.resources, { listChanged: true });
    const tools = (await rpc(ada, 'tools/list')).result.tools;
    assert.deepEqual(tools.map(t => t.name), ['adapter_search', 'adapter_get', 'adapter_publish', 'adapter_share', 'adapter_delete', 'adapter_install', 'adapter_uninstall', 'adapter_installed', 'adapter_report', 'adapter_status', ...PROFILE_TOOLS, ...ACCESS_TOOLS]);
    assert.equal(tools.find(t => t.name === 'adapter_delete').annotations.destructiveHint, true);
    assert.equal((await rpc(ada, 'nope')).error.code, -32601);
    const notification = await fetch(`${base}/v1/mcp`, { method: 'POST', headers: { authorization: `Bearer ${ada}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(notification.status, 202);
    assert.equal((await fetch(`${base}/v1/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${ada}` } })).status, 405);
  });

  await test('publishing checks the descriptor and the package, and computes both digests', async () => {
    const bad = await tool(ada, 'adapter_publish', { descriptor: descriptor({ id: 'Bad Id' }), package: pkg() });
    assert.equal(bad.isError, true);
    assert.equal(bad.error, 'invalid-adapter');
    const network = await tool(ada, 'adapter_publish', { descriptor: descriptor(), package: pkg('export const A = { enable() { fetch("/x"); }, disable() {} };') });
    assert.match(network.message, /sends or fetches data/);
    const badArgs = await tool(ada, 'adapter_publish', { descriptor: descriptor(), package: pkg(), extra: 1 });
    assert.equal(badArgs.error, 'invalid-arguments');

    const r = await tool(ada, 'adapter_publish', { appName: 'Redbird demo', descriptor: descriptor({ descriptorDigest: 'sha256:forged' }), package: pkg() });
    assert.equal(r.isError, false);
    assert.equal(r.revision, 1);
    assert.equal(r.shared, false, 'private until shared');
    const artifact = `sha256:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
    assert.equal(r.artifactDigest, artifact);
    assert.equal(r.descriptorDigest, await descriptorDigest(descriptor(), artifact), 'the registry computes the digest; a sent one is ignored');
  });

  await test('publishing the same thing again is not a new revision; a change is', async () => {
    assert.deepEqual((await tool(ada, 'adapter_publish', { descriptor: descriptor(), package: pkg() })).unchanged, true);
    const r = await tool(ada, 'adapter_publish', { descriptor: descriptor({ version: '1.1.0' }), package: pkg(CODE.replace('44', '48')) });
    assert.equal(r.revision, 2);
    assert.equal(r.unchanged, false);
  });

  await test('a short descriptor takes the defaults: name, pages and who it is for are enough', async () => {
    const short = { appId: 'agent', id: 'short-one', name: 'Short one', description: 'Makes buttons taller, for people who find small targets hard to hit.', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }], supportAreas: ['motor'] };
    const r = await tool(ada, 'adapter_publish', { appName: 'Coding agent', descriptor: short, package: pkg() });
    assert.equal(r.isError, false, r.message);
    assert.equal(r.revision, 1);
    const got = await tool(ada, 'adapter_get', { adapter: { appId: 'agent', id: 'short-one' }, includeCode: false });
    assert.equal(got.descriptor.version, '1.0.0');
    assert.equal(got.descriptor.mode, 'stateful');
    assert.deepEqual(got.descriptor.supportAreas, ['motor']);
    assert.equal((await tool(ada, 'adapter_publish', { descriptor: short, package: pkg() })).unchanged, true, 'the same short descriptor again is not a new revision');
    const noPages = await tool(ada, 'adapter_publish', { descriptor: { ...short, id: 'no-pages', targets: undefined }, package: pkg() });
    assert.equal(noPages.error, 'invalid-adapter', 'a web package still needs the pages it runs on');
    assert.equal((await tool(ada, 'adapter_delete', { adapter: { appId: 'agent', id: 'short-one' } })).isError, false);
  });

  await test('a private adapter is invisible to another account', async () => {
    assert.equal((await tool(bo, 'adapter_search', {})).count, 0);
    const got = await tool(bo, 'adapter_get', { adapter: KEY });
    assert.equal(got.error, 'not-found');
    assert.equal((await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY })).error, 'not-found');
    const own = await tool(ada, 'adapter_search', { scope: 'mine' });
    assert.equal(own.count, 1);
    assert.equal(own.adapters[0].mine, true);
    assert.equal(own.adapters[0].appName, 'Redbird demo', 'the app name is kept across revisions');
  });

  await test('the owner reads any kept revision, with or without code', async () => {
    const latest = await tool(ada, 'adapter_get', { adapter: KEY });
    assert.equal(latest.revision, 2);
    assert.equal(latest.package.code, CODE.replace('44', '48'));
    assert.deepEqual(latest.revisions.map(r => r.revision), [1, 2]);
    const first = await tool(ada, 'adapter_get', { adapter: { appId: 'redbird', id: 'big-buttons' }, revision: 1, includeCode: false });
    assert.equal(first.descriptor.version, '1.0.0');
    assert.deepEqual(first.package, { format: 'web-module@1', size: CODE.length });
    assert.equal((await tool(ada, 'adapter_get', { adapter: KEY, revision: 9 })).error, 'revision-gone');
  });

  // An SSE listener for bo, to see notifications arrive.
  const seen = [];
  const controller = new AbortController();
  const stream = await fetch(`${base}/v1/mcp`, { headers: { authorization: `Bearer ${bo}`, accept: 'text/event-stream' }, signal: controller.signal });
  (async () => {
    const reader = stream.body.getReader(), decoder = new TextDecoder();
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
          if (data) seen.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  const waitFor = async (check, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); }
  };

  await test('sharing makes it findable by everyone, and everyone listening hears about it', async () => {
    assert.equal(stream.status, 200);
    const shared = await tool(ada, 'adapter_share', { adapter: { appId: 'redbird', id: 'big-buttons' }, shared: true });
    assert.equal(shared.shared, true);
    await waitFor(() => seen.some(n => n.params?._meta?.['ai4a11y/registry']?.reason === 'shared'));
    assert.equal(seen[0].method, 'notifications/resources/list_changed');
    const found = await tool(bo, 'adapter_search', { url: 'https://shop.example/cart' });
    assert.equal(found.count, 1);
    assert.deepEqual(found.adapters[0].adapter, KEY);
    assert.equal(found.adapters[0].mine, false);
    assert.equal((await tool(bo, 'adapter_search', { url: 'https://elsewhere.example/' })).count, 0);
    assert.equal((await tool(bo, 'adapter_search', { query: 'BUTTONS', supportArea: 'motor', portable: true })).count, 1);
    assert.equal((await tool(bo, 'adapter_search', { supportArea: 'vision' })).count, 0);
    assert.equal((await tool(bo, 'adapter_share', { adapter: KEY, shared: false })).error, 'forbidden', 'only the owner shares or unshares');
  });

  await test('installing someone else\'s adapter pins the revision; your own follows the latest', async () => {
    const theirs = await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY });
    assert.equal(theirs.install.revision, 2);
    const mine = await tool(ada, 'adapter_install', { app: 'browser-runtime', adapter: { appId: 'redbird', id: 'big-buttons' } });
    assert.equal(mine.install.revision, 'latest');
    await tool(ada, 'adapter_publish', { descriptor: descriptor({ version: '1.2.0' }), package: pkg(CODE.replace('44', '52')) });
    const boView = await tool(bo, 'adapter_installed', { app: 'browser-runtime', includeCode: true });
    assert.equal(boView.adapters[0].revision, 2);
    assert.equal(boView.adapters[0].updateAvailable, true);
    assert.match(boView.adapters[0].package.code, /48/);
    const adaView = await tool(ada, 'adapter_installed', { app: 'browser-runtime', includeCode: true });
    assert.equal(adaView.adapters[0].revision, 3);
    assert.match(adaView.adapters[0].package.code, /52/);
    assert.deepEqual(adaView.adapters[0].urlPatterns, ['https://shop.example/*', 'http://localhost/*']);
    const updated = await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, revision: 3 });
    assert.equal(updated.install.revision, 3);
    assert.equal((await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, revision: 99 })).error, 'revision-gone');
  });

  await test('installed answers unchanged for the same etag, and a new etag after any change', async () => {
    const first = await tool(bo, 'adapter_installed', { app: 'browser-runtime' });
    assert.ok(first.etag);
    assert.equal(first.adapters[0].package, undefined, 'no code unless asked');
    const again = await tool(bo, 'adapter_installed', { app: 'browser-runtime', ifEtag: first.etag });
    assert.deepEqual([again.unchanged, again.adapters], [true, undefined]);
    await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, sites: { 'https://shop.example': false } });
    const after = await tool(bo, 'adapter_installed', { app: 'browser-runtime', ifEtag: first.etag });
    assert.notEqual(after.etag, first.etag);
    assert.deepEqual(after.adapters[0].sites, { 'https://shop.example': false });
    await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, sites: { 'https://shop.example': true } });
    assert.deepEqual((await tool(bo, 'adapter_installed', { app: 'browser-runtime' })).adapters[0].sites, {}, 'switching a site back on keeps only the offs');
  });

  await test('site keys must be origins and parameters must fit the inputSchema', async () => {
    assert.equal((await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, sites: { 'https://shop.example/cart': false } })).error, 'invalid-site');
    assert.equal((await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, parameters: { size: 2 } })).error, 'invalid-parameters');
    const ok = await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, parameters: { size: 60 }, enabled: false });
    assert.deepEqual([ok.install.parameters, ok.install.enabled], [{ size: 60 }, false]);
    const kept = await tool(bo, 'adapter_install', { app: 'browser-runtime', adapter: KEY, enabled: true });
    assert.deepEqual(kept.install.parameters, { size: 60 }, 'a later change keeps the parameters');
  });

  await test('runtime reports are stored per instance, adapter and origin, and read back as status', async () => {
    const r = await tool(bo, 'adapter_report', { app: 'browser-runtime', instanceId: 'chrome-1', label: 'Chrome on a laptop', results: [
      { adapter: KEY, revision: 3, origin: 'https://shop.example', status: 'applied' },
      { adapter: KEY, revision: 3, origin: 'http://localhost:8080', status: 'failed', message: 'TypeError: x is undefined' },
    ] });
    assert.equal(r.stored, 2);
    const s = await tool(bo, 'adapter_status', { adapter: KEY });
    assert.deepEqual(s.results.map(x => x.status).sort(), ['applied', 'failed']);
    assert.equal(s.results.find(x => x.status === 'failed').label, 'Chrome on a laptop');
    assert.equal(s.instances[0].instanceId, 'chrome-1');
    await tool(bo, 'adapter_report', { app: 'browser-runtime', instanceId: 'chrome-1', results: [{ adapter: KEY, origin: 'http://localhost:8080', status: 'removed' }] });
    assert.equal((await tool(bo, 'adapter_status', {})).results.length, 1);
    assert.equal((await tool(ada, 'adapter_status', {})).results.length, 0, 'reports belong to the account that ran it');
  });

  await test('MCP resources list and read the adapters you can see', async () => {
    const list = (await rpc(bo, 'resources/list')).result.resources;
    assert.deepEqual(list.map(r => r.uri), ['adapter://ada/redbird/big-buttons']);
    const read = (await rpc(bo, 'resources/read', { uri: 'adapter://ada/redbird/big-buttons' })).result.contents[0];
    assert.equal(JSON.parse(read.text).revision, 3);
    assert.equal((await rpc(bo, 'resources/read', { uri: 'adapter://ada/redbird/nope' })).error.code, -32002);
  });

  await test('unsharing leaves installs in place but unavailable', async () => {
    await tool(ada, 'adapter_share', { adapter: { appId: 'redbird', id: 'big-buttons' }, shared: false });
    const view = await tool(bo, 'adapter_installed', { app: 'browser-runtime' });
    assert.deepEqual([view.adapters[0].available, view.adapters[0].reason], [false, 'not-shared']);
    assert.equal((await tool(bo, 'adapter_search', {})).count, 0);
    await tool(ada, 'adapter_share', { adapter: { appId: 'redbird', id: 'big-buttons' }, shared: true });
    assert.equal((await tool(bo, 'adapter_installed', { app: 'browser-runtime' })).adapters[0].available, true);
  });

  await test('only the newest 20 revisions are kept', async () => {
    const d = (n) => descriptor({ appId: 'console', id: 'many', name: 'Many', version: `1.0.${n}` });
    for (let n = 1; n <= 22; n++) await tool(ada, 'adapter_publish', { descriptor: d(n), package: pkg() });
    const got = await tool(ada, 'adapter_get', { adapter: { appId: 'console', id: 'many' }, includeCode: false });
    assert.equal(got.revision, 22);
    assert.equal(got.revisions.length, 20);
    assert.equal(got.revisions[0].revision, 3);
    assert.equal((await tool(ada, 'adapter_get', { adapter: { appId: 'console', id: 'many' }, revision: 2 })).error, 'revision-gone');
    assert.equal(await store.readJSON('users/ada/registry/console/many/1.json'), null, 'dropped revision documents are removed');
  });

  await test('a description-only adapter is listed but not portable', async () => {
    const d = defineDescriptor({ appId: 'xr', id: 'paced-steps', name: 'Paced steps', description: 'One step at a time.', version: '2.0.0', surfaces: ['xr'], targets: [{ platforms: ['*'], applications: ['*'] }] });
    const r = await tool(ada, 'adapter_publish', { descriptor: d, shared: true });
    assert.equal(r.artifactDigest, null);
    const found = await tool(bo, 'adapter_search', { portable: false });
    assert.deepEqual(found.adapters.map(a => a.adapter.id), ['paced-steps']);
    assert.equal((await tool(bo, 'adapter_get', { adapter: { owner: 'ada', appId: 'xr', id: 'paced-steps' } })).package, null);
  });

  await test('the SDK client: publish, share, search, install, watch, and load installed adapters to run', async () => {
    const adaClient = createRegistryClient({ url: base, token: ada });
    const boClient = createRegistryClient({ url: base, token: bo });
    const heard = [];
    const watching = new AbortController();
    const watch = boClient.watch(meta => heard.push(meta), { signal: watching.signal });
    await waitFor(() => heard.some(m => m.reason === 'connected'));
    const d = descriptor({ appId: 'console', id: 'sdk-made', name: 'SDK made' });
    const published = await adaClient.publish({ appName: 'Developer console', descriptor: d, code: CODE });
    assert.equal(published.revision, 1);
    await adaClient.share({ appId: 'console', id: 'sdk-made' });
    await waitFor(() => heard.some(m => m.reason === 'shared' && m.adapter === 'ada/console/sdk-made'));
    const { adapters } = await boClient.search({ appId: 'console' });
    assert.deepEqual(adapters.map(a => a.adapter.id), ['sdk-made']);
    await boClient.install('my-app', adapters[0].adapter, { parameters: { size: 30 } });
    const running = await loadInstalledAdapters(boClient, 'my-app', { url: 'https://shop.example/x' });
    assert.equal(running.length, 1);
    running[0].adapter.enable(running[0].entry.parameters);
    assert.deepEqual([running[0].adapter.enabled, running[0].adapter.size], [true, 30]);
    assert.equal((await loadInstalledAdapters(boClient, 'my-app', { url: 'https://elsewhere.example/' })).length, 0, 'only adapters for this page');
    await assert.rejects(boClient.share({ owner: 'ada', appId: 'console', id: 'sdk-made' }), (e) => e instanceof RegistryCallError && e.code === 'forbidden');
    watching.abort();
    await watch;
  });

  await test('deleting an adapter removes it, its revisions and your installs of it', async () => {
    await tool(ada, 'adapter_install', { app: 'browser-runtime', adapter: { appId: 'console', id: 'many' } });
    const del = await tool(ada, 'adapter_delete', { adapter: { appId: 'console', id: 'many' } });
    assert.equal(del.deleted, true);
    assert.equal(await store.readJSON('users/ada/registry/console/many/22.json'), null);
    assert.ok(!(await tool(ada, 'adapter_installed', { app: 'browser-runtime' })).adapters.some(a => a.adapter.id === 'many'));
    assert.equal((await tool(bo, 'adapter_delete', { adapter: KEY })).error, 'forbidden');
    assert.equal((await tool(ada, 'adapter_uninstall', { app: 'browser-runtime', adapter: { appId: 'console', id: 'many' } })).error, 'not-installed');
  });

  await test('deleting an account takes its adapters out of the shared index', async () => {
    assert.ok((await tool(bo, 'adapter_search', {})).count >= 1);
    const r = await fetch(`${base}/admin/users/ada`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(r.status, 200);
    assert.equal((await tool(bo, 'adapter_search', {})).count, 0);
    const view = await tool(bo, 'adapter_installed', { app: 'browser-runtime' });
    assert.deepEqual([view.adapters[0].available, view.adapters[0].reason], [false, 'deleted']);
  });

  await test('the log names tools and outcomes; the request log has the arguments, never a token', () => {
    const entries = lines.map(l => JSON.parse(l));
    const calls = entries.filter(e => e.event === 'registry.call');
    assert.ok(calls.some(e => e.tool === 'adapter_publish' && e.outcome === 'ok' && e.uid === 'ada'));
    assert.ok(calls.some(e => e.outcome === 'invalid-adapter'));
    assert.ok(!calls.some(e => JSON.stringify(e).includes('BigButtons')), 'a registry.call entry names the tool, not its arguments');
    assert.ok(entries.some(e => e.event === 'http.request' && e.path === '/v1/mcp' && JSON.stringify(e.request ?? '').includes('BigButtons')));
    assert.ok(!lines.some(l => /aat_[A-Za-z0-9_-]{10,}/.test(l)), 'no account token in the log');
  });

  controller.abort();
} finally {
  app.registry.closeAll();
  app.relay.closeAll();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nRegistry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
