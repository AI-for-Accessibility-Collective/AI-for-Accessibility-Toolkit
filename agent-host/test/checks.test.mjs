// Checks of published adapters on the agent host (src/checks.js), with a
// stand-in for run.mjs (fake-check.mjs): who may ask, one at a time and in
// order with no cap on the queue, the result and what is kept, a review's token good only at the
// model proxy and only while it runs, time limits, a restart, and what the
// VM's runner hands docker.

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, listen } from '../src/host.js';
import { createChecks, dockerCheckRunner } from '../src/checks.js';
import { copyFromMhtml } from '../../scripts/verify-adapters/mhtml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-that-is-long-enough-5678';
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok   - ${name}`); };
const until = async (check, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } throw new Error('timed out'); };

const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-checks-'));
const upstream = [];
const fakeFetch = async (url, init) => {
  upstream.push({ url: String(url), key: init.headers['x-goog-api-key'] });
  return new Response('{"candidates":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
};
const lines = [];
const log = { info: (e, f) => lines.push({ e, ...f }), warn: (e, f) => lines.push({ e, ...f }), error: (e, f) => lines.push({ e, ...f }) };
const sandboxPort = 21790 + Math.floor(Math.random() * 500), apiPort = sandboxPort + 1000;
// The host's own secrets are in its environment; a check must never see them.
process.env.AGENT_HOST_SECRET = SECRET;
process.env.AGENT_GEMINI_KEY = 'REAL-KEY';
let rubricFetches = 0;
const host = createHost({
  dataDir, secret: SECRET, apiKey: 'REAL-KEY', sandboxUrl: `http://127.0.0.1:${sandboxPort}`, runnerKind: 'local',
  opencodeBin: path.join(here, 'fake-opencode.mjs'), repoDir: path.resolve(here, '../..'), fetch: fakeFetch,
  checkScript: path.join(here, 'fake-check.mjs'), checkTimeoutMs: 4000, reviewTimeoutMs: 8000,
  fetchRubrics: async () => { rubricFetches++; return { have: ['1.1.1'], missing: [] }; }, log,
});
const servers = [await listen(host.sandboxHandler, `127.0.0.1:${sandboxPort}`), await listen(host.apiHandler, `127.0.0.1:${apiPort}`)];
const api = (p, { method = 'GET', body, uid = 'ada', secret = SECRET } = {}) => fetch(`http://127.0.0.1:${apiPort}${p}`, {
  method, headers: { authorization: `Bearer ${secret}`, 'x-ai4a11y-uid': uid, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
let n = 0;
const newId = () => `chk_${(Date.now().toString(16) + (n++).toString(16).padStart(4, '0')).padEnd(16, '0')}`;
const job = (code = 'export default { enable() { return true; }, disable() {} };', extra = {}) => ({
  checkId: newId(), review: false,
  adapter: { key: 'ada/agent/bigger-buttons', revision: 3, name: 'Bigger buttons', description: 'Makes buttons bigger.', urlPatterns: ['https://example.com/*'], supportAreas: ['motor'], code },
  ...extra,
});
const finished = (id, uid = 'ada') => until(async () => { const c = (await (await api(`/checks/${id}`, { uid })).json()).check; return ['done', 'failed'].includes(c?.status) && c; });

await test('checks need the shared secret, a check id and code', async () => {
  assert.equal((await api('/checks', { method: 'POST', body: job(), secret: 'wrong-secret-wrong-secret-wrong-0000' })).status, 401);
  assert.equal((await api('/checks', { method: 'POST', body: { ...job(), checkId: '../x' } })).status, 400);
  const empty = job(); empty.adapter.code = ' ';
  assert.equal((await api('/checks', { method: 'POST', body: empty })).status, 400);
  const big = job('x'.repeat(256_001));
  assert.equal((await api('/checks', { method: 'POST', body: big })).status, 413);
});

await test('a check runs, and its result comes back to the account that asked, without the code', async () => {
  const j = job('export default { enable() { return true; }, disable() {} }; // SECRET-CODE-MARK');
  const res = await api('/checks', { method: 'POST', body: j });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).check.status, 'queued');
  assert.equal((await api('/checks', { method: 'POST', body: j })).status, 409, 'the same check id twice');
  const c = await finished(j.checkId);
  assert.equal(c.status, 'done');
  assert.deepEqual(c.result.check.summary, { passed: 1, failed: 1, skipped: 1, appliedOnTestPages: 1, testPages: 1 });
  assert.equal(c.result.check.runs[1].problems[0], 'adds color-contrast (WCAG 1.4.3) on 2');
  assert.deepEqual(c.result.check.runs[1].advice, ['region on 1']);
  assert.equal(c.result.review, undefined);
  assert.equal((await api(`/checks/${j.checkId}`, { uid: 'bob' })).status, 404, 'another account cannot read it');
  // The adapter, the report and the work folders are gone; only job.json stays, without code.
  const dir = path.join(dataDir, 'checks', j.checkId);
  assert.deepEqual(readdirSync(dir), ['job.json']);
  assert.ok(!readFileSync(path.join(dir, 'job.json'), 'utf8').includes('SECRET-CODE-MARK'));
  assert.ok(!JSON.stringify(lines).includes('SECRET-CODE-MARK'), 'code is never logged');
});

await test('the check sees none of the host\'s secrets, and only the recorded site copies', async () => {
  // fake-check.mjs says what it was given as one more run.
  const j = job('export default {}; // ENV');
  await api('/checks', { method: 'POST', body: j });
  const c = await finished(j.checkId);
  assert.equal(c.status, 'done');
  const env = c.result.check.runs.find(r => r.name === 'env').problems;
  assert.equal(env[0], `sites offline ${path.resolve(here, '../..')}/.verify-cache/sites`);
  assert.equal(env[1], 'secrets absent');
});

await test('one check at a time, in order; the rest wait, however many one account asks for', async () => {
  const many = [job('// SLOW'), job('// SLOW'), job(), job(), job()];
  for (const [i, j] of many.entries()) {
    const res = await api('/checks', { method: 'POST', body: j });
    assert.equal(res.status, 202, 'no cap per account or on the queue');
    const c = (await res.json()).check;
    if (i > 0) assert.equal(c.position, i + 1);
  }
  const bobs = job(); bobs.adapter.key = 'bob/agent/x';
  assert.equal((await api('/checks', { method: 'POST', body: bobs, uid: 'bob' })).status, 202);
  const done = [];
  for (const j of many) done.push(await finished(j.checkId));
  for (let i = 1; i < done.length; i++) assert.ok(Date.parse(done[i].startedAt) >= Date.parse(done[i - 1].finishedAt), 'each started after the one before ended');
  await finished(bobs.checkId, 'bob');
});

await test('with parallel, that many run at once, in the order asked', async () => {
  const dir4 = mkdtempSync(path.join(tmpdir(), 'agent-checks-parallel-'));
  let now = 0, most = 0;
  const started = [];
  const checks = createChecks({ dataDir: dir4, rubricsDir: path.join(dir4, 'intera11y'), log, parallel: 2, runner: {
    async check({ id, dir }) {
      started.push(id); most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 150));
      now--;
      writeFileSync(path.join(dir, 'out', 'report.json'), JSON.stringify({ runs: [] }));
      return { code: 0, timedOut: false, stderr: '' };
    },
  } });
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5'].map((x) => `chk_00000000000000${x}`);
  for (const id of ids) checks.submit('ada', { checkId: id, adapter: { key: 'ada/agent/a', code: 'export default {};' } });
  await until(() => ids.every((id) => checks.get('ada', id).status === 'done'));
  assert.equal(most, 2, 'two at once, never more');
  assert.deepEqual(started, ids.map((id) => id.slice(4)), 'started in the order asked');
});

await test('a check that runs too long is stopped, and one with no report fails, in plain words', async () => {
  const hang = job('// HANG');
  await api('/checks', { method: 'POST', body: hang });
  const c = await finished(hang.checkId);
  assert.equal(c.status, 'failed');
  assert.match(c.error, /took longer than 1 minute and was stopped/);
  const none = job('// NOREPORT');
  await api('/checks', { method: 'POST', body: none });
  assert.match((await finished(none.checkId)).error, /could not finish/);
});

await test('a review runs after the check, with a token that works only at the model proxy and only while it runs', async () => {
  const j = job(undefined, { review: true });
  await api('/checks', { method: 'POST', body: j });
  const c = await finished(j.checkId);
  assert.equal(c.status, 'done');
  assert.equal(c.result.review.verdict, 'issues');
  assert.deepEqual(c.result.review.rubricsRead, ['2.5.8']);
  // What the reviewer saw: the proxy took its token, the browser tools did not; no secrets; it had the about text and the report.
  assert.match(c.result.review.report, /Proxy: 200\. Tools: 401\. Secret: absent\. About: yes\. Report: 1 failed\./);
  assert.equal(upstream.at(-1).key, 'REAL-KEY', 'the proxy added the real key');
  assert.equal(rubricFetches, 1, 'the rubrics were fetched on the host, before the review');
  // After the review, the token is gone.
  const token = lines.find(l => l.e === 'model.call')?.uid;
  assert.equal(token, 'ada', 'model calls are the account\'s');
  const tokenSeen = JSON.stringify(lines).match(/chk_[a-f0-9]{48}/);
  assert.equal(tokenSeen, null, 'the job token is never logged');
});

await test('after a restart, what was waiting runs; what lost its files fails', async () => {
  const dir2 = mkdtempSync(path.join(tmpdir(), 'agent-checks-restart-'));
  const ran = [];
  const runner = {
    async check({ dir, file }) { ran.push(file); writeFileSync(path.join(dir, 'out', 'report.json'), JSON.stringify({ runs: [], summary: { passed: 0, failed: 0, skipped: 0, appliedOnTestPages: 0, testPages: 0 } })); return { code: 0, timedOut: false, stderr: '' }; },
    async review() { return { code: 0, timedOut: false, stderr: '' }; },
    cleanup: async () => { ran.push('cleanup'); },
  };
  const write = (id, status, withFile) => {
    const d = path.join(dir2, 'checks', id);
    mkdirSync(path.join(d, 'in'), { recursive: true });
    if (withFile) writeFileSync(path.join(d, 'in', 'a.js'), 'export default {};');
    writeFileSync(path.join(d, 'job.json'), JSON.stringify({ checkId: id, uid: 'ada', review: false, file: 'a.js', status, submittedAt: new Date().toISOString(), adapter: { key: 'ada/agent/a' } }));
  };
  write('chk_00000000000000a1', 'running', true);
  write('chk_00000000000000a2', 'queued', false);
  const checks = createChecks({ dataDir: dir2, runner, rubricsDir: path.join(dir2, 'intera11y'), log });
  await checks.recover();
  await until(() => checks.idle() && ran.length === 2);
  assert.deepEqual(ran, ['cleanup', 'a.js']);
  assert.equal(checks.get('ada', 'chk_00000000000000a1').status, 'done');
  assert.match(checks.get('ada', 'chk_00000000000000a2').error, /restarted/);
});

await test('a review\'s token names the account while the review runs, for as many model calls as it makes', async () => {
  const dir3 = mkdtempSync(path.join(tmpdir(), 'agent-checks-token-'));
  let token, during = [];
  const checks = createChecks({ dataDir: dir3, rubricsDir: path.join(dir3, 'intera11y'), log, runner: {
    async check({ dir }) { writeFileSync(path.join(dir, 'out', 'report.json'), JSON.stringify({ runs: [] })); return { code: 0, timedOut: false, stderr: '' }; },
    async review({ dir, token: t }) { token = t; during = Array.from({ length: 500 }, () => checks.uidForToken(t)); writeFileSync(path.join(dir, 'review', 'review.json'), JSON.stringify({ verdict: 'ok', report: 'Verdict: ok\nFine.' })); return { code: 0, timedOut: false, stderr: '' }; },
  } });
  const id = 'chk_00000000000000b1';
  checks.submit('ada', { checkId: id, review: true, adapter: { key: 'ada/agent/a', code: 'export default {};' } });
  await until(() => checks.get('ada', id).status === 'done');
  assert.ok(during.every((u) => u === 'ada'), 'no cap on calls');
  assert.equal(checks.uidForToken(token), null, 'gone after the review');
  assert.equal(checks.get('ada', id).result.review.verdict, 'ok');
});

await test('on the VM: gVisor, no network for the check, the model network for the review, and the token only by name', async () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'fake-docker-'));
  const record = path.join(bin, 'calls.jsonl');
  writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), token: process.env.GEMINI_API_KEY || null, secret: process.env.AGENT_HOST_SECRET || null }) + '\\n');\n`);
  chmodSync(path.join(bin, 'docker'), 0o755);
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}:${PATH}`;
  try {
    const r = dockerCheckRunner({ image: 'verify-check:t', sitesDir: '/srv/sites', rubricsDir: '/srv/ia', modelUrl: 'http://172.30.0.1:8790/model/v1beta' });
    await r.check({ id: 'abc', dir: '/srv/checks/chk_abc', file: 'x.js', spec: 'check.json', timeoutMs: 5000 });
    await r.review({ id: 'abc', dir: '/srv/checks/chk_abc', file: 'x.js', token: 'chk_TOKEN', timeoutMs: 5000 });
  } finally { process.env.PATH = PATH; }
  const [check, review] = readFileSync(record, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const after = (args, flag) => args[args.indexOf(flag) + 1];
  for (const c of [check, review]) {
    assert.ok(c.args.includes('--runtime=runsc') && c.args.includes('--rm'));
    assert.equal(after(c.args, '--cap-drop'), 'ALL');
    assert.ok(c.args.includes('/srv/checks/chk_abc/in:/job:ro') && c.args.includes('/srv/sites:/sites:ro'));
    assert.equal(c.secret, null, 'docker never gets the host secret');
    assert.ok(!c.args.join(' ').includes('chk_TOKEN'), 'the token is not on the command line');
  }
  assert.equal(after(check.args, '--network'), 'none');
  assert.equal(after(check.args, '--spec'), '/job/check.json', 'where it runs, and the person\'s pages, from the read-only job folder');
  assert.equal(check.token, null);
  assert.equal(after(review.args, '--network'), 'ai4a11y-chk');
  assert.equal(review.token, 'chk_TOKEN');
  assert.ok(review.args.includes('GEMINI_API_KEY') && review.args.includes('/srv/ia:/opt/intera11y:ro'));
  assert.ok(review.args.includes('--review-file') && review.args.includes('/job/x.js'));
});

await test('run.mjs reviews one file: the skill\'s reviewer instructions, what it is for, the check, the rubrics, the model through the proxy', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'review-file-'));
  mkdirSync(path.join(work, 'in'));
  writeFileSync(path.join(work, 'in', 'bigger-buttons.js'), 'export default { enable() { return true; }, disable() {} };');
  writeFileSync(path.join(work, 'in', 'about.txt'), 'Name: Bigger buttons\nDescription: Makes buttons bigger.\n');
  writeFileSync(path.join(work, 'in', 'report.json'), JSON.stringify({ summary: { passed: 1, failed: 1, skipped: 0, appliedOnTestPages: 1, testPages: 22 }, runs: [{ name: 'a.html', status: 'fail', problems: ['adds color-contrast (WCAG 1.4.3) on 2'] }] }));
  const keys = [];
  const proxy = http.createServer((req, res) => { keys.push(req.headers['x-goog-api-key']); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const { localCheckRunner } = await import('../src/checks.js');
  const runner = localCheckRunner({ repoDir: path.resolve(here, '../..'), sitesDir: path.join(work, 'sites'), rubricsDir: path.join(work, 'ia'),
    modelUrl: `http://127.0.0.1:${proxy.address().port}/model/v1beta`, opencodeBin: path.join(here, 'fake-reviewer.mjs') });
  const r = await runner.review({ dir: work, file: 'bigger-buttons.js', token: 'chk_job_token', timeoutMs: 60_000 });
  proxy.close();
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(readFileSync(path.join(work, 'review', 'review.json'), 'utf8'));
  assert.equal(out.verdict, 'issues');
  assert.deepEqual(out.rubricsRead, ['2.4.7']);
  assert.match(out.report, /Model: 200\. Rubric: read\. Denied: question,task,webfetch,websearch\. Instructions: scripts\/adapter-reviewer\.md, verify-adapters\/REVIEW-FILE\.md\./);
  assert.match(out.report, /Task names the file: true\. About: true\. Check: true\. Failing run: true\. Rubrics offered: 10\./);
  assert.deepEqual(keys, ['chk_job_token'], 'the model call carried the job token, through the proxy');
  assert.ok(!existsSync(path.resolve(here, '../../tools/core-adapters/.check/check-bigger-buttons.js')), 'its copy is removed');
});

await test('a page the browser saved as MHTML becomes a copy served at its own address', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
  const mhtml = [
    'From: <Saved by Blink>', 'Snapshot-Content-Location: https://scholar.example/citations?user=1', 'Subject: Ada', 'MIME-Version: 1.0',
    'Content-Type: multipart/related;', '\ttype="text/html";', '\tboundary="----MultipartBoundary--x"', '',
    '------MultipartBoundary--x', 'Content-Type: text/html', 'Content-ID: <frame-1@mhtml.blink>', 'Content-Transfer-Encoding: quoted-printable',
    'Content-Location: https://scholar.example/citations?user=1', '',
    '<html><body><p class=3D"gsc">A long line that is folded=', ' here</p></body></html>',
    '------MultipartBoundary--x', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: https://scholar.example/logo.png', '',
    png.toString('base64'), '',
    '------MultipartBoundary--x--', '',
  ].join('\r\n');
  const copy = copyFromMhtml(Buffer.from(mhtml, 'latin1'), { url: 'https://scholar.example/citations?user=1' });
  const page = copy.entries['https://scholar.example/citations?user=1'];
  assert.equal(page.headers['content-type'], 'text/html');
  assert.equal(copy.inline[page.body].toString(), '<html><body><p class="gsc">A long line that is folded here</p></body></html>');
  assert.deepEqual(copy.inline[copy.entries['https://scholar.example/logo.png'].body], png);
  assert.throws(() => copyFromMhtml(Buffer.from('<p>not saved</p>')), /not MHTML/);
});

for (const s of servers) { s.closeAllConnections?.(); s.close(); }
console.log(`\n${passed} passed`);
process.exit(0);
