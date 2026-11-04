#!/usr/bin/env node
// Stands in for scripts/verify-adapters/run.mjs in the checks tests:
//   --check <file> --out <report.json>                 writes a report like run.mjs --check
//   --agent --sandboxed --review-file <file> ... --logs <dir>   a reviewer: calls the model
//     proxy with its token, tries the browser tools with it, and says what it saw
// "SLOW" in the adapter makes it take a second; "HANG", forever.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.includes('--check')) {
  const code = readFileSync(opt('--check'), 'utf8');
  if (/HANG/.test(code)) { setInterval(() => {}, 1000); await new Promise(() => {}); }
  if (/SLOW/.test(code)) await sleep(1000);
  if (/NOREPORT/.test(code)) process.exit(1);
  const report = {
    adapter: path.basename(opt('--check')), at: new Date().toISOString(),
    runs: [
      { name: 'buttons.html', status: 'pass', result: 'applied', problems: [] },
      { name: 'buttons.html (narrow)', status: 'fail', result: 'applied', problems: ['adds color-contrast (WCAG 1.4.3) on 2'], advice: ['region on 1'] },
      { name: '@ Wikipedia', status: 'skip', result: 'unreachable', problems: [] },
    ],
    summary: { passed: 1, failed: 1, skipped: 1, appliedOnTestPages: 1, testPages: 1 },
    notes: ['These checks find some problems in code. They do not show that the adapter helps anyone: only the people who use it can.'],
  };
  // What it was given, for the test to read back.
  if (/ENV/.test(code)) report.runs.push({ name: 'env', status: 'pass', result: 'applied', problems: [`sites ${process.env.VERIFY_SITES} ${process.env.VERIFY_SITE_CACHE}`, `secrets ${process.env.AGENT_HOST_SECRET || process.env.AGENT_GEMINI_KEY || process.env.GEMINI_API_KEY ? 'present' : 'absent'}`] });
  writeFileSync(opt('--out'), JSON.stringify(report));
  process.exit(1); // run.mjs exits 1 when a run fails
}

if (args.includes('--review-file')) {
  const token = process.env.GEMINI_API_KEY;
  const base = process.env.VERIFY_MODEL_BASE_URL;
  const model = await fetch(`${base}/models/anything:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': token, 'content-type': 'application/json' }, body: '{}' });
  const tools = await fetch(`${base.replace(/\/model\/v1beta$/, '')}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const about = readFileSync(opt('--about'), 'utf8');
  const report = JSON.parse(readFileSync(opt('--check-report'), 'utf8'));
  const logs = opt('--logs');
  mkdirSync(logs, { recursive: true });
  const text = [
    'Verdict: issues',
    '[medium] adapter.js:3 — a guess from a class name',
    '  Evidence: suspected from reading',
    '  Fix: use the role',
    '',
    `Proxy: ${model.status}. Tools: ${tools.status}. Secret: ${process.env.AGENT_HOST_SECRET || process.env.AGENT_GEMINI_KEY ? 'present' : 'absent'}. About: ${/Description: Makes buttons bigger/.test(about) ? 'yes' : 'no'}. Report: ${report.summary.failed} failed.`,
  ].join('\n');
  writeFileSync(path.join(logs, 'review.json'), JSON.stringify({ verdict: 'issues', rubricsRead: ['2.5.8', '1.4.3'].slice(0, 1), report: text }));
  process.exit(0);
}
process.exit(2);
