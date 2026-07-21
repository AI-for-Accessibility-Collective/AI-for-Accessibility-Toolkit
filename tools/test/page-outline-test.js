// Page Outline — realistic jsdom tests for the heading-navigator adapter.
// Asserts the user-facing outcome (a nav of links, one per visible h1–h3,
// each pointing at its heading) AND the reversibility contract: enable() is
// idempotent, and disable() restores the page exactly (generated ids and
// tabindexes removed, pre-existing ids untouched).
//
// Run: node tools/test/page-outline-test.js
import { JSDOM } from 'jsdom';
import { PageOutline } from '../adapters/page-outline.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  global.requestIdleCallback = undefined;
  return window.document;
}

async function run() {
  // ── PAGE OUTLINE ────────────────────────────────────────────────────────────

  // A long article: an h1, an h2 that already has an id, an h2 without one,
  // and an h3 — plus body text the outline must ignore.
  {
    const doc = mount(`
      <h1>Universal Credit</h1>
      <h2 id="eligibility">Eligibility</h2>
      <h2>How to claim</h2>
      <h3>What you need</h3>
      <p>Long body text the outline should not list.</p>`);

    PageOutline.enable();
    const nav = doc.querySelector('#ai4a11y-page-outline');
    check('outline: creates the nav container with role=navigation', nav !== null && nav.getAttribute('role') === 'navigation' && nav.getAttribute('aria-label') === 'Page outline');
    const links = [...doc.querySelectorAll('#ai4a11y-page-outline a')];
    check('outline: lists one link per heading, in order', links.length === 4 && links.map((a) => a.textContent).join('|') === 'Universal Credit|Eligibility|How to claim|What you need');

    const h2NoId = [...doc.querySelectorAll('h2')].find((h) => h.textContent === 'How to claim');
    check('outline: a heading without an id gets a generated one', /^ai4a11y-outline-h-\d+$/.test(h2NoId.id));
    check('outline: a heading with an existing id keeps it', doc.querySelector('h2#eligibility') !== null);
    check('outline: every link points at its heading', links.every((a) => {
      const target = doc.getElementById(a.getAttribute('href').slice(1));
      return target !== null && target.textContent.trim() === a.textContent;
    }));

    // Clicking a link moves keyboard/screen-reader focus to the heading.
    links[2].click();
    check('outline: clicking a link focuses the heading', doc.activeElement === h2NoId && h2NoId.getAttribute('tabindex') === '-1');

    // Idempotency: a second enable() must not double-apply.
    PageOutline.enable();
    check('outline: second enable is a no-op (still one nav)', doc.querySelectorAll('#ai4a11y-page-outline').length === 1 && doc.querySelectorAll('#ai4a11y-page-outline a').length === 4);

    // disable() restores the page exactly.
    PageOutline.disable();
    check('outline: disable removes the nav', doc.querySelector('#ai4a11y-page-outline') === null);
    check('outline: disable removes generated ids and tabindex, keeps pre-existing ids', !h2NoId.hasAttribute('id') && !h2NoId.hasAttribute('tabindex') && doc.querySelector('h2#eligibility') !== null);
  }

  // A page with no headings still enables (with a note) and cleans up.
  {
    const doc = mount(`<p>Just a paragraph, no headings anywhere.</p>`);
    PageOutline.enable();
    const nav = doc.querySelector('#ai4a11y-page-outline');
    check('outline: enables cleanly on a page with no headings', nav !== null && nav.querySelectorAll('a').length === 0);
    PageOutline.disable();
    PageOutline.disable(); // disabling twice is safe
    check('outline: disable cleans up on the empty page too', doc.querySelector('#ai4a11y-page-outline') === null && PageOutline.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
