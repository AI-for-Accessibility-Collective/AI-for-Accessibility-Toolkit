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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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
let quiet = false;
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
  if (req.method === 'GET' && req.url === '/admin/sandboxes') {
    return send(200, { vm: { cpus: 96, load: [1, 1, 1], memTotal: 1, memFree: 1 }, limits: { cpus: 6, memory: '12g' }, accounts: [{ uid: 'ada', chats: 2, running: 1, sandbox: { state: 'running', cpuPercent: 12.5 } }] });
  }
  if (req.method === 'GET' && req.url.startsWith('/admin/checks')) {
    return send(200, { capacity: { cpus: 72, cpuUsed: 24, perCheck: 24, burst: { max: 10, running: 0 }, reviews: { max: 8, running: 0 } },
      running: [{ checkId: 'chk_1', uid: 'ada', adapter: 'Bigger buttons', review: false, where: 'here' }], queued: [], recent: [] });
  }
  const m = /^\/checks\/([^/]+)$/.exec(req.url);
  if (req.method === 'GET' && m) {
    if (quiet) return send(500, { error: 'busy' });
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

async function boot(agent, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'adapter-checks-test-'));
  const store = fileStore(dir);
  const lines = [];
  const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
  const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
  const app = createApp({ store, adminPassword: ADMIN, toolkitHost, log, agentHost: agent, ...extra });
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

await test('while the host does not answer, it says the last state it saw', async () => {
  quiet = true;
  try {
    const body = await (await call(`/v1/adapters/checks/${first.checkId}`)).json();
    assert.equal(body.check.status, 'running', 'not back to waiting');
    assert.match(body.note, /not answering/);
  } finally { quiet = false; }
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

await test('the admin console sees the host\'s checks: the admin only, with the shared secret to the host', async () => {
  assert.equal((await fetch(`${svc.base}/admin/checks`)).status, 401);
  assert.equal((await fetch(`${svc.base}/admin/checks`, { headers: { authorization: `Bearer ${await svc.mint('ada')}` } })).status, 401, 'not a person\'s token');
  const res = await fetch(`${svc.base}/admin/checks`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(res.status, 200);
  const o = await res.json();
  assert.deepEqual([o.capacity.cpuUsed, o.running[0].where], [24, 'here']);
  const asked = seen.findLast((x) => x.url.startsWith('/admin/checks'));
  assert.equal(asked.auth, `Bearer ${SECRET}`);
  assert.equal((await fetch(`${svc.base}/admin/sandboxes`)).status, 401);
  const sb = await (await fetch(`${svc.base}/admin/sandboxes`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
  assert.deepEqual([sb.accounts[0].uid, sb.accounts[0].running, sb.limits.cpus], ['ada', 1, 6]);
});

// ── adapter_verify: the same check and review as a tool call, with progress and a report ──
const summaries = [];
const vsvc = await boot({ url: hostUrl, secret: SECRET }, { verifyPollMs: 40, ai: { caller: async (prompt) => { summaries.push(prompt); return 'Here is what it does:\n- Makes small buttons bigger to hit.\n- Keeps the page layout.'; }, price: () => ({ input: 0, output: 0 }) } });
const vada = await vsvc.mint('ada');
await vsvc.publish('ada', 'verify-me');
const mcp = async (name, args, { token = vada, progressToken } = {}) => {
  const res = await fetch(`${vsvc.base}/v1/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...(progressToken ? { _meta: { progressToken } } : {}) } }),
  });
  if (!String(res.headers.get('content-type')).includes('event-stream')) return { result: (await res.json()).result, progress: [] };
  const events = (await res.text()).split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l.slice(5)));
  return { result: events.find((e) => e.id === 1).result, progress: events.filter((e) => e.method === 'notifications/progress').map((e) => e.params.message) };
};
/** Move the stand-in host's job for this adapter through its stages. */
async function walk(key, stages) {
  // Only a check asked for from now on, not an earlier one of the same adapter.
  const from = seen.length;
  let job;
  for (let i = 0; i < 400 && !job; i++) { const s = seen.slice(from).findLast((x) => x.method === 'POST' && x.body?.adapter?.key === key); if (s) job = s.body.checkId; else await new Promise((r) => setTimeout(r, 20)); }
  if (!job) throw new Error(`no check of ${key} was asked for`);
  for (const st of stages) { await new Promise((r) => setTimeout(r, 150)); if (st === 'done') finish(job); else Object.assign(jobs.get(job), st); }
  return job;
}

await test('adapter_verify: says what the adapter does, reports progress as it goes, and ends with the changes to make', async () => {
  const walking = walk('ada/agent/verify-me', [
    { status: 'running', stage: 'check' },
    { status: 'running', stage: 'review', reviewers: 3, reviewersDone: 1, result: { check: { summary: RESULT.check.summary } } },
    'done',
  ]);
  const { result, progress } = await mcp('adapter_verify', { adapter: 'verify-me', waitSeconds: 30 }, { progressToken: 'p1' });
  await walking;
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.match(progress[0], /^Asked for a verification of Bigger buttons \(revision 1\): the check, then three reviewers\.$/);
  assert.match(progress[1], /What it does:\n- Makes small buttons bigger to hit\.\n- Keeps the page layout\./);
  assert.ok(progress.includes('Waiting for the checker: number 1 in line.'), progress);
  assert.ok(progress.some((p) => /^Running the check/.test(p)), progress);
  assert.ok(progress.includes('Check done: 70 runs passed, 2 failed. Reviewing: 1 of 3 reviewers finished (the code; what people perceive; how people operate it).'), progress);
  assert.equal(progress.at(-1), 'Done.');
  assert.match(summaries[0], /<code>\n[\s\S]*dataset\.big/);
  const r = result.structuredContent;
  assert.equal(r.status, 'done');
  assert.equal(r.summary, '- Makes small buttons bigger to hit.\n- Keeps the page layout.');
  assert.deepEqual(r.review.findings, { high: 1, medium: 0, low: 1 });
  assert.ok(r.actions.some((a) => /^Fix the failed run "a\.html \(narrow\)"/.test(a)), r.actions);
  assert.ok(r.actions.includes('Fix (high): a.js:3 — focus lost'), r.actions);
  assert.equal(r.actions.at(-1), 'Then publish a new revision and verify again.');
  // The text an agent reads is the report itself.
  assert.match(result.content[0].text, /^Bigger buttons \(revision 1\)\n\nWhat it does:/);
  assert.match(result.content[0].text, /Check: 70 of 72 runs passed, 2 failed, 3 skipped; it applied on 4 of 22 test pages\./);
  assert.match(result.content[0].text, /Review: issues: 1 high, 0 medium, 1 low/);
  assert.match(result.content[0].text, /Recommended actions:\n1\. /);
  assert.match(result.content[0].text, /pre-alpha/);
  assert.equal(seen.findLast((x) => x.method === 'POST' && x.body?.adapter?.key === 'ada/agent/verify-me').body.review, true, 'a full review by default');
});

await test('adapter_verify: past waitSeconds it returns the checkId, and calling again keeps waiting', async () => {
  await vsvc.publish('ada', 'verify-me', 'export default { enable() { return true; }, disable() {} }; // v2');
  const first = await mcp('adapter_verify', { adapter: 'verify-me', review: false, waitSeconds: 5 });
  const waiting = first.result.structuredContent;
  assert.equal(waiting.status, 'queued');
  assert.match(waiting.next, /Call adapter_verify again with \{ checkId: "chk_[a-f0-9]{20}" \}/);
  assert.match(first.result.content[0].text, /^Waiting for the checker/);
  setTimeout(() => finish(waiting.checkId, { check: { summary: { passed: 10, failed: 0, skipped: 0, appliedOnTestPages: 3, testPages: 3 }, runs: [] } }), 200);
  const again = (await mcp('adapter_verify', { checkId: waiting.checkId, waitSeconds: 10 })).result.structuredContent;
  assert.equal(again.status, 'done');
  assert.deepEqual(again.actions, ['Nothing to change from these checks. Next, have people who meet the barrier it is for try it on the pages they use.']);
  assert.equal(again.review, undefined);
});

await test('adapter_verify: an app-bound token is refused, and an unknown adapter is said plainly', async () => {
  const appToken = await vsvc.mint('ada', 'app', { appId: 'shop' });
  const refused = (await mcp('adapter_verify', { adapter: 'verify-me' }, { token: appToken })).result;
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /default token/);
  const missing = (await mcp('adapter_verify', { adapter: 'nothing-here' })).result;
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /You have no adapter nothing-here/);
});

await test('the skill\'s helper verifies: progress lines as they come, then the report', async () => {
  await vsvc.publish('ada', 'verify-me', 'export default { enable() { return true; }, disable() {} }; // v3');
  const helper = fileURLToPath(new URL('../../.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs', import.meta.url));
  const { TOOLKIT_URL: _u, TOOLKIT_TOKEN: _t, ...env } = process.env;
  const walking = walk('ada/agent/verify-me', [{ status: 'running', stage: 'check' }, 'done']);
  const { stdout } = await promisify(execFile)(process.execPath, [helper, 'verify', 'verify-me', '--no-review', '--wait', '1'], { timeout: 60_000, env: { ...env, TOOLKIT_URL: vsvc.base, TOOLKIT_TOKEN: vada } });
  await walking;
  assert.match(stdout, /^· Asked for a verification of Bigger buttons \(revision 3\): the check\.\n/);
  assert.match(stdout, /What it does:\n- Makes small buttons bigger to hit\./);
  assert.match(stdout, /· Running the check/);
  assert.match(stdout, /\n\nBigger buttons \(revision 3\)\n\nWhat it does:/);
  assert.match(stdout, /Recommended actions:\n1\. Fix the failed run/);
});

vsvc.stop();
svc.stop();
agentHost.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
