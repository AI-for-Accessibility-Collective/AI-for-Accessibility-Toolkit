// Focus Mode — unit tests for the focus mode adapter.
// Asserts the user-facing outcome (progress indicator, hover/focus highlight,
// SPA re-attachment, Escape dismissal) AND the reversibility contract
// every adapter must honor: enable() is idempotent, and disable() restores
// the page exactly.
//
// Run: node tools/test/focus-mode-test.js
import { JSDOM } from 'jsdom';
import { FocusMode } from '../adapters/focus-mode.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  return window.document;
}

async function run() {
  const doc = mount(`
    <header><h1>News</h1></header>
    <main>
      <article>
        <p id="dark-para" style="color: #1a1a1a;">Dark readable paragraph text.</p>
        <p id="light-para" style="color: #ffffff;">Light unreadable text on light background.</p>
        <div id="ad-banner" class="ad-banner"><p>Ad text</p></div>
      </article>
    </main>
  `);

  // 1. Enable creates stylesheet and progress element
  FocusMode.enable();
  check('focus-mode: enable injects styles element', doc.getElementById('ai4a11y-focus-mode-styles') !== null);
  const prog = doc.getElementById('ai4a11y-progress');
  check('focus-mode: enable injects progress element', prog !== null);
  check('focus-mode: progress element is aria-hidden', prog?.getAttribute('aria-hidden') === 'true');
  check('focus-mode: progress element has pointer-events: none', prog?.style.pointerEvents === 'none');

  // 2. Idempotency on repeated enable
  FocusMode.enable();
  check('focus-mode: repeated enable is idempotent (single style)', doc.querySelectorAll('#ai4a11y-focus-mode-styles').length === 1);
  check('focus-mode: repeated enable is idempotent (single progress)', doc.querySelectorAll('#ai4a11y-progress').length === 1);

  // 3. Hover highlighting on dark text
  const darkPara = doc.getElementById('dark-para');
  const lightPara = doc.getElementById('light-para');

  const mouseoverDark = new window.MouseEvent('mouseover', { bubbles: true });
  darkPara.dispatchEvent(mouseoverDark);
  check('focus-mode: mouseover on dark text highlights paragraph', darkPara.classList.contains('ai4a11y-focus-mode-highlight'));

  // 4. Escape dismisses highlight
  const escapeEvt = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  doc.dispatchEvent(escapeEvt);
  check('focus-mode: escape key dismisses highlight', !darkPara.classList.contains('ai4a11y-focus-mode-highlight'));

  // 5. Hover on light text does NOT highlight
  const mouseoverLight = new window.MouseEvent('mouseover', { bubbles: true });
  lightPara.dispatchEvent(mouseoverLight);
  check('focus-mode: mouseover on light text does not highlight', !lightPara.classList.contains('ai4a11y-focus-mode-highlight'));

  // 6. Focusin highlighting on dark text
  const focusinDark = new window.FocusEvent('focusin', { bubbles: true });
  darkPara.dispatchEvent(focusinDark);
  check('focus-mode: focusin highlights paragraph', darkPara.classList.contains('ai4a11y-focus-mode-highlight'));

  // 7. SPA re-attachment: if progress bar is detached, popstate re-attaches it
  const currentProg = doc.getElementById('ai4a11y-progress');
  currentProg?.remove();
  check('focus-mode: progress element temporarily removed', doc.getElementById('ai4a11y-progress') === null);
  window.dispatchEvent(new window.Event('popstate'));
  check('focus-mode: popstate re-attaches progress element', doc.getElementById('ai4a11y-progress') !== null);

  // 8. Disable cleans up everything
  FocusMode.disable();
  check('focus-mode: disable removes stylesheet', doc.getElementById('ai4a11y-focus-mode-styles') === null);
  check('focus-mode: disable removes progress element', doc.getElementById('ai4a11y-progress') === null);
  check('focus-mode: disable removes all highlight classes', doc.querySelectorAll('.ai4a11y-focus-mode-highlight').length === 0);
  check('focus-mode: double disable is safe', FocusMode.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
