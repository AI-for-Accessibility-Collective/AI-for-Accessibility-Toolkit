// Verify the catalog's built-in adapters with the sidebar's verifiers.
//
//   node scripts/verify-adapters/run.mjs --replay [name ...]
//     Runs every saved spec (tools/test/verify/*.json) again, without an
//     agent, and fails unless each applied, passed every check, added no
//     axe-core problem, put the page back on disable() and threw nothing.
//     Needs Chromium (npx playwright install chromium), like
//     tools/test/browser-validate.js, so `npm test` does not run it.
//
//   node scripts/verify-adapters/run.mjs --agent [name ...] [--parallel 4]
//       [--logs DIR] [--skills DIR,...]
//     An opencode agent per adapter (AGENTS.md here), with verify_adapter and
//     run_tests (mcp.mjs), verifies it and fixes what fails, editing this
//     checkout: run it in a worktree. Gemini through opencode's google
//     provider, with the key in GEMINI_API_KEY. The agent has no shell and
//     no web access. Writes each agent's report and events to DIR.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { openVerifier, ROOT } from './harness.mjs';
import { MODEL } from '../../agent-host/src/runner.js';

const HERE = path.join(ROOT, 'scripts/verify-adapters');
const SPECS = path.join(ROOT, 'tools/test/verify');
// Helpers of agent-watch.js, verified through it; not adapters of their own.
const NOT_ADAPTERS = new Set(['index', '_primitives', 'agent-watch-shapes', 'agent-watch-surfaces']);

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : fallback; };
const mode = argv.includes('--agent') ? 'agent' : argv.includes('--replay') ? 'replay' : null;
const parallel = Number(flag('--parallel', 4));
const logs = path.resolve(flag('--logs', path.join(ROOT, '.verify-logs')));
const skills = flag('--skills', '').split(',').filter(Boolean);
const names = argv.filter(a => !a.startsWith('--'));

if (mode === 'replay') await replay();
else if (mode === 'agent') await agents();
else { console.error('Usage: run.mjs --replay [name ...] | --agent [name ...] [--parallel N] [--logs DIR] [--skills DIR,...]'); process.exit(2); }

async function replay() {
  const specs = readdirSync(SPECS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
    .filter(n => !names.length || names.some(x => n === x || n.startsWith(`${x}-`)));
  const v = await openVerifier();
  let failed = 0;
  for (const name of specs) {
    const spec = JSON.parse(readFileSync(path.join(SPECS, `${name}.json`), 'utf8'));
    let r;
    try { r = await v.verify(spec); } catch (e) { r = { status: 'failed', message: e.message }; }
    const problems = [];
    if (r.status !== 'applied') problems.push(`${r.status}${r.message ? `: ${r.message}` : ''}`);
    const bad = (r.checks || []).map((c, i) => (!c.after ? spec.checks[i]?.name : null)).filter(Boolean);
    if (bad.length) problems.push(`checks fail: ${bad.join('; ')}`);
    if (r.axe?.error) problems.push(`axe-core: ${r.axe.error}`);
    for (const rule of r.axe?.added || []) problems.push(`adds ${rule.id} (WCAG ${rule.wcag.join(', ') || '-'}) on ${rule.count}`);
    if (r.status === 'applied' && !r.restored) problems.push('disable() does not restore the page');
    if (r.errors?.length) problems.push(`errors: ${r.errors.join(' | ').slice(0, 300)}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'PASS'}: ${name}${r.status === 'applied' ? ` (shift ${r.shift ?? '-'})` : ''}${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  }
  await v.close();
  console.log(`\n${specs.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

async function agents() {
  if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY.'); process.exit(2); }
  const all = readdirSync(path.join(ROOT, 'tools/adapters')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(n => !NOT_ADAPTERS.has(n));
  const queue = names.length ? names : all;
  mkdirSync(logs, { recursive: true });
  const config = path.join(logs, 'opencode.json');
  writeFileSync(config, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model: MODEL,
    provider: { google: { options: { apiKey: '{env:GEMINI_API_KEY}' } } },
    mcp: { verifier: { type: 'local', command: ['node', path.join(HERE, 'mcp.mjs')] } },
    permissions: ['bash', 'webfetch', 'websearch', 'question', 'external_directory'].map(action => ({ action, resource: '*', effect: 'deny' })),
    instructions: [path.join(HERE, 'AGENTS.md')],
    skills: [path.join(ROOT, '.claude/skills'), ...skills],
  }, null, 2));

  const results = {};
  const work = async (name) => {
    const started = Date.now();
    const events = createWriteStream(path.join(logs, `${name}.jsonl`));
    const task = `Verify the built-in adapter tools/adapters/${name}.js with the verifiers, and fix what fails in it, as your instructions say. Name your specs ${name} (and ${name}-<variant>), and your test page tools/test/verify/pages/${name}.html.`;
    const child = spawn('opencode', ['run', '--standalone', '--auto', '--format', 'json', '--title', `verify ${name}`, task], {
      cwd: ROOT, env: { ...process.env, OPENCODE_CONFIG: config }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 40 * 60_000);
    let text = '';
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    for await (const line of readline.createInterface({ input: child.stdout })) {
      events.write(line + '\n');
      try {
        const e = JSON.parse(line);
        if (e.type === 'text' && e.part?.text) text = e.part.text;
      } catch { /* not JSON */ }
    }
    const code = await new Promise((r) => (child.exitCode !== null ? r(child.exitCode) : child.on('close', r)));
    clearTimeout(timer);
    events.end();
    const report = text || `(no report; opencode exited ${code})\n${stderr}`;
    writeFileSync(path.join(logs, `${name}.md`), report + '\n');
    results[name] = (/^Outcome:\s*([a-z-]+)/m.exec(report) || [, 'no-report'])[1];
    console.log(`${name}: ${results[name]} (${Math.round((Date.now() - started) / 60000)} min)`);
  };
  const pending = [...queue];
  await Promise.all(Array.from({ length: Math.min(parallel, pending.length) }, async () => {
    while (pending.length) await work(pending.shift());
  }));
  writeFileSync(path.join(logs, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
