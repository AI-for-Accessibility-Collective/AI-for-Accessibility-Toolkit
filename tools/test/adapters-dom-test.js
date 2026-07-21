// DOM-side visual adapters — realistic jsdom tests for the page-adapting
// adapters that mutate the live page (not the AI/screen-reader fixers covered
// by adapters-test.js). Asserts the user-facing outcome AND the reversibility
// contract every adapter must honor: enable() is idempotent, and disable()
// restores the page exactly (no leftover classes, styles, or observers).
//
// Run: node tools/test/adapters-dom-test.js
import { JSDOM } from 'jsdom';
import { DismissOverlays } from '../adapters/dismiss-overlays.js';
import { KeyboardNavigator } from '../adapters/keyboard-nav.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const tick = () => new Promise(r => setTimeout(r, 0));

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

async function run() {
  // ── DISMISS OVERLAYS ────────────────────────────────────────────────────────

  // A messy page: a fixed cookie banner, an aria-modal newsletter dialog, a
  // real article, an inline "cookie policy" link, and a static promo card.
  {
    const doc = mount(`
      <div id="cookie-consent" class="cookie-banner" style="position: fixed; bottom: 0;">We use cookies <button>OK</button></div>
      <div class="newsletter-modal" role="dialog" aria-modal="true"><h2>Subscribe!</h2></div>
      <main><article><p>The real article content that the reader came for.</p>
        <p>See our <a href="/cookie-policy">cookie policy</a> for details.</p></article></main>
      <aside class="promo-card">A static promo in the sidebar (not fixed, not modal).</aside>`);

    DismissOverlays.enable();
    const dismissed = (sel) => doc.querySelector(sel)?.classList.contains('ai4a11y-overlay-dismissed');
    check('overlays: hides a fixed cookie banner', dismissed('#cookie-consent') === true);
    check('overlays: hides an aria-modal newsletter dialog', dismissed('.newsletter-modal') === true);
    check('overlays: leaves the real article visible', dismissed('main') !== true && dismissed('article') !== true);
    check('overlays: never hides an inline "cookie policy" link', doc.querySelector('a[href="/cookie-policy"]').classList.contains('ai4a11y-overlay-dismissed') === false);
    check('overlays: never hides a static (non-blocking) promo card', dismissed('.promo-card') !== true);
    check('overlays: injects exactly one hide-rule stylesheet', doc.querySelectorAll('#ai4a11y-dismiss-overlays-styles').length === 1);

    // disable() restores the page exactly.
    DismissOverlays.disable();
    check('overlays: disable removes the hidden class from every element', doc.querySelectorAll('.ai4a11y-overlay-dismissed').length === 0);
    check('overlays: disable removes the injected stylesheet', doc.querySelector('#ai4a11y-dismiss-overlays-styles') === null);
  }

  // Idempotency: a second enable() must not double-apply or throw.
  {
    const doc = mount(`<div class="cookie-bar" style="position: sticky;">cookies</div><p>body</p>`);
    DismissOverlays.enable();
    DismissOverlays.enable(); // must be a no-op
    check('overlays: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-dismiss-overlays-styles').length === 1);
    check('overlays: sticky promo bar is hidden', doc.querySelector('.cookie-bar').classList.contains('ai4a11y-overlay-dismissed'));
    DismissOverlays.disable();
    DismissOverlays.disable(); // disabling twice is safe
    check('overlays: double disable is safe', DismissOverlays.enabled === false);
  }

  // Scroll-lock restore: a modal that locked <body> scroll is unlocked, and the
  // original value is put back on disable.
  {
    const doc = mount(`<div role="dialog" aria-modal="true">modal</div><p>body</p>`);
    doc.body.style.overflow = 'hidden';
    DismissOverlays.enable();
    check('overlays: unlocks body scroll a modal had locked', doc.body.style.overflow === '');
    DismissOverlays.disable();
    check('overlays: restores the original overflow on disable', doc.body.style.overflow === 'hidden');
  }

  // Late-injected banner (the common case: consent scripts run after load) is
  // caught by the MutationObserver and hidden.
  {
    const doc = mount(`<main><p>content</p></main>`);
    DismissOverlays.enable();
    const late = doc.createElement('div');
    late.className = 'gdpr-consent';
    late.setAttribute('style', 'position: fixed;');
    doc.body.appendChild(late);
    await tick();
    check('overlays: hides a banner injected after enable (observer)', late.classList.contains('ai4a11y-overlay-dismissed'));
    DismissOverlays.disable();
    check('overlays: observer stops after disable', (() => {
      const later = doc.createElement('div');
      later.className = 'cookie-consent';
      later.setAttribute('style', 'position: fixed;');
      doc.body.appendChild(later);
      return !later.classList.contains('ai4a11y-overlay-dismissed');
    })());
  }

  // ── KEYBOARD NAV (regressions: id + tabindex leak on disable, idempotency) ──
  {
    const doc = mount(`<main><p>content</p></main><nav><a href="/">home</a></nav><h1>Title</h1>`);
    KeyboardNavigator.enable();
    check('keyboard-nav: stamps an id on <main> for its skip link', doc.querySelector('main').id === 'ai4a11y-main-content');

    // Simulate the Alt+H shortcut, which stamps tabindex on a heading.
    const h1 = doc.querySelector('h1');
    KeyboardNavigator.shortcutHandler(new doc.defaultView.KeyboardEvent('keydown', { altKey: true, key: 'h' }));
    check('keyboard-nav: Alt+H stamps tabindex on the heading', h1.getAttribute('tabindex') === '-1');

    KeyboardNavigator.disable();
    check('keyboard-nav: disable removes the id it stamped on <main>', !doc.querySelector('main').id);
    check('keyboard-nav: disable removes the tabindex a shortcut left behind', h1.getAttribute('tabindex') === null);
    check('keyboard-nav: disable removes the skip-link container', doc.querySelector('#ai4a11y-skip-links') === null);

    // Idempotency: enabling twice then disabling once must leave no residue —
    // proving the second enable was a no-op (no leaked listener/state).
    KeyboardNavigator.enable();
    KeyboardNavigator.enable();
    KeyboardNavigator.disable();
    check('keyboard-nav: idempotent enable (clean after double-enable + one disable)',
      doc.querySelector('#ai4a11y-skip-links') === null && !doc.querySelector('main').id);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
