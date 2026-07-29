// Define Words adapter — realistic jsdom test with a fake AI provider.
// Asserts the user-facing outcome (long words become focusable define-spans
// whose hover/focus shows an AI definition in a tooltip, cached after the
// first fetch) AND the reversibility contract: enable() is idempotent, and
// disable() restores the page exactly (original text nodes, no tooltip, no
// injected styles).
//
// Run: node tools/test/define-words-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { DefineWords } from '../adapters/define-words.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const tick = () => new Promise(r => setTimeout(r, 10));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  return window.document;
}

async function run() {
  const calls = [];
  setAIProvider({
    defineWord: async (w, ctx) => { calls.push({ w, ctx }); return 'a simple meaning'; },
    announce() {},
  });

  const doc = mount(`
    <main>
      <p id="p1">An extraordinary tale of two tiny cats.</p>
      <p id="p2">Try the <code>longwordinside</code> API and this <a href="/x">linktext</a> now.</p>
    </main>`);
  const originalText = doc.querySelector('#p1').textContent;

  DefineWords.enable();
  const spans = [...doc.querySelectorAll('.ai4a11y-define')];
  check('wraps the long word (and only it) in a define-span',
    spans.length === 1 && spans[0].textContent === 'extraordinary');
  check('wrapping preserves the visible text exactly',
    doc.querySelector('#p1').textContent === originalText);
  check('words inside <code> and <a> are never wrapped',
    doc.querySelector('code').querySelector('.ai4a11y-define') === null &&
    doc.querySelector('a').querySelector('.ai4a11y-define') === null &&
    doc.querySelector('code').textContent === 'longwordinside' &&
    doc.querySelector('a').textContent === 'linktext');
  check('define-span is keyboard-reachable and labeled',
    spans[0].getAttribute('tabindex') === '0' &&
    spans[0].getAttribute('role') === 'button' &&
    spans[0].getAttribute('aria-label') === 'Define extraordinary');
  check('injects exactly one stylesheet',
    doc.querySelectorAll('#ai4a11y-define-styles').length === 1);

  // Hover fetches the definition and shows it in the tooltip.
  const span = spans[0];
  span.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await tick();
  const tip = doc.getElementById('ai4a11y-define-tooltip');
  check('hover calls defineWord with the word and its sentence context',
    calls.length === 1 && calls[0].w === 'extraordinary' &&
    typeof calls[0].ctx === 'string' && calls[0].ctx.includes('tale of two tiny cats'));
  check('tooltip shows the returned definition',
    tip !== null && tip.textContent === 'a simple meaning' && tip.style.display === 'block');

  span.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  check('mouseout hides the tooltip', tip.style.display === 'none');

  // A second trigger is served from the cache (no second AI call). Use
  // focusin here so the keyboard path is exercised too.
  span.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  await tick();
  check('second trigger (focusin) uses the cache and re-shows the tooltip',
    calls.length === 1 && tip.style.display === 'block');

  // Idempotency: a second enable() must not double-wrap or re-inject.
  DefineWords.enable();
  check('second enable is a no-op',
    doc.querySelectorAll('.ai4a11y-define').length === 1 &&
    doc.querySelectorAll('#ai4a11y-define-styles').length === 1);

  // disable() restores the page exactly.
  DefineWords.disable();
  check('disable restores the original text nodes (no spans left)',
    doc.querySelectorAll('.ai4a11y-define, .ai4a11y-define-wrap').length === 0 &&
    doc.querySelector('#p1').textContent === originalText);
  check('disable removes the tooltip and the stylesheet',
    doc.getElementById('ai4a11y-define-tooltip') === null &&
    doc.getElementById('ai4a11y-define-styles') === null);
  check('hover after disable never calls the provider', (() => {
    // The restored #p1 has no spans, but dispatch on the paragraph anyway to
    // prove the delegated listeners are gone.
    doc.querySelector('#p1').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    return calls.length === 1;
  })());
  DefineWords.disable();
  check('double disable is safe', DefineWords.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
