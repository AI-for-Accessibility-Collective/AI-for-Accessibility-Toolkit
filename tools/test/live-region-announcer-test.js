// Live-Region Announcer — realistic jsdom tests. Verifies the announcer
// mirrors new main-content into its polite live region, never re-announces
// its own region (no feedback loop), and honors the reversibility contract:
// enable() is idempotent, disable() removes the region and stops the observer.
//
// Run: node tools/test/live-region-announcer-test.js
import { JSDOM } from 'jsdom';
import { LiveRegionAnnouncer } from '../adapters/live-region-announcer.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/app' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  return window.document;
}

async function run() {
  // An SPA-ish page with a <main>: enable, then simulate a results insert.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    const region = doc.querySelector('#ai4a11y-live-region');
    check('live-region: enable creates the hidden region', region !== null);
    check('live-region: region is polite', region && region.getAttribute('aria-live') === 'polite');

    const toast = doc.createElement('div');
    toast.textContent = 'New search results loaded';
    doc.querySelector('main').appendChild(toast);
    await wait(400);
    check('live-region: new main content is announced after the debounce',
      region.textContent.includes('New search results'));
    LiveRegionAnnouncer.disable();
  }

  // No <main> → the observer watches <body>, where our own region also lives.
  // A node inserted INTO the region must not be re-announced: if it were, the
  // mirrored write would clobber the previous announcement.
  {
    const doc = mount(`<div id="app"><p>hello world</p></div>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    const region = doc.querySelector('#ai4a11y-live-region');
    const note = doc.createElement('div');
    note.textContent = 'Status updated successfully';
    doc.querySelector('#app').appendChild(note);
    await wait(400);
    check('live-region: announces under the body observer', region.textContent.includes('Status updated'));

    const sentinel = doc.createElement('div');
    sentinel.textContent = 'FEEDBACK-SENTINEL';
    region.appendChild(sentinel);
    await wait(400);
    check('live-region: no feedback loop — a self-mutation does not clobber the prior announcement',
      region.textContent.includes('Status updated'));
    check('live-region: region stays bounded after self-mutation', region.textContent.length < 300);
    LiveRegionAnnouncer.disable();
  }

  // disable() removes the region and disconnects the observer.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    LiveRegionAnnouncer.disable();
    check('live-region: disable removes the region', doc.querySelector('#ai4a11y-live-region') === null);
    const late = doc.createElement('div');
    late.textContent = 'Inserted after disable';
    doc.querySelector('main').appendChild(late);
    await wait(400);
    check('live-region: observer is dead after disable (no region reappears)',
      doc.querySelector('#ai4a11y-live-region') === null);
  }

  // Idempotency: enabling twice must not double-inject; disabling twice is safe.
  {
    const doc = mount(`<main><p>start</p></main>`);
    LiveRegionAnnouncer.enable({ debounceMs: 50 });
    LiveRegionAnnouncer.enable(); // must be a no-op
    check('live-region: second enable is a no-op (one region)',
      doc.querySelectorAll('#ai4a11y-live-region').length === 1);
    LiveRegionAnnouncer.disable();
    LiveRegionAnnouncer.disable(); // disabling twice is safe
    check('live-region: double disable is safe', LiveRegionAnnouncer.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
