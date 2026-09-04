// Adapters must not add an IN-FLOW child to <body>.
//
// A page laid out with `body { display: grid; grid-template-rows: auto 1fr }`
// rendered its 28px bar at 878px once the adapters were applied: skipLinks
// injects its block as the first child of body, so every positional row shifted
// by one — the injected div took the `auto` row and the real header took `1fr`.
// The page had no CSS bug. Anything positional is exposed the same way:
// grid-template-rows/areas, `body > *:first-child`, `:nth-child()`, and flex
// layouts that assume a child count.
//
// Skip links do have to come first in TAB ORDER — that is the point of them —
// but tab order is not the same as being first in the box layout. So the rule
// this file enforces is: inject wherever you need to in the DOM, but never
// occupy a layout slot. `position: fixed` (or `absolute`) does that.
//
// Run: node tools/test/body-injection-test.js
import { JSDOM } from 'jsdom';
import { SkipLinks } from '../adapters/skip-links.js';
import { KeyboardNavigator } from '../adapters/keyboard-nav.js';
import { LiveRegionAnnouncer } from '../adapters/live-region-announcer.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// The layout that broke: two explicit rows, one child per row.
const PAGE = `
  <style>body { display: grid; grid-template-rows: auto 1fr; margin: 0; }</style>
  <header id="bar">bar</header>
  <main id="content"><h1>Title</h1><p>Body text.</p><nav id="nav">nav</nav></main>`;

function mount(bodyHTML = PAGE) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.getComputedStyle = (el) => dom.window.getComputedStyle(el);
  global.MutationObserver = dom.window.MutationObserver;
  global.requestIdleCallback = undefined;
  return dom.window.document;
}

// An element takes a layout slot unless it is taken out of flow. (display:none
// isn't a grid/flex item either, which is why <script> never mattered here.)
function inFlow(el) {
  const cs = global.window.getComputedStyle(el);
  if (cs.display === 'none') return false;
  return cs.position !== 'fixed' && cs.position !== 'absolute';
}
const inFlowChildren = (doc) => [...doc.body.children].filter(inFlow);

async function run() {
  // ── each adapter, on its own ───────────────────────────────────────────────
  const ADAPTERS = [
    ['SkipLinks', SkipLinks],
    ['KeyboardNavigator', KeyboardNavigator],
    ['LiveRegionAnnouncer', LiveRegionAnnouncer],
  ];

  for (const [name, adapter] of ADAPTERS) {
    const doc = mount();
    const before = inFlowChildren(doc).map((e) => e.tagName + (e.id ? '#' + e.id : ''));

    adapter.enable();
    const after = inFlowChildren(doc).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
    check(`${name}: adds no in-flow child to <body>`, after.join(',') === before.join(','), { before, after });

    // …and the real layout children keep their positions.
    check(`${name}: the page's own first in-flow child is still first`, after[0] === before[0], { before, after });

    adapter.disable();
    const restored = inFlowChildren(doc).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
    check(`${name}: disable restores the body exactly`, restored.join(',') === before.join(','), { before, restored });
  }

  // ── all three together, the way a blind profile applies them ───────────────
  {
    const doc = mount();
    const before = inFlowChildren(doc).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
    SkipLinks.enable(); KeyboardNavigator.enable(); LiveRegionAnnouncer.enable();
    const after = inFlowChildren(doc).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
    check('combined: still no in-flow children added', after.join(',') === before.join(','), { before, after });
    check('combined: body did gain children (the test is not vacuous)', doc.body.children.length > before.length + 1);
    SkipLinks.disable(); KeyboardNavigator.disable(); LiveRegionAnnouncer.disable();
  }

  // ── tab order is still what skip links are FOR ────────────────────────────
  {
    const doc = mount();
    SkipLinks.enable();
    const first = doc.body.firstElementChild;
    check('skip links: still the FIRST child of body (tab order preserved)', first && first.id === 'ai4a11y-skip-links', first && first.id);
    check('skip links: but out of flow, so it takes no layout slot', !inFlow(first));
    check('skip links: the links themselves are still reachable', doc.querySelectorAll('#ai4a11y-skip-links a').length > 0);
    SkipLinks.disable();
  }

  // ── the announcer, specifically ───────────────────────────────────────────
  {
    const doc = mount();
    LiveRegionAnnouncer.enable();
    const region = doc.getElementById('ai4a11y-live-region');
    check('announcer: present and out of flow', !!region && !inFlow(region));
    check('announcer: still a live region for assistive tech', region && region.getAttribute('aria-live') === 'polite');
    LiveRegionAnnouncer.disable();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error('ERROR', e); process.exit(1); });
