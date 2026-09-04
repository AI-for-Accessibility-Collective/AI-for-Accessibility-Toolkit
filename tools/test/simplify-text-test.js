// Simplify Text: jsdom tests for the output gate in simplify-text.js.
//
// simplifyText() and summarizeContent() replace or prepend what a person
// reads, so a bad model answer is not a cosmetic problem: a refusal sentence
// becomes the paragraph, or a fragment stands in for the whole passage and
// the reader has no way to know what was dropped. Every rejected answer here
// must leave the element exactly as a null answer would: no wrapper, no
// toggle button, original text in place, status "failed".
// Run: node tools/test/simplify-text-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { simplifyText, summarizeContent } from '../adapters/simplify-text.js';

// console.log is stubbed while the adapter runs (below), so failures are
// printed through the real one or they would be swallowed.
const realWarn = console.warn, realLog = console.log;
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; realLog('FAIL:', name); } };

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom.window.document;
}

// 317 characters of dense prose, comfortably over the adapter's 100-char floor.
const DENSE = 'The aforementioned regulations shall be deemed applicable to all parties who have executed the agreement. '.repeat(3).trim();
// 635 characters, over summarizeContent's 500-char floor.
const LONG = DENSE + ' ' + DENSE;
const PLAIN = 'These rules apply to everyone who signed the agreement. '.repeat(3).trim(); // 167 chars, 0.53 of DENSE

// Quiet the adapter's console output for the rejected cases.
const warnings = [];
console.warn = (...a) => { warnings.push(a.join(' ')); };
console.log = () => {};

function untouched(el, original) {
  return el.textContent === original
    && el.dataset.ai4a11ySimplified === 'failed'
    && !el.querySelector('.ai4a11y-text-content')
    && !el.querySelector('.ai4a11y-toggle-original')
    && !el.classList.contains('ai4a11y-simplified');
}

async function simplifyWith(answer) {
  const doc = mount(`<p id="t">${DENSE}</p>`);
  setAIProvider({ simplifyText: async () => answer });
  const el = doc.querySelector('#t');
  const result = await simplifyText(el);
  return { el, result };
}

async function summarizeWith(answer) {
  const doc = mount(`<article id="t"><p>${LONG}</p></article>`);
  setAIProvider({ summarizeText: async () => answer });
  const el = doc.querySelector('#t');
  const result = await summarizeContent(el);
  return { el, result };
}

async function run() {
  // ── simplifyText ────────────────────────────────────────────────────────────
  {
    const { el, result } = await simplifyWith(PLAIN);
    check('simplify: a faithful rewrite is applied', result === PLAIN && el.querySelector('.ai4a11y-text-content')?.textContent === PLAIN);
    check('simplify: the original is kept in a hidden wrapper', el.querySelector('.ai4a11y-original-content')?.textContent === DENSE);
    check('simplify: status is done', el.dataset.ai4a11ySimplified === 'done');
  }
  {
    const { el, result } = await simplifyWith(null);
    check('simplify: a null answer leaves the element alone', result === null && untouched(el, DENSE));
  }
  {
    warnings.length = 0;
    const { el, result } = await simplifyWith('I cannot simplify this text because it is already simple.');
    check('simplify: a refusal is rejected and the element left alone', result === null && untouched(el, DENSE));
    check('simplify: the rejection is logged with its reason', warnings.some(w => w.includes('rejected') && w.includes('refusal')));
  }
  {
    const { el, result } = await simplifyWith('   \n  ');
    check('simplify: a whitespace answer is rejected', result === null && untouched(el, DENSE));
  }
  {
    const { el, result } = await simplifyWith({ text: PLAIN });
    check('simplify: a non-string answer is rejected', result === null && untouched(el, DENSE));
  }
  {
    const { el, result } = await simplifyWith('These rules apply.');
    check('simplify: a fragment far shorter than the input is rejected', result === null && untouched(el, DENSE));
  }
  {
    const { el, result } = await simplifyWith(PLAIN + ' ' + 'Here is some extra explanation that goes on and on. '.repeat(12));
    check('simplify: an answer over twice the input is rejected', result === null && untouched(el, DENSE));
  }
  {
    const { el, result } = await simplifyWith('Unfortunately, the rules apply to everyone who signed the agreement. '.repeat(2).trim());
    check('simplify: a passage that opens "Unfortunately, the ..." is content, not a refusal', result !== null && el.dataset.ai4a11ySimplified === 'done');
  }
  {
    const { el, result } = await simplifyWith('These rules apply to everyone who signed.\nThat means every party.\nThe agreement is what they signed.\nNothing else changes for them.');
    check('simplify: newlines are allowed in a passage', result !== null && el.dataset.ai4a11ySimplified === 'done');
  }

  // ── summarizeContent ────────────────────────────────────────────────────────
  const SUMMARY = 'The rules apply to everyone who signed.';
  {
    const { el, result } = await summarizeWith(SUMMARY);
    check('summarize: a short summary is applied (no minimum ratio for a summary)', result === SUMMARY && el.querySelector('.ai4a11y-summary-content')?.textContent === SUMMARY);
    check('summarize: status is done', el.dataset.ai4a11ySummarize === 'done');
  }
  {
    const { el, result } = await summarizeWith(null);
    check('summarize: a null answer adds no summary box', result === null && !el.querySelector('.ai4a11y-summary-box') && el.dataset.ai4a11ySummarize === 'failed');
  }
  {
    const { el, result } = await summarizeWith("I'm sorry, I cannot summarize this content.");
    check('summarize: a refusal adds no summary box', result === null && !el.querySelector('.ai4a11y-summary-box') && el.dataset.ai4a11ySummarize === 'failed');
  }
  {
    const { el, result } = await summarizeWith('  \n ');
    check('summarize: a whitespace answer adds no summary box', result === null && !el.querySelector('.ai4a11y-summary-box'));
  }
  {
    const { el, result } = await summarizeWith(12345);
    check('summarize: a non-string answer adds no summary box', result === null && !el.querySelector('.ai4a11y-summary-box'));
  }
  {
    const { el, result } = await summarizeWith(LONG + ' ' + LONG);
    check('summarize: a "summary" longer than the text adds no summary box', result === null && !el.querySelector('.ai4a11y-summary-box'));
  }
  // A summary has no ratio floor, so a short non-answer needs its own checks:
  // an absolute floor, the shared refusal prefixes, and the passive form.
  for (const [what, answer] of [
    ['"Sorry."', 'Sorry.'],
    ['"N/A"', 'N/A'],
    ['"Unknown"', 'Unknown'],
    ['"This text cannot be summarized."', 'This text cannot be summarized.'],
    ['a three-character answer', 'Ok.'],
    ['a 19-character answer', 'a'.repeat(19)],
  ]) {
    const { el, result } = await summarizeWith(answer);
    check(`summarize: ${what} adds no summary box`, result === null && !el.querySelector('.ai4a11y-summary-box') && el.dataset.ai4a11ySummarize === 'failed');
  }
  {
    const { el, result } = await summarizeWith('a'.repeat(20));
    check('summarize: a 20-character answer is applied (the floor)', result !== null && !!el.querySelector('.ai4a11y-summary-box'));
  }
}

run().then(() => {
  console.warn = realWarn; console.log = realLog;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.warn = realWarn; console.log = realLog; console.error('ERROR', e); process.exit(1); });
