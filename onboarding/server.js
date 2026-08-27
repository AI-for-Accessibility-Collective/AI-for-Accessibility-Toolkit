#!/usr/bin/env node
// Onboarding — a tiny web service for capturing a person's accessibility needs
// into a toolkit ability profile, and (with the admin password) listing and
// deleting profiles.
//
// It talks to the toolkit in one of two modes, chosen by env:
//   ONBOARD_MODE=local  — embeds the toolkit in-process over a file store
//                         (DATA_DIR); this process IS the toolkit host.
//   ONBOARD_MODE=remote — proxies to a running toolkit server (TOOLKIT_URL),
//                         using ADMIN_PASSWORD to mint per-user tokens.
//
// Env:
//   ONBOARD_MODE    local | remote            (default: local)
//   PORT            listen port               (default: 4000)
//   ADMIN_PASSWORD  gates the list/delete admin view. In remote mode it must
//                   equal the target server's ADMIN_PASSWORD (used to mint
//                   tokens + call /admin/users). If unset, admin is disabled.
//   DATA_DIR        (local) file-store dir    (default: ./onboarding-data)
//   TOOLKIT_URL     (remote) base URL         (default: http://127.0.0.1:8080)
//
// Zero dependencies (node:http). Local mode reuses server/src/{store,toolkit-host}.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODE = (process.env.ONBOARD_MODE || 'local').toLowerCase();
const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'onboarding-data');
const TOOLKIT_URL = (process.env.TOOLKIT_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

// The Controller UI (toolkit/controller) is served from THIS same port at
// /controller. Its ESM modules load statically under /controller/lib, and the
// shared settings vocabulary under /controller/registry.
const TOOLKIT_DIR = path.join(__dirname, '..', 'toolkit');
const CONTROLLER_DIR = path.join(TOOLKIT_DIR, 'controller');
const REGISTRY_DIR = path.join(TOOLKIT_DIR, 'registry');

// Support-area vocabulary (mirrors the toolkit's ability dimensions). The UI
// offers these; onboarding accepts any subset.
const SUPPORT_AREAS = ['vision', 'reading', 'cognitive', 'motor', 'hearing', 'sensory', 'attention'];

// ── Local mode: embed the toolkit over a file store ─────────────────────────
let _localHost = null, _localStore = null;
async function localBits() {
  if (!_localHost) {
    const { fileStore } = await import('../server/src/store.js');
    const { createToolkitHost } = await import('../server/src/toolkit-host.js');
    _localStore = fileStore(DATA_DIR);
    // Onboarding never needs the LLM lane; a throwing caller satisfies the
    // required-function contract without pretending to have a key.
    _localHost = createToolkitHost({
      store: _localStore,
      geminiCaller: async () => { throw new Error('no-llm-in-onboarding'); },
    });
  }
  return { host: _localHost, store: _localStore };
}

// ── Remote mode: fetch helpers against the toolkit server ───────────────────
async function remoteAdmin(method, urlPath, body) {
  const resp = await fetch(TOOLKIT_URL + urlPath, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + ADMIN_PASSWORD,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
}
async function remoteLibrarian(token, method, args) {
  const resp = await fetch(TOOLKIT_URL + '/v1/librarian/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ args }),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
}

// ── Onboarding: capture supportAreas + free-text need into a profile ────────
function genUid() {
  return 'user-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Default STRUCTURED needs per support area. The toolkit deliberately projects
// an empty `needs[]` from supportAreas/freeText alone (see toolkit/core/
// ability.js) — so without this, every onboarded profile contributes NO
// baseline settings. We seed `fields.needs` with sensible defaults keyed to the
// neutral dimensions the surfaces understand (toolkit WEB_DERIVATION: textSize,
// contrast, lineSpacing, dyslexiaFont, simplify, reduceMotion, captions, …).
// Strength is 'preference' (a soft baseline a later explicit user edit —
// 'floor' — overrides). Motor has no neutral web dimension in the current
// vocabulary, so it seeds nothing.
//
// `vision` is handled specially (see deriveDefaultNeeds): it spans two OPPOSITE
// populations — low vision (wants magnification) and blindness (wants
// screen-reader structure, and for whom magnification is the WRONG modality) —
// so it cannot be one static row; we disambiguate from the free text.
const DEFAULT_NEEDS_BY_AREA = {
  reading:   [{ dimension: 'lineSpacing', value: 1.8 }, { dimension: 'dyslexiaFont', value: true }, { dimension: 'simplify', value: true }],
  cognitive: [{ dimension: 'simplify', value: true }, { dimension: 'reduceMotion', value: true }],
  hearing:   [{ dimension: 'captions', value: true }],
  sensory:   [{ dimension: 'reduceMotion', value: true }],
  attention: [{ dimension: 'simplify', value: true }, { dimension: 'reduceMotion', value: true }],
  motor:     [],
};

// The low-vision baseline (magnification + high contrast). NOT applied to a
// blind screen-reader user.
const LOW_VISION_NEEDS = [{ dimension: 'textSize', value: 1.5 }, { dimension: 'contrast', value: 'yellow-black' }];

// Which visual population does the free text describe? A blind screen-reader
// user needs the OPPOSITE of magnification, so we must not treat "vision" as one
// answer. Heuristic only (a keyword read beats shipping the wrong modality;
// interpreting the sentence with the LLM as a *proposal* is the principled next
// step). Excludes "colour blind" (a colour-vision deficiency, not blindness) and
// "legally blind" (often retains usable vision → magnification can still help).
function isBlindText(freeText) {
  const t = String(freeText || '').toLowerCase();
  if (/colou?r[- ]?blind/.test(t)) return false;
  if (/\bscreen[- ]?reader\b|\bvoice ?over\b|\bnvda\b|\bjaws\b|\btalkback\b/.test(t)) return true;
  if (/\bcan'?t see\b|\bcannot see\b|\bunable to see\b|\bno (usable |functional )?vision\b|\b(totally|completely|fully) blind\b/.test(t)) return true;
  return /\bblind\b/.test(t) && !/\blegally blind\b/.test(t);
}

// Derive a de-duplicated `fields.needs` array from the support areas + free text.
function deriveDefaultNeeds(areas, freeText) {
  const byDimension = new Map(); // dimension → need (last writer wins, stable de-dupe)
  const add = (n) => byDimension.set(n.dimension, { dimension: n.dimension, value: n.value, strength: 'preference', source: 'onboarding-derived' });

  for (const area of areas) {
    if (area === 'vision') {
      // Blind → derive NO visual settings. The neutral vocabulary cannot yet
      // express screen-reader needs (structure/landmarks/descriptions/live
      // regions), so an empty visual baseline is the honest state — far better
      // than pushing magnification a blind person can't use. Low vision (and
      // an unspecified "vision" pick) → the magnification baseline.
      if (isBlindText(freeText)) continue;
      for (const n of LOW_VISION_NEEDS) add(n);
      continue;
    }
    for (const n of DEFAULT_NEEDS_BY_AREA[area] || []) add(n);
  }
  return [...byDimension.values()];
}

async function onboard({ uid, supportAreas, freeText }) {
  uid = (uid && String(uid).trim()) || genUid();
  if (/[/\\.]/.test(uid) && (uid.includes('/') || uid.includes('\\') || uid.includes('..'))) {
    throw new Error('invalid uid');
  }
  const areas = (Array.isArray(supportAreas) ? supportAreas : []).filter((a) => SUPPORT_AREAS.includes(a));
  const text = (freeText || '').toString().trim();
  // Structured baseline the surfaces can render — without this, needs[] is empty.
  // Free text disambiguates the vision area (blind vs low vision).
  const needs = deriveDefaultNeeds(areas, text);

  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding' });
    if (t.status !== 200 || !t.body?.token) throw new Error('could not mint token (check TOOLKIT_URL / ADMIN_PASSWORD)');
    const token = t.body.token;
    if (areas.length) await remoteLibrarian(token, 'setProfileField', ['supportAreas', areas]);
    // Always write (even []) so a re-onboard clears stale needs — e.g. a profile
    // corrected from low-vision to blind must drop the old magnification needs.
    await remoteLibrarian(token, 'setProfileField', ['fields.needs', needs]);
    if (text) {
      await remoteLibrarian(token, 'setProfileField', ['freeText', text]);
      await remoteLibrarian(token, 'addNote', [text, { source: 'user-explicit' }]);
    }
  } else {
    const { host } = await localBits();
    const { librarian } = await host.getInstance(uid);
    if (areas.length) await librarian.setProfileField('supportAreas', areas);
    await librarian.setProfileField('fields.needs', needs); // always write — clears stale needs on re-onboard
    if (text) {
      await librarian.setProfileField('freeText', text);
      await librarian.addNote(text, { source: 'user-explicit' });
    }
  }
  return { uid, supportAreas: areas, freeText: text, needs };
}

// ── Read one profile's current configuration (for the "current profile" banner)
// Returns {exists:false} for a uid that was never onboarded — WITHOUT creating
// it (we check the profile list before touching getProfile, which would init a
// default partition).
// Read a KNOWN-existing profile's configuration (supportAreas + free-text need).
async function profileConfig(uid) {
  let profile = {};
  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding-view' });
    if (t.body?.token) {
      const r = await remoteLibrarian(t.body.token, 'getProfile', []);
      profile = r.body?.result || {};
    }
  } else {
    const { host } = await localBits();
    const { librarian } = await host.getInstance(uid);
    profile = await librarian.getProfile();
  }
  return { supportAreas: profile.supportAreas || [], freeText: profile.freeText || '' };
}

async function profileSummary(uid) {
  uid = String(uid || '').trim();
  if (!uid) return { exists: false, uid: '' };
  const exists = (await listProfileIds()).includes(uid);
  if (!exists) return { exists: false, uid };
  return { exists: true, uid, ...(await profileConfig(uid)) };
}

// ── Admin: list + delete profiles (gated by ADMIN_PASSWORD) ─────────────────
function adminOk(req) {
  if (!ADMIN_PASSWORD) return false;
  const given = req.headers['x-admin-password'] || '';
  // Constant-ish length check + compare (small tool; not a hardened secret store).
  return given.length === ADMIN_PASSWORD.length && given === ADMIN_PASSWORD;
}

async function listProfileIds() {
  if (MODE === 'remote') {
    const r = await remoteAdmin('GET', '/admin/users');
    if (r.status !== 200) throw new Error('remote list failed (' + r.status + ')');
    return r.body?.users || [];
  }
  const { store } = await localBits();
  return await store.listUsers();
}

// Each profile with its configuration — this is how the admin list renders them.
async function listProfileSummaries() {
  const ids = await listProfileIds();
  const out = [];
  for (const uid of ids) out.push({ uid, ...(await profileConfig(uid)) });
  return out;
}

async function deleteProfile(uid) {
  if (MODE === 'remote') {
    const r = await remoteAdmin('DELETE', '/admin/users/' + encodeURIComponent(uid));
    return r.status === 200;
  }
  const { store } = await localBits();
  return await store.deleteUser(uid);
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
function contentType(file) {
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}
// Serve one file from under baseDir, rejecting path traversal.
async function serveStatic(res, baseDir, rel) {
  const safe = path.normalize('/' + rel).replace(/^[/\\]+/, '');
  if (!safe || safe.includes('..')) return sendJSON(res, 400, { error: 'bad-path' });
  try {
    const data = await readFile(path.join(baseDir, safe));
    res.writeHead(200, { 'content-type': contentType(safe) });
    return res.end(data);
  } catch {
    return sendJSON(res, 404, { error: 'not-found' });
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid-json')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method;

    // The page lives at /onboarding; bare / redirects there.
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(302, { location: '/onboarding' });
      return res.end();
    }
    if (method === 'GET' && (pathname === '/onboarding' || pathname === '/onboarding/')) {
      const html = await readFile(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Controller UI at /controller. The demo's imports are relative to
    // toolkit/controller/demo/; rewrite them to the /controller/lib prefix this
    // server exposes so the same page works when served from here.
    if (method === 'GET' && (pathname === '/controller' || pathname === '/controller/')) {
      let html = await readFile(path.join(CONTROLLER_DIR, 'demo', 'index.html'), 'utf8');
      html = html.replace(/from '\.\.\//g, "from '/controller/lib/");
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (method === 'GET' && pathname.startsWith('/controller/lib/')) {
      return serveStatic(res, CONTROLLER_DIR, pathname.slice('/controller/lib/'.length));
    }
    if (method === 'GET' && pathname.startsWith('/controller/registry/')) {
      return serveStatic(res, REGISTRY_DIR, pathname.slice('/controller/registry/'.length));
    }

    if (method === 'GET' && pathname === '/api/config') {
      return sendJSON(res, 200, {
        mode: MODE,
        target: MODE === 'remote' ? TOOLKIT_URL : DATA_DIR,
        supportAreas: SUPPORT_AREAS,
        adminEnabled: !!ADMIN_PASSWORD,
      });
    }

    if (method === 'GET' && pathname === '/api/profile') {
      const uid = new URL(req.url, 'http://localhost').searchParams.get('uid') || '';
      try { return sendJSON(res, 200, await profileSummary(uid)); }
      catch (e) { return sendJSON(res, 502, { error: e.message }); }
    }

    if (method === 'POST' && pathname === '/api/onboard') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      try {
        const result = await onboard(body || {});
        return sendJSON(res, 200, { ok: true, ...result });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, error: e.message });
      }
    }

    if (pathname === '/api/profiles' || pathname.startsWith('/api/profiles/')) {
      if (!adminOk(req)) return sendJSON(res, 401, { error: ADMIN_PASSWORD ? 'unauthorized' : 'admin-not-configured' });

      if (method === 'GET' && pathname === '/api/profiles') {
        try { return sendJSON(res, 200, { profiles: await listProfileSummaries() }); }
        catch (e) { return sendJSON(res, 502, { error: e.message }); }
      }
      if (method === 'DELETE' && pathname.startsWith('/api/profiles/')) {
        const uid = decodeURIComponent(pathname.slice('/api/profiles/'.length));
        if (!uid) return sendJSON(res, 404, { error: 'not-found' });
        try {
          const ok = await deleteProfile(uid);
          return ok ? sendJSON(res, 200, { ok: true, uid }) : sendJSON(res, 404, { error: 'not-found' });
        } catch (e) { return sendJSON(res, 502, { error: e.message }); }
      }
    }

    return sendJSON(res, 404, { error: 'not-found' });
  } catch (e) {
    return sendJSON(res, 500, { error: e.message });
  }
});

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, () => {
    console.log(`[onboarding] mode=${MODE} target=${MODE === 'remote' ? TOOLKIT_URL : DATA_DIR}`);
    console.log(`[onboarding] admin ${ADMIN_PASSWORD ? 'enabled' : 'DISABLED (set ADMIN_PASSWORD to list/delete)'}`);
    console.log(`[onboarding] open http://127.0.0.1:${PORT}/onboarding`);
    console.log(`[onboarding] controller http://127.0.0.1:${PORT}/controller`);
  });
}

export { server, onboard, listProfileIds, listProfileSummaries, deleteProfile };
