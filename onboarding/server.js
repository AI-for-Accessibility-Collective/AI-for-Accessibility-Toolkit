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
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAdminPassword } from '../server/src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODE = (process.env.ONBOARD_MODE || 'local').toLowerCase();
const PORT = Number(process.env.PORT) || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'onboarding-data');
const TOOLKIT_URL = (process.env.TOOLKIT_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

// The Controller UI (the repo-root `controller/` — optional, a sibling of the
// toolkit) is served from THIS same port at /controller. Its ESM modules load
// statically under /controller/lib, and the toolkit settings vocabulary they
// import (`../toolkit/registry/tools.js`) under /controller/toolkit/registry.
const TOOLKIT_DIR = path.join(__dirname, '..', 'toolkit');
const CONTROLLER_DIR = path.join(__dirname, '..', 'controller');
const REGISTRY_DIR = path.join(TOOLKIT_DIR, 'registry');

// The ES modules /chat.html imports by absolute path. chat.js is the page's DOM
// wiring; the rest hold the logic it used to carry inline, split out so the Node
// suites can import and test them.
const CHAT_MODULES = [
  '/chat.js',
  '/chat-routing.js',
  '/chat-turn.js',
  '/chat-profile.js',
  '/chat-history.js',
];

// Support-area vocabulary (mirrors the toolkit's ability dimensions). The UI
// offers these; onboarding accepts any subset.
const SUPPORT_AREAS = ['vision', 'reading', 'cognitive', 'motor', 'hearing', 'sensory', 'attention'];

// Optional Gemini completion for the /chat surface's best-effort LLM lane
// (controller-intent classification + a general spoken answer). DEMO-scoped and
// key-gated: with no GEMINI_API_KEY on THIS process, /api/assist reports
// { available:false } and the chat degrades to deterministic-only (settings +
// onboarding still work fully). Not an open proxy for the hardened toolkit
// server — a small assist for this demo host, size-capped per request.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let _assist = null;
async function assistCaller() {
  if (!GEMINI_API_KEY) return null;
  if (!_assist) {
    const { createGeminiCaller } = await import('../server/src/gemini.js');
    _assist = createGeminiCaller({ apiKey: GEMINI_API_KEY });
  }
  return _assist;
}

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

// remoteLibrarian resolves for ANY HTTP status, so an unchecked write turns a
// failed profile save into a reported success: the person finishes onboarding,
// is handed a uid, and the profile behind it was never written. That matters
// more now that the uid IS the profile's read credential, because we would be
// handing out a capability for nothing.
//
// A failed write has TWO shapes, and the HTTP status only catches one of them.
// The service reports a transport-level problem with a non-200 status, but when
// a librarian method THROWS it answers `200 {ok:false, error}`, on purpose:
// CONTRACT.md calls application errors data, not transport failures. That is
// the shape a real outage takes. The datastore being unreachable does not make
// the HTTP request fail, it makes the method throw, and a check that reads only
// the status waves it through. So the envelope is what decides: a write
// succeeded when the service says `ok: true`, and anything else throws.
//
// Deliberately the envelope, not the method's own return value. `deleteNote`
// answering `{ok:false, reason:'not-found'}` inside a successful envelope means
// the note was already gone, which is the state we wanted. Reads stay tolerant
// too (a profile that will not load renders as empty rather than breaking the
// page); only writes throw, and the first failure stops the rest.
async function remoteWrite(token, method, args) {
  const r = await remoteLibrarian(token, method, args);
  if (r.status !== 200 || r.body?.ok !== true) {
    const detail = r.body?.error || r.body?.message || 'no detail';
    throw new Error(`profile write failed (${method}: HTTP ${r.status}, ${detail})`);
  }
  return r;
}

// The whole profile an onboarding form produces, as ONE write.
//
// Every one of these paths lives in the single `mine.profile` record, so
// writing them one at a time is four round trips against the same document
// and any failure between two of them leaves a profile that contradicts
// itself: needs derived from support areas that were never stored, or a
// vision kind the needs no longer match. Someone reading that profile is
// reading a description of a person who does not exist. Written together,
// the record either takes the new answers or keeps the old ones.
//
// Every field is written even when empty, because a re-onboard has to CLEAR
// what the person deselected. A profile corrected from low vision to blind
// must drop the old magnification needs; someone who unchecks every area must
// not keep stale supportAreas or a visionKind that then disagrees with the
// cleared needs. freeText follows the same rule and matters most, because it
// is where someone describes their own disability in their own words.
function profileFields(areas, needs, kind, text) {
  return {
    supportAreas: areas,
    'fields.needs': needs,
    'fields.visionKind': kind ?? null,
    freeText: text,
  };
}

// ── Onboarding: capture supportAreas + free-text need into a profile ────────
// A generated uid is the profile's capability: the read routes are
// unauthenticated (a person onboarding has no credential yet), so knowing the
// uid must be the credential, the way an unguessable share link works. 128
// random bits, base64url. A person can still type their own memorable id;
// the UI and README say what that trades away (a guessable id is a readable
// profile).
function genUid() {
  return 'u-' + crypto.randomBytes(16).toString('base64url');
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

// The blind / screen-reader baseline: STRUCTURE and announcements, not looks.
// These neutral dimensions render (via toolkit WEB_DERIVATION) to already-wired
// catalog adapters — image descriptions, form labels, landmark repair, live
// regions, SPA announcements, skip links, a heading outline, keyboard access —
// mirroring the catalog's `blind` preset. NO magnification and NO read-aloud (a
// screen reader owns the voice). Strength 'floor': these are hard requirements
// for a screen-reader user, not soft preferences.
const BLIND_NEEDS = [
  { dimension: 'describeImages', value: true },
  { dimension: 'labelControls', value: true },
  { dimension: 'repairLandmarks', value: true },
  { dimension: 'announceUpdates', value: true },
  { dimension: 'spaAnnounce', value: true },
  { dimension: 'skipLinks', value: true },
  // NOTE: pageStructure (on-page heading navigator) and keyboardAccess (visual
  // focus overlay + Alt-shortcuts) are intentionally NOT here — a screen reader
  // already has heading navigation, and keyboard-nav shortcuts risk colliding
  // with NVDA/JAWS. They remain in the motor/low-vision profiles. (issue #9)
];

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

// Derive a de-duplicated `fields.needs` array from the support areas.
// `visionKind` ('blind' | 'lowVision') is the FIRST-CLASS, explicit answer to
// "which vision population?" captured at onboarding. When it's absent (e.g. a
// programmatic caller that didn't ask), we fall back to the `isBlindText`
// keyword heuristic on the free text — a guess, and only ever a fallback.
function deriveDefaultNeeds(areas, freeText, visionKind) {
  const byDimension = new Map(); // dimension → need (last writer wins, stable de-dupe)
  const add = (n, strength = 'preference') => byDimension.set(n.dimension, { dimension: n.dimension, value: n.value, strength, source: 'onboarding-derived' });

  for (const area of areas) {
    if (area === 'vision') {
      // "vision" spans two OPPOSITE populations. Blind screen-reader users get
      // the STRUCTURE baseline (floor strength); low vision (or an unspecified
      // pick) gets magnification. Magnification for a blind user is the wrong
      // modality entirely — so we prefer the explicit choice, else the heuristic.
      const blind = visionKind ? visionKind === 'blind' : isBlindText(freeText);
      if (blind) { for (const n of BLIND_NEEDS) add(n, 'floor'); continue; }
      for (const n of LOW_VISION_NEEDS) add(n);
      continue;
    }
    for (const n of DEFAULT_NEEDS_BY_AREA[area] || []) add(n);
  }
  return [...byDimension.values()];
}

async function onboard({ uid, supportAreas, freeText, visionKind }) {
  const supplied = (uid && String(uid).trim()) || '';
  if (supplied.includes('/') || supplied.includes('\\') || supplied.includes('..')) {
    throw new Error('invalid uid');
  }
  // A supplied id only UPDATES the profile it names. A new profile always
  // gets a generated capability id: the id is the read credential, so no new
  // profile may sit behind a guessable, caller-chosen name. Profiles created
  // under typed ids before this rule keep working; only creation is closed.
  uid = supplied && (await listProfileIds()).includes(supplied) ? supplied : genUid();
  const areas = (Array.isArray(supportAreas) ? supportAreas : []).filter((a) => SUPPORT_AREAS.includes(a));
  const text = (freeText || '').toString().trim();
  const kind = (visionKind === 'blind' || visionKind === 'lowVision') ? visionKind : undefined;
  // Structured baseline the surfaces can render — without this, needs[] is empty.
  // The explicit vision kind (else the free-text heuristic) picks blind vs low vision.
  const needs = deriveDefaultNeeds(areas, text, kind);

  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding' });
    if (t.status !== 200 || !t.body?.token) throw new Error('could not mint token (check TOOLKIT_URL / ADMIN_PASSWORD)');
    const token = t.body.token;
    // Two records, and nothing spans them: the profile is one document, the
    // self-description note lives in a memory shard. So the ORDER decides what
    // a failure between them leaves behind. The note goes first and the
    // profile last, because the profile is the copy a person is shown (the
    // "current profile" banner reads profile.freeText). Writing it last means
    // the visible state never claims a change the other record has not already
    // made: we never tell someone their description is gone while a copy of it
    // is still stored. A failure throws, and re-running onboarding with the
    // same uid converges, because every write here is unconditional and the
    // note upserts by topic rather than appending.
    if (text) {
      // Stable topic so a re-onboard UPSERTS this note (addNote upserts by
      // topic) instead of appending a duplicate every run.
      await remoteWrite(token, 'addNote', [text, { source: 'user-explicit', topic: 'self-description' }]);
    } else {
      // Clearing the box has to clear the note too. addNote('') writes nothing
      // (it returns empty-text), and deleteNote takes an id, so the note is
      // found by topic first. Without this the person's own sentence about
      // their disability stays in the profile after they deleted it.
      const listed = await remoteWrite(token, 'listNotes', [{ topic: 'self-description' }]);
      for (const note of listed.body?.result || []) {
        await remoteWrite(token, 'deleteNote', [note.id]);
      }
    }
    await remoteWrite(token, 'setProfileFields', [profileFields(areas, needs, kind, text)]);
  } else {
    const { host } = await localBits();
    const { librarian } = await host.getInstance(uid);
    // Same order and the same single write as the remote branch.
    if (text) {
      await librarian.addNote(text, { source: 'user-explicit', topic: 'self-description' });
    } else {
      for (const note of await librarian.listNotes({ topic: 'self-description' })) {
        await librarian.deleteNote(note.id);
      }
    }
    await librarian.setProfileFields(profileFields(areas, needs, kind, text));
  }
  return { uid, supportAreas: areas, freeText: text, visionKind: kind, needs };
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

// The full AbilityModel (incl. structured needs[]) for a uid — this is what the
// Controller reads as its `operator` to render itself and derive settings.
async function abilityModelFor(uid) {
  uid = String(uid || '').trim();
  if (!uid) return { exists: false, uid: '' };
  const exists = (await listProfileIds()).includes(uid);
  if (!exists) return { exists: false, uid };
  let model = {};
  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding-view' });
    if (t.body?.token) {
      const r = await remoteLibrarian(t.body.token, 'getAbilityModel', []);
      model = r.body?.result || {};
    }
  } else {
    const { host } = await localBits();
    const { librarian } = await host.getInstance(uid);
    model = await librarian.getAbilityModel();
  }
  return { exists: true, uid, model };
}

// "Forget what I've changed, go back to my profile." Drops the durable
// user-explicit setting records so the next read re-derives from the profile.
// The profile itself (support areas, free text, needs) is untouched — this
// forgets deliberate overrides, not the person.
async function resetToProfileFor(uid, scope) {
  uid = String(uid || '').trim();
  if (!uid) throw new Error('uid required');
  // Same gate as every other profile route: the id is the credential, so a
  // uid that was never onboarded is not-found, and getInstance must never run
  // for it (its migrations would create the partition). One path segment
  // only, for the same reason onboard() insists on it.
  if (uid.includes('/') || uid.includes('\\') || uid.includes('..')) throw new Error('invalid uid');
  if (!(await listProfileIds()).includes(uid)) throw new Error('not-found');
  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding-reset' });
    if (t.status !== 200 || !t.body?.token) throw new Error('could not mint token (check TOOLKIT_URL / ADMIN_PASSWORD)');
    const r = await remoteLibrarian(t.body.token, 'resetToProfile', [scope ? { scope } : {}]);
    // A reset that forgot NOTHING ({forgotten: []}) and a reset that never ran
    // are different things, and only one of them should be reported as success —
    // telling someone their settings went back to normal when the call 404'd is
    // the worst of both. Demand a real result object.
    if (r.status !== 200 || !r.body || typeof r.body.result !== 'object' || r.body.result === null) {
      throw new Error(`the toolkit service did not run resetToProfile (HTTP ${r.status}${r.body && r.body.error ? ': ' + r.body.error : ''}) — is it running a build that routes it?`);
    }
    return r.body.result;
  }
  const { host } = await localBits();
  const { librarian } = await host.getInstance(uid);
  return await librarian.resetToProfile(scope ? { scope } : {});
}

// ── Admin: list + delete profiles (gated by ADMIN_PASSWORD) ─────────────────
function adminOk(req) {
  if (!ADMIN_PASSWORD) return false;
  const given = req.headers['x-admin-password'] || '';
  // Same timing-safe compare the toolkit server uses for its admin password.
  return verifyAdminPassword(ADMIN_PASSWORD, given);
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
  const { host, store } = await localBits();
  // Same order as the service's own delete: drop the cached instance so a
  // stale in-memory one cannot write the partition back, wipe, then drop
  // again in case a read during the wipe re-cached it.
  host.evict?.(uid);
  const wiped = await store.deleteUser(uid);
  host.evict?.(uid);
  return wiped;
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
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) {
        // Settle first, then tear the request down so the rest of an
        // oversized body is neither buffered nor parsed on 'end'.
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid-json')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method;

    // /chat is the front door — one conversational surface that does both
    // onboarding and control. The step-by-step form stays at /onboarding.
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(302, { location: '/chat' });
      return res.end();
    }
    if (method === 'GET' && (pathname === '/onboarding' || pathname === '/onboarding/')) {
      const html = await readFile(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Chat surface at /chat — one conversational input that does both onboarding
    // and controller. Its own module is /chat.js; it imports the controller core
    // from /controller/lib (served below) with absolute paths, so no rewrite.
    if (method === 'GET' && (pathname === '/chat' || pathname === '/chat/')) {
      const html = await readFile(path.join(__dirname, 'chat.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    // An explicit allowlist, not a directory served wholesale: these are the
    // only modules the chat page imports, and nothing else in here should be
    // reachable over HTTP.
    if (method === 'GET' && CHAT_MODULES.includes(pathname)) {
      const js = await readFile(path.join(__dirname, pathname.slice(1)), 'utf8');
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(js);
    }

    // Controller UI at /controller. The demo's imports are relative to
    // controller/demo/; rewrite them to the /controller/lib prefix this
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
    if (method === 'GET' && pathname.startsWith('/controller/toolkit/registry/')) {
      return serveStatic(res, REGISTRY_DIR, pathname.slice('/controller/toolkit/registry/'.length));
    }
    // The chat page derives the settings a profile implies with the toolkit's
    // own surface (toolkit/surfaces/web.js), so there is one mapping rather
    // than a second copy here. It imports its dependencies by relative path,
    // so the subtree is served under one prefix and they resolve themselves —
    // the same shape /controller/lib uses for the controller core.
    if (method === 'GET' && pathname.startsWith('/toolkit/')) {
      return serveStatic(res, TOOLKIT_DIR, pathname.slice('/toolkit/'.length));
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

    if (method === 'GET' && pathname === '/api/ability-model') {
      const uid = new URL(req.url, 'http://localhost').searchParams.get('uid') || '';
      try { return sendJSON(res, 200, await abilityModelFor(uid)); }
      catch (e) { return sendJSON(res, 502, { error: e.message }); }
    }

    // Best-effort LLM completion for the /chat surface. { available:false } when
    // no key is configured (the client then falls back to deterministic-only).
    if (method === 'POST' && pathname === '/api/assist') {
      const caller = await assistCaller();
      if (!caller) return sendJSON(res, 200, { available: false });
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      const prompt = String(body && body.prompt || '').slice(0, 4000); // size cap
      if (!prompt) return sendJSON(res, 400, { error: 'prompt required' });
      try {
        const text = await caller(prompt);
        return sendJSON(res, 200, { available: true, text: String(text) });
      } catch (e) {
        // A model/transport failure is data, not a 500 — chat degrades quietly.
        return sendJSON(res, 200, { available: false, error: e.message });
      }
    }

    if (method === 'POST' && pathname === '/api/reset-to-profile') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
      try {
        const result = await resetToProfileFor(body?.uid, body?.scope);
        return sendJSON(res, 200, { ok: true, ...result });
      } catch (e) {
        return sendJSON(res, e.message === 'not-found' ? 404 : 400, { ok: false, error: e.message });
      }
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

// In local mode onboarding keeps its OWN copy of every profile under DATA_DIR.
// If a toolkit service is also running, a receiver is reading THAT store — same
// person, two files: a preference the receiver recorded is invisible here, and a
// reset here clears records the receiver never read. Silent and expensive to
// find, so say it loudly when we can detect it.
async function warnIfSplitStore() {
  if (MODE !== 'local') return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const resp = await fetch(TOOLKIT_URL + '/healthz', { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    if (!resp || !resp.ok) return; // nothing there (or not the toolkit) — local-only is fine
  } catch { return; }
  console.warn(`
[onboarding] ⚠  TWO STORES. A toolkit service is running at ${TOOLKIT_URL}, but this
[onboarding]    process is in LOCAL mode and keeps its own profiles in ${DATA_DIR}.
[onboarding]    A receiver talking to the service reads a DIFFERENT store: settings it
[onboarding]    records are invisible here, and a reset here won't touch them.
[onboarding]    To share one store:  ONBOARD_MODE=remote TOOLKIT_URL=${TOOLKIT_URL} ADMIN_PASSWORD=… node onboarding/server.js
`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, () => {
    console.log(`[onboarding] mode=${MODE} target=${MODE === 'remote' ? TOOLKIT_URL : DATA_DIR}`);
    console.log(`[onboarding] admin ${ADMIN_PASSWORD ? 'enabled' : 'DISABLED (set ADMIN_PASSWORD to list/delete)'}`);
    console.log(`[onboarding] open       http://127.0.0.1:${PORT}/          → /chat`);
    console.log(`[onboarding] chat       http://127.0.0.1:${PORT}/chat`);
    console.log(`[onboarding] onboarding http://127.0.0.1:${PORT}/onboarding`);
    console.log(`[onboarding] controller http://127.0.0.1:${PORT}/controller`);
    console.log(`[onboarding] assist LLM ${GEMINI_API_KEY ? 'enabled' : 'DISABLED (set GEMINI_API_KEY for the chat general-answer lane)'}`);
    warnIfSplitStore();
  });
}

export { server, onboard, listProfileIds, listProfileSummaries, deleteProfile, deriveDefaultNeeds, isBlindText };
