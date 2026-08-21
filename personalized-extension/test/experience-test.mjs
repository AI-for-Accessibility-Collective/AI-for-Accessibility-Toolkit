/**
 * The full experience, end to end: page-harvested options, node-grouped
 * findings, and the guided review.
 *
 * What is tested:
 *
 *   - the reasoner keeps only options the page actually offers, in the
 *     model's order, capped at four
 *   - an option travels: reasoner row -> finding -> published state ->
 *     a "Pick ..." button in the panel -> a control carrying the value ->
 *     the instruction "Choose "X" ..." from instructionFor
 *   - a stale-phase option press does NOT become an instruction
 *   - findings render grouped under their node's label
 *   - after the wrap-up, the review pane shows the outcome first and the
 *     kept findings as counted expandable groups
 *
 * Run: node test/experience-test.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>',
  { url: 'https://x.test/page' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event',
                 'getComputedStyle']) {
  global[k] = k === 'window' ? dom.window
    : (k === 'document' ? dom.window.document : dom.window[k]);
}
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.CSS = dom.window.CSS || { escape: (s) => s };

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

// ── storage + harness mocks (session-level part) ────────────────────────────
const store = {};
const sent = [];
global.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string'
        ? { [k]: store[k] }
        : (k == null ? { ...store }
          : Object.fromEntries((Array.isArray(k) ? k : [k]).map((x) => [x, store[x]])))),
      set: async (o) => { Object.assign(store, o); },
    },
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  runtime: { async sendMessage(m) { sent.push(m); } },
  tabs: { async query() { return [{ id: 1 }]; } },
};
const PAGE = 'Seats. aisle $12. window $15. exit row $28. middle free. Total $181.';
globalThis.BrowserHarness = { async axSnapshot() { return { text: PAGE, url: 'https://x.test' }; } };

const R = await import('../extension/validation/reasoner.js');
const { default: Validation } = await import('../extension/validation/session.js');

const MODEL = {
  task: 'book a flight',
  tree: { id: '0', label: 'root', children: [
    { id: '1', label: 'Pick a seat', questions: [
      { question: 'Which seat do you want?', cluster: 'select', moment: 'Now' }] },
    { id: '2', label: 'Pay', questions: [
      { question: 'Right total?', cluster: 'facts', moment: 'Now', moneyMoving: true }] },
  ] },
};
globalThis.ValidationTaskModel.load(JSON.parse(JSON.stringify(MODEL)), 'test');
await Validation.start('a flight, aisle seat if cheap');
Validation.setSpeechCooldown(50);

// ── 1. options come off the page, verified, capped ──────────────────────────
R.setGeminiCaller(async () => JSON.stringify({
  alignedPhase: 'Pick a seat', alignedNodes: ['1'],
  answers: [{ id: '1', answer: 'the page offers seat choices',
    quote: 'aisle $12', confidence: 0.9, contradictsAsk: false,
    options: ['aisle $12', 'window $15', 'INVENTED BUSINESS CLASS $99', 'exit row $28',
              'middle free'] }],
  noticed: [],
}));
{
  const flat = R.flattenModel(MODEL);
  const res = await R.readPage(flat, PAGE, {});
  const a = res.answers.find((x) => x.options);
  ok(!!a, 'an answer can carry options');
  ok(a.options.length === 3 && !a.options.includes('INVENTED BUSINESS CLASS $99'),
    'an option the page does not offer is discarded, and the cap holds after it');
  ok(a.options[0] === 'aisle $12', 'the model\'s likeliest-first order survives');
}

// ── 2. the option travels to storage through a real observe ─────────────────
{
  await Validation.observe(1);
  const st = store['aa.validation'];
  const f = (st.findings || []).find((x) => Array.isArray(x.options));
  ok(!!f, 'the published finding carries its options');
  ok(f.nodeLabel === 'Pick a seat', 'and the node\'s own label for grouping');
  ok(f.control && Array.isArray(f.control.options),
    'and the control carries them for the overlay');
}

// ── 3. the panel renders Pick buttons and node groups ───────────────────────
{
  const { mountValidationPanel } = await import('../extension/validation/panel.js');
  const root = document.getElementById('p');
  root.textContent = '';
  const calls = [];
  mountValidationPanel(root, { onControl: (c) => calls.push(c) });
  await new Promise((r) => setTimeout(r, 60));
  const picks = [...root.querySelectorAll('button')]
    .filter((b) => (b.dataset.vaKey || '').startsWith('opt:'));
  ok(picks.length === 3, `one button per verified option (${picks.length})`);
  ok(!!root.querySelector('.va-nodehead'),
    'findings are grouped under a node header');
  ok(root.querySelector('.va-nodehead').textContent.includes('Pick a seat'),
    'and the header is the node\'s own label');
  picks[0].click();
  await new Promise((r) => setTimeout(r, 20));
  const c = calls.find((x) => x.option);
  ok(c && c.option === 'aisle $12' && c.widget === 'Which seat do you want?',
    'pressing an option sends a control carrying the page\'s own value');
  ok(calls.some((x) => x.action === 'ack'), 'and the finding is marked dealt with');

  // 4. the control becomes the choose-instruction, respecting the window.
  const say = await Validation.instructionFor(c);
  ok(typeof say === 'string' && say.includes('Choose "aisle $12"'),
    'the instruction carries the chosen value verbatim');
}

// ── 5. a stale-phase option press is kept, not injected ─────────────────────
{
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Pay', alignedNodes: ['2'],
    answers: [{ id: '2', answer: '$181', quote: 'Total $181', confidence: 0.9,
      contradictsAsk: false }],
    noticed: [],
  }));
  await Validation.observe(1);   // the run moves to Pay
  const stale = await Validation.instructionFor({ node: '1',
    widget: 'Which seat do you want?', option: 'window $15' });
  ok(stale && stale.stale === true,
    'choosing for a phase behind the run is kept for the review, not injected');
}

// ── 6. the guided review: outcome first, counted groups ─────────────────────
{
  const st = store['aa.validation'];
  st.findings = [
    { widget: 'Did it book?', phase: 'Pay', level: 'ambient', confirming: false,
      say: 'Did it book? Yes, confirmation 881.', from: 'confirmation 881',
      moment: 'Completion', cluster: 'receipts',
      eu: { now: 0.02, after: 0.05, log: 0.1, ondemand: 0.03 } },
    { widget: 'Price A?', phase: 'Pay', level: 'ambient', confirming: false,
      say: 'Price A? $181.', from: '$181', moment: 'Now', cluster: 'facts',
      eu: { now: 0.03, after: 0.05, log: 0.06, ondemand: 0.02 } },
    { widget: 'Price B?', phase: 'Pay', level: 'ambient', confirming: false,
      say: 'Price B? $175 also shown.', from: '$175', moment: 'Now', cluster: 'facts',
      eu: { now: 0.09, after: 0.07, log: 0.08, ondemand: 0.03 } },
    { widget: 'Seat note', phase: 'Pick a seat', level: 'ambient', confirming: false,
      say: 'Seat note. Exit row costs more.', from: 'exit row $28',
      moment: 'Now', cluster: 'select',
      eu: { now: 0.01, after: 0.02, log: 0.03, ondemand: 0.01 } },
  ];
  st.wrapUp = { at: 1, spoke: 2, outcome: 1, kept: 3 };
  store['aa.validation'] = st;

  const { mountValidationPanel } = await import('../extension/validation/panel.js');
  const root = document.getElementById('p');
  root.textContent = '';
  mountValidationPanel(root, { onControl: () => {} });
  await new Promise((r) => setTimeout(r, 60));
  const rev = root.querySelector('.va-review');
  ok(!!rev, 'the review pane appears once the run has wrapped up');
  ok(rev.textContent.includes('Did it book? Yes'),
    'the outcome is shown first and in full');
  const sums = [...rev.querySelectorAll('summary')].map((s) => s.textContent);
  ok(sums.some((s) => /^2 kept about/.test(s)) && sums.some((s) => /^1 kept about/.test(s)),
    `kept findings are counted groups (${sums.join(' | ')})`);
  const factsGroup = [...rev.querySelectorAll('details')]
    .find((d) => d.querySelector('summary').textContent.startsWith('2 kept'));
  const texts = [...factsGroup.querySelectorAll('.va-text')].map((p) => p.textContent);
  ok(texts[0].startsWith('Price B?'),
    'inside a group the strongest finding by the router\'s own scores comes first');
}

console.log(`\n${pass}/${pass + fail} - options are the page's own values, findings sit `
  + 'under their step, and the review is pulled, not pushed.');
if (fail) process.exit(1);

// ── 7. the plan update, when generation fills the plan in ───────────────────
{
  const st = store['aa.validation'];
  st.planReview = { at: 1, phases: ['Pick a seat', 'Pay'], questions: 9, money: 0 };
  store['aa.validation'] = st;
  const BIG = JSON.parse(JSON.stringify(MODEL));
  for (let i = 0; i < 40; i += 1) {
    BIG.tree.children[0].questions.push({ question: `Extra ${i}?`, cluster: 'facts',
      moment: 'Now', moneyMoving: i < 5 });
  }
  globalThis.ValidationTaskModel.load(BIG, 'generated');
  sent.length = 0;
  const r = await Validation.planUpdate();
  ok(r.spoken === true && r.questions === 42,
    'a plan that grew by half or more corrects its count out loud');
  const line = sent.flatMap((m) => m.lines || []).find((l) => l.widget === 'plan');
  ok(line && /The plan filled in: 42 things checked now, 5 of them before money moves\./.test(line.say),
    'and the line carries the new counts');
  const r2 = await Validation.planUpdate();
  ok(r2.spoken === false, 'and it does not repeat once the count is current');
}

console.log('(plan update block done)');
