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
//     viewport: { width, height }, reducedMotion: 'reduce' | 'no-preference' }

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildPreviewScript, previewTeardownScript } from '../../extension/runtime/scripts.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PAGES = path.join(ROOT, 'tools/test/verify/pages');
const AXE = path.join(ROOT, 'cli/axe-core.min.js');
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
  return out.outputFiles[0].text;
}

/** Serves tools/test/verify/pages/ on 127.0.0.1. */
function pageServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(PAGES, rel);
    if (!file.startsWith(PAGES + path.sep) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
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

/** The page's HTML, ignoring empty class and style attributes (left by classList and style removals, harmless). */
function snapshot() {
  const copy = document.documentElement.cloneNode(true);
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of ['class', 'style']) if (el.hasAttribute(name) && !el.getAttribute(name).trim()) el.removeAttribute(name);
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

  async function verify(spec, { screenshot = false } = {}) {
    if (!spec?.file) throw new Error('file is required');
    const live = /^https:\/\//.test(String(spec.page || ''));
    if (!live && (!spec.page || !existsSync(path.resolve(PAGES, spec.page)))) throw new Error(`page must be a file in tools/test/verify/pages/ or an https URL (got ${spec.page})`);
    const code = await bundle(spec.file);
    // A live site's Content-Security-Policy would block the injected scripts, as the extension's user scripts are not.
    const context = await browser.newContext({ viewport: spec.viewport || { width: 1280, height: 800 }, reducedMotion: spec.reducedMotion || 'no-preference', bypassCSP: live });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console error: ${msg.text()}`); });
    try {
      if (live) {
        await page.goto(spec.page, { waitUntil: 'load', timeout: 45_000 });
        await page.waitForTimeout(1500);
      } else await page.goto(`${base}/${spec.page}`, { waitUntil: 'load' });
      // Run, then taken out again: the page's HTML is compared before and after.
      for (const content of [axe, code]) await (await page.addScriptTag({ content })).evaluate((el) => el.remove());
      const installed = await page.evaluate(install, { exportName: spec.export, harness: spec.harness, ai: spec.ai });
      if (!installed.ok) return { status: 'failed', message: installed.error, errors };
      await page.waitForTimeout(100);
      const htmlBefore = await page.evaluate(snapshot);
      const marksBefore = new Set(await page.evaluate(marks));
      // A page that changes by itself (a carousel, a clock) cannot be compared exactly.
      await page.waitForTimeout(500);
      const steady = (await page.evaluate(snapshot)) === htmlBefore;
      const loadErrors = errors.splice(0).length;
      const result = await page.evaluate(buildPreviewScript({
        code: SHIM, urlPatterns: ['*'], parameters: spec.options || {}, checks: spec.checks || [], audit: true,
      }));
      if (loadErrors) result.loadErrors = loadErrors;
      if (screenshot && result.status === 'applied') result.screenshot = (await page.screenshot()).toString('base64');
      result.announced = await page.evaluate(() => globalThis.__verifyAnnounced.slice(0, 10));
      if (result.status === 'applied') {
        const off = await page.evaluate(previewTeardownScript());
        await page.waitForTimeout(400);
        const htmlAfter = await page.evaluate(snapshot);
        result.disable = off === true ? 'ran' : String(off);
        result.leftovers = (await page.evaluate(marks)).filter((m) => !marksBefore.has(m)).slice(0, 10);
        if (steady) {
          result.restored = htmlAfter === htmlBefore;
          if (!result.restored) result.difference = firstDifference(htmlBefore, htmlAfter);
        } else result.restored = result.leftovers.length ? false : 'unknown';
      }
      result.errors = errors.slice(0, 10);
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
