/**
 * Handing the wheel to the person, and taking it back.
 *
 * Hand over is 39 of the 242 gold questions, second only to facts at 84, and
 * until now it had no implementation at all — pressing it sent the agent a
 * sentence saying "stop and let me do this part myself" and hoped.
 *
 * Four things have to be true, and each one is a separate mechanism:
 *
 *   1. it is scoped by a task model node, not by a stretch of time
 *   2. the agent stops ACTING and something keeps PERCEIVING
 *   3. handing back re-perceives, and says what changed FROM THE TRACE rather
 *      than from the agent's memory of a page it never saw
 *   4. the gate stays live throughout, and findings publish as usual
 *
 * Plus the one that reads as bookkeeping and is not: status() says who holds
 * the wheel. Two things acting on one page with no shared record of which one
 * is acting is how the agent, in a recorded run, spent ten steps trying to
 * dismiss its own supervisor overlay and pressed the person's "Got it" button.
 *
 * Run: node test/hand-over-test.mjs
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
const spoken = [];
global.chrome = {
  storage: { local: area(local), sync: area(new Map()) },
  runtime: { async sendMessage(m) { spoken.push(m); } },
  tabs: { async query() { return [{ id: 12 }]; } },
};

// The page the person is driving. Changing PAGE_TEXT is the person doing
// something, which is the only way the layer is allowed to find out.
let PAGE_TEXT = PAGE;
let reads = 0;
globalThis.BrowserHarness = {
  async axSnapshot() { reads += 1; return { text: PAGE_TEXT, url: 'https://www.amazon.com/dp/X' }; },
};

const agent = { paused: false, calls: [] };
globalThis.BrowserAgent = {
  isRunning: () => true,
  isPaused: () => agent.paused,
  pause: (o) => { agent.paused = true; agent.calls.push(['pause', o]); return { paused: true, atStep: 4 }; },
  resume: (o) => { agent.paused = false; agent.calls.push(['resume', o]); return { resumed: true }; },
  interject: (s) => { agent.calls.push(['interject', s]); return { queued: 1 }; },
  stop: (r) => { agent.calls.push(['stop', r]); },
};

const R = await import('../extension/validation/reasoner.js');
const Trace = await import('../extension/validation/trace.js');
const { default: Validation } = await import('../extension/validation/session.js');
const state = async () => (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};

globalThis.ValidationTaskModel.load(GOLD, 'test');
const flat = R.flattenModel(GOLD);
const qSize = flat.questions.find((q) => /size/i.test(q.question));
const qPrice = flat.questions.find((q) => /price|cost|\$/i.test(q.question) && q.id !== qSize.id);

// The model answers whichever question the current script says.
let answering = qSize;
let quote = '- text: $14.99';
let modelCalls = 0;
R.setGeminiCaller(async () => (modelCalls += 1) && JSON.stringify({
  alignedPhase: 'Inspect the item',
  alignedNodes: [answering.node],
  answers: [{ id: answering.id, answer: 'Size 5 Toddler', quote,
              confidence: 0.9, contradictsAsk: false }],
  noticed: [],
}));

await Validation.start('girls flat sandals size 5 under $40');

// ── before anyone hands anything over ───────────────────────────────────────
{
  const s = Validation.status();
  ok(s.holder === 'agent', 'the agent holds the wheel to begin with');
  ok(s.watching === false, 'and nothing is watching, because nobody is driving');
}

await Validation.observe(12);   // the run reaches the size node
ok(Validation.where().node === qSize.node, 'the run is at the size node');

// ── handing over ────────────────────────────────────────────────────────────
{
  agent.calls.length = 0;
  const r = await Validation.handOver({ nodeId: qSize.node, reason: 'let me pick the size' });

  ok(r.handedOver === true, 'the wheel is handed over');
  ok(r.nodeId === qSize.node, 'scoped to the node, not to a stretch of time');
  ok(r.label === flat.labels[qSize.node], 'and it can say which part that is');
  ok(agent.paused === true, 'the agent is held');
  ok(agent.calls[0][0] === 'pause', 'by a pause, not a stop - it has to come back');
  ok(agent.calls[0][1].byNode === qSize.node, 'and the pause knows which part it is out of');
  ok(!agent.calls.some((c) => c[0] === 'stop'), 'nothing ends the run');

  const s = Validation.status();
  ok(s.holder === 'person', 'status says the person holds the wheel');
  ok(s.nodeId === qSize.node && s.since > 0, 'with the part and since when');
  ok(s.watching === true, 'and that something is watching');
  ok((await state()).holder === 'person',
    'which is published, so a restart comes back knowing who is driving');
  ok(spoken.some((m) => /You have this part/.test(m.lines?.[0]?.say || '')),
    'and the person is told they have it');
}

// ── the gate, while the person drives ───────────────────────────────────────
{
  const change = await Validation.allow('click the size 6 swatch', { step: 5 });
  ok(change.allowed === false, 'the agent may not change anything under their hands');
  ok(change.holder === 'person', 'and is told why, not just refused');
  const look = await Validation.allow('scroll down', { step: 5 });
  ok(look.allowed === true,
    'looking is still free - the same rule as everywhere else in this gate');
  const e = (await Trace.at(qSize.node)).filter((x) => /size 6 swatch/.test(x.action || '')).pop();
  ok(!!e && /the person has the wheel/.test(e.action),
    'the refusal is on the record, filed under the part being handed over');
  ok(e.holder === 'person', 'as something that happened while the person was driving');
}

// ── the agent stops acting, the layer keeps perceiving ──────────────────────
{
  const before = reads;
  const modelBefore = modelCalls;
  await Validation.watchOnce();     // the first look establishes what the page says now
  ok(reads > before, 'the layer reads the page while the person drives');

  const again = await Validation.watchOnce();
  ok(again.skipped === 'nothing settled', 'a page that has not changed is not read again');
  ok(modelCalls === modelBefore + 1,
    'so watching a still page costs one model call, not one per look');

  // The person does something. The layer's only honest way to know is the page.
  answering = qPrice;
  quote = '- \'link "Brand: WUROSO"\':';
  PAGE_TEXT = `${PAGE}\n- text: the person picked something`;
  const r = await Validation.watchOnce();
  ok(r.findings === 1, 'a page that changed is read, and the finding is real');
  const e = (await Trace.all()).filter((x) => x.action === 'read the page').pop();
  ok(e.holder === 'person',
    'and it is recorded as having happened while the person had the wheel');
}

// ── the findings still publish, and still hold ──────────────────────────────
{
  const s = await state();
  ok(s.findings.some((f) => f.widget === qPrice.question),
    'findings publish during a hand over exactly as before');
  ok(s.gate.allowed === false,
    'and still hold - this is the layer checking the person, same machinery');
}

// ── handing back ────────────────────────────────────────────────────────────
{
  agent.calls.length = 0;
  const readsBefore = reads;
  const r = await Validation.handBack();

  ok(r.resumed === true, 'the agent has it back');
  ok(reads > readsBefore, 'handing back reads the page again first');
  ok(r.changedWhileOut.includes(qPrice.question),
    'and says what the page said while the agent was out');
  ok(!r.changedWhileOut.includes('made up'), 'from the trace, which is all it has');
  ok(r.nodeId === qSize.node, 'the part handed back is the part handed over');

  const order = agent.calls.map((c) => c[0]);
  ok(order.indexOf('interject') >= 0 && order.indexOf('resume') >= 0,
    'the agent is both told and let go');
  ok(order.indexOf('interject') < order.indexOf('resume'),
    'told BEFORE it is let go - the other order lets it act on the old page');
  const said = agent.calls.find((c) => c[0] === 'interject')[1];
  ok(said.includes(qPrice.question), 'what it is told is what the trace holds');
  ok(/do not redo what they just did/.test(said),
    'and it is told not to redo the part the person did');
  const resumeOpts = agent.calls.find((c) => c[0] === 'resume')[1];
  ok(resumeOpts.rePerceive === true, 'and it resumes with a fresh look, never on memory');

  const s = Validation.status();
  ok(s.holder === 'agent' && s.watching === false,
    'the wheel is back and the watch has stopped');
  ok((await Validation.allow('click the size 6 swatch', { step: 9 })).holder !== 'person',
    'and the gate no longer refuses on the grounds that somebody else is driving');
}

// ── the hold clock does not run against someone who is driving ──────────────
{
  Validation.setHoldTimeouts({ remindMs: 20, stopMs: 60 });
  const stops = agent.calls.filter((c) => c[0] === 'stop').length;
  await Validation.handOver({ nodeId: qSize.node });
  const heldSince = (await state()).hold?.since;
  await new Promise((r) => setTimeout(r, 120));   // twice the give-up interval
  await Validation.allow('scroll down', { step: 11 });
  ok(agent.calls.filter((c) => c[0] === 'stop').length === stops,
    'a person doing the step themselves is not a person who walked away');

  await Validation.handBack();
  const after = (await state()).hold?.since;
  ok(after > heldSince,
    'and the wait starts when they hand it back, not while they were working');
  Validation.setHoldTimeouts({ remindMs: 45_000, stopMs: 240_000 });
}

// ── handing back what nobody handed over ────────────────────────────────────
{
  const r = await Validation.handBack();
  ok(r.resumed === false && /already has it/.test(r.why),
    'handing back twice says so rather than resuming an agent nobody paused');
}

// ── a hand over does not outlive its task ───────────────────────────────────
{
  await Validation.handOver({ nodeId: qSize.node });
  ok(Validation.status().holder === 'person', 'handed over again');
  await Validation.stop();
  const s = Validation.status();
  ok(s.holder === 'agent' && s.watching === false,
    'ending the task ends the hand over and stops the watch');
}

// ── the control carries the node it was pressed on ──────────────────────────
{
  const findings = R.toFindings({
    alignedNodes: [qSize.node], noticed: [],
    answers: [{ node: qSize.node, question: 'Which size went in?', answer: 'Size 5',
                quote: 'x', verify: 'verified_exact', cluster: 'hand over',
                moment: 'Now', confidence: 0.9 }],
  }, 'Check item');
  ok(findings[0].control.action === 'hand-over', 'a hand-over finding offers the hand-over control');
  ok(findings[0].control.node === qSize.node,
    'and the control carries its node, because the overlay hands back nothing else');
}

globalThis.ValidationTaskModel.unload();

console.log(`\n${pass}/${pass + fail} - the person can take a part, the layer keeps watching, and handing back is told from the record.`);
if (fail) process.exit(1);
