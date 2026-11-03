// caption-pacing.js — slow the video so each caption stays up long enough
// for THIS person to read it (CaptionFlow).
//
// Captions are usually timed to the speaker. A Deaf viewer whose first
// language is KSL may read written English or Swahili more slowly than the
// speaker talks, so the caption is gone before they finish it. Here the
// video adapts to the reader instead:
//
//   1. Each segment needs `readSec` = words ÷ reading speed (plus a short
//      floor so even one word is seen).
//   2. If the speech gives less time than that, the video plays the segment
//      slower: rate = speechSec ÷ readSec, never below `minRate`, because
//      very slow speech is distracting and lip movements stop matching.
//   3. If even `minRate` is not enough, the video holds (pauses) at the end
//      of the segment for the remaining time, then carries on by itself.
//
// Pure: no DOM. The player calls `planPacing` once per transcript or reading
// speed, then asks `paceAt` every frame.

/** Typical caption reading speeds, words per minute. Starting points the
 *  person adjusts, not a judgement about them. */
export const READING_SPEEDS = Object.freeze({ slow: 90, medium: 130, fast: 180 });

export const DEFAULTS = Object.freeze({
  wpm: READING_SPEEDS.medium,
  minRate: 0.5,      // slowest the video plays
  maxRate: 1.0,      // never speed up past normal
  minReadSec: 1.0,   // every caption is up for at least this long
  holdIfNeeded: true // pause at the end of a segment when minRate isn't enough
});

const wordCount = (text) => (String(text).trim().match(/\S+/g) || []).length;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @typedef {import('./timed-transcript.js').Segment} Segment
 * @typedef {Segment & { readSec: number, rate: number, holdSec: number, slowed: boolean }} PacedSegment
 */

/**
 * Seconds a reader at `wpm` needs for `text`.
 * @param {string} text
 * @param {number} wpm
 * @param {number} [minReadSec]
 */
export function readingTime(text, wpm, minReadSec = DEFAULTS.minReadSec) {
  return Math.max(minReadSec, (wordCount(text) / Math.max(1, wpm)) * 60);
}

/**
 * Work out a playback rate (and any hold) for every segment.
 * @param {Segment[]} segments
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {PacedSegment[]}
 */
export function planPacing(segments, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return (segments || []).map((seg) => {
    const speechSec = seg.end - seg.start;
    const readSec = readingTime(seg.text, o.wpm, o.minReadSec);
    let rate = speechSec / readSec;
    rate = Math.min(o.maxRate, Math.max(o.minRate, rate));
    const playedSec = speechSec / rate;
    const holdSec = o.holdIfNeeded ? Math.max(0, readSec - playedSec) : 0;
    return { ...seg, readSec: round2(readSec), rate: round2(rate), holdSec: round2(holdSec), slowed: rate < o.maxRate - 0.005 };
  });
}

/**
 * Summary for the screen: how much longer the paced video takes.
 * @param {PacedSegment[]} paced
 * @param {number} mediaDuration seconds
 */
export function pacingSummary(paced, mediaDuration) {
  let extra = 0, slowed = 0, held = 0;
  for (const p of paced) {
    const speech = p.end - p.start;
    extra += speech / p.rate - speech + p.holdSec;
    if (p.slowed) slowed++;
    if (p.holdSec > 0) held++;
  }
  const total = (mediaDuration || 0) + extra;
  return { extraSec: round2(extra), pacedDurationSec: round2(total), slowedCount: slowed, heldCount: held, segmentCount: paced.length };
}

/**
 * Words per minute from a timed reading check: the person reads `text` and
 * taps when done.
 * @param {string} text
 * @param {number} seconds
 */
export function wpmFromReadingCheck(text, seconds) {
  if (!(seconds > 0)) return null;
  const wpm = (wordCount(text) / seconds) * 60;
  return Math.round(Math.max(40, Math.min(300, wpm)));
}

/**
 * The reading speed as a modality-neutral need for the toolkit's
 * AbilityModel (toolkit/core/ability.js), so the person sets it once and
 * every caption surface can read it.
 * @param {number} wpm
 */
export function readingSpeedNeed(wpm) {
  return { dimension: 'captionReadingWpm', value: Math.round(wpm), strength: 'preference', source: 'captionflow' };
}
