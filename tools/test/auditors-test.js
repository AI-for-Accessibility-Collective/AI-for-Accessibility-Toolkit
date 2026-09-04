// WCAG auditors: jsdom tests that pin what each scanner reports on a small,
// realistic page. Two jobs: keep the heuristic thresholds and word lists in
// missing-alt, missing-labels, missing-captions and missing-landmarks behaving
// exactly as they do today (so naming them is provably a no-op), and pin the
// aria-labelledby rule shared by SVGs, links, buttons and form controls: a
// labelledby that points at a missing or empty element is not a label, and a
// space-separated id list names the element if any one id resolves.
//
// Run: node tools/test/auditors-test.js
import { JSDOM } from 'jsdom';
import { findEmptyLinks, findAmbiguousLinks, findEmptyButtons, findUnlabeledInputs } from '../auditors/missing-labels.js';
import { findImagesWithoutAlt, findEmptyAltImages, findBadAltImages, findBackgroundImages, findCanvasElements, findSvgWithoutAlt } from '../auditors/missing-alt.js';
import { findVideosWithoutCaptions, findAudioWithoutTranscripts, findEmbeddedVideos } from '../auditors/missing-captions.js';
import { findUnmarkedNavigation } from '../auditors/missing-landmarks.js';
import { getLabelledByText, hasAccessibleName, getAccessibleName } from '../utils/dom.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// Mount a page body into a fresh jsdom and expose the globals the auditors read.
// jsdom has no layout, so every rect is 0x0; read the size from data-w/data-h
// on the element instead (default 200x40) so the pixel cutoffs can be probed.
function mount(bodyHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHTML}</body></html>`, { url: 'https://example.com/page' });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    const width = Number(this.getAttribute('data-w')) || 200;
    const height = Number(this.getAttribute('data-h')) || 40;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 };
  };
  global.window = window;
  global.document = window.document;
  global.getComputedStyle = (el) => window.getComputedStyle(el);
  global.CSS = window.CSS || { escape: (s) => s };
  return window.document;
}

// Did the auditor report the element with this id?
const reports = (found, doc, id) => found.some((f) => (f.element || f) === doc.getElementById(id));

function run() {
  // ── LINKS, BUTTONS, FORM CONTROLS ──────────────────────────────────────────
  {
    const doc = mount(`
      <span id="lbl-ok">Search the catalog</span>
      <span id="lbl-empty"></span>
      <a id="a-here" href="/x">Click here</a>
      <a id="a-more-arrow" href="/y">Read more →</a>
      <a id="a-contact" href="/z">Contact us</a>
      <a id="a-hidden" href="/w" style="display:none">here</a>
      <a id="a-empty" href="/e"></a>
      <a id="a-lbl-ok" href="/f" aria-labelledby="lbl-ok"></a>
      <a id="a-lbl-missing" href="/g" aria-labelledby="nope"></a>
      <a id="a-lbl-list" href="/h" aria-labelledby="nope lbl-ok"></a>
      <button id="b-empty"></button>
      <button id="b-text">Go</button>
      <button id="b-lbl-list" aria-labelledby="nope lbl-ok"></button>
      <input id="in-bare">
      <input id="in-aria" aria-label="City">
      <input id="in-lbl-ok" aria-labelledby="lbl-ok">
      <input id="in-lbl-missing" aria-labelledby="nope">
      <input id="in-lbl-empty" aria-labelledby="lbl-empty">
      <input id="in-lbl-list" aria-labelledby="nope lbl-ok">
      <input id="in-lbl-list-none" aria-labelledby="nope lbl-empty">
      <label for="in-for">Name</label><input id="in-for">
      <label>Age <input id="in-wrapped"></label>
      <input id="in-title" title="Postal code">
      <input id="in-hidden" type="hidden">
      <select id="sel-bare"></select>
      <textarea id="ta-bare"></textarea>`);

    const ambiguous = findAmbiguousLinks();
    check('ambiguous links: "Click here" is reported (exact match, case-folded)', reports(ambiguous, doc, 'a-here'));
    check('ambiguous links: "Read more →" is not reported (known limit of the exact-match list)', !reports(ambiguous, doc, 'a-more-arrow'));
    check('ambiguous links: a descriptive link is not reported', !reports(ambiguous, doc, 'a-contact'));
    check('ambiguous links: a hidden link is skipped', !reports(ambiguous, doc, 'a-hidden'));
    check('ambiguous links: exactly one reported on this page', ambiguous.length === 1);

    const empty = findEmptyLinks();
    check('empty links: a link with no name is reported', reports(empty, doc, 'a-empty'));
    check('empty links: a labelledby that resolves is a name', !reports(empty, doc, 'a-lbl-ok'));
    check('empty links: a labelledby pointing nowhere is reported', reports(empty, doc, 'a-lbl-missing'));
    check('empty links: an id list where one id resolves is a name', !reports(empty, doc, 'a-lbl-list'));
    check('empty links: exactly two reported on this page', empty.length === 2);

    const buttons = findEmptyButtons();
    check('empty buttons: a button with no name is reported', reports(buttons, doc, 'b-empty'));
    check('empty buttons: a button with text is not reported', !reports(buttons, doc, 'b-text'));
    check('empty buttons: an id list where one id resolves is a name', !reports(buttons, doc, 'b-lbl-list'));
    check('empty buttons: exactly one reported on this page', buttons.length === 1);

    const inputs = findUnlabeledInputs();
    check('inputs: a bare input is reported', reports(inputs, doc, 'in-bare'));
    check('inputs: aria-label counts', !reports(inputs, doc, 'in-aria'));
    check('inputs: a labelledby that resolves to text counts', !reports(inputs, doc, 'in-lbl-ok'));
    check('inputs: a labelledby pointing at a missing id is reported', reports(inputs, doc, 'in-lbl-missing'));
    check('inputs: a labelledby pointing at an empty element is reported', reports(inputs, doc, 'in-lbl-empty'));
    check('inputs: an id list where one id resolves counts', !reports(inputs, doc, 'in-lbl-list'));
    check('inputs: an id list where no id resolves to text is reported', reports(inputs, doc, 'in-lbl-list-none'));
    check('inputs: <label for> counts', !reports(inputs, doc, 'in-for'));
    check('inputs: a wrapping <label> counts', !reports(inputs, doc, 'in-wrapped'));
    check('inputs: title counts', !reports(inputs, doc, 'in-title'));
    check('inputs: hidden inputs are skipped', !reports(inputs, doc, 'in-hidden'));
    check('inputs: a bare select is reported', reports(inputs, doc, 'sel-bare'));
    check('inputs: a bare textarea is reported', reports(inputs, doc, 'ta-bare'));
    check('inputs: exactly six reported on this page', inputs.length === 6);

    // The shared helper behind all of the above.
    check('labelledby helper: no attribute gives empty text', getLabelledByText(doc.getElementById('in-bare')) === '');
    check('labelledby helper: a missing id gives empty text', getLabelledByText(doc.getElementById('in-lbl-missing')) === '');
    check('labelledby helper: an id list joins the resolved text', getLabelledByText(doc.getElementById('in-lbl-list')) === 'Search the catalog');
    check('accessible name: text beats labelledby', getAccessibleName(doc.getElementById('b-text')) === 'Go');
    check('accessible name: an id list resolves', getAccessibleName(doc.getElementById('b-lbl-list')) === 'Search the catalog');
    check('accessible name: a dangling labelledby is not a name', hasAccessibleName(doc.getElementById('a-lbl-missing')) === false);
  }

  // ── IMAGES, CANVAS, SVG ────────────────────────────────────────────────────
  {
    const doc = mount(`
      <span id="lbl-ok">Sales by region</span>
      <span id="lbl-empty"></span>
      <img id="img-noalt" src="a.jpg" width="300" height="200">
      <img id="img-empty-big" src="b.jpg" alt="" width="101" height="101">
      <img id="img-empty-edge" src="c.jpg" alt="" width="100" height="100">
      <img id="img-empty-tiny" src="d.jpg" alt="" width="19" height="19">
      <img id="img-empty-pres" src="e.jpg" alt="" role="presentation" width="400" height="400">
      <img id="img-alt-logo" src="f.png" alt="logo" width="300" height="200">
      <img id="img-alt-file" src="g.jpg" alt="IMG_1234" width="300" height="200">
      <img id="img-alt-ext" src="h.jpg" alt="team-photo.jpg" width="300" height="200">
      <img id="img-alt-shot" src="i.png" alt="Screenshot of the settings page" width="300" height="200">
      <img id="img-alt-good" src="j.png" alt="Acme company logo" width="300" height="200">
      <img id="img-alt-number" src="k.png" alt="42" width="300" height="200">
      <div id="bg-big" style="background-image: url(hero.jpg)" data-w="101" data-h="101">Hero</div>
      <div id="bg-edge" style="background-image: url(strip.jpg)" data-w="100" data-h="100">Strip</div>
      <div id="bg-none">Plain</div>
      <canvas id="cv-big" data-w="51" data-h="51"></canvas>
      <canvas id="cv-edge" data-w="50" data-h="50"></canvas>
      <svg id="svg-icon" data-w="49" data-h="49"></svg>
      <svg id="svg-edge" data-w="50" data-h="50"></svg>
      <svg id="svg-bare" data-w="60" data-h="60"></svg>
      <svg id="svg-aria" data-w="60" data-h="60" aria-label="Chart"></svg>
      <svg id="svg-title" data-w="60" data-h="60"><title>Chart</title></svg>
      <svg id="svg-lbl-ok" data-w="60" data-h="60" aria-labelledby="lbl-ok"></svg>
      <svg id="svg-lbl-missing" data-w="60" data-h="60" aria-labelledby="nope"></svg>
      <svg id="svg-lbl-empty" data-w="60" data-h="60" aria-labelledby="lbl-empty"></svg>
      <svg id="svg-lbl-list" data-w="60" data-h="60" aria-labelledby="nope lbl-ok"></svg>`);

    const noAlt = findImagesWithoutAlt();
    check('no alt: an <img> with no alt attribute is reported', reports(noAlt, doc, 'img-noalt'));
    check('no alt: exactly one reported on this page', noAlt.length === 1);

    const emptyAlt = findEmptyAltImages();
    check('empty alt: 101x101 is treated as content', reports(emptyAlt, doc, 'img-empty-big'));
    check('empty alt: 100x100 is not (cutoff is strictly greater than)', !reports(emptyAlt, doc, 'img-empty-edge'));
    check('empty alt: a 19x19 image is decorative', !reports(emptyAlt, doc, 'img-empty-tiny'));
    check('empty alt: role=presentation is decorative', !reports(emptyAlt, doc, 'img-empty-pres'));
    check('empty alt: exactly one reported on this page', emptyAlt.length === 1);

    const badAlt = findBadAltImages();
    check('bad alt: alt="logo" is reported', reports(badAlt, doc, 'img-alt-logo'));
    check('bad alt: a camera file name is reported', reports(badAlt, doc, 'img-alt-file'));
    check('bad alt: a file extension is reported', reports(badAlt, doc, 'img-alt-ext'));
    check('bad alt: "Screenshot of ..." is reported (prefix match, known limit)', reports(badAlt, doc, 'img-alt-shot'));
    check('bad alt: a number-only alt is reported', reports(badAlt, doc, 'img-alt-number'));
    check('bad alt: "Acme company logo" is not reported', !reports(badAlt, doc, 'img-alt-good'));
    check('bad alt: images with no alt or empty alt are left to the other scanners', !reports(badAlt, doc, 'img-noalt') && !reports(badAlt, doc, 'img-empty-big'));
    check('bad alt: exactly five reported on this page', badAlt.length === 5);

    const bg = findBackgroundImages();
    check('background: a 101x101 block with a url() background is reported', reports(bg, doc, 'bg-big'));
    check('background: the url is extracted', bg.find((f) => f.element === doc.getElementById('bg-big'))?.imageUrl === 'hero.jpg');
    check('background: 100x100 is not reported', !reports(bg, doc, 'bg-edge'));
    check('background: no background, not reported', !reports(bg, doc, 'bg-none'));
    check('background: exactly one reported on this page', bg.length === 1);

    const canvases = findCanvasElements();
    check('canvas: 51x51 is reported', reports(canvases, doc, 'cv-big'));
    check('canvas: 50x50 is not reported', !reports(canvases, doc, 'cv-edge'));
    check('canvas: exactly one reported on this page', canvases.length === 1);

    const svgs = findSvgWithoutAlt();
    check('svg: 49x49 is skipped as an icon', !reports(svgs, doc, 'svg-icon'));
    check('svg: 50x50 is reported (skip is strictly less than)', reports(svgs, doc, 'svg-edge'));
    check('svg: a bare 60x60 is reported', reports(svgs, doc, 'svg-bare'));
    check('svg: aria-label counts', !reports(svgs, doc, 'svg-aria'));
    check('svg: <title> counts', !reports(svgs, doc, 'svg-title'));
    check('svg: a labelledby that resolves counts', !reports(svgs, doc, 'svg-lbl-ok'));
    check('svg: a labelledby pointing at a missing id is reported', reports(svgs, doc, 'svg-lbl-missing'));
    check('svg: a labelledby pointing at an empty element is reported', reports(svgs, doc, 'svg-lbl-empty'));
    check('svg: an id list where one id resolves counts', !reports(svgs, doc, 'svg-lbl-list'));
    check('svg: exactly four reported on this page', svgs.length === 4);
  }

  // ── VIDEO, AUDIO, EMBEDS ───────────────────────────────────────────────────
  {
    const doc = mount(`
      <video id="v-bare"></video>
      <video id="v-captions"><track kind="captions" src="c.vtt"></video>
      <video id="v-subs"><track kind="subtitles" src="s.vtt"></video>
      <video id="v-chapters"><track kind="chapters" src="ch.vtt"></video>
      <div><audio id="au-bare"></audio></div>
      <div><audio id="au-link"></audio> <a href="/t">Transcript</a></div>
      <div><audio id="au-no"></audio> <p>No transcript available.</p></div>
      <div><audio id="au-track"><track kind="captions" src="a.vtt"></audio></div>
      <iframe id="if-yt" src="https://www.youtube.com/embed/abc"></iframe>
      <iframe id="if-vimeo" src="https://player.vimeo.com/video/1"></iframe>
      <iframe id="if-map" src="https://maps.example.com/embed"></iframe>`);

    const videos = findVideosWithoutCaptions();
    check('video: no track is reported', reports(videos, doc, 'v-bare'));
    check('video: a captions track counts', !reports(videos, doc, 'v-captions'));
    check('video: a subtitles track counts', !reports(videos, doc, 'v-subs'));
    check('video: a chapters track does not count', reports(videos, doc, 'v-chapters'));
    check('video: exactly two reported on this page', videos.length === 2);

    const audios = findAudioWithoutTranscripts();
    check('audio: no transcript nearby is reported', reports(audios, doc, 'au-bare'));
    check('audio: the word "transcript" in the parent counts', !reports(audios, doc, 'au-link'));
    check('audio: "no transcript available" also passes (known limit of the word check)', !reports(audios, doc, 'au-no'));
    check('audio: a track element counts', !reports(audios, doc, 'au-track'));
    check('audio: exactly one reported on this page', audios.length === 1);

    const embeds = findEmbeddedVideos();
    check('embeds: a YouTube iframe is reported', reports(embeds, doc, 'if-yt'));
    check('embeds: a Vimeo player is reported', reports(embeds, doc, 'if-vimeo'));
    check('embeds: a map iframe is not', !reports(embeds, doc, 'if-map'));
    check('embeds: exactly two reported on this page', embeds.length === 2);
  }

  // ── NAV-LIKE BLOCKS ────────────────────────────────────────────────────────
  {
    const doc = mount(`
      <div id="nav-three" class="main-nav"><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></div>
      <div id="nav-two" class="site-nav"><a href="/a">A</a><a href="/b">B</a></div>
      <div id="nav-marked" class="main-nav" role="navigation"><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></div>
      <nav><div id="nav-inside" class="sub-nav"><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></div></nav>
      <div id="nav-word" class="unavailable"><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></div>`);

    const navs = findUnmarkedNavigation();
    check('nav-like: a nav-classed div with three links is reported', reports(navs, doc, 'nav-three'));
    check('nav-like: two links is below the cutoff', !reports(navs, doc, 'nav-two'));
    check('nav-like: an explicit role is not reported', !reports(navs, doc, 'nav-marked'));
    check('nav-like: a block inside <nav> is not reported', !reports(navs, doc, 'nav-inside'));
    check('nav-like: "unavailable" is not a nav class', !reports(navs, doc, 'nav-word'));
    check('nav-like: exactly one reported on this page', navs.length === 1);
  }
}

try {
  run();
} catch (e) {
  console.error('ERROR', e);
  process.exit(1);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
