// The onboarding service over REAL HTTP — binds the exported server on an
// ephemeral port and drives it with fetch, the way the browser and any other
// client reach it.
//
// The existing suites all call onboard()/deleteProfile() directly, so every
// route handler, the admin gate, the static-file guard, and the error paths
// were reached by nobody. This covers that boundary. Same shape as
// server/test/server-test.mjs, which does this for the toolkit service.
//
// Local mode, its own temp DATA_DIR, admin enabled, and no GEMINI_API_KEY (so
// /api/assist reports itself unavailable instead of calling out to a model).
// Admin-DISABLED behavior needs a different module-load env, so it lives in
// its sibling admin-disabled.test.mjs.
//
//   node onboarding/test/http-routes.test.mjs

import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'onboard-http-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';
process.env.ADMIN_PASSWORD = 'test-admin';
delete process.env.GEMINI_API_KEY;

const mod = await import('../server.js');
const TOOLKIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'toolkit');
const { server } = mod;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const get = (p, opts) => fetch(base + p, { redirect: 'manual', ...opts });
const json = async (p, opts) => (await fetch(base + p, opts)).json();
const admin = (pw = 'test-admin') => ({ 'x-admin-password': pw });

// fetch() normalizes ".." out of a path before it ever leaves the client, so a
// traversal attempt has to be written straight onto the request line.
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

try {
  // ── pages ──────────────────────────────────────────────────────────────────
  {
    const root = await get('/');
    check('/ redirects with 302', root.status === 302);
    check('/ redirects to the chat front door', root.headers.get('location') === '/chat');
    check('/index.html redirects too', (await get('/index.html')).headers.get('location') === '/chat');

    for (const [p, label] of [['/chat', 'chat'], ['/onboarding', 'onboarding form'], ['/controller', 'controller demo']]) {
      const r = await get(p);
      check(`${label} (${p}) serves HTML`, r.status === 200 && /text\/html/.test(r.headers.get('content-type')));
    }
    check('/chat/ works with a trailing slash', (await get('/chat/')).status === 200);
  }

  // ── the controller demo's imports are rewritten to this server's prefix ────
  {
    const html = await (await get('/controller')).text();
    check('the controller demo has no relative "../" imports left', !/from '\.\.\//.test(html));
    check('…they point at /controller/lib instead', /from '\/controller\/lib\//.test(html));
  }

  // ── module assets the pages import ─────────────────────────────────────────
  {
    // Every module the chat page imports, read from the server's own list so
    // the allowlist and this check cannot disagree.
    for (const p of mod.CHAT_MODULES) {
      const r = await get(p);
      check(`${p} serves JavaScript`, r.status === 200 && /javascript/.test(r.headers.get('content-type')));
    }
    const lib = await get('/controller/lib/createController.js');
    check('the controller core is reachable at /controller/lib', lib.status === 200);
    const reg = await get('/controller/toolkit/registry/tools.js');
    check('the settings vocabulary is reachable at /controller/toolkit/registry', reg.status === 200);
    check('a missing lib file is a 404', (await get('/controller/lib/nope.js')).status === 404);

    // The chat page derives the settings a profile implies with the toolkit's
    // own web surface, so that subtree is served and its relative imports have
    // to resolve under the same prefix.
    for (const p of mod.TOOLKIT_MODULES) {
      const r = await get(p);
      check(`${p} is served`, r.status === 200 && /javascript/.test(r.headers.get('content-type')));
    }
    check('a missing toolkit file is a 404', (await get('/toolkit/nope.js')).status === 404);
    // An allowlist, not the whole tree: real files outside it are not reachable.
    check('toolkit/package.json is not served', (await get('/toolkit/package.json')).status === 404);
    check('toolkit/test/ is not served', (await get('/toolkit/test/skill-test.js')).status === 404);

    // An allowlist goes stale silently: add an import to one of these toolkit
    // files and the chat page 404s on it in the browser, where CI cannot see.
    // So walk the real import graph and require the list to cover it.
    const walked = new Set();
    const queue = ['/toolkit/surfaces/web.js'];
    const missing = [];
    while (queue.length) {
      const spec = queue.shift();
      if (walked.has(spec)) continue;
      walked.add(spec);
      if (!mod.TOOLKIT_MODULES.includes(spec)) { missing.push(spec); continue; }
      const src = await readFile(path.join(TOOLKIT_DIR, spec.slice('/toolkit/'.length)), 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"](\.[^'"]+)['"]/gm)) {
        queue.push('/toolkit/' + path.normalize(path.join(path.dirname(spec.slice('/toolkit/'.length)), m[1])));
      }
    }
    check('the toolkit allowlist covers the whole import graph', missing.length === 0
      || (console.log('   not served:', missing.join(', ')), false));
    check('…and the graph was actually walked', walked.size >= mod.TOOLKIT_MODULES.length);
  }

  // ── the static guard ───────────────────────────────────────────────────────
  // Traversal is stopped by three different layers, so each is pinned
  // separately: a change that removes one silently leans on the next.
  {
    // 1. new URL() resolves ".." before the handler routes, so the path no
    //    longer starts with /controller/lib/ and never reaches serveStatic.
    const plain = await rawGet('/controller/lib/../../../package.json');
    check('a plain traversal never reaches the static route', plain.status === 404);
    check('…and serves nothing from outside the base dir', !/"name"/.test(plain.body));

    // 2. Percent-encoded slashes survive that normalization and DO reach
    //    serveStatic, where the literal ".." check rejects them.
    const encoded = await rawGet('/controller/lib/..%2f..%2fpackage.json');
    check('an encoded traversal is rejected by the static guard', encoded.status === 400 && /bad-path/.test(encoded.body));

    // 3. Fully-encoded dots slip past that check, but readFile does not decode
    //    them, so it looks for a literal filename that does not exist.
    const dots = await rawGet('/controller/lib/%2e%2e%2f%2e%2e%2fpackage.json');
    check('a fully-encoded traversal finds nothing', dots.status === 404 && !/"name"/.test(dots.body));

    // The toolkit prefix is an allowlist, so a traversal never reaches the
    // file guard at all: anything not on the list is a plain 404.
    const tk = await rawGet('/toolkit/..%2f..%2fpackage.json');
    check('the toolkit prefix rejects an encoded traversal', tk.status === 404 && !/"name"/.test(tk.body));
    const tkPlain = await rawGet('/toolkit/../../package.json');
    check('…and a plain one serves nothing from outside it', tkPlain.status === 404 || !/"name"/.test(tkPlain.body));
  }

  // ── config ─────────────────────────────────────────────────────────────────
  {
    const cfg = await json('/api/config');
    check('config reports local mode', cfg.mode === 'local');
    check('config points at the data dir', cfg.target === dir);
    check('config reports admin enabled', cfg.adminEnabled === true);
    check('config carries the support areas', Array.isArray(cfg.supportAreas) && cfg.supportAreas.length > 0);
  }

  // ── onboarding over HTTP ───────────────────────────────────────────────────
  let uid = '';
  {
    const body = { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' };
    const r = await fetch(base + '/api/onboard', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    uid = d.uid;
    check('onboard succeeds over HTTP', r.status === 200 && d.ok === true);
    check('onboard returns a capability uid', /^u-[A-Za-z0-9_-]{22}$/.test(uid || ''));
    check('onboard derives needs from the vision kind', Array.isArray(d.needs) && d.needs.some((n) => n.dimension === 'textSize'));

    const bad = await fetch(base + '/api/onboard', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
    });
    check('malformed JSON is a 400, not a 500', bad.status === 400);

    // A profile id is a credential: typing one must never mint a profile under it.
    const typed = await json('/api/onboard', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: 'guessable-name', supportAreas: ['hearing'], freeText: '' }),
    });
    check('a typed uid is not honored for creation', typed.uid !== 'guessable-name');
  }

  // ── reading a profile back ─────────────────────────────────────────────────
  {
    const p = await json('/api/profile?uid=' + encodeURIComponent(uid));
    check('the profile reads back', p.exists === true && p.uid === uid);
    check('the profile carries the free text', p.freeText === 'I need bigger text');

    const m = await json('/api/ability-model?uid=' + encodeURIComponent(uid));
    check('the ability model reads back', m.exists === true && m.model && Array.isArray(m.model.needs));

    check('an unknown uid is absent, not an error', (await json('/api/profile?uid=u-nope')).exists === false);
    check('a missing uid is absent, not an error', (await json('/api/profile')).exists === false);
  }

  // ── the assist lane degrades instead of failing ────────────────────────────
  {
    const r = await fetch(base + '/api/assist', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'hello' }),
    });
    const d = await r.json();
    check('assist with no key answers 200, not 500', r.status === 200);
    check('…and reports itself unavailable', d.available === false);
  }

  // ── reset ──────────────────────────────────────────────────────────────────
  {
    const r = await fetch(base + '/api/reset-to-profile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'u-nope' }),
    });
    check('resetting an unknown profile is a 404', r.status === 404);

    const ok = await fetch(base + '/api/reset-to-profile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid }),
    });
    check('resetting a known profile succeeds', ok.status === 200 && (await ok.json()).ok === true);
  }

  // ── the admin gate ─────────────────────────────────────────────────────────
  {
    check('listing without a password is 401', (await get('/api/profiles')).status === 401);
    check('listing with the wrong password is 401', (await get('/api/profiles', { headers: admin('wrong') })).status === 401);

    const r = await get('/api/profiles', { headers: admin() });
    const d = await r.json();
    check('listing with the password succeeds', r.status === 200);
    check('the created profile is listed', d.profiles.some((p) => p.uid === uid));

    const del = (u, pw) => fetch(base + '/api/profiles/' + encodeURIComponent(u), { method: 'DELETE', headers: admin(pw) });
    check('deleting without the password is 401', (await del(uid, 'wrong')).status === 401);
    check('deleting an unknown profile is a 404', (await del('u-nope')).status === 404);
    check('deleting a known profile succeeds', (await del(uid)).status === 200);
    check('…and it is gone afterwards', (await json('/api/profile?uid=' + encodeURIComponent(uid))).exists === false);
  }

  // ── everything else ────────────────────────────────────────────────────────
  {
    check('an unknown path is a 404', (await get('/nope')).status === 404);
    check('a write to a read-only page route falls through to 404', (await get('/chat', { method: 'POST' })).status === 404);

    // readBody caps at 1e6 and tears the request down rather than buffering on.
    const huge = await fetch(base + '/api/onboard', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supportAreas: [], freeText: 'x'.repeat(1_100_000) }),
    }).catch(() => null);
    check('an oversized body is refused', huge === null || huge.status === 400);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nHTTP routes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
