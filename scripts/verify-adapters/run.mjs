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
//   ... --agent --sandboxed --create [id ...]
//     Instead, build the core adapters (core-adapters.json) on the building
//     blocks: an agent per brief (CREATE.md here) writes
//     tools/core-adapters/<id>.js, its test page and specs, and verifies it
//     on the test page and on real sites. Each report starts "Outcome:".
//
//   ... --agent --sandboxed --review <base> [--core] [--model <provider/model>]
//     Instead, an independent review: an agent per adapter changed since
//     <base> (REVIEW.md here) reads the change and reports what is wrong
//     with it, confirming with the verifier where it can; it changes
//     nothing. Each report starts "Verdict: ok | issues".
//
//     Only in the container this folder's Dockerfile builds, on the agent
//     host VM under gVisor with a copy of the repository (--sandboxed says
//     you are there): the agent has a shell and opencode's code mode
//     (`execute`, which runs its JavaScript, and through which it calls the
//     verifier's tools). Never on your own machine, where both would run as
//     you. No web tools: the job needs none, as for the sidebar's agent.

import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { openVerifier, ROOT } from './harness.mjs';
import { serveHttp, sitesFor, LIMITS } from './mcp.mjs';
import { MODEL } from '../../agent-host/src/runner.js';

const HERE = path.join(ROOT, 'scripts/verify-adapters');
const SPECS = path.join(ROOT, 'tools/test/verify');
const CORE_SPECS = path.join(ROOT, 'tools/test/verify-core');
// Helpers of agent-watch.js, verified through it; not adapters of their own.
const NOT_ADAPTERS = new Set(['index', '_primitives', 'agent-watch-shapes', 'agent-watch-surfaces']);

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : fallback; };
const mode = argv.includes('--agent') ? 'agent' : argv.includes('--replay') ? 'replay' : null;
if (mode === 'agent' && !argv.includes('--sandboxed')) { console.error('Run the agents in the verify container on the agent host VM (see Dockerfile), with --sandboxed.'); process.exit(2); }
const parallel = Number(flag('--parallel', 4));
const create = argv.includes('--create');
const core = create || argv.includes('--core');
const reviewBase = flag('--review', null);
const model = flag('--model', MODEL);
const logs = path.resolve(flag('--logs', path.join(ROOT, '.verify-logs')));
const skills = flag('--skills', '').split(',').filter(Boolean);
const names = argv.filter(a => !a.startsWith('--'));

if (mode === 'replay') await replay();
else if (mode === 'agent') await agents();
else { console.error('Usage: run.mjs --replay [name ...] | --agent [name ...] [--parallel N] [--logs DIR] [--skills DIR,...]'); process.exit(2); }

async function replay() {
  // --core: the core adapters' specs (tools/test/verify-core/); otherwise the catalog's.
  const dir = argv.includes('--core') ? CORE_SPECS : SPECS;
  const specs = (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
    .filter(n => !names.length || names.some(x => n === x || n.startsWith(`${x}-`)));
  const v = await openVerifier();
  let failed = 0, skipped = 0;
  const runs = [];
  for (const name of specs) {
    const spec = JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    if (spec.sites) for (const site of sitesFor(spec.file)) runs.push([`${name} @ ${site.name}`, { ...spec, page: site.url, checks: spec.checks || [] }, true, spec.known?.[site.name]]);
    else runs.push([name, spec, false]);
  }
  let known = 0;
  for (const [name, spec, live, knownWhy] of runs) {
    let r;
    try { r = await v.verify(spec); } catch (e) { r = { status: live ? 'unreachable' : 'failed', message: e.message.slice(0, 200) }; }
    const problems = [];
    // On a live page, skipping (nothing to do there) is fine, and a page that does not load is reported, not failed.
    const fine = live ? ['applied', 'skipped', 'unreachable'] : ['applied'];
    if (!fine.includes(r.status)) problems.push(`${r.status}${r.message ? `: ${r.message}` : ''}`);
    else if (r.status === 'unreachable') { skipped++; console.log(`SKIP: ${name} (${r.message})`); }
    if (r.leftovers?.length && spec.restores !== false) problems.push(`disable() leaves ${r.leftovers.join(' ')}`);
    const bad = (r.checks || []).map((c, i) => (!c.after ? spec.checks[i]?.name : null)).filter(Boolean);
    if (bad.length) problems.push(`checks fail: ${bad.join('; ')}`);
    if (r.axe?.error) problems.push(`axe-core: ${r.axe.error}`);
    for (const rule of r.axe?.added || []) problems.push(`adds ${rule.id} (WCAG ${rule.wcag.join(', ') || '-'}) on ${rule.count}`);
    // A live page changes by itself (Mars's carousel), so an inexact restore there is a warning; leftover marks are not.
    if (r.status === 'applied' && r.restored === false && spec.restores !== false) {
      if (live) console.log(`WARN: ${name}: the page is not exactly as before after disable() (it may have changed by itself)`);
      else problems.push('disable() does not restore the page');
    }
    if (r.errors?.length) problems.push(`errors: ${r.errors.join(' | ').slice(0, 300)}`);
    if (r.zoomLeft !== undefined) problems.push(`disable() leaves the zoom at ${r.zoomLeft}`);
    if (r.status === 'skipped' && r.restored === false) problems.push('enable() returned false but left changes in the page');
    if (r.enableMs > LIMITS.enableMs) problems.push(`enable() took ${r.enableMs} ms`);
    if (live && r.aiCalls > LIMITS.aiCalls) problems.push(`${r.aiCalls} AI calls on load`);
    if (r.dwell?.announced.length > LIMITS.dwellAnnounced) problems.push(`said ${r.dwell.announced.length} things while a person only scrolled: ${r.dwell.announced.slice(0, 4).map(a => JSON.stringify(a)).join(', ')}`);
    if (problems.length && knownWhy) { known++; console.log(`KNOWN: ${name}: ${problems.join('; ')}\n  why: ${knownWhy}`); continue; }
    if (problems.length) failed++;
    if (r.status === 'unreachable') continue;
    console.log(`${problems.length ? 'FAIL' : 'PASS'}: ${name}${r.status === 'applied' ? ` (shift ${r.shift ?? '-'})` : ''}${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  }
  await v.close();
  console.log(`\n${runs.length - failed - skipped - known} passed, ${failed} failed, ${known} known, ${skipped} skipped (site unreachable)`);
  process.exit(failed ? 1 : 0);
}

/** One core adapter's task: its brief, for CREATE.md. */
function createTask(b) {
  if (!b) throw new Error('No such brief in core-adapters.json.');
  return [
    `Build the core adapter "${b.name}" as tools/core-adapters/${b.id}.js, on the toolkit's building blocks, and verify it, as your instructions say.`,
    '', `What it does: ${b.brief}`,
    '', `Suggested in onboarding for: ${b.suggestedFor.join(', ')} (a suggestion only, never a gate).`,
    `The person's settings it reads: ${b.reads.length ? b.reads.join(', ') : 'none'}.`,
    `What the person can adjust: ${b.adjusts}`,
    `Prior work to learn from: ${b.priorWork.map(f => `tools/adapters/${f}`).join(', ')}.`,
    '', 'What must be verified:', ...b.verify.map(v => `- ${v}`),
    '', `Name your specs ${b.id} (and ${b.id}-<variant>), and your test page tools/test/verify-core/pages/${b.id}.html.`,
  ].join('\n');
}

async function agents() {
  if (!process.env.GEMINI_API_KEY) { console.error('Set GEMINI_API_KEY.'); process.exit(2); }
  const briefs = new Map(JSON.parse(readFileSync(path.join(HERE, 'core-adapters.json'), 'utf8')).adapters.map(b => [b.id, b]));
  const folder = core ? 'tools/core-adapters' : 'tools/adapters';
  const all = create ? [...briefs.keys()] : readdirSync(path.join(ROOT, folder)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(n => !NOT_ADAPTERS.has(n));
  const changed = reviewBase ? new Set(execFileSync('git', ['diff', '--name-only', reviewBase, 'HEAD', '--', folder], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(f => path.basename(f, '.js')).filter(Boolean)) : null;
  const queue = names.length ? names : changed ? all.filter(n => changed.has(n)) : all;
  mkdirSync(logs, { recursive: true });
  const config = path.join(logs, 'opencode.json');
  const token = randomBytes(24).toString('hex');
  const mcpServer = await serveHttp({ token });
  writeFileSync(config, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model,
    provider: { google: { options: { apiKey: '{env:GEMINI_API_KEY}' } } },
    mcp: { verifier: { type: 'remote', url: mcpServer.url, headers: { authorization: `Bearer ${token}` }, oauth: false, codemode: false } },
    permissions: ['webfetch', 'websearch', 'task', 'question'].map(action => ({ action, resource: '*', effect: 'deny' })),
    instructions: [path.join(HERE, reviewBase ? (core ? 'REVIEW-CORE.md' : 'REVIEW.md') : create ? 'CREATE.md' : 'AGENTS.md')],
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
    const pages = core ? 'tools/test/verify-core/pages' : 'tools/test/verify/pages';
    const task = reviewBase
      ? (core ? `Review the core adapter tools/core-adapters/${name}.js, as your instructions say. Name any specs review-${name} and any page ${pages}/review-${name}.html.`
        : `Review the changes to the built-in adapter ${folder}/${name}.js since commit ${reviewBase}, as your instructions say. Name any specs review-${name} and any page ${pages}/review-${name}.html.`)
      : create ? createTask(briefs.get(name))
      : `Verify the built-in adapter tools/adapters/${name}.js with the verifiers, and fix what fails in it, as your instructions say. Name your specs ${name} (and ${name}-<variant>), and your test page tools/test/verify/pages/${name}.html.`;
    const child = spawn('opencode', ['run', '--standalone', '--auto', '--format', 'json', '--title', `${reviewBase ? 'review' : create ? 'create' : 'verify'} ${name}`, task], {
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
    results[name] = (/^(?:Outcome|Verdict):\s*([a-z-]+)/m.exec(report) || [, 'no-report'])[1];
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
