// Reflow — jsdom tests for the single-column adapter. jsdom doesn't compute
// layout, so we assert the reversibility contract on the DOM itself: the root
// class and the injected stylesheet's text, not getComputedStyle.
//
// Run: node tools/test/reflow-column-test.js
import { JSDOM } from 'jsdom';
import { ReflowColumn } from '../adapters/reflow-column.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  return window.document;
}

// A page with the layouts reflow exists to linearize: a flex row, floats,
// CSS columns, and a wide image.
const PAGE = `
  <main style="display: flex">
    <article><p>The article text.</p></article>
    <aside style="float: right; column-count: 3">sidebar</aside>
  </main>
  <img src="wide.png" width="2000">`;

{
  const doc = mount(PAGE);
  ReflowColumn.enable();
  check('reflow: enable adds the class to <html>', doc.documentElement.classList.contains('ai4a11y-reflow'));
  const styles = doc.querySelectorAll('#ai4a11y-reflow-column-styles');
  check('reflow: injects exactly one stylesheet', styles.length === 1);
  check('reflow: CSS constrains the body width (default 720px)', /max-width:\s*720px/.test(styles[0]?.textContent || ''));
  check('reflow: CSS collapses multi-column layout', (styles[0]?.textContent || '').includes('column-count'));

  // disable() restores the page exactly.
  ReflowColumn.disable();
  check('reflow: disable removes the class from <html>', !doc.documentElement.classList.contains('ai4a11y-reflow'));
  check('reflow: disable removes the stylesheet', doc.querySelector('#ai4a11y-reflow-column-styles') === null);
}

// A custom column width flows through to the CSS.
{
  const doc = mount(PAGE);
  ReflowColumn.enable({ width: 500 });
  check('reflow: options.width is reflected in the CSS', /max-width:\s*500px/.test(doc.querySelector('#ai4a11y-reflow-column-styles')?.textContent || ''));

  // Idempotency: a second enable() must not double-apply.
  ReflowColumn.enable();
  check('reflow: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-reflow-column-styles').length === 1);
  ReflowColumn.disable();
  ReflowColumn.disable(); // disabling twice is safe
  check('reflow: double disable is safe', ReflowColumn.enabled === false && doc.querySelector('#ai4a11y-reflow-column-styles') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
