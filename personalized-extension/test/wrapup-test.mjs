/**
 * The spoken wrap-up at the end of a run.
 *
 * "Completion log" never meant silent. What is tested:
 *
 *   - the run ends with the task outcome spoken first - the completion-moment
 *     findings, which were deliberately kept quiet during the run
 *   - then the top few kept findings the person never saw, ranked by the
 *     utility model's scores
 *   - things already acknowledged or already spoken are not repeated
 *   - what is not spoken is counted, so the person knows the panel has more
 *   - and everything spoken is marked dealt with, so it cannot hold anything
 *
 * Run: node test/wrapup-test.mjs
 */

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
globalThis.BrowserHarness = { async axSnapshot() { return { text: 'x', url: 'https://x.test' }; } };

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const { default: Validation } = await import('../extension/validation/session.js');

await Validation.start('book a hotel room');

// The run's stored findings, as a real run leaves them: the outcome questions
// sat quiet as ambient, a mid-tier finding was routed to the log with scores,
// an aside was already spoken, and one ambient thing was already acknowledged.
const F = [
  { widget: 'Did the order go through?', phase: 'Confirm', level: 'ambient',
    say: 'Did the order go through? Yes, order 113-2116825 is confirmed.',
    moment: 'Completion', confirming: false, eu: { now: 0.02, after: 0.1, log: 0.11, ondemand: 0.05 } },
  { widget: 'Did the email receipt come?', phase: 'Confirm', level: 'ambient',
    say: 'Did the email receipt come? Yes, with the order number.',
    moment: 'Completion', confirming: false, eu: { now: 0.01, after: 0.09, log: 0.1, ondemand: 0.04 } },
  { widget: 'What does delivery cost?', phase: 'Check out', level: 'ambient',
    say: 'What does delivery cost? $4.99.', moment: 'Now', confirming: false,
    eu: { now: 0.03, after: 0.07, log: 0.08, ondemand: 0.05 } },
  { widget: 'Any badges?', phase: 'Search', level: 'ambient',
    say: 'Any badges? One result carries Overall Pick.', moment: 'Now', confirming: false,
    eu: { now: 0.01, after: 0.02, log: 0.03, ondemand: 0.02 } },
  { widget: 'How many results?', phase: 'Search', level: 'ambient',
    say: 'How many results? 944.', moment: 'Now', confirming: false,
    eu: { now: 0.005, after: 0.01, log: 0.02, ondemand: 0.01 } },
  { widget: 'Sponsored rows?', phase: 'Search', level: 'ambient',
    say: 'Sponsored rows? Six of the first ten.', moment: 'Now', confirming: false,
    eu: { now: 0.004, after: 0.009, log: 0.015, ondemand: 0.01 } },
  { widget: 'Was that spoken already?', phase: 'Search', level: 'aside',
    say: 'Was that spoken already? Yes.', moment: 'Now', confirming: false },
  { widget: 'Dealt with', phase: 'Search', level: 'ambient',
    say: 'Dealt with. Yes.', moment: 'Now', confirming: false },
];
const prev = store['aa.validation'] || {};
store['aa.validation'] = { ...prev, findings: F,
  acknowledged: ['Dealt with|Search|Dealt with. Yes.'] };

sent.length = 0;
const r = await Validation.wrapUp('task complete');

const speak = sent.find((m) => m.type === 'validationSpeak' && m.phase === 'wrap up');
ok(!!speak, 'the run ends with something spoken');
ok(r.outcome === 2, 'both completion-moment findings are in the outcome');
ok(/order.*confirmed/i.test(speak.lines[0].say),
  'the task outcome is the first thing said');
ok(/email receipt/i.test(speak.lines[1].say), 'the second outcome follows it');
ok(/delivery cost/.test(speak.lines[2].say),
  'then the strongest kept finding by the utility scores');
ok(!speak.lines.some((l) => /spoken already/i.test(l.say)),
  'an aside already spoken is not said again');
ok(!speak.lines.some((l) => /Dealt with/.test(l.say)),
  'an acknowledged finding is not said again');
ok(speak.lines.every((l) => l.live === 'polite'),
  'the wrap-up is polite - a summary, not an alarm');
const counted = speak.lines[speak.lines.length - 1];
ok(/1 more thing is in the panel/.test(counted.say),
  'what is not spoken is counted, not hidden');

const st = store['aa.validation'];
ok(st.wrapUp && st.wrapUp.spoke === speak.lines.length,
  'the wrap-up is on the record for the panel');

// ── the outcome cap ─────────────────────────────────────────────────────────
//
// A wrap-up with ten outcome sentences stops being a summary. Only the first
// four are spoken; the rest are counted, not lost.
{
  const many = Array.from({ length: 7 }, (_, i) => ({
    widget: `Outcome ${i}?`, phase: 'Confirm', level: 'ambient',
    say: `Outcome ${i}? Yes.`, moment: 'Completion', confirming: false,
    eu: { now: 0.01, after: 0.01, log: 0.02, ondemand: 0.01 } }));
  const p = store['aa.validation'] || {};
  store['aa.validation'] = { ...p, findings: many, acknowledged: [] };
  sent.length = 0;
  const r2 = await Validation.wrapUp('done');
  ok(r2.outcome === 4, 'no more than four outcome sentences are spoken');
  const s2 = sent.find((m) => m.type === 'validationSpeak' && m.phase === 'wrap up');
  ok(/3 more things are in the panel/.test(s2.lines[s2.lines.length - 1].say),
    'the ones that did not fit are counted, not lost');
}

console.log(`\n${pass}/${pass + fail} - the run ends with the outcome spoken and the review `
  + 'counted, never with silence.');
if (fail) process.exit(1);
