// Reduce Brightness — realistic jsdom tests. Asserts the user-facing outcome
// (root class, filter stylesheet, dim overlay) AND the reversibility contract:
// enable() is idempotent, and disable() restores the page exactly. jsdom does
// not compute stylesheet filter rules, so we assert on the class, the injected
// CSS text, and the overlay's inline style — not getComputedStyle(html).filter.
//
// Run: node tools/test/reduce-brightness-test.js
import { JSDOM } from 'jsdom';
import { ReduceBrightness } from '../adapters/reduce-brightness.js';

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

function run() {
  // A bright article page gets dimmed, then restored exactly.
  {
    const doc = mount(`<main><h1>Glare</h1><p>A very bright page.</p></main>`);
    ReduceBrightness.enable();

    check('dims: enable adds the ai4a11y-dimmed class to <html>',
      doc.documentElement.classList.contains('ai4a11y-dimmed'));
    const styles = doc.querySelectorAll('#ai4a11y-reduce-brightness-styles');
    check('dims: injects exactly one filter stylesheet', styles.length === 1);
    check('dims: the stylesheet dims and desaturates (brightness + saturate)',
      styles[0].textContent.includes('brightness(') && styles[0].textContent.includes('saturate('));

    check('dims: no flat overlay by default (clean filter-only dim)',
      doc.querySelector('#ai4a11y-dim-overlay') === null);

    // disable() restores the page exactly.
    ReduceBrightness.disable();
    check('dims: disable removes the class from <html>',
      !doc.documentElement.classList.contains('ai4a11y-dimmed'));
    check('dims: disable removes the injected stylesheet',
      doc.querySelector('#ai4a11y-reduce-brightness-styles') === null);
  }

  // The extra flat overlay is opt-in via options.dim, and cleans up on disable.
  {
    const doc = mount(`<p>content</p>`);
    ReduceBrightness.enable({ dim: 0.2 });
    const overlay = doc.querySelector('#ai4a11y-dim-overlay');
    check('dims: options.dim adds a fixed full-viewport overlay',
      overlay !== null && overlay.style.position === 'fixed');
    check('dims: the overlay never intercepts clicks (pointer-events: none)',
      overlay.style.pointerEvents === 'none');
    ReduceBrightness.disable();
    check('dims: disable removes the opt-in overlay',
      doc.querySelector('#ai4a11y-dim-overlay') === null);
  }

  // Options tune the intensity: a custom brightness lands in the CSS.
  {
    const doc = mount(`<p>content</p>`);
    ReduceBrightness.enable({ brightness: 0.5 });
    check('dims: options.brightness=0.5 is reflected in the injected CSS',
      doc.querySelector('#ai4a11y-reduce-brightness-styles').textContent.includes('brightness(0.5)'));
    ReduceBrightness.disable();
  }

  // Idempotency: a second enable() must not double-apply; double disable is safe.
  {
    const doc = mount(`<p>content</p>`);
    ReduceBrightness.enable();
    ReduceBrightness.enable(); // must be a no-op
    check('dims: second enable is a no-op (still one stylesheet)',
      doc.querySelectorAll('#ai4a11y-reduce-brightness-styles').length === 1);
    ReduceBrightness.disable();
    ReduceBrightness.disable(); // disabling twice is safe
    check('dims: double disable is safe', ReduceBrightness.enabled === false);
  }
}

run();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
