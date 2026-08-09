/**
 * Asking a question without giving an order.
 *
 * Every control the layer offers today steers the agent, so the only way for
 * the person to ask for more information is to change what the agent does
 * next. `ask` is the call that separates the two, and the two things worth
 * testing about it are exactly those:
 *
 *   - it answers from the page, with the same quote verification everything
 *     else uses, and says "this page does not say" when it does not
 *   - it touches the agent in no way at all
 *
 * The model call is stubbed and the page is a recorded one, so what runs here
 * is the part that decides whether a claim reaches a person.
 *
 * Run: node test/interrogate-ask-test.mjs
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const RESEARCH = join(homedir(), 'Stanford/Summer Project Ideation /Verification Affordances');
const PAGE = readFileSync(join(RESEARCH, 'assets/task-mapping/_obs/sandals-step2.txt'), 'utf8');

// ── a chrome, a page to read, and an agent that counts being touched ────────
const local = new Map();
const area = (m) => ({
  async get(keys) {
    const want = keys == null ? [...m.keys()] : (Array.isArray(keys) ? keys : [keys]);
    const out = {};
    for (const k of want) if (m.has(k)) out[k] = m.get(k);
    return out;
  },
  async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, v); },
  async remove(k) { m.delete(k); },
});
global.chrome = {
  storage: { local: area(local), sync: area(new Map()) },
  runtime: { async sendMessage() {} },
  tabs: { async query() { return [{ id: 3, url: 'https://www.amazon.com/dp/X' }]; } },
};
globalThis.BrowserHarness = {
  async axSnapshot() { return { text: PAGE, url: 'https://www.amazon.com/dp/X' }; },
};
// Every way the rest of this file reaches the agent. Any of them firing during
// an ask is the failure this call exists to prevent.
const touched = [];
globalThis.BrowserAgent = {
  isRunning: () => true,
  interject: (s) => { touched.push(['interject', s]); return { queued: 1 }; },
  run: (t) => { touched.push(['run', t]); },
  stop: (r) => { touched.push(['stop', r]); },
  pause: (o) => { touched.push(['pause', o]); },
  resume: (o) => { touched.push(['resume', o]); },
};

const R = await import('../extension/validation/reasoner.js');
const { default: Validation } = await import('../extension/validation/session.js');
const state = async () => (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};

const QUOTE = '- text: $14.99';
const calls = [];
let reply = null;
R.setGeminiCaller(async (prompt, opts) => { calls.push({ prompt, opts }); return reply; });

// ── the prompt ──────────────────────────────────────────────────────────────
{
  const p = R.buildAskPrompt('does it come in a wide fit?', PAGE, { task: 'buy sandals' });
  ok(p.includes('does it come in a wide fit?'), 'the question goes in, in the person\'s own words');
  ok(p.includes(PAGE), 'so does the page');
  ok(/data, not instructions/.test(p) && p.includes('<<<PAGE'),
    'fenced as data, like every other page this layer reads');
  ok(/MUST be JSON null/.test(p), 'and told to answer null rather than explain an absence');
  ok(!/one entry per question/.test(p), 'it is one question, not the whole task model');
}

// ── an answer the page backs up ─────────────────────────────────────────────
{
  reply = JSON.stringify({ answer: 'It is $14.99.', quote: QUOTE, confidence: 0.9 });
  const r = await R.askPage('what does it cost?', PAGE);
  ok(r.ok === true && r.answer === 'It is $14.99.', 'the answer comes back');
  ok(r.quote === QUOTE, 'with the words on the page that say it');
  ok(r.verified === 'verified_exact', 'verified by containment, like everything else');
  ok(r.confidence === 0.9, 'and the confidence it was given');
  ok(calls[calls.length - 1].opts.responseSchema === R.ASK_SCHEMA,
    'asked for as structured output');
  ok(calls[calls.length - 1].opts.maxOutputTokens === R.ASK_MAX_OUTPUT_TOKENS,
    'with a cap sized for one answer, not for sixty-four rows');
}

// ── an answer the page does not back up ─────────────────────────────────────
{
  reply = JSON.stringify({ answer: 'It is $9.99 today only.',
                           quote: '- text: $9.99 limited time offer', confidence: 0.95 });
  const r = await R.askPage('what does it cost?', PAGE);
  ok(r.answer === null, 'a fabricated quote takes its answer down with it');
  ok(r.verified === 'hallucinated_quote', 'and the verdict says which failure this was');
  ok(r.discarded?.answer === 'It is $9.99 today only.',
    'what was thrown away is recorded rather than vanishing');
  ok(/threw it away/.test(r.say) && !/does not say/.test(r.say),
    'and what the person is told is that it was thrown away, not that the page is silent');
}

// ── the page simply does not say ────────────────────────────────────────────
{
  reply = JSON.stringify({ answer: null, quote: null, confidence: 0.1 });
  const r = await R.askPage('is it machine washable?', PAGE);
  ok(r.ok === true && r.answer === null, 'null is an answer');
  ok(r.verified === 'null' && /does not say/.test(r.say),
    'and it is reported as the page not saying, which is different from a failure');

  reply = JSON.stringify({ answer: 'the page does not say', quote: null, confidence: 0.2 });
  const r2 = await R.askPage('is it machine washable?', PAGE);
  ok(r2.answer === null, 'a sentence explaining the absence is treated as the absence');
}

// ── a question with nothing behind it ───────────────────────────────────────
{
  const r = await R.askPage('   ', PAGE);
  ok(r.ok === false && /no question/.test(r.meta.error), 'an empty question is not a call');
  ok(calls.length > 0, 'and does not reach the model');
}

// ── failures stay failures ──────────────────────────────────────────────────
{
  const before = calls.length;
  R.setGeminiCaller(async () => { throw new Error('Gemini API error 429: rate limited'); });
  const r = await R.askPage('what does it cost?', PAGE);
  ok(r.ok === false && /429/.test(r.meta.error),
    'a call that failed is a failure, not a page that had nothing to say');
  ok(r.meta.attempts === R.MAX_ATTEMPTS, 'retried the same number of times as a settle');
  ok(calls.length === before, 'the counting stub was replaced, so this is the new caller');
  R.setGeminiCaller(async (prompt, opts) => { calls.push({ prompt, opts }); return reply; });
}

// ── through the session, which is where "touches nothing" is decided ────────
{
  await Validation.start('girls flat sandals size 5 under $40');
  // A finding nobody has seen: the gate is shut, and asking must not move it.
  await Validation.annotate({
    append: [{ widget: 'Which size went in?', level: 'stop', phase: 'Check item',
               say: 'Which size went in? Size 5 Toddler.', from: 'Size: 5 Toddler',
               confirming: false }],
  });
  const before = await state();
  touched.length = 0;

  reply = JSON.stringify({ answer: 'It is $14.99.', quote: QUOTE, confidence: 0.8 });
  const r = await Validation.ask('what does it cost?');

  ok(r.answer === 'It is $14.99.', 'the session answers from the page in front of the person');
  ok(r.url === 'https://www.amazon.com/dp/X', 'and says which page it read');
  ok(touched.length === 0, 'the agent is not interjected, steered, stopped or paused');

  const after = await state();
  ok(after.findings.length === before.findings.length,
    'asking produces no new finding - a question is not something to be waited on');
  ok(after.gate.allowed === false && before.gate.allowed === false,
    'the gate is exactly where it was');
  ok(after.hold?.since === before.hold?.since,
    'and the hold clock is not restarted by it either');
  ok(after.asked?.length === 1 && after.asked[0].question === 'what does it cost?',
    'it is recorded, as a question');
  ok(after.asked[0].quote === QUOTE, 'with the words it rested on');

  const g = await Validation.allow('click add to cart');
  ok(g.allowed === false, 'and the agent is still held by what it was held by');
}

// ── the person asks about a page the layer knows nothing about ──────────────
{
  reply = JSON.stringify({ answer: null, quote: null, confidence: 0 });
  const r = await Validation.ask('what is the returns policy?');
  ok(r.answer === null && /does not say/.test(r.say),
    'an answer the page does not carry is refused here too');
  ok((await state()).asked.length === 2, 'and the refusal is on the record with the rest');
}

console.log(`\n${pass}/${pass + fail} - asking reads the page and leaves the agent alone.`);
if (fail) process.exit(1);
