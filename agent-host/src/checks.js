// Server-side checks of a published adapter, asked for by a developer
// through the toolkit service (POST /v1/adapters/checks, which checks who
// may, and the daily quota, and sends the adapter's code here).
//
// One check at a time, in the order asked. Each is the verification
// protocol's automated steps 2 to 8 (scripts/verify-adapters/run.mjs
// --check) in a one-shot container from the verify image under gVisor,
// with no network at all: the adapter is written into it, the recorded
// copies of real sites are mounted read-only, and it is stopped after a
// timeout. With review, an independent reviewer then runs in a second
// one-shot container (run.mjs --review-file): opencode with Gemini, whose
// only network is the host's model proxy, with a token that names this
// job and is good for a limited number of model calls while it runs. The
// GenA11y rubric text it may read is fetched here first, into a folder
// mounted read-only (INTERA11Y_DIR), so the reviewer needs no internet.
//
// The developer's code never runs outside a container on the host, except
// with the local runner (AGENT_RUNNER=local), which is for development
// with your own adapters only, as for the sidebar.
//
//   <data>/checks/<checkId>/
//     job.json   who asked, the adapter (no code), status, and the result
//     in/        the adapter, what it is for, the check's report (read-only in the containers)
//     out/       the check's report.json (removed once read)
//     review/    the reviewer's report (removed once read)
// in/, out/ and review/ are removed when the job ends; job.json is kept for
// a week. Logged: who, which job, how long, how it came out; never code.

import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, chmodSync, statSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { MAX_PACKAGE_CODE } from '../../toolkit/protocol/adapter/package.js';
import { assertUid } from './accounts.js';

const CHECK_ID = /^chk_[a-f0-9]{16,40}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEEP_MS = 7 * 24 * 3600_000;
const MAX_REPORT = 4_000_000;
const MAX_REVIEW_TEXT = 40_000;

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

function readJson(file, max = MAX_REPORT) {
  try {
    if (statSync(file).size > max) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch { return null; }
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}
const minutes = (ms) => { const m = Math.max(1, Math.round(ms / 60_000)); return `${m} minute${m === 1 ? '' : 's'}`; };
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, n);

/** What the check's report keeps: its summary, notes and runs, each cut to size. */
function trimReport(r) {
  const runs = Array.isArray(r?.runs) ? r.runs.slice(0, 400) : [];
  return {
    at: clip(r?.at, 40),
    summary: r?.summary && typeof r.summary === 'object' ? Object.fromEntries(['passed', 'failed', 'skipped', 'appliedOnTestPages', 'testPages'].map((k) => [k, Number(r.summary[k]) || 0])) : null,
    notes: (Array.isArray(r?.notes) ? r.notes : []).slice(0, 10).map((n) => clip(n, 400)),
    runs: runs.map((x) => ({
      name: clip(x?.name, 200), status: ['pass', 'fail', 'skip'].includes(x?.status) ? x.status : 'fail', result: clip(x?.result, 40),
      problems: (Array.isArray(x?.problems) ? x.problems : []).slice(0, 20).map((p) => clip(p, 400)),
      ...(Array.isArray(x?.advice) && x.advice.length ? { advice: x.advice.slice(0, 20).map((a) => clip(a, 200)) } : {}),
    })),
  };
}

/** Run a command to the end or until its time is up: { code, timedOut, stderr }. */
function runProcess(cmd, args, { env, cwd, timeoutMs, onTimeout }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', timedOut = false;
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { timedOut = true; (onTimeout || (() => child.kill('SIGKILL')))(child); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, timedOut, stderr: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, timedOut, stderr }); });
  });
}

// Only what a tool needs from the host's environment: never its secrets.
function baseEnv(extra = {}) {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'DOCKER_HOST', 'PLAYWRIGHT_BROWSERS_PATH', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
  return { ...Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])), ...extra };
}

/**
 * On the VM: each step a one-shot container from the verify image (its
 * `check` target: the repository and its packages baked in), gVisor, no
 * capabilities, its own limits, removed when it ends.
 *   check   --network none
 *   review  the check network, which reaches the host's model proxy and nothing else (vm/setup.sh)
 */
export function dockerCheckRunner({ image, network = 'ai4a11y-chk', sitesDir, rubricsDir, modelUrl, runtime = 'runsc', cpus = '4', memory = '6g', pids = '2048', log }) {
  if (!image) throw new Error('AGENT_CHECK_IMAGE is needed for checks on the VM.');
  const name = (id, step) => `ai4a11y-check-${id}-${step}`;
  const limits = [`--runtime=${runtime}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    `--cpus=${cpus}`, `--memory=${memory}`, `--pids-limit=${pids}`, '--shm-size=1g', '--label', 'ai4a11y.check=1'];
  const stop = (id, step) => () => execFile('docker', ['rm', '-f', name(id, step)], () => {});

  return {
    kind: 'docker',
    check({ id, dir, file, timeoutMs }) {
      return runProcess('docker', ['run', '--rm', '--name', name(id, 'check'), ...limits, '--network', 'none',
        '-v', `${path.join(dir, 'in')}:/job:ro`, '-v', `${path.join(dir, 'out')}:/out`, '-v', `${sitesDir}:/sites:ro`,
        '-e', 'VERIFY_SITES=offline', '-e', 'VERIFY_SITE_CACHE=/sites',
        image, 'node', 'scripts/verify-adapters/run.mjs', '--check', `/job/${file}`, '--out', '/out/report.json'],
      { env: baseEnv(), timeoutMs, onTimeout: stop(id, 'check') });
    },
    review({ id, dir, file, token, timeoutMs }) {
      // The job's token reaches the container by name (-e GEMINI_API_KEY), never on the command line.
      return runProcess('docker', ['run', '--rm', '--name', name(id, 'review'), ...limits, '--network', network,
        '-v', `${path.join(dir, 'in')}:/job:ro`, '-v', `${path.join(dir, 'review')}:/review`, '-v', `${sitesDir}:/sites:ro`,
        '-v', `${rubricsDir}:/opt/intera11y:ro`,
        '-e', 'VERIFY_SITES=offline', '-e', 'VERIFY_SITE_CACHE=/sites', '-e', 'INTERA11Y_DIR=/opt/intera11y',
        '-e', 'GEMINI_API_KEY', '-e', `VERIFY_MODEL_BASE_URL=${modelUrl}`, '-e', `VERIFY_AGENT_TIMEOUT_MIN=${Math.max(1, Math.floor(timeoutMs / 60_000) - 1)}`,
        image, 'node', 'scripts/verify-adapters/run.mjs', '--agent', '--sandboxed', '--skills', '/opt/agent/skills',
        '--review-file', `/job/${file}`, '--about', '/job/about.txt', '--check-report', '/job/report.json', '--logs', '/review'],
      { env: baseEnv({ GEMINI_API_KEY: token }), timeoutMs, onTimeout: stop(id, 'review') });
    },
    /** Containers a host that stopped left behind. */
    cleanup() {
      return new Promise((resolve) => execFile('docker', ['ps', '-aq', '--filter', 'label=ai4a11y.check=1'], (err, out) => {
        const ids = err ? [] : String(out).split('\n').filter(Boolean);
        if (!ids.length) return resolve();
        log?.info('check.leftovers-removed', { count: ids.length });
        execFile('docker', ['rm', '-f', ...ids], () => resolve());
      }));
    },
  };
}

/**
 * For development: run.mjs as a plain process in this checkout. **No
 * sandbox**: the adapter runs in this computer's Chromium, and the reviewer
 * (opencode, with a shell) as you. Only with your own adapters.
 */
export function localCheckRunner({ repoDir, sitesDir, rubricsDir, modelUrl, opencodeBin = 'opencode', node = process.execPath, script }) {
  const run = script || path.join(repoDir, 'scripts/verify-adapters/run.mjs');
  const env = (extra) => baseEnv({ VERIFY_SITES: 'offline', VERIFY_SITE_CACHE: sitesDir, INTERA11Y_DIR: rubricsDir, ...extra });
  return {
    kind: 'local',
    check({ dir, file, timeoutMs }) {
      return runProcess(node, [run, '--check', path.join(dir, 'in', file), '--out', path.join(dir, 'out', 'report.json')], { cwd: repoDir, env: env(), timeoutMs });
    },
    review({ dir, file, token, timeoutMs }) {
      return runProcess(node, [run, '--agent', '--sandboxed', '--review-file', path.join(dir, 'in', file), '--about', path.join(dir, 'in', 'about.txt'),
        '--check-report', path.join(dir, 'in', 'report.json'), '--logs', path.join(dir, 'review')],
      { cwd: repoDir, env: env({ GEMINI_API_KEY: token, VERIFY_MODEL_BASE_URL: modelUrl, VERIFY_OPENCODE_BIN: opencodeBin, VERIFY_AGENT_TIMEOUT_MIN: String(Math.max(1, Math.floor(timeoutMs / 60_000) - 1)) }), timeoutMs });
    },
    cleanup: async () => {},
  };
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {object} o.runner          dockerCheckRunner or localCheckRunner (or a stand-in in tests)
 * @param {string} o.rubricsDir      where fetchRubrics keeps InterA11y's rubric files
 * @param {Function} [o.fetchRubrics] (dir) => { have, missing }
 */
export function createChecks({ dataDir, runner, rubricsDir, fetchRubrics = async () => ({ have: [], missing: [] }), log,
  checkTimeoutMs = 20 * 60_000, reviewTimeoutMs = 45 * 60_000, maxQueued = 20, perAccount = 2, reviewModelCalls = 400, now = () => Date.now() }) {
  const root = path.join(dataDir, 'checks');
  mkdirSync(root, { recursive: true });
  const queue = [];        // checkIds waiting
  let current = null;      // the checkId running
  let pumping = false;
  const tokens = new Map(); // job token -> { uid, checkId, calls }

  const dirOf = (id) => {
    if (!CHECK_ID.test(String(id))) throw httpError(400, 'bad-check-id', 'Not a check id.');
    return path.join(root, id);
  };
  const jobFile = (id) => path.join(dirOf(id), 'job.json');
  const readJob = (id) => readJson(jobFile(id));
  const saveJob = (job) => writeJson(jobFile(job.checkId), job);

  function position(id) {
    const i = queue.indexOf(id);
    return i < 0 ? null : i + 1 + (current ? 1 : 0);
  }

  function view(job) {
    return {
      checkId: job.checkId, status: job.status, review: job.review, adapter: job.adapter,
      submittedAt: job.submittedAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
      ...(job.status === 'queued' ? { position: position(job.checkId) } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.result ? { result: job.result } : {}),
    };
  }

  /** A job from the toolkit service: { checkId, review, adapter: { key, revision, name, description, urlPatterns, supportAreas, code } }. */
  function submit(uid, body) {
    assertUid(uid);
    const id = String(body?.checkId || '');
    const dir = dirOf(id);
    const a = body?.adapter || {};
    const code = a.code;
    if (typeof code !== 'string' || !code.trim()) throw httpError(400, 'no-code', 'The adapter has no code to check.');
    if (code.length > MAX_PACKAGE_CODE) throw httpError(413, 'too-large', 'The adapter is larger than a package may be.');
    const idPart = String(a.key || '').split('/').at(-1);
    if (!NAME.test(idPart)) throw httpError(400, 'bad-adapter', 'The adapter has no usable id.');
    if (existsSync(dir)) throw httpError(409, 'exists', 'That check was already asked for.');
    const mine = [...queue, current].filter(Boolean).filter((x) => readJob(x)?.uid === uid).length;
    if (mine >= perAccount) throw httpError(429, 'busy', `An account has at most ${perAccount} checks waiting or running at a time.`);
    if (queue.length >= maxQueued) throw httpError(503, 'queue-full', 'The checker has a long queue right now. Try again later.');
    sweep();
    mkdirSync(path.join(dir, 'in'), { recursive: true });
    const file = `${idPart}.js`;
    writeFileSync(path.join(dir, 'in', file), code);
    const about = [
      `Name: ${clip(a.name, 200) || idPart}`,
      `Description: ${clip(a.description, 2000) || '(none)'}`,
      `Runs on: ${(Array.isArray(a.urlPatterns) ? a.urlPatterns : []).slice(0, 20).map((p) => clip(p, 200)).join(', ') || '(not given)'}`,
      `For: ${(Array.isArray(a.supportAreas) ? a.supportAreas : []).slice(0, 10).map((p) => clip(p, 40)).join(', ') || '(not given)'}`,
    ].join('\n');
    writeFileSync(path.join(dir, 'in', 'about.txt'), `${about}\n`);
    const job = {
      checkId: id, uid, review: body.review === true, file, status: 'queued', submittedAt: new Date(now()).toISOString(),
      adapter: { key: clip(a.key, 200), revision: Number(a.revision) || null, name: clip(a.name, 200) },
    };
    saveJob(job);
    queue.push(id);
    log?.info('check.queued', { uid, checkId: id, review: job.review, codeBytes: code.length, position: position(id) });
    setImmediate(pump);
    return view(job);
  }

  function get(uid, id) {
    const job = readJob(id);
    if (!job || job.uid !== uid) throw httpError(404, 'not-found', 'No such check.');
    return view(job);
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        current = queue.shift();
        try { await runJob(current); } catch (e) { log?.error('check.crashed', { checkId: current, error: e.message }); }
        current = null;
      }
    } finally { pumping = false; }
  }

  async function runJob(id) {
    const job = readJob(id);
    if (!job || job.status !== 'queued') return;
    const dir = dirOf(id);
    const started = now();
    job.status = 'running';
    job.startedAt = new Date(started).toISOString();
    saveJob(job);
    log?.info('check.started', { uid: job.uid, checkId: id, review: job.review });
    try {
      for (const sub of ['out', 'review']) { mkdirSync(path.join(dir, sub), { recursive: true }); chmodSync(path.join(dir, sub), 0o777); }
      const c = await runner.check({ id: id.slice(4), dir, file: job.file, timeoutMs: checkTimeoutMs });
      const report = readJson(path.join(dir, 'out', 'report.json'));
      if (!report) {
        log?.warn('check.no-report', { uid: job.uid, checkId: id, code: c.code, timedOut: c.timedOut, stderr: c.stderr.slice(-600) });
        throw Object.assign(new Error('no report'), { plain: c.timedOut
          ? `The check took longer than ${minutes(checkTimeoutMs)} and was stopped. An adapter that holds up the page, or never finishes enable(), does this.`
          : 'The check could not finish: the verifier wrote no report. If the adapter loads, this is the checker\'s problem; try again later.' });
      }
      job.result = { check: trimReport(report) };
      if (job.review) job.result.review = await runReview(job, dir, report);
      job.status = 'done';
      log?.info('check.done', { uid: job.uid, checkId: id, ms: now() - started, failed: job.result.check.summary?.failed, verdict: job.result.review?.verdict });
    } catch (e) {
      job.status = 'failed';
      job.error = e.plain || 'The check could not run. Try again later.';
      if (!e.plain) log?.error('check.failed', { uid: job.uid, checkId: id, error: e.message });
    } finally {
      job.finishedAt = new Date(now()).toISOString();
      saveJob(job);
      for (const sub of ['in', 'out', 'review']) rmSync(path.join(dir, sub), { recursive: true, force: true });
    }
  }

  async function runReview(job, dir, report) {
    const got = await fetchRubrics(rubricsDir).catch((e) => ({ have: [], missing: [{ reason: e.message }] }));
    if (got.missing?.length) log?.warn('check.rubrics-missing', { checkId: job.checkId, missing: got.missing.map((m) => m.sc).filter(Boolean) });
    writeFileSync(path.join(dir, 'in', 'report.json'), JSON.stringify(report));
    const token = `chk_${randomBytes(24).toString('hex')}`;
    tokens.set(token, { uid: job.uid, checkId: job.checkId, calls: 0 });
    let r;
    try { r = await runner.review({ id: job.checkId.slice(4), dir, file: job.file, token, timeoutMs: reviewTimeoutMs }); } finally { tokens.delete(token); }
    const out = readJson(path.join(dir, 'review', 'review.json'), 2_000_000);
    if (!out?.report || /^\(no report;/.test(out.report)) {
      log?.warn('check.review-no-report', { uid: job.uid, checkId: job.checkId, code: r.code, timedOut: r.timedOut, stderr: r.stderr.slice(-600) });
      return { verdict: null, error: r.timedOut ? `The review took longer than ${minutes(reviewTimeoutMs)} and was stopped.` : 'The reviewer did not finish its report. Try again later.' };
    }
    return {
      verdict: ['ok', 'issues'].includes(out.verdict) ? out.verdict : null,
      rubricsRead: (Array.isArray(out.rubricsRead) ? out.rubricsRead : []).map((s) => clip(s, 10)).slice(0, 20),
      report: clip(out.report, MAX_REVIEW_TEXT),
    };
  }

  /** The model proxy's side: the account a review's token names, while its review runs and within its calls. */
  function uidForToken(token) {
    const t = tokens.get(String(token || ''));
    if (!t) return null;
    if (++t.calls > reviewModelCalls) {
      if (t.calls === reviewModelCalls + 1) log?.warn('check.review-calls-used', { uid: t.uid, checkId: t.checkId, calls: reviewModelCalls });
      return null;
    }
    return t.uid;
  }

  /** Jobs older than a week go. */
  function sweep() {
    for (const id of readdirSync(root)) {
      if (!CHECK_ID.test(id)) continue;
      const job = readJob(id);
      const at = Date.parse(job?.finishedAt || '');
      if (job && Number.isFinite(at) && now() - at > KEEP_MS) rmSync(path.join(root, id), { recursive: true, force: true });
    }
  }

  /** After a restart: what was waiting or running goes back in the queue, in the order it was asked. */
  async function recover() {
    await runner.cleanup?.();
    const unfinished = [];
    for (const j of readdirSync(root).filter((id) => CHECK_ID.test(id)).map(readJob)) {
      if (!j || (j.status !== 'queued' && j.status !== 'running')) continue;
      if (existsSync(path.join(dirOf(j.checkId), 'in', j.file))) { unfinished.push(j); continue; }
      Object.assign(j, { status: 'failed', error: 'The checker restarted during this check. Ask for it again.', finishedAt: new Date(now()).toISOString() });
      saveJob(j);
    }
    unfinished.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    for (const j of unfinished) { j.status = 'queued'; delete j.startedAt; saveJob(j); queue.push(j.checkId); }
    if (unfinished.length) log?.info('check.requeued', { count: unfinished.length });
    sweep();
    setImmediate(pump);
  }

  return { submit, get, uidForToken, recover, idle: () => !pumping && !queue.length };
}
