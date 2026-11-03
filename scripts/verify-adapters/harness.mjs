// The sidebar's preview verifier, for the catalog's built-in adapters
// (tools/adapters/), in headless Chromium. The sidebar previews a web module
// on the person's page; a catalog adapter imports shared modules, so it is
// bundled first (esbuild) and its exported adapter is wrapped as a web module.
// What runs in the page is the sidebar's own preview script
// (extension/runtime/scripts.js, buildPreviewScript with audit on): axe-core's
// WCAG 2.0-2.2 A and AA rules before and after enable(), the agent's checks
// before and after, the changes enable() made and its layout shift. Then, as
// the sidebar cannot: disable(), and whether the page is back exactly as it
// was (its HTML), and the page's errors.
//
// A spec names the adapter and the test page it runs on:
//   { file: 'tools/adapters/big-targets.js', export: 'BigTargets',
//     page: 'big-targets.html',           // in tools/test/verify/pages/, or
//                                         // an https URL (a robustness site)
//     options: {},                        // enable(options)
//     ai: { describeImage: 'A red bicycle.' },   // fixed AI answers, by name
//     harness: { enable: '...', disable: '...' }, // for a module of fix
//                                         // functions, not an adapter: the
//                                         // bodies, with `m` its exports
//     checks: [{ name, code }],           // as in browser_preview
//     viewport: { width, height }, reducedMotion: 'reduce' | 'no-preference',
//     restores: false,                    // a fix module with nothing to undo
//                                         // (fix-tables): leftovers expected
//     known: { '<site>': 'why' } }        // a live site's known, explained
//                                         // problem: reported, not failed
//
// A core adapter (tools/core-adapters/<id>.js) is a web module built on the
// toolkit's building blocks, as the sidebar's assistant writes one: no
// imports, enable(options, toolkit). It runs as the sidebar's preview runs
// it, with the blocks bundle (extension/vendor/blocks.js) in the page and a
// stand-in for the extension behind them: zoom, the person's settings saved
// (profile.set) and speech are recorded in globalThis.__verifyHost, and AI
// answers come from the spec. Its pages are in tools/test/verify-core/pages/.
// The spec adds:
//     personal: { fontScale: 150, ... },  // the person's settings (toolkit.personal)
//     ai: { simplify: 'Plain words.' } | 'live',  // fixed answers by task, or the
//                                         // real model through the service's own
//                                         // prompts and checks (GEMINI_API_KEY)
// Checks can use trusted input, as the person's own: await __verifyClick(selector),
// await __verifyPress('Escape').

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildPreviewScript, previewTeardownScript } from '../../extension/runtime/scripts.js';
import { rewriteExports, instantiateWebModule } from '../../toolkit/protocol/adapter/package.js';
import { buildPrompt } from '../../toolkit/blocks/ai/prompts.js';
import { gateAnswer } from '../../server/src/ai.js';
import { createGeminiCaller } from '../../server/src/gemini.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PAGES = path.join(ROOT, 'tools/test/verify/pages');
const AXE = path.join(ROOT, 'cli/axe-core.min.js');
export const CORE = path.join(ROOT, 'tools/core-adapters');
export const CORE_PAGES = path.join(ROOT, 'tools/test/verify-core/pages');
const BLOCKS = path.join(ROOT, 'extension/vendor/blocks.js');
/** At most this many AI calls in one run of an adapter, so a loop cannot run up the bill. */
const MAX_AI_CALLS = 40;
export const isCore = (file) => path.resolve(ROOT, String(file || '')).startsWith(CORE + path.sep);

/** A core adapter's file: the web module, or what is wrong with it. */
export function coreModule(file) {
  const abs = path.resolve(ROOT, file);
  if (!isCore(file) || !existsSync(abs)) throw new Error(`No such core adapter: ${file}`);
  const code = readFileSync(abs, 'utf8');
  const { errors } = rewriteExports(code);
  if (errors.length) return { code, error: errors.join('; ') };
  try { instantiateWebModule(code); } catch (e) { return { code, error: e.message }; }
  return { code };
}

let gemini = null;
/** One AI request from the blocks, answered the way /v1/ai answers it. */
async function answerAi(spec, request, page, count) {
  const task = String(request?.task || '');
  let built;
  try { built = buildPrompt(task, request.input || '', request.options || {}); } catch (e) { return { text: null, reason: 'bad-options' }; }
  if (spec.ai && typeof spec.ai === 'object') {
    if (!(task in spec.ai) || spec.ai[task] === null) return { text: null, reason: 'unavailable' };
    return gateAnswer(task, String(spec.ai[task]), request.input || '', built.options);
  }
  if (spec.ai !== 'live' || !process.env.GEMINI_API_KEY) return { text: null, reason: 'unavailable' };
  if (count() > MAX_AI_CALLS) return { text: null, reason: 'budget' };
  gemini ||= createGeminiCaller({ apiKey: process.env.GEMINI_API_KEY, logContent: false });
  let images = [];
  if (request.kind === 'vision') {
    let image = request.image;
    if (!image && request.rect) {
      const r = request.rect;
      const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(4, r.width), height: Math.max(4, r.height) };
      image = { mimeType: 'image/png', data: (await page.screenshot({ clip })).toString('base64') };
    }
    if (!image) return { text: null, reason: 'not-captured' };
    images = [image];
  }
  try { return gateAnswer(task, await gemini(built.prompt, { images }), request.input || '', built.options); } catch { return { text: null, reason: 'model-error' }; }
}

/** In the page, before the adapter: the extension's side of the blocks, recorded. */
function fakeHost() {
  const rec = { zoom: 1, zoomCalls: [], profile: [], spoken: [] };
  Object.defineProperty(globalThis, '__verifyHost', { value: rec, configurable: true });
  const handle = async (m) => {
    if (m.type === 'ai4a11y:ai') return { ok: true, result: await globalThis.__verifyAi(m.request) };
    const r = m.request || {};
    if (m.type === 'ai4a11y:zoom') {
      rec.zoomCalls.push(r.op + (r.factor ? `:${r.factor}` : ''));
      if (r.op === 'get') return { ok: true, result: { factor: rec.zoom } };
      if (r.op === 'set') { rec.zoom = r.factor; return { ok: true, result: { ok: true } }; }
      if (r.op === 'restore') { rec.zoom = 1; return { ok: true, result: { ok: true } }; }
    }
    if (m.type === 'ai4a11y:profile') { rec.profile.push({ changes: r.changes, scope: r.scope }); return { ok: true, result: { saved: true } }; }
    return { ok: false, error: 'not offered here' };
  };
  // Speech: each word as an event, then the end, as chrome.tts sends them.
  const connect = () => {
    const onMessage = [], onDisconnect = [];
    let timers = [];
    const send = (e) => { for (const f of onMessage) f(e); };
    return {
      onMessage: { addListener: (f) => onMessage.push(f) },
      onDisconnect: { addListener: (f) => onDisconnect.push(f) },
      postMessage(m) {
        if (m.op === 'speak') {
          rec.spoken.push({ text: m.text, speechRate: m.speechRate, lang: m.lang });
          const words = [...String(m.text).matchAll(/\S+/g)];
          words.forEach((w, i) => timers.push(setTimeout(() => send({ type: 'word', charIndex: w.index, length: w[0].length }), 30 * (i + 1))));
          timers.push(setTimeout(() => send({ type: 'end' }), 30 * (words.length + 1)));
        } else if (m.op === 'stop') { timers.forEach(clearTimeout); timers = []; }
      },
      disconnect() { timers.forEach(clearTimeout); timers = []; },
    };
  };
  if (!globalThis.chrome) Object.defineProperty(globalThis, 'chrome', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis.chrome, 'runtime', { value: { sendMessage: handle, connect }, configurable: true });
}
// Libraries an adapter expects the page (the extension) to have loaded, for
// test pages to load from /_vendor/ (reader-mode uses Mozilla's Readability).
const VENDOR = { 'readability.js': createRequire(import.meta.url).resolve('@mozilla/readability/Readability.js') };
const ADAPTER_URL = 'ai4a11y-adapter.js';
const SHIM = `export const Verified = {
  enable(options, toolkit) { return globalThis.__verify.enable(options, toolkit); },
  disable() { return globalThis.__verify.disable(); },
};`;

/** The adapter file bundled for the page: its exports on globalThis.__verifyModule, and the AI provider setter. */
async function bundle(file) {
  const abs = path.resolve(ROOT, file);
  if (!abs.startsWith(path.join(ROOT, 'tools') + path.sep) || !existsSync(abs)) throw new Error(`No such catalog file: ${file}`);
  const out = await build({
    stdin: {
      contents: `import * as m from ${JSON.stringify(abs)};\nimport { setAIProvider } from ${JSON.stringify(path.join(ROOT, 'tools/utils/ai.js'))};\nglobalThis.__verifyModule = m;\nglobalThis.__verifySetAI = setAIProvider;`,
      resolveDir: ROOT, loader: 'js',
    },
    bundle: true, format: 'iife', write: false, logLevel: 'silent', platform: 'browser',
  });
  // Named, so an error from the adapter's code can be told from the site's.
  return `${out.outputFiles[0].text}\n//# sourceURL=${ADAPTER_URL}`;
}

/** Serves tools/test/verify/pages/ on 127.0.0.1, and VENDOR under /_vendor/. */
function pageServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (rel.startsWith('_vendor/') && VENDOR[rel.slice(8)]) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(readFileSync(VENDOR[rel.slice(8)])); return; }
    const dir = rel.startsWith('core/') ? CORE_PAGES : PAGES;
    if (dir === CORE_PAGES) rel = rel.slice(5);
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** In the page: the adapter (or the harness bodies) behind the web-module shim, and fixed AI answers. */
function install({ exportName, harness, ai }) {
  const m = globalThis.__verifyModule;
  globalThis.__verifyAnnounced = [];
  const answers = ai || {};
  const provider = { announce: (msg) => { globalThis.__verifyAnnounced.push(String(msg)); } };
  for (const [name, value] of Object.entries(answers)) provider[name] = async () => (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
  globalThis.__verifySetAI(provider);
  if (harness) {
    const AsyncFunction = (async () => {}).constructor;
    const enable = new AsyncFunction('m', 'options', harness.enable || '');
    const disable = new AsyncFunction('m', harness.disable || '');
    globalThis.__verify = { enable: (o) => enable(m, o), disable: () => disable(m) };
    return { ok: true };
  }
  const isAdapter = (v) => !!v && typeof v === 'object' && typeof v.enable === 'function' && typeof v.disable === 'function';
  const found = exportName ? [m[exportName]].filter(isAdapter) : Object.values(m).filter(isAdapter);
  if (found.length !== 1) return { ok: false, error: exportName ? `${exportName} is not an exported adapter (an object with enable and disable)` : `the file exports ${found.length} adapters; name one with "export"` };
  const a = found[0];
  globalThis.__verify = { enable: (o) => a.enable(o), disable: () => a.disable() };
  return { ok: true };
}

/**
 * The page's HTML, ignoring what makes no difference: empty class and style
 * attributes (left by classList and style removals) and the order of
 * attributes (removing one and setting it again moves it to the end).
 */
function snapshot() {
  const copy = document.documentElement.cloneNode(true);
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of ['class', 'style']) if (el.hasAttribute(name) && !el.getAttribute(name).trim()) el.removeAttribute(name);
    if (el.hasAttribute('class')) el.setAttribute('class', el.getAttribute('class').trim().split(/\s+/).join(' '));
    const attrs = [...el.attributes].map((a) => [a.name, a.value]).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    for (const [name] of attrs) el.removeAttribute(name);
    for (const [name, value] of attrs) el.setAttribute(name, value);
  }
  return copy.outerHTML;
}

/**
 * The toolkit's marks in the page: elements, classes, ids and data-
 * attributes named ai4a11y. What disable() leaves of them is left over,
 * whatever else a live page changed by itself meanwhile.
 */
function marks() {
  const out = new Set();
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (/ai4a11y/i.test(el.id)) out.add(`<${tag} id="${el.id}">`);
    for (const c of el.classList) if (/ai4a11y/i.test(c)) out.add(`<${tag} class="${c}">`);
    for (const a of el.attributes) if (/ai4a11y/i.test(a.name)) out.add(`<${tag} ${a.name}>`);
  }
  return [...out];
}

/** Where two snapshots of the page's HTML first differ, briefly. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 80);
  return { before: a.slice(from, i + 160), after: b.slice(from, i + 160) };
}

export async function openVerifier({ headless = true } = {}) {
  const server = await pageServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const axe = readFileSync(AXE, 'utf8');
  const blocks = readFileSync(BLOCKS, 'utf8');

  async function verify(spec, { screenshot = false } = {}) {
    if (!spec?.file) throw new Error('file is required');
    const core = isCore(spec.file);
    const pages = core ? CORE_PAGES : PAGES;
    const live = /^https:\/\//.test(String(spec.page || ''));
    if (!live && (!spec.page || !existsSync(path.resolve(pages, spec.page)))) throw new Error(`page must be a file in ${path.relative(ROOT, pages)}/ or an https URL (got ${spec.page})`);
    let code;
    if (core) {
      const m = coreModule(spec.file);
      if (m.error) return { status: 'failed', message: `Loading the adapter: ${m.error}`, errors: [] };
      code = m.code;
    } else code = await bundle(spec.file);
    // A live site's Content-Security-Policy would block the injected scripts, as the extension's user scripts are not.
    const context = await browser.newContext({ viewport: spec.viewport || { width: 1280, height: 800 }, reducedMotion: spec.reducedMotion || 'no-preference', bypassCSP: live });
    const page = await context.newPage();
    let aiCalls = 0;
    if (core) {
      await page.exposeFunction('__verifyAi', (request) => answerAi(spec, request, page, () => ++aiCalls));
      // Trusted input for checks: the person's own click or key.
      await page.exposeFunction('__verifyClick', async (selector) => { await page.click(String(selector), { timeout: 3000 }); return true; });
      await page.exposeFunction('__verifyPress', async (key) => { await page.keyboard.press(String(key)); return true; });
    }
    // On a live site, only errors from the adapter's code count; the site's
    // own scripts throw too (Deque's Mars demo, from its Facebook widget).
    // A resource the site fails to load (a 403, a blocked tracker) is the site's.
    const errors = [];
    let siteErrors = 0;
    const ours = (where) => !live || where.includes(ADAPTER_URL) || where.includes('__playwright_evaluation_script__');
    page.on('pageerror', (e) => { if (ours(e.stack || '')) errors.push(`page error: ${e.message}`); else siteErrors++; });
    page.on('console', (msg) => {
      if (msg.type() !== 'error' || /^Failed to load resource/.test(msg.text())) return;
      if (ours(`${msg.location()?.url || ''} ${msg.text()}`)) errors.push(`console error: ${msg.text()}`); else siteErrors++;
    });
    try {
      if (live) {
        const response = await page.goto(spec.page, { waitUntil: 'load', timeout: 45_000 });
        // A refusal or a bot challenge (Cloudflare answers 403 to some networks) is not the page.
        if (response && response.status() >= 400) throw new Error(`the site answered ${response.status()}`);
        await page.waitForTimeout(1500);
      } else await page.goto(`${base}/${core ? 'core/' : ''}${spec.page}`, { waitUntil: 'load' });
      // Run, then taken out again: the page's HTML is compared before and after.
      if (core) {
        for (const content of [axe, blocks]) await (await page.addScriptTag({ content })).evaluate((el) => el.remove());
        await page.evaluate(fakeHost);
      } else {
        for (const content of [axe, code]) await (await page.addScriptTag({ content })).evaluate((el) => el.remove());
        const installed = await page.evaluate(install, { exportName: spec.export, harness: spec.harness, ai: spec.ai });
        if (!installed.ok) return { status: 'failed', message: installed.error, errors };
      }
      await page.waitForTimeout(100);
      const htmlBefore = await page.evaluate(snapshot);
      const marksBefore = new Set(await page.evaluate(marks));
      // A page that changes by itself (a carousel, a clock) cannot be compared exactly.
      await page.waitForTimeout(500);
      const steady = (await page.evaluate(snapshot)) === htmlBefore;
      const loadErrors = errors.splice(0).length;
      const result = await page.evaluate(buildPreviewScript({
        code: core ? code : SHIM, urlPatterns: ['*'], parameters: spec.options || {}, checks: spec.checks || [], audit: true,
        ...(core ? { personal: spec.personal || {} } : {}),
      }));
      if (loadErrors) result.loadErrors = loadErrors;
      if (screenshot && result.status === 'applied') result.screenshot = (await page.screenshot()).toString('base64');
      result.announced = core ? [] : await page.evaluate(() => globalThis.__verifyAnnounced.slice(0, 10));
      if (result.status === 'applied') {
        const off = await page.evaluate(previewTeardownScript());
        await page.waitForTimeout(400);
        const htmlAfter = await page.evaluate(snapshot);
        result.disable = off === true ? 'ran' : String(off);
        if (core) {
          result.host = await page.evaluate(() => globalThis.__verifyHost);
          if (result.host.zoom !== 1) result.zoomLeft = result.host.zoom;
        }
        result.leftovers = (await page.evaluate(marks)).filter((m) => !marksBefore.has(m)).slice(0, 10);
        if (steady) {
          result.restored = htmlAfter === htmlBefore;
          if (!result.restored) result.difference = firstDifference(htmlBefore, htmlAfter);
        } else result.restored = result.leftovers.length ? false : 'unknown';
      }
      if (core) { result.aiCalls = aiCalls; if (result.status !== 'applied') result.host = await page.evaluate(() => globalThis.__verifyHost).catch(() => null); }
      result.errors = errors.slice(0, 10);
      if (siteErrors) result.siteErrors = siteErrors;
      return result;
    } finally {
      await context.close();
    }
  }

  async function close() {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  return { verify, close };
}
