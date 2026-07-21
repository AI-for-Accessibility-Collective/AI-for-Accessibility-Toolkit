// Translate Page — jsdom test with a fake AI provider. Verifies the block
// selection, the AI call, and the LOSSLESS reversibility contract: a paragraph
// with an inline link is translated to flat text, but disable() re-attaches the
// exact original child nodes (the link element survives).
// Run: node tools/test/translate-page-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { TranslatePage } from '../adapters/translate-page.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom.window.document;
}

// Fake provider: prefixes text with the target language, records calls.
function fakeTranslator() {
  const calls = [];
  setAIProvider({
    translateText: async (text, lang) => { calls.push({ text, lang }); return `[${lang}] ${text}`; },
    announce() {},
  });
  return calls;
}

async function run() {
  // A page with a paragraph that contains an inline link, a heading, a <code>
  // block (must be skipped), and an empty paragraph (skipped).
  {
    const doc = mount(`
      <main>
        <h1>Hello world</h1>
        <p id="p1">Please read the <a id="lnk" href="/x">documentation</a> carefully.</p>
        <p id="code">Run <code>npm test</code> now.</p>
        <p id="empty">   </p>
      </main>`);
    const calls = fakeTranslator();

    await TranslatePage.enable({ targetLang: 'Spanish' });
    check('translate: the heading text is translated', doc.querySelector('h1').textContent.startsWith('[Spanish] Hello world'));
    check('translate: the paragraph text is translated', doc.querySelector('#p1').textContent.startsWith('[Spanish] '));
    check('translate: an empty block is skipped', !calls.some(c => c.text.trim() === ''));
    check('translate: text inside <code> is not sent as its own block', !calls.some(c => c.text === 'npm test'));
    check('translate: the AI was called with the target language', calls.length > 0 && calls.every(c => c.lang === 'Spanish'));

    // Reversibility: the inline link element must come back intact.
    TranslatePage.disable();
    check('translate: disable restores the original paragraph text', doc.querySelector('#p1').textContent.includes('Please read the'));
    const link = doc.querySelector('#lnk');
    check('translate: the inline link ELEMENT survives the round-trip', !!link && link.getAttribute('href') === '/x' && link.textContent === 'documentation');
    check('translate: no translated text remains after disable', !doc.querySelector('main').textContent.includes('[Spanish]'));
  }

  // Idempotency + graceful no-provider behavior.
  {
    const doc = mount(`<main><p>One two three.</p></main>`);
    setAIProvider({ translateText: async () => null, announce() {} }); // provider returns nothing
    await TranslatePage.enable({ targetLang: 'French' });
    check('translate: a null-returning provider leaves text unchanged', doc.querySelector('p').textContent === 'One two three.');
    TranslatePage.disable();
    check('translate: disable after a no-op is safe', TranslatePage.enabled === false);

    fakeTranslator();
    await TranslatePage.enable({ targetLang: 'German' });
    const once = doc.querySelector('p').textContent;
    await TranslatePage.enable({ targetLang: 'German' }); // second enable is a no-op
    check('translate: second enable is a no-op (no double translation)', doc.querySelector('p').textContent === once);
    TranslatePage.disable();
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
