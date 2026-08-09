// The shipped validation pipeline, tested against the recorded July run: the
// agent's own step stream and the recorded results-page facts. These are the
// eight assertions that once lived in a (retired) parallel prototype - now
// they exercise the layer the extension actually ships:
// tools/validators reader + count-first, through the extension's re-exports.
//
// Run: node test/verifier-test.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import { parseAria } from '../../tools/validators/aria-parse.js';
import { CountFirst } from '../../tools/validators/count-first.js';
import { read, searchEcho, searchDepartment, quantityPreset, variantPrices,
         couponLine, adBlocks, resultSet } from '../../tools/validators/reader.js';
import { checkPage } from '../../tools/auditors/contract-mismatch.js';
import { createRun } from '../extension/validation/run.js';

const OBS = join(homedir(),
  'Stanford/Summer Project Ideation /Verification Affordances/assets/task-mapping/_obs');

const steps = readFileSync(join(OBS, 'agent-observed-steps.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const obs = JSON.parse(readFileSync(join(OBS, 'sandals-observation.json'), 'utf8'));
const facts = obs.steps[0].facts;
const heading = `- heading "${facts.result_count_text}" [level=1]`;

// the observation a checker would assemble from the parsed page
const parsed = parseAria(heading);
const m = /([\d,]{2,})\s+results?/.exec(`${parsed[0].role} ${parsed[0].name}`);
const observed = { count: parseInt(m[1].replace(/,/g, ''), 10),
                   sponsoredInFirstTen: facts.first10_sponsored };
const finding = { signal: 'Search|How many results?', observed };

let n = 0;
const check = (name, fn) => { n += 1; fn(); console.log(`PASS ${name}`); };

check('the recorded step stream is the real one', () => {
  assert.ok(steps[0].actions.some((a) => JSON.stringify(a).includes('girls flat sandals')));
});
check('the snapshot parses as the tree the validators read', () => {
  assert.strictEqual(parsed[0].role, 'heading');
});
check('the count comes from the page heading, not the report', () => {
  assert.strictEqual(observed.count, 944);
});
check('the sponsored share is the recorded one', () => {
  assert.strictEqual(observed.sponsoredInFirstTen, 6);
});
check('CountFirst recognizes this signal', () => {
  assert.ok(CountFirst.triggers(finding));
});
check('the say carries the count and the ads share', () => {
  const say = CountFirst.say(finding);
  assert.ok(say.includes('944') && say.includes('6 of the first 10'));
});
check('the choices include keeping and query readback', () => {
  const labels = CountFirst.choices(finding).map((c) => c.label);
  assert.ok(labels.some((l) => l.includes('keep going')));
  assert.ok(labels.some((l) => l.includes('query exactly as typed')));
});
check('CountFirst names the breakdown it exists for', () => {
  assert.ok(CountFirst.breakdown.includes('never says the result count'));
});

// ── the eight accepted questions, against the same recordings ────────────────

const history = readFileSync(join(OBS, 'agent-observed-history.json'), 'utf8');
const step1txt = readFileSync(join(OBS, 'sandals-step1.txt'), 'utf8');
const step2txt = readFileSync(join(OBS, 'sandals-step2.txt'), 'utf8');
const wagon = parseAria(readFileSync(join(OBS, 'cart-smart-wagon-aria.txt'), 'utf8'));
const confirmTxt = readFileSync(join(OBS, 'agent-purchase-aria', 'confirmation-page.txt'), 'utf8');

// Did it search what you said? The heading's count text is recorded in
// sandals-observation.json and the echoed query in agent-observed-history.json,
// where the raw capture reads `results for\n\t\"girls flat sandals back strap\"`.
check('the recorded run really echoed the query in its heading', () => {
  assert.ok(history.includes('results for\\n\\t\\"girls flat sandals back strap\\"'));
});
check('searchEcho reads the echoed words off that heading', () => {
  const h = parseAria(
    `- heading "${facts.result_count_text} \\"girls flat sandals back strap\\"" [level=1]`);
  assert.strictEqual(searchEcho(h).value, 'girls flat sandals back strap');
});
check('an ask-word missing from the echo becomes the finding', () => {
  const F = read('- heading "1-48 of 944 results for girls flat sandals" [level=1]',
                 ['searchEcho']);
  const w = checkPage(F, 'Search', { item: 'girls flat sandals', mustHaves: ['back strap'] })
    .find((x) => x.widget === 'What it searched');
  assert.ok(w && /also said back and strap/.test(w.say));
});
check('the mobile capture carries no echo - null, with the reason', () => {
  const r = searchEcho(parseAria(step1txt));
  assert.strictEqual(r.value, null);
  assert.ok(r.absent && /results-for heading/.test(r.from));
});

// Which department is it searching? Read off the recorded cart capture's own
// search bar, where "All Departments" sits selected.
check('the department scope is read from the page: All Departments', () => {
  assert.strictEqual(searchDepartment(wagon).value, 'All Departments');
});

// Can you scan them all? The recorded results page holds more tiles than one
// readback, and the finding says the number.
check('the result set is bigger than one readback holds', () => {
  const S = resultSet(parseAria(step1txt)).value;
  assert.ok(S.count >= 8);
  const w = checkPage(read(step1txt, ['resultSet']), 'Search', {})
    .find((x) => x.widget === 'Scan them all');
  assert.ok(w && w.say.includes(`${S.count} tiles here`));
});

// Does colour change the price? On the recorded product page every colour
// radio prices itself - six options, one price - and that is said as
// checked-and-fine rather than left as silence.
check('each colour radio prices itself: six options, one price', () => {
  const v = variantPrices(parseAria(step2txt));
  assert.strictEqual(v.value.length, 6);
  assert.deepStrictEqual(v.distinct, [14.99]);
});
check('same-price colours are said as checked-and-fine, not silence', () => {
  const w = checkPage(read(step2txt, ['variantPrices']), 'Check item', {})
    .find((x) => x.widget === 'Colour price spread');
  assert.ok(w && w.confirming && w.say.includes('$14.99'));
});

// Any coupon to tick? No recorded page carries a coupon offer - the nav's bare
// "Coupons" link must not count as one, so the null path is the tested path.
check('the nav Coupons link is not a coupon offer - null, with the reason', () => {
  const r = couponLine(wagon);
  assert.ok(r.absent && /no coupon offer/.test(r.from));
});

// How many is it set to buy? The recorded cart says so in its own words.
check('the cart says how many it is set to buy: Quantity is 1', () => {
  const q = quantityPreset(parseAria(readFileSync(join(OBS, 'sandals-step4.txt'), 'utf8')));
  assert.strictEqual(q.value, 1);
});

// What here is not yours? The recorded confirmation page mixes the receipt
// with Sponsored carousels and offer prices, and states no order total.
check('the confirmation page mixes the receipt with adverts', () => {
  const a = adBlocks(parseAria(confirmTxt)).value;
  assert.ok(a.sponsored >= 2 && a.offerPrices >= 20);
});
check('the finding separates the order from the offers, honestly', () => {
  const w = checkPage(read(confirmTxt, ['adBlocks', 'orderTotal']), 'Confirm', {})
    .find((x) => x.widget === 'Not your order');
  assert.ok(w && /mixes your order with adverts/.test(w.say));
  // no order total on this page, so the say must not claim one
  assert.ok(/offers, not your order/.test(w.say));
});

// Does size change the price? The run's own recorded event - $12.93 at first
// look, $15.10 once size 5 Big Kid was picked - replayed through the run's
// memory, which is the only place both numbers exist at once.
check('the run remembers the first price and stops when it moves', () => {
  assert.ok(history.includes('$12.93') && history.includes('$15.10'));
  const run = createRun({ item: 'girls sandals', size: '5 Big Kid' });
  run.observe('- text: $12.93', 'Check item');
  const { findings } = run.observe(
    '- heading "Added to cart" [level=1]\n- text: $15.10', 'Add to cart');
  const moved = findings.find((r) => r.finding.widget === 'The Price Moved');
  assert.ok(moved && moved.level === 'stop');
  assert.ok(/\$12\.93/.test(moved.finding.say) && /\$15\.10/.test(moved.finding.say));
  assert.strictEqual(run.gate().allowed, false);
});

console.log(`\n${n}/${n} - the recorded run drives the shipped pipeline.`);
