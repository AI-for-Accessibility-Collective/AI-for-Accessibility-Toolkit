#!/usr/bin/env node
// Stands in for `opencode run` as run.mjs --review-file starts it: reads the
// config the way opencode does, makes one model call through the base URL
// it names (the host's model proxy) with the key it names, reads one rubric
// from the verifier's MCP server, and prints opencode-style JSON lines with
// a report that says what it was given.

import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.env.OPENCODE_CONFIG, 'utf8'));
const task = process.argv.at(-1);
const google = config.provider.google.options;
const key = String(google.apiKey).replace(/^\{env:(\w+)\}$/, (_, k) => process.env[k] || '');
const out = (o) => process.stdout.write(`${JSON.stringify({ sessionID: 'ses_review', timestamp: Date.now(), ...o })}\n`);

const model = await fetch(`${google.baseURL}/models/gemini-3.8-flash:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status, () => 'unreachable');
const { url, headers } = config.mcp.verifier;
const rubric = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wcag_rubric', arguments: { sc: '2.4.7' } } }) }).then((r) => r.json());
out({ type: 'tool_use', part: { id: 't1', tool: 'verifier_wcag_rubric', state: { status: 'completed', input: { sc: '2.4.7' }, output: rubric.result.content[0].text } } });
const denied = config.permissions.filter((p) => p.effect === 'deny').map((p) => p.action).sort().join(',');
const instructions = config.instructions.map((f) => f.split('/').slice(-2).join('/')).join(', ');
out({ type: 'text', part: { id: 'p1', type: 'text', text: [
  'Verdict: issues',
  '[low] tools/core-adapters/.check/check-bigger-buttons.js:1 — a stand-in finding',
  '  Evidence: suspected from reading',
  '  Fix: none',
  '',
  `Model: ${model}. Rubric: ${/Focus Visible/.test(rubric.result.content[0].text) ? 'read' : 'not read'}. Denied: ${denied}. Instructions: ${instructions}.`,
  `Task names the file: ${/tools\/core-adapters\/\.check\/check-bigger-buttons\.js/.test(task)}. About: ${/Makes buttons bigger/.test(task)}. Check: ${/Its result: 1 passed, 1 failed/.test(task)}. Failing run: ${/adds color-contrast/.test(task)}. Rubrics offered: ${(task.match(/^- \d+\.\d+\.\d+ /gm) || []).length}.`,
].join('\n') } });
