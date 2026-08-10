/**
 * What a page reveals becomes a question the layer keeps asking.
 *
 * The open noticing pass has always found these and always dropped them. It
 * raised a finding for the page it was looking at, and nothing carried the
 * question forward — so a pre-ticked insurance box noticed on the add-ons page
 * was never looked for again at checkout or on the confirmation, which is
 * exactly where an unnoticed pre-tick survives to.
 *
 * Measured offline before this was built. On a recorded flights run, twelve
 * questions written this way raised coverage against held-out gold from 35.4%
 * to 40.5%, with one of the twelve judged spurious. The gain tracked how many
 * pages the run saw: 13 pages gave +5.1 points, 2 pages gave none.
 */
const store = {};
global.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string'
        ? { [k]: store[k] }
        : Object.fromEntries((k || []).map((x) => [x, store[x]]))),
      set: async (o) => { Object.assign(store, o); },
    },
    sync: {
      get: async () => ({}),
      set: async () => {},
    },
    onChanged: { addListener() {} },
  },
  runtime: { async sendMessage() {} },
  tabs: { async query() { return [{ id: 1 }]; } },
};

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const PAGE = [
  '- heading "Review your trip"',
  '- text: Trip protection $24.99 — added',
  '- text: Total $312.98',
  '- checkbox "Trip protection" [checked]',
].join('\n');

globalThis.BrowserHarness = { async axSnapshot() { return { text: PAGE, url: 'https://x.test/review' }; } };
globalThis.BrowserAgent = { isRunning: () => true, pause: () => ({ paused: true }), resume: () => ({}), interject: () => ({}), stop: () => {} };

const R = await import('../extension/validation/reasoner.js');
const { default: Validation } = await import('../extension/validation/session.js');
const TaskModel = globalThis.ValidationTaskModel;

const MODEL = {
  task: 'book a flight',
  ask: 'nonstop under $300',
  tree: {
    id: '0',
    label: 'root',
    children: [
      { id: '1', label: 'Search', children: [{ id: '1.1', label: 'Set the dates', questions: [{ question: 'Are the dates right?' }] }] },
      { id: '2', label: 'Review', children: [{ id: '2.1', label: 'Check the total' }] },
    ],
  },
};

const questionsIn = (m) => {
  const out = [];
  const w = (x) => { for (const q of x.questions || []) out.push(q); (x.children || []).forEach(w); };
  w(m.tree);
  return out;
};

// The page read: it answers nothing, and notices two things no question asked
// for. Both quotes are on the page, which is what lets them through at all.
R.setGeminiCaller(async () => JSON.stringify({
  alignedPhase: 'Review',
  alignedNodes: ['2.1'],
  answers: [],
  noticed: [
    { say: 'Is trip protection already added?', quote: '- text: Trip protection $24.99 — added', contradictsAsk: false },
    { say: 'Is the total over the $300 I said?', quote: '- text: Total $312.98', contradictsAsk: true },
  ],
}));

const model = JSON.parse(JSON.stringify(MODEL));
TaskModel.load(model, 'generated');
ok(questionsIn(model).length === 1, 'the model starts with the one question it was generated with');

await Validation.start({ item: 'a flight', budget: 300 }, {});
await Validation.observe(1);

const after = questionsIn(model);
ok(after.length === 3, 'what the page revealed is now on the model as questions');

const found = after.filter((q) => q.foundOnPage);
ok(found.length === 2, 'and they are marked as found by looking, not written in advance');
ok(found.some((q) => /trip protection already added/i.test(q.question)),
  'the pre-ticked box became a question');
ok(found.some((q) => /over the \$300/i.test(q.question)),
  'and so did the total that broke what the person said');

ok(TaskModel.describe().questions === 3,
  'the loaded model is rebuilt, so the next page read asks them too - which is '
  + 'the whole point, since a pre-tick survives by not being looked at again');

const saved = store['aa.validation.model'];
ok(saved && questionsIn(saved).length === 3,
  'and it is persisted, so a worker restart does not lose them');

// A second read of the same page must not add them again.
await Validation.observe(1);
ok(questionsIn(model).length === 3, 'reading the same page again adds nothing new');

// ── the gate names the one it is showing ────────────────────────────────────
//
// The panel hides exactly one finding from its list: the one the gate block is
// already displaying, so a question does not appear twice with two button rows.
// It knows which one from `gate.leading`. The panel test hands that field in by
// hand, so nothing checked that the layer actually publishes it - removing the
// line that computes it broke nothing and no test failed.
{
  const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
  const gate = st.gate || {};
  if (gate.allowed === false) {
    ok(typeof gate.leading === 'string' && gate.leading.length > 0,
      'a held gate names which finding it is showing');
    ok((gate.waitingOn || []).includes(gate.leading),
      'and it is one of the ones being waited on, not something else');
  } else {
    ok(false, 'expected the run to be held after findings arrived');
  }
}

console.log(`\n${pass}/${pass + fail} - what a page reveals becomes something the layer keeps asking.`);
if (fail) process.exit(1);
