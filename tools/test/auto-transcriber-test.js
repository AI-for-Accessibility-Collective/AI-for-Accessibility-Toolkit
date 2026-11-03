// Auto Transcriber — unit tests for the CC video toggle adapter.
//
// Tests:
// 1. Setting up CC button on eligible videos (role, accessible name with WCAG 2.5.3 label in name, aria-pressed).
// 2. Toggling native tracks on/off and restoring original modes on disable.
// 3. AI transcription fallback on videos without tracks.
// 4. Skipping tiny videos below the 100x75 threshold.
// 5. Handling YouTube iframes (updating src and restoring exact original src on disable).
// 6. Idempotency and complete reversibility.
//
// Run: node tools/test/auto-transcriber-test.js
import { JSDOM } from 'jsdom';
import { AutoTranscriber } from '../adapters/auto-transcriber.js';
import { setAIProvider } from '../utils/ai.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL:', name);
  }
}

let announced = [];
const mockAI = {
  announce: (msg) => { announced.push(String(msg)); },
  transcribeVideo: async (url) => {
    if (url.includes('notranscript')) return null;
    return { text: 'Mocked AI transcript text.' };
  },
  getYouTubeTranscript: async (id) => {
    if (id === 'error') return null;
    return 'Mocked YouTube transcript.';
  }
};

function mount(bodyHTML, url = 'https://example.com/videos') {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHTML}</body></html>`, { url });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.Node = window.Node;
  global.MutationObserver = window.MutationObserver;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  announced = [];
  setAIProvider(mockAI);
  return window.document;
}

function withTracks(video, tracks) {
  Object.defineProperty(video, 'textTracks', { value: tracks, configurable: true });
  return video;
}

function withSize(el, width, height) {
  el.getBoundingClientRect = () => ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => {}
  });
  return el;
}

async function run() {
  // ── Native video with existing caption track ──────────────────────────────
  {
    const doc = mount(`
      <div id="wrap1">
        <video id="v1" src="lecture.mp4"></video>
      </div>
      <div id="wrap-tiny">
        <video id="v-tiny"></video>
      </div>
    `);
    const v1 = withSize(doc.getElementById('v1'), 640, 360);
    const vTiny = withSize(doc.getElementById('v-tiny'), 80, 50);
    const tracks = [
      { kind: 'captions', language: 'en', mode: 'disabled' },
      { kind: 'subtitles', language: 'es', mode: 'disabled' }
    ];
    withTracks(v1, tracks);
    withTracks(vTiny, []);

    AutoTranscriber.enable();

    const btn1 = doc.querySelector('#wrap1 .ai4a11y-audio-btn');
    const btnTiny = doc.querySelector('#wrap-tiny .ai4a11y-audio-btn');

    check('creates CC button for standard sized video', Boolean(btn1));
    check('does not create button for tiny video (<100x75)', !btnTiny);
    check('button has visible text CC', btn1?.textContent === 'CC');
    check('button accessible name contains visible label (WCAG 2.5.3)', btn1?.getAttribute('aria-label')?.includes('CC'));
    check('button has initial aria-pressed false', btn1?.getAttribute('aria-pressed') === 'false');
    check('announced button addition', announced.some(a => a.includes('Caption button added')));

    // Test toggle ON
    announced = [];
    await btn1.onclick();
    check('toggle on switches matching track to showing', tracks[0].mode === 'showing');
    check('toggle on sets aria-pressed true', btn1.getAttribute('aria-pressed') === 'true');
    check('toggle on announces captions on', announced.includes('Captions on'));

    // Test toggle OFF
    announced = [];
    await btn1.onclick();
    check('toggle off switches track to hidden', tracks[0].mode === 'hidden');
    check('toggle off sets aria-pressed false', btn1.getAttribute('aria-pressed') === 'false');
    check('toggle off announces captions off', announced.includes('Captions off'));

    // Test disable reversibility
    AutoTranscriber.disable();
    check('disable removes CC button', !doc.querySelector('.ai4a11y-audio-btn'));
    check('disable removes caption box', !doc.querySelector('.ai4a11y-caption-box'));
    check('disable restores track mode to original', tracks[0].mode === 'disabled');
    check('disable cleans up dataset marker', !v1.dataset.ai4a11ySetup);
    check('disable announces buttons removed', announced.includes('Caption buttons removed'));
  }

  // ── Video without tracks: AI transcription fallback ───────────────────────
  {
    const doc = mount(`
      <div id="wrap2">
        <video id="v2" src="clip.mp4"></video>
      </div>
    `);
    const v2 = withSize(doc.getElementById('v2'), 400, 300);
    withTracks(v2, []);

    AutoTranscriber.enable();
    const btn = doc.querySelector('#wrap2 .ai4a11y-audio-btn');
    const captionBox = doc.querySelector('#wrap2 .ai4a11y-caption-box');

    check('captionBox initially hidden', captionBox.style.display === 'none');

    // Click to transcribe
    await btn.onclick();
    check('captionBox displayed during/after transcription', captionBox.style.display === 'block');
    check('captionBox contains transcribed text', captionBox.textContent === 'Mocked AI transcript text.');
    check('announced transcript shown', announced.includes('Transcript shown on the video'));
    check('button aria-pressed is true', btn.getAttribute('aria-pressed') === 'true');

    // Click again to turn off
    await btn.onclick();
    check('captionBox hidden after turning off', captionBox.style.display === 'none');
    check('button aria-pressed is false', btn.getAttribute('aria-pressed') === 'false');

    AutoTranscriber.disable();
    check('disable removes all added elements', !doc.querySelector('#wrap2 .ai4a11y-audio-btn') && !doc.querySelector('#wrap2 .ai4a11y-caption-box'));
  }

  // ── YouTube iframe support and exact restoration ─────────────────────────
  {
    const doc = mount(`
      <div id="wrap-yt">
        <iframe id="yt" src="https://www.youtube.com/embed/xyz?enablejsapi=1"></iframe>
      </div>
    `);

    AutoTranscriber.enable();
    const iframe = doc.getElementById('yt');
    check('YouTube iframe src updated with cc_load_policy=1', iframe.getAttribute('src').includes('cc_load_policy=1'));
    check('YouTube iframe marked with dataset', iframe.dataset.ai4a11yCaptionsEnabled === 'true');

    // Re-enable must be idempotent
    AutoTranscriber.enable();
    check('idempotent enable does not duplicate query params', (iframe.getAttribute('src').match(/cc_load_policy=1/g) || []).length === 1);

    // Disable must restore exact original src attribute
    AutoTranscriber.disable();
    check('disable restores exact original src', iframe.getAttribute('src') === 'https://www.youtube.com/embed/xyz?enablejsapi=1');
    check('disable removes dataset mark from iframe', !iframe.dataset.ai4a11yCaptionsEnabled);

    // An iframe the page detaches keeps its src (so putting it back does not load it twice)
    AutoTranscriber.enable();
    const changedSrc = iframe.getAttribute('src');
    iframe.remove();
    await new Promise((r) => setTimeout(r, 0));
    check('detached iframe keeps its src', iframe.getAttribute('src') === changedSrc);
    check('detached iframe is forgotten', !AutoTranscriber.iframeStates.has(iframe));
    AutoTranscriber.disable();
  }

  // ── Pre-existing showing captions ─────────────────────────────────────────
  {
    const doc = mount(`
      <div id="wrap3">
        <video id="v3" src="default.mp4"></video>
      </div>
    `);
    const v3 = withSize(doc.getElementById('v3'), 500, 300);
    const tracks = [{ kind: 'captions', language: 'en', mode: 'showing' }];
    withTracks(v3, tracks);

    AutoTranscriber.enable();
    const btn = doc.querySelector('#wrap3 .ai4a11y-audio-btn');
    check('video with already showing captions has aria-pressed true initially', btn.getAttribute('aria-pressed') === 'true');

    AutoTranscriber.disable();
    check('disable restores showing mode', tracks[0].mode === 'showing');
  }
}

run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
