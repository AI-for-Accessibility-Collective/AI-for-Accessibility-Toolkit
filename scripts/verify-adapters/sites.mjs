// The verifier's copies of real pages: each page in sites.json (and any
// other https page a spec names) is loaded from the site once, with
// everything it fetches, and served from that copy after that, so a run
// visits no site and every run sees the same page.
//
//   recorded (the default)  the demo sites ("static": true in sites.json)
//                           are recorded once and never asked again; other
//                           pages at most once a day (VERIFY_SITE_TTL_HOURS)
//   refresh                 record every page again, once (VERIFY_SITES=refresh)
//   live                    load the site itself each time (VERIFY_SITES=live)
//   offline                 only the copies there are, however old, and never
//                           a visit (VERIFY_SITES=offline): the server's check
//                           container, which has no network and the copies
//                           mounted read-only
//
// Visits are polite: the verifier names itself in its user agent, follows
// robots.txt, records one page at a time and waits between two visits to
// one host. A site that refuses (a 403, a 429, a challenge) is not asked
// again for six hours; until then the last copy is used, or the page is
// skipped. Copies are kept in .verify-cache/sites/ (VERIFY_SITE_CACHE),
// never in git: they are other people's pages.
//
//   node scripts/verify-adapters/sites.mjs            what is recorded, and when
//   node scripts/verify-adapters/sites.mjs record [name ...] [--refresh]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.resolve(process.env.VERIFY_SITE_CACHE || path.join(ROOT, '.verify-cache/sites'));
const LIST = JSON.parse(readFileSync(path.join(ROOT, 'scripts/verify-adapters/sites.json'), 'utf8'));
const KNOWN = [...LIST.sites, ...(LIST.realWorld || [])];

export const VERIFIER_UA = 'ai4a11y-verifier/1.0 (accessibility research prototype; +https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit)';
const HOUR = 3600_000;
const TTL = (Number(process.env.VERIFY_SITE_TTL_HOURS) || 24) * HOUR;
const RETRY = 6 * HOUR;
const HOST_GAP = 10_000;
const MAX_BODY = 20 * 1024 * 1024;

export const siteMode = () => (['live', 'refresh', 'offline'].includes(process.env.VERIFY_SITES) ? process.env.VERIFY_SITES : 'recorded');
const siteOf = (url) => KNOWN.find((s) => s.url === url);
const keyOf = (url) => {
  const u = new URL(url);
  return `${u.hostname}${u.pathname}`.replace(/[^a-z0-9.-]+/gi, '_').slice(0, 80) + '-' + createHash('sha256').update(url).digest('hex').slice(0, 8);
};
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 1)); renameSync(tmp, file); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const when = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// --- robots.txt: the rules for * and for us, by longest match -------------

const robotsSeen = new Map();
async function robotsAllow(url) {
  const u = new URL(url);
  if (!robotsSeen.has(u.origin)) {
    robotsSeen.set(u.origin, (async () => {
      try {
        const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': VERIFIER_UA }, signal: AbortSignal.timeout(15_000) });
        return r.ok ? await r.text() : '';
      } catch { return ''; }
    })());
  }
  const text = await robotsSeen.get(u.origin);
  const groups = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [field, value] = [m[1].toLowerCase(), m[2].trim()];
    if (field === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) current.rules.push({ allow: field === 'allow', path: value });
  }
  const ours = groups.filter((g) => g.agents.some((a) => a !== '*' && 'ai4a11y-verifier'.startsWith(a)));
  const rules = (ours.length ? ours : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules).filter((r) => r.path);
  const target = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(target) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// --- one visit at a time, and a gap between two visits to one host --------

async function withVisitLock(host, fn) {
  mkdirSync(CACHE, { recursive: true });
  const lock = path.join(CACHE, '.lock');
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 5 * 60_000) rmSync(lock, { recursive: true, force: true }); } catch {}
      if (i > 600) throw new Error('another recording has held the lock for too long');
      await sleep(500);
    }
  }
  try {
    const hostsFile = path.join(CACHE, 'hosts.json');
    const last = readJson(hostsFile)?.[host] || 0;
    const wait = last + HOST_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { writeJson(hostsFile, { ...(readJson(hostsFile) || {}), [host]: Date.now() }); }
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

// --- recording ------------------------------------------------------------

async function record(browser, url, dir) {
  if (!(await robotsAllow(url))) throw new Error('robots.txt asks verifiers not to load this page');
  return withVisitLock(new URL(url).hostname, async () => {
    const context = await browser.newContext({ userAgent: VERIFIER_UA, serviceWorkers: 'block', viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const entries = {};
    let mainStatus = 0;
    const bodies = path.join(dir, 'bodies.tmp');
    rmSync(bodies, { recursive: true, force: true });
    mkdirSync(bodies, { recursive: true });
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (req.method() !== 'GET') return route.abort('blockedbyclient');
      let response;
      try { response = await route.fetch({ timeout: 30_000 }); } catch { return route.abort('failed'); }
      try {
        const body = await response.body();
        if (body.length <= MAX_BODY) {
          const sha = createHash('sha256').update(body).digest('hex');
          writeFileSync(path.join(bodies, sha), body);
          const headers = { ...response.headers() };
          for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie']) delete headers[h];
          entries[req.url()] = { status: response.status(), headers, body: sha };
        }
      } catch {}
      await route.fulfill({ response }).catch(() => {});
    });
    try {
      const page = await context.newPage();
      const r = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
      mainStatus = r ? r.status() : 0;
      if (mainStatus >= 400) throw new Error(`the site answered ${mainStatus}`);
      await sleep(2000);
      // Scroll once to the end, so what loads on scrolling is in the copy too.
      for (let i = 0; i < 20; i++) {
        const done = await page.evaluate(() => { window.scrollBy(0, innerHeight); return innerHeight + scrollY >= document.documentElement.scrollHeight - 2; });
        await sleep(300);
        if (done) break;
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1500);
    } finally { await context.close().catch(() => {}); }
    if (!entries[url]) throw new Error('the page itself was not recorded');
    rmSync(path.join(dir, 'bodies'), { recursive: true, force: true });
    renameSync(bodies, path.join(dir, 'bodies'));
    const index = { url, recordedAt: Date.now(), userAgent: VERIFIER_UA, entries };
    writeJson(path.join(dir, 'index.json'), index);
    rmSync(path.join(dir, 'refused.json'), { force: true });
    return index;
  });
}

const pending = new Map();
const refreshed = new Set();

/** The copy of a page to serve, recorded first if needed: { url, recordedAt,
 *  entries, stale? }, or null in live mode. Throws when the page cannot be
 *  recorded and there is no copy (the message says why and until when). */
export async function prepareSite(browser, url) {
  const mode = siteMode();
  if (mode === 'live') return null;
  const dir = path.join(CACHE, keyOf(url));
  if (mode === 'offline') {
    const copy = readJson(path.join(dir, 'index.json'));
    if (!copy) throw new Error('there is no copy of this page here, and this run visits no site');
    return copy;
  }
  mkdirSync(dir, { recursive: true });
  const index = () => readJson(path.join(dir, 'index.json'));
  const have = index();
  const fixed = !!siteOf(url)?.static;
  const fresh = have && (fixed || Date.now() - have.recordedAt < TTL) && (mode !== 'refresh' || refreshed.has(url));
  if (fresh) return have;
  const refused = readJson(path.join(dir, 'refused.json'));
  if (refused && Date.now() - refused.at < RETRY) {
    if (have) return { ...have, stale: true };
    throw new Error(`${refused.reason} (${when(refused.at)}); not asked again before ${when(refused.at + RETRY)}`);
  }
  if (!pending.has(url)) {
    pending.set(url, record(browser, url, dir).then((r) => { refreshed.add(url); return r; }, (e) => {
      refreshed.add(url);
      writeJson(path.join(dir, 'refused.json'), { at: Date.now(), reason: String(e.message || e).slice(0, 200) });
      throw e;
    }).finally(() => pending.delete(url)));
  }
  try { return await pending.get(url); } catch (e) {
    if (have) return { ...have, stale: true };
    throw e;
  }
}

function lookup(rec, url) {
  if (rec.entries[url]) return rec.entries[url];
  // The same resource with another query (a cache-buster, a timestamp).
  if (!rec.paths) {
    rec.paths = new Map();
    for (const [u, e] of Object.entries(rec.entries)) { const k = u.split(/[?#]/)[0]; if (!rec.paths.has(k)) rec.paths.set(k, e); }
  }
  return rec.paths.get(url.split(/[?#]/)[0]) || null;
}
// A copy read from a saved page (mhtml.mjs) keeps its bodies in memory.
const bodyOf = (rec, e) => rec.inline?.[e.body] || readFileSync(path.join(CACHE, keyOf(rec.url), 'bodies', e.body));

/** Serve a Playwright context from the copy; anything not in it fails, as if offline. */
export async function serveFromCopy(context, rec) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const e = req.method() === 'GET' && lookup(rec, req.url());
    if (!e) return route.abort('internetdisconnected');
    return route.fulfill({ status: e.status, headers: servedHeaders(e), body: bodyOf(rec, e) });
  });
}

/** The same for a Puppeteer page. */
// A copy never sets cookies. (Copies recorded before this kept set-cookie,
// several of them joined by newlines, which DevTools' fulfillRequest refuses.)
const servedHeaders = (e) => { const { 'set-cookie': _, ...h } = e.headers || {}; return h; };

export async function serveFromCopyPuppeteer(page, rec) {
  await page.setRequestInterception(true);
  // Each answer's failure stays with that request (it fails to load), never
  // an unhandled rejection that ends the process (a review, mid-way).
  const quiet = (p) => Promise.resolve(p).catch(() => {});
  page.on('request', (req) => {
    if (/^(data|blob):/.test(req.url())) return quiet(req.continue());
    const e = req.method() === 'GET' && lookup(rec, req.url());
    if (!e) return quiet(req.abort('internetdisconnected'));
    return Promise.resolve().then(() => req.respond({ status: e.status, headers: servedHeaders(e), body: bodyOf(rec, e) }))
      .catch(() => quiet(req.abort('failed')));
  });
}

// --- command line ---------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'record') {
    if (args.includes('--refresh')) process.env.VERIFY_SITES = 'refresh';
    const names = args.slice(1).filter((a) => !a.startsWith('--'));
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    for (const s of KNOWN.filter((s) => !names.length || names.includes(s.name))) {
      try { const r = await prepareSite(browser, s.url); console.log(`${s.name}: ${r.stale ? 'kept the copy of' : 'copy from'} ${when(r.recordedAt)}, ${Object.keys(r.entries).length} files`); } catch (e) { console.log(`${s.name}: not recorded: ${e.message}`); }
    }
    await browser.close();
  } else {
    for (const s of KNOWN) {
      const r = readJson(path.join(CACHE, keyOf(s.url), 'index.json'));
      const refused = readJson(path.join(CACHE, keyOf(s.url), 'refused.json'));
      console.log(`${s.name.padEnd(16)} ${s.static ? 'demo (kept) ' : 'daily       '} ${r ? `${when(r.recordedAt)}, ${Object.keys(r.entries).length} files` : 'not recorded'}${refused ? `; refused ${when(refused.at)}: ${refused.reason}` : ''}`);
    }
  }
}
