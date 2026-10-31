// Dismiss Overlays — jsdom tests. Asserts what the person gets (a blocking pop-up is hidden, an
// ordinary element isn't, one added later is caught even when it's nested) AND that the work stays
// proportional to the page: a check that looked inside every element again from each of its
// children doubled the work at each level and froze the tab on deep pages like Amazon and GitHub.
//
// Run: node tools/test/dismiss-overlays-test.js
import { JSDOM } from 'jsdom';
import { DismissOverlays } from '../adapters/dismiss-overlays.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHTML}</body></html>`, { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  return window.document;
}

async function run() {
  // A pop-up is hidden, an ordinary element with a similar name isn't, and disable() undoes it.
  {
    const doc = mount(`
      <div id="cookie-banner" style="position: fixed">Accept cookies</div>
      <div id="newsletter-teaser">An inline card that stays</div>
      <main><p>The article</p></main>`);
    DismissOverlays.enable();
    const banner = doc.getElementById('cookie-banner');
    check('hides a fixed cookie banner', banner.classList.contains(DismissOverlays.hiddenClass));
    check('leaves an element that only shares the name', !doc.getElementById('newsletter-teaser').classList.contains(DismissOverlays.hiddenClass));
    DismissOverlays.disable();
    check('disable() shows the banner again', !banner.classList.contains(DismissOverlays.hiddenClass));
  }

  // A deep page: each element is looked at once. Before, this took 2 to the power of the depth.
  {
    const DEPTH = 12;
    mount('<div>'.repeat(DEPTH) + 'text' + '</div>'.repeat(DEPTH));
    const real = DismissOverlays.isOverlay;
    let looks = 0;
    DismissOverlays.isOverlay = function (el) { looks++; return real.call(this, el); };
    DismissOverlays.enable();
    DismissOverlays.isOverlay = real;
    DismissOverlays.disable();
    check(`looks at each of ${DEPTH} nested elements once (looked ${looks} times)`, looks === DEPTH);
  }

  // An overlay added later, inside a wrapper, and one nested deeper in a page that's already there.
  {
    const doc = mount('<main><p>The article</p></main>');
    DismissOverlays.enable();
    const wrap = doc.createElement('div');
    wrap.innerHTML = '<div><section id="gdpr-popup" style="position: fixed">Consent</section></div>';
    doc.body.appendChild(wrap);
    await new Promise((done) => setTimeout(done, 0));
    check('catches a pop-up added later inside a wrapper', doc.getElementById('gdpr-popup').classList.contains(DismissOverlays.hiddenClass));
    DismissOverlays.disable();
  }
  {
    const doc = mount('<div><div><div id="promo-lightbox" style="position: fixed">Offer</div></div></div>');
    DismissOverlays.enable();
    check('finds a pop-up nested in the page at the start', doc.getElementById('promo-lightbox').classList.contains(DismissOverlays.hiddenClass));
    check('counts it once', DismissOverlays.hidden.size === 1);
    DismissOverlays.disable();
  }

  console.log(`dismiss-overlays: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
