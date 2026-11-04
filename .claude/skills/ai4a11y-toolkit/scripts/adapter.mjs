#!/usr/bin/env node
// Publish an adapter to your toolkit and run it in your browser, or see how
// it ran. Part of the ai4a11y-toolkit skill: a coding agent runs it for you.
// Node 18 or later, nothing to install.
//
//   node adapter.mjs publish bigger-buttons.js \
//     --name "Bigger buttons" --runs-on "https://example.com/*" --for motor \
//     --about "Makes small buttons 44 pixels tall, for people who find small targets hard to hit."
//   node adapter.mjs status bigger-buttons
//   node adapter.mjs share bigger-buttons
//   node adapter.mjs extension
//   node adapter.mjs check
//   node adapter.mjs check bigger-buttons [--review]
//   node adapter.mjs profile
//   node adapter.mjs learned
//   node adapter.mjs answer prop_123 accept
//   node adapter.mjs review bigger-buttons.js --asked "…" --runs-on "https://example.com/*"
//   node adapter.mjs findings bigger-buttons.review-1.md --round 1
//
// publish   saves a new revision (private to your account) and installs it
//           into browser-runtime, so the adapter runtime extension runs it on
//           the pages it targets. --share shares it, --no-run skips the install,
//           --visibility adapter keeps what it gives the toolkit to itself.
// status    what the extension reported: running, or failed with the error.
// share     shares an adapter with everyone on this toolkit (--stop to stop).
// extension helps set up the adapter runtime extension: finds its folder (or
//           says how to get it), opens Chrome's extensions page and copies the
//           folder's path (--no-open only prints them; --dir names the folder).
// check     whether a browser runtime is connected to this toolkit.
//           With an adapter's id: asks the toolkit to check the adapter's
//           current revision on the server (the verification protocol's
//           automated steps, on its test pages and recorded copies of real
//           sites, in a sandbox), waits, and prints what passed, what failed
//           and why, and the advice. --review also has an independent
//           reviewer (a model) read and try it with WCAG rubrics. Only when
//           asked. It waits up to 9 minutes (--wait N); run it again to keep
//           waiting: while that check is still running it waits for it, and
//           once it has finished, asking again runs a new check.
// profile   the person's profile as apps read it (supportAreas, fields.needs, …).
// learned   what the toolkit learned about the person: suggested profile
//           changes waiting for an answer, and memories.
// answer    passes on the person's answer to a suggestion: accept, not-now
//           or never. Only ever their answer.
// review    prints the prompt for an independent reviewer of an adapter (a
//           new agent that did not write it): the reviewer's instructions,
//           the file, what the person asked (--asked) and where it runs
//           (--runs-on); from round 2, the earlier report and what was done
//           (--round 2 --earlier <report>) with the diff of the fixes since
//           the last review, and how to run it with the building blocks
//           (the extension's vendor/blocks.js; --dir names the extension
//           folder). It keeps a copy of the file as reviewed in
//           .adapter-reviews/ beside it, for that diff. From round 2 it
//           needs a Done: and a Rule: line under each high and medium
//           finding of the earlier report. See reference/review-and-fix.md.
// findings  counts a reviewer's report and says what to do next. One round
//           (a review, then the fixes) unless the person chose more
//           (--rounds N, at most 3): after the last round you fix, stop, and
//           ask them whether they want another.
//
// review and findings work on this computer only and need no toolkit.
//
// It reads TOOLKIT_URL and TOOLKIT_TOKEN (or the older TOOLKIT_SERVER_URL and
// TOOLKIT_SERVER_TOKEN) from a .env file in the current
// folder or a folder above it (the developer console's New adapter guide
// gives the two lines). Variables already set in the environment win.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AREAS = ['vision', 'motor', 'hearing', 'cognitive', 'sensory', 'reading'];
const APP = { appId: 'agent', appName: 'Coding agent' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parse(argv) {
  const [command, ...args] = argv;
  // The target, if any, comes before the flags.
  const target = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  let rest = target === undefined ? args : args.slice(1);
  const flags = { runsOn: [], for: [] };
  // answer <id> <accept | not-now | never>
  if (command === 'answer' && rest[0] && !rest[0].startsWith('--')) { flags.answer = rest[0]; rest = rest.slice(1); }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => rest[++i] ?? fail(`${flag} needs a value.`);
    if (flag === '--name') flags.name = value();
    else if (flag === '--id') flags.id = value();
    else if (flag === '--about') flags.about = value();
    else if (flag === '--visibility') flags.visibility = value();
    else if (flag === '--runs-on') flags.runsOn.push(value());
    else if (flag === '--for') flags.for.push(...value().split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    else if (flag === '--app') flags.app = value();
    else if (flag === '--share') flags.share = true;
    else if (flag === '--stop') flags.stop = true;
    else if (flag === '--no-run') flags.noRun = true;
    else if (flag === '--no-open') flags.noOpen = true;
    else if (flag === '--dir') flags.dir = value();
    else if (flag === '--asked') flags.asked = value();
    else if (flag === '--round') flags.round = Number(value());
    else if (flag === '--rounds') flags.rounds = Number(value());
    else if (flag === '--earlier') flags.earlier = value();
    else if (flag === '--review') flags.review = true;
    else if (flag === '--wait') flags.wait = Number(value());
    else fail(`Unknown option ${flag}.`);
  }
  return { command, target, flags };
}

// KEY=value lines, # comments, optional quotes. Only the toolkit keys:
// TOOLKIT_URL and TOOLKIT_TOKEN, or the older TOOLKIT_SERVER_URL and
// TOOLKIT_SERVER_TOKEN.
function loadDotEnv() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?(TOOLKIT_URL|TOOLKIT_TOKEN|TOOLKIT_SERVER_URL|TOOLKIT_SERVER_TOKEN)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}
loadDotEnv();

const base = (process.env.TOOLKIT_URL || process.env.TOOLKIT_SERVER_URL || '').replace(/\/+$/, '');
const token = process.env.TOOLKIT_TOKEN || process.env.TOOLKIT_SERVER_TOKEN || '';

let nextId = 1;
async function tool(name, args) {
  let res;
  try {
    res = await fetch(`${base}/v1/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
    });
  } catch (e) {
    fail(`Could not reach the toolkit at ${base}: ${e.message}`);
  }
  if (res.status === 401) fail('The toolkit did not accept the token. Copy the two lines into .env again from the developer console (Adapters, New adapter).');
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.result) fail(`The toolkit answered ${res.status}: ${body?.error?.message || body?.message || 'no details'}`);
  const result = body.result.structuredContent ?? {};
  if (body.result.isError) {
    const details = (result.errors || []).slice(0, 8).map(e => `  - ${e.path ? `${e.path}: ` : ''}${e.message}`).join('\n');
    fail(`${result.message || 'The toolkit refused it.'}${details ? `\n${details}` : ''}`);
  }
  return result;
}

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

async function publish(file, flags) {
  if (!file) fail('Say which file to publish: node adapter.mjs publish my-adapter.js --name … --runs-on …');
  let code;
  try { code = readFileSync(file, 'utf8'); } catch { fail(`Could not read ${file}.`); }
  const name = flags.name || fail('Give the adapter a name: --name "Bigger buttons"');
  if (!flags.runsOn.length) fail('Say which pages it runs on: --runs-on "https://example.com/*" (repeat for more).');
  if (flags.visibility && !['user', 'app', 'adapter'].includes(flags.visibility)) fail('--visibility takes user, app or adapter.');
  const unknown = flags.for.filter(a => !AREAS.includes(a));
  if (unknown.length) fail(`--for takes ${AREAS.join(', ')}. Not: ${unknown.join(', ')}.`);
  const id = flags.id || slug(path.basename(file, path.extname(file))) || slug(name);
  const appId = flags.app || APP.appId;
  const descriptor = {
    appId, id, name, description: flags.about || '',
    targets: [{ platforms: ['*'], urls: flags.runsOn }],
    supportAreas: flags.for,
    ...(flags.visibility ? { visibility: flags.visibility } : {}),
  };
  const r = await tool('adapter_publish', {
    appName: flags.app ? flags.app : APP.appName, descriptor,
    package: { format: 'web-module@1', code }, ...(flags.share ? { shared: true } : {}),
  });
  if (!flags.noRun) await tool('adapter_install', { app: 'browser-runtime', adapter: { appId, id } });
  const lines = [
    r.unchanged ? `${name} has not changed since revision ${r.revision}.` : `Published ${name} (${appId}/${id}), revision ${r.revision}.`,
    r.shared ? 'Shared: everyone on this toolkit can find and install it.' : 'Private to your account. Share it with: node adapter.mjs share ' + id,
    flags.noRun ? 'Not installed in your browser (--no-run).'
      : `Your browser runs it on ${flags.runsOn.join(', ')} within a few seconds, once the adapter runtime extension is connected.`,
    `See it in the developer console: ${base}/developer#/adapters`,
    `Check how it ran: node adapter.mjs status ${id}`,
  ];
  console.log(lines.join('\n'));
}

async function status(id, flags) {
  if (!id) fail('Say which adapter: node adapter.mjs status bigger-buttons');
  const appId = flags.app || APP.appId;
  const { results = [] } = await tool('adapter_status', { app: 'browser-runtime', adapter: { appId, id } });
  if (!results.length) {
    console.log(`No reports for ${appId}/${id} yet. Open a page it targets in Chrome with the adapter runtime extension connected, then try again.`);
    return;
  }
  for (const s of results) {
    const where = s.origin || 'a page';
    const line = s.status === 'failed' ? `Failed on ${where}: ${s.message || 'no message'}`
      : s.status === 'applied' ? `Running on ${where}` : `${s.status[0].toUpperCase()}${s.status.slice(1)} on ${where}${s.message ? `: ${s.message}` : ''}`;
    console.log(`${line} · revision ${s.revision ?? '?'}${s.label ? ` · ${s.label}` : ''}${s.at ? ` · ${s.at}` : ''}`);
  }
}

async function share(id, flags) {
  if (!id) fail('Say which adapter: node adapter.mjs share bigger-buttons');
  const appId = flags.app || APP.appId;
  const r = await tool('adapter_share', { adapter: { appId, id }, shared: !flags.stop });
  console.log(r.shared ? `${appId}/${id} is shared: everyone on this toolkit can find and install it.` : `${appId}/${id} is private again.`);
}

// The extension folder: --dir or AI4A11Y_EXTENSION_DIR, the toolkit repository
// this skill sits in (<repo>/.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs),
// or a toolkit checkout in the current folder or a folder above it.
const TOOLKIT_REPO = 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git';
function findExtensionDir(flags) {
  const places = [flags.dir, process.env.AI4A11Y_EXTENSION_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../extension')];
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    places.push(path.join(dir, 'extension'), path.join(dir, 'AI-for-Accessibility-Toolkit', 'extension'));
    if (path.dirname(dir) === dir) break;
  }
  return places.filter(Boolean).map(p => path.resolve(p)).find((dir) => {
    try { return /adapter runtime/i.test(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).name); } catch { return false; }
  });
}

// Best effort: a person can always copy the path and type the address.
function copyToClipboard(text) {
  const tools = process.platform === 'darwin' ? [['pbcopy']] : process.platform === 'win32' ? [['clip']] : [['wl-copy'], ['xclip', '-selection', 'clipboard']];
  return tools.some(([cmd, ...args]) => spawnSync(cmd, args, { input: text }).status === 0);
}
function openChromeExtensions() {
  const url = 'chrome://extensions';
  const [cmd, args] = process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'chrome', url]] : ['google-chrome', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

function extension(_target, flags) {
  const folder = findExtensionDir(flags);
  if (!folder) {
    fail([
      'The extension is not on this computer yet. It is the extension folder of the toolkit repository:',
      `  git clone ${TOOLKIT_REPO}`,
      'Then run this again from that folder, or with --dir <the cloned folder>/extension.',
    ].join('\n'));
  }
  const copied = !flags.noOpen && copyToClipboard(folder);
  const opened = !flags.noOpen && openChromeExtensions();
  console.log([
    `The extension folder: ${folder}${copied ? ' (copied)' : ''}`,
    opened ? 'Opened chrome://extensions in Chrome.' : 'Open chrome://extensions in Chrome (type it in the address bar).',
    'Then, in Chrome (Chrome 135 or later):',
    '1. Turn on Developer mode (top right).',
    `2. Choose Load unpacked and pick the extension folder.${copied ? ' On a Mac, press Cmd+Shift+G in the folder picker and paste.' : ''}`,
    '3. On the extension\'s Details, turn on Allow User Scripts.',
    '4. Sign in to the developer console, open the extension from the toolbar (the puzzle piece) and choose Connect with this console.',
    'Check it: node adapter.mjs check',
  ].join('\n'));
}

const ago = iso => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129600 ? `${Math.round(s / 3600)} hours ago` : `${Math.round(s / 86400)} days ago`;
};

async function check(id, flags) {
  if (id) return serverCheck(id, flags);
  const { instances = [] } = await tool('adapter_status', { app: 'browser-runtime' });
  if (!instances.length) {
    console.log([
      'No browser runtime is connected to this toolkit yet.',
      'Set up the extension (node adapter.mjs extension), then in Chrome open the extension and choose Connect with this console.',
    ].join('\n'));
    process.exit(1);
  }
  for (const i of instances) console.log(`Connected: ${i.label || 'a browser'}, last seen ${ago(i.lastSeenAt)}.`);
  console.log('If an adapter does not run, check that Allow User Scripts is on in the extension\'s Details.');
}

// ── a check on the server ───────────────────────────────────────────────────

async function api(method, p, body) {
  let res;
  try {
    res = await fetch(`${base}${p}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { fail(`Could not reach the toolkit at ${base}: ${e.message}`); }
  if (res.status === 401) fail('The toolkit did not accept the token. Copy the two lines into .env again from the developer console (Adapters, New adapter).');
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FINAL = ['done', 'failed'];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function progress(c) {
  if (c.status === 'queued') return c.position > 1 ? `Waiting: ${plural(c.position - 1, 'check')} ahead of it.` : 'Waiting to start.';
  if (c.status === 'running') return c.review ? 'Running: the automated checks, then the review.' : 'Running the automated checks.';
  return '';
}

/** One line per problem, with the pages it happened on. */
function grouped(runs, field) {
  const by = new Map();
  for (const r of runs) for (const p of r[field] || []) by.set(p, [...(by.get(p) || []), r.name]);
  return [...by].map(([p, pages]) => `- ${p}, on ${pages.slice(0, 4).join(', ')}${pages.length > 4 ? ` and ${pages.length - 4} more` : ''}`);
}

function printCheck(c, framing) {
  const name = `“${c.name}” (${c.adapter.owner}/${c.adapter.appId}/${c.adapter.id}), revision ${c.revision}`;
  const out = [];
  if (c.status === 'failed') {
    out.push(`The server check of ${name} could not run: ${c.error || 'no reason given'}`);
  } else {
    const check = c.result?.check || {};
    const s = check.summary || {};
    const runs = check.runs || [];
    out.push(`Server check of ${name}: done.`, '',
      'The automated checks (the verification protocol\'s steps 2 to 8, no model): on the toolkit\'s test pages, each also on a narrow screen and with reduced motion, and on recorded copies of real sites.',
      `${s.passed ?? 0} passed, ${s.failed ?? 0} failed, ${s.skipped ?? 0} skipped (no copy of that page on the server). It applied on ${s.appliedOnTestPages ?? 0} of ${s.testPages ?? 0} test pages; on the others enable() returned false, which is fine where the page has nothing for it.`);
    const failing = runs.filter(r => r.status === 'fail');
    if (failing.length) out.push('', 'What failed, and why:', ...grouped(failing, 'problems').slice(0, 25));
    else out.push('', 'Nothing failed.');
    const advice = grouped(runs, 'advice');
    if (advice.length) out.push('', 'Advice (axe-core best practices and AAA rules; not counted as failures):', ...advice.slice(0, 15));
    const notes = (check.notes || []).filter(n => !/only the people who use it can/.test(n));
    if (notes.length) out.push('', ...notes.map(n => `Note: ${n}`));
    const rv = c.result?.review;
    if (c.review && !rv) out.push('', 'The review did not run.');
    if (rv?.error) out.push('', `The review could not finish: ${rv.error}`);
    else if (rv) {
      const f = c.findings || {};
      out.push('', `The independent review: ${rv.verdict === 'ok' ? 'no problems found' : rv.verdict === 'issues' ? `issues (${f.high ?? 0} high, ${f.medium ?? 0} medium, ${f.low ?? 0} low)` : 'no verdict'}. A model that did not write the adapter read it and tried it${rv.rubricsRead?.length ? `, with InterA11y's rubrics for WCAG ${rv.rubricsRead.join(', ')}` : ''}. Check each finding yourself before you act on it.`,
        '', rv.report.trim());
    } else if (!c.review) out.push('', `For an independent review as well: node adapter.mjs check ${c.adapter.id} --review`);
  }
  out.push('', `What this means: ${framing}`);
  console.log(out.join('\n'));
}

async function serverCheck(id, flags) {
  const name = flags.app && !id.includes('/') ? `${flags.app}/${id}` : id;
  const asked = await api('POST', '/v1/adapters/checks', { id: name, review: !!flags.review });
  if (![200, 202].includes(asked.status)) fail(asked.body.message || `The toolkit answered ${asked.status}.`);
  let c = asked.body.check;
  const framing = asked.body.framing || '';
  console.log(asked.body.reused
    ? `A check of revision ${c.revision} of ${c.name}${c.review ? ', with a review,' : ''} is already waiting or running: waiting for that one rather than starting another.`
    : `Asked the toolkit to check revision ${c.revision} of ${c.name}${c.review ? ', with an independent review' : ''}. A check takes a few minutes${c.review ? ', a review up to half an hour' : ''}.`);
  const until = Date.now() + (Number.isFinite(flags.wait) ? flags.wait : 9) * 60_000;
  let said = '';
  while (!FINAL.includes(c.status)) {
    const line = progress(c);
    if (line && line !== said) { console.log(line); said = line; }
    if (Date.now() >= until) {
      console.log(`Not finished yet. Run the same command again to keep waiting (node adapter.mjs check ${id}${flags.review ? ' --review' : ''}): while this check is running it waits for it rather than starting another.`);
      return;
    }
    await sleep(Number(process.env.AI4A11Y_CHECK_POLL_MS) || 10_000);
    const got = await api('GET', `/v1/adapters/checks/${c.checkId}`);
    if (got.status !== 200) fail(got.body.message || `The toolkit answered ${got.status}.`);
    c = got.body.check;
  }
  printCheck(c, framing);
}

async function learned() {
  const s = await tool('profile_learned', {});
  console.log(`${s.paused ? 'Learning is paused.' : 'Learning is on.'} ${s.proposalsThisWeek} of ${s.proposalsPerWeek} suggestions this week.${s.pendingObservations ? ` ${s.pendingObservations} observations to learn from.` : ''}`);
  console.log(s.proposals.length ? '\nSuggested changes (ask the person, then: node adapter.mjs answer <id> accept | not-now | never):' : '\nNo suggestions waiting.');
  for (const p of s.proposals) {
    const c = p.change || {};
    const what = c.op === 'profile-set' ? `set ${c.path.replace(/^fields\./, '')} to ${JSON.stringify(c.value)}` : c.op || '';
    console.log(`- ${p.id}: ${p.label}${what ? ` (${what})` : ''}${p.rationale ? `. ${p.rationale}` : ''}`);
  }
  console.log(s.memories.length ? '\nWhat it remembers:' : '\nNothing learned yet.');
  for (const m of s.memories) {
    const only = m.visibility && m.visibility !== 'user' ? ` [only ${m.name || m.adapter || m.app}]` : '';
    console.log(`- ${m.text}${m.kind === 'note' ? ' (their note)' : m.scope && m.scope !== 'general' ? ` (${m.scope})` : ''}${only}`);
  }
}

// The person's profile, as apps read it: what to turn adaptations on from.
async function profile() {
  const { profile: p } = await tool('profile_get', {});
  console.log(JSON.stringify({ supportAreas: p.supportAreas, fields: p.fields || {}, metaPreferences: p.metaPreferences }, null, 2));
}

const ANSWERS = { accept: 'accept', 'not-now': 'declineOnce', never: 'suppress' };
async function answer(id, flags) {
  const response = ANSWERS[flags.answer];
  if (!id || !response) fail('Use: node adapter.mjs answer <suggestion id> accept | not-now | never (the person\'s answer).');
  const r = await tool('profile_proposal_respond', { id, response });
  if (r.ok === false) fail(`Could not answer it: ${r.reason}.`);
  console.log(response === 'accept' ? 'Accepted. The profile changed, and the apps following it pick it up.' : response === 'suppress' ? 'The toolkit stops suggesting this.' : 'Not now.');
}

// One round of review and fix unless the person chooses more (--rounds),
// and never more than MAX_ROUNDS.
const MAX_ROUNDS = 3;
const roundsChosen = (flags) => Math.max(1, Math.min(MAX_ROUNDS, Number(flags.rounds) || 1));

// The copy of an adapter as it was reviewed in a round, for the next
// round's diff.
const reviewedCopy = (file, round) => path.join(path.dirname(path.resolve(file)), '.adapter-reviews', `${path.basename(file, path.extname(file))}.round-${round}${path.extname(file)}`);

// Under each high and medium finding of a fixed report: what was done
// (Done:), and which rule the fix added, narrowed or removed (Rule:); an
// added rule names a page it would go wrong on (Breaks on:).
function unanswered(text) {
  const entries = text.split(/^(?=\[(?:high|medium|low)\])/mi).filter((e) => /^\[(high|medium)\]/i.test(e));
  const missing = [];
  for (const e of entries) {
    const head = e.split('\n')[0].slice(0, 100);
    const rule = (/^\s*Rule:\s*(added|narrowed|removed|none)\b/mi.exec(e) || [])[1];
    if (!/^\s*Done:/mi.test(e)) missing.push(`${head}: no Done: line`);
    else if (!rule) missing.push(`${head}: no Rule: added | narrowed | removed | none line`);
    else if (rule.toLowerCase() === 'added' && !/Breaks on:/i.test(e)) missing.push(`${head}: the rule it added names no page it would go wrong on (Breaks on:)`);
  }
  return missing;
}

// Lines that decide what something is from its name, class, id, words or
// text: a simple scan, for the reviewer to test first. Some are harmless
// (the adapter's own classes are left out).
const GUESS = [
  /\[(?:class|id|name|title|alt|src|href|aria-label)\s*[*^$|~]=/i,                        // [class*="slide"]
  /\.test\(\s*[\w.$]*(?:className|\.id\b|textContent|innerText|innerHTML|\.src\b|\.href\b|\.title\b|\.name\b|getAttribute\(\s*['"](?:class|id|aria-label|title|name|alt|src|href)['"])/,
  /(?:className|\.id\b|textContent|innerText|getAttribute\(\s*['"](?:class|id|aria-label|title|name|alt|src|href)['"]\s*\))[\w.?()]*\.(?:match|includes|startsWith|endsWith|search)\(/,
  /classList\.contains\(/,
  /\/[^/\n]*(?:\\b|\|)[^/\n]*\/[gimsuy]*\.(?:test|exec)\(/,                                     // /\b(play|pause)\b/i.test(name)
  /\b[A-Z][A-Z0-9_]*(?:_RE|_REGEX|_HINTS?|_WORDS|_PATTERNS?)\s*=/,                               // ICON_RE = …, NAV_HINT = …
];
function guessLines(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    if (/ai4a11y/i.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
    // A test of a tag, type, role or key is what the page says, not a guess.
    const said = line.replace(/\/[^/\n]*\/[gimsuy]*\.(?:test|exec)\(\s*[\w.?]*(?:tag|tagName|type|nodeName|localName|role|key)\b[^)]*\)/g, '');
    if (GUESS.some((re) => re.test(said))) out.push(`${i + 1}: ${line.trim().slice(0, 140)}`);
  });
  return out;
}

// The fixes since the last review, as a unified diff; '' when none or when
// neither git nor diff is here.
function fixesSince(before, file) {
  const cwd = path.dirname(file);
  const [a, b] = [path.relative(cwd, before), path.basename(file)];
  for (const [cmd, args] of [['git', ['diff', '--no-index', '--no-color', '-U3', a, b]], ['diff', ['-u', a, b]]]) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', cwd });
    if (r.error) continue;
    return r.stdout.trim();
  }
  return '';
}

function review(file, flags) {
  if (!file || !existsSync(file)) fail('Use: node adapter.mjs review <adapter.js> --asked "what the person asked" --runs-on <pattern> [--round N --earlier <report.md>]');
  if (!flags.asked) fail('--asked is needed: what the person said they need, in their words (and their answers to your questions).');
  const round = flags.round || 1;
  if (round > 1 && !flags.earlier) fail('From round 2, --earlier <report.md>: the last reviewer\'s report, with what you did about each finding written under it.');
  const earlier = round > 1 ? readFileSync(flags.earlier, 'utf8').trim() : '';
  const missing = unanswered(earlier);
  if (missing.length) fail(`In ${flags.earlier}, write under each high and medium finding what you did ("Done: …") and the rule your fix changed ("Rule: added | narrowed | removed | none — …"; for added, "Breaks on: <a page it would go wrong on> (tested or not)"), as reference/review-and-fix.md says. Missing:\n  ${missing.join('\n  ')}`);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const instructions = readFileSync(path.join(here, '..', 'reference', 'adapter-reviewer.md'), 'utf8')
    .split('\n').filter((l) => !/^Generated by /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const parts = [instructions, '', '## This review', '',
    `The adapter: ${path.resolve(file)}. Read the file itself.`,
    `What the person asked for: ${flags.asked}`,
    `Where it runs: ${flags.runsOn.length ? flags.runsOn.join(', ') : 'not given'}.`,
    `The skill folder (for reference/building-blocks.md): ${path.resolve(here, '..')}.`];
  // How to run it as the browser runtime does, with the building blocks.
  const ext = findExtensionDir(flags);
  const blocks = ext && path.join(ext, 'vendor', 'blocks.js');
  if (blocks && existsSync(blocks)) parts.push(`To run it as the browser runtime does: add ${blocks} to the page first (with Playwright, page.addScriptTag({ path })); then window.__ai4a11yBlocks.create({ adapter: 'review' }) is the toolkit argument to enable(options, toolkit). There every AI call answers null.`);
  else parts.push('The building blocks bundle (the extension\'s vendor/blocks.js) was not found here (--dir <the extension folder> names it): review a blocks adapter by reading it and reference/building-blocks.md.');
  const guesses = guessLines(readFileSync(file, 'utf8'));
  if (guesses.length) parts.push('', `Lines that may decide what something is from its name, class, id, words or text (a simple scan, so some are harmless): find a page where each goes wrong, first.`, ...guesses.slice(0, 40).map((l) => `  ${l}`), ...(guesses.length > 40 ? [`  … and ${guesses.length - 40} more.`] : []));
  parts.push('', `Round ${round} of ${Math.max(round, roundsChosen(flags))}.`);
  if (round > 1) {
    parts.push('', 'The earlier review, with what the author did about each finding:', '', earlier);
    const before = reviewedCopy(file, round - 1);
    const diff = existsSync(before) ? fixesSince(before, path.resolve(file)) : '';
    if (diff) parts.push('', 'The author\'s fixes since that review (check each rule this adds or changes first, on a page where it would go wrong):', '', '```diff', diff, '```');
    else if (!existsSync(before)) parts.push('', `The file as it was last reviewed is not here (${before}), so there is no diff of the fixes: read the whole file again.`);
  }
  // Keep this round's file as reviewed, for the next round's diff.
  const copy = reviewedCopy(file, round);
  mkdirSync(path.dirname(copy), { recursive: true });
  copyFileSync(file, copy);
  console.error(`Kept the file as reviewed in round ${round}: ${copy}`);
  console.log(parts.join('\n'));
}

function findings(file, flags) {
  if (!file || !existsSync(file)) fail('Use: node adapter.mjs findings <report.md> --round N [--rounds M]');
  const text = readFileSync(file, 'utf8');
  const verdict = (/^Verdict:\s*(ok|issues)/mi.exec(text) || [])[1];
  if (!verdict) fail(`${file} has no "Verdict: ok | issues" line: it is not a reviewer's report. Start the reviewer again with the prompt from "review".`);
  const count = (level) => (text.match(new RegExp(`^\\[${level}\\]`, 'gmi')) || []).length;
  const [high, medium, low] = ['high', 'medium', 'low'].map(count);
  const round = flags.round || 1;
  const rounds = Math.max(round, roundsChosen(flags));
  console.log(`Round ${round} of ${rounds}: ${high} high, ${medium} medium, ${low} low.`);
  const fix = `Fix in place: check each finding, find the cause (often a guess from a name, class or position), fix what is real, and write under each one in ${file} what you did ("Done: …") and the rule you changed ("Rule: added | narrowed | removed | none — …"; for added, "Breaks on: <a page>"). Publish again and check that it runs.`;
  if (!high && !medium) console.log(`Stop: nothing high or medium.${low ? ' Fix the low ones that are quick and clearly real, in place.' : ''} Tell the person what the review found, what you fixed and what is left.`);
  else if (round < rounds) console.log(`${fix} Then start a new reviewer with: review <adapter.js> --asked … --runs-on … --round ${round + 1} --rounds ${rounds} --earlier ${file}`);
  else if (round >= MAX_ROUNDS) console.log(`${fix} Then stop: ${MAX_ROUNDS} rounds is the most. Tell the person what you fixed and what is still open (each high and medium finding you could not fix).`);
  else console.log(`${fix} Then stop, and tell the person what the review found, what you fixed, and what may still be open. Ask whether they want another round (a new reviewer checks your fixes and looks again); only if they say yes: review <adapter.js> --asked … --runs-on … --round ${round + 1} --rounds ${round + 1} --earlier ${file}`);
}

const { command, target, flags } = parse(process.argv.slice(2));
const COMMANDS = { publish, status, share, extension, check, profile, learned, answer, review, findings };
if (!COMMANDS[command]) {
  fail('Use: node adapter.mjs publish <file.js> --name … --runs-on … | status <id> | share <id> | extension | check [<id> [--review]] | profile | learned | answer <id> accept|not-now|never | review <file.js> --asked … --runs-on … | findings <report.md> --round N [--rounds M]');
}
if (command === 'extension') { extension(target, flags); process.exit(0); }
if (command === 'review' || command === 'findings') { COMMANDS[command](target, flags); process.exit(0); }
if (!base || !token) fail('No toolkit address or token. Ask the person which toolkit to use: their hosted one (in its developer console, Adapters, New adapter, copy the two lines into .env at the top of this repository), or one started on this computer.');
await COMMANDS[command](target, flags);
