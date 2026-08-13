// Test for extension/remote-librarian.js against an inline stub server that
// implements just enough of server/CONTRACT.md to exercise the real HTTP
// path (bearer auth, {ok:true,result}/{ok:false,error}/401/404 shapes,
// GET /v1/whoami) — plus a facade-coverage check derived straight from
// background.js's own source, so it can't quietly rot if a new
// `case 'librarian*'` arm is added there without updating the facade.
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(__dirname, '..', 'extension');

const TOKEN = 'aat_test_token_0123456789';
const UID = 'u-test-1';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// ---- inline stub server (server/CONTRACT.md's wire shapes only) -----------
function startServer() {
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (req.url === '/healthz') return send(200, { ok: true, version: 'stub' });

    // Auth on every /v1/* route except /healthz and /v1/meta (CONTRACT.md "Base").
    if (req.url.startsWith('/v1/') && req.url !== '/v1/meta' && token !== TOKEN) {
      return send(401, { error: 'unauthorized' });
    }

    if (req.method === 'GET' && req.url === '/v1/whoami') {
      return send(200, { uid: UID, label: 'Test User' });
    }

    if (req.method === 'POST' && req.url.startsWith('/v1/librarian/')) {
      const method = decodeURIComponent(req.url.slice('/v1/librarian/'.length));
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
        const args = body.args || [];
        if (method === 'boomMethod') return send(200, { ok: false, error: 'boom: application error' });
        if (method === 'unknownRoute') return send(404, { error: 'unknown-method' });
        // Default: echo the wire method + args back so the test can assert
        // exactly what each facade call produced (alias correctness, arg
        // forwarding) without the stub knowing about real Librarian methods.
        return send(200, { ok: true, result: { method, args } });
      });
      return;
    }

    send(404, { error: 'not-found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- load remote-librarian.js into an isolated vm context ------------------
// It's a classic script (IIFE) that assigns globalThis.RemoteLibrarian —
// same loading pattern as background.js's importScripts and options.html's
// <script> tag. A vm context gives it its own globalThis (so this test
// process's real fetch/global state is never touched) while still handing
// it a real `fetch` bound to the stub server above.
function loadRemoteLibrarian() {
  const src = fs.readFileSync(path.join(EXT_DIR, 'remote-librarian.js'), 'utf8');
  const sandbox = { console, fetch };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'remote-librarian.js' });
  return sandbox.RemoteLibrarian;
}

// ---- derive the required facade method list straight from background.js ---
// Isolates the `if (msg.type && msg.type.startsWith('librarian')) { ... }`
// dispatcher block and collects every distinct `L.<method>` call inside it —
// the exact set the task brief calls "the 36 case arms". If a future arm
// adds/removes an `L.` call, this list (and therefore this test) moves with
// it automatically.
function requiredMethodsFromBackground() {
  const bgSrc = fs.readFileSync(path.join(EXT_DIR, 'background.js'), 'utf8');
  const startMarker = "if (msg.type && msg.type.startsWith('librarian'))";
  const endMarker = "if (msg.type === 'saveActionToProfile')";
  const start = bgSrc.indexOf(startMarker);
  const end = bgSrc.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('could not locate librarian dispatcher block in background.js');
  const block = bgSrc.slice(start, end);
  const names = new Set();
  for (const m of block.matchAll(/\bL\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
  return [...names].sort();
}

(async () => {
  const server = await startServer();
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}`;

  const RemoteLibrarian = loadRemoteLibrarian();
  check('module loaded and assigns globalThis.RemoteLibrarian', typeof RemoteLibrarian === 'object' && RemoteLibrarian !== null);
  check('exposes configure/isConfigured/call/whoami/asLibrarian', ['configure', 'isConfigured', 'call', 'whoami', 'asLibrarian'].every((k) => typeof RemoteLibrarian[k] === 'function'));

  // 1. Unconfigured state.
  check('isConfigured() false before configure()', RemoteLibrarian.isConfigured() === false);
  try {
    await RemoteLibrarian.call('getProfile', []);
    check('call() throws when unconfigured', false);
  } catch (e) {
    check('call() throws when unconfigured', /not configured/i.test(e.message));
  }

  RemoteLibrarian.configure({ url: BASE, token: TOKEN });
  check('isConfigured() true after configure({url,token})', RemoteLibrarian.isConfigured() === true);
  RemoteLibrarian.configure({ url: '', token: '' });
  check('isConfigured() false again after configure({}) (clear)', RemoteLibrarian.isConfigured() === false);
  RemoteLibrarian.configure({ url: BASE, token: TOKEN });

  // 2. Success path: {ok:true,result} -> return result.
  const r1 = await RemoteLibrarian.call('getProfile', ['a', 1]);
  check('call() returns result on {ok:true}',
    r1 && r1.method === 'getProfile' && Array.isArray(r1.args) && r1.args[0] === 'a' && r1.args[1] === 1);

  // 3. Missing args defaults to [].
  const r2 = await RemoteLibrarian.call('getProfile');
  check('call() defaults args to []', Array.isArray(r2.args) && r2.args.length === 0);

  // 4. {ok:false,error} -> throw Error(error).
  try {
    await RemoteLibrarian.call('boomMethod', []);
    check('call() throws on {ok:false}', false);
  } catch (e) {
    check('call() throws on {ok:false}', e.message === 'boom: application error');
  }

  // 5. Unknown method (404 {error:"unknown-method"}) -> throw with that message.
  try {
    await RemoteLibrarian.call('unknownRoute', []);
    check('call() throws on 404 unknown-method', false);
  } catch (e) {
    check('call() throws on 404 unknown-method', e.message === 'unknown-method');
  }

  // 6. 401 -> throw Error('unauthorized'), regardless of body.
  RemoteLibrarian.configure({ url: BASE, token: 'wrong-token' });
  try {
    await RemoteLibrarian.call('getProfile', []);
    check('call() throws unauthorized on 401', false);
  } catch (e) {
    check('call() throws unauthorized on 401', e.message === 'unauthorized');
  }
  RemoteLibrarian.configure({ url: BASE, token: TOKEN });

  // 7. Network failure (nothing listening) -> throws.
  RemoteLibrarian.configure({ url: 'http://127.0.0.1:1', token: TOKEN });
  try {
    await RemoteLibrarian.call('getProfile', []);
    check('call() throws on network failure', false);
  } catch (e) {
    check('call() throws on network failure', !!e.message);
  }
  RemoteLibrarian.configure({ url: BASE, token: TOKEN });

  // 8. /v1/whoami.
  const who = await RemoteLibrarian.whoami();
  check('whoami() returns {uid,label}', who.uid === UID && who.label === 'Test User');
  RemoteLibrarian.configure({ url: BASE, token: 'wrong-token' });
  try {
    await RemoteLibrarian.whoami();
    check('whoami() throws unauthorized on bad token', false);
  } catch (e) {
    check('whoami() throws unauthorized on bad token', e.message === 'unauthorized');
  }
  RemoteLibrarian.configure({ url: BASE, token: TOKEN });

  // 9. Facade coverage: every `L.<method>` background.js's dispatcher calls
  //    must exist on the facade as a function. 37, not 36: the dispatcher
  //    has 36 `case 'librarian*'` arms, but `librarianShareAudit` now calls
  //    TWO things on `L` in remote-aware code (`L.getShareAudit?.(dsGetter)`
  //    falling back to the Grants bridge locally), so the arm count and the
  //    distinct-L.-method count aren't the same number.
  const required = requiredMethodsFromBackground();
  check('background.js dispatcher has the expected 37 distinct L.<method> calls (sanity on the extraction itself)', required.length === 37);
  const facade = RemoteLibrarian.asLibrarian();
  const missing = required.filter((m) => typeof facade[m] !== 'function');
  check(`facade covers every dispatcher method (${required.length} required)`, missing.length === 0);
  if (missing.length) console.log('  missing from facade:', missing.join(', '));

  // 10. Alias mapping spot-checks: real Librarian method name -> wire
  //     {method} segment actually sent on the wire (read back via the stub's
  //     echo). Covers every alias entry plus one non-aliased passthrough.
  async function wireNameUsedBy(fn, ...args) {
    const r = await fn(...args);
    return r.method;
  }
  check('alias: getEffectivePreferences -> effectivePreferences',
    await wireNameUsedBy(facade.getEffectivePreferences, 'https://x', []) === 'effectivePreferences');
  check('alias: extract -> extractNow',
    await wireNameUsedBy(facade.extract) === 'extractNow');
  check('alias: reflect -> reflectNow',
    await wireNameUsedBy(facade.reflect) === 'reflectNow');
  check('alias: setOriginPaused -> setPause',
    await wireNameUsedBy(facade.setOriginPaused, 'x.com', true) === 'setPause');
  check('alias: setMemoryPaused -> setPause (same wire route as setOriginPaused)',
    await wireNameUsedBy(facade.setMemoryPaused, true) === 'setPause');
  check('alias: setSiteCategoryOverride -> setSiteCategory',
    await wireNameUsedBy(facade.setSiteCategoryOverride, 'x.com', 'news') === 'setSiteCategory');
  check('alias: findSkillForNeed -> findSkill',
    await wireNameUsedBy(facade.findSkillForNeed, 'need') === 'findSkill');
  check('alias: getShareAudit -> shareAudit',
    await wireNameUsedBy(facade.getShareAudit) === 'shareAudit');
  check('non-aliased method passes its own name through unchanged (getProfile)',
    await wireNameUsedBy(facade.getProfile) === 'getProfile');
  check('non-aliased method passes its own name through unchanged (respondToProposal)',
    await wireNameUsedBy(facade.respondToProposal, 'id1', 'accept') === 'respondToProposal');

  // 11. Args forwarded positionally, unmodified.
  const argsCheck = await facade.recordScopedSettings('category:news', { fontScale: 150 }, { x: 1 });
  check('facade forwards args positionally',
    argsCheck.args.length === 3 && argsCheck.args[0] === 'category:news'
    && argsCheck.args[1].fontScale === 150 && argsCheck.args[2].x === 1);

  // 12. setGeminiCaller: local-only method becomes a safe, non-throwing,
  //     no-network no-op with a console.warn (server owns its own key).
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...a) => { warned = true; originalWarn.apply(console, a); };
  let threw = false;
  let ret;
  try { ret = facade.setGeminiCaller(() => {}); } catch { threw = true; }
  console.warn = originalWarn;
  check('setGeminiCaller does not throw', threw === false);
  check('setGeminiCaller warns rather than silently doing nothing', warned === true);
  check('setGeminiCaller is synchronous (no network round-trip)', ret === undefined);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH:', e); process.exit(1); });
