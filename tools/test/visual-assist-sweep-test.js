// Visual Assist — the font sweep for content added after enable(). It used to
// re-scan the whole page on every change; with bionic-reading on, a store
// countdown ticking each second made it rescale every text element (and
// bionic-reading's word wrappers) every second. These check that it now looks
// at the added elements only, and leaves alone text changes and wrappers that
// take their parent's size.
//
// Run: node tools/test/visual-assist-sweep-test.js
import { JSDOM } from 'jsdom';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><main><p id="countdown">Ends in 04:59:59</p><p>Some text</p></main></body></html>', { url: 'https://example.com/' });
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = (el) => dom.window.getComputedStyle(el);
global.MutationObserver = dom.window.MutationObserver;
const doc = dom.window.document;

const { VisualAssist } = await import('../adapters/visual-assist.js');
const { registerSweep } = await import('../utils/observe.js');

// The shared observer hands each sweep the elements added since it last ran.
{
  const calls = [];
  const off = registerSweep('test-sweep', (info) => calls.push(info), { debounceMs: 50 });
  const a = doc.createElement('div');
  doc.querySelector('main').appendChild(a);
  doc.querySelector('#countdown').textContent = 'Ends in 04:59:58';
  await wait(120);
  check('observe: one sweep for the burst of changes', calls.length === 1);
  check('observe: it gets the added element, not the text', calls[0] && calls[0].added.length === 1 && calls[0].added[0] === a);
  off();
  a.remove();
}

// Visual assist sweeps only what was added.
{
  const seen = [];
  const apply = VisualAssist.applyFontScale.bind(VisualAssist);
  VisualAssist.applyFontScale = (scale, roots) => { seen.push(roots); return apply(scale, roots); };
  VisualAssist.enable({ fontScale: 1.25 });
  await wait(50);
  seen.length = 0;

  // A countdown rewriting its text adds no elements: no sweep work at all.
  doc.querySelector('#countdown').textContent = 'Ends in 04:59:57';
  await wait(700);
  check('sweep: a text-only change does not rescale anything', seen.length === 0);

  // A wrapper reset with `all: unset` (how bionic-reading wraps words) takes
  // its parent's size, so it is not rescaled either.
  const wrap = doc.createElement('span');
  wrap.className = 'ai4a11y-bionic';
  wrap.style.cssText = 'all: unset;';
  wrap.textContent = 'Ends in 04:59:56';
  doc.querySelector('#countdown').replaceChildren(wrap);
  await wait(700);
  check('sweep: an all-unset wrapper is left alone', seen.length === 0);

  // New content is looked at on its own, not the whole page.
  const card = doc.createElement('div');
  card.innerHTML = '<p>New result</p>';
  doc.querySelector('main').appendChild(card);
  await wait(700);
  check('sweep: added content is swept once', seen.length === 1);
  check('sweep: only the added content, not the whole page', seen[0] && seen[0].length === 1 && seen[0][0] === card);

  VisualAssist.disable();
  card.innerHTML = '<p>After disable</p>';
  await wait(700);
  check('sweep: nothing runs after disable()', seen.length === 1);
  VisualAssist.applyFontScale = apply;
}

console.log(`\nvisual-assist sweep: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
