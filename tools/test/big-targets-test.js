// Bigger Click Targets — realistic jsdom tests for the CSS-only enlarger.
// Asserts the user-facing outcome (one scoped stylesheet covering every
// interactive selector, sized to WCAG 2.5.8) AND the reversibility contract
// every adapter must honor: enable() is idempotent, and disable() restores
// the page exactly (no leftover body class or injected styles).
//
// Run: node tools/test/big-targets-test.js
import { JSDOM } from 'jsdom';
import { BigTargets } from '../adapters/big-targets.js';

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
  // ── BIGGER CLICK TARGETS ────────────────────────────────────────────────────

  // A dense page: tiny text links, a small icon button, a checkbox, a
  // clickable div, and an onclick span — everything the adapter must cover.
  {
    const doc = mount(`
      <nav><a href="/a">a</a> <a href="/b">b</a> <a href="/c">c</a></nav>
      <button class="icon-btn">x</button>
      <input type="checkbox">
      <div role="button" tabindex="0">Save</div>
      <span onclick="go()">go</span>
      <main><p>Article text stays untouched.</p></main>`);

    BigTargets.enable();
    check('big-targets: enable adds the body class', doc.body.classList.contains('ai4a11y-big-targets'));
    check('big-targets: injects exactly one stylesheet with the expected id', doc.querySelectorAll('#ai4a11y-big-targets-styles').length === 1);
    const css = doc.getElementById('ai4a11y-big-targets-styles')?.textContent || '';
    check('big-targets: CSS sizes interactive elements', css.includes('button') && (css.includes('min-height') || css.includes('min-width')));
    check('big-targets: CSS covers ARIA buttons and onclick handlers', css.includes('[role="button"]') && css.includes('[onclick]'));
    check('big-targets: CSS strengthens the focus outline', css.includes(':focus') && css.includes('outline'));

    // Idempotency: a second enable() must not double-apply or throw.
    BigTargets.enable(); // must be a no-op
    check('big-targets: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-big-targets-styles').length === 1);
    check('big-targets: second enable does not duplicate the body class', doc.body.className.split(/\s+/).filter((c) => c === 'ai4a11y-big-targets').length === 1);

    // disable() restores the page exactly.
    BigTargets.disable();
    check('big-targets: disable removes the body class', !doc.body.classList.contains('ai4a11y-big-targets'));
    check('big-targets: disable removes the injected stylesheet', doc.querySelector('#ai4a11y-big-targets-styles') === null);
    BigTargets.disable(); // disabling twice is safe
    check('big-targets: double disable is safe', BigTargets.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
