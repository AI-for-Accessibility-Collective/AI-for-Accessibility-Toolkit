// /v1/adapters/checks: a check of a published adapter, on request. The
// service checks the token (no app-bound ones), reads the adapter from the
// registry as the account can, forwards to the agent host with the shared
// secret and the code, and keeps the result with the revision it checked.
// No limit on how many: asking again checks again, except that a check of
// the same revision still waiting or running is shared rather than run twice.
//
//   node server/test/adapter-checks.test.mjs

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

// A stand-in agent host: takes jobs, says how they are, finishes one when told.
const jobs = new Map();
const seen = [];
let refuse = null;
const agentHost = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, uid: req.headers['x-ai4a11y-uid'], body });
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'POST' && req.url === '/checks') {
    if (refuse) return send(refuse, { error: 'checks-unavailable', message: 'Checks are not set up on this host.' });
    jobs.set(body.checkId, { uid: req.headers['x-ai4a11y-uid'], status: 'queued', position: 1, review: body.review });
    return send(202, { check: { checkId: body.checkId, status: 'queued', position: 1 } });
  }
  const m = /^\/checks\/([^/]+)$/.exec(req.url);
  if (req.method === 'GET' && m) {
    const j = jobs.get(m[1]);
    if (!j || j.uid !== req.headers['x-ai4a11y-uid']) return send(404, { error: 'not-found' });
    return send(200, { check: { checkId: m[1], ...j } });
  }
  send(404, { error: 'not-found' });
});
await new Promise(r => agentHost.listen(0, '127.0.0.1', r));
const hostUrl = `http://127.0.0.1:${agentHost.address().port}`;

const RESULT = {
  check: { summary: { passed: 70, failed: 2, skipped: 3, appliedOnTestPages: 4, testPages: 22 }, notes: ['These checks find some problems in code.'], runs: [{ name: 'a.html (narrow)', status: 'fail', result: 'applied', problems: ['adds target-size (WCAG 2.5.8) on 2'] }] },
  review: { verdict: 'issues', rubricsRead: ['2.4.7'], report: 'Verdict: issues\n[high] a.js:3 — focus lost\n  Evidence: confirmed\n  Fix: keep it\n[low] a.js:9 — minor\n' },
};
const finish = (checkId, result = RESULT) => Object.assign(jobs.get(checkId), { status: 'done', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result });

async function boot(agent) {
  const dir = await mkdtemp(path.join(tmpdir(), 'adapter-checks-test-'));
  const store = fileStore(dir);
  const lines = [];
  const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
  const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
  const app = createApp({ store, adminPassword: ADMIN, toolkitHost, log, agentHost: agent });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mint = async (uid, kind = 'default', extra = {}) => (await (await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid, kind, ...extra }) })).json()).token;
  const publish = (uid, id, code, extra = {}) => app.registry.call(uid, 'adapter_publish', {
    appName: 'Coding agent',
    descriptor: { appId: 'agent', id, name: 'Bigger buttons', description: 'Makes buttons bigger, for people who find small targets hard to hit.', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }], supportAreas: ['motor'] },
    ...(code === null ? {} : { package: { format: 'web-module@1', code: code || `export default { enable() { document.body.dataset.big = "1"; return true; }, disable() { delete document.body.dataset.big; } }; // ${id}` } }),
    ...extra,
  });
  return { base, lines, mint, publish, store, stop: () => { app.relay.closeAll(); server.closeAllConnections?.(); server.close(); } };
}

const svc = await boot({ url: hostUrl, secret: SECRET });
const ada = await svc.mint('ada');
const call = (p, { token = ada, method = 'GET', body } = {}) => fetch(svc.base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
await svc.publish('ada', 'bigger-buttons');

await test('says plainly when no checker is set up', async () => {
  const off = await boot({});
  const t = await off.mint('ada');
  const res = await fetch(`${off.base}/v1/adapters/checks`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: '{"id":"x"}' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /not set up/);
  off.stop();
});

await test('needs the account\'s own token, never an app-bound one', async () => {
  assert.equal((await call('/v1/adapters/checks', { token: null, method: 'POST', body: { id: 'bigger-buttons' } })).status, 401);
  assert.equal((await call('/v1/adapters/checks', { token: 'aat_nope', method: 'POST', body: { id: 'bigger-buttons' } })).status, 401);
  const appToken = await svc.mint('ada', 'app', { appId: 'shop' });
  assert.equal((await call('/v1/adapters/checks', { token: appToken, method: 'POST', body: { id: 'bigger-buttons' } })).status, 403);
});

let first;
await test('asks the host to check the current revision, with the code, the secret and the account', async () => {
  const res = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } });
  assert.equal(res.status, 202);
  const body = await res.json();
  first = body.check;
  assert.match(first.checkId, /^chk_[a-f0-9]{20}$/);
  assert.deepEqual(first.adapter, { owner: 'ada', appId: 'agent', id: 'bigger-buttons' });
  assert.equal(first.revision, 1);
  assert.equal(first.status, 'queued');
  assert.equal(first.position, 1);
  assert.match(body.framing, /pre-alpha/);
  const sent = seen.at(-1);
  assert.equal(sent.auth, `Bearer ${SECRET}`);
  assert.equal(sent.uid, 'ada');
  assert.equal(sent.body.review, false);
  assert.equal(sent.body.adapter.key, 'ada/agent/bigger-buttons');
  assert.match(sent.body.adapter.code, /dataset\.big/);
  assert.match(sent.body.adapter.description, /small targets/);
  assert.deepEqual(sent.body.adapter.urlPatterns, ['https://example.com/*']);
});

await test('while a check of the same revision is waiting or running, asking again shares it', async () => {
  const sentBefore = seen.length;
  const res = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'agent/bigger-buttons' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.reused, true);
  assert.equal(body.check.checkId, first.checkId);
  jobs.get(first.checkId).status = 'running';
  const again = await (await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } })).json();
  assert.equal(again.check.checkId, first.checkId);
  assert.equal(again.check.status, 'running');
  assert.equal(seen.filter((s, i) => i >= sentBefore && s.method === 'POST').length, 0, 'nothing new sent');
});

await test('shows the result once the host has it, and keeps it with the revision', async () => {
  let c = (await (await call(`/v1/adapters/checks/${first.checkId}`)).json()).check;
  assert.equal(c.status, 'running');
  finish(first.checkId, { check: RESULT.check });
  c = (await (await call(`/v1/adapters/checks/${first.checkId}`)).json()).check;
  assert.equal(c.status, 'done');
  assert.equal(c.revision, 1);
  assert.deepEqual(c.result.check.summary, RESULT.check.summary);
  // Kept: the host forgetting it changes nothing.
  jobs.delete(first.checkId);
  c = (await (await call(`/v1/adapters/checks/${first.checkId}`)).json()).check;
  assert.equal(c.status, 'done');
  assert.equal(c.result.check.runs[0].problems[0], 'adds target-size (WCAG 2.5.8) on 2');
  const list = await (await call('/v1/adapters/checks?appId=agent&id=bigger-buttons')).json();
  assert.equal(list.checks[0].summary.failed, 2);
  assert.equal(list.checks[0].result, undefined, 'the list has summaries only');
  assert.equal(list.usage, undefined, 'no usage: there is no limit');
  // Another account cannot read it.
  const bo = await svc.mint('bo');
  assert.equal((await call(`/v1/adapters/checks/${first.checkId}`, { token: bo })).status, 404);
});

await test('a finished check is never reused: asking again runs a new one', async () => {
  const res = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } });
  assert.equal(res.status, 202);
  const { check } = await res.json();
  assert.notEqual(check.checkId, first.checkId);
  assert.equal(check.revision, 1);
  // One the host finished that the service has not heard about yet is not shared either.
  finish(check.checkId, { check: RESULT.check });
  const next = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } });
  assert.equal(next.status, 202);
  const third = (await next.json()).check;
  assert.notEqual(third.checkId, check.checkId);
  assert.equal((await (await call(`/v1/adapters/checks/${check.checkId}`)).json()).check.status, 'done');
  // Many in a row are fine: no daily limit.
  for (let i = 0; i < 6; i++) {
    finish(third.checkId, { check: RESULT.check });
    const r = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } });
    assert.equal(r.status, 202);
    third.checkId = (await r.json()).check.checkId;
  }
  finish(third.checkId, { check: RESULT.check });
});

await test('a review is not shared with a plain check, and has its verdict and findings in the summary', async () => {
  const plain = (await (await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } })).json()).check;
  const res = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons', review: true } });
  assert.equal(res.status, 202, 'a running plain check does not stand in for a review');
  const { check } = await res.json();
  assert.equal(seen.at(-1).body.review, true);
  // While the review runs, a plain check of the revision shares it.
  finish(plain.checkId, { check: RESULT.check });
  const shared = await (await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } })).json();
  assert.equal(shared.check.checkId, check.checkId);
  finish(check.checkId);
  const c = (await (await call(`/v1/adapters/checks/${check.checkId}`)).json()).check;
  assert.equal(c.verdict, 'issues');
  assert.deepEqual(c.findings, { high: 1, medium: 0, low: 1 });
  // Reviews as often as asked.
  const again = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons', review: true } });
  assert.equal(again.status, 202);
  finish((await again.json()).check.checkId);
});

await test('a check the host refuses or never gets is not listed, and says why', async () => {
  refuse = 503;
  const busy = await call('/v1/adapters/checks', { method: 'POST', body: { id: 'bigger-buttons' } });
  assert.equal(busy.status, 503);
  assert.doesNotMatch((await busy.json()).message, /quota|count/);
  refuse = null;
  const down = await boot({ url: 'http://127.0.0.1:1', secret: SECRET });
  await down.publish('ada', 'x1');
  const t = await down.mint('ada');
  const r = await fetch(`${down.base}/v1/adapters/checks`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: '{"id":"x1"}' });
  assert.equal(r.status, 502);
  assert.match((await r.json()).message, /not answering/);
  const list = await (await fetch(`${down.base}/v1/adapters/checks`, { headers: { authorization: `Bearer ${t}` } })).json();
  assert.equal(list.checks.length, 0);
  down.stop();
});

await test('only adapters the account can read; shared ones are fine; no code, no check', async () => {
  const bo = await svc.mint('bo');
  await svc.publish('ada', 'private-one');
  assert.equal((await call('/v1/adapters/checks', { token: bo, method: 'POST', body: { id: 'ada/agent/private-one' } })).status, 404);
  assert.equal((await call('/v1/adapters/checks', { token: bo, method: 'POST', body: { id: 'private-one' } })).status, 404);
  await svc.publish('ada', 'shared-one', undefined, { shared: true });
  const ok = await call('/v1/adapters/checks', { token: bo, method: 'POST', body: { id: 'ada/agent/shared-one' } });
  assert.equal(ok.status, 202);
  assert.equal(seen.at(-1).uid, 'bo', 'counted and run as the account that asked');
  await svc.publish('bo', 'described');
  const bo2 = await svc.mint('bo2');
  await svc.publish('bo2', 'words-only', null);
  const none = await call('/v1/adapters/checks', { token: bo2, method: 'POST', body: { id: 'words-only' } });
  assert.equal(none.status, 400);
  assert.match((await none.json()).message, /no code to check/);
  assert.equal((await call('/v1/adapters/checks', { token: bo2, method: 'POST', body: {} })).status, 400);
});

await test('neither the code nor a report is in the request log', async () => {
  const log = svc.lines.join('\n');
  assert.ok(!log.includes('dataset.big'), 'no code');
  assert.ok(!log.includes('adds target-size'), 'no report');
  assert.ok(log.includes('"event":"check.asked"'));
});

svc.stop();
agentHost.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
