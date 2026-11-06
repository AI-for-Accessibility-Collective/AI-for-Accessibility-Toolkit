#!/usr/bin/env node
// One check on Cloud Run (agent-host/src/burst.js): fetch this check's files
// from the agent host with the token it was started with, run run.mjs
// --check offline on the site copies baked into the image (/sites), and send
// the report back. The only network it has is the host's API port.
//
//   JOB_URL    http://<host>:8791/burst/<id>
//   JOB_TOKEN  good for this check only, while it runs
//   JOB_FILE   the adapter's file name; JOB_SPEC check.json, if there is one
//   CLOUD_RUN_TASK_INDEX / CLOUD_RUN_TASK_COUNT  (Cloud Run's) this task's slice
//              of the check's runs: a task has at most 8 CPUs, so a check
//              runs as several tasks at once, and the host merges the slices

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { JOB_URL, JOB_TOKEN, JOB_FILE } = process.env;
const JOB_SPEC = process.env.JOB_SPEC || '';
const RUN = process.env.BURST_RUN_SCRIPT || path.join(here, 'run.mjs');
const JOB = process.env.BURST_JOB_DIR || '/tmp/job';
const headers = { authorization: `Bearer ${JOB_TOKEN}` };
const TASK = Number(process.env.CLOUD_RUN_TASK_INDEX) || 0;
const TASKS = Number(process.env.CLOUD_RUN_TASK_COUNT) || 1;

async function get(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`the host answered ${r.status} for ${url.slice(JOB_URL.length) || '/'}`);
  return r;
}
async function report(body) {
  await fetch(`${JOB_URL}/report/${TASK}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

try {
  const list = await (await get(JOB_URL)).json();
  for (const f of list.files) {
    if (f.split('/').includes('..')) continue;
    mkdirSync(path.dirname(path.join(JOB, f)), { recursive: true });
    writeFileSync(path.join(JOB, f), Buffer.from(await (await get(`${JOB_URL}/files/${encodeURIComponent(f)}`)).arrayBuffer()));
  }
  const out = path.join(JOB, 'report.json');
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN, '--check', path.join(JOB, JOB_FILE), ...(JOB_SPEC ? ['--spec', path.join(JOB, JOB_SPEC)] : []),
      ...(TASKS > 1 ? ['--shard', `${TASK}/${TASKS}`] : []), '--out', out],
      { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, JOB_TOKEN: '', VERIFY_SITES: 'offline', VERIFY_SITE_CACHE: process.env.VERIFY_SITE_CACHE || '/sites' } });
    child.on('close', resolve);
    child.on('error', () => resolve(-1));
  });
  // run.mjs exits 1 when a run fails; no report is what counts as not finishing.
  if (!existsSync(out)) throw new Error(`run.mjs wrote no report (exit ${code})`);
  await report(JSON.parse(readFileSync(out, 'utf8')));
} catch (e) {
  console.error(`burst check: ${e.message}`);
  process.exit(1);
}
