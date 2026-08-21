/**
 * Nothing commits blind: the two halves of decision 22, plus the narration
 * channel and the masks, tested as ONE system - a full synthetic run from
 * plan review to wrap-up, because the pieces have to make sense together,
 * not pass in isolation.
 *
 *   - the plan review speaks once, before anything else
 *   - a phase boundary speaks a checkpoint, politely, and only on change
 *   - a committing action clicked mid-read WAITS for the read, bounded
 *   - a committing action on an off-plan page is held outright, with clean
 *     findings - the out-of-distribution half of the hard gate
 *   - page danger signals raise P(e) inside the same EU the router already
 *     computes
 *   - a card number on a page is never spoken; an order number always is
 *
 * Run: node test/blind-commit-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const store = {};
const sent = [];
global.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string'
        ? { [k]: store[k] }
        : Object.fromEntries((Array.isArray(k) ? k : [k]).map((x) => [x, store[x]]))),
      set: async (o) => { Object.assign(store, o); },
    },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: { async sendMessage(m) { sent.push(m); } },
  tabs: { async query() { return [{ id: 1 }]; } },
};

let PAGE = 'Search hotels. Destination San Diego. Total $181. Also shown: $175 and $186 for the same room.';
globalThis.BrowserHarness = { async axSnapshot() { return { text: PAGE, url: 'https://x.test' }; } };

const R = await import('../extension/validation/reasoner.js');
const U = await import('../extension/validation/utility.js');
const { default: Validation } = await import('../extension/validation/session.js');

// ── the masks, on their own terms first ─────────────────────────────────────

ok(R.maskSensitive('paid with 4111 1111 1111 1111 today')
  === 'paid with a card ending 1111 today', 'a card number is never spoken');
ok(R.maskSensitive('SSN 123-45-6789 on file') === 'SSN an SSN ending 6789 on file'
  || /ending 6789/.test(R.maskSensitive('SSN 123-45-6789 on file')),
'an SSN is never spoken');
ok(R.maskSensitive('Order # 113-2116825-7916228 confirmed')
  === 'Order # 113-2116825-7916228 confirmed',
'an order number reads out in full - the receipts route depends on it');
ok(/password \(not read aloud\)/.test(R.maskSensitive('your password is hunter2')),
  'a stated secret is not repeated');

// ── the EU feels the page's danger signals ──────────────────────────────────

{
  const f = { moment: 'Now', confidence: 0.8, verified: 'verified_exact',
    moneyMoving: false, contradicts: false };
  const calm = U.route(f, { spoken: 0 });
  const scared = U.route(f, { spoken: 0,
    signals: { offPlan: true, ambiguity: 2, traceAnomaly: true } });
  ok(scared.eu.now > calm.eu.now,
    'danger signals raise the value of checking now, through the same EU');
}

// ── one synthetic run, end to end ───────────────────────────────────────────

const MODEL = {
  task: 'book a hotel room',
  tree: { id: '0', label: 'root', children: [
    { id: '1', label: 'Search hotels', questions: [
      { question: 'Right destination?', cluster: 'facts', moment: 'Now' }] },
    { id: '2', label: 'Pay for the room', questions: [
      { question: 'Right total?', cluster: 'facts', moment: 'Now', moneyMoving: true },
      { question: 'Which card pays?', cluster: 'facts', moment: 'Now', fromAsk: true }] },
  ] },
};
globalThis.ValidationTaskModel.load(JSON.parse(JSON.stringify(MODEL)), 'test');
await Validation.start('a hotel in san diego');
Validation.setSpeechCooldown(50);

// 1. checkpoint zero: the plan review speaks once, and only once.
{
  sent.length = 0;
  const r1 = await Validation.planReview();
  const r2 = await Validation.planReview();
  ok(r1.spoken === true && r2.spoken === false, 'the plan review speaks once per task');
  const line = sent.flatMap((m) => m.lines || [])[0];
  ok(/The plan: Search hotels, Pay for the room\./.test(line.say)
    && /3 things, 1 of them before money moves/.test(line.say),
  'and it says the phases, the checks, and the money checks');
  ok(/From your request I added: Which card pays\?/.test(line.say),
    'and names what the request itself added');
  ok(store['aa.validation'].planReview?.questions === 3, 'and the panel has the record');
}

// 2. a page read: checkpoint on the phase boundary, signals computed.
R.setGeminiCaller(async () => JSON.stringify({
  alignedPhase: 'Search hotels', alignedNodes: ['1'],
  answers: [{ id: '1', answer: 'San Diego', quote: 'Destination San Diego',
    confidence: 0.9, contradictsAsk: false }],
  noticed: [],
  ambiguity: [{ fact: 'the room price', count: 3, quote: 'Total $181' }],
}));
{
  sent.length = 0;
  await Validation.observe(1);
  const lines = sent.flatMap((m) => m.lines || []);
  ok(lines.some((l) => l.widget === 'checkpoint' && /Starting: Search hotels\./.test(l.say)
    && l.live === 'polite'),
  'crossing into a phase speaks one polite checkpoint');
  sent.length = 0;
  await Validation.observe(1);
  ok(!sent.flatMap((m) => m.lines || []).some((l) => l.widget === 'checkpoint'),
    'staying in the phase speaks no checkpoint');
}

// 3. a commit clicked mid-read waits for the read, then sees its findings.
{
  let releaseRead;
  R.setGeminiCaller(() => new Promise((r) => {
    releaseRead = () => r(JSON.stringify({
      alignedPhase: 'Pay for the room', alignedNodes: ['2'],
      answers: [{ id: '2#1', answer: '$181, over what you said', quote: 'Total $181',
        confidence: 0.9, contradictsAsk: true }],
      noticed: [],
    }));
  }));
  const reading = Validation.observe(1);          // in flight, unresolved
  await new Promise((r) => setTimeout(r, 20));
  const gatePromise = Validation.allow('click place your order');
  await new Promise((r) => setTimeout(r, 50));
  releaseRead();                                   // the read completes...
  const g = await gatePromise;                     // ...and only then the gate answers
  await reading;
  ok(g.allowed === false, 'the commit waited for the read and was held by what it found');
  ok((g.waitingOn || []).includes('Right total?'),
    'held on the contradiction the read produced while the commit was waiting');
}

// 4. the off-plan half: clean findings, unknown page, commit held anyway.
{
  await Validation.answer('Right total?', 'that price is fine');
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'none', alignedNodes: [], answers: [], noticed: [],
  }));
  PAGE = 'A page from somewhere else entirely.';
  await Validation.observe(1);
  const g = await Validation.allow('click place your order');
  ok(g.allowed === false && /does not match any step/.test(g.say || ''),
    'a commit on a page matching no step of the task is held outright');
  const g2 = await Validation.allow('scroll down');
  ok(g2.allowed === true, 'and looking around stays free - only committing is held');
}

// 5. back on the plan, the hold lifts.
{
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Pay for the room', alignedNodes: ['2'], answers: [], noticed: [],
  }));
  PAGE = 'Pay for the room. Total $175.';
  await Validation.observe(1);
  const g = await Validation.allow('click place your order');
  ok(g.allowed === true, 'an aligned page clears the off-plan hold');
}

console.log(`\n${pass}/${pass + fail} - plan, checkpoints, gate, signals and masks working `
  + 'as one system.');
if (fail) process.exit(1);
