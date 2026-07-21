// Shared adapter primitives — unit tests for the composable building blocks
// in tools/adapters/_primitives.js. Run: node tools/test/primitives-test.js
import { JSDOM } from 'jsdom';
import { injectStyle, observeAdded, transformTextNodes, mainRoot } from '../adapters/_primitives.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window; global.document = dom.window.document; global.MutationObserver = dom.window.MutationObserver;
  return dom.window.document;
}

async function run() {
  // ── injectStyle ─────────────────────────────────────────────────────────────
  {
    const doc = mount('<p>x</p>');
    const h = injectStyle('t-style', '.a{color:red}', doc);
    check('injectStyle: creates one style with the css', doc.querySelectorAll('#t-style').length === 1 && doc.getElementById('t-style').textContent.includes('color:red'));
    injectStyle('t-style', '.b{color:blue}', doc);
    check('injectStyle: re-injecting replaces (still one, new css)', doc.querySelectorAll('#t-style').length === 1 && doc.getElementById('t-style').textContent.includes('blue'));
    h.remove();
    check('injectStyle: remove() deletes the style', doc.getElementById('t-style') === null);
  }

  // ── observeAdded ────────────────────────────────────────────────────────────
  {
    const doc = mount('<div id="root"></div>');
    const seen = [];
    const h = observeAdded(doc.getElementById('root'), (el) => seen.push(el.className));
    const d = doc.createElement('div'); d.className = 'late'; doc.getElementById('root').appendChild(d);
    await tick();
    check('observeAdded: fires for a node added after observing', seen.includes('late'));
    h.disconnect();
    const d2 = doc.createElement('div'); d2.className = 'after'; doc.getElementById('root').appendChild(d2);
    await tick();
    check('observeAdded: stops after disconnect', !seen.includes('after'));
  }

  // ── transformTextNodes (the reversible engine) ──────────────────────────────
  {
    const doc = mount('<main><p id="p">Hello <a id="lnk" href="/x">world</a> now</p><code>skip me</code></main>');
    const before = doc.querySelector('#p').textContent;
    const handle = transformTextNodes(doc.querySelector('main'), (text) => {
      const s = doc.createElement('span'); s.className = 'tt'; s.textContent = text.toUpperCase(); return s;
    });
    check('transform: paragraph text is transformed (uppercased)', doc.querySelector('#p').textContent.includes('HELLO'));
    check('transform: the inline link ELEMENT is preserved', !!doc.querySelector('#lnk') && doc.querySelector('#lnk').getAttribute('href') === '/x');
    check('transform: text inside <code> is skipped', doc.querySelector('code').textContent === 'skip me');
    check('transform: reports how many nodes it wrapped', handle.records.length >= 2);

    handle.restore();
    check('transform: restore() puts the exact original text back', doc.querySelector('#p').textContent === before);
    check('transform: restore leaves no wrapper spans', doc.querySelectorAll('.tt').length === 0);
    check('transform: the link survives the round-trip intact', doc.querySelector('#lnk')?.textContent === 'world');
  }

  // ── transformTextNodes cap ──────────────────────────────────────────────────
  {
    const doc = mount('<main>' + Array.from({ length: 6 }, (_, i) => `<p>word${i}</p>`).join('') + '</main>');
    const handle = transformTextNodes(doc.querySelector('main'), (t) => { const s = doc.createElement('span'); s.textContent = t; return s; }, { cap: 3 });
    check('transform: honors the cap', handle.records.length === 3 && handle.capped === true);
    handle.restore();
  }

  // ── mainRoot ────────────────────────────────────────────────────────────────
  {
    const doc = mount('<nav>n</nav><main id="m"><p>c</p></main>');
    check('mainRoot: returns the <main> region', mainRoot(doc) === doc.querySelector('#m'));
    const doc2 = mount('<div><p>only body</p></div>');
    check('mainRoot: falls back to <body> when no main', mainRoot(doc2) === doc2.body);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
