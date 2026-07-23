// Skip Links — jsdom tests for the WCAG 2.4.1 bypass-blocks adapter that
// injects "Skip to main content" / "Skip to navigation" links as the page's
// first focusable elements. Asserts the user-facing outcome AND the
// reversibility contract: enable() is idempotent, disable() removes the
// container, stylesheet, and every id/tabindex the adapter added — restoring
// the DOM exactly — and ids the page already had are left untouched.
//
// Run: node tools/test/skip-links-test.js
import { JSDOM } from 'jsdom';
import { SkipLinks } from '../adapters/skip-links.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/page' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  return window;
}

// ── FULL PAGE: header + nav + main ──────────────────────────────────────────
{
  const win = mount(`<header>hdr</header><nav>nav</nav><main>content</main>`);
  const doc = win.document;
  const main = doc.querySelector('main');
  const nav = doc.querySelector('nav');
  const before = doc.body.innerHTML;
  let scrolled = 0;
  win.HTMLElement.prototype.scrollIntoView = function () { scrolled++; }; // jsdom: not implemented

  SkipLinks.enable();
  const container = doc.getElementById('ai4a11y-skip-links');
  check('skip: enable prepends the container as the FIRST child of body',
    container !== null && doc.body.firstElementChild === container);
  const links = container ? container.querySelectorAll('a') : [];
  const mainLink = links[0] || null;
  check('skip: a real <a> targets the main region, which was given an id',
    mainLink !== null && main.id !== '' && mainLink.getAttribute('href') === `#${main.id}`
    && /skip to main content/i.test(mainLink.textContent));
  check('skip: a nav skip link exists too',
    links.length === 2 && nav.id !== '' && links[1].getAttribute('href') === `#${nav.id}`
    && /skip to navigation/i.test(links[1].textContent));
  check('skip: the stylesheet is injected', doc.getElementById('ai4a11y-skip-links-styles') !== null);

  const clickEvt = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  mainLink.dispatchEvent(clickEvt);
  check('skip: activating the link prevents default fragment navigation', clickEvt.defaultPrevented === true);
  check('skip: the main region gets tabindex="-1"', main.getAttribute('tabindex') === '-1');
  check('skip: focus lands on the main region', doc.activeElement === main);
  check('skip: the main region is scrolled into view', scrolled === 1);

  // A second enable while enabled is a no-op — must not double the links.
  SkipLinks.enable();
  check('skip: second enable is a no-op (still one container)',
    doc.querySelectorAll('#ai4a11y-skip-links').length === 1);

  SkipLinks.disable();
  check('skip: disable removes the container', doc.getElementById('ai4a11y-skip-links') === null);
  check('skip: disable removes the stylesheet', doc.getElementById('ai4a11y-skip-links-styles') === null);
  check('skip: disable removes the ids and tabindex it added, restoring the DOM exactly',
    doc.body.innerHTML === before);

  SkipLinks.disable();
  check('skip: double disable is safe', SkipLinks.enabled === false);
}

// ── PRE-EXISTING ID + NO NAV ────────────────────────────────────────────────
{
  const win = mount(`<div class="content" id="page-body">already labeled</div>`);
  const doc = win.document;
  SkipLinks.enable();
  const links = doc.querySelectorAll('#ai4a11y-skip-links a');
  check('skip: no nav on the page means only the main link, reusing the existing id',
    links.length === 1 && links[0].getAttribute('href') === '#page-body');
  SkipLinks.disable();
  check('skip: disable leaves an id the page already had untouched',
    doc.getElementById('page-body') !== null);
}

// ── NOTHING RECOGNIZABLE: no main, no nav ───────────────────────────────────
{
  const win = mount(`<div>plain page with no landmarks</div>`);
  SkipLinks.enable();
  check('skip: no recognizable regions means no empty container',
    win.document.getElementById('ai4a11y-skip-links') === null);
  SkipLinks.disable();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
