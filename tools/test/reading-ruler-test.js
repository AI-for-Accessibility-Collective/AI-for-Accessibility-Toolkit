// Reading Ruler — jsdom tests for the cursor-following highlight band.
// Asserts the user-facing outcome AND the reversibility contract: enable() is
// idempotent, disable() removes the band, shades, and mousemove listener.
//
// Run: node tools/test/reading-ruler-test.js
import { JSDOM } from 'jsdom';
import { ReadingRuler } from '../adapters/reading-ruler.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
// jsdom has no rAF here, so the adapter falls back to its 16ms timer — wait it out.
const settle = () => new Promise(r => setTimeout(r, 25));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

function moveTo(doc, clientY) {
  doc.dispatchEvent(new doc.defaultView.MouseEvent('mousemove', { clientY, bubbles: true }));
}

async function run() {
  // Enable creates the band; mousemove repositions it around the cursor.
  {
    const doc = mount(`<main><p>A long article the reader is tracking line by line.</p></main>`);
    ReadingRuler.enable();
    const band = doc.getElementById('ai4a11y-reading-ruler');
    check('ruler: enable creates the band (fixed, click-through)',
      band !== null && band.style.position === 'fixed' && band.style.pointerEvents === 'none');
    check('ruler: band is hidden from the accessibility tree', band.getAttribute('aria-hidden') === 'true');

    moveTo(doc, 200);
    await settle();
    // Default height 40 → band centered on y=200 sits at top 180.
    const top = parseInt(band.style.top, 10);
    check('ruler: mousemove repositions the band onto the cursor line',
      band.style.top !== '' && top >= 170 && top <= 210);

    // Idempotency: a second enable() must not add a second band.
    ReadingRuler.enable();
    check('ruler: second enable is a no-op (still one band)',
      doc.querySelectorAll('#ai4a11y-reading-ruler').length === 1);

    ReadingRuler.disable();
    check('ruler: disable removes the band', doc.getElementById('ai4a11y-reading-ruler') === null);

    // The listener is gone too: a post-disable mousemove must not recreate or
    // reposition anything (and must not throw).
    moveTo(doc, 400);
    await settle();
    check('ruler: post-disable mousemove does nothing (listener removed)',
      doc.getElementById('ai4a11y-reading-ruler') === null);

    ReadingRuler.disable(); // disabling twice is safe
    check('ruler: double disable is safe', ReadingRuler.enabled === false);
  }

  // Options: custom band height is honored, and it shifts the centering math.
  {
    const doc = mount(`<main><p>content</p></main>`);
    ReadingRuler.enable({ height: 60 });
    const band = doc.getElementById('ai4a11y-reading-ruler');
    check('ruler: options.height is reflected on the band', band.style.height === '60px');
    moveTo(doc, 200);
    await settle();
    check('ruler: a 60px band centers on the cursor (top = 200 - 30)', band.style.top === '170px');
    ReadingRuler.disable();
    check('ruler: disable leaves no injected nodes behind',
      doc.querySelectorAll('[aria-hidden="true"]').length === 0);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
