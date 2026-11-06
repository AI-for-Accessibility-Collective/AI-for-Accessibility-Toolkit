// adapter_verify and app_verify on the toolkit's MCP endpoint
// (toolkit/protocol/adapter/verify.js): a coding agent verifies what its
// developer built, the way the toolkit does in the cloud for the assistant
// sidebar, and gets a short report with the changes to make.
//
// adapter_verify asks for the check and the full review of a published web
// adapter (adapter-checks.js, run on the agent host), writes a few lines on
// what the adapter does (the service's model, from its code), says how far
// the work is as it goes (`progress`, which registry.js sends as MCP
// progress notifications), and waits up to waitSeconds; past that it returns
// the checkId to call again with.
//
// app_verify drives each adaptation of an app connected now (the relay):
// describe, targets, query, check, apply with its default parameters, query
// again, then undo, and reports what each step answered. It changes the
// running app for a moment and puts it back.
//
// Never logged: the adapter's code, the summary, the reports.

import crypto from 'node:crypto';
import { withAiContext } from './ai-context.js';
import { VERIFY_TOOL_SCHEMAS, VERIFY_TOOL_DESCRIPTIONS, PROFILE_VERSION, adapterRefOf } from '../../toolkit/protocol/adapter/index.js';

const FINAL = new Set(['done', 'failed', 'cancelled']);
const FOCUS_WORDS = 'the code; what people perceive; how people operate it';
const APP_FRAMING = 'This drives each adaptation through the running app and reports what the app answered: it shows whether an adaptation can be switched on, read and undone, not whether it helps the people it is for. Only people trying it can show that.';

const toolError = (code, message) => Object.assign(new Error(message), { code });
const sentences = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The findings a review report lists, by level: [{level, text}], highest first. */
export function findingsOf(report) {
  const out = [];
  for (const line of String(report || '').split('\n')) {
    const m = /^\s*(?:[-*]|\d+\.)?\s*\**\[(high|medium|low)\]\**[:\s-]*(.+)$/i.exec(line);
    if (m) out.push({ level: m[1].toLowerCase(), text: m[2].trim().slice(0, 300) });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** A finished (or failed) adapter check as the report a coding agent acts on. */
export function adapterReport(check, framing) {
  const result = check.result || {};
  const s = result.check?.summary || null;
  const failedRuns = (result.check?.runs || []).filter((r) => r.status === 'fail');
  const review = result.review || null;
  const findings = findingsOf(review?.report);
  const count = (l) => findings.filter((f) => f.level === l).length;
  const actions = [];
  if (check.status === 'failed') actions.push(`The verification did not finish: ${check.error || 'try again later'}. If the adapter loads and enable() returns, ask again.`);
  for (const r of failedRuns.slice(0, 6)) {
    const why = r.problems?.[0] ? `: ${r.problems[0]}` : '';
    const advice = r.advice?.[0] ? ` (${r.advice[0]})` : '';
    actions.push(`Fix the failed run "${r.name}"${why}${advice}.`);
  }
  if (failedRuns.length > 6) actions.push(`${failedRuns.length - 6} more runs failed: see check.runs.`);
  for (const f of findings.filter((x) => x.level !== 'low').slice(0, 8)) actions.push(`Fix (${f.level}): ${f.text}`);
  if (review?.error) actions.push(`${review.error} Verify again to finish the review.`);
  if (check.status === 'done') {
    actions.push(actions.length
      ? 'Then publish a new revision and verify again.'
      : 'Nothing to change from these checks. Next, have people who meet the barrier it is for try it on the pages they use.');
  }
  const lines = [`${check.name || check.adapter?.id} (revision ${check.revision})`];
  if (check.about) lines.push(`What it does:\n${check.about}`);
  if (s) {
    const own = s.narrow ? ` On the person's own pages: it applied on ${s.appliedOnOwnPages} of ${s.ownPages}.` : '';
    lines.push(`Check: ${s.passed} of ${s.passed + s.failed} runs passed, ${s.failed} failed${s.skipped ? `, ${s.skipped} skipped` : ''}; it applied on ${s.appliedOnTestPages} of ${s.testPages} test pages.${own}`);
  } else if (check.status === 'failed') lines.push(`The check did not finish: ${check.error || 'no report'}.`);
  if (review) lines.push(review.verdict ? `Review: ${review.verdict === 'ok' ? 'no issues found' : `issues: ${count('high')} high, ${count('medium')} medium, ${count('low')} low`} (${FOCUS_WORDS}).` : `Review: ${review.error || 'did not finish'}.`);
  if (actions.length) lines.push(`Recommended actions:\n${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`);
  lines.push(framing);
  return {
    status: check.status, checkId: check.checkId, adapter: check.adapter, revision: check.revision,
    ...(check.about ? { summary: check.about } : {}),
    ...(s ? { check: { ...s, failedRuns: failedRuns.map((r) => ({ name: r.name, problems: r.problems || [], advice: r.advice || [] })) } } : {}),
    ...(review ? { review: { verdict: review.verdict ?? null, findings: { high: count('high'), medium: count('medium'), low: count('low') }, report: review.report || '', ...(review.error ? { error: review.error } : {}) } } : {}),
    actions, report: lines.join('\n\n'),
  };
}

/** How far a check is, in one sentence. */
export function progressText(check) {
  if (check.status === 'queued') return check.position ? `Waiting for the checker: number ${check.position} in line.` : 'Waiting for the checker.';
  if (check.status === 'running' && check.stage === 'review') {
    const s = check.checkSummary;
    return `${s ? `Check done: ${s.passed} runs passed, ${s.failed} failed. ` : ''}Reviewing: ${check.reviewersDone || 0} of ${check.reviewers || 3} reviewers finished (${FOCUS_WORDS}).`;
  }
  if (check.status === 'running') return 'Running the check: the adapter on test pages and recorded copies of real sites, with axe-core, layout and keyboard checks, then disable().';
  if (check.status === 'done') return 'Done.';
  return check.error ? `Stopped: ${check.error}` : `Stopped (${check.status}).`;
}

/**
 * @param {object} o
 * @param {ReturnType<import('./adapter-checks.js').createAdapterChecks>} o.checks
 * @param {object} o.relay
 * @param {Function|null} [o.aiCaller]  the service's model, for the summary
 */
export function createVerify({ checks, relay, aiCaller = null, log, pollMs = 5000, now = () => Date.now() }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** A few lines on what an adapter does, from its code; its own description when there is no model. */
  async function summarize(uid, got) {
    const fallback = got.description ? `- ${got.description}` : '';
    if (!aiCaller) return fallback;
    const prompt = [
      `Below is the code of a web accessibility adapter called "${got.name}". Its author describes it as: ${got.description || '(no description)'}`,
      'In 2 to 4 short bullet points, each starting with "- ", say what it does for the people who use it: its main features and what it changes on pages. Plain words; no code names. Answer with the bullet points only.',
      `<code>\n${String(got.package.code).slice(0, 40_000)}\n</code>`,
    ].join('\n\n');
    try {
      const text = await withAiContext(uid, 'verify.summary', () => Promise.race([aiCaller(prompt), sleep(45_000).then(() => null)]));
      const bullets = String(text || '').split('\n').map((l) => l.trim()).filter((l) => /^[-*•]\s+/.test(l)).slice(0, 4).map((l) => `- ${l.replace(/^[-*•]\s+/, '')}`);
      return bullets.length ? bullets.join('\n') : fallback;
    } catch (e) {
      log?.warn('verify.summary-failed', { uid, errorCode: e?.code || e?.name || 'error' });
      return fallback;
    }
  }

  async function adapterVerify(uid, args, auth, { progress = () => {} } = {}) {
    if (auth?.kind === 'app') throw toolError('forbidden', 'Use your default token to verify an adapter.');
    if (!checks.available()) throw toolError('checks-unavailable', 'Server checks are not set up on this toolkit. Run the check on your own computer instead: node scripts/verify-adapters/run.mjs --check <adapter.js>.');
    if (!args.checkId && !args.adapter) throw toolError('bad-request', 'Name the adapter: { adapter: "bigger-buttons" }, or { checkId } to keep waiting.');
    const deadline = now() + (args.waitSeconds ?? 240) * 1000;
    let checkId = args.checkId;
    if (!checkId) {
      let r;
      try { r = await checks.start(uid, { id: args.adapter, review: args.review !== false }); } catch (e) { throw toolError(e.code || 'failed', e.message); }
      if (r.status >= 400) throw toolError(r.body.error || 'failed', r.body.message || 'The check could not be asked for.');
      checkId = r.body.check.checkId;
      progress(`${r.body.reused ? 'Joined the verification already running' : 'Asked for a verification'} of ${r.got.name} (revision ${r.got.revision}): ${args.review === false ? 'the check' : 'the check, then three reviewers'}.`);
      if (!r.body.check.about) {
        const about = await summarize(uid, r.got);
        if (about) { await checks.annotate(uid, checkId, about); progress(`What it does:\n${about}`); }
      }
    }
    let said = '';
    for (;;) {
      const st = await checks.status(uid, checkId);
      if (st.status !== 200) throw toolError(st.body.error || 'not-found', st.body.message || 'No such verification on this account.');
      const check = st.body.check;
      const text = progressText(check);
      if (text !== said) { said = text; progress(text); }
      if (FINAL.has(check.status)) return adapterReport(check, st.body.framing);
      if (now() >= deadline) {
        return {
          status: check.status, checkId, adapter: check.adapter, revision: check.revision, progress: text,
          next: `Not done yet. Call adapter_verify again with { checkId: "${checkId}" } to keep waiting. A full review takes about 15 minutes.`,
        };
      }
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    }
  }

  // ── apps ────────────────────────────────────────────────────────────────

  /** Parameters an adaptation takes by default: its schema's defaults, else the smallest value it allows. */
  function defaults(schema) {
    const out = {};
    for (const [k, p] of Object.entries(schema?.properties || {})) {
      if (!(schema.required || []).includes(k) && p.default === undefined) continue;
      out[k] = p.default ?? p.enum?.[0] ?? (p.type === 'number' || p.type === 'integer' ? (p.minimum ?? 1) : p.type === 'boolean' ? true : p.type === 'string' ? '' : p.type === 'array' ? [] : {});
    }
    return out;
  }

  /** A target to try it on: one the app offers, else one its descriptor names exactly. */
  function targetOf(d) {
    for (const t of d.targets || []) {
      const url = (t.urls || []).find((u) => /^https?:\/\/[^*/]+\//.test(u));
      if (url) return { url: url.replace(/\*.*$/, '') };
      if (t.applications?.[0] && t.platforms?.[0] && t.platforms[0] !== '*') return { platform: t.platforms[0], application: t.applications[0] };
    }
    return null;
  }

  async function appVerify(uid, args, auth, { progress = () => {} } = {}) {
    const live = relay.forUid(uid).filter((p) => p.appId === args.app && p.channel);
    if (!live.length) throw toolError('app-offline', `${args.app} is not connected right now. Open the app with your token so it connects, then verify again.`);
    const p = live[live.length - 1];
    let seq = 0;
    async function call(name, a) {
      const r = await relay.forward(p, { jsonrpc: '2.0', id: `verify-${++seq}`, method: 'tools/call', params: { name, arguments: a } }, { client: 'adapter_verify' });
      if (r?.error) return { status: 'error', reasons: [{ message: r.error.message }] };
      const res = r?.result || {};
      return res.structuredContent || (() => { try { return JSON.parse(res.content?.[0]?.text || '{}'); } catch { return {}; } })();
    }
    const reasonOf = (o) => o?.reasons?.[0]?.message || o?.reasons?.[0]?.code || '';
    const adapters = (p.adapters || []).filter((d) => !args.adapters || args.adapters.includes(d.id));
    progress(`Verifying ${p.application?.name || args.app}: ${sentences(adapters.length, 'adaptation')}, through the running app.`);
    const results = [];
    for (const d of adapters) {
      const ref = adapterRefOf(d);
      const ops = d.operations || [];
      const steps = [];
      const step = (name, ok, said) => steps.push({ step: name, ok, ...(said ? { said: String(said).slice(0, 300) } : {}) });
      progress(`${d.name}: describing, reading, applying and undoing it.`);
      const described = await call('adapter_describe', { adapterRef: { appId: d.appId, id: d.id } });
      step('describe', described.status === 'ok' || !!described.descriptor, described.availability?.available === false ? `not available: ${reasonOf(described.availability)}` : reasonOf(described));
      let target = null;
      if (ops.includes('targets')) {
        const t = await call('adapter_targets', { adapterRef: ref });
        target = t.candidates?.[0]?.target || null;
        step('targets', !!target, target ? `${t.candidates.length} found` : reasonOf(t) || 'no targets offered');
      }
      target = target || targetOf(d);
      if (!target) { step('apply', false, 'no target to try it on: offer adapter_targets, or name an exact URL or application in its targets'); results.push({ adapter: d.id, name: d.name, steps }); continue; }
      const parameters = defaults(d.inputSchema);
      if (ops.includes('query')) { const q = await call('adapter_query', { adapterRef: ref, target }); step('query', ['ok', 'partial'].includes(q.status) || !!q.state, reasonOf(q) || (q.state ? `enabled: ${q.state.enabled}` : '')); }
      if (ops.includes('check')) { const c = await call('adapter_check', { adapterRef: ref, target, desired: d.mode === 'action' ? { parameters } : { enabled: true, parameters } }); step('check', c.compatible === true, reasonOf(c)); }
      const applied = await call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref, target, desired: d.mode === 'action' ? { parameters } : { enabled: true, parameters }, requestKey: `verify-${crypto.randomBytes(6).toString('hex')}` });
      step('apply', ['applied', 'noop'].includes(applied.status), `${applied.status}${reasonOf(applied) ? `: ${reasonOf(applied)}` : ''}${applied.verification ? ` (${applied.verification})` : ''}`);
      if (ops.includes('query') && d.mode !== 'action') { const q = await call('adapter_query', { adapterRef: ref, target }); step('query after', q.state?.enabled === true, q.state ? `enabled: ${q.state.enabled}` : reasonOf(q)); }
      // Nothing changed (it was already so): nothing to undo, and switching it off would change the app.
      if (applied.status === 'noop') step('undo', true, 'nothing to undo: it was already so');
      else if (applied.undo?.receiptId) { const u = await call('adapter_revert', { receiptId: applied.undo.receiptId }); step('undo', ['applied', 'noop'].includes(u.status), `${u.status}${reasonOf(u) ? `: ${reasonOf(u)}` : ''}`); }
      else if (d.mode !== 'action') { const off = await call('adapter_apply', { profileVersion: PROFILE_VERSION, adapterRef: ref, target, desired: { enabled: false }, requestKey: `verify-${crypto.randomBytes(6).toString('hex')}` }); step('switch off', ['applied', 'noop'].includes(off.status), `${off.status}${reasonOf(off) ? `: ${reasonOf(off)}` : ''} (no undo receipt)`); }
      results.push({ adapter: d.id, name: d.name, needs: (d.needs || []).map((n) => n.phrase), steps });
    }
    return appReport(p, results);
  }

  function appReport(p, results) {
    const actions = [];
    for (const r of results) {
      for (const s of r.steps.filter((x) => !x.ok)) actions.push(`${r.name}: ${s.step} did not work${s.said ? ` (${s.said})` : ''}. Fix it in the app's adapter.`);
      if (r.steps.some((s) => s.step === 'switch off')) actions.push(`${r.name}: apply gives no undo receipt. Return undo from enable() (fromToggleAdapter does), so a person can undo it.`);
      if (!r.needs?.length) actions.push(`${r.name}: declares no needs. Add the needs it meets to its descriptor ({id, phrase, description, abilities}), so the toolkit can suggest it to the people it fits.`);
    }
    actions.push(actions.length ? 'Then reconnect the app and verify again.' : 'Nothing to change from these steps. Next, have people who meet the barriers it is for try it.');
    const lines = [`${p.application?.name || p.appId}: ${sentences(results.length, 'adaptation')} verified through the running app.`];
    for (const r of results) lines.push(`${r.name}${r.needs?.length ? ` (meets: ${r.needs.join('; ')})` : ''}: ${r.steps.map((s) => `${s.step} ${s.ok ? 'ok' : 'FAILED'}`).join(', ')}.`);
    lines.push(`Recommended actions:\n${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`, APP_FRAMING);
    return { app: p.appId, name: p.application?.name || p.appId, adapters: results, actions, report: lines.join('\n\n'), framing: APP_FRAMING };
  }

  const run = { adapter_verify: adapterVerify, app_verify: appVerify };
  return {
    tools: Object.fromEntries(Object.keys(VERIFY_TOOL_SCHEMAS).map((name) => [name, {
      schema: VERIFY_TOOL_SCHEMAS[name], description: VERIFY_TOOL_DESCRIPTIONS[name], readOnly: false, progress: true, run: run[name],
      textOf: (r) => r.report || `${r.progress}\n\n${r.next}`,
    }])),
  };
}
