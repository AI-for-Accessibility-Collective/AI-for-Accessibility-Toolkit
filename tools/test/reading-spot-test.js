// Save Reading Spot — jsdom tests for the COGA memory-support adapter that
// remembers scroll position per page and offers to restore it on return.
// Asserts the user-facing outcome AND the reversibility contract: enable()
// is idempotent, disable() removes the listener/button but keeps the saved
// spot, and a throwing localStorage (private mode) never crashes the page.
//
// Run: node tools/test/reading-spot-test.js
import { JSDOM } from 'jsdom';
import { ReadingSpot } from '../adapters/reading-spot.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mount(bodyHTML, url = 'https://example.com/article') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url });
  const { window } = dom;
  window.scrollTo = window.scrollTo || (() => {});
  global.window = window;
  global.document = window.document;
  return window;
}

async function run() {
  // ── RESTORE OFFER + SAVE-ON-SCROLL (pre-seeded spot) ────────────────────────
  {
    const win = mount(`<main style="height: 3000px"><p>a long article</p></main>`);
    const doc = win.document;
    const KEY = 'ai4a11y-spot:test';
    win.localStorage.setItem(KEY, '350');
    const scrollCalls = [];
    win.scrollTo = (x, y) => scrollCalls.push([x, y]);

    ReadingSpot.enable({ key: KEY });
    const btn = doc.getElementById('ai4a11y-spot-restore');
    check('spot: a saved position creates the restore button (a real <button>)', btn !== null && btn.tagName === 'BUTTON');
    check('spot: the button invites jumping back', /jump back/i.test(btn ? btn.textContent : ''));

    btn.click();
    check('spot: clicking scrolls to the saved Y', scrollCalls.length === 1 && scrollCalls[0][1] === 350);
    check('spot: the button removes itself after the jump', doc.getElementById('ai4a11y-spot-restore') === null);

    // Scrolling saves the new position once the debounce settles.
    Object.defineProperty(win, 'scrollY', { value: 1200, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: scrolling saves the new position (debounced)', win.localStorage.getItem(KEY) === '1200');

    // A second enable while enabled is a no-op — must not resurrect the button.
    ReadingSpot.enable({ key: KEY });
    check('spot: second enable is a no-op', doc.getElementById('ai4a11y-spot-restore') === null);

    ReadingSpot.disable();
    Object.defineProperty(win, 'scrollY', { value: 50, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: after disable, scrolling no longer updates storage', win.localStorage.getItem(KEY) === '1200');
    check('spot: disable keeps the saved position for the next visit', win.localStorage.getItem(KEY) !== null);

    ReadingSpot.disable();
    check('spot: double disable is safe', ReadingSpot.enabled === false);
  }

  // ── FIRST VISIT: NO SAVED SPOT → NO BUTTON ──────────────────────────────────
  {
    const win = mount(`<main><p>first visit</p></main>`);
    ReadingSpot.enable({ key: 'ai4a11y-spot:fresh' });
    check('spot: no saved position means no restore button', win.document.getElementById('ai4a11y-spot-restore') === null);
    ReadingSpot.disable();
  }

  // ── DISABLE REMOVES A BUTTON THE READER NEVER CLICKED ───────────────────────
  {
    const win = mount(`<main><p>returning visit</p></main>`);
    win.localStorage.setItem('ai4a11y-spot:test2', '75');
    ReadingSpot.enable({ key: 'ai4a11y-spot:test2' });
    ReadingSpot.disable();
    check('spot: disable removes an unused restore button', win.document.getElementById('ai4a11y-spot-restore') === null);
  }

  // ── THROWING STORAGE (private mode / sandboxed frame) ───────────────────────
  {
    const win = mount(`<main><p>locked down</p></main>`);
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
      },
    });
    let threw = false;
    try { ReadingSpot.enable({ key: 'ai4a11y-spot:locked' }); } catch { threw = true; }
    check('spot: a throwing localStorage does not crash enable', !threw && ReadingSpot.enabled === true);
    // The debounced save must swallow the throw too — an uncaught exception
    // in its setTimeout would kill the process before the tally below runs,
    // so reaching this check at all is the assertion.
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: a throwing localStorage does not crash the debounced save', true);
    ReadingSpot.disable();
  }

  // ── PENDING SPOT: a small accidental scroll must not clobber the far spot ────
  {
    const win = mount(`<main style="height: 6000px"><p>long article</p></main>`);
    const KEY = 'ai4a11y-spot:pending';
    win.localStorage.setItem(KEY, '5000');
    ReadingSpot.enable({ key: KEY });   // button pending, reader has NOT clicked it
    Object.defineProperty(win, 'scrollY', { value: 120, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: a small accidental scroll does not overwrite the pending far spot', win.localStorage.getItem(KEY) === '5000');
    // Reading genuinely further (beyond the saved spot) does update it.
    Object.defineProperty(win, 'scrollY', { value: 5200, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: scrolling beyond the saved spot updates it', win.localStorage.getItem(KEY) === '5200');
    ReadingSpot.disable();
  }

  // ── KEY ISOLATION: pages that route by query string get distinct spots ──────
  {
    const win = mount(`<main style="height: 3000px"><p>video</p></main>`, 'https://example.com/watch?v=abc');
    ReadingSpot.enable();  // default key → pathname + search
    Object.defineProperty(win, 'scrollY', { value: 800, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await wait(600);
    check('spot: the default key includes the query string', win.localStorage.getItem('ai4a11y-spot:/watch?v=abc') === '800');
    check('spot: query-routed pages do not collide on pathname alone', win.localStorage.getItem('ai4a11y-spot:/watch') === null);
    ReadingSpot.disable();
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
