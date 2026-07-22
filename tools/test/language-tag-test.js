// Language Tag — realistic jsdom tests for the foreign-script pronunciation
// aid. Asserts the user-facing outcome (CJK/Cyrillic/Arabic runs wrapped in
// lang-attributed spans, same-script text untouched, <html lang> best-guess)
// AND the reversibility contract every adapter must honor: enable() is
// idempotent, and disable() puts the exact original text nodes back and
// removes only the html lang it added.
//
// Run: node tools/test/language-tag-test.js
import { JSDOM } from 'jsdom';
import { LanguageTag } from '../adapters/language-tag.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML, htmlAttrs = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html${htmlAttrs}><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

async function run() {
  // An English page with an inline Chinese run and an inline Russian word;
  // the pure-English paragraph must stay byte-identical.
  {
    const doc = mount(`
      <main>
        <p id="mixed">Hello 世界 today</p>
        <p id="ru">The word Привет is Russian</p>
        <p id="plain">Just English text here</p>
      </main>`);
    const mixed = doc.querySelector('#mixed');
    const plain = doc.querySelector('#plain');
    const originalMixedNode = mixed.firstChild; // the one text node — must come back
    const originalPlainNode = plain.firstChild;
    const originalMixedText = mixed.textContent;

    LanguageTag.enable();
    const zh = doc.querySelector('#mixed span[lang="zh"]');
    check('lang-tag: the CJK run is wrapped in a lang="zh" span',
      zh !== null && zh.textContent === '世界');
    check('lang-tag: the zh span lives inside a marker wrapper',
      zh?.parentElement?.classList.contains('ai4a11y-lang') === true);
    check('lang-tag: English text in the mixed node is NOT inside any lang span',
      doc.querySelectorAll('#mixed [lang]').length === 1);
    check('lang-tag: visible text is unchanged', mixed.textContent === originalMixedText);
    const ru = doc.querySelector('#ru span[lang="ru"]');
    check('lang-tag: a Cyrillic run gets lang="ru"',
      ru !== null && ru.textContent === 'Привет');
    check('lang-tag: the pure-English paragraph is untouched',
      plain.firstChild === originalPlainNode && doc.querySelectorAll('#plain span').length === 0);
    check('lang-tag: <html> with no lang gets the main-script best guess',
      doc.documentElement.getAttribute('lang') === 'en');

    // disable() restores the page exactly — the very same text node, not a copy.
    LanguageTag.disable();
    check('lang-tag: disable leaves no lang spans or markers anywhere',
      doc.querySelectorAll('span[lang], .ai4a11y-lang').length === 0);
    check('lang-tag: disable puts the exact original text node back',
      mixed.firstChild === originalMixedNode && mixed.childNodes.length === 1 &&
      mixed.textContent === originalMixedText);
    check('lang-tag: disable removes the html lang it added',
      doc.documentElement.hasAttribute('lang') === false);
  }

  // A pre-existing <html lang> is never touched.
  {
    const doc = mount(`<main><p>Bonjour le monde 世界</p></main>`, ' lang="fr"');
    LanguageTag.enable();
    check('lang-tag: a pre-existing html lang is not clobbered',
      doc.documentElement.getAttribute('lang') === 'fr');
    LanguageTag.disable();
    check('lang-tag: a pre-existing html lang survives disable',
      doc.documentElement.getAttribute('lang') === 'fr');
  }

  // Idempotency and double-disable safety.
  {
    const doc = mount(`<main><p>The greeting مرحبا is Arabic</p></main>`);
    LanguageTag.enable();
    const spanCount = doc.querySelectorAll('span[lang]').length;
    check('lang-tag: an Arabic run gets lang="ar"',
      doc.querySelector('span[lang="ar"]')?.textContent === 'مرحبا');
    LanguageTag.enable(); // must be a no-op
    check('lang-tag: second enable is a no-op (no double-wrapping)',
      doc.querySelectorAll('span[lang]').length === spanCount &&
      doc.querySelectorAll('.ai4a11y-lang .ai4a11y-lang').length === 0);
    LanguageTag.disable();
    LanguageTag.disable(); // disabling twice is safe
    check('lang-tag: double disable is safe',
      LanguageTag.enabled === false && doc.querySelectorAll('span[lang]').length === 0);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
