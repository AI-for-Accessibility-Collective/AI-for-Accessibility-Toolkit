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
  // Output gate: a translated block replaces what the reader sees, so a
  // refusal, a fragment, or a non-string must leave the block untouched, the
  // same way a null answer does. A real translation still lands.
  {
    const PARA = 'Please read the documentation carefully before you install anything on the server.';
    const cases = [
      ['a first-person refusal', "I'm sorry, I cannot translate this text."],
      ['an empty string', ''],
      ['whitespace', '   \n'],
      ['a non-string', 42],
      ['a fragment (under a tenth of the source)', 'Sí.'],
      ['an answer over eight times the source', (PARA + ' ').repeat(9)],
    ];
    for (const [what, answer] of cases) {
      const doc = mount(`<main><p id="p">${PARA}</p></main>`);
      setAIProvider({ translateText: async () => answer, announce() {} });
      await TranslatePage.enable({ targetLang: 'Spanish' });
      check(`translate: ${what} leaves the block untouched`, doc.querySelector('#p').textContent === PARA);
      check(`translate: ${what} is not counted as translated`, TranslatePage.translated.size === 0);
      TranslatePage.disable();
      check(`translate: disable after ${what} is safe`, doc.querySelector('#p').textContent === PARA);
    }
    {
      const doc = mount(`<main><p id="p">${PARA}</p></main>`);
      const OUT = 'Unfortunately, the server is closed for maintenance until Tuesday morning.';
      setAIProvider({ translateText: async () => OUT, announce() {} });
      await TranslatePage.enable({ targetLang: 'English' });
      check('translate: a passage opening "Unfortunately, the ..." is content, not a refusal', doc.querySelector('#p').textContent === OUT);
      TranslatePage.disable();
    }
    {
      const doc = mount(`<main><p id="p">${PARA}</p></main>`);
      const SHORT = '安装前请仔细阅读服务器文档。'; // 14 chars against 82: 0.17, the shape of a real English-to-Chinese ratio
      setAIProvider({ translateText: async () => SHORT, announce() {} });
      await TranslatePage.enable({ targetLang: 'Chinese' });
      check('translate: a much shorter script (0.17 of the source) is accepted', doc.querySelector('#p').textContent === SHORT);
      TranslatePage.disable();
    }
    // A block of a few characters has no useful ratio: "目录" to "Table of
    // contents" is 8.5 times the source and a correct translation.
    for (const [src, out] of [['目录', 'Table of contents'], ['谢谢', 'Thank you very much']]) {
      const doc = mount(`<main><p id="p">${src}</p></main>`);
      setAIProvider({ translateText: async () => out, announce() {} });
      await TranslatePage.enable({ targetLang: 'English' });
      check(`translate: a short block "${src}" accepts a much longer translation`, doc.querySelector('#p').textContent === out);
      TranslatePage.disable();
    }
    {
      const doc = mount(`<main><p id="p">${PARA}</p></main>`);
      setAIProvider({ translateText: async () => (PARA + ' ').repeat(9), announce() {} });
      await TranslatePage.enable({ targetLang: 'Spanish' });
      check('translate: a paragraph that comes back nine times longer is still rejected', doc.querySelector('#p').textContent === PARA);
      TranslatePage.disable();
    }
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
