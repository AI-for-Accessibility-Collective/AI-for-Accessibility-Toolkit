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
//
// publish   saves a new revision (private to your account) and installs it
//           into browser-runtime, so the adapter runtime extension runs it on
//           the pages it targets. --share shares it, --no-run skips the install.
// status    what the extension reported: running, or failed with the error.
// share     shares an adapter with everyone on this toolkit (--stop to stop).
//
// It reads TOOLKIT_URL and TOOLKIT_TOKEN from a .env file in the current
// folder or a folder above it (the developer console's New adapter guide
// gives the two lines). Variables already set in the environment win.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const AREAS = ['vision', 'motor', 'hearing', 'cognitive', 'sensory', 'reading'];
const APP = { appId: 'agent', appName: 'Coding agent' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parse(argv) {
  const [command, target, ...rest] = argv;
  const flags = { runsOn: [], for: [] };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => rest[++i] ?? fail(`${flag} needs a value.`);
    if (flag === '--name') flags.name = value();
    else if (flag === '--id') flags.id = value();
    else if (flag === '--about') flags.about = value();
    else if (flag === '--runs-on') flags.runsOn.push(value());
    else if (flag === '--for') flags.for.push(...value().split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    else if (flag === '--app') flags.app = value();
    else if (flag === '--share') flags.share = true;
    else if (flag === '--stop') flags.stop = true;
    else if (flag === '--no-run') flags.noRun = true;
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
  const unknown = flags.for.filter(a => !AREAS.includes(a));
  if (unknown.length) fail(`--for takes ${AREAS.join(', ')}. Not: ${unknown.join(', ')}.`);
  const id = flags.id || slug(path.basename(file, path.extname(file))) || slug(name);
  const appId = flags.app || APP.appId;
  const descriptor = {
    appId, id, name, description: flags.about || '',
    targets: [{ platforms: ['*'], urls: flags.runsOn }],
    supportAreas: flags.for,
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

const { command, target, flags } = parse(process.argv.slice(2));
if (!['publish', 'status', 'share'].includes(command)) {
  fail('Use: node adapter.mjs publish <file.js> --name … --runs-on … | status <id> | share <id>');
}
if (!base || !token) fail('No toolkit address or token. In the developer console, open Adapters, choose New adapter, and copy the two lines into a .env file at the top of this repository.');
await ({ publish, status, share })[command](target, flags);
