// Sound Visualizer — jsdom tests for the sound-cue adapter. Asserts the
// user-facing outcome (unmuted media flashes the indicator, muted media does
// not) AND the reversibility contract: enable() is idempotent, and disable()
// removes the indicator, the document listeners, and the hide timer.
//
// Run: node tools/test/sound-visualizer-test.js
import { JSDOM } from 'jsdom';
import { SoundVisualizer } from '../adapters/sound-visualizer.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/watch' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  return window;
}

async function run() {
  const win = mount(`<video id="v" src="clip.mp4"></video><main><p>article content</p></main>`);
  const doc = win.document;
  const v = doc.querySelector('#v');
  // Pin the IDL states explicitly (the test must not depend on jsdom defaults).
  v.muted = false;
  v.volume = 1;

  const indicator = () => doc.querySelector('#ai4a11y-sound-indicator');

  SoundVisualizer.enable();
  check('sound: enable creates the indicator, hidden by default',
    indicator() !== null && indicator().style.display === 'none');
  check('sound: indicator is a polite live region',
    indicator().getAttribute('role') === 'status' && indicator().getAttribute('aria-live') === 'polite');

  // An unmuted video starts playing — the capture-phase document listener
  // catches the event and flashes the indicator.
  v.dispatchEvent(new win.Event('play', { bubbles: true }));
  check('sound: an unmuted video playing shows the indicator',
    indicator().style.display !== 'none' && indicator().textContent.includes('Sound'));

  // A muted video must NOT flash (reset the indicator hidden first).
  indicator().style.display = 'none';
  v.muted = true;
  v.dispatchEvent(new win.Event('play', { bubbles: true }));
  check('sound: a muted video does NOT show the indicator', indicator().style.display === 'none');

  // Idempotency: a second enable() must be a no-op (still one indicator).
  SoundVisualizer.enable();
  check('sound: second enable is a no-op (one indicator)',
    doc.querySelectorAll('#ai4a11y-sound-indicator').length === 1);

  // disable() removes the indicator AND the listeners: a later play event
  // must not recreate or show anything.
  SoundVisualizer.disable();
  check('sound: disable removes the indicator', indicator() === null);
  v.muted = false;
  v.dispatchEvent(new win.Event('play', { bubbles: true }));
  check('sound: after disable, play events do nothing (listeners removed)', indicator() === null);

  SoundVisualizer.disable(); // disabling twice is safe
  check('sound: double disable is safe', SoundVisualizer.enabled === false);

  // The flash auto-hides after its window; re-enable proves the adapter is
  // fully re-usable after a disable.
  SoundVisualizer.enable();
  v.dispatchEvent(new win.Event('play', { bubbles: true }));
  check('sound: re-enable after disable works (indicator flashes again)',
    indicator() !== null && indicator().style.display !== 'none');
  await new Promise(r => setTimeout(r, 1350));
  check('sound: indicator auto-hides after the flash window', indicator().style.display === 'none');
  SoundVisualizer.disable();
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
