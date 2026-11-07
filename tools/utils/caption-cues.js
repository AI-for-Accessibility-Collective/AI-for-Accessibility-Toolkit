// caption-cues.js — turn a timed transcript into caption cues a viewer can
// follow (CaptionFlow).
//
// The question this answers: how do we turn transcription into captions a
// viewer can comfortably follow without changing meaning?
//
// The rule that protects meaning: a cue never rewrites a word. The words that
// go in are the words that come out, in the same order (see `sameWords`).
// This module only decides where a cue starts and ends, where its line breaks
// fall, and how long it stays on screen. Simplifying wording is a separate
// step that needs a human or a reviewed model, and is not done here.
//
// The layout follows the DCMP Captioning Key (dcmp.org/captioningkey):
//   - at most two lines per caption, placed at the bottom of the screen;
//   - each caption on screen for at least 1 s 10 frames and at most 6 s;
//   - a presentation rate of 160 words per minute (DCMP's upper level).
//
// Where the key gives a range, the defaults below are starting points the
// caller can change. `maxCharsPerLine` is a common reading guideline rather
// than a DCMP figure.
//
// Pure: no DOM, no network, no Node APIs.

import { cleanSegments } from './timed-transcript.js';

export const CUE_VERSION = 1;

export const DCMP = Object.freeze({
  maxLines: 2,
  maxSeconds: 6,
  presentationWpm: 160,
  minFrames: 10,
  defaultFrameRate: 30,
  maxCharsPerLine: 32,
});

const SENTENCE_END = /[.!?]$/;
const BREAK_PUNCTUATION = /[.!?,;:]$/;

/**
 * @typedef {Object} Cue
 * @property {number} index
 * @property {number} startSeconds
 * @property {number} endSeconds
 * @property {string[]} lines       one entry per line on screen
 * @property {string} text          the lines joined with a space
 * @property {number} wordCount
 * @property {boolean} tooFast      true when 160 wpm cannot fit before the next cue
 * @property {boolean} overflow     true when one word is wider than a line
 *
 * @typedef {Object} CueOptions
 * @property {number} [maxCharsPerLine]
 * @property {number} [maxSeconds]
 * @property {number} [presentationWpm]
 * @property {number} [frameRate]
 */

/** Minimum on-screen time in seconds: 1 s plus `minFrames` at `frameRate`. */
export function minCueSeconds(frameRate = DCMP.defaultFrameRate) {
  return 1 + DCMP.minFrames / frameRate;
}

/** Seconds a reader at `wpm` needs for `wordCount` words. */
export function presentationSeconds(wordCount, wpm = DCMP.presentationWpm) {
  return (wordCount * 60) / wpm;
}

/**
 * Split one line's worth of words into at most `maxLines` lines, or return
 * null when the words cannot fit. With two lines, the break is placed nearest
 * the middle, and a break after punctuation is preferred.
 * @param {string[]} words
 * @param {number} maxChars
 * @returns {string[]|null}
 */
export function layoutLines(words, maxChars) {
  const whole = words.join(' ');
  if (whole.length <= maxChars) return [whole];
  let best = null;
  let bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    const first = words.slice(0, k).join(' ');
    const second = words.slice(k).join(' ');
    if (first.length > maxChars || second.length > maxChars) continue;
    const score = Math.abs(first.length - second.length) - (BREAK_PUNCTUATION.test(words[k - 1]) ? 4 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [first, second];
    }
  }
  return best;
}

/**
 * @param {import('./timed-transcript.js').Segment[]} segments
 * @returns {{ text: string, start: number, end: number }[]}
 */
function wordsWithTiming(segments) {
  const words = [];
  for (const seg of segments) {
    const parts = seg.text.split(' ');
    const span = seg.end - seg.start;
    parts.forEach((text, i) => {
      words.push({
        text,
        start: seg.start + (span * i) / parts.length,
        end: seg.start + (span * (i + 1)) / parts.length,
      });
    });
  }
  return words;
}

/**
 * Group words into cues. A cue closes when the next word would not fit two
 * lines or would run past `maxSeconds`, and after a sentence end.
 * @param {{ text: string, start: number, end: number }[]} words
 * @param {{ maxCharsPerLine: number, maxSeconds: number }} limits
 */
function packWords(words, limits) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  const spanOf = (group) => group[group.length - 1].end - group[0].start;

  for (const word of words) {
    const candidate = [...current, word].map((w) => w.text);
    const fits = layoutLines(candidate, limits.maxCharsPerLine) !== null
      && spanOf([...current, word]) <= limits.maxSeconds;
    if (current.length && !fits) flush();
    current.push(word);
    if (SENTENCE_END.test(word.text)) flush();
  }
  flush();
  return groups;
}

/**
 * Build caption cues from a transcript or a list of segments.
 * @param {import('./timed-transcript.js').Segment[] | { segments: import('./timed-transcript.js').Segment[] }} input
 * @param {CueOptions} [options]
 * @returns {Cue[]}
 */
export function buildCues(input, options = {}) {
  const segments = cleanSegments(Array.isArray(input) ? input : input.segments);
  const limits = {
    maxCharsPerLine: options.maxCharsPerLine ?? DCMP.maxCharsPerLine,
    maxSeconds: options.maxSeconds ?? DCMP.maxSeconds,
  };
  const wpm = options.presentationWpm ?? DCMP.presentationWpm;
  const minSeconds = minCueSeconds(options.frameRate ?? DCMP.defaultFrameRate);

  const groups = packWords(wordsWithTiming(segments), limits);
  const cues = groups.map((group, index) => {
    const texts = group.map((w) => w.text);
    const lines = layoutLines(texts, limits.maxCharsPerLine);
    return {
      index,
      startSeconds: group[0].start,
      endSeconds: group[group.length - 1].end,
      lines: lines ?? [texts.join(' ')],
      text: texts.join(' '),
      wordCount: texts.length,
      tooFast: false,
      overflow: lines === null,
    };
  });

  cues.forEach((cue, i) => {
    const next = cues[i + 1];
    const wanted = Math.max(minSeconds, presentationSeconds(cue.wordCount, wpm));
    const available = next ? next.startSeconds : Infinity;
    const endSeconds = Math.min(cue.startSeconds + wanted, available);
    if (endSeconds > cue.endSeconds) cue.endSeconds = round(endSeconds);
    cue.tooFast = cue.endSeconds - cue.startSeconds + 1e-9 < wanted;
    cue.startSeconds = round(cue.startSeconds);
  });

  return cues;
}

/**
 * The meaning guard: true when the cues contain exactly the transcript's
 * words, in order. Use it in tests and before publishing cues.
 * @param {import('./timed-transcript.js').Segment[] | { segments: import('./timed-transcript.js').Segment[] }} input
 * @param {Cue[]} cues
 */
export function sameWords(input, cues) {
  const source = cleanSegments(Array.isArray(input) ? input : input.segments)
    .flatMap((seg) => seg.text.split(' '));
  const shown = cues.flatMap((cue) => cue.text.split(' '));
  return source.length === shown.length && source.every((word, i) => word === shown[i]);
}

const round = (n) => Math.round(n * 1000) / 1000;
