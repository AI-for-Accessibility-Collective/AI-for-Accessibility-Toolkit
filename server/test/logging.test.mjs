// Logs and stored activity: the service writes structured entries for
// requests, sign-ins, account and token changes, apps and MCP calls — and
// never a password, token or Authorization header — and an account's recent
// calls survive a restart but not the account's deletion.
//
//   node server/test/logging.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createLogger, safeErrorText, redact, loggedContent, MAX_LOGGED_CHARS } from '../src/log.js';
import { createGeminiCaller } from '../src/gemini.js';
import { withAiContext } from '../src/ai-context.js';
import { ACTIVITY_DOC } from '../src/activity.js';
import { createAdapterProvider, connectToToolkit, fromToggleAdapter, defineDescriptor, createMcpClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'logging-test-'));
const store = fileStore(dir);
const lines = [];
const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
const entries = () => lines.map(l => JSON.parse(l));
const events = (name) => entries().filter(e => e.event === name);

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

async function boot() {
  const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
  const app = createApp({ store, adminPassword: ADMIN, toolkitHost, log });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => {
    app.relay.closeAll();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  };
  return { app, base, stop };
}

let svc = await boot();
async function call(method, url, { token, admin, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${ADMIN}`;
  const res = await fetch(svc.base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
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

const secrets = [ADMIN];
let session, defaultToken, appToken, link;

try {
  await test('the logger writes Cloud Logging JSON: severity, message, event fields, stack_trace', () => {
    const out = [];
    const l = createLogger({ format: 'json', level: 'info', write: (x) => out.push(JSON.parse(x)), now: () => new Date('2026-10-29T00:00:00Z') });
    l.debug('hidden.below.level', {});
    l.warn('thing.happened', { uid: 'ada', count: 2 });
    const e = new Error('boom'); e.code = 'E_BOOM';
    l.error('thing.failed', { uid: 'ada', error: e });
    assert.equal(out.length, 2, 'below the level is not written');
    assert.deepEqual({ ...out[0] }, { severity: 'WARNING', time: '2026-10-29T00:00:00.000Z', event: 'thing.happened', uid: 'ada', count: 2, message: 'thing.happened uid=ada count=2' });
    assert.equal(out[1].severity, 'ERROR');
    assert.equal(out[1].error, 'boom');
    assert.equal(out[1].errorCode, 'E_BOOM');
    assert.match(out[1].stack_trace, /Error: boom/);
  });

  await test('librarian errors are logged by code only: a sentence might quote the profile', () => {
    assert.equal(safeErrorText(new Error('no-server-key')), 'no-server-key');
    assert.equal(safeErrorText(new TypeError('I use a screen reader and need captions')), 'TypeError');
  });

  await test('account, sign-in and token events are logged, with the uid and never a secret', async () => {
    const made = await call('POST', '/admin/accounts', { admin: true, body: { uid: 'ada' } });
    assert.equal(made.status, 201);
    secrets.push(made.body.password);
    assert.equal((await call('POST', '/v1/auth/login', { body: { username: 'Ada', password: 'not-the-password' } })).status, 401);
    const ok = await call('POST', '/v1/auth/login', { body: { username: 'ada', password: made.body.password } });
    session = ok.body.token; defaultToken = ok.body.defaultToken;
    secrets.push(session, defaultToken, 'not-the-password');
    const issued = await call('POST', '/v1/account/tokens', { token: session, body: { label: 'XR prototype' } });
    appToken = issued.body.token;
    secrets.push(appToken);
    assert.equal((await call('DELETE', `/v1/account/tokens/${issued.body.id}`, { token: session })).status, 200);

    assert.equal(events('account.created')[0].uid, 'ada');
    const failed = events('auth.signin.failed')[0];
    assert.equal(failed.uid, 'ada');
    assert.equal(failed.errorCode, 'invalid-credentials');
    assert.equal(failed.severity, 'WARNING');
    assert.equal(events('auth.signin')[0].uid, 'ada');
    assert.deepEqual(events('token.issued').map(e => [e.uid, e.kind, e.by]), [['ada', 'app', 'account']]);
    assert.equal(events('token.revoked')[0].tokenId, issued.body.id);
  });

  await test('each request is logged once with method, path, status, duration and uid — no query string', async () => {
    await call('GET', '/v1/account?secret=should-not-appear', { token: session });
    const req = events('http.request').find(e => e.path === '/v1/account');
    assert.ok(req, 'the request is logged');
    assert.equal(req.method, 'GET');
    assert.equal(req.status, 200);
    assert.equal(req.uid, 'ada');
    assert.equal(req.tokenKind, 'session');
    assert.equal(typeof req.ms, 'number');
    assert.ok(!lines.some(l => l.includes('should-not-appear')), 'query strings are not logged');
    await call('GET', '/v1/healthz');
    assert.ok(!events('http.request').some(e => e.path === '/v1/healthz'), 'liveness checks are left out');
    const denied = await call('GET', '/v1/whoami', { token: 'aat_wrong' });
    assert.equal(denied.status, 401);
    assert.equal(events('http.request').find(e => e.path === '/v1/whoami').severity, 'WARNING');
  });

  await test('apps connecting and MCP calls are logged and stored as the account\'s activity', async () => {
    const adapter = { enabled: false, enable() { this.enabled = true; }, disable() { this.enabled = false; } };
    const provider = createAdapterProvider({
      application: { appId: 'demo', name: 'Demo store', version: '1.0.0', supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node' }, surfaces: ['web'] },
      adapters: [fromToggleAdapter({ adapter, descriptor: defineDescriptor({ appId: 'demo', id: 'big-text', name: 'Big text', version: '1.0.0', targets: [{ platforms: ['*'], urls: ['https://shop.test/*'] }] }) })],
    });
    link = connectToToolkit({ url: svc.base, token: defaultToken, provider, providerId: 'tab-1', label: 'Test tab' });
    await link.ready;
    const mcp = createMcpClient({ url: `${svc.base}/v1/mcp/apps/demo`, token: defaultToken });
    const r = await mcp.callTool('apply_big-text', { enabled: true, target: { url: 'https://shop.test/p' } });
    assert.equal(r.structuredContent.status, 'applied');

    assert.equal(events('app.registered')[0].appId, 'demo');
    assert.equal(events('app.connected')[0].providerId, 'tab-1');
    const callEntry = events('mcp.call').find(e => e.tool === 'apply_big-text');
    assert.deepEqual([callEntry.uid, callEntry.appId, callEntry.adapter, callEntry.outcome], ['ada', 'demo', 'big-text', 'applied']);

    await svc.app.activity.flush();
    const stored = await store.readJSON(ACTIVITY_DOC('ada'));
    assert.ok(stored.entries.some(e => e.tool === 'apply_big-text' && e.appId === 'demo' && e.outcome === 'applied'));
    assert.ok(!JSON.stringify(stored).includes('shop.test/p'), 'arguments are not stored');
  });

  await test('recent calls survive a restart of the service', async () => {
    await link.close();
    await until(() => events('app.disconnected').length);
    await svc.stop();
    svc = await boot();
    const apps = (await call('GET', '/v1/apps', { token: session })).body.apps;
    const demo = apps.find(a => a.appId === 'demo');
    assert.equal(demo.live, false);
    assert.equal(demo.connections.length, 0, 'live connections do not survive a restart');
    assert.ok(demo.recentCalls.some(c => c.tool === 'apply_big-text' && c.outcome === 'applied'), 'the stored calls do');
  });

  await test('deleting the account deletes its stored activity, and buffered calls are not written back', async () => {
    svc.app.activity.record('ada', { appId: 'demo', tool: 'adapter_list', outcome: 'ok' });
    assert.equal((await call('DELETE', '/admin/accounts/ada', { admin: true })).status, 200);
    await svc.app.activity.flush();
    assert.equal(await store.readJSON(ACTIVITY_DOC('ada')), null);
    assert.equal(events('user.deleted')[0].uid, 'ada');
  });

  await test('request and response bodies are in the request log, with passwords and tokens redacted', async () => {
    const made = await call('POST', '/admin/accounts', { admin: true, body: { uid: 'cy' } });
    secrets.push(made.body.password);
    lines.length = 0;
    const signedIn = await call('POST', '/v1/auth/login', { body: { username: 'cy', password: made.body.password } });
    const token = signedIn.body.defaultToken;
    secrets.push(token, signedIn.body.token);
    await fetch(`${svc.base}/v1/librarian/setProfileField`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ args: ['fields.textSize', 1.5] }),
    });
    const login = events('http.request').find(e => e.path === '/v1/auth/login');
    assert.equal(login.request.username, 'cy');
    assert.equal(login.request.password, '[redacted]');
    assert.equal(login.response.defaultToken, '[redacted]');
    assert.equal(login.response.account.uid, 'cy', 'the rest of the response is there');
    const setField = events('http.request').find(e => e.path === '/v1/librarian/setProfileField');
    assert.deepEqual(setField.request, { args: ['fields.textSize', 1.5] });
    assert.equal(setField.response.ok, true);
    assert.equal(setField.response.result.fields.textSize, 1.5, 'the response data is logged too');
  });

  await test('credentials are redacted wherever they sit, and long content is cut', () => {
    assert.deepEqual(redact({ password: 'x', nested: { defaultToken: 'aat_abcdefgh', note: 'key AIzaSyA1234567890123456789012 and aat_abcdefghij' }, tokenCount: 3, keep: true }),
      { password: '[redacted]', nested: { defaultToken: '[redacted]', note: 'key [redacted key] and aat_[redacted]' }, tokenCount: 3, keep: true });
    const long = loggedContent('y'.repeat(MAX_LOGGED_CHARS + 50));
    assert.equal(long.truncated, true);
    assert.equal(long.length, MAX_LOGGED_CHARS + 50);
    assert.equal(long.text.length, MAX_LOGGED_CHARS);
  });

  await test('each AI call is logged with the account, purpose, prompt, reply and token counts', async () => {
    lines.length = 0;
    const reply = { candidates: [{ content: { parts: [{ text: '{"operations":[]}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 } };
    const caller = createGeminiCaller({ apiKey: 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE', log, fetch: async (url, init) => {
      assert.match(url, /models\/gemini-3\.8-flash:generateContent$/);
      assert.equal(init.headers['x-goog-api-key'], 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE');
      return new Response(JSON.stringify(reply), { status: 200 });
    } });
    assert.equal(await withAiContext('ada', 'extractNow', () => caller('Observations: turned on captions.')), '{"operations":[]}');
    const [entry] = events('ai.call');
    assert.equal(entry.severity, 'INFO');
    assert.deepEqual([entry.model, entry.uid, entry.purpose, entry.outcome, entry.prompt, entry.reply, entry.promptTokens, entry.outputTokens, entry.totalTokens, entry.finishReason],
      ['gemini-3.8-flash', 'ada', 'extractNow', 'ok', 'Observations: turned on captions.', { operations: [] }, 12, 5, 17, 'STOP']);
    assert.ok(!lines.some(l => l.includes('AIzaSyFAKE')), 'never the key');
  });

  await test('failed AI calls are logged with Google\'s answer, and without a key the call is logged as skipped', async () => {
    lines.length = 0;
    const failing = createGeminiCaller({ apiKey: 'k', log, fetch: async () => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }), { status: 429 }) });
    await assert.rejects(withAiContext('ada', 'buildSkill', () => failing('p')), /Gemini API error 429 RESOURCE_EXHAUSTED/);
    const [failed] = events('ai.call');
    assert.deepEqual([failed.severity, failed.outcome, failed.httpStatus, failed.errorStatus, failed.reply.error.message], ['WARNING', 'http-error', 429, 'RESOURCE_EXHAUSTED', 'quota']);
    await assert.rejects(createGeminiCaller({ log })('p'), /no-server-key/);
    assert.equal(events('ai.call')[1].outcome, 'no-key');
  });

  await test('with LOG_CONTENT off, no bodies, prompts or replies are logged', async () => {
    const quiet = [];
    const quietLog = createLogger({ format: 'json', level: 'debug', write: (line) => quiet.push(JSON.parse(line)) });
    const caller = createGeminiCaller({ apiKey: 'k', log: quietLog, logContent: false, fetch: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), { status: 200 }) });
    await caller('secret prompt');
    const app = createApp({ store, adminPassword: ADMIN, toolkitHost: createToolkitHost({ store, geminiCaller: caller }), log: quietLog, logContent: false });
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await fetch(`http://127.0.0.1:${server.address().port}/v1/meta`);
    await new Promise(r => setTimeout(r, 50));
    server.close(); app.relay.closeAll();
    assert.ok(quiet.some(e => e.event === 'ai.call' && e.outcome === 'ok'));
    assert.ok(quiet.some(e => e.event === 'http.request' && e.path === '/v1/meta'));
    assert.ok(!quiet.some(e => 'prompt' in e || 'reply' in e || 'request' in e || 'response' in e));
  });

  await test('no log line contains a password, a token or the admin password', () => {
    for (const secret of secrets.filter(Boolean)) {
      assert.ok(!lines.some(l => l.includes(secret)), `a secret appeared in the log: ${secret.slice(0, 6)}…`);
    }
    assert.ok(!lines.some(l => /bearer /i.test(l)), 'no Authorization header');
  });
} finally {
  await link?.close().catch(() => {});
  await svc.stop();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nLogging: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
