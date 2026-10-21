// Live-Region Announcer — realistic jsdom tests. Verifies the announcer reads
// out what the page adds in answer to the person through announce() (the
// host's one live region), ignores what loads on its own and what other
// adapters add, skips tickers, and honors the reversibility contract:
// enable() is idempotent, disable() stops the observer and adds nothing.
//
// Run: node tools/test/live-region-announcer-test.js
import { JSDOM } from 'jsdom';
import { LiveRegionAnnouncer } from '../adapters/live-region-announcer.js';
import { setAIProvider } from '../utils/ai.js';

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let said = [];
setAIProvider({ announce: (m) => said.push(m) });

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/app' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  said = [];
  return window.document;
}
// The person clicks somewhere: what the page adds next is its answer.
const act = (doc) => doc.body.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
const updates = () => said.filter((m) => !/announcing page updates/i.test(m));

async function run() {
  // A click that makes the page add a toast: it is read out, once, through announce().
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    check('live-region: enable says it is on', said.includes('Announcing page updates'));
    check('live-region: no live region of its own (one voice: announce())', doc.querySelectorAll('[aria-live]').length === 0);

    act(doc);
    const toast = doc.createElement('div');
    toast.textContent = 'New search results loaded';
    doc.body.appendChild(toast);
    await wait(200);
    check('live-region: a toast added after a click is announced', updates().length === 1 && updates()[0].includes('New search results'), said);
    LiveRegionAnnouncer.disable();
  }

  // What loads on its own, and what other adapters add, is not an update.
  {
    const doc = mount(`<div id="app"><p>hello world</p></div>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    const late = doc.createElement('div');
    late.textContent = 'A section that rendered after load';
    doc.querySelector('#app').appendChild(late);
    await wait(200);
    check('live-region: content added with no action is not announced', updates().length === 0, said);

    act(doc);
    const skip = doc.createElement('div');
    skip.id = 'ai4a11y-skip-links';
    skip.innerHTML = '<a href="#main">Skip to main content</a>';
    doc.body.insertBefore(skip, doc.body.firstChild);
    const note = doc.createElement('span');
    note.className = 'ws-calm-note';
    note.textContent = 'This countdown starts over on every visit';
    doc.querySelector('#app').appendChild(note);
    await wait(200);
    check("live-region: another adapter's elements are never announced", updates().length === 0, said);
    LiveRegionAnnouncer.disable();
  }

  // An error box the page fills on a timer still counts; a ticker never does.
  {
    const doc = mount(`<main><p id="pay-error" class="error-box"></p><span id="clock">10</span></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    doc.getElementById('pay-error').textContent = 'Your cart hold ran out.';
    await wait(1500);
    check('live-region: an error message is announced without a click', updates().some((m) => m.includes('cart hold ran out')), said);

    said = [];
    act(doc);
    const clock = doc.getElementById('clock');
    for (let i = 9; i >= 6; i--) { clock.textContent = `0:0${i} left`; await wait(400); }
    await wait(1500);
    check('live-region: text that changes every few hundred ms (a countdown) is not read', updates().length === 0, said);
    LiveRegionAnnouncer.disable();
  }

  // Pressing + three times quickly: not a ticker; the value it settles on is read.
  {
    const doc = mount(`<main><output id="qty">1</output></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    const qty = doc.getElementById('qty');
    for (const v of ['2', '3', '4']) { act(doc); qty.textContent = v; await wait(150); }
    await wait(1500);
    check('live-region: quick presses read the final value once', updates().length === 1 && updates()[0] === '4', said);
    said = [];
    act(doc); qty.textContent = '3';
    await wait(1500);
    check('live-region: and the next press is still read', updates()[0] === '3', said);
    LiveRegionAnnouncer.disable();
  }

  // A new panel is read briefly: its own links and buttons are left out.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    act(doc);
    const panel = doc.createElement('div');
    panel.innerHTML = '<p>Added to cart</p><a href="/checkout">Proceed to checkout</a><button>Close</button>';
    doc.body.appendChild(panel);
    await wait(200);
    const msg = updates()[0] || '';
    check('live-region: a panel is announced by what happened', msg.startsWith('Added to cart'), said);
    check('live-region: and stays short', msg.length <= 150, msg);
    LiveRegionAnnouncer.disable();
  }

  // disable() stops the observer; nothing is announced afterwards.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    LiveRegionAnnouncer.disable();
    check('live-region: disable says it stopped', said.includes('Stopped announcing page updates'));
    said = [];
    act(doc);
    const late = doc.createElement('div');
    late.textContent = 'Inserted after disable';
    doc.querySelector('main').appendChild(late);
    await wait(200);
    check('live-region: observer is dead after disable', said.length === 0, said);
  }

  // Idempotency: enabling twice must not double up; disabling twice is safe.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    LiveRegionAnnouncer.enable(); // must be a no-op
    act(doc);
    const toast = doc.createElement('div');
    toast.textContent = 'Saved to your list';
    doc.querySelector('main').appendChild(toast);
    await wait(200);
    check('live-region: second enable is a no-op (announced once)', updates().length === 1, said);
    LiveRegionAnnouncer.disable();
    LiveRegionAnnouncer.disable(); // disabling twice is safe
    check('live-region: double disable is safe', LiveRegionAnnouncer.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
