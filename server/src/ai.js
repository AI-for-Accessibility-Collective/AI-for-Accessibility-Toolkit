// /v1/ai/…: the model behind the building blocks' ai.text and ai.vision
// (toolkit/blocks), for adapters that cannot hold a key of their own: the
// browser runtime's adapters call it through the extension with the
// person's token.
//
//   POST /v1/ai/text     {task, input, options?, adapter?}            -> {text|null, reason?}
//   POST /v1/ai/vision   {task, image: {mimeType, data}, input?, options?, adapter?} -> same
//   GET  /v1/ai/usage    today's calls against the limits, and whether AI is on
//   PUT  /v1/ai/settings {enabled}   switch it off or on for the account
//
// The service builds the prompt from the toolkit's default for the task and
// the builder's fields (toolkit/blocks/ai/prompts.js), runs it with its own
// key, and gates the answer with the catalog's checks (tools/utils/
// ai-output.js) before it goes back: a refusal, a guess or an answer of the
// wrong length comes back as null, which an adapter treats as "leave the page
// alone". Each account has a daily budget in US dollars, metered from the
// tokens Google bills for each call (gemini.js, GEMINI_PRICES), and each
// adapter in it a daily number of calls.
//
// What a page sends here is page content: neither the request log nor the
// AI call log keeps it (app.js, and the caller made with logContent off).

import { sendJSON, sendHttpError, readJSON, HttpError } from './http.js';
import { withAiContext } from './ai-context.js';
import { priceFor, costOf } from './gemini.js';
import { buildPrompt, TASKS, NO_ANSWER, PROMPT_VERSION } from '../../toolkit/blocks/ai/prompts.js';
import { rejectRewrite, rejectShortText, cleanShortText, startsWithRefusal, opensWithFirstPersonRefusal, containsUncertainty } from '../../tools/utils/ai-output.js';

export const AI_PREFIX = '/v1/ai';
export const AI_USAGE_DOC = (uid) => `users/${uid}/ai-usage.json`;
const MAX_INPUT_CHARS = 12_000;
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const FLUSH_MS = 2000;
// What a call is assumed to cost until Google says what it did: about four
// characters a token, an image about 1,100 tokens, and up to 800 tokens of
// answer and thinking. Held against the budget while the call is out, so
// calls made at once cannot run past it together.
const ESTIMATE = { charsPerToken: 4, imageTokens: 1100, outputTokens: 800 };

/** Whether the request log may keep a request's body: never for page content. */
export const aiContentLogged = (pathname) => !pathname.startsWith(`${AI_PREFIX}/`);

/** The answer as it may reach the page, or null with the reason. */
export function gateAnswer(task, answer, input, options = {}) {
  const t = TASKS[task];
  let text = String(answer ?? '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  if (!text || text.replace(/[\s.]/g, '') === NO_ANSWER || text.startsWith(NO_ANSWER)) return { text: null, reason: 'no-answer' };
  let reason = null;
  const max = options.maxChars || t.maxChars;
  switch (t.gate) {
    case 'rewrite':
      reason = rejectRewrite(text, input, { minRatio: options.minRatio ?? t.minRatio, maxRatio: options.maxRatio ?? t.maxRatio });
      break;
    case 'summary':
      reason = rejectRewrite(text, input, { maxRatio: options.maxRatio ?? 1, minChars: 20 });
      break;
    case 'short-passage':
      reason = rejectRewrite(text, '', { minChars: 3 })
        || (text.length > max ? `longer than ${max} characters` : null)
        || (startsWithRefusal(text) ? 'reads as a refusal' : null)
        || (containsUncertainty(text) ? 'reads as uncertain' : null);
      break;
    case 'short':
      text = cleanShortText(text);
      reason = rejectShortText(text, max);
      break;
    case 'description':
      reason = text.length < 3 ? 'too short'
        : text.length > Math.round(max * 1.25) ? `longer than ${max} characters`
        : startsWithRefusal(text) || opensWithFirstPersonRefusal(text) ? 'reads as a refusal'
        : containsUncertainty(text) && text.length < 200 ? 'reads as uncertain'
        : null;
      break;
    default:
      reason = 'unknown task';
  }
  return reason ? { text: null, reason } : { text };
}

/**
 * @param {object} o
 * @param {{readJSON: Function, writeJSON: Function}} o.store
 * @param {(uid: string, fn: () => Promise<any>) => Promise<any>} o.withUserLock
 * @param {(req: any) => Promise<any>} o.authenticate
 * @param {((prompt: string, opts?: {images?: object[]}) => Promise<string>)|null} o.caller  the model; null when the service has no key
 * @param {number} [o.dailyBudgetUsd]  US dollars per account per day (UTC)
 * @param {number} [o.dailyPerAdapter]  calls per adapter per day
 * @param {(model: string) => {input: number, output: number}} [o.price]  dollars per million tokens
 */
export function createAiRoutes({ store, withUserLock, authenticate, caller, log, dailyBudgetUsd = 200, dailyPerAdapter = 200, price, now = () => Date.now() }) {
  const usage = new Map();   // uid -> promise of its usage record
  const timers = new Map();  // uid -> flush timer
  const held = new Map();    // uid -> dollars held for calls still out
  const priceOf = price || ((model) => priceFor(model, now()));
  const dollars = (n) => Math.round(n * 1e6) / 1e6;
  const today = () => new Date(now()).toISOString().slice(0, 10);

  function load(uid) {
    if (!usage.has(uid)) {
      const p = store.readJSON(AI_USAGE_DOC(uid)).catch(() => null).then((doc) => ({
        day: doc?.day || today(), calls: doc?.calls || 0, spentUsd: doc?.spentUsd || 0, byAdapter: doc?.byAdapter || {}, enabled: doc?.enabled !== false,
      }));
      usage.set(uid, p);
      p.catch(() => usage.delete(uid));
    }
    return usage.get(uid).then((u) => {
      if (u.day !== today()) Object.assign(u, { day: today(), calls: 0, spentUsd: 0, byAdapter: {} });
      return u;
    });
  }

  function flushLater(uid) {
    if (timers.has(uid)) return;
    const t = setTimeout(() => {
      timers.delete(uid);
      withUserLock(uid, async () => {
        const p = usage.get(uid);
        if (!p) return; // forgotten: the account was deleted
        const u = await p;
        await store.writeJSON(AI_USAGE_DOC(uid), u);
      }).catch((e) => log?.warn('ai.usage-write', { uid, error: e }));
    }, FLUSH_MS);
    t.unref?.();
    timers.set(uid, t);
  }

  async function take(uid, adapter, estimate) {
    const u = await load(uid);
    if (!u.enabled) return { error: 'ai-off', status: 403, message: 'AI for adapters is switched off for this account.' };
    const out = held.get(uid) || 0;
    if (u.spentUsd + out + estimate > dailyBudgetUsd) return { error: 'ai-budget', status: 429, message: `This account reached its $${dailyBudgetUsd} AI budget for today.` };
    if (adapter && (u.byAdapter[adapter] || 0) >= dailyPerAdapter) return { error: 'ai-budget', status: 429, message: `This adapter used its ${dailyPerAdapter} AI calls for today.` };
    held.set(uid, out + estimate);
    u.calls++;
    if (adapter) u.byAdapter[adapter] = (u.byAdapter[adapter] || 0) + 1;
    flushLater(uid);
    return { usage: u };
  }

  // The call is back: release what was held and count what Google billed.
  function settle(uid, u, estimate, cost) {
    const left = (held.get(uid) || 0) - estimate;
    if (left > 1e-9) held.set(uid, left); else held.delete(uid);
    u.spentUsd = dollars(u.spentUsd + cost);
    flushLater(uid);
  }

  async function ask(req, res, rec, kind) {
    const body = await readJSON(req, { maxBytes: kind === 'vision' ? MAX_IMAGE_CHARS + 50_000 : 200_000 });
    const task = String(body.task || '');
    if (!TASKS[task] || TASKS[task].kind !== kind) {
      return sendJSON(res, 400, { error: 'bad-task', message: `Tasks for /v1/ai/${kind}: ${Object.entries(TASKS).filter(([, t]) => t.kind === kind).map(([k]) => k).join(', ')}.` });
    }
    const input = typeof body.input === 'string' ? body.input : '';
    if (kind === 'text' && !input.trim()) return sendJSON(res, 400, { error: 'bad-input', message: 'input is the text, and it is empty.' });
    if (input.length > MAX_INPUT_CHARS) return sendJSON(res, 413, { error: 'input-too-long', message: `input is at most ${MAX_INPUT_CHARS} characters; send one block at a time.` });
    let images = [];
    if (kind === 'vision') {
      const img = body.image;
      if (!img || !IMAGE_TYPES.includes(img.mimeType) || typeof img.data !== 'string' || !img.data || img.data.length > MAX_IMAGE_CHARS) {
        return sendJSON(res, 400, { error: 'bad-image', message: `image is {mimeType: ${IMAGE_TYPES.join(' | ')}, data: base64}, at most ${MAX_IMAGE_CHARS} characters.` });
      }
      images = [{ mimeType: img.mimeType, data: img.data }];
    }
    const adapter = typeof body.adapter === 'string' ? body.adapter.slice(0, 200) : '';
    let built;
    try {
      built = buildPrompt(task, input, body.options || {});
    } catch (e) {
      return sendJSON(res, 400, { error: 'bad-options', message: e.message });
    }
    if (!caller) return sendJSON(res, 503, { error: 'ai-unavailable', message: 'This toolkit has no AI model set up.' });
    const rate = priceOf(caller.model);
    const estimate = costOf({
      promptTokens: Math.ceil(built.prompt.length / ESTIMATE.charsPerToken) + images.length * ESTIMATE.imageTokens,
      outputTokens: ESTIMATE.outputTokens,
    }, rate);
    const taken = await take(rec.uid, adapter, estimate);
    if (taken.error) return sendJSON(res, taken.status, { error: taken.error, message: taken.message });

    const started = Date.now();
    let answer, cost = 0;
    try {
      answer = await withAiContext(rec.uid, `blocks.${task}`, () => caller(built.prompt, { images, onUsage: (used) => { cost = costOf(used, priceOf(used.model || caller.model)); } }));
    } catch (e) {
      settle(rec.uid, taken.usage, estimate, cost);
      log?.warn('ai.blocks', { uid: rec.uid, task, adapter, outcome: 'model-error', error: e, costUsd: dollars(cost), ms: Date.now() - started });
      return sendJSON(res, 200, { text: null, reason: 'model-error', task, version: PROMPT_VERSION });
    }
    settle(rec.uid, taken.usage, estimate, cost);
    const gated = gateAnswer(task, answer, input, built.options);
    log?.info('ai.blocks', {
      uid: rec.uid, task, adapter, outcome: gated.text === null ? 'rejected' : 'ok', reason: gated.reason,
      inputChars: input.length, answerChars: gated.text?.length, costUsd: dollars(cost), ms: Date.now() - started,
      message: `AI block ${task} for ${adapter || 'an adapter'} ${gated.text === null ? `rejected (${gated.reason})` : 'ok'}`,
    });
    return sendJSON(res, 200, { ...gated, task, version: PROMPT_VERSION, usage: { spentUsd: taken.usage.spentUsd, budgetUsd: dailyBudgetUsd } });
  }

  async function route(req, res, method, pathname) {
    const rec = await authenticate(req);
    if (!rec) return sendJSON(res, 401, { error: 'unauthorized' });
    try {
      if (method === 'POST' && pathname === `${AI_PREFIX}/text`) return await ask(req, res, rec, 'text');
      if (method === 'POST' && pathname === `${AI_PREFIX}/vision`) return await ask(req, res, rec, 'vision');
      if (method === 'GET' && pathname === `${AI_PREFIX}/usage`) {
        const u = await load(rec.uid);
        return sendJSON(res, 200, { day: u.day, spentUsd: u.spentUsd, budgetUsd: dailyBudgetUsd, calls: u.calls, perAdapterLimit: dailyPerAdapter, byAdapter: u.byAdapter, enabled: u.enabled, available: !!caller });
      }
      if (method === 'PUT' && pathname === `${AI_PREFIX}/settings`) {
        // A token bound to one app speaks for that app, not for the account.
        if (rec.kind === 'app') return sendJSON(res, 403, { error: 'forbidden', message: 'Use your default token or the console.' });
        const body = await readJSON(req);
        if (typeof body.enabled !== 'boolean') return sendJSON(res, 400, { error: 'bad-request', message: 'Send {enabled: true|false}.' });
        const u = await load(rec.uid);
        u.enabled = body.enabled;
        await withUserLock(rec.uid, () => store.writeJSON(AI_USAGE_DOC(rec.uid), u));
        return sendJSON(res, 200, { enabled: u.enabled });
      }
    } catch (e) {
      if (e instanceof HttpError) return sendHttpError(res, e);
      throw e;
    }
    return sendJSON(res, 404, { error: 'not-found' });
  }

  /** Drop what is kept for a deleted account (inside its queue). */
  function forget(uid) {
    usage.delete(uid);
    held.delete(uid);
    clearTimeout(timers.get(uid));
    timers.delete(uid);
  }

  return { route, forget };
}
