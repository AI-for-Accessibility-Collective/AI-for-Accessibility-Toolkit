/**
 * The two fixes the live runs demanded.
 *
 * 1. The adapt call. A retrieved bank's question baked in "one adult and one
 *    room" and flagged a correct page against a request for 2 adults. The
 *    adapt call rewrites wrong-assumption questions to fit THIS request and
 *    adds questions for constraints the bank lacks - applied as a patch, so
 *    a generation hiccup can corrupt nothing.
 *
 * 2. Bundled speech. A live run opened with four assertive holds in twenty
 *    seconds. One read's stops now speak as one sentence, and further
 *    assertive lines inside the cooldown go out politely - still holding,
 *    still in the panel, no longer cutting the person off.
 *
 * Run: node test/adapt-bundle-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const G = await import('../extension/validation/generate.js');

// ── the patch application: deterministic, malformed-proof ───────────────────

const BANK = () => ({
  task: 'book a hotel room online',
  tree: { id: '0', label: 'root', children: [
    { id: '1', label: 'Set the search', questions: [
      { question: 'Are the default settings of one adult and one room correct for your trip?',
        cluster: 'facts', moment: 'Now', moneyMoving: false },
      { question: 'Are the dates right?', cluster: 'facts', moment: 'Now', moneyMoving: false },
    ] },
    { id: '2', label: 'Pick a rate', questions: [
      { question: 'Is the rate refundable?', cluster: 'facts', moment: 'Now', moneyMoving: true },
    ] },
  ] },
});

{
  const m = BANK();
  const r = G.applyAdaptations(m, {
    rewrites: [
      // The live defect: the baked-in default rewritten to the request.
      { id: '1#1', question: 'Are the settings right for 2 adults in one room?' },
      { id: 'no-such-node', question: 'ghost' },          // bad id: skipped
      { id: '2', question: '' },                          // empty: skipped
    ],
    additions: [
      { nodeId: '2', question: 'Is breakfast included in the rate?',
        why: 'the request asks for breakfast', moment: 'Now', moneyMoving: false },
      { nodeId: 'nowhere', question: 'Is it near the convention center?',
        why: 'stated location', moment: 'garbage', moneyMoving: 'yes' },
      { nodeId: '1', question: '   ' },                   // blank: skipped
    ],
  });
  ok(r.rewritten === 1 && r.added === 2 && r.skipped === 3,
    'good entries land, malformed ones are counted and refused');
  const q1 = m.tree.children[0].questions[0];
  ok(q1.question === 'Are the settings right for 2 adults in one room?',
    'the baked-in default is rewritten to fit the request');
  ok(q1.originalQuestion?.includes('one adult'),
    'and the bank wording is kept as provenance');
  const rate = m.tree.children[1].questions;
  ok(rate.some((q) => /breakfast/.test(q.question) && q.fromAsk === true),
    'a constraint the bank lacked becomes a question where it belongs');
  const rootQ = m.tree.questions || [];
  ok(rootQ.some((q) => /convention center/.test(q.question) && q.moment === 'Now'
    && q.moneyMoving === false),
  'a bad node id falls back to the root and garbage codings are defaulted');
}

// ── the adapt call end to end, with a model that misbehaves ─────────────────

{
  const calls = [];
  const a = await G.adaptModel(BANK(), 'book a hotel for 2 adults with breakfast included', {
    caller: async (prompt, opts) => {
      calls.push({ prompt, opts });
      return JSON.stringify({
        rewrites: [{ id: '1#1', question: 'Are the settings right for 2 adults?' }],
        additions: [{ nodeId: '2', question: 'Is breakfast included?',
          why: 'asked for', moment: 'Now', moneyMoving: false }],
      });
    },
  });
  ok(a.rewritten === 1 && a.added === 1, 'the call returns a patch and it is applied');
  ok(/2 adults/.test(calls[0].prompt) && /1#1 \| Are the default settings/.test(calls[0].prompt),
    'the prompt carries the request and the bank questions with their flat ids');
  ok(a.model !== undefined
    && a.model.tree.children[0].questions[0].question === 'Are the settings right for 2 adults?',
  'the returned model carries the rewrite');
}

{
  const a = await G.adaptModel(BANK(), 'book a hotel', {
    caller: async () => 'this is not json at all {{{',
  });
  ok(a.rewritten === 0 && a.added === 0 && a.error,
    'a garbage reply changes nothing and says why');
  ok(a.model.tree.children[0].questions[0].question.includes('one adult'),
    'and the original model is returned untouched');
}

{
  const a = await G.adaptModel(BANK(), 'book a hotel', {
    caller: async () => { throw new Error('rate limited'); },
  });
  ok(a.rewritten === 0 && a.added === 0, 'a failed call changes nothing either');
}

// ── bundled speech at the session level ─────────────────────────────────────

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
const PAGE = 'Destination near 94025 Menlo Park. Dates Mon Aug 31. Travelers 2. Fee $9 added.';
globalThis.BrowserHarness = { async axSnapshot() { return { text: PAGE, url: 'https://x.test' }; } };

const R = await import('../extension/validation/reasoner.js');
const { default: Validation } = await import('../extension/validation/session.js');

const MODEL = {
  task: 'book a hotel',
  tree: { id: '0', label: 'root', children: [
    { id: '1', label: 'Search', questions: [
      { question: 'Right city?', cluster: 'facts', moment: 'Now' },
      { question: 'Right dates?', cluster: 'facts', moment: 'Now' },
      { question: 'Right travelers?', cluster: 'facts', moment: 'Now' },
    ] },
  ] },
};
globalThis.ValidationTaskModel.load(JSON.parse(JSON.stringify(MODEL)), 'test');
const flat = R.flattenModel(MODEL);

const contradiction = (id, answer, quote) => (
  { id, answer, quote, confidence: 0.9, contradictsAsk: true });

R.setGeminiCaller(async () => JSON.stringify({
  alignedPhase: 'Search', alignedNodes: ['1'],
  answers: [
    contradiction('1#1', 'Menlo Park, not San Diego', 'near 94025 Menlo Park'),
    contradiction('1#2', 'Aug 31, not Oct 9', 'Mon Aug 31'),
    contradiction('1#3', '2 travelers', 'Travelers 2'),
  ],
  noticed: [],
}));

await Validation.start('a hotel in san diego oct 9');
Validation.setSpeechCooldown(300);

{
  sent.length = 0;
  await Validation.observe(1);
  const speaks = sent.filter((m) => m.type === 'validationSpeak');
  const stopLines = speaks.flatMap((m) => m.lines).filter((l) => l.level === 'stop');
  ok(stopLines.length === 1,
    'three stops from one read are spoken as ONE line, not three');
  ok(/And 2 more need you: Right dates\?; Right travelers\?/.test(stopLines[0].say),
    'and the one line names the other two');
  ok(stopLines[0].live === 'assertive', 'the first interruption of a burst is assertive');
  const st = store['aa.validation'];
  ok(st.findings.filter((f) => f.level === 'stop').length === 3,
    'all three still hold the agent - bundling changes speech, never safety');
}

{
  // A fourth contradiction lands seconds later: inside the cooldown, so it is
  // spoken politely, appended - and it still holds.
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Search', alignedNodes: ['1'],
    // A changed value produces a changed quote - identical evidence would be
    // the reworded-repeat case, which the evidence guard now keeps silent.
    answers: [contradiction('1#1', 'still wrong, and now a fee appeared',
      'Fee $9 added')],
    noticed: [],
  }));
  sent.length = 0;
  await Validation.observe(1);
  const lines = sent.filter((m) => m.type === 'validationSpeak').flatMap((m) => m.lines);
  const stop = lines.find((l) => l.level === 'stop');
  ok(stop && stop.live === 'polite' && /^Also: /.test(stop.say),
    'a stop inside the cooldown joins politely instead of cutting in');
  const g = await Validation.allow('click search');
  ok(g.allowed === false, 'and it still holds the agent all the same');
}

{
  // After the cooldown, the next burst is assertive again.
  await new Promise((r) => setTimeout(r, 350));
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Search', alignedNodes: ['1'],
    answers: [contradiction('1#2', 'dates changed again', 'Dates Mon Aug 31')],
    noticed: [],
  }));
  sent.length = 0;
  await Validation.observe(1);
  const stop = sent.filter((m) => m.type === 'validationSpeak')
    .flatMap((m) => m.lines).find((l) => l.level === 'stop');
  ok(stop && stop.live === 'assertive', 'after the cooldown the next stop is assertive again');
}

console.log(`\n${pass}/${pass + fail} - the bank fits the request, and a burst is one `
  + 'interruption instead of four.');
if (fail) process.exit(1);

// ── the addendum: what the request added is spoken even on the late path ────
{
  const MODEL2 = {
    task: 'book a hotel',
    tree: { id: '0', label: 'root', children: [
      { id: '1', label: 'Search', questions: [
        { question: 'Right city?', cluster: 'facts', moment: 'Now' },
        { question: 'Is breakfast included?', cluster: 'facts', moment: 'Now', fromAsk: true },
      ] } ] },
  };
  globalThis.ValidationTaskModel.load(JSON.parse(JSON.stringify(MODEL2)), 'generated');
  sent.length = 0;
  const r = await Validation.planAddendum({ added: 1, rewritten: 0 });
  ok(r.spoken === true, 'the addendum speaks when the patch added questions');
  const line = sent.flatMap((m) => m.lines || []).find((l) => l.widget === 'plan');
  ok(line && /From your request I also check: Is breakfast included\?/.test(line.say)
    && line.live === 'polite',
  'and it names them politely instead of re-reading the whole plan');
}

console.log(`(addendum block done)`);

// ── the pre-adapt race: findings from a rewritten question retire ───────────
{
  const m = BANK();
  const r = G.applyAdaptations(m, {
    rewrites: [{ id: '1#1', question: 'Are the settings right for 2 adults?' }],
    additions: [],
  });
  ok(Array.isArray(r.rewrites) && r.rewrites[0].from.includes('one adult'),
    'the patch reports which questions it rewrote, old wording included');

  const p = store['aa.validation'] || {};
  p.findings = [{ widget: 'Are the default settings of one adult and one room correct for your trip?',
    phase: 'Set the search', level: 'stop', confirming: false,
    say: 'No, the page shows 2 travelers.', from: 'travelers is 2' }];
  p.acknowledged = [];
  store['aa.validation'] = p;
  const res = await Validation.retireQuestions(r.rewrites.map((x) => x.from));
  ok(res.retired === 1, 'a finding raised from the old wording is retired');
  const g = await Validation.allow('click search', { action: 'click_index' });
  ok(g.allowed === true, 'and the hold it carried is released');
}

console.log('(retire block done)');
