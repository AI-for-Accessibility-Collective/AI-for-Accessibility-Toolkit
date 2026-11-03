// Verify the catalog's built-in adapters with the sidebar's verifiers.
//
//   node scripts/verify-adapters/run.mjs --replay [name ...]
//     Runs every saved spec (tools/test/verify/*.json) again, without an
//     agent, and fails unless each applied, passed every check, added no
//     axe-core problem, put the page back on disable() and threw nothing.
//     Needs Chromium (npx playwright install chromium), like
//     tools/test/browser-validate.js, so `npm test` does not run it.
//
//   node scripts/verify-adapters/run.mjs --agent --sandboxed [name ...]
//       [--parallel 4] [--logs DIR] [--skills DIR,...]
//     An opencode agent per adapter (AGENTS.md here), with the verifier's
//     tools (mcp.mjs), verifies it and fixes what fails, editing this
//     checkout. Gemini through opencode's google provider, with the key in
//     GEMINI_API_KEY. Writes each agent's report and events to DIR.
//
//     Only in the container this folder's Dockerfile builds, on the agent
//     host VM under gVisor with a copy of the repository (--sandboxed says
//     you are there): the agent has a shell and opencode's code mode
//     (`execute`, which runs its JavaScript, and through which it calls the
//     verifier's tools). Never on your own machine, where both would run as
//     you. No web tools: the job needs none, as for the sidebar's agent.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { openVerifier, ROOT } from './harness.mjs';
import { serveHttp, SITES } from './mcp.mjs';
import { MODEL } from '../../agent-host/src/runner.js';

const HERE = path.join(ROOT, 'scripts/verify-adapters');
const SPECS = path.join(ROOT, 'tools/test/verify');
// Helpers of agent-watch.js, verified through it; not adapters of their own.
const NOT_ADAPTERS = new Set(['index', '_primitives', 'agent-watch-shapes', 'agent-watch-surfaces']);

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : fallback; };
const mode = argv.includes('--agent') ? 'agent' : argv.includes('--replay') ? 'replay' : null;
if (mode === 'agent' && !argv.includes('--sandboxed')) { console.error('Run the agents in the verify container on the agent host VM (see Dockerfile), with --sandboxed.'); process.exit(2); }
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
  const runs = [];
  for (const name of specs) {
    const spec = JSON.parse(readFileSync(path.join(SPECS, `${name}.json`), 'utf8'));
    if (spec.sites) for (const site of SITES) runs.push([`${name} @ ${site.name}`, { ...spec, page: site.url, checks: spec.checks || [] }, true]);
    else runs.push([name, spec, false]);
  }
  for (const [name, spec, live] of runs) {
    let r;
    try { r = await v.verify(spec); } catch (e) { r = { status: live ? 'unreachable' : 'failed', message: e.message.slice(0, 200) }; }
    const problems = [];
    // On a live page, skipping (nothing to do there) is fine, and a page that does not load is reported, not failed.
    const fine = live ? ['applied', 'skipped', 'unreachable'] : ['applied'];
    if (!fine.includes(r.status)) problems.push(`${r.status}${r.message ? `: ${r.message}` : ''}`);
    else if (r.status === 'unreachable') console.log(`SKIP: ${name} (${r.message})`);
    if (r.leftovers?.length) problems.push(`disable() leaves ${r.leftovers.join(' ')}`);
    const bad = (r.checks || []).map((c, i) => (!c.after ? spec.checks[i]?.name : null)).filter(Boolean);
    if (bad.length) problems.push(`checks fail: ${bad.join('; ')}`);
    if (r.axe?.error) problems.push(`axe-core: ${r.axe.error}`);
    for (const rule of r.axe?.added || []) problems.push(`adds ${rule.id} (WCAG ${rule.wcag.join(', ') || '-'}) on ${rule.count}`);
    if (r.status === 'applied' && r.restored === false) problems.push('disable() does not restore the page');
    if (r.errors?.length) problems.push(`errors: ${r.errors.join(' | ').slice(0, 300)}`);
    if (problems.length) failed++;
    if (r.status === 'unreachable') continue;
    console.log(`${problems.length ? 'FAIL' : 'PASS'}: ${name}${r.status === 'applied' ? ` (shift ${r.shift ?? '-'})` : ''}${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  }
  await v.close();
  console.log(`\n${runs.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

async function agents() {
  if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY.'); process.exit(2); }
  const all = readdirSync(path.join(ROOT, 'tools/adapters')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(n => !NOT_ADAPTERS.has(n));
  const queue = names.length ? names : all;
  mkdirSync(logs, { recursive: true });
  const config = path.join(logs, 'opencode.json');
  const token = randomBytes(24).toString('hex');
  const mcpServer = await serveHttp({ token });
  writeFileSync(config, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model: MODEL,
    provider: { google: { options: { apiKey: '{env:GEMINI_API_KEY}' } } },
    mcp: { verifier: { type: 'remote', url: mcpServer.url, headers: { authorization: `Bearer ${token}` }, oauth: false, codemode: false } },
    permissions: ['webfetch', 'websearch', 'task', 'question'].map(action => ({ action, resource: '*', effect: 'deny' })),
    instructions: [path.join(HERE, 'AGENTS.md')],
    skills: [path.join(ROOT, '.claude/skills'), ...skills],
  }, null, 2));

  const results = {};
  // Each agent its own home: opencode servers started together in one home
  // collide ("Standalone server exited before reporting readiness").
  const homeOf = (name) => {
    const home = path.join(logs, 'home', name);
    mkdirSync(path.join(home, '.cache/opencode'), { recursive: true });
    const models = '/opt/agent/models.json';
    if (existsSync(models) && !existsSync(path.join(home, '.cache/opencode/models.json'))) copyFileSync(models, path.join(home, '.cache/opencode/models.json'));
    return home;
  };
  const work = async (name, attempt = 1) => {
    const started = Date.now();
    const events = createWriteStream(path.join(logs, `${name}.jsonl`));
    const task = `Verify the built-in adapter tools/adapters/${name}.js with the verifiers, and fix what fails in it, as your instructions say. Name your specs ${name} (and ${name}-<variant>), and your test page tools/test/verify/pages/${name}.html.`;
    const child = spawn('opencode', ['run', '--standalone', '--auto', '--format', 'json', '--title', `verify ${name}`, task], {
      cwd: ROOT, env: { ...process.env, OPENCODE_CONFIG: config, HOME: homeOf(name) }, stdio: ['ignore', 'pipe', 'pipe'],
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
    if (!text && attempt === 1 && /before reporting readiness/.test(stderr)) return work(name, 2);
    const report = text || `(no report; opencode exited ${code})\n${stderr}`;
    writeFileSync(path.join(logs, `${name}.md`), report + '\n');
    results[name] = (/^Outcome:\s*([a-z-]+)/m.exec(report) || [, 'no-report'])[1];
    console.log(`${name}: ${results[name]} (${Math.round((Date.now() - started) / 60000)} min)`);
  };
  const pending = [...queue];
  await Promise.all(Array.from({ length: Math.min(parallel, pending.length) }, async (_, i) => {
    await new Promise((r) => setTimeout(r, i * 5000)); // staggered starts
    while (pending.length) await work(pending.shift());
  }));
  await mcpServer.close();
  writeFileSync(path.join(logs, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
