// Stop Auto-Advance — realistic jsdom tests for the WCAG 2.2.2 adapter that
// halts auto-advancing content. Asserts the user-facing outcome AND the
// reversibility contract: enable() is idempotent, and disable() restores the
// page exactly (meta refresh re-inserted where it was, style removed, only
// the media we paused resumed, observer disconnected).
//
// Run: node tools/test/stop-auto-advance-test.js
import { JSDOM } from 'jsdom';
import { StopAutoAdvance } from '../adapters/stop-auto-advance.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const tick = () => new Promise(r => setTimeout(r, 0));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.MutationObserver = window.MutationObserver;
  return window.document;
}

// jsdom media elements don't really play; stub the playback surface so we
// can assert the adapter CALLED pause()/play() on a "playing" element.
function setPlaying(el) {
  Object.defineProperty(el, 'paused', { value: false, writable: true, configurable: true });
  el.pause = function () { this._paused = true; };
  el.play = function () { this._paused = false; };
}

async function run() {
  // A page with everything that auto-advances: a meta refresh, a CSS
  // carousel, a playing video, and a marquee.
  const doc = mount(`
    <div id="holder"><meta http-equiv="refresh" content="5"></div>
    <div class="carousel"><div>slide</div></div>
    <video id="v"></video>
    <marquee id="m">breaking news</marquee>
    <main><p>The article the reader came for.</p></main>`);
  const v = doc.getElementById('v');
  setPlaying(v);
  const m = doc.getElementById('m');
  m.stop = function () { this._stopped = true; };
  m.start = function () { this._stopped = false; };

  StopAutoAdvance.enable();
  check('enable removes the meta refresh', doc.querySelector('meta[http-equiv]') === null);
  const styles = doc.querySelectorAll('#ai4a11y-stop-autoadvance-styles');
  check('enable injects exactly one stylesheet', styles.length === 1);
  check('the rule pauses carousel animations',
    styles[0].textContent.includes('animation-play-state') && styles[0].textContent.includes('carousel'));
  check('a playing video is paused', v._paused === true);
  check('a marquee is stopped', m._stopped === true);

  // Idempotency: a second enable() must be a no-op.
  StopAutoAdvance.enable();
  check('second enable is a no-op (still one stylesheet)',
    doc.querySelectorAll('#ai4a11y-stop-autoadvance-styles').length === 1);

  // A video added while enabled and already playing is caught by the observer.
  const late = doc.createElement('video');
  setPlaying(late);
  doc.body.appendChild(late);
  await tick();
  check('a playing video added after enable is paused (observer)', late._paused === true);

  // disable() restores the page exactly.
  StopAutoAdvance.disable();
  check('disable re-inserts the meta refresh into its original parent',
    doc.querySelector('#holder meta[http-equiv="refresh"]') !== null);
  check('the meta was not double-processed (exactly one after enable/enable/disable)',
    doc.querySelectorAll('meta[http-equiv]').length === 1);
  check('disable removes the injected stylesheet',
    doc.querySelector('#ai4a11y-stop-autoadvance-styles') === null);
  check('disable resumes the video it paused', v._paused === false);
  check('disable restarts the marquee it stopped', m._stopped === false);

  // Observer stops after disable: a new playing video is left alone.
  const after = doc.createElement('video');
  setPlaying(after);
  doc.body.appendChild(after);
  await tick();
  check('observer stops after disable (new video untouched)', after._paused !== true);

  StopAutoAdvance.disable(); // disabling twice is safe
  check('double disable is safe', StopAutoAdvance.enabled === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
