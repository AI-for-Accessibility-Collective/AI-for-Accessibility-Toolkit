// Describe on Demand — jsdom test with stub AI providers. Verifies the pick
// paths (Alt+D on the focused element, Alt+click), the routing (image → vision,
// text → summarize), the accessible panel + live region, and full reversal.
// Run: node tools/test/describe-on-demand-test.js
import { JSDOM } from 'jsdom';
import { setAIProvider } from '../utils/ai.js';
import { DescribeOnDemand } from '../adapters/describe-on-demand.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window; global.document = dom.window.document;
  return dom.window.document;
}
function stubAI() {
  const calls = { img: [], summarize: [] };
  setAIProvider({
    describeImage: async (src) => { calls.img.push(src); return 'a described image'; },
    summarizeText: async (t) => { calls.summarize.push(t); return 'a short summary'; },
    announce() {},
  });
  return calls;
}

async function run() {
  // Image path: Alt+click an <img> → vision describe → panel + live region.
  {
    const doc = mount('<img id="pic" src="https://cdn.example.com/cat.jpg" alt=""><p id="para">' + 'Some fairly long article text that should be summarized on demand. '.repeat(3) + '</p>');
    const calls = stubAI();
    DescribeOnDemand.enable();
    check('describe: enable creates a hidden live region', !!doc.getElementById('ai4a11y-describe-live'));

    const img = doc.getElementById('pic');
    img.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, altKey: true }));
    await tick(); await tick();
    check('describe: Alt+click an image calls vision with its src', calls.img.length === 1 && calls.img[0].includes('cat.jpg'));
    const panel = doc.getElementById('ai4a11y-describe-panel');
    check('describe: a description panel appears', !!panel && panel.style.display === 'block');
    check('describe: the description shows in the panel', panel.querySelector('.ai4a11y-describe-body').textContent === 'a described image');
    check('describe: the description is mirrored to the live region', doc.getElementById('ai4a11y-describe-live').textContent === 'a described image');

    // Text path: Alt+D on the focused paragraph → summarize.
    const para = doc.getElementById('para'); para.setAttribute('tabindex', '-1'); para.focus();
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'd', altKey: true }));
    await tick(); await tick();
    check('describe: Alt+D on a text element summarizes its content', calls.summarize.length === 1);
    check('describe: the summary shows in the panel', panel.querySelector('.ai4a11y-describe-body').textContent === 'a short summary');

    // Escape hides the panel.
    doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
    check('describe: Escape hides the panel', panel.style.display === 'none');

    DescribeOnDemand.disable();
    check('describe: disable removes the panel, live region, and style', !doc.getElementById('ai4a11y-describe-panel') && !doc.getElementById('ai4a11y-describe-live') && !doc.getElementById('ai4a11y-describe-styles'));

    // Listeners are gone: an Alt+click after disable does nothing.
    calls.img.length = 0;
    img.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, altKey: true }));
    await tick();
    check('describe: describe listeners are removed after disable', calls.img.length === 0);
  }

  // Idempotency + double-disable safety.
  {
    const doc = mount('<p>x</p>');
    stubAI();
    DescribeOnDemand.enable();
    DescribeOnDemand.enable();
    check('describe: idempotent enable (one live region)', doc.querySelectorAll('#ai4a11y-describe-live').length === 1);
    DescribeOnDemand.disable();
    DescribeOnDemand.disable();
    check('describe: double disable is safe', DescribeOnDemand.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
