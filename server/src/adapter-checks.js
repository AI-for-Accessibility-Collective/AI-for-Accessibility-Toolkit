// /v1/adapters/checks: a check of a published adapter on the server, when a
// developer (or their coding agent) asks for one. Optional, and only on
// request: nothing here runs on its own.
//
//   POST /v1/adapters/checks          { id, appId?, owner?, review? } -> 202 { check }
//   GET  /v1/adapters/checks          this account's checks, latest first (?appId=&id=&owner=), and today's use
//   GET  /v1/adapters/checks/{checkId} one check, with its result once it is done
//
// The service checks the token (the account's own: an app-bound token is
// refused, as for /v1/agent), reads the adapter's current revision from the
// registry (only one the account can read: its own, or a shared one), holds
// the daily quota (checks and reviews counted apart; a review runs a model
// and is the costly one), and sends the job to the agent host
// (agent-host/src/checks.js) signed with AGENT_HOST_SECRET, the way
// agent-proxy.js does. The host runs it in a sandbox; the service asks it
// for the result when someone looks and keeps the result with the
// revision it checked.
//
// Storage (the account's, deleted with it):
//   users/<uid>/adapter-checks.json              today's use and a summary of each check
//   users/<uid>/adapter-checks/<checkId>.json     one check's full result
// Never logged: the adapter's code or the reports.

import crypto from 'node:crypto';
import { sendJSON, bearerFrom, readJSON, HttpError, sendHttpError } from './http.js';

export const ADAPTER_CHECKS_PREFIX = '/v1/adapters/checks';
const INDEX_DOC = (uid) => `users/${uid}/adapter-checks.json`;
const RESULT_DOC = (uid, id) => `users/${uid}/adapter-checks/${id}.json`;
const CHECK_ID = /^chk_[a-f0-9]{20}$/;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEEP = 100;
const FINAL = new Set(['done', 'failed']);

/** Said with every result: what a check can and cannot show. */
export const CHECK_FRAMING = 'The toolkit is an active research project, in pre-alpha: a technology probe. Its adapters are unvalidated, and it is not a replacement for assistive technology. This means an adapter that passes every check here can still fail the people it is for: these checks find some bugs in code, and only people trying the adapter on the pages they use can show whether it helps.';

const findingsIn = (text) => Object.fromEntries(['high', 'medium', 'low'].map((l) => [l, (String(text || '').match(new RegExp(`^\\[${l}\\]`, 'gmi')) || []).length]));

export function createAdapterChecks({ store, withUserLock, authenticate, registry, hostUrl, secret, fetch = globalThis.fetch, log,
  checksPerDay = 5, reviewsPerDay = 2, now = () => new Date() }) {
  const base = hostUrl ? String(hostUrl).replace(/\/+$/, '') : null;
  const today = () => now().toISOString().slice(0, 10);

  async function readIndex(uid) {
    const doc = await store.readJSON(INDEX_DOC(uid));
    return { usage: doc?.usage && typeof doc.usage === 'object' ? doc.usage : {}, checks: Array.isArray(doc?.checks) ? doc.checks : [] };
  }
  const usageOf = (index) => {
    const u = index.usage.day === today() ? index.usage : { day: today(), checks: 0, reviews: 0 };
    return { day: u.day, checks: u.checks || 0, reviews: u.reviews || 0, checksPerDay, reviewsPerDay };
  };

  async function host(method, path, uid, body) {
    const res = await fetch(`${base}${path}`, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${secret}`, 'x-ai4a11y-uid': uid, ...(body ? { 'content-type': 'application/json' } : {}) },
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** The adapter the request names, as the account can read it: { owner, appId, id, got }. */
  async function resolve(uid, body) {
    let { id, appId, owner } = body || {};
    if (typeof id !== 'string' || !id.trim()) throw new HttpError(400, 'bad-request', 'Say which adapter: { "id": "bigger-buttons" } (its id, or appId/id, or owner/appId/id).');
    const parts = id.trim().split('/');
    if (parts.length === 3) [owner, appId, id] = parts;
    else if (parts.length === 2) [appId, id] = parts;
    else id = parts[0];
    if (!SLUG.test(id) || (appId && !SLUG.test(appId))) throw new HttpError(400, 'bad-request', 'That is not an adapter id.');
    if (!appId) {
      // Only the id: the account's own adapter with that id, if there is exactly one.
      const { adapters } = await registry().call(uid, 'adapter_search', { scope: 'mine' });
      const found = adapters.filter((a) => a.adapter.id === id);
      if (!found.length) throw new HttpError(404, 'not-found', `You have no adapter ${id}. Publish it first, or name it as owner/appId/id.`);
      if (found.length > 1) throw new HttpError(400, 'ambiguous', `You have more than one adapter ${id}: name it as appId/id (${found.map((a) => `${a.adapter.appId}/${id}`).join(', ')}).`);
      appId = found[0].adapter.appId;
    }
    let got;
    try {
      got = await registry().call(uid, 'adapter_get', { adapter: { ...(owner ? { owner } : {}), appId, id } });
    } catch (e) {
      if (e.code === 'not-found') throw new HttpError(404, 'not-found', e.message);
      if (e.code) throw new HttpError(400, e.code, e.message);
      throw e;
    }
    if (!got.package?.code) throw new HttpError(400, 'no-code', `${got.name} is a description only: there is no code to check.`);
    if (got.package.format !== 'web-module@1') throw new HttpError(400, 'not-checkable', `Only web adapters (web-module@1) can be checked here; this one is ${got.package.format}.`);
    return { owner: got.adapter.owner, appId, id, got };
  }

  function summaryOf(entry, result) {
    const s = result?.check?.summary;
    const rv = result?.review;
    return {
      ...entry,
      ...(s ? { summary: s } : {}),
      ...(rv ? { verdict: rv.verdict ?? null, findings: rv.report ? findingsIn(rv.report) : null } : {}),
    };
  }

  /** Ask the host how an unfinished check is doing; keep the result once it is done. */
  async function refresh(uid, entry) {
    if (FINAL.has(entry.status)) return { entry, result: null };
    let r;
    try { r = await host('GET', `/checks/${entry.checkId}`, uid); } catch (e) {
      log?.warn('check.host-unreachable', { uid, checkId: entry.checkId, error: e });
      return { entry, result: null, unreachable: true };
    }
    const c = r.json?.check;
    if (r.status === 404) {
      // The host no longer has it (more than a week, or lost).
      return save(uid, entry.checkId, (e) => Object.assign(e, { status: 'failed', error: 'The checker no longer has this check. Ask for it again.', finishedAt: now().toISOString() }));
    }
    if (r.status !== 200 || !c) return { entry, result: null, unreachable: true };
    const changes = { status: c.status, startedAt: c.startedAt || null, finishedAt: c.finishedAt || null, ...(c.error ? { error: c.error } : {}) };
    if (!FINAL.has(c.status)) return { entry: { ...entry, ...changes }, result: null, position: c.position ?? null };
    const result = c.result || null;
    if (result) await store.writeJSON(RESULT_DOC(uid, entry.checkId), result);
    return save(uid, entry.checkId, (e) => Object.assign(e, summaryOf({ ...e, ...changes }, result)), result);
  }

  async function save(uid, checkId, change, result = null) {
    return withUserLock(uid, async () => {
      const index = await readIndex(uid);
      const e = index.checks.find((x) => x.checkId === checkId);
      if (!e) return { entry: null, result };
      change(e);
      await store.writeJSON(INDEX_DOC(uid), index);
      return { entry: e, result };
    });
  }

  async function ask(req, res, rec) {
    const body = await readJSON(req, { maxBytes: 10_000 });
    const review = body.review === true;
    const { owner, appId, id, got } = await resolve(rec.uid, body);
    const key = { owner, appId, id };
    const reserved = await withUserLock(rec.uid, async () => {
      const index = await readIndex(rec.uid);
      // The same revision, already checked or being checked: that one, at no cost.
      const same = index.checks.find((e) => e.adapter.owner === owner && e.adapter.appId === appId && e.adapter.id === id
        && e.revision === got.revision && e.status !== 'failed' && (!review || e.review));
      if (same) return { reused: same };
      const usage = usageOf(index);
      if (review && usage.reviews >= reviewsPerDay) throw new HttpError(429, 'quota', `An account can ask for ${reviewsPerDay} reviews a day, and this one has. Try again tomorrow (UTC), or check without --review.`, { usage });
      if (!review && usage.checks >= checksPerDay) throw new HttpError(429, 'quota', `An account can ask for ${checksPerDay} checks a day, and this one has. Try again tomorrow (UTC).`, { usage });
      const entry = {
        checkId: `chk_${crypto.randomBytes(10).toString('hex')}`, adapter: key, name: got.name, revision: got.revision,
        review, status: 'queued', requestedAt: now().toISOString(),
      };
      index.usage = { day: usage.day, checks: usage.checks + (review ? 0 : 1), reviews: usage.reviews + (review ? 1 : 0) };
      index.checks.unshift(entry);
      const dropped = index.checks.splice(KEEP);
      await store.writeJSON(INDEX_DOC(rec.uid), index);
      for (const d of dropped) await store.writeJSON(RESULT_DOC(rec.uid, d.checkId), null);
      return { entry, usage: index.usage };
    });
    if (reserved.reused) {
      const { entry, result, position } = await refresh(rec.uid, reserved.reused);
      return sendJSON(res, 200, { check: { ...entry, ...(position ? { position } : {}), ...(result ? { result } : {}) }, reused: true, framing: CHECK_FRAMING });
    }
    const { entry } = reserved;
    // Not sent, or refused: the check never happened, so it does not count.
    const undo = (error) => withUserLock(rec.uid, async () => {
      const index = await readIndex(rec.uid);
      index.checks = index.checks.filter((e) => e.checkId !== entry.checkId);
      const u = usageOf(index);
      index.usage = { day: u.day, checks: Math.max(0, u.checks - (review ? 0 : 1)), reviews: Math.max(0, u.reviews - (review ? 1 : 0)) };
      await store.writeJSON(INDEX_DOC(rec.uid), index);
      log?.warn('check.not-sent', { uid: rec.uid, checkId: entry.checkId, error });
    });
    let r;
    try {
      r = await host('POST', '/checks', rec.uid, {
        checkId: entry.checkId, review,
        adapter: {
          key: `${owner}/${appId}/${id}`, revision: got.revision, name: got.name, description: got.description || '',
          urlPatterns: got.urlPatterns || [], supportAreas: got.supportAreas || [], code: got.package.code,
        },
      });
    } catch (e) {
      await undo(e);
      return sendJSON(res, 502, { error: 'checker-unreachable', message: 'The checker is not answering. Try again in a few minutes; this did not count against your quota.' });
    }
    if (r.status !== 202) {
      await undo(`host ${r.status}`);
      const status = [429, 503].includes(r.status) ? r.status : 502;
      return sendJSON(res, status, { error: r.json?.error || 'checker-refused', message: `${r.json?.message || 'The checker could not take it.'} This did not count against your quota.` });
    }
    log?.info('check.asked', { uid: rec.uid, checkId: entry.checkId, adapter: `${owner}/${appId}/${id}`, revision: got.revision, review });
    return sendJSON(res, 202, { check: { ...entry, position: r.json?.check?.position ?? null }, framing: CHECK_FRAMING });
  }

  async function one(res, rec, checkId) {
    if (!CHECK_ID.test(checkId)) return sendJSON(res, 404, { error: 'not-found' });
    const index = await readIndex(rec.uid);
    const stored = index.checks.find((e) => e.checkId === checkId);
    if (!stored) return sendJSON(res, 404, { error: 'not-found', message: 'No such check on this account.' });
    const { entry, result: fresh, position, unreachable } = await refresh(rec.uid, stored);
    const result = fresh || (FINAL.has(entry.status) ? await store.readJSON(RESULT_DOC(rec.uid, checkId)) : null);
    return sendJSON(res, 200, {
      check: { ...entry, ...(position ? { position } : {}), ...(result ? { result } : {}) },
      ...(unreachable ? { note: 'The checker is not answering right now; this is the last state the toolkit knew.' } : {}),
      framing: CHECK_FRAMING,
    });
  }

  async function list(res, rec, search) {
    const q = new URLSearchParams(search || '');
    const index = await readIndex(rec.uid);
    let checks = index.checks.filter((e) => (!q.get('appId') || e.adapter.appId === q.get('appId')) && (!q.get('id') || e.adapter.id === q.get('id'))
      && (!q.get('owner') || e.adapter.owner === q.get('owner')));
    // Unfinished ones: ask the host (an account has at most two there at a time).
    checks = await Promise.all(checks.map(async (e, i) => (FINAL.has(e.status) || i > 20 ? e : { ...e, ...(await refresh(rec.uid, e)).entry })));
    return sendJSON(res, 200, { checks, usage: usageOf(index), framing: CHECK_FRAMING });
  }

  return async function route(req, res, method, pathname, search = '') {
    if (!base || !secret) return sendJSON(res, 503, { error: 'checks-unavailable', message: 'Server checks are not set up on this toolkit. Run the check on your own computer instead: node scripts/verify-adapters/run.mjs --check <adapter.js>.' });
    if (!bearerFrom(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const rec = await authenticate(req);
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized' });
    // A token bound to one app speaks for that app, not for the developer.
    if (rec.kind === 'app') return sendJSON(res, 403, { error: 'forbidden', message: 'Use your default token to ask for a check.' });
    try {
      if (pathname === ADAPTER_CHECKS_PREFIX) {
        if (method === 'POST') return await ask(req, res, rec);
        if (method === 'GET') return await list(res, rec, search);
      }
      const m = /^\/v1\/adapters\/checks\/([^/]+)$/.exec(pathname);
      if (m && method === 'GET') return await one(res, rec, m[1]);
      return sendJSON(res, 404, { error: 'not-found' });
    } catch (e) {
      return sendHttpError(res, e);
    }
  };
}
