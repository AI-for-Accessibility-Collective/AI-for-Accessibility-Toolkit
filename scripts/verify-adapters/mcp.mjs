// An MCP server (stdio) that gives an opencode agent the sidebar's verifiers
// for the catalog's built-in adapters (harness.mjs), and the adapter's own
// tests:
//
//   verify_adapter   run an adapter on a test page in headless Chromium, as
//                    the sidebar previews one: axe-core before and after,
//                    the agent's checks, changes and layout shift; then
//                    disable() and whether the page is back as it was. Saves
//                    the spec to tools/test/verify/<name>.json, so
//                    `node scripts/verify-adapters/run.mjs --replay` runs it
//                    again without an agent.
//   run_tests        the adapter's unit test (tools/test/<name>-test.js) and
//                    the catalog's conformance test.
//   contrast_ratio   the WCAG contrast ratio of two colours (the agent has no
//                    shell to run the accessibility skill's script).
//
// The result text is the sidebar's (axeText, shiftText from the agent host).

import readline from 'node:readline';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { openVerifier, ROOT } from './harness.mjs';
import { axeText, shiftText } from '../../agent-host/src/browser-tools.js';
import { getContrastRatio, parseColor } from '../../tools/utils/color.js';

const SPECS = path.join(ROOT, 'tools/test/verify');
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
let verifier = null;

const TOOLS = [
  {
    name: 'verify_adapter',
    description: 'Run a built-in adapter on a test page in headless Chromium, the way the sidebar previews one: axe-core (WCAG 2.0-2.2 A and AA rules) before and after enable(), your checks before and after, how many changes enable() made and its layout shift; then disable(), and whether the page is back exactly as it was; and the page\'s errors. Saves what you ran to tools/test/verify/<name>.json.',
    inputSchema: {
      type: 'object', required: ['name', 'file', 'page', 'checks'],
      properties: {
        name: { type: 'string', description: 'The adapter file\'s name without .js, such as big-targets (or big-targets-zoom for a second spec).' },
        file: { type: 'string', description: 'The adapter file, such as tools/adapters/big-targets.js.' },
        export: { type: 'string', description: 'The exported adapter object, when the file exports more than one, such as BigTargets.' },
        page: { type: 'string', description: 'The test page, a file you wrote in tools/test/verify/pages/, such as big-targets.html.' },
        options: { type: 'object', description: 'The options passed to enable().' },
        checks: { type: 'array', description: 'Checks, as in the sidebar: each the body of an async function run in the page before enable() and again after it, returning true when the page is as it should be.', items: { type: 'object', required: ['name', 'code'], properties: { name: { type: 'string' }, code: { type: 'string' } } } },
        ai: { type: 'object', description: 'Fixed answers for the AI functions the adapter calls (tools/utils/ai.js), by name, such as {"describeImage": "A red bicycle."}. Without one, that function is unavailable, as when no AI is set up. What the adapter announces is in globalThis.__verifyAnnounced.' },
        harness: { type: 'object', description: 'Only for a file of fix functions rather than an adapter object: {"enable": "...", "disable": "..."}, async function bodies, with m the file\'s exports and options the options.', properties: { enable: { type: 'string' }, disable: { type: 'string' } } },
        viewport: { type: 'object', description: '{"width", "height"}; default 1280 by 800. Use 320 wide to check reflow.', properties: { width: { type: 'number' }, height: { type: 'number' } } },
        reducedMotion: { type: 'string', enum: ['reduce', 'no-preference'] },
        screenshot: { type: 'boolean', description: 'Also return a screenshot of the page with the adapter on.' },
      },
    },
  },
  {
    name: 'run_tests',
    description: 'Run the adapter\'s unit test (tools/test/<name>-test.js, if there is one) and the catalog\'s conformance test. Run them after you change an adapter.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The adapter file\'s name without .js.' } } },
  },
  {
    name: 'contrast_ratio',
    description: 'The WCAG contrast ratio of a foreground and a background colour (hex or rgb()), and whether it meets 4.5:1 (text) and 3:1 (large text, controls, focus indicators).',
    inputSchema: { type: 'object', required: ['foreground', 'background'], properties: { foreground: { type: 'string' }, background: { type: 'string' } } },
  },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

function resultText(name, r, saved) {
  const lines = [`Result: ${r.status}${r.message ? ` (${r.message})` : ''}.`];
  if (r.status === 'applied') {
    if (Number.isFinite(r.changes)) lines.push(r.changes ? `enable() made ${r.changes} changes in the page.` : 'enable() changed nothing in the page: what it looks for is probably not on the test page.');
    lines.push(shiftText(r.shift));
  }
  if (r.checks?.length) lines.push('Checks (before enable → after):', ...r.checks.map((c, i) => `- ${saved.checks[i]?.name}: ${c.before ? 'pass' : 'fail'} → ${c.after ? 'pass' : 'fail'}${c.error ? ` (${c.error})` : ''}`));
  if (r.status === 'applied') {
    lines.push(axeText(r.axe).replace(/ \(the intopia-web-accessibility skill\)/, ''));
    if (r.disable !== 'ran') lines.push(`disable(): ${r.disable}`);
    lines.push(r.restored ? 'After disable() the page is back exactly as it was.'
      : `After disable() the page is NOT back as it was. First difference (HTML around it):\n  before: ${r.difference?.before}\n  after:  ${r.difference?.after}`);
  }
  if (r.announced?.length) lines.push(`Announced: ${r.announced.map(a => JSON.stringify(a)).join(', ')}`);
  lines.push(r.errors?.length ? `Page errors:\n${r.errors.map(e => `- ${e.slice(0, 300)}`).join('\n')}` : 'No page errors.');
  lines.push(`Saved as tools/test/verify/${name}.json.`);
  return lines.filter(Boolean).join('\n');
}

const handlers = {
  async verify_adapter(args) {
    if (!NAME.test(String(args.name || ''))) return text('name must be lowercase letters, digits and dashes.', true);
    const { screenshot, ...spec } = args;
    verifier ||= await openVerifier();
    let r;
    try { r = await verifier.verify(spec, { screenshot: screenshot === true }); } catch (e) { return text(e.message, true); }
    mkdirSync(SPECS, { recursive: true });
    writeFileSync(path.join(SPECS, `${args.name}.json`), JSON.stringify(spec, null, 2) + '\n');
    const out = text(resultText(args.name, r, spec));
    if (r.screenshot) out.content.push({ type: 'image', mimeType: 'image/png', data: r.screenshot });
    return out;
  },

  async run_tests(args) {
    const name = String(args.name || '');
    if (!NAME.test(name)) return text('name must be lowercase letters, digits and dashes.', true);
    const tests = [`tools/test/${name}-test.js`, 'tools/test/adapter-conformance-test.js'].filter(t => existsSync(path.join(ROOT, t)));
    const parts = [];
    let failed = false;
    for (const t of tests) {
      const { code, out } = await new Promise((resolve) => execFile('node', [t], { cwd: ROOT, timeout: 180_000, maxBuffer: 8 << 20 },
        (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` })));
      failed ||= code !== 0;
      const tail = out.trim().split('\n');
      const shown = code === 0 ? tail.slice(-3) : tail.filter(l => /fail|error|assert|expected|✗|not ok/i.test(l)).slice(0, 40).concat(tail.slice(-10));
      parts.push(`${t}: ${code === 0 ? 'passed' : `FAILED (exit ${code})`}\n${shown.join('\n')}`);
    }
    if (!tests.some(t => t.includes(name))) parts.unshift(`There is no tools/test/${name}-test.js.`);
    return text(parts.join('\n\n'), failed);
  },

  async contrast_ratio(args) {
    const fg = String(args.foreground || ''), bg = String(args.background || '');
    if (!parseColor(fg) || !parseColor(bg)) return text('Give each colour as hex or rgb().', true);
    const ratio = Math.round(getContrastRatio(fg, bg) * 100) / 100;
    return text(`${ratio}:1. Text: ${ratio >= 4.5 ? 'meets' : 'fails'} 4.5:1. Large text, controls and focus indicators: ${ratio >= 3 ? 'meets' : 'fails'} 3:1.`);
  },
};

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function error(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } }) + '\n'); }

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    if (method === 'initialize') reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'adapter-verifier', version: '1.0.0' } });
    else if (method === 'tools/list') reply(id, { tools: TOOLS });
    else if (method === 'tools/call') {
      const h = handlers[params?.name];
      reply(id, h ? await h(params.arguments || {}) : text(`Unknown tool ${params?.name}.`, true));
    } else if (method === 'ping') reply(id, {});
    else error(id, `Unknown method ${method}`);
  } catch (e) { reply(id, text(`The verifier failed: ${e.message}`, true)); }
});
rl.on('close', async () => { await verifier?.close(); process.exit(0); });
