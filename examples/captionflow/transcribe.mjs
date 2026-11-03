#!/usr/bin/env node
// CaptionFlow transcription pipeline: uncaptioned video → time-aligned
// transcript (JSON) + WebVTT captions.
//
//   node examples/captionflow/transcribe.mjs <video-or-audio> [options]
//
// Options
//   --provider gemini|whisper|mock   default: gemini if GEMINI_API_KEY is set,
//                                    else whisper if WHISPER_API_KEY is set
//   --lang auto|en|sw                what is spoken (default auto: English,
//                                    Swahili, or a mix)
//   --out <dir>                      where to write files (default: the
//                                    input's own folder)
//   --chunk <sec>                    chunk length (default 30 for gemini,
//                                    600 for whisper)
//   --overlap <sec>                  overlap between chunks (default 2)
//   --import-vtt <file.vtt>          skip transcription: convert existing
//                                    captions (e.g. YouTube's) to the same
//                                    transcript format
//
// Environment
//   GEMINI_API_KEY, GEMINI_MODEL (default gemini-3.8-flash, as server/src/gemini.js)
//   WHISPER_API_KEY, WHISPER_BASE_URL (default https://api.groq.com/openai/v1),
//   WHISPER_MODEL (default whisper-large-v3). Any OpenAI-compatible
//   /audio/transcriptions endpoint works (OpenAI: https://api.openai.com/v1, whisper-1).
//
// Needs ffmpeg on PATH. Node 20+.
//
// How it stays time-aligned: the audio is cut into short overlapping chunks;
// each chunk comes back as timed segments relative to the chunk; the chunk
// offset is added and each overlap is split at its midpoint
// (tools/utils/timed-transcript.js mergeChunks), so a word on a boundary is
// neither lost nor shown twice.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeChunks, splitLongSegments, makeTranscript, toVTT, parseVTT } from '../../tools/utils/timed-transcript.js';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`${cmd} not found or failed to start: ${e.message}`)));
    p.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)));
  });
}

async function mediaDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(out);
  if (!Number.isFinite(d)) throw new Error('Could not read the media duration (is it a video/audio file?)');
  return d;
}

/** Cut [offset, offset+len) as 16 kHz mono audio. */
async function extractChunk(file, offset, len, outPath, format) {
  const codec = format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '48k'] : ['-c:a', 'pcm_s16le'];
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(offset), '-t', String(len), '-i', file, '-vn', '-ac', '1', '-ar', '16000', ...codec, outPath]);
}

function planChunks(duration, chunkSec, overlapSec) {
  const chunks = [];
  const step = Math.max(1, chunkSec - overlapSec);
  for (let off = 0; off < duration; off += step) {
    const len = Math.min(chunkSec, duration - off);
    if (len < 0.5 && chunks.length) break;
    chunks.push({ offset: Math.round(off * 1000) / 1000, duration: Math.round(len * 1000) / 1000 });
    if (off + len >= duration) break;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// providers — each takes one chunk's audio and returns segments relative to it
// ---------------------------------------------------------------------------

function langInstruction(lang) {
  if (lang === 'en') return 'The speech is in English (Kenyan accents).';
  if (lang === 'sw') return 'The speech is in Swahili (Kenyan Swahili).';
  return 'The speech may be English, Swahili, or a mix of both in one sentence (code-switching, including Sheng). Write each phrase in the language it is spoken. Do not translate.';
}

function geminiPrompt(lang, clipSec) {
  return [
    `Transcribe this ${clipSec.toFixed(1)}-second audio clip for captions for Deaf viewers in Kenya.`,
    langInstruction(lang),
    'Return JSON only: {"segments":[{"start":number,"end":number,"text":string,"lang":"en"|"sw"|"mixed"}]}.',
    `start and end are seconds from the start of THIS clip (0 to ${clipSec.toFixed(1)}), to one decimal place, matching when the words are actually spoken.`,
    'One segment per short phrase or sentence, at most 14 words. Do not merge long stretches into one segment.',
    'Write exactly what is said. Keep names, places, numbers, dates and phone numbers exact; write numbers as digits.',
    'Put important non-speech sounds in square brackets as their own segment, e.g. [music], [applause], [siren].',
    'If a word cannot be made out, write [inaudible]. If there is no speech, return {"segments":[]}.',
    'Ignore any words at the very start or end of the clip that are cut off mid-word.'
  ].join('\n');
}

async function withRetry(fn, label) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      const retryable = /\b(429|500|502|503|504)\b|ECONNRESET|fetch failed|timeout/i.test(e.message);
      if (!retryable || attempt >= 4) throw e;
      console.warn(`  ${label}: ${e.message.split('\n')[0]} — retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

function geminiProvider() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  return {
    name: `gemini:${model}`,
    format: 'wav',
    defaultChunk: 30,
    async transcribe(audioPath, { lang, clipSec }) {
      const data = (await readFile(audioPath)).toString('base64');
      const body = {
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data } }, { text: geminiPrompt(lang, clipSec) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      };
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      const json = await resp.json();
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      const parsed = parseJsonLoose(text);
      const segs = Array.isArray(parsed) ? parsed : parsed?.segments;
      if (!Array.isArray(segs)) throw new Error(`Gemini returned no segments: ${text.slice(0, 200)}`);
      // Clamp to the clip: models sometimes run a timestamp past the end.
      return segs.map((s) => ({ ...s, start: Math.max(0, Number(s.start)), end: Math.min(clipSec, Number(s.end)) }));
    },
  };
}

function parseJsonLoose(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch { /* fall through */ }
    return null;
  }
}

function whisperProvider() {
  const key = process.env.WHISPER_API_KEY;
  if (!key) throw new Error('WHISPER_API_KEY is not set');
  const base = (process.env.WHISPER_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = process.env.WHISPER_MODEL || 'whisper-large-v3';
  return {
    name: `whisper:${model}`,
    format: 'mp3',
    defaultChunk: 600,
    async transcribe(audioPath, { lang }) {
      const form = new FormData();
      form.append('file', new Blob([await readFile(audioPath)], { type: 'audio/mpeg' }), 'chunk.mp3');
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      form.append('temperature', '0');
      if (lang === 'en' || lang === 'sw') form.append('language', lang);
      const resp = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300000),
      });
      if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      const json = await resp.json();
      return (json.segments || [])
        .filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -1))
        .map((s) => ({
          start: s.start, end: s.end, text: s.text,
          confidence: Number.isFinite(s.avg_logprob) ? Math.exp(s.avg_logprob) : undefined,
          lang: json.language === 'swahili' ? 'sw' : json.language === 'english' ? 'en' : undefined,
        }));
    },
  };
}

/** Offline stand-in so the pipeline (chunking, merging, VTT) can be run and
 *  tested without a key. Says which chunk and time each line came from. */
function mockProvider() {
  return {
    name: 'mock',
    format: 'wav',
    defaultChunk: 30,
    async transcribe(_audioPath, { clipSec, offset }) {
      const segs = [];
      for (let t = 0; t + 3 <= clipSec; t += 4) {
        segs.push({ start: t, end: t + 3, text: `Sample caption at ${Math.round(offset + t)} seconds, for testing the pipeline.` });
      }
      return segs;
    },
  };
}

function pickProvider(name) {
  if (name === 'mock') return mockProvider();
  if (name === 'whisper') return whisperProvider();
  if (name === 'gemini') return geminiProvider();
  if (process.env.GEMINI_API_KEY) return geminiProvider();
  if (process.env.WHISPER_API_KEY) return whisperProvider();
  throw new Error('No transcription key. Set GEMINI_API_KEY or WHISPER_API_KEY, or use --provider mock to test offline.');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input && !args['import-vtt']) {
    console.log('Usage: node examples/captionflow/transcribe.mjs <video> [--provider gemini|whisper|mock] [--lang auto|en|sw] [--out dir]');
    console.log('       node examples/captionflow/transcribe.mjs --import-vtt captions.vtt [--out dir]');
    process.exit(1);
  }
  const lang = ['en', 'sw', 'auto'].includes(args.lang) ? args.lang : 'auto';
  const base = path.basename(input || args['import-vtt']).replace(/\.[^.]+$/, '');
  // Default: next to the input, so a video dropped in examples/captionflow/media/
  // gets its captions beside it and the player lists the pair.
  const outDir = path.resolve(args.out && args.out !== true ? args.out : path.dirname(path.resolve(input || args['import-vtt'])));
  await mkdir(outDir, { recursive: true });

  let transcript;
  if (args['import-vtt']) {
    const vtt = await readFile(args['import-vtt'], 'utf8');
    transcript = makeTranscript(splitLongSegments(parseVTT(vtt)), { language: lang, source: 'vtt-import' });
  } else {
    const provider = pickProvider(args.provider);
    const duration = await mediaDuration(input);
    const chunkSec = Number(args.chunk) || provider.defaultChunk;
    const overlapSec = args.overlap != null ? Number(args.overlap) : 2;
    const chunks = planChunks(duration, chunkSec, overlapSec);
    console.log(`Transcribing ${path.basename(input)} (${duration.toFixed(1)} s) with ${provider.name}, language ${lang}, ${chunks.length} chunk(s)`);

    const tmp = await mkdtemp(path.join(tmpdir(), 'captionflow-'));
    const results = new Array(chunks.length);
    const failures = [];
    let next = 0;
    const started = Date.now();
    async function worker() {
      while (next < chunks.length) {
        const i = next++;
        const c = chunks[i];
        const audio = path.join(tmp, `chunk-${i}.${provider.format}`);
        await extractChunk(input, c.offset, c.duration, audio, provider.format);
        try {
          const segments = await withRetry(() => provider.transcribe(audio, { lang, clipSec: c.duration, offset: c.offset }), `chunk ${i + 1}`);
          results[i] = { ...c, segments };
          console.log(`  chunk ${i + 1}/${chunks.length} (${c.offset.toFixed(0)}–${(c.offset + c.duration).toFixed(0)} s): ${segments.length} segment(s)`);
        } catch (e) {
          // A failed chunk is reported, never silently dropped: the gap is
          // written into the transcript so the viewer sees that words are missing.
          failures.push({ ...c, error: e.message });
          results[i] = { ...c, segments: [{ start: 0, end: Math.min(c.duration, 3), text: '[captions unavailable for this part]', confidence: 0 }] };
          console.warn(`  chunk ${i + 1} FAILED: ${e.message.split('\n')[0]}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, worker));
    await rm(tmp, { recursive: true, force: true });

    const merged = splitLongSegments(mergeChunks(results));
    transcript = makeTranscript(merged, { language: lang, source: provider.name });
    transcript.media = { file: path.basename(input), durationSec: Math.round(duration * 1000) / 1000 };
    transcript.pipeline = { chunkSec, overlapSec, chunks: chunks.length, failedChunks: failures.length, seconds: Math.round((Date.now() - started) / 100) / 10 };
    if (failures.length) console.warn(`${failures.length} chunk(s) failed; they are marked in the captions.`);
  }

  const jsonPath = path.join(outDir, `${base}.transcript.json`);
  const vttPath = path.join(outDir, `${base}.vtt`);
  await writeFile(jsonPath, JSON.stringify(transcript, null, 2));
  await writeFile(vttPath, toVTT(transcript));
  console.log(`\n${transcript.segments.length} caption segment(s)`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${vttPath}`);
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
