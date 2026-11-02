// /v1/agent/…: the assistant sidebar's route to the agent host. The service
// checks the person's token, forwards with the shared secret and the account,
// passes event streams through, refuses app-bound tokens, says plainly when
// no host is set up, and never logs what a person shared of a page.
//
//   node server/test/agent-proxy.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createLogger } from '../src/log.js';

const ADMIN = 'test-admin-password';
const SECRET = 'agent-host-secret-for-tests-0123456789';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

// A stand-in agent host.
const seen = [];
const agentHost = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, uid: req.headers['x-ai4a11y-uid'], body: Buffer.concat(chunks).toString() });
  if (req.url === '/agent/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: entry\ndata: {"type":"entry"}\n\n');
    return setTimeout(() => res.end(), 50);
  }
  res.writeHead(req.url.startsWith('/agent/requests/') ? 200 : 201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, echoed: req.url }));
});
await new Promise(r => agentHost.listen(0, '127.0.0.1', r));

async function boot(agent) {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-proxy-test-'));
  const store = fileStore(dir);
  const lines = [];
  const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
  const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
  const app = createApp({ store, adminPassword: ADMIN, toolkitHost, log, agentHost: agent });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mint = async (uid, kind = 'default', extra = {}) => (await (await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid, kind, ...extra }) })).json()).token;
  return { base, lines, mint, stop: () => { app.relay.closeAll(); server.closeAllConnections?.(); server.close(); } };
}

const svc = await boot({ url: `http://127.0.0.1:${agentHost.address().port}`, secret: SECRET });
const person = await svc.mint('ada');
const call = (p, { token = person, method = 'GET', body } = {}) => fetch(svc.base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

await test('forwards with the shared secret and the account, never the person\'s token', async () => {
  const res = await call('/v1/agent/chats', { method: 'POST', body: {} });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, echoed: '/agent/chats' });
  const last = seen.at(-1);
  assert.equal(last.auth, `Bearer ${SECRET}`);
  assert.equal(last.uid, 'ada');
});

await test('passes the event stream through', async () => {
  const res = await call('/v1/agent/events');
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.match(await res.text(), /event: entry/);
});

await test('needs a token, and not an app-bound one', async () => {
  assert.equal((await call('/v1/agent/chats', { token: null })).status, 401);
  assert.equal((await call('/v1/agent/chats', { token: 'aat_nope' })).status, 401);
  const appToken = await svc.mint('ada', 'app', { appId: 'shop' });
  assert.equal((await call('/v1/agent/chats', { token: appToken })).status, 403);
});

await test('what a person shares of a page is not in the request log; a chat message is', async () => {
  await call('/v1/agent/requests/req_1', { method: 'POST', body: { level: 'source', url: 'https://bank.example/account', outline: 'Balance 1234' } });
  await call('/v1/agent/chats/c_abcdefgh/messages', { method: 'POST', body: { text: 'make the buttons bigger' } });
  await new Promise(r => setTimeout(r, 50));
  const logged = svc.lines.join('\n');
  assert.ok(seen.some(s => s.body.includes('bank.example')), 'the host got it');
  assert.ok(!logged.includes('bank.example') && !logged.includes('Balance 1234'), 'the log did not');
  assert.ok(logged.includes('make the buttons bigger'));
});

await test('without an agent host it says the assistant is not set up', async () => {
  const bare = await boot({});
  const token = await bare.mint('bo');
  const res = await fetch(`${bare.base}/v1/agent/chats`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'agent-unavailable');
  bare.stop();
});

svc.stop();
agentHost.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
