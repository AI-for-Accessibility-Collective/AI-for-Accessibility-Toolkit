// Unpin Sticky Bars — realistic jsdom tests. Asserts the user-facing outcome
// (pinned chrome is unpinned, static content is untouched) AND the
// reversibility contract every adapter must honor: enable() is idempotent, and
// disable() restores the page exactly (no leftover classes, styles, or
// observers).
//
// Run: node tools/test/unpin-sticky-test.js
import { JSDOM } from 'jsdom';
import { UnpinSticky } from '../adapters/unpin-sticky.js';

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
  // A typical page: a fixed site header, a sticky nav, and static content.
  const doc = mount(`
    <header id="site-header" style="position: fixed; top: 0;">Site header</header>
    <nav id="site-nav" style="position: sticky; top: 0;">Section nav</nav>
    <main><article><p>The article content the reader came for.</p></article></main>`);

  UnpinSticky.enable();
  const unpinnedSel = (sel) => doc.querySelector(sel)?.classList.contains('ai4a11y-unpinned');
  check('unpin: unpins a fixed header', unpinnedSel('#site-header') === true);
  check('unpin: unpins a sticky nav', unpinnedSel('#site-nav') === true);
  check('unpin: leaves static content untouched', unpinnedSel('main') !== true && unpinnedSel('article') !== true);
  const styles = doc.querySelectorAll('#ai4a11y-unpin-sticky-styles');
  check('unpin: injects exactly one stylesheet whose rule sets position:static',
    styles.length === 1 && /position:\s*static\s*!important/.test(styles[0].textContent));

  // A floating widget injected after enable (the common case: chat widgets
  // mount late) is caught by the MutationObserver and unpinned.
  const late = doc.createElement('div');
  late.id = 'chat-widget';
  late.setAttribute('style', 'position: fixed; bottom: 0;');
  doc.body.appendChild(late);
  await tick();
  check('unpin: unpins a fixed widget injected after enable (observer)', late.classList.contains('ai4a11y-unpinned'));

  // Idempotency: a second enable() must be a no-op.
  UnpinSticky.enable();
  check('unpin: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-unpin-sticky-styles').length === 1);

  // disable() restores the page exactly.
  UnpinSticky.disable();
  check('unpin: disable removes the class from every element', doc.querySelectorAll('.ai4a11y-unpinned').length === 0);
  check('unpin: disable removes the injected stylesheet', doc.querySelector('#ai4a11y-unpin-sticky-styles') === null);
  UnpinSticky.disable(); // disabling twice is safe
  check('unpin: double disable is safe', UnpinSticky.enabled === false);

  // Observer stops after disable: a fixed element added now is not touched.
  const afterDisable = doc.createElement('div');
  afterDisable.setAttribute('style', 'position: fixed; top: 0;');
  doc.body.appendChild(afterDisable);
  await tick();
  check('unpin: observer stops after disable', !afterDisable.classList.contains('ai4a11y-unpinned'));
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
