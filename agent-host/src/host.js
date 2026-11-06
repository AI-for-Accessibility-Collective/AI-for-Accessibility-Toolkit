// The agent host: runs each account's opencode sandbox and serves two ports.
//
//   sandbox port  reachable only from the sandboxes: the model proxy
//                 (/model/…) and the browser tools (/mcp), both named by the
//                 sandbox's own token
//   API port      reachable only from the toolkit service, which signs every
//                 request with the shared secret and names the account it
//                 authenticated (x-ai4a11y-uid): the sidebar's chats, events
//                 and answers (/agent/…, which the service forwards as they
//                 come), and checks of published adapters (/checks, which
//                 only the service's own check route sends: it checks who
//                 may ask and reads the adapter from the registry)
//
// Logs say who did what and how big, never what: no messages, no page data.

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAccounts, assertUid } from './accounts.js';
import { createEvents } from './events.js';
import { createRequests } from './requests.js';
import { createChats } from './chats.js';
import { createModelProxy } from './model-proxy.js';
import { createTitler } from './titles.js';
import { createVerification } from './verification.js';
import { createBrowserTools } from './browser-tools.js';
import { createPageData } from './page-data.js';
import { dockerRunner, localRunner } from './runner.js';
import { createChecks, dockerCheckRunner, localCheckRunner, keptLog } from './checks.js';
import { burstRunner, cloudRunClient } from './burst.js';
import { fetchRubrics as fetchUpstreamRubrics } from '../../scripts/verify-adapters/intera11y-upstream.mjs';

const MAX_BODY = 12_000_000;

export function createLogger(write = (line) => process.stdout.write(`${line}\n`)) {
  const emit = (severity) => (event, fields = {}) => write(JSON.stringify({ time: new Date().toISOString(), severity, event, ...fields }));
  return { info: emit('INFO'), warn: emit('WARNING'), error: emit('ERROR') };
}

/**
 * @param {object} o
 * @param {string} o.dataDir       where accounts live
 * @param {string} o.secret        shared with the toolkit service
 * @param {string} o.apiKey        the model key (never enters a sandbox)
 * @param {string} o.sandboxUrl    how a sandbox reaches the sandbox port
 * @param {'docker'|'local'} [o.runnerKind]
 */
export function createHost({ dataDir, secret, apiKey, sandboxUrl, runnerKind = 'docker', image, network = 'ai4a11y-sbx', dns,
  opencodeBin, repoDir, modelsJson, skillDirs, upstream, fetch, requestTimeoutMs, log = createLogger(), runner: givenRunner,
  checkImage, checkNetwork, sitesDir, checkModelUrl, checkTimeoutMs, reviewTimeoutMs, checkParallel, checkCpus, reviewParallel, burst: burstConfig, burstRunner: givenBurst, checkRunner: givenCheckRunner, fetchRubrics, checkScript, titler: givenTitler }) {
  if (!secret || secret.length < 24) throw new Error('AGENT_HOST_SECRET must be at least 24 characters.');
  const accounts = createAccounts({ dataDir });
  const events = createEvents();
  const requests = createRequests({ events, timeoutMs: requestTimeoutMs });
  const runner = givenRunner || (runnerKind === 'local'
    ? localRunner({ accounts, hostUrl: sandboxUrl, bin: opencodeBin, repoDir, modelsJson, skillDirs })
    : dockerRunner({ accounts, image, network, dns, hostUrl: sandboxUrl, log }));
  // tools is made below; a run only ends after both exist.
  const titler = givenTitler || createTitler({ apiKey, upstream, ...(fetch ? { fetch } : {}), log });
  const chats = createChats({ accounts, runner, events, requests, log, titler, afterRun: (...a) => tools.afterRun(...a), onIdle: (uid) => verification.afterRun(uid) });
  const pageData = createPageData({ accounts });
  // Checks of published adapters: one-shot containers (or, with the local runner, plain processes).
  const rubricsDir = path.join(dataDir, 'intera11y');
  const sites = sitesDir || (runnerKind === 'local' && repoDir ? path.join(repoDir, '.verify-cache/sites') : path.join(dataDir, 'verify-sites'));
  const modelUrl = checkModelUrl || `${sandboxUrl}/model/v1beta`;
  const checkRunner = givenCheckRunner || (runnerKind === 'local'
    ? localCheckRunner({ repoDir, sitesDir: sites, rubricsDir, modelUrl, opencodeBin, script: checkScript })
    : checkImage ? dockerCheckRunner({ image: checkImage, network: checkNetwork, sitesDir: sites, rubricsDir, modelUrl, log }) : null);
  // The checks' log, also kept on disk (<data>/checks/events.jsonl).
  const checkLog = keptLog(log, path.join(dataDir, 'checks', 'events.jsonl'));
  // Checks beyond this host's CPUs: Cloud Run job executions, when set up.
  const burst = givenBurst || (checkRunner && burstConfig?.job && burstConfig.hostUrl
    ? burstRunner({ cloud: cloudRunClient({ ...burstConfig, ...(fetch ? { fetch } : {}) }), hostUrl: burstConfig.hostUrl, max: burstConfig.max, cpus: burstConfig.cpus, tasks: burstConfig.tasks, log: checkLog }) : null);
  const checks = checkRunner ? createChecks({ dataDir, runner: checkRunner, rubricsDir, log: checkLog, checkTimeoutMs, reviewTimeoutMs, parallel: checkParallel,
    localCpus: checkCpus, reviewParallel, burst,
    fetchRubrics: fetchRubrics || ((dir) => fetchUpstreamRubrics(dir, fetch ? { fetch } : {})) }) : null;
  // The model proxy takes a sandbox's token, or a running review's; the browser tools only a sandbox's.
  const model = createModelProxy({ apiKey, uidForToken: (t) => accounts.uidForToken(t) || checks?.uidForToken(t) || null, upstream, fetch, log });
  // After adapter_ready: the background check, the full review on request, and fixes of what they find.
  const verification = createVerification({ checks, chats, pageData, workDir: (uid) => path.join(accounts.dirOf(uid), 'work'), log });
  checks?.onChange(verification.onChange);
  const tools = createBrowserTools({ chats, requests, pageData, workDir: (uid) => path.join(accounts.dirOf(uid), 'work'), log, verification });

  function sandboxHandler(req, res) {
    const p = new URL(req.url, 'http://sandbox').pathname;
    const done = (e) => { log.error('sandbox.error', { path: p, error: e.message }); if (!res.headersSent) res.writeHead(500); res.end(); };
    if (p.startsWith('/model/')) return model(req, res).catch(done);
    if (p === '/mcp') return tools(req, res).catch(done);
    res.writeHead(404); res.end();
  }

  const secretOk = (header) => {
    const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(secret);
    return given.length === want.length && timingSafeEqual(given, want);
  };

  async function body(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
  }

  async function api(req, res) {
    const url = new URL(req.url, 'http://host');
    const p = url.pathname, m = req.method;
    if (m === 'GET' && p === '/healthz') return send(res, 200, { ok: true });
    // A Cloud Run check fetching its files and sending its report: its own token, not the shared secret.
    if (p.startsWith('/burst/')) return burst ? burst.handle(req, res, p) : send(res, 404, { error: 'not-found' });
    if (!secretOk(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    // The toolkit's admin console: every account's sandbox, what it uses, and its chats running now.
    if (m === 'GET' && p === '/admin/sandboxes') return send(res, 200, await sandboxOverview());
    // The toolkit's admin console: the checks waiting, running and finished, for every account.
    if (m === 'GET' && p === '/admin/checks') {
      if (!checks) return send(res, 503, { error: 'checks-unavailable', message: 'Checks are not set up on this host.' });
      return send(res, 200, checks.overview({ hours: Math.min(168, Number(url.searchParams.get('hours')) || 24) }));
    }
    const uid = assertUid(String(req.headers['x-ai4a11y-uid'] || ''));
    let r;
    if (m === 'GET' && p === '/agent/status') {
      accounts.ensure(uid);
      runner.ensure(uid).catch(e => log.error('sandbox.start-failed', { uid, error: e.message }));
      return send(res, 200, { ok: true, model: 'gemini-3.8-flash', busyChats: chats.busyChats(uid) });
    }
    if (m === 'GET' && p === '/agent/events') return events.subscribe(uid, res, requests.pendingFor(uid));
    if (m === 'GET' && p === '/agent/chats') return send(res, 200, { chats: chats.list(uid) });
    if (m === 'POST' && p === '/agent/chats') return send(res, 201, { chat: chats.create(uid) });
    if ((r = /^\/agent\/chats\/([^/]+)$/.exec(p)) && m === 'GET') {
      // A chat that ended before passing previews were offered by the host gets them now.
      try { tools.offerFinished(uid, r[1]); } catch (e) { log.warn('adapter.offer-finished-failed', { uid, error: e.message }); }
      return send(res, 200, { chat: chats.get(uid, r[1]) });
    }
    if ((r = /^\/agent\/chats\/([^/]+)$/.exec(p)) && m === 'DELETE') {
      log.info('chat.deleted', { uid, chatId: r[1] });
      const out = chats.remove(uid, r[1]);
      verification.forgetChat(uid, r[1]);
      return send(res, 200, out);
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/messages$/.exec(p)) && m === 'POST') {
      const b = await body(req);
      log.info('chat.message', { uid, chatId: r[1], chars: String(b.text || '').length });
      return send(res, 202, await chats.send(uid, r[1], b.text, { answers: typeof b.answers === 'string' ? b.answers : undefined, pages: typeof b.pages === 'string' ? b.pages : undefined,
        pageType: typeof b.pageType === 'string' ? b.pageType : undefined, areas: Array.isArray(b.areas) ? b.areas.map(String) : undefined }));
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/stop$/.exec(p)) && m === 'POST') return send(res, 200, chats.stop(uid, r[1]));
    // A copy of the page an adapter was previewed on, saved by the person's browser (page source shared): its background check runs on it.
    if ((r = /^\/agent\/chats\/([^/]+)\/page-copy$/.exec(p)) && m === 'POST') {
      chats.get(uid, r[1]);
      const saved = pageData.copy(uid, r[1], await body(req));
      log.info('page.copy-saved', { uid, chatId: r[1], bytes: saved.bytes });
      return send(res, 201, { ok: true, bytes: saved.bytes });
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/consent$/.exec(p)) && m === 'POST') {
      const b = await body(req);
      chats.setConsent(uid, r[1], b.origin, b.level);
      return send(res, 200, { ok: true });
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/adapters\/([^/]+)$/.exec(p)) && m === 'GET') {
      const chat = chats.get(uid, r[1]);
      const adapter = chat.adapters.find(a => a.id === r[2]);
      if (!adapter) return send(res, 404, { error: 'no such adapter in this chat' });
      // The version offered (browser-tools.js keeps it), else the file as it is.
      let code;
      try { code = readFileSync(path.join(accounts.dirOf(uid), 'offered', r[1], `${adapter.id}.js`), 'utf8'); } catch { code = readFileSync(path.join(accounts.dirOf(uid), 'work', adapter.file), 'utf8'); }
      return send(res, 200, { adapter: { ...adapter, code } });
    }
    // The person asks for the full review of an offered adapter.
    if ((r = /^\/agent\/chats\/([^/]+)\/adapters\/([^/]+)\/review$/.exec(p)) && m === 'POST') {
      log.info('verify.review-asked', { uid, chatId: r[1] });
      verification.start(uid, r[1], r[2], { review: true });
      return send(res, 202, { ok: true });
    }
    if (p === '/checks' || p.startsWith('/checks/')) {
      if (!checks) return send(res, 503, { error: 'checks-unavailable', message: 'Checks are not set up on this host.' });
      if (m === 'POST' && p === '/checks') return send(res, 202, { check: checks.submit(uid, await body(req)) });
      if ((r = /^\/checks\/([^/]+)$/.exec(p)) && m === 'GET') return send(res, 200, { check: checks.get(uid, r[1]) });
      return send(res, 404, { error: 'not-found' });
    }
    if ((r = /^\/agent\/requests\/([^/]+)$/.exec(p)) && m === 'POST') {
      const b = await body(req);
      log.info('request.answered', { uid, id: r[1], level: b.level, status: b.status, screenshot: !!(b.screenshot || b.after?.screenshot) });
      return send(res, requests.answer(uid, r[1], b) ? 200 : 404, { ok: true });
    }
    return send(res, 404, { error: 'not-found' });
  }

  function apiHandler(req, res) {
    api(req, res).catch((e) => {
      const status = e.status || 500;
      if (status >= 500) log.error('api.error', { path: new URL(req.url, 'http://host').pathname, error: e.message });
      if (!res.headersSent) send(res, status, { error: e.code || (status === 404 ? 'not-found' : 'error'), message: e.message });
      else res.end();
    });
  }

  async function sandboxOverview() {
    let boxes = [];
    try { boxes = (await runner.monitor?.()) || []; } catch (e) { log.warn('sandbox.monitor-failed', { error: e.message }); }
    const byUid = new Map(boxes.filter(b => b.uid).map(b => [b.uid, b]));
    const accountsNow = accounts.known().map(uid => {
      let chatList = [];
      try { chatList = chats.list(uid); } catch { /* an account without chats */ }
      return { uid, chats: chatList.length, running: chats.busyChats(uid).length, lastActive: chatList[0]?.updatedAt || null, sandbox: byUid.get(uid) || null };
    });
    // Containers whose account folder is gone.
    for (const b of boxes) if (b.uid && !accountsNow.some(a => a.uid === b.uid)) accountsNow.push({ uid: b.uid, chats: 0, running: 0, lastActive: null, sandbox: b, orphan: true });
    accountsNow.sort((a, b) => (b.running - a.running) || String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
    return {
      vm: { cpus: os.cpus().length, load: os.loadavg().map(n => Math.round(n * 100) / 100), memTotal: os.totalmem(), memFree: os.freemem(), uptimeS: Math.round(os.uptime()) },
      limits: runner.limits || null, runner: runnerKind, accounts: accountsNow,
    };
  }

  /** Start every known account's sandbox, so they are running before anyone asks; go on with the chats a restart cut off. */
  async function warm() {
    await checks?.recover().catch(e => log.error('check.recover-failed', { error: e.message }));
    for (const uid of accounts.known()) await runner.ensure(uid).catch(e => log.error('sandbox.start-failed', { uid, error: e.message }));
    // The chats a restart cut off go on where they were.
    await chats.resumeInterrupted(accounts.known()).catch(e => log.error('chat.resume-failed', { error: e.message }));
  }

  return { sandboxHandler, apiHandler, warm, accounts, chats, requests, events, checks };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function listen(handler, where) {
  const [host, port] = String(where).split(/:(?=\d+$)/);
  const server = http.createServer(handler);
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  return new Promise((resolve) => server.listen(Number(port), host, () => resolve(server)));
}

export { assertUid };
