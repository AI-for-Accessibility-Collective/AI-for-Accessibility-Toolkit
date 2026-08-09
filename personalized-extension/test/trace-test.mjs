/**
 * The trace, keyed to task model nodes.
 *
 * Findings have carried `node`, `cluster`, `moment` and `verified` for a while
 * and nothing read any of them. This is what reads them, and what it buys is
 * one thing: "go back to where the size was chosen" becomes a lookup instead
 * of a scan of a click list.
 *
 * What it covers:
 *   - a page read is filed under the node the page was serving, with the
 *     findings that came off it
 *   - an agent action is filed under wherever the run is, with its step
 *   - an answer is filed under the node whose question was answered
 *   - a lookup by node finds all three
 *   - the record survives being re-read from storage, which is what a worker
 *     restart looks like
 *   - and what it says about going back is that it re-opens a decision, not
 *     that it undoes anything
 *
 * Run: node test/trace-test.mjs
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
const GOLD = JSON.parse(readFileSync(join(RESEARCH, 'taskmodel/gold-v2/amazon-gold.json'), 'utf8'));

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
  tabs: { async query() { return [{ id: 5 }]; } },
};
globalThis.BrowserHarness = {
  async axSnapshot() { return { text: PAGE, url: 'https://www.amazon.com/dp/X' }; },
};

const R = await import('../extension/validation/reasoner.js');
const Trace = await import('../extension/validation/trace.js');
const { default: Validation } = await import('../extension/validation/session.js');

// The task model is what gives a node its name. Without one loaded the trace
// still records, it just has nothing to call the node.
const loaded = globalThis.ValidationTaskModel.load(GOLD, 'test');
ok(loaded.loaded === true, 'the real gold model is loaded');

const flat = R.flattenModel(GOLD);
// Any question about the size, which is the lookup the whole thing exists for.
const qSize = flat.questions.find((q) => /size/i.test(q.question));
ok(!!qSize, 'the model has a question about the size to go back to');

const QUOTE = '- text: $14.99';
R.setGeminiCaller(async () => JSON.stringify({
  alignedPhase: 'Inspect the item',
  alignedNodes: [qSize.node],
  answers: [{ id: qSize.id, answer: 'Size 5 Toddler', quote: QUOTE,
              confidence: 0.9, contradictsAsk: false }],
  noticed: [],
}));

await Validation.start('girls flat sandals size 5 under $40');

ok((await Trace.all()).length === 0, 'a new task starts with an empty trace');

// ── a page read ─────────────────────────────────────────────────────────────
const read = await Validation.observe(5);
ok(read.findings === 1, 'the page answered one question');

{
  const entries = await Trace.all();
  const e = entries.find((x) => x.action === 'read the page');
  ok(!!e, 'the read is on the record');
  ok(e.nodeId === qSize.node, 'filed under the node the page was serving');
  ok(e.label === flat.labels[qSize.node], 'with the node\'s own name, so it can be spoken');
  ok(e.findings.some((f) => f.widget === qSize.question),
    'carrying the finding that came off it');
  ok(e.findings[0].level != null, 'and how hard that finding pressed');
  ok(e.holder === 'agent', 'and who was driving at the time');
  ok(e.url === 'https://www.amazon.com/dp/X', 'and which page it was');
  ok(typeof e.t === 'number' && typeof e.seq === 'number', 'stamped in time and in order');
}

// ── an agent action ─────────────────────────────────────────────────────────
{
  const g = await Validation.allow('click add to cart', { step: 7 });
  ok(g.allowed === false, 'the unread finding holds the agent, as before');
  const e = (await Trace.all()).filter((x) => /add to cart/.test(x.action || '')).pop();
  ok(!!e, 'the action the agent tried is on the record');
  ok(e.step === 7, 'with the step it happened at');
  ok(e.nodeId === qSize.node, 'filed under the decision the run is in the middle of');
  ok(/held/.test(e.action), 'and what happened to it');
}

// ── an answer ───────────────────────────────────────────────────────────────
{
  await Validation.answer(qSize.question, 'use it');
  const e = (await Trace.all()).filter((x) => (x.answered || []).length).pop();
  ok(!!e, 'the answer is on the record');
  ok(e.answered[0] === qSize.question, 'naming the question it settled');
  ok(e.nodeId === qSize.node, 'filed under the node whose question it was');
  ok(/use it/.test(e.action), 'with what was actually said');
}

// ── the lookup this exists for ──────────────────────────────────────────────
{
  const there = await Trace.at(qSize.node);
  ok(there.length >= 3, 'a lookup by node finds the read, the action and the answer');
  ok(there.every((e) => e.nodeId === qSize.node
    || (e.nodes || []).includes(qSize.node)
    || (e.findings || []).some((f) => f.node === qSize.node)),
    'and finds them by any of the three ways a node is reached');
  ok((await Trace.at('not-a-node')).length === 0, 'a node nothing happened at is empty');
}

// ── why, which reads and does not call a model ──────────────────────────────
{
  let called = 0;
  R.setGeminiCaller(async () => { called += 1; return '{}'; });
  const w = await Validation.why({ nodeId: qSize.node });
  ok(called === 0, 'why calls no model at all - it is a lookup');
  ok(w.found === true && w.nodeId === qSize.node, 'it finds the node');
  ok(w.label === flat.labels[qSize.node], 'and can name it');
  ok(w.actions.some((a) => /add to cart/.test(a)), 'it says what was tried there');
  ok(w.findings.some((f) => f.widget === qSize.question), 'and what was found there');
  ok(w.answered.includes(qSize.question), 'and what was answered there');
  ok(/re-opens the decision/.test(w.note) && /does not undo/.test(w.note),
    'and says plainly that going back re-opens a decision rather than undoing anything');

  const nothing = await Validation.why({ nodeId: 'not-a-node' });
  ok(nothing.found === false, 'a node with nothing on the record says so');
}

// ── a step lookup, for the other way in ─────────────────────────────────────
{
  const w = await Validation.why({ step: 7 });
  ok(w.found === true && w.steps.includes(7), 'a step can be looked up too');
}

// ── it is persisted, which is what a worker restart needs ───────────────────
{
  const raw = local.get('aa.validation.trace');
  ok(Array.isArray(raw?.entries) && raw.entries.length >= 3,
    'the whole thing is in storage, not in a module variable that a restart loses');
  // A fresh read of the module state, exactly as a restarted worker would do.
  const again = await Trace.at(qSize.node);
  ok(again.length >= 3, 'and reads back the same');
  const s = local.get('aa.validation');
  ok(s.node === qSize.node && s.nodeLabel === flat.labels[qSize.node],
    'the session publishes where the run is, so a restart comes back knowing');
}

// ── bounded ─────────────────────────────────────────────────────────────────
{
  for (let i = 0; i < 60; i += 1) await Trace.record({ action: `filler ${i}` });
  const all = await Trace.all();
  ok(all.length <= Trace.TRACE_LIMIT, 'the record is bounded like every other one here');
  ok(all[all.length - 1].action === 'filler 59', 'and keeps the newest');
}

// ── a new task is a new trace ───────────────────────────────────────────────
{
  await Validation.start('something else entirely');
  ok((await Trace.all()).length === 0,
    'starting a task clears it - a lookup must not reach into the last run');
}

globalThis.ValidationTaskModel.unload();

console.log(`\n${pass}/${pass + fail} - going back to a decision is a lookup, and it is only ever a lookup.`);
if (fail) process.exit(1);
