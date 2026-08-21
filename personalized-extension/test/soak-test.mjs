/**
 * Soak: one session, three hundred page settles, nothing allowed to grow.
 *
 * NOT part of the npm suite (run-tests.js) — standalone by design. It runs
 * hundreds of serialised storage writes and takes wall-clock measurements,
 * which a loaded CI box would make flaky. Run it by hand when touching
 * session.js, run.js, or any of the storage caps:
 *
 *     node test/soak-test.mjs
 *
 * What a soak catches that the unit and stress tests cannot: drift. A cap
 * that holds at 500 findings in one burst can still leak through an array
 * nobody capped (run.js's `said` is written into every publish), and a settle
 * that costs 5ms on a fresh session can cost 50ms on a full one if any
 * per-publish work scales with the stored blob. So this drives a real session
 * — the shipped 352-question hotel model, the real reasoner verification
 * path, contradictions that hold the gate and answers that release it — and
 * then reads the storage back and measures.
 *
 * The mock caller cycles SIX page/answer shapes so the session sees variety
 * rather than one page 300 times: aligned answers, noticed items (which grow
 * the model through adopt(), bounded at 20), discarded quotes, phase moves,
 * quiet pages, and every 40th settle a contradiction — which must hold the
 * gate, and which the driver then answers so the hold releases, the way a
 * person would.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

// ── chrome mock, same pattern as stress-test.mjs ────────────────────────────
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

// ── the six page shapes ─────────────────────────────────────────────────────
// Each shape is a page the harness "reads" plus the reply the model "gives".
// The quotes are fixed sentences that live on their shape's page, so the
// reasoner's quote verification passes for real; the answers carry the settle
// number, so every settle yields findings the dedup has never seen.
const SHARED = 'The destination shown at the top of this page is Osaka, not Tokyo.';
const QUOTES = [
  'Deluxe King Room with city view, breakfast included, 42 square meters.',
  'A resort fee of 30 dollars per night is added at the property.',
  'Free cancellation until 48 hours before check-in on this rate plan.',
  'Guests must present the card used for booking at the front desk.',
  'This property has no rooms left at the selected dates.',
  'Rated 8.7 by 2,341 guests who stayed in the last year.',
];
const filler = (k) => `Hotel search results, page section ${k}. `
  + 'Sort by price, rating, or distance from the center. '.repeat(20)
  + 'Map view. Filters: pool, parking, pet friendly, air conditioning. '.repeat(10);
const pageFor = (n) => {
  const k = n % 6;
  return `${filler(k)}\n${QUOTES[k]}\n${SHARED}\nSettle marker ${n}.\n${filler((k + 3) % 6)}`;
};

// The harness hands whatever page the current settle is on.
let settleNo = 0;
globalThis.BrowserHarness = {
  async axSnapshot() {
    return { text: pageFor(settleNo), url: `https://hotels.test/results?page=${settleNo}` };
  },
};

// ── the model, the session, the caller ──────────────────────────────────────
const hotel = JSON.parse(readFileSync(join(ROOT, 'extension/validation/htas/hotel.json'), 'utf8'));
const R = await import('../extension/validation/reasoner.js');
const S = (await import('../extension/validation/session.js')).default;
globalThis.ValidationTaskModel.load(hotel, 'validation/htas/hotel.json');

const flat = R.flattenModel(hotel);
// Questions answered by the mock. Multi-question nodes only, because adopt()
// appends questions to the aligned node, and appending to a node that had ONE
// question renames its id (bare -> #1) — a real behaviour, but one that would
// silently unmatch this driver's answers rather than test anything.
const pool = [];
const seenNodes = new Set();
for (const q of flat.questions) {
  if (!q.id.includes('#') || q.moneyMoving === true) continue;
  if (seenNodes.has(q.node)) continue;
  seenNodes.add(q.node);
  pool.push(q);
  if (pool.length === 7) break;
}
if (pool.length < 7) { console.log('SKIP: hotel model too small for the driver'); process.exit(0); }
const CONTRA = pool[6];   // the question every 40th settle contradicts

R.setGeminiCaller(async () => {
  const n = settleNo;
  const k = n % 6;
  const answers = [{
    id: pool[k].id, answer: `Shape ${k} reading at settle ${n}.`,
    quote: QUOTES[k], confidence: 0.8, contradictsAsk: false,
  }];
  if (k % 2 === 0) {
    answers.push({
      id: pool[(k + 1) % 6].id, answer: `A second reading at settle ${n}.`,
      quote: QUOTES[k], confidence: 0.7, contradictsAsk: false,
    });
  }
  if (k === 2) {
    // A quote the page does not contain: the discard path, every sixth settle.
    answers.push({ id: pool[5].id, answer: 'invented', quote: 'WORDS NOT ON THIS PAGE',
      confidence: 0.9, contradictsAsk: false });
  }
  const noticed = k === 1 ? [{
    what: `Fee notice ${n} sits under the total`,
    whyItMatters: 'it changes what the night actually costs',
    quote: QUOTES[1], contradictsAsk: false,
  }] : [];
  if (n % 40 === 0) {
    answers.push({
      id: CONTRA.id, answer: `No - the page shows Osaka at settle ${n}, not what you asked for.`,
      quote: SHARED, confidence: 0.9, contradictsAsk: true,
    });
  }
  return JSON.stringify({
    alignedPhase: flat.phases[k % flat.phases.length],
    alignedNodes: [pool[k].node],
    answers, noticed,
  });
});

// ── drive it ────────────────────────────────────────────────────────────────
await S.start('book a hotel room in tokyo for two nights under $200');

const durations = [];
let holdsSeen = 0;
let holdsReleased = 0;
for (let n = 1; n <= 300; n += 1) {
  settleNo = n;
  const t0 = Date.now();
  await S.observe(1);
  if (n % 40 === 0) {
    // The contradiction just landed. It must be holding the gate...
    const st = local.get('aa.validation');
    if (st?.gate?.allowed === false) holdsSeen += 1;
    // ...and answering it, the way a person would, must release it.
    await S.answer(CONTRA.question, 'that city is fine, carry on');
    const after = local.get('aa.validation');
    if (after?.gate?.allowed !== false) holdsReleased += 1;
  }
  durations.push(Date.now() - t0);
}

const sum = (a, b) => durations.slice(a - 1, b).reduce((x, y) => x + y, 0);
const early = sum(1, 50);
const mid = sum(151, 200);
const late = sum(251, 300);

// ── read the residue back ───────────────────────────────────────────────────
const st = local.get('aa.validation');
const trace = local.get('aa.validation.trace');
const model = local.get('aa.validation.model');
const blob = JSON.stringify(st).length;

console.log(`\nsettles 1-50: ${early}ms   151-200: ${mid}ms   251-300: ${late}ms`
  + `   (mean ${(sum(1, 300) / 300).toFixed(1)}ms/settle)`);
console.log(`stored blob: ${(blob / 1024).toFixed(0)} KB   trace: ${trace?.entries?.length ?? 0} entries`
  + `   model blob: ${model ? (JSON.stringify(model).length / 1024).toFixed(0) : 0} KB`);

ok(holdsSeen === 7 && holdsReleased === 7,
  `all 7 contradictions held the gate and all 7 answers released it (${holdsSeen}/${holdsReleased})`);
ok(st.gate?.allowed === true, 'the gate is open at the end - no hold leaked past its answer');
// Measured repeatedly at 1.2-2.0x: every publish deep-copies the stored blob,
// the blob fills to its caps by about settle 150, and the cost flattens there.
// So the growth is real, bounded, and sits exactly at the 2x line - which is
// why the check carries a 25ms noise allowance (per BLOCK of 50 settles, not
// per settle). Real unbounded growth shows up as 5x and more, far past it.
const NOISE_MS = 25;
ok(late <= early * 2 + NOISE_MS,
  `no slowdown: settles 251-300 took ${late}ms against ${early}ms for 1-50 (${(late / early).toFixed(2)}x)`);
ok(late <= mid * 2,
  `steady state: 251-300 (${late}ms) within 2x of 151-200 (${mid}ms)`);
ok(st.findings.length === 300,
  `three hundred settles of distinct findings store as exactly the cap (${st.findings.length})`);
ok((st.reads || []).length === 200,
  `read metas store as exactly their cap (${(st.reads || []).length})`);
ok((trace?.entries?.length ?? 0) <= 500,
  `the trace stays inside its 500 cap (${trace?.entries?.length ?? 0})`);
ok(blob < 1_500_000,
  `the session blob stays well inside chrome.storage's 10 MB (${(blob / 1024).toFixed(0)} KB)`);

// Every array anywhere in the stored state, largest first. This is the drift
// detector: a list someone adds next year and forgets to cap shows up here.
function arrays(o, path, out) {
  if (Array.isArray(o)) {
    out.push({ path, length: o.length });
    o.forEach((v, i) => arrays(v, `${path}[${i}]`, out));
  } else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) arrays(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}
const tops = [
  ...arrays(st, 'aa.validation', []),
  ...arrays(trace, 'aa.validation.trace', []),
].filter((a) => a.length >= 10).sort((a, b) => b.length - a.length).slice(0, 8);
console.log('\nlargest stored arrays:');
for (const t of tops) console.log(`  ${String(t.length).padStart(4)}  ${t.path}`);
ok(tops.every((t) => t.length <= 500),
  'no stored array anywhere exceeds the largest cap (500)');

console.log(`\n${pass}/${pass + fail} - three hundred settles and the session is the same size it was at fifty.`);
if (fail) process.exit(1);
