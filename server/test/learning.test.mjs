// What the toolkit learns about the person over time (server/src/learning.js):
// browser-runtime installs and switches become observations, the Librarian
// learns from them a little later (a stub LLM here), the person answers each
// suggested change, and the profile_* MCP tools read, pause and reset it all.
//
//   node server/test/learning.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { defineDescriptor, PROFILE_TOOLS } from '../../toolkit/protocol/adapter/index.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin';
const dir = await mkdtemp(path.join(tmpdir(), 'learning-test-'));
const store = fileStore(dir);
// The stub LLM: one memory and one suggested profile change, whatever it is shown.
const prompts = [];
const LLM_ANSWER = JSON.stringify({
  operations: [{ op: 'ADD', record: { text: 'Prefers bigger buttons when shopping.', scope: 'general', tier: 'preference' } }],
  proposals: [{ aspect: 'profile.largeTargets', aspectLabel: 'Bigger buttons and links', change: { op: 'profile-set', path: 'fields.largeTargets', value: true }, rationale: 'You keep choosing bigger buttons.' }],
});
const host = createToolkitHost({ store, geminiCaller: async (prompt) => { prompts.push(prompt); return LLM_ANSWER; } });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host, learningDelayMs: 150 });
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
async function until(fn, what, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 40));
  }
}
const librarian = (token, method, ...args) => fetch(`${base}/v1/librarian/${method}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ args }),
}).then(r => r.json());

try {
  const token = await tokenFor('ada');
  const registry = createRegistryClient({ url: base, token });
  const profile = registry.profile;
  const adapter = { appId: 'agent', id: 'big-buttons' };
  await registry.publish({
    appName: 'Coding agent',
    descriptor: defineDescriptor({ ...adapter, name: 'Big buttons', version: '1.0.0', supportAreas: ['motor'], targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }] }),
    code: 'export default { enable() {}, disable() {} };',
  });

  await test('the profile tools are listed on the toolkit\'s MCP endpoint, next to the registry tools', async () => {
    const listed = await registry.mcp.listTools();
    const tools = Array.isArray(listed) ? listed : listed.tools;
    const names = tools.map(t => t.name);
    for (const name of PROFILE_TOOLS) assert.ok(names.includes(name), name);
    assert.ok(names.includes('adapter_install'));
    assert.equal(tools.find(t => t.name === 'profile_learned').annotations.readOnlyHint, true);
    assert.equal(tools.find(t => t.name === 'profile_learning_reset').annotations.destructiveHint, true);
  });

  await test('running an adapter in the browser becomes an observation, and the toolkit learns from it a little later', async () => {
    await registry.install('browser-runtime', adapter);
    const waiting = await until(async () => { const s = await profile.learned(); return s.pendingObservations ? s : null; }, 'the observation');
    assert.equal(waiting.pendingObservations, 1);
    await until(() => prompts.length, 'extract to run');
    assert.match(prompts[0], /Chose to run the adapter \\"Big buttons\\" \(for motor\) in their browser\./);
    const learned = await until(async () => { const s = await profile.learned(); return s.proposals.length ? s : null; }, 'the suggestion');
    assert.equal(learned.pendingObservations, 0);
    assert.deepEqual(learned.memories.map(m => m.text), ['Prefers bigger buttons when shopping.']);
    assert.equal(learned.proposals[0].label, 'Bigger buttons and links');
    assert.deepEqual(learned.proposals[0].change, { op: 'profile-set', path: 'fields.largeTargets', value: true });
    assert.equal(learned.proposalsThisWeek, 1);
    assert.ok(learned.proposalsPerWeek >= 1, 'the weekly limit comes from the profile');
  });

  await test('installing into an app is a developer setting it up, not something to learn from', async () => {
    const before = prompts.length;
    await registry.install('redbird', adapter);
    await new Promise(r => setTimeout(r, 300));
    assert.equal((await profile.learned()).pendingObservations, 0);
    assert.equal(prompts.length, before);
  });

  await test('switching an adapter off on a site is an observation for that site; an unchanged switch is not', async () => {
    const before = prompts.length;
    await registry.install('browser-runtime', adapter, { sites: { 'https://example.com': false } });
    await registry.install('browser-runtime', adapter, { sites: { 'https://example.com': false } });
    await until(() => prompts.length > before, 'extract');
    const last = prompts.at(-1);
    assert.match(last, /Switched the adapter \\"Big buttons\\" \(for motor\) off on https:\/\/example\.com\./);
    assert.equal(last.match(/Switched the adapter/g).length, 1, 'one observation, not two');
  });

  await test('accepting a suggestion changes the profile; nothing else does', async () => {
    assert.equal((await profile.get()).profile.fields?.largeTargets, undefined);
    const { proposals } = await profile.learned();
    const answer = await profile.respond(proposals[0].id, 'accept');
    assert.notEqual(answer.ok, false);
    assert.equal((await profile.get()).profile.fields.largeTargets, true);
    assert.equal((await profile.learned()).proposals.length, 0);
  });

  await test('profile_observe and /v1/librarian/logObservation both lead to learning', async () => {
    let before = prompts.length;
    await profile.observe({ text: 'Turned on Captions while watching a video.', origin: 'https://video.example', type: 'setting-change', data: { adapter: 'captions', on: true } });
    await until(() => prompts.length > before, 'extract after profile_observe');
    assert.match(prompts.at(-1), /Turned on Captions while watching a video\./);
    before = prompts.length;
    const logged = await librarian(token, 'logObservation', { type: 'setting-change', text: 'Turned on Calm urgency on the Redbird store.', origin: 'http://localhost:8000' });
    assert.equal(logged.ok, true);
    await until(() => prompts.length > before, 'extract after logObservation');
  });

  await test('profile_observe keeps its data small and its arguments checked', async () => {
    await assert.rejects(profile.observe({ text: 'x', data: { blob: 'y'.repeat(2000) } }), /under 1000 characters/);
    await assert.rejects(profile.observe({ text: 'x', type: 'something-else' }), /must be one of/);
  });

  await test('learn now runs at once and says when there is nothing new', async () => {
    assert.deepEqual(await profile.learnNow(), { ran: false, reason: 'empty' });
  });

  await test('while learning is paused, observations are not kept', async () => {
    await profile.pause(true);
    assert.equal((await profile.learned()).paused, true);
    assert.deepEqual(await profile.observe({ text: 'Switched off Big buttons.' }), { logged: false, reason: 'paused' });
    await profile.pause(false);
    assert.equal((await profile.learned()).paused, false);
  });

  await test('reset clears the suggestions and the weekly count; with memories, the memories too, but not the person\'s notes', async () => {
    await librarian(token, 'addNote', 'I use a trackball.');
    assert.ok((await profile.learned()).proposalsThisWeek >= 1);
    const first = await profile.reset();
    assert.ok(first.cleared.proposals >= 1);
    let state = await profile.learned();
    assert.equal(state.proposalsThisWeek, 0, 'the weekly count starts again');
    assert.ok(state.memories.some(m => m.kind !== 'note'), 'memories stay without memories: true');
    await profile.observe({ text: 'Switched off Big buttons on https://example.com.' });
    const all = await profile.reset({ memories: true });
    assert.equal(all.cleared.observations, 1);
    state = await profile.learned();
    assert.deepEqual(state.memories.map(m => [m.kind, m.text]), [['note', 'I use a trackball.']]);
    assert.equal(state.pendingObservations, 0);
    assert.equal((await profile.get()).profile.fields.largeTargets, true, 'the profile stays as it is');
  });

  await test('removing an adapter from the browser is an observation', async () => {
    const before = prompts.length;
    await registry.uninstall('browser-runtime', adapter);
    await until(() => prompts.length > before, 'extract');
    assert.match(prompts.at(-1), /Removed the adapter \\"Big buttons\\" \(for motor\) from their browser\./);
  });
  await test('the skill\'s helper lists what was learned and passes on the person\'s answer', async () => {
    const helper = fileURLToPath(new URL('../../.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs', import.meta.url));
    const { TOOLKIT_URL: _u, TOOLKIT_TOKEN: _t, ...env } = process.env;
    const run = (...args) => promisify(execFile)(process.execPath, [helper, ...args], { env: { ...env, TOOLKIT_URL: base, TOOLKIT_TOKEN: token } });
    await profile.observe({ text: 'Turned on Big buttons again.' });
    await profile.learnNow();
    const { proposals } = await profile.learned();
    const listed = (await run('learned')).stdout;
    assert.match(listed, new RegExp(`- ${proposals[0].id}: Bigger buttons and links \\(set largeTargets to true\\)\\. You keep choosing bigger buttons\\.`));
    assert.match(listed, /What it remembers:\n(- .*\n)*- Prefers bigger buttons when shopping\.\n/);
    assert.match(listed, /- I use a trackball\. \(their note\)/);
    assert.match((await run('answer', proposals[0].id, 'never')).stdout, /stops suggesting this/);
    assert.equal((await profile.learned()).proposals.length, 0);
    await assert.rejects(run('answer', 'prop_x', 'maybe'), e => /accept \| not-now \| never/.test(e.stderr));
  });
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nLearning: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
