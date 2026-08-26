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

async function onboard({ uid, supportAreas, freeText }) {
  uid = (uid && String(uid).trim()) || genUid();
  if (/[/\\.]/.test(uid) && (uid.includes('/') || uid.includes('\\') || uid.includes('..'))) {
    throw new Error('invalid uid');
  }
  const areas = (Array.isArray(supportAreas) ? supportAreas : []).filter((a) => SUPPORT_AREAS.includes(a));
  const text = (freeText || '').toString().trim();

  if (MODE === 'remote') {
    const t = await remoteAdmin('POST', '/admin/tokens', { uid, label: 'onboarding' });
    if (t.status !== 200 || !t.body?.token) throw new Error('could not mint token (check TOOLKIT_URL / ADMIN_PASSWORD)');
    const token = t.body.token;
    if (areas.length) await remoteLibrarian(token, 'setProfileField', ['supportAreas', areas]);
    if (text) {
      await remoteLibrarian(token, 'setProfileField', ['freeText', text]);
      await remoteLibrarian(token, 'addNote', [text, { source: 'user-explicit' }]);
    }
  } else {
    const { host } = await localBits();
    const { librarian } = await host.getInstance(uid);
    if (areas.length) await librarian.setProfileField('supportAreas', areas);
    if (text) {
      await librarian.setProfileField('freeText', text);
      await librarian.addNote(text, { source: 'user-explicit' });
    }
  }
  return { uid, supportAreas: areas, freeText: text };
}

// ── Read one profile's current configuration (for the "current profile" banner)
// Returns {exists:false} for a uid that was never onboarded — WITHOUT creating
// it (we check the profile list before touching getProfile, which would init a
// default partition).
async function profileSummary(uid) {
  uid = String(uid || '').trim();
  if (!uid) return { exists: false, uid: '' };
  const exists = (await listProfiles()).includes(uid);
  if (!exists) return { exists: false, uid };

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
  return {
    exists: true,
    uid,
    supportAreas: profile.supportAreas || [],
    freeText: profile.freeText || '',
  };
}

// ── Admin: list + delete profiles (gated by ADMIN_PASSWORD) ─────────────────
function adminOk(req) {
  if (!ADMIN_PASSWORD) return false;
  const given = req.headers['x-admin-password'] || '';
  // Constant-ish length check + compare (small tool; not a hardened secret store).
  return given.length === ADMIN_PASSWORD.length && given === ADMIN_PASSWORD;
}

async function listProfiles() {
  if (MODE === 'remote') {
    const r = await remoteAdmin('GET', '/admin/users');
    if (r.status !== 200) throw new Error('remote list failed (' + r.status + ')');
    return r.body?.users || [];
  }
  const { store } = await localBits();
  return await store.listUsers();
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

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = await readFile(path.join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
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
        try { return sendJSON(res, 200, { profiles: await listProfiles() }); }
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
    console.log(`[onboarding] open http://127.0.0.1:${PORT}`);
  });
}

export { server, onboard, listProfiles, deleteProfile };
