// Abbreviation Expand — realistic jsdom tests for the dictionary-driven
// abbreviation marker. Asserts the user-facing outcome (known acronyms in
// prose become <abbr title="...">, existing bare <abbr>s gain a title,
// whole-word matching never fires inside longer words, pre-existing titles
// are never clobbered) AND the reversibility contract every adapter must
// honor: enable() is idempotent, and disable() puts the exact original text
// nodes back and removes only the titles we added.
//
// Run: node tools/test/abbreviation-expand-test.js
import { JSDOM } from 'jsdom';
import { AbbreviationExpand } from '../adapters/abbreviation-expand.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

async function run() {
  // A realistic page: prose with acronyms, a bare <abbr>, an <abbr> that
  // already carries its own title, and text that must stay untouched.
  {
    const doc = mount(`
      <p id="p1">The WCAG spec and the API docs.</p>
      <abbr id="a1">FBI</abbr>
      <abbr id="a2" title="Custom">API</abbr>
      <p id="plain">plain words only.</p>
      <p id="near">APIs and SCRAPI stay plain.</p>`);
    const p1 = doc.querySelector('#p1');
    const originalText = p1.textContent;
    const originalNode = p1.firstChild; // the one text node — must come back
    const plainNode = doc.querySelector('#plain').firstChild;

    AbbreviationExpand.enable();
    const abbrs = [...doc.querySelectorAll('#p1 abbr.ai4a11y-abbr')];
    check('abbr: wraps known acronyms in <abbr> with the correct expansions',
      abbrs.length === 2 &&
      abbrs.some((a) => a.textContent === 'WCAG' && a.getAttribute('title') === 'Web Content Accessibility Guidelines') &&
      abbrs.some((a) => a.textContent === 'API' && a.getAttribute('title') === 'Application Programming Interface'));
    check('abbr: wrapping preserves the visible text exactly', p1.textContent === originalText);
    check('abbr: existing bare <abbr> gets its title filled in',
      doc.querySelector('#a1').getAttribute('title') === 'Federal Bureau of Investigation');
    check('abbr: a pre-existing title is never clobbered',
      doc.querySelector('#a2').getAttribute('title') === 'Custom');
    check('abbr: text inside an existing <abbr> is not double-wrapped',
      doc.querySelectorAll('#a1 abbr, #a2 abbr').length === 0);
    check('abbr: a paragraph with no matches is left completely untouched',
      doc.querySelector('#plain').firstChild === plainNode &&
      doc.querySelectorAll('#plain abbr').length === 0);
    check('abbr: whole-word only — "APIs" and "SCRAPI" never match',
      doc.querySelectorAll('#near abbr').length === 0 &&
      doc.querySelector('#near').textContent === 'APIs and SCRAPI stay plain.');
    check('abbr: injects exactly one stylesheet',
      doc.querySelectorAll('#ai4a11y-abbr-styles').length === 1);

    // Idempotency: a second enable() must not double-wrap or re-title.
    AbbreviationExpand.enable();
    check('abbr: second enable is a no-op (no double-wrapping)',
      doc.querySelectorAll('.ai4a11y-abbr').length === 2 &&
      doc.querySelectorAll('.ai4a11y-abbr .ai4a11y-abbr').length === 0);

    // disable() restores the page exactly — the very same text node, not a copy.
    AbbreviationExpand.disable();
    check('abbr: disable puts the exact original text node back',
      doc.querySelectorAll('.ai4a11y-abbr, .ai4a11y-abbr-wrap').length === 0 &&
      p1.firstChild === originalNode && p1.childNodes.length === 1 &&
      p1.textContent === originalText);
    check('abbr: disable removes the title we added but keeps the custom one',
      doc.querySelector('#a1').hasAttribute('title') === false &&
      doc.querySelector('#a2').getAttribute('title') === 'Custom');
    check('abbr: disable removes the stylesheet',
      doc.getElementById('ai4a11y-abbr-styles') === null);
    AbbreviationExpand.disable(); // disabling twice is safe
    check('abbr: double disable is safe',
      AbbreviationExpand.enabled === false && doc.querySelectorAll('.ai4a11y-abbr').length === 0);
  }

  // options.dictionary merges over the defaults.
  {
    const doc = mount(`<main><p id="p2">HCI meets the API.</p></main>`);
    AbbreviationExpand.enable({ dictionary: { HCI: 'Human-Computer Interaction' } });
    const abbrs = [...doc.querySelectorAll('#p2 abbr.ai4a11y-abbr')];
    check('abbr: options.dictionary entries merge over the built-in defaults',
      abbrs.some((a) => a.textContent === 'HCI' && a.getAttribute('title') === 'Human-Computer Interaction') &&
      abbrs.some((a) => a.textContent === 'API' && a.getAttribute('title') === 'Application Programming Interface'));
    AbbreviationExpand.disable();
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
