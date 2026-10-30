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
//   node adapter.mjs learned
//   node adapter.mjs answer prop_123 accept
//
// publish   saves a new revision (private to your account) and installs it
//           into browser-runtime, so the adapter runtime extension runs it on
//           the pages it targets. --share shares it, --no-run skips the install,
//           --visibility adapter keeps what it gives the toolkit to itself.
// status    what the extension reported: running, or failed with the error.
// share     shares an adapter with everyone on this toolkit (--stop to stop).
// extension helps set up the adapter runtime extension: opens Chrome's
//           extensions page and copies the extension folder's path (--no-open
//           only prints them).
// check     whether a browser runtime is connected to this toolkit.
// learned   what the toolkit learned about the person: suggested profile
//           changes waiting for an answer, and memories.
// answer    passes on the person's answer to a suggestion: accept, not-now
//           or never. Only ever their answer.
//
// It reads TOOLKIT_URL and TOOLKIT_TOKEN from a .env file in the current
// folder or a folder above it (the developer console's New adapter guide
// gives the two lines). Variables already set in the environment win.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
    else fail(`Unknown option ${flag}.`);
  }
  return { command, target, flags };
}

// KEY=value lines, # comments, optional quotes. Only the two toolkit keys.
function loadDotEnv() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?(TOOLKIT_URL|TOOLKIT_TOKEN)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}
loadDotEnv();

const base = (process.env.TOOLKIT_URL || '').replace(/\/+$/, '');
const token = process.env.TOOLKIT_TOKEN || '';

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

// The extension folder of the toolkit repository this skill sits in
// (<repo>/.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs).
const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../extension');

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
  if (!existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    fail('The extension folder is not next to this skill. Use the extension folder of your toolkit repository checkout.');
  }
  const copied = !flags.noOpen && copyToClipboard(EXTENSION_DIR);
  const opened = !flags.noOpen && openChromeExtensions();
  console.log([
    `The extension folder: ${EXTENSION_DIR}${copied ? ' (copied)' : ''}`,
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

async function check() {
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
  for (const m of s.memories) console.log(`- ${m.text}${m.kind === 'note' ? ' (their note)' : m.scope && m.scope !== 'general' ? ` (${m.scope})` : ''}`);
}

const ANSWERS = { accept: 'accept', 'not-now': 'declineOnce', never: 'suppress' };
async function answer(id, flags) {
  const response = ANSWERS[flags.answer];
  if (!id || !response) fail('Use: node adapter.mjs answer <suggestion id> accept | not-now | never (the person\'s answer).');
  const r = await tool('profile_proposal_respond', { id, response });
  if (r.ok === false) fail(`Could not answer it: ${r.reason}.`);
  console.log(response === 'accept' ? 'Accepted. The profile changed, and the apps following it pick it up.' : response === 'suppress' ? 'The toolkit stops suggesting this.' : 'Not now.');
}

const { command, target, flags } = parse(process.argv.slice(2));
const COMMANDS = { publish, status, share, extension, check, learned, answer };
if (!COMMANDS[command]) {
  fail('Use: node adapter.mjs publish <file.js> --name … --runs-on … | status <id> | share <id> | extension | check | learned | answer <id> accept|not-now|never');
}
if (command === 'extension') { extension(target, flags); process.exit(0); }
if (!base || !token) fail('No toolkit address or token. Ask the person which toolkit to use: their hosted one (in its developer console, Adapters, New adapter, copy the two lines into .env at the top of this repository), or one started on this computer.');
await COMMANDS[command](target, flags);
