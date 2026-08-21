/**
 * Streaming: a stop reaches the gate while the reply is still being written.
 *
 * The reply used to be consumed whole, so on a 20-second read the layer knew
 * nothing until second 20. Streamed, the prompt orders stop-class answers
 * first and each complete row is checked as it lands. What is tested:
 *
 *   - the row scanner survives a chunk boundary anywhere, including inside
 *     strings, escapes, and one character at a time
 *   - only stop-class rows surface early, only with a verified quote
 *   - the final result equals the non-streaming result on the same reply
 *   - a broken stream falls back to the plain call and loses nothing
 *   - at the session level: the gate is held mid-read, before the reply is
 *     complete, and the finding is not raised twice when the read finishes
 *
 * Run: node test/stream-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const R = await import('../extension/validation/reasoner.js');

// ── the row scanner ─────────────────────────────────────────────────────────

{
  const reply = JSON.stringify({
    alignedPhase: 'Search', alignedNodes: ['1'],
    answers: [
      { id: '1', answer: 'a "quoted" value with } and ]', quote: 'q1', confidence: 0.9, contradictsAsk: true },
      { id: '2', answer: 'backslash \\ and {brace}', quote: 'q2', confidence: 0.8, contradictsAsk: false },
      { id: '3', answer: 'plain', quote: 'q3', confidence: 0.7, contradictsAsk: false },
    ],
    noticed: [],
  });
  const whole = R.streamRows(reply);
  ok(whole.length === 3, 'the scanner finds all rows in a complete reply');
  ok(whole[0].answer === 'a "quoted" value with } and ]',
    'braces and quotes inside strings do not fool it');

  // One character at a time: after every prefix, the rows found so far must
  // be a stable prefix of the final rows, never a corrupted partial.
  let sane = true;
  let last = 0;
  for (let i = 0; i <= reply.length; i += 1) {
    const rows = R.streamRows(reply.slice(0, i));
    if (rows.length < last) sane = false;
    last = rows.length;
    for (let j = 0; j < rows.length; j += 1) {
      if (JSON.stringify(rows[j]) !== JSON.stringify(whole[j])) sane = false;
    }
  }
  ok(sane, 'fed one character at a time, rows appear whole and in order, never corrupted');
  ok(R.streamRows('no json here at all').length === 0, 'junk yields no rows and no throw');
  ok(R.streamRows('{"answers": [').length === 0, 'an empty open array yields nothing');
}

// ── readPage streaming: early surfacing rules ───────────────────────────────

const MODEL = {
  task: 'book a flight',
  tree: { id: '0', label: 'root', children: [
    { id: '1', label: 'Search', questions: [
      { question: 'Right destination?', cluster: 'facts', moment: 'Now' }] },
    { id: '2', label: 'Pay', questions: [
      { question: 'Right total?', cluster: 'facts', moment: 'Now', moneyMoving: true }] },
    { id: '3', label: 'Extras', questions: [
      { question: 'Any extras?', cluster: 'facts', moment: 'Now' }] },
  ] },
};
const PAGE = 'Flight to San Diego International. Total $312.98. Seat selection added.';
const flat = R.flattenModel(MODEL);

const REPLY = JSON.stringify({
  alignedPhase: 'Search', alignedNodes: ['1'],
  answers: [
    // A contradiction with a real quote: must surface early.
    { id: '1', answer: 'San Diego, not LAX', quote: 'San Diego International',
      confidence: 0.9, contradictsAsk: true },
    // Money-moving with a real quote: must surface early.
    { id: '2', answer: '$312.98', quote: 'Total $312.98', confidence: 0.9, contradictsAsk: false },
    // Plain row: must NOT surface early.
    { id: '3', answer: 'seat selection', quote: 'Seat selection added',
      confidence: 0.8, contradictsAsk: false },
  ],
  noticed: [],
});

// A fake stream: three chunks, split mid-row, with a pause between them so
// "early" is observable.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function chunkedStream(reply, cuts) {
  return async (prompt, opts, onText) => {
    let at = 0;
    for (const cut of cuts) {
      await onText(reply.slice(at, cut));
      at = cut;
      await sleep(5);
    }
    await onText(reply.slice(at));
    return reply;
  };
}

{
  const early = [];
  R.setGeminiCaller(async () => { throw new Error('plain caller must not be used'); });
  R.setGeminiStreamCaller(chunkedStream(REPLY, [Math.floor(REPLY.length * 0.45),
    Math.floor(REPLY.length * 0.8)]));
  const res = await R.readPage(flat, PAGE, { onRow: async (row) => early.push(row) });
  ok(res.ok === true, 'the streamed read completes');
  ok(early.length === 2, 'exactly the contradiction and the money row surface early');
  ok(early.some((r) => r.contradictsAsk) && early.some((r) => r.moneyMoving),
    'and they are those two, not the plain row');
  ok(early.every((r) => r.verify === 'verified_exact'),
    'each surfaced row carries its own verification');
  ok(res.meta.earlyIds.length === 2, 'the meta names what went out early');
  ok(res.answers.length === 3 && res.meta.answered === 3,
    'the final result still carries all three rows, identical to a plain call');
}

{
  // A bad quote on a stop-class row: never surfaced, however early it arrives.
  const badReply = REPLY.replace('San Diego International', 'WORDS NOT ON PAGE');
  const early = [];
  R.setGeminiStreamCaller(chunkedStream(badReply, [Math.floor(badReply.length * 0.5)]));
  const res = await R.readPage(flat, PAGE, { onRow: async (row) => early.push(row) });
  ok(early.length === 1 && early[0].moneyMoving === true,
    'an unbacked contradiction does not surface early, the verified money row still does');
  ok(res.meta.discarded === 1, 'and the final pass discards the unbacked row as always');
}

{
  // A stream that dies mid-way: the plain call takes over, nothing is lost.
  R.setGeminiStreamCaller(async (prompt, opts, onText) => {
    await onText(REPLY.slice(0, 40));
    throw new Error('connection reset');
  });
  R.setGeminiCaller(async () => REPLY);
  const early = [];
  const res = await R.readPage(flat, PAGE, { onRow: async (row) => early.push(row) });
  ok(res.ok === true && res.answers.length === 3,
    'a broken stream falls back to the plain call and the read still lands whole');
  ok(res.meta.attempts >= 2, 'and the log shows both the stream and the fallback');
}

{
  // No onRow: the streaming path is not used at all, exactly as before.
  R.setGeminiStreamCaller(async () => { throw new Error('must not be called'); });
  R.setGeminiCaller(async () => REPLY);
  const res = await R.readPage(flat, PAGE, {});
  ok(res.ok === true && res.answers.length === 3,
    'without a consumer for early rows the plain path runs untouched');
}

// ── the session level: held mid-read, not raised twice ──────────────────────

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
globalThis.BrowserHarness = { async axSnapshot() { return { text: PAGE, url: 'https://x.test' }; } };

const { default: Validation } = await import('../extension/validation/session.js');
globalThis.ValidationTaskModel.load(JSON.parse(JSON.stringify(MODEL)), 'test');
await Validation.start('fly to LAX under $300');

{
  // The stream hands over the two stop rows, then stalls. While it is
  // stalled - the reply is NOT finished - the agent must already be held.
  let releaseTail;
  const tail = new Promise((r) => { releaseTail = r; });
  let midStreamGate = null;
  R.setGeminiStreamCaller(async (prompt, opts, onText) => {
    await onText(REPLY.slice(0, Math.floor(REPLY.length * 0.8)));
    // Both stop rows are out; the model is "still writing". Ask the gate now.
    midStreamGate = await Validation.allow('click place order');
    releaseTail();
    await onText(REPLY.slice(Math.floor(REPLY.length * 0.8)));
    return REPLY;
  });

  const read = await Validation.observe(1);
  await tail;
  ok(midStreamGate && midStreamGate.allowed === false,
    'the agent is held MID-READ, before the reply is complete');
  ok(read.findings >= 1, 'the read still lands its remaining findings');

  const st = store['aa.validation'];
  const stops = st.findings.filter((f) => f.level === 'stop');
  const byWidget = {};
  for (const f of st.findings) byWidget[f.widget] = (byWidget[f.widget] || 0) + 1;
  ok(Object.values(byWidget).every((n) => n === 1),
    'nothing is raised twice when the read completes');
  ok(stops.length === 2, 'both stop-class findings are on the record');
  // The cooldown applies here too: the first early stop cuts in assertively,
  // the second joins politely instead of cutting the first one off.
  const earlySpoken = sent.filter((m) => m.type === 'validationSpeak'
    && m.lines?.some((l) => l.level === 'stop')).flatMap((m) => m.lines);
  ok(earlySpoken.some((l) => l.live === 'assertive')
    && earlySpoken.some((l) => l.live === 'polite' && /^Also: /.test(l.say)),
  'the first early stop is assertive and the second joins politely');

  // Answering the early-surfaced stop releases it even though the run's own
  // waiting list never saw it.
  const a = await Validation.answer('Right destination?', 'san diego is fine');
  ok(a.resolved === true, 'answering an early-surfaced stop counts as resolved');
}

console.log(`\n${pass}/${pass + fail} - a stop arrives when it is written, not when the reply ends.`);
if (fail) process.exit(1);
