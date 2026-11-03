// An MCP server (stdio, or streamable HTTP with serveHttp) that gives an opencode agent the sidebar's verifiers
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
//   verify_on_sites  the same on each live page in sites.json (W3C's BAD
//                    demo, Deque's workshop, Wikipedia, ...), for
//                    robustness: what holds on any page. Saved as
//                    tools/test/verify/<name>-sites.json.
//   run_tests        the adapter's unit test (tools/test/<name>-test.js) and
//                    the catalog's conformance test.
//   contrast_ratio   the WCAG contrast ratio of two colours (the agent has no
//                    shell to run the accessibility skill's script).
//
// The result text is the sidebar's (axeText, shiftText from the agent host).
//
// run.mjs serves it over HTTP on 127.0.0.1, as the agent host serves the
// browser tools, so one browser serves every agent.

import readline from 'node:readline';
import http from 'node:http';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVerifier, ROOT } from './harness.mjs';
import { axeText, shiftText } from '../../agent-host/src/browser-tools.js';
import { getContrastRatio, parseColor } from '../../tools/utils/color.js';

const SPECS = path.join(ROOT, 'tools/test/verify');
export const SITES = JSON.parse(readFileSync(path.join(ROOT, 'scripts/verify-adapters/sites.json'), 'utf8')).sites;
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
        restores: { type: 'boolean', description: 'false for a file of fixes that has no way to undo them (they are meant to stay): what disable() leaves is then expected.' },
        viewport: { type: 'object', description: '{"width", "height"}; default 1280 by 800. Use 320 wide to check reflow.', properties: { width: { type: 'number' }, height: { type: 'number' } } },
        reducedMotion: { type: 'string', enum: ['reduce', 'no-preference'] },
        screenshot: { type: 'boolean', description: 'Also return a screenshot of the page with the adapter on.' },
      },
    },
  },
  {
    name: 'verify_on_sites',
    description: `Run the adapter, as verify_adapter does, on each live page in the robustness list: ${SITES.map(s => `${s.name} (${s.about})`).join('; ')}. Reports per page: whether enable() applied or skipped, page errors during the run, the axe-core problems it added, the layout shift, and what disable() left of its marks (or whether the page is back exactly, when the page holds still). Your checks are optional here and must hold on any page. Saves what you ran to tools/test/verify/<name>-sites.json.`,
    inputSchema: {
      type: 'object', required: ['name', 'file'],
      properties: {
        name: { type: 'string', description: 'The adapter file\'s name without .js.' },
        file: { type: 'string' }, export: { type: 'string' }, options: { type: 'object' }, ai: { type: 'object' }, harness: { type: 'object' },
        checks: { type: 'array', description: 'Optional checks that hold on any page.', items: { type: 'object', required: ['name', 'code'], properties: { name: { type: 'string' }, code: { type: 'string' } } } },
        sites: { type: 'array', items: { type: 'string' }, description: 'Only these sites, by name. Default: all.' },
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
    lines.push(...restoreText(r));
  }
  if (r.announced?.length) lines.push(`Announced: ${r.announced.map(a => JSON.stringify(a)).join(', ')}`);
  lines.push(r.errors?.length ? `Page errors:\n${r.errors.map(e => `- ${e.slice(0, 300)}`).join('\n')}` : 'No page errors.');
  lines.push(`Saved as tools/test/verify/${name}.json.`);
  return lines.filter(Boolean).join('\n');
}

function restoreText(r) {
  const lines = [];
  if (r.disable !== 'ran') lines.push(`disable(): ${r.disable}`);
  if (r.leftovers?.length) lines.push(`After disable() these marks are left in the page: ${r.leftovers.join(' ')}`);
  if (r.restored === true) lines.push('After disable() the page is back exactly as it was.');
  else if (r.restored === 'unknown') lines.push('The page changes by itself, so it cannot be compared exactly; disable() left none of its marks.');
  else if (r.difference) lines.push(`After disable() the page is NOT back as it was. First difference (HTML around it):\n  before: ${r.difference.before}\n  after:  ${r.difference.after}`);
  return lines;
}

/** One live page's result, in a few lines. */
function siteText(site, r) {
  if (r.error) return `## ${site.name}: could not run (${r.error})`;
  const lines = [`## ${site.name} (${site.url}): ${r.status}${r.message ? ` (${r.message})` : ''}`];
  if (r.status === 'applied') {
    lines.push(`- ${r.changes ?? '?'} changes; layout shift ${r.shift ?? '?'}${r.shift >= 0.1 ? ' (a lot)' : ''}.`);
    if (r.axe?.error) lines.push(`- axe-core could not run: ${r.axe.error}`);
    for (const a of r.axe?.added || []) lines.push(`- ADDED ${a.id}: ${a.help}${a.wcag.length ? ` (WCAG ${a.wcag.join(', ')})` : ''}, on ${a.count}: ${(a.targets || []).join('; ')}${a.summary ? ` (${a.summary.replace(/\s+/g, ' ').slice(0, 200)})` : ''}`);
    if (r.axe?.fixed?.length) lines.push(`- fixed: ${r.axe.fixed.map(a => `${a.id} on ${a.count}`).join('; ')}`);
    (r.checks || []).forEach((c, i) => { if (!c.after) lines.push(`- check ${i + 1} fails after enable()${c.error ? `: ${c.error}` : ''}`); });
    lines.push(...restoreText(r).map(l => `- ${l}`));
  }
  if (r.errors?.length) lines.push(`- errors during the run (the adapter's, or the site's own: look at them): ${r.errors.map(e => e.slice(0, 200)).join(' | ')}`);
  return lines.join('\n');
}

const handlers = {
  async verify_on_sites(args) {
    if (!NAME.test(String(args.name || ''))) return text('name must be lowercase letters, digits and dashes.', true);
    const { name, sites: only, ...rest } = args;
    const sites = SITES.filter(s => !only?.length || only.includes(s.name));
    verifier ||= await openVerifier();
    const results = [];
    const queue = [...sites];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let site; (site = queue.shift());) {
        let r;
        try { r = await verifier.verify({ ...rest, page: site.url, checks: rest.checks || [] }); } catch (e) { r = { error: e.message.slice(0, 200) }; }
        results.push([site, r]);
      }
    }));
    mkdirSync(SPECS, { recursive: true });
    writeFileSync(path.join(SPECS, `${name}-sites.json`), JSON.stringify({ ...rest, sites: 'all' }, null, 2) + '\n');
    results.sort((a, b) => sites.indexOf(a[0]) - sites.indexOf(b[0]));
    return text([...results.map(([site, r]) => siteText(site, r)),
      `Saved as tools/test/verify/${name}-sites.json. Problems on these pages that were there before enable() are the site's. A live page can fail to load or change between runs: run it again before you act on one odd result.`].join('\n\n'));
  },

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

/** One JSON-RPC request in, its response out (null for a notification). */
export async function dispatch(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  try {
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'adapter-verifier', version: '1.0.0' } });
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'ping') return reply({});
    if (method === 'tools/call') {
      const h = handlers[params?.name];
      return reply(h ? await h(params.arguments || {}) : text(`Unknown tool ${params?.name}.`, true));
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } };
  } catch (e) { return reply(text(`The verifier failed: ${e.message}`, true)); }
}

/** Streamable HTTP (JSON replies) on 127.0.0.1, for requests with the token. Resolves to { url, close }. */
export function serveHttp({ token }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    let msg;
    try { const chunks = []; for await (const c of req) chunks.push(c); msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const out = await dispatch(msg);
    if (!out) { res.writeHead(202); return res.end(); }
    send(200, out);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    close: async () => { await new Promise((r) => server.close(r)); await verifier?.close(); },
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const out = await dispatch(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
  rl.on('close', async () => { await verifier?.close(); process.exit(0); });
}
