/**
 * Stress: the layer at sizes and rates the unit tests never reach.
 *
 * Nothing here is a toy. The pages are the real captured ones (the 8,901-word
 * Amazon results tree), the model is the shipped 352-question hotel HTA, and
 * the failure modes are the ones scale actually produces: floods of findings,
 * a worker torn down mid-hold, garbage numbers reaching the router, fifty
 * publishes racing, and a query fuzz over the retrieval gate.
 *
 * Run: node test/stress-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const RESEARCH = join(homedir(), 'Stanford/Summer Project Ideation /Verification Affordances');

// ── shared chrome mock (storage survives across module instances) ───────────
const local = new Map();
const sync = new Map();
const sent = [];
const area = (m) => ({
  async get(keys) {
    const want = keys == null ? [...m.keys()] : (Array.isArray(keys) ? keys : [keys]);
    const out = {};
    for (const k of want) if (m.has(k)) out[k] = m.get(k);
    return out;
  },
  async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, JSON.parse(JSON.stringify(v))); },
  async remove(k) { m.delete(k); },
});
global.chrome = {
  storage: { local: area(local), sync: area(sync), onChanged: { addListener() {} } },
  runtime: { async sendMessage(m) { sent.push(m); } },
  tabs: { async query() { return [{ id: 1 }]; } },
};
globalThis.BrowserHarness = { async axSnapshot() { return { text: 'x', url: 'https://x.test' }; } };

const U = await import('../extension/validation/utility.js');
const P = await import('../extension/validation/policy.js');
const R = await import('../extension/validation/reasoner.js');
const G = await import('../extension/validation/generate.js');
const RunMod = await import('../extension/validation/run.js');

// ── 1. the shipped 352-question model against the real 8,901-word page ──────
{
  const hotel = JSON.parse(readFileSync('extension/validation/htas/hotel.json', 'utf8'));
  const pagePath = join(RESEARCH, 'assets/task-mapping/_obs/sandals-step1.txt');
  const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8')
    : 'x '.repeat(30000);   // the machinery is still exercised if the capture moved

  const flat = R.flattenModel(hotel);
  ok(flat.questions.length === 352, 'the full hotel model flattens to its 352 questions');

  // The model answers a sparse handful, one with an id no question carries,
  // one with a quote the page does not contain - the shapes a real reply has.
  const legit = flat.questions[10];
  const quote = page.slice(500, 560);
  R.setGeminiCaller(async () => JSON.stringify({
    alignedPhase: flat.phases[0], alignedNodes: [legit.node],
    answers: [
      { id: legit.id, answer: 'yes', quote, confidence: 0.9, contradictsAsk: false },
      { id: 'no-such-node#9', answer: 'ghost', quote, confidence: 0.9, contradictsAsk: false },
      { id: flat.questions[20].id, answer: 'made up', quote: 'WORDS NOT ON THE PAGE AT ALL',
        confidence: 0.9, contradictsAsk: false },
    ],
    noticed: [],
  }));
  const t0 = Date.now();
  const res = await R.readPage(flat, page, {});
  const ms = Date.now() - t0;
  ok(res.ok === true, 'a sparse reply against the full model parses');
  ok(res.meta.asked === 352, 'all 352 questions were carried');
  ok(res.meta.answered === 1 && res.meta.discarded === 1,
    'the verified answer lands and the unbacked one is discarded, not shipped');
  ok(res.meta.unmatched === 1, 'the ghost id is counted instead of vanishing');
  ok(ms < 2000, `the non-model half of a 352-question read is cheap (${ms}ms)`);
}

// ── 2. a flood of findings through one run ──────────────────────────────────
{
  const run = RunMod.createRun({ item: 'sandals', budget: 40 });
  const flood = [];
  for (let i = 0; i < 400; i += 1) {
    flood.push({
      widget: `Question ${i}?`, phase: 'Search', say: `Question ${i}? Answer ${i}.`,
      from: 'q', answerable: true, confirming: false, contradicts: false,
      moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
    });
  }
  const t0 = Date.now();
  const { findings } = run.observeFindings(flood, 'Search');
  const ms = Date.now() - t0;
  const levels = findings.map((f) => f.level);
  ok(findings.length === 400, 'four hundred findings in one page read all get a level');
  ok(ms < 3000, `and routing them is fast (${ms}ms)`);
  // The routing is history free by design, so four hundred identical findings
  // route identically. This is the honest consequence and the number worth
  // watching: what bounds a run's spoken items is the count of findings a
  // page actually answers, not anything the router remembers.
  const spokenCount = levels.filter((l) => l !== 'ambient').length;
  ok(new Set(levels).size === 1,
    `four hundred identical findings route identically (${spokenCount} would be spoken)`);
  ok(run.gate().allowed === true, 'no stop in the flood, so nothing holds');

  // The same flood again is all repeats: nothing new is spoken.
  const again = run.observeFindings(flood, 'Search').findings;
  ok(again.every((f) => f.level === 'ambient'), 'the same flood again is silent');

  // A contradiction still cuts through after 800 routed findings.
  const cut = run.observeFindings([{
    widget: 'Is this the right item?', phase: 'Search',
    say: 'Is this the right item? No, it is a boot.', from: 'boot',
    answerable: true, confirming: false, contradicts: true,
    moment: 'Now', moneyMoving: false, confidence: 0.9, verified: 'verified_exact',
  }], 'Search').findings;
  ok(cut[0].level === 'stop', 'a contradiction still stops after 800 routed findings');
  ok(run.gate().allowed === false, 'and it holds the gate');
  ok(run.gate().leading === 'Is this the right item?', 'and the gate names it');
}

// ── 3. the storage cap under publish pressure ───────────────────────────────
{
  local.clear();
  const S1 = (await import('../extension/validation/session.js?v=cap')).default;
  await S1.start('stress the caps');
  const batch = (n, from) => Array.from({ length: n }, (_, i) => ({
    widget: `W${from + i}`, level: 'ambient', say: `W${from + i}. Yes.`,
    from: 'q', confirming: false, phase: 'Search', moment: 'Now',
  }));
  for (let round = 0; round < 5; round += 1) {
    await S1.annotate({ append: batch(100, round * 100) });
  }
  const st = local.get('aa.validation');
  ok(st.findings.length === 300, `five hundred findings store as the last ${st.findings.length} (cap holds)`);
  ok(st.findings[0].widget === 'W200', 'and it is the oldest that fell off');
}

// ── 4. a worker torn down mid-hold, three times over ────────────────────────
{
  local.clear();
  sent.length = 0;
  const S1 = (await import('../extension/validation/session.js?v=r1')).default;
  await S1.start('find sandals under $40');
  await S1.annotate({
    append: [{ widget: 'Which size went in?', level: 'stop', phase: 'Check item',
      say: 'Which size went in? 5 Toddler.', from: 'Size', confirming: false }],
  });
  const g1 = await S1.allow('click add to cart');
  ok(g1.allowed === false, 'a stop holds before the first teardown');

  // Each fresh import is a fresh service worker: module state gone, storage
  // intact. Three consecutive restarts must each rebuild the same hold.
  for (const v of ['r2', 'r3', 'r4']) {
    const S = (await import(`../extension/validation/session.js?v=${v}`)).default;
    const g = await S.allow('click add to cart');
    ok(g.allowed === false, `restart ${v}: the hold survives the teardown`);
  }

  const S5 = (await import('../extension/validation/session.js?v=r5')).default;
  await S5.answer('Which size went in?', 'use size 5 big kid');
  const g2 = await S5.allow('click add to cart');
  ok(g2.allowed === true, 'answering after three restarts releases the gate');
}

// ── 5. garbage in, routes out ───────────────────────────────────────────────
{
  const base = { widget: 'q', phase: 'p', say: 's', confirming: false, contradicts: false };
  const weird = [
    { ...base, moment: 'Now', confidence: NaN },
    { ...base, moment: 'Now', confidence: -5 },
    { ...base, moment: 'Now', confidence: 2 },
    { ...base, moment: 'garbage-moment', confidence: 0.5 },
    { ...base, moment: 'Now', confidence: undefined, verified: null },
    { ...base, moment: 'Now', moneyMoving: 'yes' },   // string, not boolean
  ];
  let sane = true;
  for (const f of weird) {
    for (const spoken of [0, 7, 500]) {
      const r = U.route(f, { spoken });
      if (!U.ROUTES.includes(r.route)) sane = false;
      for (const v of Object.values(r.eu)) if (Number.isNaN(v)) sane = false;
    }
  }
  ok(sane, 'garbage confidences and moments still produce a route and no NaN');

  // Routing is history free: no amount of anything passed as history moves a
  // score. This is the property that replaced the old fatigue curve.
  const f = { ...base, moment: 'Now', confidence: 0.8, verified: 'verified_exact' };
  const baseline = JSON.stringify(U.route(f, {}).eu);
  let stable = true;
  for (const n of [1, 10, 200]) {
    if (JSON.stringify(U.route(f, { spoken: n, spent: n, said: n }).eu) !== baseline) {
      stable = false;
    }
  }
  ok(stable, 'no history of any shape moves a score - the routing is history free');

  const d = P.decide({ ...base, moment: 'Now', confidence: NaN }, {});
  ok(['ambient', 'aside', 'stop'].includes(d.level), 'decide() absorbs the same garbage');
}

// ── 6. retrieval fuzz: sixty ways to not match ──────────────────────────────
{
  const idx = JSON.parse(readFileSync('extension/validation/htas/index.json', 'utf8'));
  const offDomain = [
    'order a pepperoni pizza for delivery', 'buy sandals size 5 under $40 on amazon',
    'find a nonstop flight to seattle', 'renew my passport by mail',
    'when was the eiffel tower finished', 'transfer $200 to my savings account',
    'cancel my gym membership', 'file a complaint about a late package',
    'download my bank statement', 'reset my email password',
    'what is the capital of mongolia', 'book club recommendations for october',
    'reserve a table for four tonight', 'rent a car at the airport',
    'schedule a haircut', 'get concert tickets for saturday',
    'apply for a library card', 'return these shoes', 'track my order',
    'set up a new phone', 'compare car insurance quotes', 'pay my electric bill',
    'book something', 'book a room', 'i need an appointment', 'make it private',
    'find a doctor who', 'hotel california lyrics', 'doctor who episode guide',
    'appointment to the supreme court', 'privacy policy of this website',
  ];
  const falseHits = [];
  for (const q of offDomain) {
    const m = G.matchDomain(q, idx);
    // "book a room" is the one honest borderline: it is a hotel query to most
    // ears. Anything else matching is a false retrieval.
    if (m && q !== 'book a room') falseHits.push(`"${q}" -> ${m}`);
  }
  ok(falseHits.length === 0,
    `no false retrievals across ${offDomain.length} off-domain queries`
    + (falseHits.length ? ` (${falseHits.join('; ')})` : ''));

  const onDomain = [
    ['book a hotel room in tokyo for two nights', 'hotel'],
    ['book a doctor appointment on zocdoc for a skin check', 'doctor'],
    ['change my privacy settings so my activity history is off', 'privacy'],
  ];
  let hits = 0;
  for (const [q, want] of onDomain) if (G.matchDomain(q, idx) === want) hits += 1;
  ok(hits === 3, 'and all three on-domain phrasings still retrieve');
}

// ── 7. fifty publishes racing ───────────────────────────────────────────────
{
  local.clear();
  const S = (await import('../extension/validation/session.js?v=race')).default;
  await S.start('race the publishes');
  const writes = [];
  for (let i = 0; i < 50; i += 1) {
    writes.push(S.annotate({
      append: [{ widget: `R${i}`, level: 'ambient', say: `R${i}. Yes.`,
        from: 'q', confirming: false, phase: 'Search' }],
    }));
  }
  await Promise.all(writes);
  const st = local.get('aa.validation');
  const got = new Set(st.findings.map((f) => f.widget));
  let all = true;
  for (let i = 0; i < 50; i += 1) if (!got.has(`R${i}`)) all = false;
  ok(all, 'fifty concurrent publishes lose nothing');
}

// ── 8. a wrap-up over a full run's residue ──────────────────────────────────
{
  local.clear();
  sent.length = 0;
  const S = (await import('../extension/validation/session.js?v=wrap')).default;
  await S.start('big finish');
  const residue = [];
  for (let i = 0; i < 250; i += 1) {
    residue.push({ widget: `K${i}`, phase: 'Search', level: 'ambient',
      say: `K${i}. Yes.`, moment: i % 10 === 0 ? 'Completion' : 'Now',
      confirming: false, eu: { now: i / 1000, after: 0.01, log: 0.02, ondemand: 0 } });
  }
  const p = local.get('aa.validation') || {};
  local.set('aa.validation', { ...p, findings: residue, acknowledged: [] });
  const t0 = Date.now();
  const r = await S.wrapUp('done');
  ok(r.outcome === 4 && r.spoke === 8,
    `250 leftover findings wrap up as 4 outcomes + 3 kept + the count (spoke ${r.spoke})`);
  ok(Date.now() - t0 < 1500, 'and the wrap-up at that size is quick');
  const speak = sent.find((m) => m.phase === 'wrap up');
  ok(/243 more things are in the panel/.test(speak.lines[7].say),
    'the two hundred not spoken are counted, to the item');
}

console.log(`\n${pass}/${pass + fail} - the layer holds its shape at sizes the unit tests never reach.`);
if (fail) process.exit(1);
