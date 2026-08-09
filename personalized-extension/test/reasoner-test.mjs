// The reasoner, against a recorded page and the real task model.
//
// No network. The model call is stubbed, so what is exercised here is the part
// that decides whether a claim reaches a person: flattening the task model,
// the page-size guard, parsing a response that may be cut off, verifying every
// quote by containment, and turning what survived into findings the rest of
// the layer already knows how to render.
//
// The assertion that matters most is the fabricated quote. An answer whose
// words are not on the page is thrown away and counted, and no wording,
// confidence or plausibility gets it through.
//
// Run: node test/reasoner-test.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';
import * as R from '../extension/validation/reasoner.js';
import { createRun } from '../extension/validation/run.js';

const RESEARCH = join(homedir(), 'Stanford/Summer Project Ideation /Verification Affordances');
const PAGE = readFileSync(join(RESEARCH, 'assets/task-mapping/_obs/sandals-step2.txt'), 'utf8');
const GOLD = JSON.parse(readFileSync(join(RESEARCH, 'taskmodel/gold-v2/amazon-gold.json'), 'utf8'));

let n = 0;
const check = async (name, fn) => { n += 1; await fn(); console.log(`PASS ${name}`); };

// ── the task model ──────────────────────────────────────────────────────────

const flat = R.flattenModel(GOLD);

await check('the real gold flattens to every question on every node', () => {
  assert.strictEqual(flat.questions.length, 64);
  assert.strictEqual(flat.nodeIds.length, 75);
  assert.strictEqual(flat.phases.length, 10);
  assert.ok(flat.task.startsWith('buy a physical product on Amazon'));
});

await check('every question id is unique, so none is silently dropped', () => {
  const ids = flat.questions.map((q) => q.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

// The Amazon gold happens to carry one question per node. Flights does not —
// its busiest node holds nine — and keying answers by bare node id, which the
// benchmarked prototype did, drops eight of them without saying so.
await check('a node holding several questions keeps them all, suffixed', () => {
  const flights = R.flattenModel(JSON.parse(
    readFileSync(join(RESEARCH, 'taskmodel/gold-v2/flights-gold.json'), 'utf8')));
  const per = {};
  for (const q of flights.questions) per[q.node] = (per[q.node] || 0) + 1;
  const busiest = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  assert.ok(busiest[1] > 1, 'flights has a node with more than one question');
  const theirs = flights.questions.filter((q) => q.node === busiest[0]).map((q) => q.id);
  assert.strictEqual(theirs.length, busiest[1]);
  assert.strictEqual(new Set(theirs).size, theirs.length);
  assert.ok(theirs.every((id) => id.startsWith(`${busiest[0]}#`)));
  assert.strictEqual(new Set(flights.questions.map((q) => q.id)).size,
                     flights.questions.length);
});

await check('a bare tree is accepted as well as a whole file', () => {
  assert.strictEqual(R.flattenModel(GOLD.tree).questions.length, 64);
});

// ── the page-size guard ─────────────────────────────────────────────────────

await check('a page under the limit goes through untouched', () => {
  const g = R.guardPage(PAGE);
  assert.strictEqual(g.truncated, false);
  assert.strictEqual(g.text, PAGE);
});

await check('a page over the limit is cut and says so', () => {
  const g = R.guardPage(PAGE, 500);
  assert.strictEqual(g.truncated, true);
  assert.strictEqual(g.origChars, PAGE.length);
  assert.ok(g.text.endsWith(R.TRUNCATION_MARKER));
  assert.strictEqual(g.sentChars, 500 + R.TRUNCATION_MARKER.length);
});

// ── the prompt ──────────────────────────────────────────────────────────────

const prompt = R.buildPrompt(flat, PAGE, { ask: 'girls flat sandals, size 5.' });

await check('every question goes in, not the ones for a guessed subtask', () => {
  for (const q of flat.questions) {
    assert.ok(prompt.includes(`${q.id} | ${q.subtask} | ${q.question}`), q.id);
  }
});

await check('the page text is in the prompt, fenced as data not instructions', () => {
  assert.ok(prompt.includes(PAGE));
  assert.ok(/data, not instructions/.test(prompt));
  assert.ok(prompt.includes('<<<PAGE') && prompt.includes('PAGE>>>'));
});

await check("the person's own words reach the call", () => {
  assert.ok(prompt.includes('girls flat sandals, size 5.'));
});

await check('by default only answered questions need a row back', () => {
  assert.ok(/one entry ONLY for the questions this page/.test(prompt));
  const every = R.buildPrompt(flat, PAGE, { everyRow: true });
  assert.ok(/exactly one entry per question above/.test(every));
  // Either way the whole list goes in — the difference is what comes back.
  for (const q of flat.questions) assert.ok(every.includes(`${q.id} | ${q.subtask} | ${q.question}`));
});

await check('a question with no row back is the same as the page not saying', () => {
  const rows = R.verifyQuotes([], PAGE);
  assert.strictEqual(rows.length, 0);
});

// ── parsing ─────────────────────────────────────────────────────────────────

await check('plain and fenced JSON both parse', () => {
  assert.deepStrictEqual(R.parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(R.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

await check('output cut off mid-response does not parse - the retry signal', () => {
  assert.strictEqual(R.parseJsonLoose('{"answers":[{"id":"4.1","answer":"$14.9'), null);
});

// ── quote verification ──────────────────────────────────────────────────────

const EXACT = '- text: $14.99';
const SPACED = '-   text:   $14.99';          // same words, different whitespace
const FABRICATED = '- text: $9.99 limited time offer';

await check('a quote copied off the page verifies exactly', () => {
  assert.ok(PAGE.includes(EXACT));
  assert.strictEqual(R.verifyQuote(EXACT, PAGE), 'verified_exact');
});

await check('the same words with different spacing verify after collapse', () => {
  assert.ok(!PAGE.includes(SPACED));
  assert.strictEqual(R.verifyQuote(SPACED, PAGE), 'verified_normalized');
});

await check('a fabricated quote is rejected', () => {
  assert.strictEqual(R.verifyQuote(FABRICATED, PAGE), 'hallucinated_quote');
});

await check('an answer with no quote at all is rejected too', () => {
  assert.strictEqual(R.verifyQuote('', PAGE), 'missing_quote');
  assert.strictEqual(R.verifyQuote(null, PAGE), 'missing_quote');
});

await check('an honest absence is null, not a sentence saying it is absent', () => {
  const [a, b] = R.verifyQuotes(
    [{ answer: null, quote: null }, { answer: 'the page does not say', quote: null }], PAGE);
  assert.strictEqual(a.verify, 'null');
  assert.strictEqual(b.verify, 'null');
  assert.strictEqual(b.answer, null);
  assert.strictEqual(a.verifyLevel, null);
});

// ── the normalization levels ────────────────────────────────────────────────
//
// Plain containment threw away eight correct answers across the 90 benchmark
// calls, every one of them a punctuation or invisible-character mismatch
// between what the accessibility dump wrote and what the model could copy.
// Each level below is one of those failures, taken off the page it happened on.
// The level a quote matches at is recorded, so a quote that needed cleaning
// never passes for one that was copied exactly.

const SEARCH = readFileSync(join(RESEARCH, 'assets/task-mapping/_obs/sandals-step1.txt'), 'utf8');
const GMAIL = readFileSync(join(RESEARCH, 'assets/task-mapping/_obs/email-confirm-gmail-aria.txt'), 'utf8');
const ORDER = 'Arriving tomorrow David - MENLO PARK, CA Order # ';

await check('exact still means exact, and says so', () => {
  assert.deepStrictEqual(R.verifyQuoteAt(EXACT, PAGE),
                         { verify: 'verified_exact', level: 'exact' });
});

await check('whitespace: the same words spaced differently', () => {
  assert.deepStrictEqual(R.verifyQuoteAt(SPACED, PAGE),
                         { verify: 'verified_normalized', level: 'whitespace' });
});

await check('unicode: an invisible character the model cannot copy', () => {
  // The Gmail confirmation carries U+202B inside the order number. A model
  // reading the page has nothing to copy there.
  assert.ok(GMAIL.includes(`${ORDER}‫113-2116825-7916228`));
  assert.deepStrictEqual(R.verifyQuoteAt(`${ORDER}113-2116825-7916228`, GMAIL),
                         { verify: 'verified_normalized', level: 'unicode' });
});

await check('unescape: the dump writes an inner quote as backslash-quote', () => {
  const dumped = '- link "Sponsored ad from DREAM PAIRS. \\"Dress sandals for girls.\\" Shop DREAM PAIRS.":';
  const copied = 'Sponsored ad from DREAM PAIRS. "Dress sandals for girls." Shop DREAM PAIRS.';
  assert.ok(SEARCH.includes(dumped));
  assert.ok(!SEARCH.includes(copied));
  assert.deepStrictEqual(R.verifyQuoteAt(copied, SEARCH),
                         { verify: 'verified_normalized', level: 'unescape' });
});

await check('quotes: the dump wraps the label, the model copies the label', () => {
  assert.ok(PAGE.includes('- \'link "Brand: WUROSO"\':'));
  assert.deepStrictEqual(R.verifyQuoteAt('link "Brand: WUROSO":', PAGE),
                         { verify: 'verified_normalized', level: 'quotes' });
});

await check('ellipsis: a placeholder for a character that would not render', () => {
  // This one call lost six correct answers about the same order number.
  assert.deepStrictEqual(R.verifyQuoteAt(`${ORDER}…113-2116825-7916228`, GMAIL),
                         { verify: 'verified_normalized', level: 'ellipsis' });
  assert.deepStrictEqual(R.verifyQuoteAt(`${ORDER}...113-2116825-7916228`, GMAIL),
                         { verify: 'verified_normalized', level: 'ellipsis' });
});

await check('a fabricated quote is still rejected after every level', () => {
  // One digit of the order number changed, wearing the ellipsis that rescues
  // the real one.
  assert.strictEqual(R.verifyQuote(`${ORDER}…113-2116825-7916229`, GMAIL),
                     'hallucinated_quote');
  // A made-up brand, wearing the quoting that rescues the real label.
  assert.strictEqual(R.verifyQuote('link "Brand: NOTWUROSO":', PAGE),
                     'hallucinated_quote');
  // Same digits, different currency. Nothing deletes a currency symbol.
  assert.strictEqual(R.verifyQuote('- text: €14.99', PAGE), 'hallucinated_quote');
  // An extra clause bolted onto real page text.
  assert.strictEqual(R.verifyQuote(`${EXACT} limited time offer`, PAGE),
                     'hallucinated_quote');
});

await check('an ellipsis is deleted, never expanded — it cannot bridge a gap', () => {
  // Both ends are real page text. The words between them are not being
  // claimed, they are being skipped, and skipping is what a fuzzy match would
  // allow and containment must not.
  assert.ok(GMAIL.includes('Arriving tomorrow David'));
  assert.ok(GMAIL.includes('7916228'));
  assert.strictEqual(R.verifyQuote('Arriving tomorrow David …7916228', GMAIL),
                     'hallucinated_quote');
  assert.strictEqual(R.verifyQuote('Arriving tomorrow David ...7916228', GMAIL),
                     'hallucinated_quote');
});

await check('the level is recorded on the row, next to the verdict', () => {
  const rows = R.verifyQuotes([
    { answer: '$14.99', quote: EXACT },
    { answer: 'WUROSO', quote: 'link "Brand: WUROSO":' },
    { answer: '$9.99', quote: FABRICATED },
  ], PAGE);
  assert.deepStrictEqual(rows.map((r) => r.verifyLevel), ['exact', 'quotes', null]);
  assert.deepStrictEqual(rows.map((r) => R.isVerified(r.verify)), [true, true, false]);
});

await check('a noticed item carries its level too', () => {
  const [n1] = R.verifyNoticed([{ what: 'brand', quote: 'link "Brand: WUROSO":' }], PAGE);
  assert.strictEqual(n1.verify, 'verified_normalized');
  assert.strictEqual(n1.verifyLevel, 'quotes');
});

// ── one whole read, with the call stubbed ───────────────────────────────────

const Q = flat.questions;
const qPrice = Q.find((q) => /price/i.test(q.question)) || Q[0];
const qOther = Q.find((q) => q.id !== qPrice.id);
const NOTICED_QUOTE = '- button "FREE Returns"';

function response({ price = EXACT, other = FABRICATED, noticed = NOTICED_QUOTE } = {}) {
  return JSON.stringify({
    alignedPhase: 'Inspect the item',
    alignedNodes: ['4', qPrice.node, 'not-a-node'],
    answers: [
      { id: qPrice.id, answer: '$14.99', quote: price, confidence: 0.9 },
      { id: qOther.id, answer: 'it is $9.99 with a limited-time offer',
        quote: other, confidence: 0.9 },
    ],
    noticed: [{ what: 'Returns are free on this item', quote: noticed,
                whyItMatters: 'it decides how reversible buying it is' }],
  });
}

/** Replace the model caller with a canned sequence. Returns the call log. */
function stub(sequence) {
  const seq = sequence.slice();
  const calls = [];
  R.setGeminiCaller(async (p, opts) => {
    calls.push({ prompt: p, opts });
    const next = seq.length > 1 ? seq.shift() : seq[0];
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}

const calls = stub([response()]);
const result = await R.readPage(flat, PAGE);

await check('the call asks for structured output with a declared cap', () => {
  assert.strictEqual(calls[0].opts.mimeType, 'application/json');
  assert.strictEqual(calls[0].opts.responseSchema, R.SCHEMA);
  assert.strictEqual(calls[0].opts.maxOutputTokens, R.MAX_OUTPUT_TOKENS);
});

await check('every question comes back with a row, answered or null', () => {
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.answers.length, flat.questions.length);
  assert.strictEqual(result.meta.asked, flat.questions.length);
});

await check('the verified answer is kept and the fabricated one is discarded', () => {
  const good = result.answers.find((a) => a.id === qPrice.id);
  const bad = result.answers.find((a) => a.id === qOther.id);
  assert.strictEqual(good.verify, 'verified_exact');
  assert.strictEqual(bad.verify, 'hallucinated_quote');
  assert.strictEqual(result.meta.answered, 1);
  assert.strictEqual(result.meta.discarded, 1);
});

await check('alignment is reported, and only for nodes the model actually has', () => {
  assert.ok(result.alignedNodes.includes('4'));
  assert.ok(!result.alignedNodes.includes('not-a-node'));
  assert.ok(result.alignedNodes.every((id) => flat.nodeIds.includes(id)));
});

await check('the noticing pass is verified like everything else', () => {
  assert.strictEqual(result.noticed[0].verify, 'verified_exact');
  assert.strictEqual(result.meta.noticedKept, 1);
});

await check('a noticed item with a fabricated quote is thrown away too', async () => {
  stub([response({ noticed: 'Free returns for life on all orders' })]);
  const r = await R.readPage(flat, PAGE);
  assert.strictEqual(r.noticed[0].verify, 'hallucinated_quote');
  assert.strictEqual(r.meta.noticedKept, 0);
  assert.strictEqual(r.meta.noticedDiscarded, 1);
  assert.strictEqual(R.toFindings(r, 'Inspect the item')
    .filter((f) => f.source === 'noticed').length, 0);
});

// ── findings ────────────────────────────────────────────────────────────────

const phase = R.phaseFor(result, flat);
const findings = R.toFindings(result, phase);

await check('the phase comes from the model, not from a URL regex', () => {
  assert.ok(flat.phases.includes(phase));
  assert.strictEqual(phase, 'Inspect the item');
});

await check('the fabricated answer never becomes a finding', () => {
  assert.ok(!findings.some((f) => /9\.99/.test(f.say)));
  assert.ok(!findings.some((f) => f.widget === qOther.question));
});

await check('the verified answer becomes a finding in the checks own shape', () => {
  const f = findings.find((x) => x.widget === qPrice.question);
  assert.ok(f, 'the verified answer is a finding');
  assert.strictEqual(f.phase, phase);
  assert.ok(f.say.includes('$14.99'));
  assert.strictEqual(f.from, EXACT);        // the quote is the provenance line
  assert.strictEqual(f.contradicts, false);
  assert.strictEqual(f.confirming, false);
  assert.strictEqual(f.paradigm, null);
  assert.strictEqual(f.answerable, true);
  assert.strictEqual(f.node, qPrice.node);
});

await check('a control is offered only for an interface type that has one', () => {
  for (const f of findings) {
    if (!f.control) continue;
    assert.ok(f.control.label && f.control.action && f.control.decline);
  }
});

await check('the noticing pass reaches the person as a finding with its quote', () => {
  const f = findings.find((x) => x.source === 'noticed');
  assert.ok(f && f.from === NOTICED_QUOTE);
});

await check('what the page is serving is ordered first', () => {
  const firstUnaligned = findings.findIndex((f) => !f.aligned);
  const lastAligned = findings.map((f) => f.aligned).lastIndexOf(true);
  if (firstUnaligned >= 0 && lastAligned >= 0) assert.ok(lastAligned < firstUnaligned);
});

// ── into the run the rest of the layer already uses ─────────────────────────

const synthetic = (over) => ({
  widget: 'Q', phase: 'Inspect the item', say: 'What does it cost? It is $14.99.',
  from: EXACT, answerable: true, contradicts: false, confirming: false,
  control: null, quiet: false, moment: 'Now', ...over,
});

await check('findings go through the run, get a level, and are spoken', () => {
  const r = createRun({ item: 'girls sandals' });
  const { findings: rendered } = r.observeFindings(
    [synthetic()], 'Inspect the item', { read: 1, of: 1 });
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(rendered[0].level, 'aside');
  assert.ok(rendered[0].spoken.speak.includes('$14.99'));
  assert.ok(rendered[0].visual.text);
  assert.strictEqual(r.summary().steps[0].what, 'Inspect the item');
});

await check('a question the model wants on demand is never announced', () => {
  const r = createRun({ item: 'girls sandals' });
  const { findings: rendered } = r.observeFindings(
    [synthetic({ widget: 'Q2', phase: 'After the order', quiet: true, moment: 'On demand' })],
    'After the order', { read: 1, of: 1 });
  assert.strictEqual(rendered[0].level, 'ambient');
  assert.strictEqual(rendered[0].spoken.speak, null);
  assert.strictEqual(r.gate().allowed, true);
});

await check('the plan reports discarded answers as things it could not read', () => {
  const r = createRun({ item: 'girls sandals' });
  const read = result.meta.answered + result.meta.noticedKept;
  r.observeFindings(findings, phase, { read, of: read + result.meta.discarded });
  const step = r.summary().steps.find((s) => s.what === phase);
  assert.ok(/1 thing here I couldn't read/.test(step.detail), step.detail);
});

// ── failures are failures, never a page that checked out clean ──────────────

await check('unparseable output is retried, and a later good response wins', async () => {
  const c = stub(['{"answers":[{"id":"1.1","answer":"cut off mid-', response()]);
  const r = await R.readPage(flat, PAGE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.meta.attempts, 2);
  assert.strictEqual(c.length, 2);
});

await check('output that never parses gives up and says so', async () => {
  stub(['{"answers":[{"id":"1.1","answer":"cut off mid-']);
  const r = await R.readPage(flat, PAGE);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.meta.attempts, R.MAX_ATTEMPTS);
  assert.ok(/unparseable/.test(r.meta.error));
  assert.strictEqual(r.answers.length, 0);
});

await check('a thrown call is reported, not swallowed into an empty page', async () => {
  stub([new Error('Gemini API error 429: rate limited')]);
  const r = await R.readPage(flat, PAGE);
  assert.strictEqual(r.ok, false);
  assert.ok(/429/.test(r.meta.error));
});

await check('no caller wired up is an honest failure, not silence', async () => {
  R.setGeminiCaller(null);
  const r = await R.readPage(flat, PAGE);
  assert.strictEqual(r.ok, false);
  assert.ok(/no model caller/.test(r.meta.error));
});

await check('quotes are checked against the text the model saw, not the file', async () => {
  // The price line sits well past the first 200 characters, so under a
  // 200-character guard the model cannot have seen it and the quote must fail.
  stub([response()]);
  const r = await R.readPage(flat, PAGE, { maxPageChars: 200 });
  assert.strictEqual(r.meta.guard.truncated, true);
  assert.strictEqual(r.answers.find((x) => x.id === qPrice.id).verify,
                     'hallucinated_quote');
});

console.log(`\n${n}/${n} - a fabricated quote never reaches a person.`);
