// The XR bridge (toolkit/hosts/xr-bridge/) against a real toolkit service and
// a stand-in for the AI for Accessibility XR guide's server, which answers
// its /webview API the way that app does (src/transport/webview.ts,
// profile-api.ts, needs-catalog.ts in that repository): the bridge registers
// the app under Apps with its needs, follows the toolkit profile into it,
// lets the relay switch its adaptations, tells the toolkit about changes made
// on the glasses, and refuses anything that is not the XR guide.
//
//   node server/test/xr-bridge.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createRelay } from '../src/relay.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createXrBridge, desiredFromProfile, XR_APP, XR_TARGET } from '../../toolkit/hosts/xr-bridge/bridge.js';
import { createMcpClient, adapterClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'xr-bridge-test-'));
const store = fileStore(dir);
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: ADMIN, toolkitHost, relay: createRelay({ requestTimeoutMs: 2000 }) }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// ── the XR guide, as its /webview API answers ─────────────────────────────
const XR_TOKEN = 'xr-bridge-token';
const SPECS = {
  pacing: (v) => (['continuous', 'stepwise'].includes(v) ? v : undefined),
  readAloudRate: (v) => (typeof v === 'number' && v >= 0.7 - 1e-9 && v <= 1.2 + 1e-9 ? Math.round(v * 10) / 10 : undefined),
  captions: (v) => (typeof v === 'boolean' ? v : undefined),
};
function fakeXr({ like = true } = {}) {
  const xr = { mode: 'baseline', phone: false, needs: {}, writes: [] };
  const view = () => ({ mode: xr.mode, profileOn: xr.mode === 'toolkit', needs: Object.entries(xr.needs).map(([key, value]) => ({ key, value })), available: [], effect: [] });
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    const send = (status, payload) => { res.writeHead(status, payload === undefined ? {} : { 'content-type': 'application/json' }); res.end(payload === undefined ? '' : JSON.stringify(payload)); };
    if (req.headers.authorization !== `Bearer ${XR_TOKEN}`) return send(401);
    if (!like) return send(200, { status: 'ok' });
    if (req.method === 'GET' && req.url === '/webview/status') return send(200, { source: 'glasses', canSetMode: true, active: false, state: { mode: xr.mode, profileOn: false } });
    if (req.method === 'POST' && req.url === '/webview/mode') {
      if (!['baseline', 'toolkit'].includes(json.mode)) return send(400);
      xr.mode = json.mode;
      return send(204);
    }
    if (req.url === '/webview/profile') {
      if (!xr.phone) return send(409, { error: 'No profile store yet — connect the phone app first.' });
      if (req.method === 'GET') return send(200, view());
      if (json.value === null) delete xr.needs[json.key];
      else {
        const v = SPECS[json.key]?.(json.value);
        if (v === undefined) return send(400, { error: `bad ${json.key}` });
        xr.needs[json.key] = v;
      }
      xr.writes.push([json.key, json.value]);
      return send(200, view());
    }
    send(404);
  });
  return { xr, srv };
}
const listen = async (srv) => { await new Promise(r => srv.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${srv.address().port}`; };

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}
async function call(method, url, { token, admin, body } = {}) {
  const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(admin ? { authorization: `Bearer ${ADMIN}` } : {}) };
  const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 30));
  }
};
const made = await call('POST', '/admin/accounts', { admin: true, body: { uid: 'ada', password: 'ada-password' } });
assert.equal(made.status, 201);
const { defaultToken: token } = (await call('POST', '/v1/auth/login', { body: { username: 'ada', password: 'ada-password' } })).body;
const librarian = (method, ...args) => call('POST', `/v1/librarian/${method}`, { token, body: { args } });

// What the bridge tells the toolkit, seen on the way out.
const observed = [];
const watching = async (url, init) => {
  if (String(url).endsWith('/v1/mcp') && init?.body) {
    const m = JSON.parse(init.body);
    if (m.params?.name === 'profile_observe') observed.push(m.params.arguments);
  }
  return fetch(url, init);
};

const { xr, srv } = fakeXr();
const xrUrl = await listen(srv);
let bridge;
try {
  await test('the profile says what the XR guide should hold, in its ranges, and nothing it does not say', () => {
    assert.deepEqual(desiredFromProfile({ fields: { needs: [{ dimension: 'readAloudRate', value: 2 }, { dimension: 'captions', value: true }, { dimension: `${XR_APP.appId}/one-step`, value: true }, { dimension: 'textSize', value: 1.5 }] } }),
      { readAloudRate: 1.2, captions: true, pacing: 'stepwise' });
    assert.deepEqual(desiredFromProfile({ fields: { needs: [{ dimension: 'readAloudRate', value: 0.75 }, { dimension: `${XR_APP.appId}/one-step`, value: false }] } }), { readAloudRate: 0.8, pacing: 'continuous' });
    assert.deepEqual(desiredFromProfile({}), {});
  });

  await test('only for the XR guide: another server, or a wrong token, is refused', async () => {
    const other = fakeXr({ like: false });
    const otherUrl = await listen(other.srv);
    await assert.rejects(createXrBridge({ toolkitUrl: base, toolkitToken: token, xrUrl: otherUrl, xrToken: XR_TOKEN }).start(), /does not answer like the AI for Accessibility XR guide/);
    other.srv.close();
    await assert.rejects(createXrBridge({ toolkitUrl: base, toolkitToken: token, xrUrl, xrToken: 'wrong' }).start(), /refused the bridge: set XR_BRIDGE_TOKEN/);
    assert.equal((await call('GET', '/v1/apps', { token })).body.apps.length, 0, 'nothing registered');
  });

  await test('started: the XR guide shows under Apps with its four adaptations, and its need goes to the profile agent', async () => {
    await librarian('setProfileField', 'fields.needs', [{ dimension: 'readAloudRate', value: 0.8, strength: 'preference' }, { dimension: 'captions', value: true, strength: 'preference' }]);
    bridge = createXrBridge({ toolkitUrl: base, toolkitToken: token, xrUrl, xrToken: XR_TOKEN, pollMs: 60_000, fetch: watching });
    const started = await bridge.start();
    assert.deepEqual(started, { storeOpen: false, followed: [] }, 'no phone yet: nothing to write into');
    const app = (await call('GET', '/v1/apps', { token })).body.apps.find(a => a.appId === XR_APP.appId);
    assert.equal(app.name, 'AI for Accessibility XR');
    assert.equal(app.live, true);
    assert.deepEqual(app.adapters.map(d => d.id), ['toolkit-mode', 'one-step', 'speaking-rate', 'captions']);
    assert.ok(app.adapters.every(d => d.surfaces.includes('xr')));
    const needs = await until(async () => (await librarian('listRegisteredNeeds')).body.result?.length && (await librarian('listRegisteredNeeds')).body.result);
    assert.deepEqual(needs.map(n => [n.key, n.phrase]), [[`${XR_APP.appId}/one-step`, 'One step at a time']]);
  });

  await test('when the phone opens the XR guide\'s profile, the toolkit profile is written into it', async () => {
    xr.phone = true;
    await bridge.sync();
    assert.deepEqual(xr.needs, { readAloudRate: 0.8, captions: true });
    assert.deepEqual(observed, [], 'its own writes are not told back as the person\'s');
  });

  await test('the console\'s Try it (the relay) switches the XR guide\'s adaptations, and reads them back', async () => {
    const api = adapterClient(createMcpClient({ url: `${base}/v1/mcp/apps/${XR_APP.appId}`, token }));
    const T = XR_TARGET;
    const d = async (id) => (await api.describe(XR_APP.appId, id)).descriptor;
    const step = await d('one-step');
    const on = await api.apply(step, T, { enabled: true, parameters: {} });
    assert.equal(on.status, 'applied', JSON.stringify(on.reasons));
    assert.equal(xr.needs.pacing, 'stepwise');
    assert.equal((await api.query(step, T)).state.enabled, true);
    const rate = await d('speaking-rate');
    assert.equal((await api.apply(rate, T, { enabled: true, parameters: { rate: 1.1 } })).status, 'applied');
    assert.equal(xr.needs.readAloudRate, 1.1);
    const mode = await d('toolkit-mode');
    const toolkit = await api.apply(mode, T, { enabled: true, parameters: {} });
    assert.equal(toolkit.status, 'applied', JSON.stringify(toolkit.reasons));
    assert.equal(xr.mode, 'toolkit');
    const off = await api.apply(step, T, { enabled: false });
    assert.equal(off.status, 'applied', JSON.stringify(off.reasons));
    assert.equal(xr.needs.pacing, 'continuous');
  });

  await test('a change to the toolkit profile reaches the XR guide by itself', async () => {
    await librarian('chooseNeed', `${XR_APP.appId}/one-step`);
    await librarian('setProfileField', 'fields.needs', [...(await librarian('getProfile')).body.result.fields.needs.filter(n => n.dimension !== 'readAloudRate'), { dimension: 'readAloudRate', value: 1, strength: 'preference' }]);
    await until(() => xr.needs.pacing === 'stepwise' && xr.needs.readAloudRate === 1);
  });

  await test('a change the person makes on the glasses is told to the toolkit, once', async () => {
    xr.needs.captions = false;
    xr.mode = 'baseline';
    await bridge.sync();
    assert.deepEqual(observed.map(o => [o.text, o.type, o.app]), [
      ['Switched the XR guide to speak the same way to everyone.', 'setting-change', XR_APP.appId],
      ['Turned off captions on the XR guide’s display.', 'setting-change', XR_APP.appId],
    ]);
    await bridge.sync();
    assert.equal(observed.length, 2);
  });

  await test('app_verify (the skill\'s verify --app) drives each XR adaptation and puts it back', async () => {
    const before = JSON.stringify(xr.needs) + xr.mode;
    const r = await call('POST', '/v1/mcp', { token, body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'app_verify', arguments: { app: XR_APP.appId } } } });
    const v = r.body.result.structuredContent;
    assert.equal(r.body.result.isError, false, JSON.stringify(r.body.result));
    for (const a of v.adapters) assert.ok(a.steps.every(st => st.ok), `${a.id}: ${JSON.stringify(a.steps)}`);
    assert.equal(JSON.stringify(xr.needs) + xr.mode, before, 'put back as it was');
  });

  await test('stopped: the XR guide is no longer live under Apps', async () => {
    await bridge.stop();
    await until(async () => !(await call('GET', '/v1/apps', { token })).body.apps.find(a => a.appId === XR_APP.appId)?.live);
  });
} finally {
  await bridge?.stop().catch(() => {});
  srv.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
console.log(`\nXR bridge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
