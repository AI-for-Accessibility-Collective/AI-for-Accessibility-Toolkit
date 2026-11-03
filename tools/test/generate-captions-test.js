// generate-captions-test.js — unit tests for generate-captions adapter
//
// Tests caption generation for <video>, transcript disclosure for <audio>,
// skipping media that already has captions, and complete reversibility via
// restoreOriginal().
//
// Run: node tools/test/generate-captions-test.js
import { JSDOM } from 'jsdom';
import { generateVideoCaptions, generateAudioCaptions, restoreOriginal, axeHandlers } from '../adapters/generate-captions.js';
import { setAIProvider } from '../utils/ai.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('FAIL:', name, extra === undefined ? '' : extra);
  }
}

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>${html}</body></html>`, { url: 'https://example.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.getComputedStyle = (el) => dom.window.getComputedStyle(el);
  return dom.window.document;
}

async function run() {
  setAIProvider({
    transcribeVideo: async (url) => ({ text: 'Welcome to this universal design lecture.' }),
    transcribeAudio: async (url) => ({ text: 'This podcast episode covers accessibility principles.' }),
    announce: () => {},
  });

  // ── Video Caption Generation ─────────────────────────────────────────────
  {
    const doc = mount('<video id="v" src="https://example.com/lecture.mp4"></video>');
    const v = doc.getElementById('v');

    const result = await generateVideoCaptions(v);
    check('transcribeVideo returns transcript text', typeof result === 'string' && result.includes('universal design'));
    check('video marked as done in dataset', v.dataset.ai4a11yCaptioned === 'done');

    const track = v.querySelector('track');
    check('track element added to video', !!track);
    check('track kind is captions', track?.kind === 'captions');
    check('track label is Auto-generated', track?.label === 'Auto-generated');
    check('track srclang matches page language (en)', track?.srclang === 'en');
    check('track has data-ai4a11y-track marker', track?.dataset.ai4a11yTrack === 'true');
    check('track src contains encoded WebVTT header', track?.src.startsWith('data:text/vtt;charset=utf-8,WEBVTT'));
  }

  // ── Existing Captions Left Alone ─────────────────────────────────────────
  {
    const doc = mount(`
      <video id="v-existing" src="https://example.com/existing.mp4">
        <track kind="captions" label="Existing" srclang="en" default>
      </video>
    `);
    const v = doc.getElementById('v-existing');
    const result = await generateVideoCaptions(v);

    check('skips video that already has a captions track', result === null);
    check('existing track count unchanged', v.querySelectorAll('track').length === 1);
    check('does not alter dataset on existing captioned video', v.dataset.ai4a11yCaptioned === undefined);
  }

  // ── Audio Transcript Generation ──────────────────────────────────────────
  {
    const doc = mount('<div id="container"><audio id="a" src="https://example.com/podcast.mp3"></audio></div>');
    const a = doc.getElementById('a');

    const result = await generateAudioCaptions(a);
    check('transcribeAudio returns transcript text', typeof result === 'string' && result.includes('accessibility principles'));
    check('audio marked as done in dataset', a.dataset.ai4a11yCaptioned === 'done');

    const details = a.nextElementSibling;
    check('details element inserted directly after audio', details?.tagName === 'DETAILS');
    check('details has class ai4a11y-transcript', details?.classList.contains('ai4a11y-transcript'));

    const summary = details?.querySelector('summary');
    check('summary has text Transcript', summary?.textContent === 'Transcript');

    const content = details?.querySelector('.ai4a11y-transcript-content');
    check('transcript content contains transcribed text', content?.textContent.includes('accessibility principles'));
    check('stylesheet for transcript UI is injected', !!doc.getElementById('ai4a11y-generate-captions-styles'));
  }

  // ── Reversibility via restoreOriginal() ──────────────────────────────────
  {
    const initialHTML = `
      <div id="wrapper">
        <video id="v" src="https://example.com/lecture.mp4"></video>
        <audio id="a" src="https://example.com/podcast.mp3"></audio>
      </div>
    `.trim();

    const doc = mount(initialHTML);
    const v = doc.getElementById('v');
    const a = doc.getElementById('a');

    await generateVideoCaptions(v);
    await generateAudioCaptions(a);

    // Assert adaptations were made
    check('adaptations applied prior to restore', doc.querySelectorAll('track, .ai4a11y-transcript').length === 2);

    // Call restoreOriginal()
    restoreOriginal();

    check('tracks removed on restore', doc.querySelectorAll('track').length === 0);
    check('transcript details removed on restore', doc.querySelectorAll('.ai4a11y-transcript').length === 0);
    check('data-ai4a11y-captioned removed from video', v.dataset.ai4a11yCaptioned === undefined);
    check('data-ai4a11y-captioned removed from audio', a.dataset.ai4a11yCaptioned === undefined);
    check('stylesheet removed on restore', doc.getElementById('ai4a11y-generate-captions-styles') === null);
  }

  // ── restoreOriginal() while a transcription is still pending ─────────────
  {
    const doc = mount(`
      <div id="wrapper">
        <video id="v" src="https://example.com/lecture.mp4"></video>
        <audio id="a" src="https://example.com/podcast.mp3"></audio>
      </div>
    `);
    const v = doc.getElementById('v');
    const a = doc.getElementById('a');

    const resolvers = [];
    setAIProvider({
      transcribeVideo: () => new Promise(r => resolvers.push(() => r({ text: 'Late video transcript.' }))),
      transcribeAudio: () => new Promise(r => resolvers.push(() => r({ text: 'Late audio transcript.' }))),
      announce: () => {},
    });

    const pv = generateVideoCaptions(v);
    const pa = generateAudioCaptions(a);
    check('media marked pending while transcribing', v.dataset.ai4a11yCaptioned === 'pending' && a.dataset.ai4a11yCaptioned === 'pending');

    restoreOriginal();
    check('restore clears the pending flag', v.dataset.ai4a11yCaptioned === undefined && a.dataset.ai4a11yCaptioned === undefined);

    resolvers.forEach(resolve => resolve());
    const [rv, ra] = await Promise.all([pv, pa]);

    check('late transcription returns null after restore', rv === null && ra === null);
    check('no track added after restore', v.querySelectorAll('track').length === 0);
    check('no transcript added after restore', doc.querySelectorAll('.ai4a11y-transcript').length === 0);
    check('no flag written back after restore', v.dataset.ai4a11yCaptioned === undefined && a.dataset.ai4a11yCaptioned === undefined);
    check('no stylesheet added after restore', doc.getElementById('ai4a11y-generate-captions-styles') === null);
  }

  // ── Axe Handlers Export Mapping ──────────────────────────────────────────
  {
    check('axeHandlers exports video-caption', axeHandlers['video-caption'] === generateVideoCaptions);
    check('axeHandlers exports audio-caption', axeHandlers['audio-caption'] === generateAudioCaptions);
  }

  console.log(`\ngenerate-captions: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
