// Flash Guard — realistic jsdom tests for the seizure-safety adapter.
// Asserts the user-facing outcome (videos paused + de-autoplayed, media
// dimmed, late-injected videos caught) AND the reversibility contract:
// enable() is idempotent, and disable() restores autoplay/playback exactly.
//
// Run: node tools/test/flash-guard-test.js
import { JSDOM } from 'jsdom';
import { FlashGuard } from '../adapters/flash-guard.js';

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

// jsdom's HTMLMediaElement has no real playback; stub just enough to observe
// pause/play calls and simulate a video that is autoplaying.
function stubPlayback(video) {
  video.pause = function () { this._paused = true; };
  Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true });
  video.play = function () { this._paused = false; return Promise.resolve(); };
}

async function run() {
  // An autoplaying video (the flash source) next to a canvas (dim target).
  {
    const doc = mount(`<video id="v" autoplay></video><canvas></canvas><main><p>article</p></main>`);
    const v = doc.querySelector('#v');
    stubPlayback(v);

    FlashGuard.enable();
    check('flash-guard: enable pauses the autoplaying video', v._paused === true);
    check('flash-guard: enable strips the autoplay attribute', v.hasAttribute('autoplay') === false);
    check('flash-guard: injects exactly one dimming stylesheet', doc.querySelectorAll('#ai4a11y-flash-guard-styles').length === 1);
    const css = doc.querySelector('#ai4a11y-flash-guard-styles').textContent;
    check('flash-guard: stylesheet dims brightness on video surfaces', css.includes('brightness(') && css.includes('video'));

    // A video injected after enable (lazy-loaded player) is caught by the
    // observer and gets the same treatment.
    const late = doc.createElement('video');
    late.setAttribute('autoplay', '');
    stubPlayback(late);
    doc.body.appendChild(late);
    await tick();
    check('flash-guard: pauses a video injected after enable (observer)', late._paused === true);
    check('flash-guard: de-autoplays a video injected after enable', late.hasAttribute('autoplay') === false);

    // disable() restores the page exactly.
    FlashGuard.disable();
    check('flash-guard: disable removes the dimming stylesheet', doc.querySelector('#ai4a11y-flash-guard-styles') === null);
    check('flash-guard: disable restores the autoplay attribute', v.hasAttribute('autoplay') === true);
    check('flash-guard: disable resumes a video that was playing', v._paused === false);
  }

  // Idempotency: a second enable() must not double-apply, double-track, or throw.
  {
    const doc = mount(`<video id="v" autoplay></video>`);
    stubPlayback(doc.querySelector('#v'));
    FlashGuard.enable();
    FlashGuard.enable(); // must be a no-op
    check('flash-guard: second enable is a no-op (still one stylesheet)', doc.querySelectorAll('#ai4a11y-flash-guard-styles').length === 1);
    check('flash-guard: second enable does not double-track the video', FlashGuard.tracked.size === 1);
    FlashGuard.disable();
    FlashGuard.disable(); // disabling twice is safe
    check('flash-guard: double disable is safe', FlashGuard.enabled === false);
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
