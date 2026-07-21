// Link Highlighter — realistic jsdom tests for the destination-reveal adapter.
// Asserts the user-facing outcome (links styled, destination hosts revealed)
// AND the reversibility contract: enable() is idempotent, page-set titles are
// never overwritten, and disable() restores the page exactly (no leftover
// class, stylesheet, titles, or observers).
//
// Run: node tools/test/link-highlighter-test.js
import { JSDOM } from 'jsdom';
import { LinkHighlighter } from '../adapters/link-highlighter.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const tick = () => new Promise(r => setTimeout(r, 0));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  global.requestIdleCallback = undefined;
  return window.document;
}

async function run() {
  // A page with the "click here" problem: an ambiguous external link with no
  // title, a link the page already described, a relative link, a same-page
  // jump, and a mailto (the last two have no destination host to reveal).
  {
    const doc = mount(`
      <p><a id="plain" href="https://docs.other.com/x">read more</a></p>
      <p><a id="described" href="https://foo.com/pricing" title="Pricing details">click here</a></p>
      <p><a id="relative" href="/about">about us</a></p>
      <p><a id="fragment" href="#top">back to top</a></p>
      <p><a id="mail" href="mailto:someone@foo.com">email us</a></p>`);

    LinkHighlighter.enable();
    check('links: enable adds the body class', doc.body.classList.contains('ai4a11y-highlight-links'));
    check('links: injects exactly one stylesheet', doc.querySelectorAll('#ai4a11y-link-highlighter-styles').length === 1);
    check('links: reveals the destination host of an untitled link', (doc.querySelector('#plain').getAttribute('title') || '').includes('docs.other.com'));
    check('links: marks the links it titled with the data attribute', doc.querySelector('#plain').hasAttribute('data-ai4a11y-linkhl'));
    check('links: never overwrites a title the page already set', doc.querySelector('#described').getAttribute('title') === 'Pricing details');
    check('links: resolves a relative link against the page origin', doc.querySelector('#relative').getAttribute('title') === 'example.com');
    check('links: skips same-page and mailto links (no host to reveal)', !doc.querySelector('#fragment').hasAttribute('title') && !doc.querySelector('#mail').hasAttribute('title'));

    LinkHighlighter.enable(); // must be a no-op
    check('links: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-link-highlighter-styles').length === 1);

    // disable() restores the page exactly.
    LinkHighlighter.disable();
    check('links: disable removes the body class', !doc.body.classList.contains('ai4a11y-highlight-links'));
    check('links: disable removes the injected stylesheet', doc.querySelector('#ai4a11y-link-highlighter-styles') === null);
    check('links: disable removes only the titles WE added', !doc.querySelector('#plain').hasAttribute('title') && !doc.querySelector('#plain').hasAttribute('data-ai4a11y-linkhl') && doc.querySelector('#described').getAttribute('title') === 'Pricing details');
  }

  // A link added after enable (infinite feed, client-side routing) is titled
  // by the MutationObserver — and no longer titled once disabled.
  {
    const doc = mount(`<main><p>content</p></main>`);
    LinkHighlighter.enable();
    const late = doc.createElement('a');
    late.setAttribute('href', 'https://late.example.net/p');
    late.textContent = 'read more';
    doc.body.appendChild(late);
    await tick();
    check('links: titles a link added after enable (observer)', (late.getAttribute('title') || '').includes('late.example.net'));
    LinkHighlighter.disable();
    const after = doc.createElement('a');
    after.setAttribute('href', 'https://after.example.net/q');
    doc.body.appendChild(after);
    await tick();
    check('links: observer stops after disable', !after.hasAttribute('title'));
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
