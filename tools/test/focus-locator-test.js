// Focus Locator — jsdom tests for the keyboard-focus highlighter. Asserts the
// user-facing outcome (a strong outline stylesheet plus a tracking ring that
// shows on focusin and hides on focusout) AND the reversibility contract:
// enable() is idempotent, and disable() removes the stylesheet, the ring, and
// both document listeners. jsdom's zero-size rects exercise the guarded
// getBoundingClientRect path.
//
// Run: node tools/test/focus-locator-test.js
import { JSDOM } from 'jsdom';
import { FocusLocator } from '../adapters/focus-locator.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  return window.document;
}

async function run() {
  const doc = mount(`<button id="b1">one</button><input id="b2">`);
  const ring = () => doc.getElementById('ai4a11y-focus-ring');
  const ringVisible = () => {
    const r = ring();
    return !!r && r.style.display !== 'none' && r.style.visibility !== 'hidden';
  };

  // enable() injects the outline stylesheet and a hidden tracking ring.
  FocusLocator.enable();
  const styles = doc.querySelectorAll('#ai4a11y-focus-locator-styles');
  check('focus-locator: injects exactly one outline stylesheet',
    styles.length === 1 && styles[0].textContent.includes('outline'));
  check('focus-locator: creates the tracking ring, hidden until focus arrives',
    ring() !== null && !ringVisible());

  // Focusing an element shows the ring over it (jsdom rects are all-zero,
  // which must not throw thanks to the guarded rect read).
  doc.getElementById('b1').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  check('focus-locator: focusin shows the ring', ringVisible());

  doc.getElementById('b1').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
  check('focus-locator: focusout hides the ring', ring() !== null && !ringVisible());

  // Idempotency: a second enable() must not double-inject.
  FocusLocator.enable();
  check('focus-locator: second enable is a no-op (one stylesheet, one ring)',
    doc.querySelectorAll('#ai4a11y-focus-locator-styles').length === 1 &&
    doc.querySelectorAll('#ai4a11y-focus-ring').length === 1);

  // disable() restores the page exactly: no stylesheet, no ring, no listeners.
  FocusLocator.disable();
  check('focus-locator: disable removes the injected stylesheet',
    doc.querySelector('#ai4a11y-focus-locator-styles') === null);
  check('focus-locator: disable removes the ring element', ring() === null);
  check('focus-locator: listeners are gone after disable (focusin does nothing)', (() => {
    doc.getElementById('b2').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    return ring() === null;
  })());

  FocusLocator.disable(); // disabling twice is safe
  check('focus-locator: double disable is safe', FocusLocator.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
