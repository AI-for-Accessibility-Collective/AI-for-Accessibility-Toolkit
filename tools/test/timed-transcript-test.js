// Timed transcript + caption pacing (CaptionFlow) — pure-function tests.
// Run: node tools/test/timed-transcript-test.js
import {
  normalizeSegment, cleanSegments, mergeChunks, splitLongSegments,
  toVTT, parseVTT, readTranscript, segmentAt,
} from '../utils/timed-transcript.js';
import { planPacing, readingTime, pacingSummary, wpmFromReadingCheck, readingSpeedNeed } from '../utils/caption-pacing.js';
import { normalizeNeed } from '../../toolkit/core/ability.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

// --- normalizeSegment -------------------------------------------------------
check('accepts startSec/endSec (extension chunk shape)', normalizeSegment({ startSec: 1, endSec: 2, text: 'hi' })?.start === 1);
check('drops empty text', normalizeSegment({ start: 0, end: 1, text: '  ' }) === null);
check('drops end <= start', normalizeSegment({ start: 2, end: 2, text: 'x' }) === null);
check('clamps confidence', normalizeSegment({ start: 0, end: 1, text: 'x', confidence: 3 }).confidence === 1);

// --- cleanSegments: sort, de-duplicate, trim overlaps ------------------------
{
  const out = cleanSegments([
    { start: 5, end: 8, text: 'second' },
    { start: 0, end: 6, text: 'first' },
  ]);
  check('sorted', out[0].text === 'first');
  check('overlap trimmed', out[0].end === 5);
}
{
  const out = cleanSegments([
    { start: 10, end: 13, text: 'Wizara ya Afya.' },
    { start: 10.2, end: 13.4, text: 'wizara ya afya' },
  ]);
  check('same phrase heard twice kept once', out.length === 1 && out[0].end === 13.4);
}

// --- mergeChunks: offsets added, overlap split at its middle -----------------
{
  // Chunk A: 0–30 s, chunk B: 28–58 s (2 s overlap, cut at 29 s).
  const merged = mergeChunks([
    { offset: 0, duration: 30, segments: [
      { start: 20, end: 24, text: 'before the overlap' },
      { start: 28.5, end: 30, text: 'cut off at the end of' }, // partial
    ] },
    { offset: 28, duration: 30, segments: [
      { start: 0.5, end: 3, text: 'the phrase heard whole by chunk B' }, // abs 28.5–31
      { start: 5, end: 8, text: 'after the overlap' },                   // abs 33–36
    ] },
  ]);
  const texts = merged.map((s) => s.text);
  check('offset added', merged.find((s) => s.text === 'after the overlap')?.start === 33);
  check('whole phrase from the later chunk kept', texts.includes('the phrase heard whole by chunk B'));
  check('partial phrase from the earlier chunk dropped', !texts.includes('cut off at the end of'));
  check('no overlaps after merge', merged.every((s, i) => i === 0 || s.start >= merged[i - 1].end));
}

// --- splitLongSegments -------------------------------------------------------
{
  const text = 'The Ministry of Health has announced a free vaccination drive, starting on Monday in all county hospitals across the country.';
  const out = splitLongSegments([{ start: 0, end: 10, text }], { maxWords: 10 });
  check('long segment split', out.length >= 2);
  check('split keeps all words', out.map((s) => s.text).join(' ') === text);
  check('split keeps start and end', out[0].start === 0 && out[out.length - 1].end === 10);
  check('split pieces are contiguous', out.every((s, i) => i === 0 || s.start === out[i - 1].end));
}

// --- VTT round trip and YouTube rolling captions -------------------------------
{
  const segs = [{ start: 1.5, end: 4.25, text: 'Habari za asubuhi.' }, { start: 3661, end: 3662.5, text: 'Good morning.' }];
  const vtt = toVTT(segs);
  check('vtt header', vtt.startsWith('WEBVTT'));
  check('vtt time format', vtt.includes('01:01:01.000 --> 01:01:02.500'));
  const back = parseVTT(vtt);
  check('vtt round trip', back.length === 2 && back[0].start === 1.5 && back[1].text === 'Good morning.');
}
{
  const yt = `WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.000 --> 00:00:02.000 align:start position:0%\nthe county<00:00:00.500><c> government</c>\n\n00:00:02.000 --> 00:00:04.000\nthe county government has announced\n\n00:00:04.000 --> 00:00:04.010\nthe county government has announced\n`;
  const out = parseVTT(yt);
  check('inline tags stripped', out[0].text === 'the county government');
  check('rolling repeat keeps only new words', out[1]?.text === 'has announced');
}
check('readTranscript: SRT', readTranscript('1\n00:00:01,000 --> 00:00:02,000\nHello\n').segments[0].start === 1);
check('readTranscript: JSON string', readTranscript('{"segments":[{"start":0,"end":1,"text":"a"}]}').segments.length === 1);

// --- segmentAt -----------------------------------------------------------------
{
  const s = [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 5, end: 9 }];
  check('segmentAt inside', segmentAt(s, 4) === 1);
  check('segmentAt boundary goes to next', segmentAt(s, 5) === 2);
  check('segmentAt gap', segmentAt(s, 2.5) === -1);
  check('segmentAt after end', segmentAt(s, 99) === -1);
}

// --- pacing --------------------------------------------------------------------
{
  // 13 words at 130 wpm need 6 s; spoken in 3 s → 0.5×, no hold.
  const words13 = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  const [p] = planPacing([{ start: 0, end: 3, text: words13 }], { wpm: 130 });
  check('reading time', near(readingTime(words13, 130), 6));
  check('slowed to 0.5×', p.rate === 0.5 && p.slowed);
  check('no hold needed', p.holdSec === 0);
}
{
  // Same words in 2 s: 0.5× gives 4 s, the reader needs 6 s → hold 2 s.
  const [p] = planPacing([{ start: 0, end: 2, text: 'one two three four five six seven eight nine ten eleven twelve thirteen' }], { wpm: 130 });
  check('clamped at minRate', p.rate === 0.5);
  check('holds for the rest', near(p.holdSec, 2));
}
{
  const [p] = planPacing([{ start: 0, end: 10, text: 'short line' }], { wpm: 130 });
  check('never speeds up', p.rate === 1 && !p.slowed && p.holdSec === 0);
}
{
  const [p] = planPacing([{ start: 0, end: 0.4, text: 'Yes' }], { wpm: 300, minReadSec: 1 });
  check('one-word caption still gets minReadSec', near(p.readSec, 1));
}
{
  const paced = planPacing([{ start: 0, end: 2, text: 'one two three four five six seven eight nine ten eleven twelve thirteen' }], { wpm: 130 });
  const sum = pacingSummary(paced, 60);
  check('summary extra time = slowdown + hold', near(sum.extraSec, 4) && sum.heldCount === 1);
}
check('reading check: 20 words in 10 s = 120 wpm', wpmFromReadingCheck(Array(20).fill('neno').join(' '), 10) === 120);
check('reading check rejects 0 s', wpmFromReadingCheck('a b', 0) === null);
check('reading speed is a valid toolkit need', normalizeNeed(readingSpeedNeed(97.4))?.value === 97);

console.log(`timed-transcript: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
