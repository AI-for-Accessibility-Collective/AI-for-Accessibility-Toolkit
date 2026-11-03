#!/usr/bin/env node
// CaptionFlow demo server — serves the player to a laptop AND to phones on
// the same Wi-Fi. Zero dependencies.
//
//   node examples/captionflow/serve.mjs [--port 8080]
//
// - Serves the repository root, so the player imports the same
//   tools/utils/*.js modules the tests and the CLI use.
// - Supports HTTP Range requests, which phones need to play and seek video.
// - GET /api/media lists the videos in examples/captionflow/media/ that have a
//   transcript beside them (<name>.transcript.json or <name>.vtt).
// - Prints the address to open on a phone.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const MEDIA = path.join(here, 'media');
const PLAYER = '/examples/captionflow/player/';

const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mp3', '.m4a', '.wav', '.ogg']);

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

async function sendFile(req, res, file) {
  let info;
  try { info = await stat(file); } catch { return notFound(res); }
  if (info.isDirectory()) return sendFile(req, res, path.join(file, 'index.html'));
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] === '' ? info.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : info.size - 1;
    if (start >= info.size || start < 0 || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return res.end();
    }
    end = Math.min(end, info.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/examples/captionflow' || url.pathname === '/examples/captionflow/') {
      res.writeHead(302, { Location: PLAYER });
      return res.end();
    }
    if (url.pathname === '/api/media') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify(await listMedia()));
    }
    // Only serve inside the repository, and never dotfiles (.git, .env).
    const rel = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return notFound(res);
    if (rel.split('/').some((p) => p.startsWith('.'))) return notFound(res);
    if (rel.startsWith('/node_modules/')) return notFound(res);
    await sendFile(req, res, file);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
    console.error(e);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('CaptionFlow demo running.\n');
  console.log(`  On this laptop:  http://localhost:${PORT}${PLAYER}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  On a phone (same Wi-Fi):  http://${a.address}:${PORT}${PLAYER}`);
    }
  }
  console.log(`\nVideos with captions in ${path.relative(process.cwd(), MEDIA) || MEDIA} are listed in the player.`);
});
