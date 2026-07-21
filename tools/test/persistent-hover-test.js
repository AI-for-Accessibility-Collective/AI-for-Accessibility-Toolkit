// Persistent Hover — realistic jsdom tests for the WCAG 1.4.13 adapter.
// Asserts the user-facing outcome (a titled element's tooltip appears, stays
// through plain mouseout, is hoverable, and dismisses on Escape) AND the
// reversibility contract: enable() is idempotent, and disable() removes the
// tooltip, the stylesheet, and both document listeners.
//
// Run: node tools/test/persistent-hover-test.js
import { JSDOM } from 'jsdom';
import { PersistentHover } from '../adapters/persistent-hover.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  global.requestIdleCallback = undefined;
  return window.document;
}

async function run() {
  // A titled link (whose native tooltip a slow-moving pointer can never
  // reach) and an untitled button.
  {
    const doc = mount(`<a id="a" href="/x" title="Go to the docs page">docs</a><button id="b">b</button>`);
    const over = (el) => el.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    const escape = () => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    PersistentHover.enable();
    const tip = doc.querySelector('#ai4a11y-hover-tip');
    check('hover: enable creates the tooltip element, hidden until needed', tip !== null && tip.hidden === true);
    check('hover: the tooltip is a role="tooltip"', tip.getAttribute('role') === 'tooltip');
    check('hover: injects exactly one stylesheet', doc.querySelectorAll('#ai4a11y-persistent-hover-styles').length === 1);

    over(doc.querySelector('#a'));
    check('hover: mouseover on a titled element shows its title text', tip.hidden === false && tip.textContent === 'Go to the docs page');
    check('hover: the tooltip is hoverable (pointer-events: auto)', tip.style.pointerEvents === 'auto');

    // The whole point: moving to an untitled element must NOT hide it.
    over(doc.querySelector('#b'));
    check('hover: tooltip persists when the pointer moves to an untitled element', tip.hidden === false);

    escape();
    check('hover: Escape dismisses the tooltip', tip.hidden === true);

    over(doc.querySelector('#b'));
    check('hover: an untitled element never summons a tooltip', tip.hidden === true);

    PersistentHover.enable(); // must be a no-op
    check('hover: second enable is a no-op (still one stylesheet, one tooltip)',
      doc.querySelectorAll('#ai4a11y-persistent-hover-styles').length === 1 &&
      doc.querySelectorAll('#ai4a11y-hover-tip').length === 1);

    // disable() restores the page exactly.
    PersistentHover.disable();
    check('hover: disable removes the tooltip and the stylesheet',
      doc.querySelector('#ai4a11y-hover-tip') === null &&
      doc.querySelector('#ai4a11y-persistent-hover-styles') === null);

    over(doc.querySelector('#a'));
    check('hover: listeners are gone after disable (mouseover shows nothing)', doc.querySelector('#ai4a11y-hover-tip') === null);

    PersistentHover.disable(); // disabling twice is safe
    check('hover: double disable is safe', PersistentHover.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
