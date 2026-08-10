// The shipped validation pipeline, tested against a recorded run: the
// agent's own step stream and the recorded results-page facts. These are the
// eight assertions that once lived in a (retired) parallel prototype - now
// they exercise the layer the extension actually ships:
// tools/validators reader + count-first, through the extension's re-exports.
//
// The recording lives in test/fixtures/ (a "girls flat sandals" search run,
// reconstructed to the same shape as the original capture) so the test is
// self-contained and runnable outside the developer's machine.
//
// Run: node test/verifier-test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { parseAria } from '../../tools/validators/aria-parse.js';
import { CountFirst } from '../../tools/validators/count-first.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

const steps = readFileSync(fixture('agent-observed-steps.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const obs = JSON.parse(readFileSync(fixture('sandals-observation.json'), 'utf8'));
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

console.log(`\n${n}/${n} - the recorded run drives the shipped pipeline.`);
