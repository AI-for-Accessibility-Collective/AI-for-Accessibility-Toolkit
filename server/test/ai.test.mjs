// /v1/ai/…: the model behind the building blocks' AI. The service builds the
// toolkit's prompt with the builder's fields, gates the answer (a refusal or
// an answer of the wrong length is null), keeps daily limits per account and
// per adapter, can be switched off per account, and never logs page content.
//
//   node server/test/ai.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createLogger } from '../src/log.js';
import { gateAnswer } from '../src/ai.js';

const ADMIN = 'test-admin-password';
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('PASS:', name); } catch (e) { fail++; console.log('FAIL:', name, '\n   ', e.stack); }
}

const prompts = [];
let reply = (prompt) => 'Plain words about the loan and what it costs each year.';
// Each answer is billed as 1,000,000 input and 100,000 output tokens: at the
// test price below, $1 + $1 = $2 a call.
const caller = Object.assign(async (prompt, { images = [], onUsage } = {}) => {
  prompts.push({ prompt, images });
  onUsage?.({ model: 'test-model', promptTokens: 1_000_000, outputTokens: 60_000, thoughtsTokens: 40_000 });
  return reply(prompt);
}, { model: 'test-model' });
const price = () => ({ input: 1, output: 10 });

async function boot({ ai }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-route-test-'));
  const store = fileStore(dir);
  const lines = [];
  const log = createLogger({ format: 'json', level: 'debug', write: (line) => lines.push(line) });
  const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
  const app = createApp({ store, adminPassword: ADMIN, toolkitHost, log, ai });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mint = async (uid, kind = 'default') => (await (await fetch(`${base}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid, kind }) })).json()).token;
  const stop = () => { app.relay.closeAll(); server.closeAllConnections?.(); server.close(); };
  return { base, dir, lines, mint, stop };
}

const svc = await boot({ ai: { caller, price, dailyBudgetUsd: 100, dailyPerAdapter: 3 } });
const token = await svc.mint('ada');
const call = (p, body, { method = 'POST', tok = token } = {}) => fetch(svc.base + p, {
  method, headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const PASSAGE = 'The annual percentage rate (APR) is the yearly cost of the loan, including fees, shown as a percentage.';

await test("text: the toolkit's prompt with the builder's fields, and the answer back", async () => {
  const res = await call('/v1/ai/text', { task: 'simplify', input: PASSAGE, options: { tone: 'friendly', keep: ['APR'] }, adapter: 'ada/browser-runtime/plain' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.text, 'Plain words about the loan and what it costs each year.');
  assert.equal(body.task, 'simplify');
  const { prompt } = prompts.at(-1);
  assert.match(prompt, /Rewrite the text below so it is easier to read\./);
  assert.match(prompt, /Tone: friendly\./);
  assert.match(prompt, /Keep these exactly as written: APR\./);
  assert.ok(prompt.includes(`<text>\n${PASSAGE}\n</text>`));
});

await test('the gate: a refusal, a cut answer or NO_ANSWER comes back as null with the reason', async () => {
  reply = () => "I'm sorry, but I can't help with that.";
  assert.deepEqual(await (await call('/v1/ai/text', { task: 'simplify', input: PASSAGE })).json().then(b => [b.text, b.reason]), [null, 'reads as a refusal']);
  reply = () => 'Loan.';
  assert.equal((await (await call('/v1/ai/text', { task: 'simplify', input: PASSAGE })).json()).text, null);
  reply = () => 'NO_ANSWER';
  assert.equal((await (await call('/v1/ai/text', { task: 'define', input: 'APR', options: { context: PASSAGE } })).json()).reason, 'no-answer');
  reply = () => 'Plain words about the loan and what it costs each year.';
});

await test('bad requests say what is wrong, and cost nothing', async () => {
  const before = prompts.length;
  const r1 = await call('/v1/ai/text', { task: 'poem', input: 'x' });
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).message, /simplify/);
  const r2 = await call('/v1/ai/text', { task: 'translate', input: 'Hola' });
  assert.equal(r2.status, 400);
  assert.match((await r2.json()).message, /translateTo/);
  assert.equal((await call('/v1/ai/text', { task: 'simplify', input: 'x', options: { voice: 'a' } })).status, 400);
  assert.equal((await call('/v1/ai/vision', { task: 'describe', image: { mimeType: 'image/gif', data: 'R0lG' } })).status, 400);
  assert.equal((await call('/v1/ai/text', { task: 'simplify', input: 'x' }, { tok: 'aat_wrong' })).status, 401);
  assert.equal(prompts.length, before);
});

await test('vision: the image goes to the model with the prompt', async () => {
  reply = () => 'A bar chart of monthly sales, highest in March.';
  const res = await call('/v1/ai/vision', { task: 'chart', input: 'Sales by month', image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.equal((await res.json()).text, 'A bar chart of monthly sales, highest in March.');
  assert.deepEqual(prompts.at(-1).images, [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }]);
  assert.match(prompts.at(-1).prompt, /Describe the chart/);
  reply = () => 'Plain words about the loan and what it costs each year.';
});

await test('the budget is dollars per account, from the tokens each call was billed; adapters have a call limit', async () => {
  const usage = await (await call('/v1/ai/usage', null, { method: 'GET' })).json();
  assert.equal(usage.budgetUsd, 100);
  assert.equal(usage.spentUsd, 10, 'five answered calls at $2');
  assert.equal(usage.perAdapterLimit, 3);
  assert.equal(usage.byAdapter['ada/browser-runtime/plain'], 1);
  // $5 a day. A call is let through when its estimate fits; what Google
  // bills is counted after, so the last call may go past by its own cost.
  const svc2 = await boot({ ai: { caller, price, dailyBudgetUsd: 5, dailyPerAdapter: 2 } });
  const t2 = await svc2.mint('bo');
  const c2 = (body) => fetch(svc2.base + '/v1/ai/text', { method: 'POST', headers: { authorization: `Bearer ${t2}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await c2({ task: 'simplify', input: PASSAGE, adapter: 'bo/x/one' })).status);
  assert.deepEqual(statuses, [200, 200, 429], 'the adapter limit');
  assert.equal((await c2({ task: 'simplify', input: PASSAGE, adapter: 'bo/x/two' })).status, 200, '$4 spent: it fits');
  const over = await c2({ task: 'simplify', input: PASSAGE, adapter: 'bo/x/two' });
  assert.equal(over.status, 429, '$6 spent');
  assert.match((await over.json()).message, /\$5 AI budget/);
  svc2.stop();
});

await test('calls made at once cannot run past the budget together', async () => {
  const svc4 = await boot({ ai: { caller, price, dailyBudgetUsd: 0.01 } });
  const t4 = await svc4.mint('di');
  const one = () => fetch(svc4.base + '/v1/ai/text', { method: 'POST', headers: { authorization: `Bearer ${t4}`, 'content-type': 'application/json' }, body: JSON.stringify({ task: 'simplify', input: PASSAGE }) }).then(r => r.status);
  // Each call's estimate is about $0.009 at this price: only one fits.
  const statuses = await Promise.all([one(), one(), one()]);
  assert.deepEqual(statuses.sort(), [200, 429, 429]);
  svc4.stop();
});

await test('the account can switch it off (not with an app token); off is 403', async () => {
  const app = await svc.mint('ada', 'app');
  assert.equal((await call('/v1/ai/settings', { enabled: false }, { method: 'PUT', tok: app })).status, 403);
  assert.equal((await call('/v1/ai/settings', { enabled: false }, { method: 'PUT' })).status, 200);
  const res = await call('/v1/ai/text', { task: 'simplify', input: PASSAGE });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'ai-off');
  assert.equal((await call('/v1/ai/settings', { enabled: true }, { method: 'PUT' })).status, 200);
  const saved = JSON.parse(await readFile(path.join(svc.dir, 'users', 'ada', 'ai-usage.json'), 'utf8'));
  assert.equal(saved.enabled, true);
});

await test('page content is never logged: not the request body, not the prompt', async () => {
  const all = svc.lines.join('\n');
  assert.ok(!all.includes('yearly cost of the loan'), 'the passage is not in the log');
  assert.ok(all.includes('"ai.blocks"'), 'each call is logged without content');
});

await test('with no model set up: 503, and nothing counted', async () => {
  const svc3 = await boot({ ai: {} });
  const t3 = await svc3.mint('cy');
  const res = await fetch(svc3.base + '/v1/ai/text', { method: 'POST', headers: { authorization: `Bearer ${t3}`, 'content-type': 'application/json' }, body: JSON.stringify({ task: 'simplify', input: PASSAGE }) });
  assert.equal(res.status, 503);
  const u = await (await fetch(svc3.base + '/v1/ai/usage', { headers: { authorization: `Bearer ${t3}` } })).json();
  assert.deepEqual([u.calls, u.available], [0, false]);
  svc3.stop();
});

await test('gateAnswer: a choice is the number of one option; 0 is "cannot tell"', async () => {
  const o = { question: 'Which?', choices: 3 };
  assert.deepEqual(gateAnswer('choose', '2', 'input', o), { text: '2' });
  assert.deepEqual(gateAnswer('choose', ' 3. ', 'input', o), { text: '3' });
  assert.deepEqual(gateAnswer('choose', '0', 'input', o), { text: null, reason: 'cannot tell' });
  assert.equal(gateAnswer('choose', '4', 'input', o).reason, 'not one of the options');
  assert.equal(gateAnswer('choose', 'Option 2', 'input', o).reason, 'not the number of an option');
  assert.equal(gateAnswer('choose', '2 or 3', 'input', o).text, null);
  assert.equal(gateAnswer('choose', 'NO_ANSWER', 'input', o).reason, 'no-answer');
});

await test('gateAnswer: short values are cleaned and checked; descriptions reject guesses', async () => {
  assert.deepEqual(gateAnswer('label', '"Search"', 'icon button'), { text: 'Search' });
  assert.equal(gateAnswer('linkText', 'Unknown', 'a link').text, null);
  assert.equal(gateAnswer('describe', 'It is unclear what this shows.', '').text, null);
  assert.equal(gateAnswer('summarize', 'A summary that is longer than the passage it summarizes, by far, by very far indeed.', 'Short passage here ok.').text, null);
  assert.equal(gateAnswer('simplify', '```\nPlain text that is long enough to keep.\n```', 'Original text that is long enough to keep.').text, 'Plain text that is long enough to keep.');
});

await test('pageType goes to the small model, its price counts, and only the number of a kind comes back', async () => {
  const asked = [];
  const lite = Object.assign(async (prompt, { onUsage } = {}) => {
    asked.push(prompt);
    onUsage?.({ model: 'lite-model', promptTokens: 1000, outputTokens: 2 });
    return asked.length === 1 ? '3' : 'It looks like a product page.';
  }, { model: 'lite-model' });
  const s2 = await boot({ ai: { caller, liteCaller: lite, price } });
  const t2 = await s2.mint('bea');
  const ask = () => fetch(s2.base + '/v1/ai/text', { method: 'POST', headers: { authorization: `Bearer ${t2}`, 'content-type': 'application/json' },
    body: JSON.stringify({ task: 'pageType', input: 'Address: https://shop.example/p/1\nTitle: Blue tea pot', adapter: 'toolkit/page-type' }) }).then(r => r.json());
  const before = prompts.length;
  assert.equal((await ask()).text, '3');
  assert.equal(prompts.length, before, 'the main model was not asked');
  assert.match(asked[0], /3\. Product pages: one product or service for sale/);
  assert.match(asked[0], /answer 0/);
  const second = await ask();
  assert.deepEqual([second.text, second.reason], [null, 'not the number of an option']);
  s2.stop();
});

svc.stop();
console.log(`\n/v1/ai: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
