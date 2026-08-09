/**
 * What a widget press tells the agent.
 *
 * Pressing a control becomes an English sentence looked up in a ~27-entry map
 * in background.js, keyed by action id. That map serves the Amazon corpus path
 * and the generated path alike, and it is shopping vocabulary throughout:
 * "Describe the product photos", "Undo it. If it was an order, cancel it." On a
 * passport form there are no product photos and there was no order; on a flight
 * booking neither names anything on the page.
 *
 * The instruction should come from the task model's own question, because the
 * question knows what the thing is. The map stays as the fallback, and that
 * matters as much as the change: on the corpus path there is no task model and
 * therefore no question to build from, and the shipped demo must behave exactly
 * as it did.
 *
 * What this covers:
 *   - the sentence carries the question and the node it belongs to
 *   - the two interface types that must never become a sentence at all
 *   - no task model loaded means no sentence, so the corpus path is untouched
 *   - a press with nothing behind it falls back rather than inventing
 *
 * Run: node test/control-instruction-test.mjs
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass += 1; console.log(`PASS ${what}`); }
  else { fail += 1; console.log(`FAIL ${what}`); }
};

const RESEARCH = join(homedir(), 'Stanford/Summer Project Ideation /Verification Affordances');
const GOLD = JSON.parse(readFileSync(join(RESEARCH, 'taskmodel/gold-v2/flights-gold.json'), 'utf8'));

const local = new Map();
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
  storage: { local: area(local), sync: area(new Map()), session: area(new Map()) },
  runtime: { async sendMessage() {} },
  tabs: { async query() { return [{ id: 3 }]; } },
};
globalThis.BrowserHarness = { async axSnapshot() { return { text: '', url: 'https://x/' }; } };

const R = await import('../extension/validation/reasoner.js');
const { default: Validation } = await import('../extension/validation/session.js');

// ── the sentence carries the question ───────────────────────────────────────
{
  const s = R.instructionFrom({
    cluster: 'facts',
    question: 'Which documents count as proof of citizenship?',
    label: 'Prove your citizenship',
  });
  ok(/Which documents count as proof of citizenship\?/.test(s),
    'the instruction carries the question that produced the finding');
  ok(/Prove your citizenship/.test(s),
    'and where in the task it sits, so the agent knows which part is meant');
  ok(!/product|listing|order|cart/i.test(s),
    'and nothing about products, listings, orders or carts');

  const photos = R.instructionFrom({ cluster: 'photos', question: 'What do the scans show?' });
  ok(/images/.test(photos) && !/product photos/.test(photos),
    '"Describe the product photos" becomes "Describe the images here"');

  const undo = R.instructionFrom({ cluster: 'undo', question: 'Can this submission be withdrawn?' });
  ok(!/order/i.test(undo) && /cancel or reverse path/.test(undo),
    '"If it was an order, cancel it" becomes the site\'s own cancel path, whatever it is');

  const each = ['facts', 'refine', 'compare', 'select', 'approve', 'photos', 'receipts', 'undo'];
  ok(each.every((c) => typeof R.instructionFrom({ cluster: c, question: 'Q?' }) === 'string'),
    'every type that IS an instruction has one');
  ok(each.every((c) => /Q\?/.test(R.instructionFrom({ cluster: c, question: 'Q?' }))),
    'and every one of them carries the question rather than describing a page');
}

// ── the two types that must never become a sentence ─────────────────────────
{
  ok(R.instructionFrom({ cluster: 'hand over', question: 'Any form errors?' }) === null,
    'hand over builds no sentence - it holds the agent and starts the layer watching');
  ok(R.instructionFrom({ cluster: 'watch', question: 'Watch it instead of booking?' }) === null,
    'and watch builds none either - it registers a watched value');
  ok(R.instructionFrom({ cluster: 'facts' }) === null,
    'a type with no question has nothing better to offer than the fallback');
  ok(R.instructionFrom({ cluster: 'something new', question: 'Q?' }) === null,
    'and a type this does not know says so rather than inventing a sentence');
}

// ── the corpus path is left exactly as it was ───────────────────────────────
{
  globalThis.ValidationTaskModel.unload();
  const r = await Validation.instructionFor({
    action: 'facts-source', node: '2.4', widget: 'Which size went in?' });
  ok(r === null,
    'with no task model loaded there is no question to build from, so the global '
    + 'map answers and the shipped Amazon demo is unchanged');
}

// ── with a model, the finding decides ───────────────────────────────────────
{
  globalThis.ValidationTaskModel.load(GOLD, 'test');
  await chrome.storage.local.set({ 'aa.validation': { findings: [{
    widget: 'What does the fare rule say about changes?',
    node: '5.5', cluster: 'facts', phase: 'Check out and pay',
    control: { action: 'facts-source', node: '5.5' },
  }] } });

  const s = await Validation.instructionFor({ action: 'facts-source', node: '5.5' });
  ok(typeof s === 'string' && /fare rule/.test(s),
    'the press is looked up against the finding it was pressed on');
  ok(/Read the fare rules/.test(s),
    'and named with the task model\'s own label for that node');

  const carried = await Validation.instructionFor({
    action: 'select-options', node: '5.6.1', cluster: 'select',
    widget: 'Which payment method?' });
  ok(/Which payment method\?/.test(carried) && /Pick the payment method/.test(carried),
    'a control that carries its own question and node needs no lookup at all');

  const unknown = await Validation.instructionFor({ action: 'coupon-tick', node: null });
  ok(unknown === null,
    'a press with no finding and no type behind it falls back rather than guessing');
  globalThis.ValidationTaskModel.unload();
}

// ── the finding a press comes from carries what the press needs ─────────────
{
  const findings = R.toFindings({
    alignedNodes: ['5.5'], noticed: [],
    answers: [{ node: '5.5', question: 'What does the fare rule say about changes?',
                answer: 'Changes cost $75.', quote: '- text: $75',
                verify: 'verified_exact', cluster: 'facts', moment: 'Now',
                confidence: 0.9 }],
  }, 'Check out and pay');
  ok(findings[0].control.widget === 'What does the fare rule say about changes?',
    'the question travels ON the control, because the overlay hands the control '
    + 'object back and nothing else');
}

console.log(`\n${pass}/${pass + fail} - a press says what the task model asked, and the corpus path still says what it always said.`);
if (fail) process.exit(1);
