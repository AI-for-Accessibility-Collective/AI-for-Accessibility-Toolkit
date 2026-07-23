// Math A11y — jsdom tests for the structural math-labeling adapter that gives
// unnamed MathML an aria-label (spoken serialization / alttext) and math
// images a real alt (decoded TeX from render URLs). Asserts the user-facing
// outcome AND the reversibility contract: enable() is idempotent, disable()
// removes exactly the attributes the adapter added (an img's original empty
// alt="" comes back as empty, not absent), and pre-existing author attributes
// like alttext are never touched.
//
// Run: node tools/test/math-a11y-test.js
import { JSDOM } from 'jsdom';
import { MathA11y } from '../adapters/math-a11y.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML, url = 'https://example.com/article') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  return window;
}

function run() {
  const win = mount(`
    <main>
      <p>The harmonic series compares each term to
        <math id="frac"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>.
      </p>
      <p>Author-labeled: <math id="named" alttext="x plus y"><mi>x</mi></math></p>
      <img id="eq" class="math" src="https://latex.codecogs.com/png?x%5E2" alt="">
    </main>`);
  const doc = win.document;
  const frac = doc.getElementById('frac');
  const named = doc.getElementById('named');
  const img = doc.getElementById('eq');

  // ── ENABLE: unnamed MathML gets a spoken name ───────────────────────────────
  MathA11y.enable();
  check('math: unnamed MathML gets role="math"', frac.getAttribute('role') === 'math');
  const fracLabel = frac.getAttribute('aria-label') || '';
  check('math: the fraction reads its parts with "over"',
    /\bover\b/.test(fracLabel) && fracLabel.includes('1') && fracLabel.includes('2'));

  // An author-provided alttext wins and is mirrored verbatim, never rewritten.
  check('math: an existing alttext becomes the aria-label verbatim',
    named.getAttribute('aria-label') === 'x plus y');
  check('math: the pre-existing alttext itself is untouched',
    named.getAttribute('alttext') === 'x plus y');

  // ── ENABLE: a math image with an empty alt gets a real one ──────────────────
  check('math: a math image with empty alt gets a non-empty alt',
    (img.getAttribute('alt') || '').trim().length > 0);
  check('math: a codecogs render URL decodes its TeX into the alt',
    img.getAttribute('alt') === 'Equation: x^2');
  check('math: a focus outline style is injected',
    doc.getElementById('ai4a11y-math-style') !== null);

  // ── IDEMPOTENT ENABLE: a second call must not re-track or re-label ──────────
  const tracked = MathA11y.records.length;
  check('math: three elements tracked (two math, one image)', tracked === 3);
  MathA11y.enable();
  check('math: second enable is a no-op (no double tracking)',
    MathA11y.records.length === tracked && named.getAttribute('aria-label') === 'x plus y');

  // ── DISABLE: exactly the added attributes come off, nothing else ────────────
  MathA11y.disable();
  check('math: disable removes the added role and aria-label',
    !frac.hasAttribute('role') && !frac.hasAttribute('aria-label'));
  check('math: disable removes the aria-label but keeps the alttext',
    !named.hasAttribute('aria-label') && named.getAttribute('alttext') === 'x plus y');
  check('math: disable restores the img alt to exactly its original empty string',
    img.getAttribute('alt') === '');
  check('math: disable removes the focus style',
    doc.getElementById('ai4a11y-math-style') === null);

  // ── DOUBLE DISABLE: safe no-op ──────────────────────────────────────────────
  let threw = false;
  try { MathA11y.disable(); } catch { threw = true; }
  check('math: double disable is safe', !threw && MathA11y.enabled === false);
}

run();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
