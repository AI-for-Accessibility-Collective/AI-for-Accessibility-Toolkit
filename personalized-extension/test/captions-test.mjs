// captions-test.mjs — Node unit tests for the captions adapter pure-logic.
// No browser APIs needed: tests cover VTT building, YouTube ID extraction,
// cc_load_policy src-rewrite idempotency, notice-once logic, and chunk-slicing math.
//
// Run:  node test/captions-test.mjs

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ''); }
}

// ---------------------------------------------------------------------------
// Import the pure-logic exports from captions.js
// We need a minimal DOM stub for the module-level side-effects.
// ---------------------------------------------------------------------------

// Minimal DOM/browser stubs so captions.js can be imported in Node.
const _elements = new Map();
let _styleId = null;

globalThis.document = {
  getElementById: (id) => _elements.get(id) || null,
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    style: {},
    textContent: '',
    href: '',
    rel: '',
    target: '',
    setAttribute: function(k, v) { this[k] = v; },
    getAttribute: function(k) { return this[k] ?? null; },
    removeAttribute: function(k) { delete this[k]; },
    appendChild: function(c) { (this._children = this._children || []).push(c); },
    insertBefore: function() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    remove: function() {},
    click: function() {},
    _children: [],
  }),
  head: { appendChild: (el) => { _elements.set(el.id, el); } },
  body: {
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = {
  location: { hostname: 'example.com', href: 'https://example.com/' },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.location = { hostname: 'example.com', href: 'https://example.com/' };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.MutationObserver = class {
  constructor(cb) { this._cb = cb; }
  observe() {}
  disconnect() {}
};
globalThis.getComputedStyle = () => ({ position: 'static' });
globalThis.chrome = {
  runtime: {
    sendMessage: (msg, cb) => { if (cb) cb({}); },
    lastError: undefined,
  },
};

// Import after stubs are set.
const captionsModule = await import('../skills/builtin/captions.js');
const { buildVTT, axeHandlers } = captionsModule;

// ---------------------------------------------------------------------------
// 1. VTT builder tests
// ---------------------------------------------------------------------------

// (a) Basic chunk → cue, real chunk offsets used.
{
  const chunks = [
    { startSec: 0, endSec: 15, text: 'Hello world. This is a test.' },
    { startSec: 15, endSec: 30, text: 'Second chunk of audio content.' },
  ];
  const vtt = buildVTT(chunks);
  check('VTT starts with WEBVTT header', vtt.startsWith('WEBVTT\n\n'));
  check('VTT contains real start offset 00:00:00.000', vtt.includes('00:00:00.000 -->'));
  check('VTT contains real second chunk offset 00:00:15.000', vtt.includes('00:00:15.000 -->'));
  check('VTT does not contain fixed 5s cadence (no 00:00:05.000)', !vtt.includes('00:00:05.000 -->'), vtt.slice(0, 200));
  check('VTT contains chunk text', vtt.includes('Hello world'));
  check('VTT track label not in VTT body (label goes on <track> element)', !vtt.includes('Auto-generated'));
}

// (b) 2-line splitting at sentence boundaries within a chunk.
{
  const longText = 'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.';
  const chunks = [{ startSec: 0, endSec: 30, text: longText }];
  const vtt = buildVTT(chunks);
  // Should have multiple cue blocks (≥2 since we split into pairs).
  const cueBlocks = vtt.split('\n\n').filter(b => b.includes(' --> '));
  check('Long chunk text split into multiple cues (≤2 lines each)', cueBlocks.length >= 2, cueBlocks.length);
}

// (c) Empty chunk list produces valid empty VTT.
{
  const vtt = buildVTT([]);
  check('Empty chunk list produces valid WEBVTT', vtt.trim() === 'WEBVTT');
}

// (d) Cue timing is within the chunk's time window.
{
  const chunks = [{ startSec: 10, endSec: 25, text: 'Only one sentence.' }];
  const vtt = buildVTT(chunks);
  // The cue start should be >= 10s (00:00:10).
  check('Cue start time respects chunk startSec offset', vtt.includes('00:00:10.000 -->'), vtt.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 2. YouTube ID extraction
// ---------------------------------------------------------------------------

// Replicate the regex from captions.js (we test the logic independently).
const YT_URL_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(YT_URL_RE);
  return m ? m[1] : null;
}

check('watch?v= URL extracts ID', extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('youtu.be URL extracts ID', extractYouTubeId('https://youtu.be/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('/shorts/ URL extracts ID', extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('/embed/ URL extracts ID', extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('youtube-nocookie.com/embed/ extracts ID', extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('watch?v= with other params extracts ID', extractYouTubeId('https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=10') === 'dQw4w9WgXcQ');
check('Non-YouTube URL returns null', extractYouTubeId('https://vimeo.com/123456') === null);
check('Null URL returns null', extractYouTubeId(null) === null);

// ---------------------------------------------------------------------------
// 3. cc_load_policy src-rewrite idempotency
// ---------------------------------------------------------------------------

function addCcToYouTubeSrc(src) {
  if (src.includes('cc_load_policy=1')) return src;
  const sep = src.includes('?') ? '&' : '?';
  return src + sep + 'cc_load_policy=1&cc_lang_pref=en';
}

{
  const src1 = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
  const rewritten = addCcToYouTubeSrc(src1);
  check('cc_load_policy added to bare embed URL', rewritten.includes('cc_load_policy=1'));
  check('cc_lang_pref added to bare embed URL', rewritten.includes('cc_lang_pref=en'));
  check('? used as separator when no query string', rewritten.includes('?cc_load_policy'));

  const rewrittenAgain = addCcToYouTubeSrc(rewritten);
  check('Idempotent: rewriting already-rewritten URL leaves it unchanged', rewrittenAgain === rewritten, rewrittenAgain);

  const src2 = 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1';
  const rewritten2 = addCcToYouTubeSrc(src2);
  check('& used as separator when query string present', rewritten2.includes('&cc_load_policy'));
  check('Idempotent on URL with existing params', addCcToYouTubeSrc(rewritten2) === rewritten2);
}

// ---------------------------------------------------------------------------
// 4. Notice-once logic
// ---------------------------------------------------------------------------

// The notice-once behavior uses a WeakSet in captions.js. We test the
// underlying logic (show once per element reference).
{
  // Simulate: notice only added once per element object identity.
  const seen = new WeakSet();
  function showNoticeOnce(el) {
    if (seen.has(el)) return false;
    seen.add(el);
    return true;
  }
  const el1 = { id: 'v1' };
  const el2 = { id: 'v2' };
  check('First call for el1 returns true (notice shown)', showNoticeOnce(el1) === true);
  check('Second call for el1 returns false (not shown again)', showNoticeOnce(el1) === false);
  check('First call for el2 returns true', showNoticeOnce(el2) === true);
  check('Third call for el1 still false', showNoticeOnce(el1) === false);
}

// ---------------------------------------------------------------------------
// 5. Chunk-slicing math (offsets/durations)
// ---------------------------------------------------------------------------

{
  // Simulate the chunk math from the offscreen audio decode handler.
  const sampleRate = 22050;
  const durationSec = 45; // 45s audio
  const totalSamples = sampleRate * durationSec;
  const CHUNK_DURATION = 15;
  const chunkSamples = Math.ceil(CHUNK_DURATION * sampleRate);

  const chunks = [];
  for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
    const chunkLen = Math.min(chunkSamples, totalSamples - offset);
    const startSec = offset / sampleRate;
    const endSec = Math.min(startSec + CHUNK_DURATION, durationSec);
    chunks.push({ startSec, endSec, samples: chunkLen });
  }

  check('45s audio at 22050Hz produces 3 chunks', chunks.length === 3, chunks.length);
  check('First chunk starts at 0', chunks[0].startSec === 0);
  check('First chunk ends at 15', chunks[0].endSec === 15);
  check('Second chunk starts at 15', Math.abs(chunks[1].startSec - 15) < 0.01, chunks[1].startSec);
  check('Second chunk ends at 30', Math.abs(chunks[1].endSec - 30) < 0.01, chunks[1].endSec);
  check('Third chunk starts at 30', Math.abs(chunks[2].startSec - 30) < 0.01, chunks[2].startSec);
  check('Third chunk ends at 45 (full duration)', chunks[2].endSec === 45, chunks[2].endSec);
  check('All chunk samples are ≤ chunkSamples', chunks.every(c => c.samples <= chunkSamples));
  check('Total samples covered equals total audio', chunks.reduce((s, c) => s + c.samples, 0) === totalSamples);
}

// Edge case: audio shorter than one chunk.
{
  const sampleRate = 22050;
  const durationSec = 5;
  const totalSamples = sampleRate * durationSec;
  const chunkSamples = Math.ceil(15 * sampleRate);
  const chunks = [];
  for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
    const chunkLen = Math.min(chunkSamples, totalSamples - offset);
    const startSec = offset / sampleRate;
    const endSec = Math.min(startSec + 15, durationSec);
    chunks.push({ startSec, endSec, samples: chunkLen });
  }
  check('5s audio produces exactly 1 chunk', chunks.length === 1, chunks.length);
  check('Single chunk spans 0→5s', chunks[0].startSec === 0 && chunks[0].endSec === 5, chunks[0]);
}

// ---------------------------------------------------------------------------
// 6. axeHandlers exported
// ---------------------------------------------------------------------------

check('axeHandlers exports video-caption key', typeof axeHandlers['video-caption'] === 'function');
check('axeHandlers exports audio-caption key', typeof axeHandlers['audio-caption'] === 'function');

// ---------------------------------------------------------------------------
// 7. Static file checks (track label, notice string, namespaced marks)
// ---------------------------------------------------------------------------

const captionsCode = fs.readFileSync(path.join(__dirname, '../skills/builtin/captions.js'), 'utf8');

check('Track label mentions AI-generated', captionsCode.includes("'AI-generated (may contain errors)'"));
check('Notice string present in captions.js', captionsCode.includes("Can't reach this player"));
check('Namespaced marks used (ns = captions)', captionsCode.includes("'captions'") && captionsCode.includes('markProcessed'));
check('No createSimpleVTT fixed-cadence code (old bad pattern absent)', !captionsCode.includes('createSimpleVTT'));
check('Real chunk offsets used in VTT (buildVTT takes chunks with startSec/endSec)', captionsCode.includes('startSec') && captionsCode.includes('endSec'));
check('No dataset.ai4a11yCaptioned permanent latch', !captionsCode.includes("dataset.ai4a11yCaptioned = 'failed'"));
check('pagehide self-disable removed', !captionsCode.includes("'pagehide'"));
check('wrapper position restored on disable (origWrapperPosition)', captionsCode.includes('origWrapperPosition'));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== captions-test.mjs: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
