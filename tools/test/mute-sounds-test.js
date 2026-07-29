// Mute Sounds — jsdom tests for the quiet-page adapter. Asserts the
// user-facing outcome AND the reversibility contract: only media WE muted is
// un-muted on disable — media the user had already muted stays muted.
//
// Run: node tools/test/mute-sounds-test.js
import { JSDOM } from 'jsdom';
import { MuteSounds } from '../adapters/mute-sounds.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const tick = () => new Promise(r => setTimeout(r, 0));

function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/article' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.MutationObserver = window.MutationObserver;
  return window.document;
}

async function run() {
  // A page with two unmuted players and one the user muted themselves.
  const doc = mount(`
    <video id="v1" src="clip.mp4"></video>
    <audio id="a1" src="song.mp3"></audio>
    <video id="pre" src="bg.mp4" muted></video>
    <main><p>article content</p></main>`);
  const v1 = doc.querySelector('#v1');
  const a1 = doc.querySelector('#a1');
  const pre = doc.querySelector('#pre');
  // Pin the IDL states explicitly (jsdom initializes `muted` from the content
  // attribute, but the test must not depend on that).
  v1.muted = false;
  a1.muted = false;
  pre.muted = true;

  MuteSounds.enable();
  check('mute-sounds: enable mutes an unmuted <video>', v1.muted === true);
  check('mute-sounds: enable mutes an unmuted <audio>', a1.muted === true);
  check('mute-sounds: leaves user-muted media muted', pre.muted === true);
  check('mute-sounds: user-muted media is NOT tracked for restore', MuteSounds.muted.has(pre) === false);

  // Media injected after enable (players usually are) is muted by the observer.
  const late = doc.createElement('video');
  late.src = 'late.mp4';
  late.muted = false;
  doc.body.appendChild(late);
  await tick();
  check('mute-sounds: mutes a <video> added after enable (observer)', late.muted === true);

  // A script un-mutes a player and starts it — the play listener re-mutes it.
  v1.muted = false;
  v1.dispatchEvent(new doc.defaultView.Event('play'));
  check('mute-sounds: re-mutes media that tries to play with sound', v1.muted === true);

  // Idempotency: a second enable() must be a no-op (same tracked set, no throw).
  const trackedBefore = MuteSounds.muted.size;
  MuteSounds.enable();
  check('mute-sounds: second enable is a no-op', MuteSounds.enabled === true && MuteSounds.muted.size === trackedBefore);

  // disable() unmutes exactly what we muted — and nothing else.
  MuteSounds.disable();
  check('mute-sounds: disable unmutes the <video> we muted', v1.muted === false);
  check('mute-sounds: disable unmutes the <audio> we muted', a1.muted === false);
  check('mute-sounds: disable unmutes the late-added <video>', late.muted === false);
  check('mute-sounds: disable never un-mutes media the user muted', pre.muted === true);

  MuteSounds.disable(); // disabling twice is safe
  check('mute-sounds: double disable is safe', MuteSounds.enabled === false);

  // The observer and play listener are gone: new media stays as-is.
  const after = doc.createElement('video');
  after.muted = false;
  doc.body.appendChild(after);
  await tick();
  check('mute-sounds: observer stops after disable', after.muted === false);
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error('ERROR', e); process.exit(1); });
