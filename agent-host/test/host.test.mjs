// The agent host end to end, with a stand-in for opencode (fake-opencode.mjs):
// chats and their history, the event stream without code, the browser tools
// asking the "sidebar" (this test) and waiting for its answers, page data
// kept on disk, adapters offered, the model proxy, and who may call what;
// chat titles from the model, deleting a chat, and the agent's questions.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost, listen } from '../src/host.js';
import { withoutCode, translate } from '../src/updates.js';
import { cleanTitle, fallbackTitle } from '../src/titles.js';
import { questionsOf } from '../src/browser-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-that-is-long-enough-1234';
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok   - ${name}`); };

// ── pure parts ───────────────────────────────────────────────────────────────
await test('replies lose their code blocks and long inline code', () => {
  assert.equal(withoutCode('Here:\n```js\nconst a = 1;\n```\nDone.'), 'Here:\n\nDone.');
  assert.equal(withoutCode('Use `x`. ' + '`' + 'a'.repeat(80) + '`'), 'Use `x`.');
  assert.equal(withoutCode('Cut ```js\nno end'), 'Cut');
  assert.equal(withoutCode('## Done\nUse **Add to my account** or __Export__.'), 'Done\nUse Add to my account or Export.');
});
await test('tool steps become plain lines without their input or output', () => {
  const e = translate({ type: 'tool_use', sessionID: 's1', part: { id: 'p', tool: 'bash', state: { status: 'completed', input: { command: 'rm -rf /' }, output: 'x' } } });
  assert.deepEqual(e, { sessionId: 's1', entry: { id: 'p', kind: 'step', text: 'Running a check', state: 'done' } });
  assert.equal(translate({ type: 'tool_use', part: { tool: 'execute', state: {} } }).entry, undefined);
  assert.match(translate({ type: 'tool_use', part: { tool: 'edit', state: { status: 'error', input: { filePath: '/work/adapters/a.js' } } } }).entry.text, /Writing the adapter: that did not work/);
});

await test('a title from the model is one plain line', () => {
  assert.equal(cleanTitle('"Bigger buttons on the shop."\nmore'), 'Bigger buttons on the shop');
  assert.equal(cleanTitle('Title: **Calmer news page**'), 'Calmer news page');
  assert.equal(cleanTitle('  \n '), null);
  assert.equal(fallbackTitle('  the   buttons are\ntoo small '), 'the buttons are too small');
  assert.equal(fallbackTitle('x'.repeat(100)).length, 60);
});

await test('the agent\'s questions: each with at least two options, and "Other" is the sidebar\'s', () => {
  const [q] = questionsOf([{ question: 'Which pages?', options: [{ label: 'This page (Recommended)' }, { label: 'The whole site', description: 'Every page on it.' }, { label: 'Other' }], multi_select: true }]);
  assert.deepEqual(q, { question: 'Which pages?', options: [{ label: 'This page (Recommended)' }, { label: 'The whole site', description: 'Every page on it.' }], multiSelect: true });
  assert.throws(() => questionsOf([]), /at least one question/);
  assert.throws(() => questionsOf([{ question: 'Which?', options: [{ label: 'One' }, { label: 'Other' }] }]), /at least two options/);
  assert.equal(questionsOf(Array(6).fill({ question: 'Q?', options: ['a', 'b'] })).length, 4);
  // The two kinds the sidebar lays out itself.
  const [pages, areas] = questionsOf([
    { kind: 'pages' },
    { kind: 'areas', options: [{ label: 'Motor (Recommended)' }, { label: 'vision' }, { label: 'Patience' }] },
  ]);
  assert.deepEqual(pages, { kind: 'pages', question: 'Which pages should this apply to?', options: [], multiSelect: false }, 'the sidebar fills in the kind of page, the site and all websites');
  assert.deepEqual(areas, { kind: 'areas', question: 'Who does this change help most?', options: [{ label: 'motor' }, { label: 'vision' }], multiSelect: true });
  assert.throws(() => questionsOf([{ kind: 'areas', options: ['patience'] }]), /among: vision/);
});

// ── the host ─────────────────────────────────────────────────────────────────
const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-host-'));
const upstreamCalls = [], titleCalls = [];
const fakeFetch = async (url, init) => {
  // The host's own call for a chat's title.
  if (/Write a title for this chat/.test(String(init.body))) {
    titleCalls.push({ url: String(url), key: init.headers['x-goog-api-key'], body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '"Saying hello."' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  upstreamCalls.push({ url: String(url), key: init.headers['x-goog-api-key'] });
  return new Response('{"candidates":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
};
// Stands in for the verifier: passes, fails ("CHECKFAILS"), or runs until stopped ("SLOWCHECK").
const checkRuns = [], checkSpecs = [];
let holdChecks = null;
const checkRunner = {
  kind: 'local',
  async check({ dir, file, signal }) {
    const code = readFileSync(path.join(dir, 'in', file), 'utf8');
    checkRuns.push(code);
    await holdChecks; // a test keeps the check running
    // What run.mjs --spec would read, and the copies beside it.
    checkSpecs.push({ code, spec: JSON.parse(readFileSync(path.join(dir, 'in', 'check.json'), 'utf8')),
      copies: existsSync(path.join(dir, 'in', 'copies')) ? readdirSync(path.join(dir, 'in', 'copies')).map(f => readFileSync(path.join(dir, 'in', 'copies', f), 'utf8')) : [] });
    if (/SLOWCHECK/.test(code)) await new Promise(r => { const t = setTimeout(r, 20_000); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }); });
    if (signal?.aborted) return { code: 137, timedOut: false, stderr: '' };
    const failed = /CHECKFAILS/.test(code) ? 1 : 0;
    writeFileSync(path.join(dir, 'out', 'report.json'), JSON.stringify({ runs: [
      { name: 'buttons.html', status: 'pass', result: 'applied', problems: [] },
      ...(failed ? [{ name: 'buttons.html (narrow)', status: 'fail', result: 'applied', problems: ['adds color-contrast (WCAG 1.4.3) on 2'] }] : []),
    ], summary: { passed: 1, failed, skipped: 0, appliedOnTestPages: 1, testPages: 1 }, notes: [] }));
    return { code: failed, timedOut: false, stderr: '' };
  },
  async review({ dir }) {
    writeFileSync(path.join(dir, 'review', 'review.json'), JSON.stringify({ verdict: 'ok', report: 'Nothing to fix.', rubricsRead: [] }));
    return { code: 0, timedOut: false, stderr: '' };
  },
  cleanup: async () => {},
};
const lines = [];
const sandboxPort = 18790 + Math.floor(Math.random() * 500), apiPort = sandboxPort + 1000;
const host = createHost({
  dataDir, secret: SECRET, apiKey: 'REAL-KEY', sandboxUrl: `http://127.0.0.1:${sandboxPort}`, runnerKind: 'local',
  opencodeBin: path.join(here, 'fake-opencode.mjs'), repoDir: path.resolve(here, '../..'), fetch: fakeFetch, checkRunner, fetchRubrics: async () => ({ have: [], missing: [] }),
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
  // The start of the message, then the model's title from the message and the reply.
  assert.ok(['hello there', 'Saying hello'].includes(chat.title));
  await until(async () => (await (await api(`/agent/chats/${chatId}`)).json()).chat.title === 'Saying hello');
  const asked = titleCalls.at(-1);
  assert.equal(asked.key, 'REAL-KEY');
  assert.match(asked.url, /\/models\/gemini-3\.8-flash:generateContent$/);
  assert.match(asked.body.contents[0].parts[0].text, /hello there[\s\S]*You said: hello there/);
  const list = (await (await api('/agent/chats')).json()).chats;
  assert.equal(list[0].id, chatId);
  // Another account sees none of it.
  assert.equal((await (await api('/agent/chats', { uid: 'bob' })).json()).chats.length, 0);
  assert.equal((await api(`/agent/chats/${chatId}`, { uid: 'bob' })).status, 404);
});

await test('the agent sees the page, previews, and offers the adapter; the sidebar shows no code', async () => {
  const sb = sidebar('ada', {
    page: () => ({ level: 'screenshot', origin: 'https://example.com', remember: true, url: 'https://example.com/shop', title: 'Shop', outline: 'button "Buy" (20px tall)', screenshot: 'data:image/jpeg;base64,/9j/AAAA' }),
    preview: (r) => {
      assert.match(r.code, /BiggerButtons/); assert.deepEqual(r.runsOn, ['https://example.com/*']);
      assert.deepEqual(r.checks, [{ name: 'the page is marked big', code: 'return document.body.dataset.big === "1";' }]);
      return { status: 'applied', changes: 2, shift: 0.004, checks: [{ before: false, after: true }],
        axe: { version: '4.12.1', added: [], fixed: [{ id: 'target-size', help: 'All touch targets must be 24px large', wcag: ['2.5.8'], count: 2 }], remaining: 3 },
        after: { url: 'https://example.com/shop', outline: 'button "Buy" (44px tall)' } };
    },
  });
  await new Promise(r => setTimeout(r, 200));
  await api(`/agent/chats/${chatId}/messages`, { method: 'POST', body: { text: 'build bigger buttons' } });
  const chat = await until(async () => { const c = (await (await api(`/agent/chats/${chatId}`)).json()).chat; return !c.busy && c.adapters.length && c; });
  const shown = JSON.stringify(chat.entries);
  assert.ok(!/SECRET FILE TEXT|export const|```/.test(shown), 'no code or file text in what the sidebar shows');
  const texts = chat.entries.map(e => e.text);
  assert.ok(texts.includes('Reading the toolkit’s guides and code'));
  assert.ok(texts.includes('Looking at the page'));
  assert.ok(texts.includes('“Bigger buttons” is previewing on your page · 1 of 1 checks pass · no new accessibility problems'));
  // Not ready before a preview shows it works; no previews on every site, without checks, or with a check that reaches outside itself.
  assert.match(texts.at(-1), /Early: refused\. Outside: refused\. Everywhere: refused\. Unchecked: refused\. Escape: refused\. Preview: Preview result: applied\. Changed: yes\. Axe: clean\. Ready: yes\./);
  assert.ok(!chat.entries.some(e => e.kind === 'warning'), 'a checked adapter gets no warning');
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

await test('an adapter that was not checked, or whose checks fail, is not ready, and the person is told', async () => {
  const sb = sidebar('ada', {
    page: () => ({ level: 'url', origin: 'https://example.com', remember: true, url: 'https://example.com/shop' }),
    preview: () => ({ status: 'applied', changes: 0, checks: [{ before: false, after: false, error: 'no buttons' }] }),
  });
  await new Promise(r => setTimeout(r, 200));
  const other = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${other}/messages`, { method: 'POST', body: { text: 'build it here' } });
  let chat = await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'agent') && c; });
  assert.match(chat.entries.find(e => e.kind === 'agent').text, /Ready: no\./);
  assert.equal(chat.adapters.length, 0);
  assert.ok(chat.entries.some(e => e.state === 'failed' && e.text === '“Bigger buttons” is previewing on your page · 0 of 1 checks pass'));
  assert.ok(chat.entries.some(e => e.kind === 'warning' && /Not checked: “Bigger buttons” failed 1 of its 1 checks/.test(e.text)));
  // Written and never previewed.
  await api(`/agent/chats/${other}/messages`, { method: 'POST', body: { text: 'sketch one' } });
  chat = await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return !c.busy && c.entries.at(-1).kind === 'warning' && c; });
  assert.match(chat.entries.at(-1).text, /Not checked: “sketch” has not been previewed on your page/);
  sb.close();
});

await test('an adapter that adds accessibility problems, or was not checked with axe-core, is still offered, and the person is told', async () => {
  const added = { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', wcag: ['1.4.3'], count: 2, targets: ['button.buy', 'button.cart'], summary: 'Element has insufficient color contrast of 2.1' };
  let answer = { status: 'applied', changes: 2, checks: [{ before: false, after: true }], axe: { version: '4.12.1', added: [added], fixed: [], remaining: 0 } };
  const sb = sidebar('ada', {
    page: () => ({ level: 'url', origin: 'https://example.com', remember: true, url: 'https://example.com/shop' }),
    preview: () => answer,
  });
  await new Promise(r => setTimeout(r, 200));
  const other = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${other}/messages`, { method: 'POST', body: { text: 'build it' } });
  let chat = await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'agent') && c; });
  assert.match(chat.entries.find(e => e.kind === 'agent').text, /Axe: problems\. Ready: yes\./);
  assert.ok(chat.entries.some(e => e.state === 'done' && e.text === '“Bigger buttons” is previewing on your page · 1 of 1 checks pass · 2 new accessibility problems'));
  assert.ok(chat.entries.some(e => e.kind === 'warning' && e.text === '“Bigger buttons” adds 2 accessibility problems that axe-core finds: Elements must meet minimum color contrast ratio thresholds (WCAG 1.4.3). Check it on your page before you rely on it.'));
  assert.ok(!chat.entries.some(e => e.kind === 'warning' && /Not checked/.test(e.text)));
  assert.equal(chat.adapters.length, 1);
  // A sidebar that sends no axe result (an older extension) does not block it either.
  answer = { status: 'applied', changes: 2, checks: [{ before: false, after: true }] };
  await api(`/agent/chats/${other}/messages`, { method: 'POST', body: { text: 'build it again' } });
  chat = await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'warning' && /was not checked for accessibility problems with axe-core/.test(e.text)) && c; });
  await until(async () => { const c = (await (await api(`/agent/chats/${other}`)).json()).chat; return /Axe: none\. Ready: yes\./.test(c.entries.findLast(e => e.kind === 'agent')?.text || '') && c; });
  sb.close();
});

await test('reading the accessibility skill gets its own line', () => {
  assert.equal(translate({ type: 'tool_use', part: { id: 'k', tool: 'skill', state: { status: 'completed', input: { id: 'intopia-web-accessibility' } } } }).entry.text, 'Opening the accessibility guidance (WCAG)');
  assert.equal(translate({ type: 'tool_use', part: { id: 'k', tool: 'skill', state: { status: 'completed', input: { name: 'ai4a11y-toolkit' } } } }).entry.text, 'Opening the toolkit skill');
  assert.equal(translate({ type: 'tool_use', part: { id: 'k', tool: 'read', state: { status: 'completed', input: { filePath: '/opt/agent/skills/intopia-web-accessibility/INDEX.md' } } } }).entry.text, 'Reading accessibility guidance (WCAG)');
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

await test('a chat can be deleted, even while it runs; another sidebar is told', async () => {
  const bar = sidebar('ada', {});
  const doomed = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${doomed}/messages`, { method: 'POST', body: { text: 'hang please' } });
  await until(async () => (await (await api(`/agent/chats/${doomed}`)).json()).chat.busy);
  assert.equal((await api(`/agent/chats/${doomed}`, { method: 'DELETE', uid: 'bob' })).status, 404, 'another account cannot');
  const res = await api(`/agent/chats/${doomed}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await api(`/agent/chats/${doomed}`)).status, 404);
  assert.ok(!(await (await api('/agent/chats')).json()).chats.some(c => c.id === doomed));
  await until(() => bar.seen.some(e => e.type === 'chat-deleted' && e.chatId === doomed));
  // Its run ended: the account can run another chat.
  await until(async () => (await api(`/agent/chats/${chatId}/messages`, { method: 'POST', body: { text: 'still here?' } })).status === 202);
  await until(async () => { const c = (await (await api(`/agent/chats/${chatId}`)).json()).chat; return !c.busy && c.entries.some(e => e.text === 'You said: still here?'); });
  assert.equal((await api(`/agent/chats/${doomed}`, { method: 'DELETE' })).status, 404);
  assert.ok(!lines.some(l => l.e === 'chat.run-error' && l.chatId === doomed), 'nothing failed writing to the deleted chat');
  bar.close();
});

await test('the agent asks multiple-choice questions; the answers come back as a message', async () => {
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'questions please' } });
  let chat = await until(async () => { const c = (await (await api(`/agent/chats/${id}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'agent') && c; });
  const asked = chat.entries.find(e => e.kind === 'questions');
  assert.equal(asked.questions.length, 2);
  assert.deepEqual(asked.questions[1].options.map(o => o.label), ['Vision', 'Motor']);
  assert.equal(asked.questions[1].multiSelect, true);
  assert.match(chat.entries.findLast(e => e.kind === 'agent').text, /Asked: yes\. Bad: refused\./);
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages?\n→ This page', answers: asked.id } });
  chat = await until(async () => { const c = (await (await api(`/agent/chats/${id}`)).json()).chat; return !c.busy && c.entries.some(e => e.kind === 'you' && /This page/.test(e.text)) && c; });
  assert.equal(chat.entries.find(e => e.id === asked.id).answered, true);
});

// ── after adapter_ready: the background check ───────────────────────────────
const previewOk = () => ({ status: 'applied', changes: 1, shift: 0, checks: [{ before: false, after: true }], axe: { version: '4.12.1', added: [], fixed: [], remaining: 0 } });
const chatNow = async (id) => (await (await api(`/agent/chats/${id}`)).json()).chat;
const adapterNow = async (id, a) => (await chatNow(id)).adapters.find(x => x.id === a);

await test('an offered adapter is checked in the background, and its state kept with it', async () => {
  const a = await until(async () => { const x = await adapterNow(chatId, 'bigger-buttons'); return x?.check?.status === 'passed' && x; });
  assert.equal(a.check.failed, 0);
  assert.equal(a.check.hash, a.hash);
  assert.ok(a.version >= 1);
});

await test('when the background check finds problems, the agent is asked to fix them; the person sees one line', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'checkfails please' } });
  const chat = await until(async () => { const c = await chatNow(id); return !c.busy && c.adapters[0]?.fixes === 1 && c.entries.some(e => e.kind === 'agent' && /^You said: The background check of “flaky”/.test(e.text)) && c; });
  const a = chat.adapters[0];
  assert.equal(a.check.status, 'problems');
  assert.deepEqual(a.check.failing, [{ name: 'buttons.html (narrow)', problems: ['adds color-contrast (WCAG 1.4.3) on 2'] }]);
  const asked = chat.entries.find(e => /^You said: The background check/.test(e.text || '')).text;
  assert.match(asked, /buttons\.html \(narrow\): adds color-contrast/);
  assert.ok(chat.entries.some(e => e.kind === 'notice' && e.text === 'The background check found problems in “flaky”. The assistant is fixing them.'));
  assert.ok(!chat.entries.some(e => e.kind === 'you' && /background check/.test(e.text)), 'not shown as the person\'s message');
  sb.close();
});

await test('a rebuild stops the check of the old code; the new version is checked', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  const before = checkRuns.length;
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'slowcheck please' } });
  const a = await until(async () => { const x = await adapterNow(id, 'slow'); return x?.version === 2 && x.check?.status === 'passed' && x; }, 15_000);
  const ran = checkRuns.slice(before);
  assert.ok(ran.some(c => /SLOWCHECK/.test(c)) && ran.some(c => /v2/.test(c)), 'both versions went to the checker');
  assert.ok(lines.some(l => l.e === 'check.cancelled'), 'the old check was stopped');
  assert.match((await chatNow(id)).entries.findLast(e => e.kind === 'agent').text, /Verify: offered, then offered\./);

  // The full review, when the person asks: the reviewer starts at once, with the background check of this code.
  const checked = checkRuns.length;
  assert.equal((await api(`/agent/chats/${id}/adapters/slow/review`, { method: 'POST' })).status, 202);
  const r = await until(async () => { const x = await adapterNow(id, 'slow'); return x?.review?.status === 'passed' && x.review; });
  assert.equal(r.verdict, 'ok');
  assert.equal(checkRuns.length, checked, 'not checked a second time');
  assert.equal(r.passed, 1, 'the background check\'s result goes with it');
  assert.equal(r.report, 'Nothing to fix.');
  assert.equal((await api(`/agent/chats/${id}/adapters/nope/review`, { method: 'POST' })).status, 404);
  sb.close();
});

await test('an adapter runs on every site only when the person chose All websites', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'allsites please' } });
  await until(async () => { const c = await chatNow(id); return !c.busy && /Verify: preview refused: runs_on "\*:\/\/\*\/\*" covers every site/.test(c.entries.findLast(e => e.kind === 'agent')?.text || ''); });
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages should this apply to?\n→ All websites', pages: 'all' } });
  await until(async () => { const c = await chatNow(id); return !c.busy && c.allSites && c.entries.some(e => /You said: Which pages/.test(e.text || '')); });
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'allsites again' } });
  const a = await until(async () => adapterNow(id, 'everywhere'));
  assert.deepEqual(a.runsOn, ['*://*/*']);
  sb.close();
});

await test('a preview that passes makes the adapter the person\'s, even when the agent does not offer it; a type of page goes with it', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  // The last test's chat may still be finishing its run.
  await until(async () => (await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages?\n→ This type of page: Product pages', pages: 'type', pageType: 'product', areas: ['motor', 'nonsense'] } })).status !== 409);
  let chat = await until(async () => { const c = await chatNow(id); return !c.busy && c.pageTypes && c; });
  assert.deepEqual([chat.pageTypes, chat.supportAreas, chat.allSites], [['product'], ['motor'], false]);
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'previewonly please' } });
  chat = await until(async () => { const c = await chatNow(id); return !c.busy && c.adapters.length && c; });
  const a = chat.adapters[0];
  assert.deepEqual([a.id, a.name, a.runsOn, a.pageTypes, a.supportAreas, a.version], ['tea-cosy', 'Tea cosy', ['https://example.com/*'], ['product'], ['motor'], 1]);
  assert.ok(chat.entries.some(e => e.kind === 'notice' && e.text === '“Tea cosy” is ready. You can add it to your account or export it.'));
  // Its page types reach the account with it: Add to my account gets them from the adapter.
  const got = await (await api(`/agent/chats/${id}/adapters/tea-cosy`)).json();
  assert.deepEqual(got.adapter.pageTypes, ['product']);
  // The agent's own page_types win; unknown kinds are dropped.
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages?\n→ This website', pages: 'site' } });
  chat = await until(async () => { const c = await chatNow(id); return !c.busy && !c.pageTypes && c; });
  assert.equal(chat.allSites, false);
  // The type of page on all websites: every site, only that kind.
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages?\n→ This type of page: Product pages on all websites', pages: 'type-all', pageType: 'product' } });
  chat = await until(async () => { const c = await chatNow(id); return !c.busy && c.pageTypes && c; });
  assert.deepEqual([chat.allSites, chat.pageTypes], [true, ['product']]);
  // Without a known kind it is not every site.
  await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'Which pages?\n→ ?', pages: 'type-all', pageType: 'nonsense' } });
  chat = await until(async () => { const c = await chatNow(id); return !c.busy && !c.pageTypes && c; });
  assert.equal(chat.allSites, false);
  sb.close();
});

await test('a chat that ended before the host offered passing previews gets its adapter when it is opened', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  await until(async () => (await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'previewonly please' } })).status !== 409);
  await until(async () => { const c = await chatNow(id); return !c.busy && c.adapters.length && c; });
  sb.close();
  // As such a chat was kept: a passing preview with no pages recorded, nothing offered.
  const file = path.join(dataDir, `accounts/ada/chats/${id}.json`);
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  kept.adapters = [];
  kept.entries = kept.entries.filter(e => e.kind !== 'notice');
  for (const p of Object.values(kept.previews)) delete p.runsOn;
  writeFileSync(file, JSON.stringify(kept));
  // The website its page was shared from.
  const shared = path.join(dataDir, `accounts/ada/page-data/${id}`);
  mkdirSync(shared, { recursive: true });
  writeFileSync(path.join(shared, '2026-11-05T04-40-00-000Z-page.json'), JSON.stringify({ kind: 'page', level: 'url', url: 'https://scholar.example/citations?user=1', origin: 'https://scholar.example' }));
  const chat = await chatNow(id);
  assert.deepEqual(chat.adapters.map(a => [a.id, a.runsOn]), [['tea-cosy', ['https://scholar.example/*']]]);
  assert.ok(chat.entries.some(e => e.kind === 'notice' && /“Tea cosy” is ready/.test(e.text)));
  // Opened again: offered once.
  assert.equal((await chatNow(id)).adapters.length, 1);
});

await test('an adapter for one site is checked on the copies of the person\'s pages there, with its preview\'s checks', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  const mhtml = (url, mark) => Buffer.from(`From: <Saved by Blink>\r\nContent-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----B"\r\n\r\n------B\r\nContent-Type: text/html\r\nContent-Location: ${url}\r\n\r\n<p>${mark}</p>\r\n------B--\r\n`).toString('base64');
  const copy = (body) => api(`/agent/chats/${id}/page-copy`, { method: 'POST', body });
  assert.equal((await copy({ url: 'https://example.com/shop', mhtml: mhtml('https://example.com/shop', 'OLD') })).status, 201);
  assert.equal((await copy({ url: 'https://example.com/shop', mhtml: mhtml('https://example.com/shop', 'SHOP') })).status, 201);
  assert.equal((await copy({ url: 'https://other.example/', mhtml: mhtml('https://other.example/', 'OTHER') })).status, 201);
  assert.equal((await copy({ url: 'https://example.com/x', mhtml: Buffer.from('<p>not saved</p>').toString('base64') })).status, 400, 'only MHTML');
  assert.equal((await copy({ url: 'file:///etc/passwd', mhtml: mhtml('https://example.com/', 'X') })).status, 400, 'only a web page');
  assert.equal((await api('/agent/chats/nope/page-copy', { method: 'POST', body: { url: 'https://example.com/', mhtml: mhtml('https://example.com/', 'X') } })).status, 404);
  assert.ok(!JSON.stringify(lines).includes('example.com/shop'), 'never in the log');
  const before = checkSpecs.length;
  await until(async () => (await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'previewonly please' } })).status !== 409);
  await until(async () => { const x = await adapterNow(id, 'tea-cosy'); return x?.check?.status === 'passed' && x; });
  const got = checkSpecs.slice(before).find(c => /cosy/.test(c.code));
  assert.deepEqual(got.spec.runsOn, ['https://example.com/*']);
  // Its site's page, the latest copy of it; not the other site's.
  assert.deepEqual(got.spec.copies, [{ url: 'https://example.com/shop', file: 'copies/0.mhtml' }]);
  assert.equal(got.copies.length, 1);
  assert.match(got.copies[0], /SHOP/);
  assert.deepEqual(got.spec.checks, [{ name: 'cosy', code: 'return document.body.dataset.cosy === "1";' }]);
  sb.close();
});

await test('a full review asked for while the background check runs waits for it, and the code is checked once', async () => {
  const sb = sidebar('ada', { preview: previewOk });
  const id = (await (await api('/agent/chats', { method: 'POST' })).json()).chat.id;
  let release;
  holdChecks = new Promise(r => { release = r; });
  const before = checkRuns.length;
  await until(async () => (await api(`/agent/chats/${id}/messages`, { method: 'POST', body: { text: 'previewonly please' } })).status !== 409);
  await until(async () => { const x = await adapterNow(id, 'tea-cosy'); return x?.check?.status === 'running' && x; });
  assert.equal((await api(`/agent/chats/${id}/adapters/tea-cosy/review`, { method: 'POST' })).status, 202);
  assert.deepEqual(['queued', 'check'], await until(async () => { const r = (await adapterNow(id, 'tea-cosy')).review; return r?.status === 'queued' && [r.status, r.after]; }));
  holdChecks = null;
  release();
  const r = await until(async () => { const x = await adapterNow(id, 'tea-cosy'); return x?.review?.status === 'passed' && x.review; });
  assert.equal(r.verdict, 'ok');
  assert.equal(checkRuns.length - before, 1, 'checked once, for both');
  sb.close();
});

await test('the model proxy: sandbox token in, real key out, one model, no rate limit of its own', async () => {
  const token = readFileSync(path.join(dataDir, 'accounts/ada/token'), 'utf8');
  const call = (key, model = 'gemini-flash-lite-latest') => fetch(`http://127.0.0.1:${sandboxPort}/model/v1beta/models/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await call('sbx_not-a-real-token-at-all-000000')).status, 401);
  assert.equal((await call(token)).status, 200);
  assert.equal(upstreamCalls.at(-1).key, 'REAL-KEY');
  assert.match(upstreamCalls.at(-1).url, /\/models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
  for (let i = 0; i < 70; i++) assert.equal((await call(token)).status, 200, 'no per-minute limit');
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
