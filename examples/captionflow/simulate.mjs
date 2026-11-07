#!/usr/bin/env node
// CaptionFlow simulation server: stands in for serve.mjs when there is no
// transcription key, or when the UI needs a predictable backend. It speaks the
// same HTTP contract, so the Angular dev proxy (ui/proxy.conf.json) and the
// player work unchanged. No API calls, no ffmpeg, zero dependencies.
//
//   node examples/captionflow/simulate.mjs [--port 8090]
//
// Environment:
//   PORT=8090            port (the Angular proxy targets 8090)
//   SIM_DELAY_MS=4000    how long "transcribing" takes after the upload finishes
//
// Test a failure path by adding a query parameter to the upload request:
//   ?simulate=error     answers 500 with an error message
//   ?simulate=nospeech  answers a transcript with no segments
//   ?simulate=busy      answers 429, as if another video were being captioned
//
// Uploads are read and discarded. Nothing is written to disk.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTranscript } from '../../tools/utils/timed-transcript.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const MEDIA = path.join(here, 'media');
const PLAYER = '/examples/captionflow/player/';

const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT) || 8090;
const DELAY_MS = Number(process.env.SIM_DELAY_MS ?? 4000);

const LANGUAGES = new Set(['en', 'sw', 'auto']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.mp3', '.m4a', '.wav', '.ogg']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

const PHRASES = {
  en: [
    'Welcome to the health update for this week.',
    'Clinics across the county will open early on Saturday.',
    'Please bring your card and wear a mask in the waiting room.',
    'Vaccination is free for children under five.',
    'For urgent questions, call the helpline at any time.',
    'Thank you for listening, and stay safe.',
  ],
  sw: [
    'Karibu kwenye taarifa ya afya ya wiki hii.',
    'Zahanati zote za kaunti zitafunguliwa mapema siku ya Jumamosi.',
    'Tafadhali leta kadi yako na uvae barakoa chumba cha kusubiri.',
    'Chanjo ni bure kwa watoto walio chini ya miaka mitano.',
    'Kwa maswali ya dharura, piga simu ya msaada wakati wowote.',
    'Asante kwa kusikiliza, na uwe salama.',
  ],
};

const SECONDS_PER_PHRASE = 3.2;
const BYTES_PER_SECOND = 250_000;

function simulatedDuration(bytes) {
  return Math.min(600, Math.max(6, bytes / BYTES_PER_SECOND));
}

function simulatedSegments(bytes, lang) {
  const phrases = PHRASES[lang === 'sw' ? 'sw' : 'en'];
  const total = simulatedDuration(bytes);
  const segments = [];
  for (let i = 0, t = 0; t < total; i += 1, t += SECONDS_PER_PHRASE) {
    segments.push({ start: t, end: Math.min(t + SECONDS_PER_PHRASE - 0.2, total), text: phrases[i % phrases.length] });
  }
  return segments;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function drain(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; });
    req.on('end', () => resolve(bytes));
    req.on('error', reject);
  });
}

async function handleTranscribe(req, res, url) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Send the video with POST.' });

  const fileName = path.basename(decodeURIComponent(req.headers['x-filename'] || 'video'));
  const extension = path.extname(fileName).toLowerCase();
  if (!VIDEO_EXT.has(extension)) {
    req.resume();
    return sendJson(res, 415, { error: 'Choose a video file.' });
  }

  const lang = LANGUAGES.has(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'auto';
  const simulate = url.searchParams.get('simulate');
  const bytes = await drain(req);

  if (simulate === 'busy') return sendJson(res, 429, { error: 'Another video is being captioned. Try again in a few minutes.' });
  await sleep(DELAY_MS);
  if (simulate === 'error') return sendJson(res, 500, { error: 'Simulated failure: the transcription provider did not respond.' });

  const segments = simulate === 'nospeech' ? [] : simulatedSegments(bytes, lang);
  console.log(`  simulated transcript: ${fileName}, ${segments.length} segment(s), lang=${lang}`);
  sendJson(res, 200, makeTranscript(segments, { language: lang, source: 'simulation' }));
}

async function listMedia() {
  let files = [];
  try { files = await readdir(MEDIA); } catch { return []; }
  const set = new Set(files);
  const items = [];
  for (const f of files.sort()) {
    const ext = path.extname(f).toLowerCase();
    if (!VIDEO_EXT.has(ext)) continue;
    const base = f.slice(0, -ext.length);
    const captions = set.has(`${base}.transcript.json`) ? `${base}.transcript.json` : set.has(`${base}.vtt`) ? `${base}.vtt` : null;
    items.push({
      name: base.replace(/[-_]+/g, ' '),
      video: `/examples/captionflow/media/${encodeURIComponent(f)}`,
      captions: captions ? `/examples/captionflow/media/${encodeURIComponent(captions)}` : null,
    });
  }
  return items;
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

async function sendFile(req, res, file) {
  let info;
  try { info = await stat(file); } catch { return notFound(res); }
  if (info.isDirectory()) return sendFile(req, res, path.join(file, 'index.html'));
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] === '' ? info.size - Number(range[2]) : Number(range[1]);
    const end = Math.min(range[1] !== '' && range[2] !== '' ? Number(range[2]) : info.size - 1, info.size - 1);
    if (start >= info.size || start < 0 || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/examples/captionflow' || url.pathname === '/examples/captionflow/') {
      res.writeHead(302, { Location: PLAYER });
      return res.end();
    }
    if (url.pathname === '/api/transcribe') return await handleTranscribe(req, res, url);
    if (url.pathname === '/api/media') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(await listMedia()));
    }
    const rel = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return notFound(res);
    if (rel.split('/').some((p) => p.startsWith('.')) || rel.startsWith('/node_modules/')) return notFound(res);
    await sendFile(req, res, file);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.requestTimeout = 0;
server.timeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  console.log('CaptionFlow SIMULATION server running. No real transcription happens here.\n');
  console.log(`  Transcribing takes ${DELAY_MS} ms. Add ?simulate=error|nospeech|busy to test failures.`);
  console.log(`  Player:  http://localhost:${PORT}${PLAYER}`);
  console.log(`  Angular: start it with \`npm start\` in examples/captionflow/ui (proxies /api to ${PORT}).`);
});
