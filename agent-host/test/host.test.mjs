// The agent host end to end, with a stand-in for opencode (fake-opencode.mjs):
// chats and their history, the event stream without code, the browser tools
// asking the "sidebar" (this test) and waiting for its answers, page data
// kept on disk, adapters offered, the model proxy, and who may call what.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, listen } from '../src/host.js';
import { withoutCode, translate } from '../src/updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-that-is-long-enough-1234';
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok   - ${name}`); };

// ── pure parts ───────────────────────────────────────────────────────────────
await test('replies lose their code blocks and long inline code', () => {
  assert.equal(withoutCode('Here:\n```js\nconst a = 1;\n```\nDone.'), 'Here:\n\nDone.');
  assert.equal(withoutCode('Use `x`. ' + '`' + 'a'.repeat(80) + '`'), 'Use `x`.');
  assert.equal(withoutCode('Cut ```js\nno end'), 'Cut');
});
await test('tool steps become plain lines without their input or output', () => {
  const e = translate({ type: 'tool_use', sessionID: 's1', part: { id: 'p', tool: 'bash', state: { status: 'completed', input: { command: 'rm -rf /' }, output: 'x' } } });
  assert.deepEqual(e, { sessionId: 's1', entry: { id: 'p', kind: 'step', text: 'Running a check', state: 'done' } });
  assert.equal(translate({ type: 'tool_use', part: { tool: 'execute', state: {} } }).entry, undefined);
  assert.match(translate({ type: 'tool_use', part: { tool: 'edit', state: { status: 'error', input: { filePath: '/work/adapters/a.js' } } } }).entry.text, /Writing the adapter: that did not work/);
});

// ── the host ─────────────────────────────────────────────────────────────────
const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-host-'));
const upstreamCalls = [];
const fakeFetch = async (url, init) => {
  upstreamCalls.push({ url: String(url), key: init.headers['x-goog-api-key'] });
  return new Response('{"candidates":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
};
const lines = [];
const sandboxPort = 18790 + Math.floor(Math.random() * 500), apiPort = sandboxPort + 1000;
const host = createHost({
  dataDir, secret: SECRET, apiKey: 'REAL-KEY', sandboxUrl: `http://127.0.0.1:${sandboxPort}`, runnerKind: 'local',
  opencodeBin: path.join(here, 'fake-opencode.mjs'), repoDir: path.resolve(here, '../..'), fetch: fakeFetch, perMinute: 3,
  log: { info: (e, f) => lines.push({ e, ...f }), warn: (e, f) => lines.push({ e, ...f }), error: (e, f) => lines.push({ e, ...f }) },
});
const servers = [await listen(host.sandboxHandler, `127.0.0.1:${sandboxPort}`), await listen(host.apiHandler, `127.0.0.1:${apiPort}`)];
const api = (p, { method = 'GET', body, uid = 'ada', secret = SECRET } = {}) => fetch(`http://127.0.0.1:${apiPort}${p}`, {
  method, headers: { authorization: `Bearer ${secret}`, 'x-ai4a11y-uid': uid, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

// A sidebar: reads the event stream and answers what the tools ask.
function sidebar(uid, answers) {
  const seen = [];
  const ctl = new AbortController();
  (async () => {
    const res = await api('/agent/events', { uid });
    const reader = res.body.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split('\n').find(l => l.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6));
        seen.push(event);
        if (event.type === 'request' && answers[event.request.kind]) {
          await api(`/agent/requests/${event.request.id}`, { method: 'POST', uid, body: answers[event.request.kind](event.request) });
        }
      }
      if (ctl.signal.aborted) break;
    }
  })();
  return { seen, close: () => ctl.abort() };
}
const until = async (check, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } throw new Error('timed out'); };

await test('the API needs the shared secret and a safe account id', async () => {
  assert.equal((await api('/agent/chats', { secret: 'wrong-secret-wrong-secret-wrong-1234' })).status, 401);
  assert.equal((await api('/agent/chats', { uid: '../etc' })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${apiPort}/healthz`)).status, 200);
});

let chatId;
await test('a chat keeps its history: a message and the reply', async () => {
  const created = await (await api('/agent/chats', { method: 'POST' })).json();
  chatId = created.chat.id;
  const sent = await api(`/agent/chats/${chatId}/messages`, { method: 'POST', body: { text: 'hello there' } });
  assert.equal(sent.status, 202);
  const chat = await until(async () => { const c = (await (await api(`/agent/chats/${chatId}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'agent') && c; });
  assert.deepEqual(chat.entries.map(e => e.kind), ['you', 'agent']);
  assert.equal(chat.entries[1].text, 'You said: hello there');
  assert.equal(chat.title, 'hello there');
  const list = (await (await api('/agent/chats')).json()).chats;
  assert.equal(list[0].id, chatId);
  // Another account sees none of it.
  assert.equal((await (await api('/agent/chats', { uid: 'bob' })).json()).chats.length, 0);
  assert.equal((await api(`/agent/chats/${chatId}`, { uid: 'bob' })).status, 404);
});

await test('the agent sees the page, previews, and offers the adapter; the sidebar shows no code', async () => {
  const sb = sidebar('ada', {
    page: () => ({ level: 'screenshot', origin: 'https://example.com', remember: true, url: 'https://example.com/shop', title: 'Shop', outline: 'button "Buy" (20px tall)', screenshot: 'data:image/jpeg;base64,/9j/AAAA' }),
    preview: (r) => { assert.match(r.code, /BiggerButtons/); assert.deepEqual(r.runsOn, ['https://example.com/*']); return { status: 'applied', after: { url: 'https://example.com/shop', outline: 'button "Buy" (44px tall)' } }; },
  });
  await new Promise(r => setTimeout(r, 200));
  await api(`/agent/chats/${chatId}/messages`, { method: 'POST', body: { text: 'build bigger buttons' } });
  const chat = await until(async () => { const c = (await (await api(`/agent/chats/${chatId}`)).json()).chat; return !c.busy && c.adapters.length && c; });
  const shown = JSON.stringify(chat.entries);
  assert.ok(!/SECRET FILE TEXT|export const|```/.test(shown), 'no code or file text in what the sidebar shows');
  const texts = chat.entries.map(e => e.text);
  assert.ok(texts.includes('Reading the toolkit’s guides and code'));
  assert.ok(texts.includes('Looking at the page'));
  assert.ok(texts.includes('“Bigger buttons” is previewing on your page'));
  assert.match(texts.at(-1), /Outside: refused\. Preview: Preview result: applied\. Ready: yes\./);
  assert.deepEqual(chat.consent, { 'https://example.com': 'screenshot' });
  assert.equal(chat.adapters[0].id, 'bigger-buttons');
  assert.deepEqual(chat.adapters[0].supportAreas, ['motor']);
  // Steps streamed live, the request carried the code for the page to run.
  assert.ok(sb.seen.some(e => e.type === 'entry' && e.entry.state === 'running'));
  // The page data stays on the host's disk, with the screenshot as a file.
  const files = readdirSync(path.join(dataDir, 'accounts/ada/page-data', chatId));
  assert.ok(files.some(f => f.endsWith('-page.jpg')) && files.some(f => f.endsWith('-after-preview.json')));
  // Never in the log.
  assert.ok(!JSON.stringify(lines).includes('example.com/shop'));
  const got = (await (await api(`/agent/chats/${chatId}/adapters/bigger-buttons`)).json()).adapter;
  assert.match(got.code, /export const BiggerButtons/);
  sb.close();
});

await test('one run at a time per account, and stop ends it', async () => {
  const other = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${other}/messages`, { method: 'POST', body: { text: 'hang please' } });
  await until(async () => (await (await api(`/agent/chats/${other}`)).json()).chat.busy);
  const busy = await api(`/agent/chats/${chatId}/messages`, { method: 'POST', body: { text: 'hi' } });
  assert.equal(busy.status, 409);
  assert.equal((await (await api(`/agent/chats/${other}/stop`, { method: 'POST' })).json()).stopped, true);
  const chat = await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return !c.busy && c; });
  assert.equal(chat.entries.at(-1).text, 'Stopped.');
});

await test('the model proxy: sandbox token in, real key out, one model, a rate limit', async () => {
  const token = readFileSync(path.join(dataDir, 'accounts/ada/token'), 'utf8');
  const call = (key, model = 'gemini-flash-lite-latest') => fetch(`http://127.0.0.1:${sandboxPort}/model/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await call('sbx_not-a-real-token-at-all-000000')).status, 401);
  assert.equal((await call(token)).status, 200);
  assert.equal(upstreamCalls.at(-1).key, 'REAL-KEY');
  assert.match(upstreamCalls.at(-1).url, /\/models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
  await call(token); await call(token);
  assert.equal((await call(token)).status, 429);
  // The sandbox's config holds its own token, never the real key.
  const config = readFileSync(path.join(dataDir, 'accounts/ada/config/opencode.json'), 'utf8');
  assert.ok(!config.includes('REAL-KEY') && config.includes(token));
});

await test('the browser tools need a sandbox token', async () => {
  const res = await fetch(`http://127.0.0.1:${sandboxPort}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(res.status, 401);
  assert.ok(existsSync(path.join(dataDir, 'accounts/ada/work/adapters/bigger-buttons.js')));
});

for (const s of servers) s.closeAllConnections?.(), s.close();
console.log(`\n${passed} passed`);
process.exit(0);
