// timed-transcript.js — the one shape a time-aligned transcript takes, and the
// pure helpers every caption step shares (CaptionFlow).
//
// Why this exists: the transcription paths in this project return text with
// no timing (`{ type, text }` from transcribeVideo) or chunk-level timing
// ([{ startSec, endSec, text }] from the extension's transcribeMedia). Plain
// captions, translation and pacing to the reader all need to know WHEN each
// phrase is said, so they all read this shape instead:
//
//   {
//     version: 1,
//     language: 'en' | 'sw' | 'mixed' | 'auto' | …,
//     source:   'gemini' | 'whisper' | 'vtt-import' | …,
//     segments: [
//       { start: 12.4, end: 15.9, text: 'Wizara ya Afya imetangaza…',
//         confidence?: 0..1, lang?: 'sw' }
//     ]
//   }
//
// Times are seconds from the start of the media. Segments are sorted, do not
// overlap, and each holds one phrase short enough for a two-line caption.
//
// Pure: no DOM, no network, no Node APIs. The transcription CLI, the demo
// player and (later) an adapter all import it.

export const TRANSCRIPT_VERSION = 1;

/**
 * @typedef {Object} Segment
 * @property {number} start       seconds
 * @property {number} end         seconds, > start
 * @property {string} text
 * @property {number} [confidence] 0..1, when the engine reports one
 * @property {string} [lang]      language of this segment, when it differs
 *
 * @typedef {Object} TimedTranscript
 * @property {number} version
 * @property {string} language
 * @property {string} source
 * @property {Segment[]} segments
 */

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Clean one raw segment. Returns null when it has no usable text or time.
 * @param {any} s
 * @returns {Segment|null}
 */
export function normalizeSegment(s) {
  if (!s || typeof s !== 'object') return null;
  const start = Number(s.start ?? s.startSec);
  const end = Number(s.end ?? s.endSec);
  const text = String(s.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  /** @type {Segment} */
  const out = { start: round(start), end: round(end), text };
  const c = Number(s.confidence);
  if (s.confidence != null && Number.isFinite(c)) out.confidence = Math.max(0, Math.min(1, c));
  if (s.lang) out.lang = String(s.lang);
  return out;
}

/**
 * Sort segments, drop bad ones, and trim overlaps so each segment ends
 * before the next begins.
 * @param {any[]} segments
 * @returns {Segment[]}
 */
export function cleanSegments(segments) {
  const list = (segments || []).map(normalizeSegment).filter(Boolean);
  list.sort((a, b) => a.start - b.start || a.end - b.end);
  /** @type {Segment[]} */
  const out = [];
  for (const seg of list) {
    const prev = out[out.length - 1];
    if (prev && seg.start < prev.end) {
      // Same phrase twice (overlapping chunks heard it both times): keep one.
      if (sameText(prev.text, seg.text)) {
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      prev.end = seg.start;
      if (prev.end - prev.start < 0.2) out.pop();
    }
    out.push({ ...seg });
  }
  return out;
}

function sameText(a, b) {
  const n = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return n(a) === n(b);
}

/**
 * Join per-chunk results into one transcript. Chunks overlap by a few
 * seconds so no word is cut in half at a boundary; each overlap is split at
 * its midpoint, and a segment belongs to the chunk on whose side of that
 * cut the segment's own middle falls.
 *
 * @param {{ offset: number, duration: number, segments: any[] }[]} chunks
 *   `segments` times are relative to the chunk; `offset` is where the chunk
 *   starts in the media.
 * @returns {Segment[]}
 */
export function mergeChunks(chunks) {
  const sorted = [...(chunks || [])].sort((a, b) => a.offset - b.offset);
  const all = [];
  sorted.forEach((chunk, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const from = prev ? (chunk.offset + Math.min(prev.offset + prev.duration, chunk.offset + chunk.duration)) / 2 : -Infinity;
    const to = next ? (next.offset + Math.min(chunk.offset + chunk.duration, next.offset + next.duration)) / 2 : Infinity;
    for (const raw of chunk.segments || []) {
      const seg = normalizeSegment({ ...raw, start: Number(raw.start ?? raw.startSec) + chunk.offset, end: Number(raw.end ?? raw.endSec) + chunk.offset });
      if (!seg) continue;
      // Judge by the segment's middle, not its start: a phrase that begins
      // just before the cut is heard whole only by the later chunk.
      const mid = (seg.start + seg.end) / 2;
      if (mid >= from && mid < to) all.push(seg);
    }
  });
  return cleanSegments(all);
}

/**
 * Split segments that are too long to read as one caption, at sentence or
 * comma boundaries, sharing the time by word count.
 * @param {Segment[]} segments
 * @param {{ maxWords?: number }} [opts]
 * @returns {Segment[]}
 */
export function splitLongSegments(segments, { maxWords = 14 } = {}) {
  const out = [];
  for (const seg of segments) {
    const words = seg.text.split(' ');
    if (words.length <= maxWords) { out.push(seg); continue; }
    const pieces = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      const breakHere = /[.!?;:,]$/.test(w) && cur.length >= Math.ceil(maxWords / 2);
      if (breakHere || cur.length >= maxWords) { pieces.push(cur); cur = []; }
    }
    if (cur.length) {
      if (cur.length < 3 && pieces.length) pieces[pieces.length - 1].push(...cur);
      else pieces.push(cur);
    }
    const total = words.length;
    const span = seg.end - seg.start;
    let t = seg.start;
    pieces.forEach((p, i) => {
      const end = i === pieces.length - 1 ? seg.end : round(t + span * (p.length / total));
      out.push({ ...seg, start: round(t), end, text: p.join(' ') });
      t = end;
    });
  }
  return out;
}

/**
 * Build a transcript object.
 * @param {any[]} segments
 * @param {{ language?: string, source?: string }} [meta]
 * @returns {TimedTranscript}
 */
export function makeTranscript(segments, { language = 'auto', source = 'unknown' } = {}) {
  return { version: TRANSCRIPT_VERSION, language, source, segments: cleanSegments(segments) };
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

function vttTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

function parseVttTime(t) {
  const parts = t.trim().replace(',', '.').split(':');
  let sec = 0;
  for (const p of parts) sec = sec * 60 + parseFloat(p);
  return sec;
}

/**
 * @param {Segment[]|TimedTranscript} input
 * @returns {string}
 */
export function toVTT(input) {
  const segments = Array.isArray(input) ? input : input.segments;
  let out = 'WEBVTT\n\n';
  segments.forEach((s, i) => {
    out += `${i + 1}\n${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text}\n\n`;
  });
  return out;
}

/**
 * Read a WebVTT (or SRT) file into segments. Inline tags (<c>, <00:00:01.000>,
 * <v Speaker>) are dropped; YouTube's rolling auto-captions repeat each line
 * in the next cue, so a cue whose text starts with the previous cue's text
 * keeps only the new words.
 * @param {string} text
 * @returns {Segment[]}
 */
export function parseVTT(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  const segs = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = parseVttTime(a);
    const end = parseVttTime(b.trim().split(/\s+/)[0]);
    const body = lines.slice(ti + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!body) continue;
    const prev = segs[segs.length - 1];
    if (prev && body.startsWith(prev.text) && body.length > prev.text.length) {
      segs.push({ start, end, text: body.slice(prev.text.length).trim() });
    } else if (prev && body === prev.text) {
      prev.end = Math.max(prev.end, end);
    } else {
      segs.push({ start, end, text: body });
    }
  }
  return cleanSegments(segs);
}

/**
 * Accept whatever a caption file or provider handed over: a TimedTranscript,
 * a bare segment array, the extension's [{startSec,endSec,text}] chunks, or a
 * VTT/SRT string.
 * @param {any} input
 * @returns {TimedTranscript}
 */
export function readTranscript(input) {
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) return readTranscript(JSON.parse(t));
    return makeTranscript(parseVTT(t), { source: 'vtt-import' });
  }
  if (Array.isArray(input)) return makeTranscript(input, { source: 'segments' });
  if (input && Array.isArray(input.segments)) {
    return makeTranscript(input.segments, { language: input.language, source: input.source });
  }
  throw new Error('Not a transcript: expected VTT text, a segment array, or { segments }');
}

/**
 * Index of the segment playing at `t`, or -1 between segments.
 * Binary search, since the player calls this every frame.
 * @param {Segment[]} segments
 * @param {number} t
 */
export function segmentAt(segments, t) {
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}
