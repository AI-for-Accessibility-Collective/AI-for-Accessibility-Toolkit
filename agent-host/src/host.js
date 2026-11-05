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
import { createAccounts, assertUid } from './accounts.js';
import { createEvents } from './events.js';
import { createRequests } from './requests.js';
import { createChats } from './chats.js';
import { createModelProxy } from './model-proxy.js';
import { createTitler } from './titles.js';
import { createBrowserTools } from './browser-tools.js';
import { createPageData } from './page-data.js';
import { dockerRunner, localRunner } from './runner.js';
import { createChecks, dockerCheckRunner, localCheckRunner } from './checks.js';
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
  opencodeBin, repoDir, modelsJson, skillDirs, upstream, fetch, perMinute, requestTimeoutMs, log = createLogger(), runner: givenRunner,
  checkImage, checkNetwork, sitesDir, checkModelUrl, checkTimeoutMs, reviewTimeoutMs, checkParallel, checkRunner: givenCheckRunner, fetchRubrics, checkScript, titler: givenTitler }) {
  if (!secret || secret.length < 24) throw new Error('AGENT_HOST_SECRET must be at least 24 characters.');
  const accounts = createAccounts({ dataDir });
  const events = createEvents();
  const requests = createRequests({ events, timeoutMs: requestTimeoutMs });
  const runner = givenRunner || (runnerKind === 'local'
    ? localRunner({ accounts, hostUrl: sandboxUrl, bin: opencodeBin, repoDir, modelsJson, skillDirs })
    : dockerRunner({ accounts, image, network, dns, hostUrl: sandboxUrl, log }));
  // tools is made below; a run only ends after both exist.
  const titler = givenTitler || createTitler({ apiKey, upstream, ...(fetch ? { fetch } : {}), log });
  const chats = createChats({ accounts, runner, events, requests, log, titler, afterRun: (...a) => tools.afterRun(...a) });
  const pageData = createPageData({ accounts });
  // Checks of published adapters: one-shot containers (or, with the local runner, plain processes).
  const rubricsDir = path.join(dataDir, 'intera11y');
  const sites = sitesDir || (runnerKind === 'local' && repoDir ? path.join(repoDir, '.verify-cache/sites') : path.join(dataDir, 'verify-sites'));
  const modelUrl = checkModelUrl || `${sandboxUrl}/model/v1beta`;
  const checkRunner = givenCheckRunner || (runnerKind === 'local'
    ? localCheckRunner({ repoDir, sitesDir: sites, rubricsDir, modelUrl, opencodeBin, script: checkScript })
    : checkImage ? dockerCheckRunner({ image: checkImage, network: checkNetwork, sitesDir: sites, rubricsDir, modelUrl, log }) : null);
  const checks = checkRunner ? createChecks({ dataDir, runner: checkRunner, rubricsDir, log, checkTimeoutMs, reviewTimeoutMs, parallel: checkParallel,
    fetchRubrics: fetchRubrics || ((dir) => fetchUpstreamRubrics(dir, fetch ? { fetch } : {})) }) : null;
  // The model proxy takes a sandbox's token, or a running review's; the browser tools only a sandbox's.
  const model = createModelProxy({ apiKey, uidForToken: (t) => accounts.uidForToken(t) || checks?.uidForToken(t) || null, upstream, fetch, perMinute, log });
  const tools = createBrowserTools({ uidForToken: accounts.uidForToken, chats, requests, pageData, workDir: (uid) => path.join(accounts.dirOf(uid), 'work'), log });

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
    if (!secretOk(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    const uid = assertUid(String(req.headers['x-ai4a11y-uid'] || ''));
    let r;
    if (m === 'GET' && p === '/agent/status') {
      accounts.ensure(uid);
      runner.ensure(uid).catch(e => log.error('sandbox.start-failed', { uid, error: e.message }));
      return send(res, 200, { ok: true, model: 'gemini-3.8-flash', busyChat: chats.activeChat(uid) });
    }
    if (m === 'GET' && p === '/agent/events') return events.subscribe(uid, res, requests.pendingFor(uid));
    if (m === 'GET' && p === '/agent/chats') return send(res, 200, { chats: chats.list(uid) });
    if (m === 'POST' && p === '/agent/chats') return send(res, 201, { chat: chats.create(uid) });
    if ((r = /^\/agent\/chats\/([^/]+)$/.exec(p)) && m === 'GET') return send(res, 200, { chat: chats.get(uid, r[1]) });
    if ((r = /^\/agent\/chats\/([^/]+)$/.exec(p)) && m === 'DELETE') {
      log.info('chat.deleted', { uid, chatId: r[1] });
      return send(res, 200, chats.remove(uid, r[1]));
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/messages$/.exec(p)) && m === 'POST') {
      const b = await body(req);
      log.info('chat.message', { uid, chatId: r[1], chars: String(b.text || '').length });
      return send(res, 202, await chats.send(uid, r[1], b.text, { answers: typeof b.answers === 'string' ? b.answers : undefined }));
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/stop$/.exec(p)) && m === 'POST') return send(res, 200, chats.stop(uid, r[1]));
    if ((r = /^\/agent\/chats\/([^/]+)\/consent$/.exec(p)) && m === 'POST') {
      const b = await body(req);
      chats.setConsent(uid, r[1], b.origin, b.level);
      return send(res, 200, { ok: true });
    }
    if ((r = /^\/agent\/chats\/([^/]+)\/adapters\/([^/]+)$/.exec(p)) && m === 'GET') {
      const chat = chats.get(uid, r[1]);
      const adapter = chat.adapters.find(a => a.id === r[2]);
      if (!adapter) return send(res, 404, { error: 'no such adapter in this chat' });
      const code = readFileSync(path.join(accounts.dirOf(uid), 'work', adapter.file), 'utf8');
      return send(res, 200, { adapter: { ...adapter, code } });
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

  /** Start every known account's sandbox, so they are running before anyone asks. */
  async function warm() {
    await checks?.recover().catch(e => log.error('check.recover-failed', { error: e.message }));
    for (const uid of accounts.known()) await runner.ensure(uid).catch(e => log.error('sandbox.start-failed', { uid, error: e.message }));
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
