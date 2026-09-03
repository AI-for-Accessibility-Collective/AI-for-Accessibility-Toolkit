// Show Captions — jsdom tests for the "turn on captions that already exist"
// adapter. Asserts the user-facing outcome (the right native track switches to
// showing / the player CC button is clicked) AND the two behaviours that matter
// for this audience: re-apply on new media, and never fight a user who turned
// captions off. Also checks the reversibility contract (disable restores modes).
//
// jsdom does not populate video.textTracks from <track> elements, so each video
// gets a mocked textTracks list — the adapter only reads {kind, language, mode}.
//
// Run: node tools/test/show-captions-test.js
import { JSDOM } from 'jsdom';
import { ShowCaptions } from '../adapters/show-captions.js';
import { _resetForTest } from '../utils/observe.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(bodyHTML, url = 'https://example.com/watch') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.MutationObserver = dom.window.MutationObserver;
  // navigator is a read-only global in modern Node; its language is 'en-US',
  // which is what these tests assume for the language-preference check.
  _resetForTest();
  return dom.window.document;
}

// Attach a mock TextTrackList to a <video>. tracks: [{kind, language, mode}].
function withTracks(video, tracks) {
  Object.defineProperty(video, 'textTracks', { value: tracks, configurable: true });
  return video;
}

async function run() {
  // ── native <video> text tracks ───────────────────────────────────────────
  {
    const doc = mount('<video id="v"></video><video id="w"></video>');
    const v = doc.getElementById('v');
    const tracks = [
      { kind: 'subtitles', language: 'fr', mode: 'disabled' },
      { kind: 'captions', language: 'en', mode: 'disabled' },
      { kind: 'descriptions', language: 'en', mode: 'disabled' }, // not a caption
    ];
    withTracks(v, tracks);
    withTracks(doc.getElementById('w'), []); // no tracks

    ShowCaptions.enable();
    check('picks the caption track in the user language (en) and shows it', tracks[1].mode === 'showing');
    check('leaves other tracks alone', tracks[0].mode === 'disabled' && tracks[2].mode === 'disabled');
    check('marks the handled video', v.dataset.ai4a11yCaptions === 'on');
    check('a video with no caption tracks is untouched', !doc.getElementById('w').dataset.ai4a11yCaptions);

    // Reversibility: disable restores the previous mode and clears the marker.
    ShowCaptions.disable();
    check('disable restores the previous track mode', tracks[1].mode === 'disabled');
    check('disable clears the handled marker', !v.dataset.ai4a11yCaptions);
  }

  // ── don't fight the user ──────────────────────────────────────────────────
  {
    const doc = mount('<video id="v"></video>');
    const tracks = [{ kind: 'captions', language: 'en', mode: 'disabled' }];
    withTracks(doc.getElementById('v'), tracks);
    ShowCaptions.enable();
    check('enables captions on first pass', tracks[0].mode === 'showing');
    // The user turns them back off…
    tracks[0].mode = 'disabled';
    // …a later sweep (enable() is idempotent → re-sweeps) must NOT re-enable them.
    ShowCaptions.enable();
    check('does not re-enable captions the user turned off', tracks[0].mode === 'disabled');
    ShowCaptions.disable();
  }

  // ── re-apply on new media (SPA / playlist swaps the <video>) ───────────────
  {
    const doc = mount('<video id="v"></video>');
    withTracks(doc.getElementById('v'), [{ kind: 'captions', language: 'en', mode: 'disabled' }]);
    ShowCaptions.enable();
    // A new video appears (autoplay next); a fresh sweep should caption it too.
    const v2 = doc.createElement('video');
    const t2 = [{ kind: 'captions', language: 'en', mode: 'disabled' }];
    withTracks(v2, t2);
    doc.body.appendChild(v2);
    ShowCaptions.enable(); // idempotent → sweeps, picks up the new video
    check('captions a newly-added video too', t2[0].mode === 'showing');
    ShowCaptions.disable();
  }

  // ── language fallback: no track in the user's language → first track ───────
  {
    const doc = mount('<video id="v"></video>');
    const tracks = [{ kind: 'subtitles', language: 'de', mode: 'disabled' }, { kind: 'subtitles', language: 'es', mode: 'disabled' }];
    withTracks(doc.getElementById('v'), tracks);
    ShowCaptions.enable();
    check('falls back to the first track when none match the language', tracks[0].mode === 'showing' && tracks[1].mode === 'disabled');
    ShowCaptions.disable();
  }

  // ── player that owns its CC UI (YouTube): click the button once ────────────
  {
    const doc = mount('<button class="ytp-subtitles-button" aria-pressed="false"></button>');
    const btn = doc.querySelector('.ytp-subtitles-button');
    let clicks = 0;
    btn.addEventListener('click', () => { clicks++; btn.setAttribute('aria-pressed', 'true'); });

    ShowCaptions.enable();
    check('clicks the YouTube CC button when captions are off', clicks === 1 && btn.getAttribute('aria-pressed') === 'true');

    // Already on → a re-sweep does not click again.
    ShowCaptions.enable();
    check('does not re-click when captions are already on', clicks === 1);
    ShowCaptions.disable();
  }

  // ── player: don't fight the user (once per URL) ────────────────────────────
  {
    const doc = mount('<button class="ytp-subtitles-button" aria-pressed="false"></button>');
    const btn = doc.querySelector('.ytp-subtitles-button');
    let clicks = 0;
    btn.addEventListener('click', () => { clicks++; btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
    ShowCaptions.enable();
    check('turns player captions on once', clicks === 1);
    // User turns them back off (button now aria-pressed=false again)…
    btn.setAttribute('aria-pressed', 'false');
    ShowCaptions.enable(); // same URL → already acted → no re-click
    check('does not re-click the player button on the same page', clicks === 1);
    ShowCaptions.disable();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
