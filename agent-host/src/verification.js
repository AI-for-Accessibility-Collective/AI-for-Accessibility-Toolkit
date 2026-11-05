// What happens after the agent offers an adapter (adapter_ready). The person
// can use it at once: its latest preview passed the agent's checks on their
// page. A fuller check then runs here in the background (checks.js: the
// verifier on the test pages and the site copies, also narrow and with
// reduced motion, axe-core, and that disable() puts the page back), and, when
// the person asks, a full review too (the same check, then an independent
// reviewer). Each adapter in a chat carries the state of both (`check`,
// `review`), and the sidebar shows it.
//
// When either finds problems in the code it checked, and that code is still
// the adapter's, the agent is asked to fix them, as a message in the chat
// once no run is going (the person sees one line saying so). Its next
// adapter_ready offers the new version, which is checked again. It is asked
// at most `maxFixes` times for an adapter; after that the person is told.
//
// A new version stops the checks of the old one. So does a preview of
// changed code: the agent is rebuilding, and its next adapter_ready starts
// the checks again.
//
// An adapter made for some sites only (its runsOn names them) is not run on
// the test pages, which do not have what it changes: it is checked on the
// copies the person's browser saved of their pages on those sites
// (page-data.js), with the checks its preview passed there, and on the
// recorded copies of those sites.

import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { matchUrlPattern } from '../../toolkit/protocol/adapter/index.js';

const hashOf = (code) => createHash('sha256').update(code).digest('hex');
const LIVE = new Set(['queued', 'running']);
const MAX_LISTED = 15;

/** The state the sidebar shows, from a check job's view. */
export function stateOf(view, kind, hash) {
  const base = { checkId: view.checkId, hash, at: new Date().toISOString() };
  if (view.status === 'queued') return { ...base, status: 'queued', position: view.position || null };
  if (view.status === 'running') return { ...base, status: 'running', startedAt: view.startedAt, ...(view.reused ? { reused: true } : {}) };
  if (view.status === 'cancelled') return { ...base, status: 'cancelled' };
  if (view.status === 'failed') return { ...base, status: 'failed', error: view.error || 'The check could not run.' };
  const check = view.result?.check || {};
  const s = check.summary || {};
  const failing = (check.runs || []).filter(r => r.status === 'fail').slice(0, MAX_LISTED).map(r => ({ name: r.name, problems: r.problems.slice(0, 5) }));
  const out = { ...base, passed: s.passed || 0, failed: s.failed || 0, skipped: s.skipped || 0, appliedOn: s.appliedOnTestPages || 0, testPages: s.testPages || 0, failing,
    // Made for some sites: checked on copies of the person's pages instead of the test pages.
    ...(s.narrow ? { narrow: true, ownPages: s.ownPages || 0, appliedOnOwnPages: s.appliedOnOwnPages || 0, ownChecks: s.ownChecks || 0 } : {}) };
  if (kind === 'review') {
    const r = view.result?.review || {};
    out.verdict = r.verdict || null;
    if (r.report) out.report = String(r.report).slice(0, 6000);
    if (!r.verdict) return { ...out, status: 'failed', error: r.error || 'The reviewer did not finish.' };
    return { ...out, status: r.verdict === 'issues' || out.failed ? 'problems' : 'passed' };
  }
  return { ...out, status: out.failed ? 'problems' : 'passed' };
}

/** What the agent is told to fix. */
function fixMessage(adapter, state, kind) {
  const lines = [`The background ${kind === 'review' ? 'full review' : 'check'} of “${adapter.name}” (${adapter.file}, the version you offered last) found problems.`];
  if (state.failing?.length) {
    const where = state.narrow ? 'copies of the person\'s pages it is for (saved when you previewed it), with your checks,' : 'its test pages and recorded copies of real sites';
    lines.push('', `The verifier ran it on ${where}: ${state.failed} run${state.failed === 1 ? '' : 's'} failed:`);
    for (const f of state.failing) lines.push(`- ${f.name}: ${f.problems.join('; ') || 'failed'}`);
  }
  if (kind === 'review' && state.report) lines.push('', 'The reviewer\'s report:', state.report);
  lines.push('', 'Fix what is the adapter\'s, preview it again on the person\'s page with your checks, and offer it again with adapter_ready. If a problem is the test page\'s or the site\'s, not the adapter\'s, say so in one sentence and leave it. Do not ask the person questions for this unless a fix would change what they asked for.');
  return lines.join('\n');
}

export function createVerification({ checks, chats, pageData, workDir, log, maxFixes = 2 }) {
  const jobs = new Map();    // checkId -> {uid, chatId, adapterId, hash, kind}
  const waiting = new Map(); // uid -> [{chatId, adapterId, hash, kind, text, shown}] fixes to ask for once no run is going
  const reviewsAfter = new Map(); // checkId of a running background check -> {uid, chatId, adapterId, hash, kind: 'review'}, a review that starts when it ends

  const adapterOf = (uid, chatId, adapterId) => {
    try { return chats.get(uid, chatId).adapters.find(a => a.id === adapterId) || null; } catch { return null; }
  };
  const codeHash = (uid, file) => { try { return hashOf(readFileSync(path.join(workDir(uid), file), 'utf8')); } catch { return null; } };
  const set = (uid, chatId, adapterId, patch) => { try { chats.updateAdapter(uid, chatId, adapterId, patch); } catch { /* the chat is gone */ } };

  function stop(predicate, why = 'cancelled') {
    for (const [checkId, j] of jobs) {
      if (!predicate(j)) continue;
      jobs.delete(checkId);
      checks?.cancel(j.uid, checkId);
      set(j.uid, j.chatId, j.adapterId, { [j.kind]: { checkId, hash: j.hash, status: 'cancelled', why, at: new Date().toISOString() } });
    }
    for (const [checkId, j] of reviewsAfter) {
      if (!predicate(j)) continue;
      reviewsAfter.delete(checkId);
      set(j.uid, j.chatId, j.adapterId, { review: { hash: j.hash, status: 'cancelled', why, at: new Date().toISOString() } });
    }
  }

  /** Start the background check (or, asked for, the full review) of an adapter as it is now. */
  function start(uid, chatId, adapterId, { review = false } = {}) {
    const kind = review ? 'review' : 'check';
    const adapter = adapterOf(uid, chatId, adapterId);
    if (!adapter) throw Object.assign(new Error('no such adapter in this chat'), { status: 404 });
    if (!checks) { set(uid, chatId, adapterId, { [kind]: { status: 'unavailable', at: new Date().toISOString() } }); return; }
    // A new version stops everything checking the old one; a review, an earlier review.
    stop(j => j.uid === uid && j.chatId === chatId && j.adapterId === adapterId && (review ? j.kind === 'review' : true), 'replaced');
    // The version offered, as adapter_ready kept it.
    let code;
    try { code = readFileSync(path.join(workDir(uid), '..', 'offered', chatId, `${adapter.id}.js`), 'utf8'); } catch { code = null; }
    if (!code || hashOf(code) !== adapter.hash) {
      set(uid, chatId, adapterId, { [kind]: { status: 'cancelled', why: 'changed', at: new Date().toISOString() } });
      return;
    }
    // A review asked for while the background check of this code runs waits for it, rather than checking it a second time.
    if (review && adapter.check?.hash === adapter.hash && LIVE.has(adapter.check.status) && jobs.has(adapter.check.checkId)) {
      reviewsAfter.set(adapter.check.checkId, { uid, chatId, adapterId, hash: adapter.hash, kind: 'review' });
      set(uid, chatId, adapterId, { review: { hash: adapter.hash, status: 'queued', after: 'check', at: new Date().toISOString() } });
      return;
    }
    const checkId = `chk_${randomBytes(12).toString('hex')}`;
    jobs.set(checkId, { uid, chatId, adapterId, hash: adapter.hash, kind });
    // The job's first change (queued) comes through onChange.
    // The person's own pages: the copies their browser saved of pages it runs
    // on, with the checks its preview passed (kept by the code they checked).
    const runsOn = adapter.runsOn || [];
    const copies = pageData?.copies ? pageData.copies(uid, chatId, { matches: (url) => runsOn.some(p => matchUrlPattern(p, url)) }) : [];
    let own = [];
    try { own = JSON.parse(readFileSync(path.join(workDir(uid), '..', 'previews', chatId, `${adapter.hash}.checks.json`), 'utf8')); } catch { /* previewed before checks were kept */ }
    // A review of code whose background check finished: the reviewer starts at once, with that check's report.
    let report = null;
    if (review && adapter.check?.hash === adapter.hash && ['passed', 'problems'].includes(adapter.check.status)) {
      try { report = checks.get(uid, adapter.check.checkId).result?.check || null; } catch { report = null; }
    }
    checks.submit(uid, { checkId, review, adapter: { key: `assistant/${adapter.id}`, name: adapter.name, description: adapter.about, urlPatterns: runsOn, supportAreas: adapter.supportAreas, code } },
      { copies, checks: Array.isArray(own) ? own : [], report });
  }

  function onChange(view) {
    const j = jobs.get(view.checkId);
    if (!j) return;
    const state = stateOf(view, j.kind, j.hash);
    if (!LIVE.has(state.status)) jobs.delete(view.checkId);
    if (state.status === 'cancelled') return; // stop() said why
    set(j.uid, j.chatId, j.adapterId, { [j.kind]: state });
    log?.info('verify.state', { uid: j.uid, chatId: j.chatId, kind: j.kind, status: state.status });
    // The review that waited for this check starts now, with its report (or, if it could not run, with its own check).
    const after = !LIVE.has(state.status) && reviewsAfter.get(view.checkId);
    if (after) {
      reviewsAfter.delete(view.checkId);
      try { start(after.uid, after.chatId, after.adapterId, { review: true }); } catch (e) { log?.warn('verify.review-not-started', { uid: after.uid, chatId: after.chatId, error: e.message }); }
    }
    if (state.status !== 'problems') return;
    const adapter = adapterOf(j.uid, j.chatId, j.adapterId);
    if (!adapter || adapter.hash !== j.hash) return; // an older version
    if ((adapter.fixes || 0) >= maxFixes) { set(j.uid, j.chatId, j.adapterId, { gaveUp: true }); return; }
    const list = waiting.get(j.uid) || [];
    list.push({ chatId: j.chatId, adapterId: j.adapterId, hash: j.hash, kind: j.kind,
      text: fixMessage(adapter, state, j.kind),
      shown: `The background ${j.kind === 'review' ? 'full review' : 'check'} found problems in “${adapter.name}”. The assistant is fixing them.` });
    waiting.set(j.uid, list);
    askToFix(j.uid);
  }

  /** Ask the agent for the next fix that is still about the adapter's code, once no run is going. */
  async function askToFix(uid) {
    const list = waiting.get(uid) || [];
    while (list.length && !chats.activeChat(uid)) {
      const w = list.shift();
      const adapter = adapterOf(uid, w.chatId, w.adapterId);
      // Stale: the agent offered or wrote another version meanwhile.
      if (!adapter || adapter.hash !== w.hash || codeHash(uid, adapter.file) !== w.hash) continue;
      try {
        await chats.send(uid, w.chatId, w.text, { shown: w.shown });
        set(uid, w.chatId, w.adapterId, { fixes: (adapter.fixes || 0) + 1, fixing: true });
        log?.info('verify.fix-asked', { uid, chatId: w.chatId, kind: w.kind });
      } catch (e) {
        log?.warn('verify.fix-not-asked', { uid, chatId: w.chatId, error: e.message });
      }
    }
    if (!list.length) waiting.delete(uid);
  }

  return {
    start,
    onChange,
    /** A preview of changed code in this file: the agent is rebuilding, so what checks the old code stops. */
    codeChanged(uid, chatId, file, hash) {
      stop(j => j.uid === uid && j.chatId === chatId && j.hash !== hash && adapterOf(uid, chatId, j.adapterId)?.file === file, 'changed');
    },
    /** A run ended: ask for a waiting fix. */
    afterRun: (uid) => askToFix(uid),
    /** The chat was deleted. */
    forgetChat(uid, chatId) {
      for (const [checkId, j] of jobs) if (j.uid === uid && j.chatId === chatId) { jobs.delete(checkId); checks?.cancel(uid, checkId); }
      for (const [checkId, j] of reviewsAfter) if (j.uid === uid && j.chatId === chatId) reviewsAfter.delete(checkId);
      const list = waiting.get(uid);
      if (list) waiting.set(uid, list.filter(w => w.chatId !== chatId));
    },
  };
}
