// Adapter MCP apps through the service: an app connects with the SDK, shows
// up under its account grouped by app, and MCP clients of the same account —
// and only that account — reach its adapters through the relay.
//
//   node server/test/apps.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createRelay } from '../src/relay.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { SDK_ASSETS } from '../src/sdk-assets.js';
import {
  createAdapterProvider, connectToToolkit, fromToggleAdapter, defineDescriptor,
  createMcpClient, adapterClient, PROFILE_VERSION,
} from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'apps-test-'));
const store = fileStore(dir);
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const relay = createRelay({ requestTimeoutMs: 400 });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost, relay });
const server = http.createServer(app);
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
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
async function account(uid) {
  const made = await call('POST', '/admin/accounts', { admin: true, body: { uid, password: `${uid}-password` } });
  assert.equal(made.status, 201);
  const r = await call('POST', '/v1/auth/login', { body: { username: uid, password: `${uid}-password` } });
  return { session: r.body.token, token: r.body.defaultToken };
}
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 25));
  }
};

const PAGE = 'https://shop.test/product';
function demoProvider({ appId = 'demo', name = 'Demo store', slow = false } = {}) {
  const adapter = { enabled: false, options: null, async enable(o) { if (slow) await new Promise(r => setTimeout(r, 2000)); this.enabled = true; this.options = o; }, disable() { this.enabled = false; } };
  const provider = createAdapterProvider({
    application: { appId, name, version: '1.0.0', supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node' }, surfaces: ['web'] },
    adapters: [fromToggleAdapter({
      adapter,
      descriptor: defineDescriptor({ appId, id: 'big-text', name: 'Big text', version: '1.0.0', operations: ['query', 'check', 'apply', 'revert', 'targets'], targets: [{ platforms: ['*'], urls: ['https://shop.test/*'] }], inputSchema: { type: 'object', properties: { scale: { type: 'number', minimum: 1, maximum: 2 } }, required: ['scale'], additionalProperties: false } }),
      targets: () => ({ candidates: [{ target: { url: PAGE } }], coverage: 'complete' }),
    })],
  });
  return { provider, adapter };
}

const connections = [];
function connect(opts) {
  const c = connectToToolkit({ url: base, ...opts });
  connections.push(c);
  return c;
}

try {
  const ada = await account('ada');
  const bo = await account('bo');
  const demo = demoProvider();
  let conn;

  await test('the SDK is served with every module its imports need, to any origin', async () => {
    const res = await fetch(`${base}/sdk/adapter-mcp.js`, { headers: { origin: 'http://localhost:8000' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('content-type'), /javascript/);
    for (const [url, asset] of SDK_ASSETS) {
      const src = asset.body.toString('utf8');
      for (const m of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const resolved = new URL(m[1], `http://x${url}`).pathname;
        assert.ok(SDK_ASSETS.has(resolved), `${url} imports ${m[1]}, which /sdk does not serve`);
      }
    }
    assert.equal((await fetch(`${base}/sdk/../server/index.js`)).status, 404);
  });

  await test('an app connects with the default token and appears under its account, grouped by app', async () => {
    conn = connect({ token: ada.token, provider: demo.provider, providerId: 'tab-1', label: 'Product page' });
    const ready = await conn.ready;
    assert.equal(ready.providerId, 'tab-1');
    assert.equal(ready.endpoints.app, '/v1/mcp/apps/demo');
    const apps = (await call('GET', '/v1/apps', { token: ada.session })).body.apps;
    assert.equal(apps.length, 1);
    assert.equal(apps[0].name, 'Demo store');
    assert.equal(apps[0].live, true);
    assert.equal(apps[0].adapters[0].id, 'big-text');
    assert.match(apps[0].adapters[0].descriptorDigest, /^sha256:/);
    assert.deepEqual((await call('GET', '/v1/apps', { token: bo.session })).body.apps, [], 'another account sees nothing');
  });

  await test('an MCP client with the account token initializes, lists and calls the adapters', async () => {
    const mcp = createMcpClient({ url: `${base}/v1/mcp/apps/demo`, token: ada.token });
    const init = await mcp.initialize();
    assert.equal(init.serverInfo.name, 'demo-adapters');
    const tools = (await mcp.listTools()).map(t => t.name);
    assert.ok(tools.includes('adapter_apply') && tools.includes('apply_big-text'));
    const api = adapterClient(mcp);
    const [d] = (await api.list()).adapters;
    const described = (await api.describe('demo', d.id)).descriptor;
    const on = await api.apply(described, { url: PAGE }, { enabled: true, parameters: { scale: 1.5 } });
    assert.equal(on.status, 'applied', JSON.stringify(on.reasons));
    assert.deepEqual(demo.adapter.options, { scale: 1.5 });
    const q = await api.query(described, { url: PAGE });
    assert.equal(q.state.enabled, true);
    const typed = await mcp.callTool('apply_big-text', { enabled: false });
    assert.equal(typed.structuredContent.status, 'applied');
    assert.equal(demo.adapter.enabled, false);
  });

  await test('the console session works as an MCP client; the call is recorded as activity', async () => {
    const api = adapterClient(createMcpClient({ url: `${base}/v1/mcp/providers/tab-1`, token: ada.session }));
    const listed = await api.list();
    assert.equal(listed.profileVersion, PROFILE_VERSION);
    const apps = (await call('GET', '/v1/apps', { token: ada.session })).body.apps;
    const activity = apps[0].connections[0].activity;
    assert.ok(activity.some(a => a.tool === 'adapter_list' && a.client === 'developer console'));
    assert.ok(activity.some(a => a.adapter === 'big-text' && a.outcome === 'applied'));
  });

  await test('another account cannot reach the app, guess its instance, or answer for it', async () => {
    const r = await call('POST', '/v1/mcp/providers/tab-1', { token: bo.token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(r.status, 404);
    const viaApp = await call('POST', '/v1/mcp/apps/demo', { token: bo.token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(viaApp.status, 503);
    assert.equal(viaApp.body.error.data.reason, 'provider-offline');
    assert.equal((await call('POST', '/v1/providers/tab-1/channel', { token: bo.token, body: { jsonrpc: '2.0', id: 'r1', result: {} } })).status, 404);
    assert.equal((await call('POST', '/v1/mcp/providers/tab-1', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status, 401);
  });

  await test('registration is re-validated: sessions refused, bad descriptors and digests rejected', async () => {
    await demo.provider.ready;
    const reg = { application: demo.provider.application, adapters: demo.provider.descriptors() };
    assert.equal((await call('POST', '/v1/providers', { token: ada.session, body: reg })).status, 403);
    const tampered = { ...reg, adapters: [{ ...reg.adapters[0], name: 'Renamed' }] };
    const r = await call('POST', '/v1/providers', { token: ada.token, body: tampered });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.some(e => e.path.endsWith('/descriptorDigest')));
    const invalid = { ...reg, adapters: [{ ...reg.adapters[0], targets: [] }] };
    assert.equal((await call('POST', '/v1/providers', { token: ada.token, body: invalid })).status, 400);
    const internal = { ...reg, adapters: [{ ...reg.adapters[0], exposure: 'internal' }] };
    assert.equal((await call('POST', '/v1/providers', { token: ada.token, body: internal })).status, 400);
  });

  await test('hiding an app is per account and reversible', async () => {
    const hid = await call('PUT', '/v1/apps/demo/hidden', { token: ada.session });
    assert.deepEqual(hid.body.hiddenApps, ['demo']);
    const apps = (await call('GET', '/v1/apps', { token: ada.session })).body;
    assert.equal(apps.apps[0].hidden, true);
    assert.deepEqual(apps.hiddenApps, ['demo']);
    await call('DELETE', '/v1/apps/demo/hidden', { token: ada.session });
    assert.equal((await call('GET', '/v1/apps', { token: ada.session })).body.apps[0].hidden, false);
  });

  await test('two live instances: the app endpoint refuses to choose, each instance endpoint works', async () => {
    const second = demoProvider();
    const c2 = connect({ token: ada.token, provider: second.provider, providerId: 'tab-2', label: 'Cart page' });
    await c2.ready;
    const ambiguous = await call('POST', '/v1/mcp/apps/demo', { token: ada.token, body: { jsonrpc: '2.0', id: 7, method: 'tools/list' } });
    assert.equal(ambiguous.status, 503);
    assert.equal(ambiguous.body.error.data.reason, 'provider-ambiguous');
    assert.match(ambiguous.body.error.message, /tab-1.*tab-2|tab-2.*tab-1/);
    const direct = await call('POST', '/v1/mcp/providers/tab-2', { token: ada.token, body: { jsonrpc: '2.0', id: 8, method: 'ping' } });
    assert.deepEqual(direct.body, { jsonrpc: '2.0', id: 8, result: {} });
    await c2.close();
    await until(async () => (await call('GET', '/v1/apps', { token: ada.session })).body.apps[0].connections.length === 1);
  });

  await test('a slow app times out with a JSON-RPC error instead of hanging', async () => {
    const slow = demoProvider({ appId: 'slow', name: 'Slow app', slow: true });
    const c = connect({ token: ada.token, provider: slow.provider, providerId: 'slow-1' });
    await c.ready;
    const r = await call('POST', '/v1/mcp/apps/slow', { token: ada.token, body: { jsonrpc: '2.0', id: 'x', method: 'tools/call', params: { name: 'apply_big-text', arguments: { enabled: true, parameters: { scale: 1 } } } } });
    assert.equal(r.status, 504);
    assert.equal(r.body.id, 'x', 'the client\'s own id comes back');
    assert.equal(r.body.error.data.reason, 'provider-timeout');
    await c.close();
  });

  await test('closing an app leaves it listed offline; forgetting removes it; a live app cannot be forgotten', async () => {
    assert.equal((await call('DELETE', '/v1/apps/demo', { token: ada.session })).status, 409);
    await conn.close();
    const apps = await until(async () => {
      const list = (await call('GET', '/v1/apps', { token: ada.session })).body.apps;
      return list.find(a => a.appId === 'demo' && !a.live) && list;
    });
    const demoApp = apps.find(a => a.appId === 'demo');
    assert.equal(demoApp.adapters.length, 1, 'last-known adapters stay visible');
    const offline = await call('POST', '/v1/mcp/apps/demo', { token: ada.token, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(offline.status, 503);
    assert.equal((await call('DELETE', '/v1/apps/demo', { token: ada.session })).status, 200);
    assert.ok(!(await call('GET', '/v1/apps', { token: ada.session })).body.apps.some(a => a.appId === 'demo'));
  });

  await test('revoking the token disconnects its apps and stops the SDK from retrying', async () => {
    const statuses = [];
    const again = demoProvider();
    const c = connect({ token: ada.token, provider: again.provider, providerId: 'tab-3', onStatus: s => statuses.push(s.state) });
    await c.ready;
    await call('POST', '/v1/account/default-token', { token: ada.session, body: {} });
    await until(() => statuses.includes('failed'), 5000);
    const apps = (await call('GET', '/v1/apps', { token: ada.session })).body.apps;
    assert.ok(!apps.some(a => a.live), 'nothing live after revocation');
  });

  await test('marketplace listings may carry a validated descriptor with a server-computed digest', async () => {
    const d = defineDescriptor({ appId: 'xr', id: 'caption-size', name: 'Caption size', version: '1.0.0', surfaces: ['xr'], targets: [{ platforms: ['android'], applications: ['org.example.guide'] }] });
    const ok = await call('POST', '/v1/adapters', { token: bo.token, body: { appId: 'xr', id: 'caption-size', name: 'Caption size', descriptor: { ...d, descriptorDigest: 'sha256:forged' } } });
    assert.equal(ok.status, 201);
    assert.match(ok.body.adapter.descriptor.descriptorDigest, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(ok.body.adapter.descriptor.descriptorDigest, 'sha256:forged');
    const bad = await call('POST', '/v1/adapters', { token: bo.token, body: { appId: 'xr', id: 'other', name: 'Other', descriptor: d } });
    assert.equal(bad.status, 400, 'a descriptor must describe its own listing');
    const legacy = await call('POST', '/v1/adapters', { token: bo.token, body: { appId: 'xr', id: 'legacy', name: 'Legacy' } });
    assert.equal(legacy.body.adapter.descriptor, undefined);
  });
} finally {
  for (const c of connections) await c.close().catch(() => {});
  relay.closeAll();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nApps: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
