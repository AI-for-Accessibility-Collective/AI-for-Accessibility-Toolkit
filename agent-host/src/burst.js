// Checks beyond the VM: when its CPUs for checks are taken, a check runs as
// a Cloud Run job execution instead (checks.js decides). The VM is the base;
// this is what grows with demand, and costs nothing while no check needs it.
//
// The job's image is the check image with the recorded site copies baked in
// (vm/burst-image.sh). It runs scripts/verify-adapters/burst.mjs, which
// fetches this check's files from the host with a token made for it
// (GET /burst/<id>, GET /burst/<id>/files/<name>), runs run.mjs --check
// offline, and sends the report back (POST /burst/<id>/report). The token
// is good for that check only, while it runs.
//
// What else the code under check can reach: nothing. The job runs as a
// service account with no roles, its traffic goes into the VPC
// (all-traffic egress, tag ai4a11y-burst), and the firewall lets that tag
// reach only the host's API port (vm/burst-setup.sh).

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const TOKEN = /^brs_[a-f0-9]{48}$/;
const MAX_REPORT = 4_000_000;

/** Cloud Run's v2 API with the VM's own credentials (the metadata server). */
export function cloudRunClient({ project, region, job, fetch = globalThis.fetch }) {
  let cached = null;
  async function token() {
    if (cached && cached.until > Date.now() + 60_000) return cached.value;
    const r = await fetch('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) throw new Error(`no credentials from the metadata server (${r.status})`);
    const t = await r.json();
    cached = { value: t.access_token, until: Date.now() + (t.expires_in || 300) * 1000 };
    return cached.value;
  }
  async function call(method, url, body) {
    const r = await fetch(url, { method, headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Cloud Run answered ${r.status}: ${String(data.error?.message || '').slice(0, 200)}`);
    return data;
  }
  const base = 'https://run.googleapis.com/v2';
  return {
    /** Start one execution with these environment variables; its name. */
    async run(env, timeoutSeconds) {
      const op = await call('POST', `${base}/projects/${project}/locations/${region}/jobs/${job}:run`, {
        overrides: { containerOverrides: [{ env: Object.entries(env).map(([name, value]) => ({ name, value: String(value) })) }], taskCount: 1, timeout: `${timeoutSeconds}s` },
      });
      return op.metadata?.name || null;
    },
    /** {done, failed} of an execution. */
    async state(name) {
      const e = await call('GET', `${base}/${name}`);
      return { done: !!e.completionTime, failed: (e.failedCount || 0) + (e.cancelledCount || 0) > 0 };
    },
    cancel: (name) => call('POST', `${base}/${name}:cancel`, {}).catch(() => {}),
  };
}

/**
 * A check runner (as checks.js's dockerCheckRunner) whose checks run on Cloud Run.
 * @param {object} o
 * @param {object} o.cloud     cloudRunClient, or a stand-in in tests
 * @param {string} o.hostUrl   how a job reaches this host's API port (http://10.128.0.44:8791)
 * @param {number} [o.max]     executions at once
 */
export function burstRunner({ cloud, hostUrl, max = 20, cpus = 8, pollMs = 15_000, log }) {
  const sessions = new Map(); // token -> {id, dir, file, spec, done(report)}

  return {
    kind: 'burst',
    max,
    cpus,
    async check({ id, dir, file, spec, timeoutMs, signal }) {
      const token = `brs_${randomBytes(24).toString('hex')}`;
      let finish;
      const reported = new Promise((r) => { finish = r; });
      sessions.set(token, { id, dir, file, spec, done: finish });
      let execution = null, timer = null, poll = null;
      const started = Date.now();
      try {
        execution = await cloud.run({
          JOB_URL: `${hostUrl}/burst/${id}`, JOB_TOKEN: token, JOB_FILE: file, JOB_SPEC: spec || '',
          // Runs at a time: fewer than its CPUs (see checks.js).
          VERIFY_CHECK_PARALLEL: Math.max(1, Math.floor(cpus * 3 / 4)),
        }, Math.ceil(timeoutMs / 1000));
        log?.info('check.burst-started', { checkId: `chk_${id}` });
        const outcome = await new Promise((resolve) => {
          reported.then(() => resolve('reported'));
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
          signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
          if (signal?.aborted) resolve('aborted');
          // An execution that ended without a report (it crashed, or never started).
          poll = setInterval(async () => {
            try { const s = await cloud.state(execution); if (s.done) setTimeout(() => resolve('ended'), 2000); } catch { /* ask again */ }
          }, pollMs);
        });
        if (outcome !== 'reported') cloud.cancel(execution);
        log?.info('check.burst-ended', { checkId: `chk_${id}`, outcome, ms: Date.now() - started });
        return { code: outcome === 'reported' ? 0 : 1, timedOut: outcome === 'timeout', stderr: outcome === 'reported' ? '' : `the Cloud Run check ${outcome} without a report` };
      } catch (e) {
        log?.warn('check.burst-failed', { checkId: `chk_${id}`, error: e.message });
        return { code: -1, timedOut: false, stderr: e.message };
      } finally {
        clearTimeout(timer); clearInterval(poll);
        sessions.delete(token);
      }
    },
    review() { throw new Error('reviews run on the VM'); },
    cleanup: async () => {},

    /** The jobs' side of the host's API port: /burst/<id>[/files/<name>|/report], with the job's token. */
    async handle(req, res, pathname) {
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const s = TOKEN.test(auth) ? sessions.get(auth) : null;
      const m = /^\/burst\/([a-f0-9]{16,40})(?:\/(files\/(.+)|report))?$/.exec(pathname);
      if (!s || !m || m[1] !== s.id) return send(res, 401, { error: 'unknown check' });
      const inDir = path.join(s.dir, 'in');
      if (req.method === 'GET' && !m[2]) {
        // The adapter, about.txt, check.json and the person's page copies: what the VM's container gets at /job.
        const files = [];
        const walk = (rel) => { for (const n of readdirSync(path.join(inDir, rel))) { const r = rel ? `${rel}/${n}` : n; if (statSync(path.join(inDir, r)).isDirectory()) walk(r); else files.push(r); } };
        walk('');
        return send(res, 200, { file: s.file, spec: s.spec || null, files });
      }
      if (req.method === 'GET' && m[3]) {
        const rel = decodeURIComponent(m[3]);
        const full = path.resolve(inDir, rel);
        if (!full.startsWith(inDir + path.sep) || !existsSync(full)) return send(res, 404, { error: 'no such file' });
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(readFileSync(full));
      }
      if (req.method === 'POST' && m[2] === 'report') {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > MAX_REPORT) return send(res, 413, { error: 'too large' }); chunks.push(c); }
        try { JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'not JSON' }); }
        writeFileSync(path.join(s.dir, 'out', 'report.json'), Buffer.concat(chunks));
        s.done();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not-found' });
    },
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
