// SPA Focus — jsdom tests for the route-change adapter that moves keyboard
// focus to the new page's main region and announces it through an assertive
// live region. jsdom fires no events for history.pushState, so the patched
// methods are exercised directly: after enable() pushState must be a
// different function than the native one, and calling it must (after the
// settle debounce) focus main and populate the live region. Also asserts the
// reversibility contract: disable() restores the ORIGINAL history methods,
// removes the region and any tabindex the adapter added.
//
// Run: node tools/test/spa-focus-test.js
import { JSDOM } from 'jsdom';
import { SpaFocus } from '../adapters/spa-focus.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mount(bodyHTML, url = 'https://example.com/') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  return window;
}

async function run() {
  // ── NAVIGATE → FOCUS + ANNOUNCE, THEN FULL TEARDOWN ─────────────────────────
  {
    const win = mount(`<main><h1 id="h">Home</h1></main>`);
    const doc = win.document;
    const origPush = win.history.pushState;
    const origReplace = win.history.replaceState;

    SpaFocus.enable();
    const region = doc.getElementById('ai4a11y-spa-focus-region');
    check('spa: enable creates a hidden assertive live region',
      region !== null && region.getAttribute('aria-live') === 'assertive');
    check('spa: enable patches pushState (a different function)', win.history.pushState !== origPush);

    // A second enable while enabled is a no-op — one region, same patch.
    SpaFocus.enable();
    check('spa: second enable is a no-op (still one region)',
      doc.querySelectorAll('#ai4a11y-spa-focus-region').length === 1);

    // A route change through the patched pushState focuses main and announces.
    win.history.pushState({}, '', '/page2');
    await wait(250);
    const main = doc.querySelector('main');
    check('spa: navigation moves focus to the main region', doc.activeElement === main);
    check('spa: navigation gives main the tabindex it needs', main.getAttribute('tabindex') === '-1');
    check('spa: navigation announces the page name', (region.textContent || '').trim().length > 0);

    // Pushing the SAME path again must not re-announce or steal focus.
    region.textContent = '';
    win.history.pushState({}, '', '/page2');
    await wait(250);
    check('spa: a same-path push announces nothing', region.textContent === '');

    // Back/forward: move the URL without our patch, then fire popstate.
    origPush.call(win.history, {}, '', '/page3');
    region.textContent = '';
    win.dispatchEvent(new win.PopStateEvent('popstate'));
    await wait(250);
    check('spa: popstate also triggers the announcement', (region.textContent || '').trim().length > 0);

    // Teardown: originals back, region gone, borrowed tabindex removed.
    SpaFocus.disable();
    check('spa: disable restores the original pushState', win.history.pushState === origPush);
    check('spa: disable restores the original replaceState', win.history.replaceState === origReplace);
    check('spa: disable removes the live region', doc.getElementById('ai4a11y-spa-focus-region') === null);
    check('spa: disable removes the tabindex it added', !main.hasAttribute('tabindex'));

    // Post-disable navigation is inert — no region reappears, nothing crashes.
    win.history.pushState({}, '', '/page4');
    await wait(250);
    check('spa: post-disable pushState does nothing', doc.getElementById('ai4a11y-spa-focus-region') === null);

    SpaFocus.disable();
    check('spa: double disable is safe', SpaFocus.enabled === false);
  }

  // ── A TABINDEX THE PAGE SET ITSELF IS NOT OURS TO REMOVE ────────────────────
  {
    const win = mount(`<main tabindex="0"><h1>Docs</h1></main>`);
    SpaFocus.enable();
    win.history.pushState({}, '', '/section2');
    await wait(250);
    SpaFocus.disable();
    check('spa: disable keeps a tabindex the page set itself',
      win.document.querySelector('main').getAttribute('tabindex') === '0');
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
