// Magnifier — realistic jsdom tests. jsdom has no layout engine, so
// elementFromPoint gives the move handler nothing real to hit-test; these
// tests therefore assert the LIFECYCLE and safety contract, not the magnified
// content: enable() builds a hidden lens, mousemove is a safe no-op without
// hit-testing, enable() is idempotent, and disable() removes the lens and
// listeners exactly (a mousemove after disable touches nothing).
//
// Run: node tools/test/magnifier-test.js
import { JSDOM } from 'jsdom';
import { Magnifier } from '../adapters/magnifier.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function () {};
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  global.requestIdleCallback = undefined;
  return window.document;
}

// Dispatch a mousemove on document, reporting whether the handler threw —
// the adapter must swallow missing/null elementFromPoint, not crash the page.
function moveSafely(doc, x, y) {
  try {
    doc.dispatchEvent(new doc.defaultView.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    return true;
  } catch { return false; }
}

async function run() {
  // A typical article page with real text under the pointer's path.
  const doc = mount(`
    <main><article><h1>Quiet hours</h1>
      <p>The article text a low-vision reader would sweep the lens across.</p></article></main>`);

  Magnifier.enable();
  const lens = doc.querySelector('#ai4a11y-magnifier');
  check('magnifier: enable creates the lens, hidden until the pointer finds text',
    lens !== null && lens.style.display === 'none');

  check('magnifier: mousemove without real hit-testing is a safe no-op (no throw)',
    moveSafely(doc, 40, 40) === true);
  check('magnifier: the lens survives the mousemove', doc.querySelector('#ai4a11y-magnifier') !== null);

  // Idempotency: a second enable() must not build a second lens.
  Magnifier.enable();
  check('magnifier: second enable is a no-op (still one lens)',
    doc.querySelectorAll('#ai4a11y-magnifier').length === 1);

  // disable() restores the page exactly.
  Magnifier.disable();
  check('magnifier: disable removes the lens', doc.querySelector('#ai4a11y-magnifier') === null);

  // The listeners are gone too: a mousemove after disable neither throws nor
  // resurrects the lens.
  check('magnifier: mousemove after disable does nothing (no throw)', moveSafely(doc, 60, 60) === true);
  check('magnifier: no lens reappears after disable', doc.querySelector('#ai4a11y-magnifier') === null);

  Magnifier.disable(); // disabling twice is safe
  check('magnifier: double disable is safe', Magnifier.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
