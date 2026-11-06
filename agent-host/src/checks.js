// Server-side checks of a published adapter, asked for by a developer
// through the toolkit service (POST /v1/adapters/checks, which checks who
// may and sends the adapter's code here).
//
// One check at a time, in the order asked; the rest wait. Each is the verification
// protocol's automated steps 2 to 8 (scripts/verify-adapters/run.mjs
// --check) in a one-shot container from the verify image under gVisor,
// with no network at all: the adapter is written into it, the recorded
// copies of real sites are mounted read-only, and it is stopped after a
// timeout. With review, independent reviewers then run at the same time,
// each in its own one-shot container (run.mjs --review-file --focus), each
// on one part (scripts/verify-adapters/review-focus.mjs: the code, and the
// WCAG rubrics in two halves): opencode with Gemini, whose only network is
// the host's model proxy, each with a token that names this job and is good
// only while its review runs. Their reports are put together in one. The
// GenA11y rubric text it may read is fetched here first, into a folder
// mounted read-only (INTERA11Y_DIR), so the reviewer needs no internet.
//
// The developer's code never runs outside a container on the host, except
// with the local runner (AGENT_RUNNER=local), which is for development
// with your own adapters only, as for the sidebar.
//
//   <data>/checks/<checkId>/
//     job.json   who asked, the adapter (no code), status, and the result
//     in/        the adapter, what it is for (about.txt; check.json, with copies/
//                of the person's pages it is for), the check's report (read-only in the containers)
//     out/       the check's report.json (removed once read)
//     review/    each reviewer's report, review/<part>/ (removed once read)
// in/, out/ and review/ are removed when the job ends; job.json is kept for
// a week. Logged: who, which job, how long, how it came out; never code.
//
// A job can be cancelled (the sidebar's background check of an adapter the
// agent is changing): a queued one leaves the queue, a running one's
// container is stopped. onChange hears every change of a job's status.

import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, chmodSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { MAX_PACKAGE_CODE } from '../../toolkit/protocol/adapter/package.js';
import { assertUid } from './accounts.js';
import { REVIEW_FOCUSES } from '../../scripts/verify-adapters/review-focus.mjs';

const CHECK_ID = /^chk_[a-f0-9]{16,40}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEEP_MS = 7 * 24 * 3600_000;
const MAX_REPORT = 4_000_000;
const MAX_REVIEW_TEXT = 40_000;
const MAX_COPIES = 5;
const MAX_OWN_CHECKS = 8;

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
    summary: r?.summary && typeof r.summary === 'object' ? {
      ...Object.fromEntries(['passed', 'failed', 'skipped', 'appliedOnTestPages', 'testPages'].map((k) => [k, Number(r.summary[k]) || 0])),
      // Made for some sites: checked on the person's pages instead of the test pages.
      ...(r.summary.narrow === true ? { narrow: true, ...Object.fromEntries(['ownPages', 'appliedOnOwnPages', 'ownRunsFailed', 'ownChecks'].map((k) => [k, Number(r.summary[k]) || 0])) } : {}),
    } : null,
    notes: (Array.isArray(r?.notes) ? r.notes : []).slice(0, 10).map((n) => clip(n, 400)),
    runs: runs.map((x) => ({
      name: clip(x?.name, 200), status: ['pass', 'fail', 'skip'].includes(x?.status) ? x.status : 'fail', result: clip(x?.result, 40),
      problems: (Array.isArray(x?.problems) ? x.problems : []).slice(0, 20).map((p) => clip(p, 400)),
      ...(Array.isArray(x?.advice) && x.advice.length ? { advice: x.advice.slice(0, 20).map((a) => clip(a, 200)) } : {}),
    })),
  };
}

/** Run a command to the end, until its time is up, or until `signal` aborts: { code, timedOut, stderr }. */
function runProcess(cmd, args, { env, cwd, timeoutMs, onTimeout, signal }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', timedOut = false;
    const kill = () => (onTimeout || (() => child.kill('SIGKILL')))(child);
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const abort = () => kill();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) kill();
    const end = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', (e) => { end(); resolve({ code: -1, timedOut, stderr: e.message }); });
    child.on('close', (code) => { end(); resolve({ code, timedOut, stderr }); });
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
export function dockerCheckRunner({ image, network = 'ai4a11y-chk', sitesDir, rubricsDir, modelUrl, runtime = 'runsc', cpus = '24', memory = '8g', pids = '4096',
  reviewCpus = '4', reviewMemory = '6g', log }) {
  if (!image) throw new Error('AGENT_CHECK_IMAGE is needed for checks on the VM.');
  // Runs at a time in a check: fewer than its CPUs. With as many runs as CPUs
  // or more, timing (layout shift, settling) makes runs fail that are fine
  // (measured on the VM, 129 runs: 8 CPUs, 6 at a time, 82 s; 24 CPUs, 16 at
  // a time 43 s, 20 at a time 33 s, under 4.5 GB; 16 CPUs, 16 at a time, a run failed).
  const runsAtOnce = Math.max(1, Math.floor(Number(cpus) * 3 / 4));
  const name = (id, step) => `ai4a11y-check-${id}-${step}`;
  const limitsOf = (c, m) => [`--runtime=${runtime}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    `--cpus=${c}`, `--memory=${m}`, `--pids-limit=${pids}`, '--shm-size=2g', '--label', 'ai4a11y.check=1'];
  const limits = limitsOf(cpus, memory);
  // A reviewer mostly waits for the model: fewer CPUs each, as several run at once.
  const reviewLimits = limitsOf(reviewCpus, reviewMemory);
  const stop = (id, step) => () => execFile('docker', ['rm', '-f', name(id, step)], () => {});

  return {
    kind: 'docker',
    check({ id, dir, file, spec, timeoutMs, signal }) {
      return runProcess('docker', ['run', '--rm', '--name', name(id, 'check'), ...limits, '--network', 'none',
        '-v', `${path.join(dir, 'in')}:/job:ro`, '-v', `${path.join(dir, 'out')}:/out`, '-v', `${sitesDir}:/sites:ro`,
        '-e', 'VERIFY_SITES=offline', '-e', 'VERIFY_SITE_CACHE=/sites', '-e', `VERIFY_CHECK_PARALLEL=${runsAtOnce}`,
        image, 'node', 'scripts/verify-adapters/run.mjs', '--check', `/job/${file}`, ...(spec ? ['--spec', `/job/${spec}`] : []), '--out', '/out/report.json'],
      { env: baseEnv(), timeoutMs, onTimeout: stop(id, 'check'), signal });
    },
    review({ id, dir, file, token, focus, timeoutMs, signal }) {
      const step = focus ? `review-${focus}` : 'review';
      // The job's token reaches the container by name (-e GEMINI_API_KEY), never on the command line.
      return runProcess('docker', ['run', '--rm', '--name', name(id, step), ...reviewLimits, '--network', network,
        '-v', `${path.join(dir, 'in')}:/job:ro`, '-v', `${path.join(dir, 'review', ...(focus ? [focus] : []))}:/review`, '-v', `${sitesDir}:/sites:ro`,
        '-v', `${rubricsDir}:/opt/intera11y:ro`,
        '-e', 'VERIFY_SITES=offline', '-e', 'VERIFY_SITE_CACHE=/sites', '-e', 'INTERA11Y_DIR=/opt/intera11y',
        '-e', 'GEMINI_API_KEY', '-e', `VERIFY_MODEL_BASE_URL=${modelUrl}`, '-e', `VERIFY_AGENT_TIMEOUT_MIN=${Math.max(1, Math.floor(timeoutMs / 60_000) - 1)}`,
        image, 'node', 'scripts/verify-adapters/run.mjs', '--agent', '--sandboxed', '--skills', '/opt/agent/skills',
        '--review-file', `/job/${file}`, '--about', '/job/about.txt', '--check-report', '/job/report.json', ...(focus ? ['--focus', focus] : []), '--logs', '/review'],
      { env: baseEnv({ GEMINI_API_KEY: token }), timeoutMs, onTimeout: stop(id, step), signal });
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
    check({ dir, file, spec, timeoutMs, signal }) {
      return runProcess(node, [run, '--check', path.join(dir, 'in', file), ...(spec ? ['--spec', path.join(dir, 'in', spec)] : []), '--out', path.join(dir, 'out', 'report.json')], { cwd: repoDir, env: env(), timeoutMs, signal });
    },
    review({ dir, file, token, focus, timeoutMs, signal }) {
      return runProcess(node, [run, '--agent', '--sandboxed', '--review-file', path.join(dir, 'in', file), '--about', path.join(dir, 'in', 'about.txt'),
        '--check-report', path.join(dir, 'in', 'report.json'), ...(focus ? ['--focus', focus] : []), '--logs', path.join(dir, 'review', ...(focus ? [focus] : []))],
      { cwd: repoDir, env: env({ GEMINI_API_KEY: token, VERIFY_MODEL_BASE_URL: modelUrl, VERIFY_OPENCODE_BIN: opencodeBin, VERIFY_AGENT_TIMEOUT_MIN: String(Math.max(1, Math.floor(timeoutMs / 60_000) - 1)) }), timeoutMs, signal });
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
  checkTimeoutMs = 20 * 60_000, reviewTimeoutMs = 45 * 60_000, parallel = 1, now = () => Date.now(), onChange }) {
  const root = path.join(dataDir, 'checks');
  mkdirSync(root, { recursive: true });
  const queue = [];         // checkIds waiting
  const running = new Set(); // checkIds running, at most `parallel`
  const tokens = new Map();  // job token -> { uid, checkId }
  const stops = new Map();   // checkId -> AbortController, while it runs
  const listeners = new Set(onChange ? [onChange] : []);

  const dirOf = (id) => {
    if (!CHECK_ID.test(String(id))) throw httpError(400, 'bad-check-id', 'Not a check id.');
    return path.join(root, id);
  };
  const jobFile = (id) => path.join(dirOf(id), 'job.json');
  const readJob = (id) => readJson(jobFile(id));
  const saveJob = (job) => {
    writeJson(jobFile(job.checkId), job);
    for (const l of listeners) { try { l(view(job)); } catch (e) { log?.warn('check.listener-failed', { checkId: job.checkId, error: e.message }); } }
  };

  function position(id) {
    const i = queue.indexOf(id);
    return i < 0 ? null : i + 1 + running.size;
  }

  function view(job) {
    return {
      checkId: job.checkId, status: job.status, review: job.review, adapter: job.adapter, ...(job.reused ? { reused: true } : {}),
      submittedAt: job.submittedAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
      ...(job.status === 'queued' ? { position: position(job.checkId) } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.result ? { result: job.result } : {}),
    };
  }

  /**
   * A job from the toolkit service: { checkId, review, adapter: { key, revision, name, description, urlPatterns, supportAreas, code } }.
   * From this host only (never from a request body): `own`, the person's own
   * pages to check it on, { copies: [{url, file}] (saved MHTML on this host), checks: [{name, code}] },
   * and `report`, the report of a check of the same code that already ran:
   * a review then starts its reviewer at once instead of checking it again.
   */
  function submit(uid, body, own = {}) {
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
    // What run.mjs --spec reads: where it runs (an adapter for some sites
    // only is not run on the test pages), copies of the person's pages there, and its own checks.
    const copies = (Array.isArray(own.copies) ? own.copies : []).filter((c) => /^https?:\/\//.test(c?.url || '') && c.file && existsSync(c.file)).slice(0, MAX_COPIES);
    if (copies.length) mkdirSync(path.join(dir, 'in', 'copies'));
    copies.forEach((c, i) => copyFileSync(c.file, path.join(dir, 'in', 'copies', `${i}.mhtml`)));
    writeFileSync(path.join(dir, 'in', 'check.json'), JSON.stringify({
      runsOn: (Array.isArray(a.urlPatterns) ? a.urlPatterns : []).slice(0, 20).map((p) => clip(p, 200)),
      copies: copies.map((c, i) => ({ url: clip(c.url, 2000), file: `copies/${i}.mhtml` })),
      checks: (Array.isArray(own.checks) ? own.checks : []).slice(0, MAX_OWN_CHECKS).filter((c) => typeof c?.code === 'string').map((c) => ({ name: clip(c.name, 100), code: c.code.slice(0, 3000) })),
    }));
    const reuse = body.review === true && own.report && typeof own.report === 'object';
    if (reuse) writeFileSync(path.join(dir, 'in', 'check-report.json'), JSON.stringify(trimReport(own.report)));
    const job = {
      checkId: id, uid, review: body.review === true, file, spec: 'check.json', copies: copies.length, ...(reuse ? { reused: true } : {}), status: 'queued', submittedAt: new Date(now()).toISOString(),
      adapter: { key: clip(a.key, 200), revision: Number(a.revision) || null, name: clip(a.name, 200) },
    };
    saveJob(job);
    queue.push(id);
    log?.info('check.queued', { uid, checkId: id, review: job.review, codeBytes: code.length, copies: copies.length, position: position(id) });
    setImmediate(pump);
    return view(job);
  }

  function get(uid, id) {
    const job = readJob(id);
    if (!job || job.uid !== uid) throw httpError(404, 'not-found', 'No such check.');
    return view(job);
  }

  // Up to `parallel` jobs at once, in the order asked; the rest wait.
  function pump() {
    while (running.size < Math.max(1, parallel) && queue.length) {
      const id = queue.shift();
      running.add(id);
      runJob(id).catch((e) => log?.error('check.crashed', { checkId: id, error: e.message }))
        .finally(() => { running.delete(id); pump(); });
    }
  }

  async function runJob(id) {
    const job = readJob(id);
    if (!job || job.status !== 'queued') return;
    const dir = dirOf(id);
    const started = now();
    const ctl = new AbortController();
    stops.set(id, ctl);
    job.status = 'running';
    job.startedAt = new Date(started).toISOString();
    saveJob(job);
    log?.info('check.started', { uid: job.uid, checkId: id, review: job.review });
    try {
      for (const sub of ['out', 'review']) { mkdirSync(path.join(dir, sub), { recursive: true }); chmodSync(path.join(dir, sub), 0o777); }
      // The check of this code already ran: its report, not a second run.
      const c = job.reused ? null : await runner.check({ id: id.slice(4), dir, file: job.file, spec: job.spec, timeoutMs: checkTimeoutMs, signal: ctl.signal });
      if (ctl.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      const report = readJson(path.join(dir, job.reused ? 'in' : 'out', job.reused ? 'check-report.json' : 'report.json'));
      if (!report) {
        log?.warn('check.no-report', { uid: job.uid, checkId: id, code: c.code, timedOut: c.timedOut, stderr: c.stderr.slice(-600) });
        throw Object.assign(new Error('no report'), { plain: c.timedOut
          ? `The check took longer than ${minutes(checkTimeoutMs)} and was stopped. An adapter that holds up the page, or never finishes enable(), does this.`
          : 'The check could not finish: the verifier wrote no report. If the adapter loads, this is the checker\'s problem; try again later.' });
      }
      job.result = { check: trimReport(report) };
      if (job.review) job.result.review = await runReview(job, dir, report, ctl.signal);
      if (ctl.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      job.status = 'done';
      log?.info('check.done', { uid: job.uid, checkId: id, ms: now() - started, failed: job.result.check.summary?.failed, verdict: job.result.review?.verdict });
    } catch (e) {
      if (e.cancelled || ctl.signal.aborted) {
        job.status = 'cancelled';
        delete job.result;
        log?.info('check.cancelled', { uid: job.uid, checkId: id, ms: now() - started });
      } else {
        job.status = 'failed';
        job.error = e.plain || 'The check could not run. Try again later.';
        if (!e.plain) log?.error('check.failed', { uid: job.uid, checkId: id, error: e.message });
      }
    } finally {
      stops.delete(id);
      job.finishedAt = new Date(now()).toISOString();
      saveJob(job);
      for (const sub of ['in', 'out', 'review']) rmSync(path.join(dir, sub), { recursive: true, force: true });
    }
  }

  async function runReview(job, dir, report, signal) {
    const got = await fetchRubrics(rubricsDir).catch((e) => ({ have: [], missing: [{ reason: e.message }] }));
    if (got.missing?.length) log?.warn('check.rubrics-missing', { checkId: job.checkId, missing: got.missing.map((m) => m.sc).filter(Boolean) });
    writeFileSync(path.join(dir, 'in', 'report.json'), JSON.stringify(report));
    // One reviewer per part, all at once, each with its own token and folder.
    const parts = await Promise.all(REVIEW_FOCUSES.map(async (focus) => {
      const logs = path.join(dir, 'review', focus.id);
      mkdirSync(logs, { recursive: true });
      chmodSync(logs, 0o777);
      const token = `chk_${randomBytes(24).toString('hex')}`;
      tokens.set(token, { uid: job.uid, checkId: job.checkId });
      let r;
      try { r = await runner.review({ id: job.checkId.slice(4), dir, file: job.file, token, focus: focus.id, timeoutMs: reviewTimeoutMs, signal }); } finally { tokens.delete(token); }
      const out = readJson(path.join(logs, 'review.json'), 2_000_000);
      const done = !!out?.report && !/^\(no report;/.test(out.report);
      if (!done) log?.warn('check.review-no-report', { uid: job.uid, checkId: job.checkId, focus: focus.id, code: r.code, timedOut: r.timedOut, stderr: r.stderr.slice(-600) });
      return { focus, r, out: done ? out : null };
    }));
    return mergeReviews(parts);
  }

  /**
   * The parts' reports as one: issues when any part found some, ok when
   * every part finished and found none; a part that did not finish is said
   * in the report and listed as `unfinished`. Failed only when none finished.
   */
  function mergeReviews(parts) {
    const finished = parts.filter((p) => p.out);
    if (!finished.length) {
      return { verdict: null, error: parts.some((p) => p.r.timedOut) ? `The review took longer than ${minutes(reviewTimeoutMs)} and was stopped.` : 'The reviewers did not finish their reports. Try again later.' };
    }
    const verdictOf = (p) => (['ok', 'issues'].includes(p.out?.verdict) ? p.out.verdict : null);
    const unfinished = parts.filter((p) => !p.out || !verdictOf(p)).map((p) => p.focus.id);
    const verdict = finished.some((p) => verdictOf(p) === 'issues') ? 'issues' : unfinished.length ? null : 'ok';
    const each = Math.floor(MAX_REVIEW_TEXT / parts.length) - 200;
    const report = parts.map((p) => {
      const what = p.focus.title.toLowerCase();
      const body = !p.out ? `(The review of ${what} did not finish${p.r.timedOut ? `: it took longer than ${minutes(reviewTimeoutMs)}` : ''}.)`
        : clip(p.out.report, each) + (verdictOf(p) ? '' : `\n(The review of ${what} gave no verdict.)`);
      return `## ${p.focus.title}\n\n${body}`;
    }).join('\n\n');
    return {
      verdict,
      ...(unfinished.length ? { unfinished } : {}),
      // With no verdict but parts that finished: what the person is told.
      ...(!verdict ? { error: `Part of the review did not finish (${unfinished.map((id) => REVIEW_FOCUSES.find((f) => f.id === id).title.toLowerCase()).join('; ')}), and the rest found no issues.` } : {}),
      rubricsRead: [...new Set(finished.flatMap((p) => (Array.isArray(p.out.rubricsRead) ? p.out.rubricsRead : [])))].map((sc) => clip(sc, 10)).sort().slice(0, 20),
      report: clip(report, MAX_REVIEW_TEXT),
    };
  }

  /** Stop a job: a queued one leaves the queue, a running one's container is stopped. Whether it was waiting or running. */
  function cancel(uid, id) {
    const job = readJob(id);
    if (!job || job.uid !== uid) return false;
    if (job.status === 'running') { stops.get(id)?.abort(); return true; }
    if (job.status !== 'queued') return false;
    const i = queue.indexOf(id);
    if (i >= 0) queue.splice(i, 1);
    Object.assign(job, { status: 'cancelled', finishedAt: new Date(now()).toISOString() });
    saveJob(job);
    for (const sub of ['in', 'out', 'review']) rmSync(path.join(dirOf(id), sub), { recursive: true, force: true });
    log?.info('check.cancelled', { uid, checkId: id, queued: true });
    return true;
  }

  /** The model proxy's side: the account a review's token names, while its review runs. */
  function uidForToken(token) {
    return tokens.get(String(token || ''))?.uid || null;
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

  return { submit, get, cancel, uidForToken, recover, onChange: (l) => listeners.add(l), idle: () => !running.size && !queue.length };
}
