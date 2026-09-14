/**
 * The task model's `speak` field, wired into the layer.
 *
 * Every audited model carries, on every question, one of five values that
 * say how loud that question is allowed to be: `gate` (hold the run), `always`
 * (say it each time), `on-event` (say it when the page shows that situation),
 * `if-wrong` (say it when the page disagrees with what the person asked),
 * `never` (silent; the end report has it) - plus `DROP` (not modelled at all).
 * Until this the layer routed on `moment`, and measured on the corpus that was
 * nine times the holds the models ask for.
 *
 * What is tested, driving the shipped session with the model call stubbed:
 *   (a) gate holds the run and renders as the widget
 *   (b) always speaks a checkpoint every time it is reached
 *   (c) on-event speaks only when the read establishes the situation
 *   (d) if-wrong speaks only when the read disagrees with the check
 *   (e) never is not spoken, is absent from the panel's live lines, and is in
 *       the end report
 *   (f) DROP produces no finding at all
 *   (g) a model whose questions carry no speak routes exactly as before
 *   plus the policy rules and the streaming early-surface path
 *
 * Run: node test/speak-test.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="p"></div></body>',
  { url: 'https://www.booking.test/hotel' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event',
                 'getComputedStyle']) {
  global[k] = k === 'window' ? dom.window
    : (k === 'document' ? dom.window.document : dom.window[k]);
}
global.requestAnimationFrame = (f) => setTimeout(f, 0);

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

// ── a chrome just real enough ────────────────────────────────────────────────
const local = new Map();
const spoken = [];
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
  storage: { local: area(local), sync: area(new Map()),
             onChanged: { addListener() {} } },
  runtime: { async sendMessage(msg) { spoken.push(msg); } },
  tabs: { async query() { return [{ id: 1 }]; } },
};

const PAGE = [
  'Rate plan: Flexible rate $180 per night.',
  'Filters: Breakfast included.',
  'Welcome! Sign in or Join for member rates.',
  'Prices shown in USD.',
  'Profile: Work.',
  'Footer links.',
].join('\n');
globalThis.BrowserHarness = {
  async axSnapshot() { return { text: PAGE, url: 'https://www.booking.test/hotel' }; },
};

const R = await import('../extension/validation/reasoner.js');
const P = await import('../extension/validation/policy.js');
const Trace = await import('../extension/validation/trace.js');
const { default: Validation } = await import('../extension/validation/session.js');
const { mountValidationPanel } = await import('../extension/validation/panel.js');

const state = async () => (await chrome.storage.local.get('aa.validation'))['aa.validation'] || {};
const lines = (from) => spoken.slice(from)
  .filter((m) => m.type === 'validationSpeak').flatMap((m) => m.lines || []);
const finding = async (widget) => ((await state()).findings || [])
  .filter((f) => f.widget === widget).pop() || null;

// One node holding six questions, one per speak value plus DROP, and a second
// empty node so a question can be reached at two different phases.
const Q = {
  gate: 'Which rate plan is selected?',
  always: 'Which filters are applied?',
  onEvent: 'Is a sign-in prompt showing?',
  ifWrong: 'What currency is the page in?',
  never: 'Which browser profile is this?',
  drop: 'Is the footer link colour blue?',
};
const MODEL = {
  task: 'book a hotel room online',
  tree: { id: '0', label: 'Book a hotel', children: [
    { id: '1', label: 'Pick a room', questions: [
      { question: Q.gate, cluster: 'select', moment: 'Now', speak: 'gate' },
      // moment After: the old quiet flag would have silenced this aside.
      { question: Q.always, cluster: 'refine', moment: 'After', speak: 'always' },
      { question: Q.onEvent, cluster: 'approve', moment: 'Now', speak: 'on-event' },
      { question: Q.ifWrong, cluster: 'facts', moment: 'Now', speak: 'if-wrong' },
      // moneyMoving on a never question: the audited value decides, not the
      // money lock, or 1,490 of the corpus's 1,747 money questions would hold.
      { question: Q.never, cluster: 'hand over', moment: 'Now', speak: 'never', moneyMoving: true },
      { question: Q.drop, cluster: 'facts', moment: 'Now', speak: 'DROP' },
    ] },
    { id: '2', label: 'Pay' },
  ] },
};
const flat = R.flattenModel(MODEL);
const idOf = (q) => flat.questions.find((x) => x.question === q)?.id;

const ROW = {
  [Q.gate]: { answer: 'Flexible rate $180', quote: 'Flexible rate $180' },
  [Q.always]: { answer: 'Breakfast included', quote: 'Breakfast included' },
  [Q.onEvent]: { answer: 'Yes, Sign in or Join', quote: 'Sign in or Join' },
  [Q.ifWrong]: { answer: 'USD', quote: 'Prices shown in USD' },
  [Q.never]: { answer: 'Work', quote: 'Profile: Work' },
};

/** Stub the reasoner to answer these questions on the next read. */
function page(answers, { nodes = ['1'], phase = 'Pick a room' } = {}) {
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: phase,
    alignedNodes: nodes,
    answers: answers.map(([q, extra]) => ({
      id: idOf(q), ...ROW[q], confidence: 0.9, contradictsAsk: false, ...(extra || {}),
    })),
    noticed: [],
  }));
}

async function fresh() {
  globalThis.ValidationTaskModel.load(MODEL, 'test');
  await Validation.start('book a refundable hotel room under $200 in USD');
}

async function paint() {
  const root = document.getElementById('p');
  root.textContent = '';
  mountValidationPanel(root, { onControl() {} });
  await new Promise((r) => setTimeout(r, 30));
  return root;
}

// ── the vocabulary ───────────────────────────────────────────────────────────
ok(P.speakOf('gate') === 'gate' && P.speakOf(' If-Wrong ') === 'if-wrong',
  'speak values are read case- and space-insensitively');
ok(P.speakOf('DROP') === null && P.speakOf('loud') === null && P.speakOf(undefined) === null,
  'DROP and anything unknown are not routing values');

// ── (f) DROP produces no finding ─────────────────────────────────────────────
{
  ok(flat.questions.length === 5, 'the dropped question is not in the flattened model');
  ok(!flat.questions.some((q) => q.question === Q.drop), 'and it is not asked of the page');
  ok(!R.buildPrompt(flat, PAGE).includes(Q.drop), 'so it never reaches the prompt');
  ok(flat.questions.every((q) => typeof q.speak === 'string'),
    'every kept question carries its speak value');
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Pick a room', alignedNodes: ['1'], noticed: [],
    answers: [{ id: '1#6', answer: 'blue', quote: 'Footer links', confidence: 0.9, contradictsAsk: false }],
  }));
  const r = await R.readPage(flat, PAGE);
  ok(r.meta.unmatched === 1 && R.toFindings(r, 'Pick a room').length === 0,
    'a stray answer for it is unmatched and becomes no finding');
}

// ── (a) gate holds the run and shows the widget ──────────────────────────────
{
  await fresh();
  const at = spoken.length;
  page([[Q.gate]]);
  const r = await Validation.observe(1);
  ok(r.findings === 1, 'the page answered the gate question');
  const s = await state();
  ok(s.gate?.allowed === false, 'a gate question holds the run');
  ok((s.gate.waitingOn || []).includes(Q.gate) && s.gate.leading === Q.gate,
    'and it is the thing being waited on');
  const said = lines(at).filter((l) => l.widget === Q.gate);
  ok(said.length === 1 && said[0].level === 'stop' && said[0].live === 'assertive',
    'it is spoken once, assertively, as a stop');
  const f = await finding(Q.gate);
  ok(f?.level === 'stop' && f.speak === 'gate' && f.surface === 'widget' && f.fired === true,
    'the published finding says which surface it took and why');
  ok(typeof f?.surfaceWhy === 'string' && /gate/.test(f.surfaceWhy),
    'with the reason on it');
  ok((await Validation.allow('click reserve')).allowed === false,
    'the agent may not commit past it');
  const root = await paint();
  ok(root.querySelector('.va-gate')?.getAttribute('role') === 'alertdialog',
    'the panel renders it as the widget');
  const last = (await Trace.all()).filter((e) => e.action === 'read the page').pop();
  ok(last?.findings?.[0]?.surface === 'widget', 'and the trace records the surface');
  await Validation.answer(Q.gate, 'go on');
  ok((await Validation.allow('click reserve')).allowed === true,
    'answering it opens the gate');
}

// ── (b) always speaks a checkpoint every time it is reached ─────────────────
{
  await fresh();
  let at = spoken.length;
  page([[Q.always]]);
  await Validation.observe(1);
  let said = lines(at).filter((l) => l.widget === Q.always);
  ok(said.length === 1 && said[0].level === 'aside' && said[0].live === 'polite',
    'an always question is spoken as a polite checkpoint');
  const f = await finding(Q.always);
  ok(f?.surface === 'checkpoint' && f.speak === 'always' && f.fired === true,
    'the finding records the checkpoint surface');
  ok((await state()).gate?.allowed !== false
     && (await Validation.allow('click reserve')).allowed === true,
    'and nothing is held');
  ok(f?.route == null && f?.eu == null,
    'the utility model did not route it - speak replaced the computation');

  at = spoken.length;
  await Validation.observe(1);
  ok(lines(at).filter((l) => l.widget === Q.always).length === 0,
    're-reading the same page at the same step does not say it twice');

  at = spoken.length;
  page([[Q.always]], { phase: 'Pay' });
  await Validation.observe(1);
  said = lines(at).filter((l) => l.widget === Q.always);
  ok(said.length === 1, 'reached again at the next step, it is said again');
}

// ── (c) on-event speaks only when the read establishes the situation ────────
{
  await fresh();
  let at = spoken.length;
  page([[Q.onEvent]], { nodes: ['1'] });
  await Validation.observe(1);
  ok(lines(at).some((l) => l.widget === Q.onEvent && l.live === 'polite'),
    'aligned to the question\'s step, the situation is on the page: spoken');
  let f = await finding(Q.onEvent);
  ok(f?.surface === 'checkpoint' && f.fired === true, 'and recorded as a fired checkpoint');

  at = spoken.length;
  page([[Q.onEvent]], { nodes: [], phase: 'Pay' });
  await Validation.observe(1);
  ok(!lines(at).some((l) => l.widget === Q.onEvent),
    'answered off a page the reasoner did not align to that step: silent');
  f = await finding(Q.onEvent);
  ok(f?.level === 'ambient' && f.surface === 'log' && f.fired === false,
    'kept for the report, not spoken');
  ok(/not at that step|does not show/.test(f?.surfaceWhy || ''),
    'with the reason it stayed silent written down');

  // The situation counts as on the page when the reasoner aligns to the
  // question's own node or to a step under it - never to a lookalike id.
  const row = { id: '1', node: '1', question: 'q', answer: 'a', quote: 'Rate plan',
    verify: 'verified_exact', speak: 'on-event', cluster: 'facts', moment: 'Now' };
  const under = R.toFindings({ alignedNodes: ['1.2'], answers: [row], noticed: [] }, 'p')[0];
  const lookalike = R.toFindings({ alignedNodes: ['11'], answers: [row], noticed: [] }, 'p')[0];
  ok(under.onPage === true && lookalike.onPage === false,
    'a step under the node counts as the node; a lookalike id does not');
}

// ── (d) if-wrong speaks only when the read disagrees with the check ─────────
{
  await fresh();
  let at = spoken.length;
  page([[Q.ifWrong, { contradictsAsk: false }]]);
  await Validation.observe(1);
  ok(!lines(at).some((l) => l.widget === Q.ifWrong),
    'the page agrees with what was asked: silent');
  let f = await finding(Q.ifWrong);
  ok(f?.level === 'ambient' && f.surface === 'log' && f.fired === false,
    'kept for the report');

  at = spoken.length;
  page([[Q.ifWrong, { contradictsAsk: true }]], { phase: 'Pay' });
  await Validation.observe(1);
  const said = lines(at).filter((l) => l.widget === Q.ifWrong);
  ok(said.length === 1 && said[0].level === 'aside' && said[0].live === 'polite',
    'the page disagrees: spoken as a checkpoint');
  f = await finding(Q.ifWrong);
  ok(f?.surface === 'checkpoint' && f.fired === true && f.contradicts === true,
    'recorded as fired, with the contradiction on it');
  ok((await state()).gate?.allowed !== false
     && (await Validation.allow('click reserve')).allowed === true,
    'and it does not hold: a checkpoint is not a gate');
}

// ── (e) never: unspoken, off the live panel, in the end report ──────────────
{
  await fresh();
  const at = spoken.length;
  page([[Q.never, { contradictsAsk: true }]]);
  await Validation.observe(1);
  ok(!lines(at).some((l) => l.widget === Q.never),
    'a never question is not spoken, even contradicted, even money-moving');
  const f = await finding(Q.never);
  ok(f?.level === 'ambient' && f.surface === 'log' && f.speak === 'never',
    'it is on the record as a log entry');
  ok((await state()).gate?.allowed !== false, 'and holds nothing');
  let root = await paint();
  ok(![...root.querySelectorAll('.va-item')].some((li) => li.textContent.includes(Q.never)),
    'the panel\'s live list does not show it');

  const before = spoken.length;
  await Validation.wrapUp('done');
  const wrap = lines(before);
  ok(wrap.some((l) => l.widget === Q.never), 'the end report speaks it');
  root = await paint();
  const review = root.querySelector('.va-review');
  ok(!!review && review.textContent.includes(Q.never), 'and the panel\'s review lists it');
  ok(/log/.test(review?.querySelector('.va-surface')?.textContent || ''),
    'naming the surface it took');
}

// ── (g) a model with no speak routes exactly as before ──────────────────────
{
  const strip = (n) => ({ ...n,
    questions: n.questions?.map(({ speak, ...q }) => q),
    children: n.children?.map(strip) });
  const OLD = { task: MODEL.task, tree: strip(MODEL.tree) };
  globalThis.ValidationTaskModel.load(OLD, 'test');
  await Validation.start('book a refundable hotel room under $200 in USD');
  const oflat = R.flattenModel(OLD);
  ok(oflat.questions.length === 6 && oflat.questions.every((q) => q.speak === null),
    'without speak nothing is dropped and nothing carries a value');
  const oid = (q) => oflat.questions.find((x) => x.question === q).id;
  const at = spoken.length;
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: 'Pick a room', alignedNodes: ['1'], noticed: [],
    answers: [
      { id: oid(Q.ifWrong), ...ROW[Q.ifWrong], confidence: 0.9, contradictsAsk: true },
      { id: oid(Q.gate), ...ROW[Q.gate], confidence: 0.9, contradictsAsk: false },
      { id: oid(Q.never), ...ROW[Q.never], confidence: 0.9, contradictsAsk: false },
    ],
  }));
  await Validation.observe(1);
  const said = lines(at);
  const wrong = await finding(Q.ifWrong);
  ok(wrong?.level === 'stop' && said.some((l) => l.widget === Q.ifWrong && l.level === 'stop'),
    'a contradiction still locks a stop on the moment path');
  const money = await finding(Q.never);
  ok(money?.level === 'stop', 'and so does a money-moving question');
  const now = await finding(Q.gate);
  ok(now?.level === 'aside' && typeof now.route === 'string' && now.eu != null,
    'a plain Now question is routed by the utility model, as before');
  ok(now?.speak == null && now?.surface === 'checkpoint',
    'with no speak value, but still saying which surface it took');
  ok((await state()).gate?.allowed === false, 'the stops hold the run');
}

// ── the policy, question by question ────────────────────────────────────────
{
  const base = { widget: 'q', phase: 'p', moment: 'Now', confidence: 0.9,
    verified: 'verified_exact', contradicts: false, confirming: false, say: 'q. a.' };
  const d = (f, st = {}) => P.decide({ ...base, ...f }, { seen: new Set(), ...st });
  ok(d({ speak: 'gate' }).level === 'stop' && d({ speak: 'gate' }).surface === 'widget',
    'gate -> the widget');
  ok(d({ speak: 'gate', moment: 'Completion' }).level === 'stop',
    'speak beats moment: a gate at a Completion moment still holds');
  ok(d({ speak: 'always' }).level === 'aside' && d({ speak: 'always' }).surface === 'checkpoint',
    'always -> a checkpoint');
  ok(d({ speak: 'on-event', onPage: true }).level === 'aside'
     && d({ speak: 'on-event', onPage: false }).level === 'ambient'
     && d({ speak: 'on-event' }).level === 'ambient',
    'on-event -> a checkpoint only when the page is at that step, else the log');
  ok(d({ speak: 'if-wrong', contradicts: true }).level === 'aside'
     && d({ speak: 'if-wrong', contradicts: false }).level === 'ambient',
    'if-wrong -> a checkpoint only when the page disagrees, else the log');
  ok(d({ speak: 'never', contradicts: true, moneyMoving: true }).level === 'ambient',
    'never -> the log, whatever else the finding carries');
  ok(d({ speak: 'always' }, { style: 'quiet' }).level === 'aside'
     && d({ speak: 'always' }, { style: 'thorough' }).level === 'aside',
    'a persona notch moves neither way off an audited value');
  ok(d({ speak: 'always' }).route === undefined && d({ speak: 'always' }).eu === undefined,
    'speak short-circuits the utility model rather than feeding it');
  const seen = new Set(['q|p']);
  ok(d({ speak: 'gate' }, { seen }).level === 'ambient',
    'a gate already raised at this step is not raised again');
  const plain = d({});
  ok(typeof plain.route === 'string' && plain.speak === undefined,
    'no speak: the utility route, and no speak fields on the decision');
  ok(d({ speak: 'loud' }).route !== undefined,
    'an unknown speak value falls back to the moment path rather than guessing');
}

// ── the streaming early surface follows speak too ───────────────────────────
{
  const reply = JSON.stringify({
    alignedPhase: 'Pick a room', alignedNodes: ['1'], noticed: [],
    answers: [
      { id: idOf(Q.ifWrong), ...ROW[Q.ifWrong], confidence: 0.9, contradictsAsk: true },
      { id: idOf(Q.gate), ...ROW[Q.gate], confidence: 0.9, contradictsAsk: false },
      { id: idOf(Q.never), ...ROW[Q.never], confidence: 0.9, contradictsAsk: false },
    ],
  });
  R.setGeminiStreamCaller(async (prompt, opts, onText) => {
    const cut = Math.floor(reply.length / 2);
    await onText(reply.slice(0, cut));
    await onText(reply.slice(cut));
    return reply;
  });
  const early = [];
  const r = await R.readPage(flat, PAGE, { onRow: async (row) => { early.push(row); } });
  ok(r.ok && r.meta.earlyIds.length === 1 && r.meta.earlyIds[0] === idOf(Q.gate),
    'only the gate row is surfaced mid-stream');
  ok(early[0]?.speak === 'gate', 'and it carries its speak value');
  ok(!r.meta.earlyIds.includes(idOf(Q.ifWrong)),
    'a contradicted if-wrong row waits for the full reply: it is a checkpoint, not a stop');
  ok(!r.meta.earlyIds.includes(idOf(Q.never)),
    'a money-moving never row is not a stop either');
  R.setGeminiStreamCaller(null);
}

globalThis.ValidationTaskModel.unload();

console.log(`\n${pass}/${pass + fail} - speak decides the surface, moment is only the fallback, `
  + 'and silence is the default.');
if (fail) process.exit(1);
