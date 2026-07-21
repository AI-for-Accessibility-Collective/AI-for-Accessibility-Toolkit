// Bionic Reading — realistic jsdom tests for the word-prefix-bolding reading
// aid. Asserts the user-facing outcome (fixation-point <b> prefixes, correct
// split ratio, code/scripts untouched, visible text unchanged) AND the
// reversibility contract every adapter must honor: enable() is idempotent,
// and disable() puts the exact original text nodes back.
//
// Run: node tools/test/bionic-reading-test.js
import { JSDOM } from 'jsdom';
import { BionicReading } from '../adapters/bionic-reading.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

async function run() {
  // A realistic page: prose in <main> alongside code and an inline script,
  // neither of which may be reflowed.
  {
    const doc = mount(`
      <main>
        <p id="para">Bionic Reading helps dyslexic readers focus</p>
        <pre><code id="code">const answer = 42;</code></pre>
        <script id="js">var tracked = "no";</script>
      </main>`);
    const para = doc.querySelector('#para');
    const originalText = para.textContent;
    const originalNode = para.firstChild; // the one text node — must come back

    BionicReading.enable();
    check('bionic: wraps prose in marker spans containing <b> prefixes',
      doc.querySelectorAll('#para span.ai4a11y-bionic').length === 1 &&
      doc.querySelector('#para span.ai4a11y-bionic b') !== null);

    // "Reading" (7 chars, ratio 0.4) splits as ceil(7 * 0.4) = 3 → "Rea" + "ding".
    const rea = [...para.querySelectorAll('b')].find((b) => b.textContent === 'Rea');
    check('bionic: bolds the first 40% of "Reading" ("Rea")', rea !== undefined);
    check('bionic: the rest of the word ("ding") stays as plain text',
      rea?.nextSibling?.nodeType === 3 && rea?.nextSibling?.nodeValue === 'ding');

    check('bionic: text inside <code> is untouched',
      doc.querySelector('#code').textContent === 'const answer = 42;' &&
      doc.querySelector('#code .ai4a11y-bionic') === null);
    check('bionic: text inside <script> is untouched',
      doc.querySelector('#js').textContent === 'var tracked = "no";' &&
      doc.querySelector('#js .ai4a11y-bionic') === null);
    check('bionic: the visible text content is unchanged', para.textContent === originalText);

    // disable() restores the page exactly — the very same text node, not a copy.
    BionicReading.disable();
    check('bionic: disable leaves no marker spans anywhere',
      doc.querySelectorAll('.ai4a11y-bionic').length === 0);
    check('bionic: disable puts the exact original text node back',
      para.firstChild === originalNode && para.childNodes.length === 1 &&
      para.textContent === originalText);
  }

  // Idempotency and double-disable safety.
  {
    const doc = mount(`<main><p>Several plain words here</p></main>`);
    BionicReading.enable();
    const spanCount = doc.querySelectorAll('.ai4a11y-bionic').length;
    BionicReading.enable(); // must be a no-op
    check('bionic: second enable is a no-op (no double-wrapping)',
      doc.querySelectorAll('.ai4a11y-bionic').length === spanCount &&
      doc.querySelectorAll('.ai4a11y-bionic .ai4a11y-bionic').length === 0);
    BionicReading.disable();
    BionicReading.disable(); // disabling twice is safe
    check('bionic: double disable is safe',
      BionicReading.enabled === false && doc.querySelectorAll('.ai4a11y-bionic').length === 0);
  }

  // boldRatio option: ratio 1 bolds every word whole.
  {
    const doc = mount(`<main><p id="p2">Hello world</p></main>`);
    BionicReading.enable({ boldRatio: 1 });
    const bolds = [...doc.querySelectorAll('#p2 b')].map((b) => b.textContent);
    check('bionic: boldRatio option controls the bolded fraction',
      bolds.includes('Hello') && bolds.includes('world'));
    BionicReading.disable();
  }

  // No <main>/<article>: falls back to <body> and still works.
  {
    const doc = mount(`<p id="solo">Fallback body text</p>`);
    BionicReading.enable();
    check('bionic: falls back to <body> when no main-content root exists',
      doc.querySelectorAll('#solo .ai4a11y-bionic b').length > 0);
    BionicReading.disable();
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
