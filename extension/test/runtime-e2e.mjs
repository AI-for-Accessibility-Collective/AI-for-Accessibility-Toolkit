// Real Chromium, the real unpacked adapter runtime, a real toolkit service
// and a test site: adapters published to the registry run on the pages they
// target, pick up edits without a reload, report back, switch off per site,
// and stop when uninstalled or disconnected.
//
//   npm run test:runtime:e2e
//
// Turns on the extension's "Allow User Scripts" switch in chrome://extensions,
// as a developer does by hand. No LLM, no network beyond loopback.

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../../server/src/app.js';
import { fileStore } from '../../server/src/store.js';
import { createToolkitHost } from '../../server/src/toolkit-host.js';
import { createRegistryClient, defineDescriptor } from '../../toolkit/adapter-mcp/index.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EXT_DIR = path.resolve(HERE, '..');
const ADMIN = 'test-admin';

const dir = await mkdtemp(path.join(tmpdir(), 'runtime-e2e-'));
const store = fileStore(dir);
const host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// The site the adapters fix, on another port, reached as "localhost".
const site = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><title>Shop</title></head><body><h1>Shop</h1><button id="buy">Buy</button><p id="path">${req.url.replace(/[<>&]/g, '')}</p></body></html>`);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const shop = `http://localhost:${site.address().port}`;

const until = async (check, what, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
};

async function account(uid) {
  const made = await (await fetch(`${base}/admin/accounts`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid }) })).json();
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uid, password: made.password }) })).json();
  return { password: made.password, token: login.defaultToken };
}

// The adapter marks the page so the test can see it; disable() undoes it.
const ADAPTER = (mark) => `export const BigButtons = {
  enabled: false,
  enable(options = {}) {
    this.enabled = true;
    document.body.dataset.bigButtons = '${mark}:' + (options.size || 44);
    document.getElementById('buy').style.minHeight = (options.size || 44) + 'px';
  },
  disable() {
    this.enabled = false;
    delete document.body.dataset.bigButtons;
    document.getElementById('buy').style.minHeight = '';
  },
};`;
const describe = (id, name, urls = ['http://localhost/*']) => defineDescriptor({
  appId: 'console', id, name, description: `${name} for the test shop.`, version: '1.0.0',
  targets: [{ platforms: ['*'], urls }], supportAreas: ['motor'],
  inputSchema: { type: 'object', properties: { size: { type: 'number' } }, additionalProperties: false },
});

let context, profileDir;
try {
  const dev = await account('dev');
  const other = await account('other');
  const registry = createRegistryClient({ url: base, token: dev.token });
  const otherRegistry = createRegistryClient({ url: base, token: other.token });
  const KEY = { owner: 'dev', appId: 'console', id: 'big-buttons' };
  await registry.publish({ appName: 'Developer console', descriptor: describe('big-buttons', 'Big buttons'), code: ADAPTER('r1') });
  await registry.install('browser-runtime', KEY);

  profileDir = await mkdtemp(path.join(tmpdir(), 'runtime-e2e-profile-'));
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--no-first-run'],
  });
  const firstWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(firstWorker.url()).host;
  const worker = async () => context.serviceWorkers().find(w => w.url().includes(extId));
  const runtime = async (fn, arg) => (await worker()).evaluate(fn, arg);

  // Before user scripts are allowed, the runtime says so.
  const before = await runtime(() => globalThis.ai4a11yRuntime.handlers.status());
  assert.equal(before.state.scripts.available, false);
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${extId}`);
  await settings.getByRole('button', { name: /user scripts/i }).click();
  await until(async () => (await worker()) && runtime(() => typeof chrome.userScripts === 'object' && !!globalThis.ai4a11yRuntime), 'user scripts to be allowed');
  await settings.close();

  // Connecting refuses a bad address and a bad token before it accepts the real one.
  await assert.rejects(runtime(([url, token]) => globalThis.ai4a11yRuntime.handlers.connect({ url, token }), ['http://toolkit.example', dev.token]), /https/);
  await assert.rejects(runtime(([url]) => globalThis.ai4a11yRuntime.handlers.connect({ url, token: 'aat_wrong' }), [base]), /did not accept/);
  // The workshop path: sign in to the console, then one click in the popup.
  const signedIn = await context.newPage();
  await signedIn.goto(`${base}/developer`);
  await signedIn.fill('#signin-username', 'dev');
  await signedIn.fill('#signin-password', dev.password);
  await signedIn.click('#signin');
  await signedIn.waitForFunction(() => document.getElementById('sidebar-token-value').textContent.startsWith('aat_'));
  const consoleTabId = await runtime((url) => chrome.tabs.query({ url: `${url}/developer*` }).then(t => t[0].id), base);
  const connectPopup = await context.newPage();
  await connectPopup.goto(`chrome-extension://${extId}/popup/popup.html?tab=${consoleTabId}`);
  await connectPopup.locator('#use-console').waitFor();
  assert.equal(await connectPopup.locator('#console-origin').innerText(), base);
  await connectPopup.getByRole('button', { name: 'Connect with this console' }).click();
  await connectPopup.locator('#connected').waitFor();
  assert.match(await connectPopup.locator('#status').innerText(), /^Connected as dev\./);
  await connectPopup.close();
  await signedIn.close();
  const connected = (await runtime(() => globalThis.ai4a11yRuntime.handlers.status())).connection;
  assert.deepEqual(connected, { url: base, uid: 'dev' });
  const registered = await runtime(() => chrome.userScripts.getScripts().then(s => s.map(x => [x.id, x.matches])));
  assert.deepEqual(registered, [['rt-dev~console~big-buttons', ['http://localhost/*']]]);

  // Waits on the shop tab poll on an interval: other pages come to the front
  // during the test, and a background tab's animation frames are throttled.
  const background = { polling: 100, timeout: 15000 };

  // ── it runs on the page it targets, with its parameters, and reports back ──
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(`${shop}/products`);
  await page.waitForFunction(() => document.body.dataset.bigButtons === 'r1:44', null, background);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('buy')).minHeight), '44px');
  const statusOf = async (status) => (await registry.status({ adapter: KEY })).results.find(r => r.status === status && r.origin === shop);
  const applied = await until(() => statusOf('applied'), 'the applied report');
  assert.equal(applied.revision, 1);
  assert.match(applied.label, /^Chrome \d+/);
  await registry.install('browser-runtime', KEY, { parameters: { size: 60 } });

  // ── an edit shows up in the open page without a reload ──
  await page.evaluate(() => { window.__sameDocument = true; });
  const r2 = await registry.publish({ descriptor: describe('big-buttons', 'Big buttons'), code: ADAPTER('r2') });
  assert.equal(r2.revision, 2);
  await page.waitForFunction(() => document.body.dataset.bigButtons === 'r2:60', null, background);
  assert.equal(await page.evaluate(() => window.__sameDocument), true, 'the page was not reloaded');
  await until(async () => (await statusOf('applied'))?.revision === 2, 'the revision 2 report');

  // ── a page the adapter does not target is left alone ──
  const elsewhere = await context.newPage();
  await elsewhere.goto(`${base}/v1/healthz`);
  await elsewhere.waitForTimeout(500);
  assert.equal(await elsewhere.evaluate(() => document.body.dataset.bigButtons), undefined);
  await elsewhere.close();

  // ── switched off on this site: the open page goes back, and stays back on reload ──
  await runtime(([key, origin]) => globalThis.ai4a11yRuntime.handlers.setSite({ key, origin, on: false }), ['dev/console/big-buttons', shop]);
  await page.waitForFunction(() => document.body.dataset.bigButtons === undefined, null, background);
  assert.equal(await page.evaluate(() => document.getElementById('buy').style.minHeight), '', 'disable() put the page back');
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.body.dataset.bigButtons), undefined);
  await until(() => statusOf('skipped'), 'the skipped report');
  await runtime(([key, origin]) => globalThis.ai4a11yRuntime.handlers.setSite({ key, origin, on: true }), ['dev/console/big-buttons', shop]);
  await page.waitForFunction(() => document.body.dataset.bigButtons === 'r2:60', null, background);

  // ── someone else's shared adapter, installed pinned, runs too ──
  await otherRegistry.publish({
    appName: 'Redbird demo',
    descriptor: { ...describe('labels', 'Button labels'), appId: 'redbird' },
    code: `export default { enable() { document.getElementById('buy').setAttribute('aria-label', 'Buy now'); }, disable() { document.getElementById('buy').removeAttribute('aria-label'); } };`,
    shared: true,
  });
  const found = await registry.search({ scope: 'shared', url: `${shop}/products` });
  assert.deepEqual(found.adapters.map(a => `${a.owner}/${a.adapter.appId}/${a.adapter.id}`), ['other/redbird/labels']);
  await registry.install('browser-runtime', found.adapters[0].adapter);
  await page.waitForFunction(() => document.getElementById('buy').getAttribute('aria-label') === 'Buy now', null, background);

  // ── a broken adapter fails with its reason, and the others keep working ──
  await registry.publish({ descriptor: describe('broken', 'Broken'), code: `export const Broken = { enable() { document.querySelector('#nope').click(); }, disable() {} };` });
  await registry.install('browser-runtime', { appId: 'console', id: 'broken' });
  const failed = await until(async () => (await registry.status({ adapter: { appId: 'console', id: 'broken' } })).results.find(r => r.status === 'failed'), 'the failed report');
  assert.match(failed.message, /enable\(\) threw: .*null/);
  assert.equal(await page.evaluate(() => document.body.dataset.bigButtons), 'r2:60');

  // ── the popup shows the connection and what is installed ──
  const shopTabId = await runtime((url) => chrome.tabs.query({ url: `${url}/*` }).then(t => t[0].id), shop);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html?tab=${shopTabId}`);
  await popup.locator('#connected').waitFor();
  await popup.locator('#page-adapters li').nth(2).waitFor();
  const onPage = await popup.locator('#page-adapters li').allInnerTexts();
  assert.ok(onPage.some(t => /Big buttons[\s\S]*Developer console · yours · revision 2[\s\S]*Running on this page/.test(t)), onPage.join('\n---\n'));
  assert.ok(onPage.some(t => /Button labels[\s\S]*shared by other/.test(t)), onPage.join('\n---\n'));
  assert.ok(onPage.some(t => /Broken[\s\S]*Failed: enable\(\) threw/.test(t)), onPage.join('\n---\n'));
  // The popup's switch turns one off for this site.
  await popup.getByRole('switch', { name: `Big buttons on ${shop}` }).uncheck();
  await page.waitForFunction(() => document.body.dataset.bigButtons === undefined, null, background);
  await popup.getByRole('switch', { name: `Big buttons on ${shop}` }).check();
  await page.waitForFunction(() => document.body.dataset.bigButtons === 'r2:60', null, background);
  assert.match(await popup.locator('.who').innerText(), /Connected to 127\.0\.0\.1:\d+ as dev/);
  assert.match(await popup.locator('#installed-count').innerText(), /^3 adapters installed/);
  assert.equal(await popup.locator('#user-scripts').isHidden(), true);
  await popup.close();
  await page.bringToFront();

  // ── the console bridge: the console learns this browser's runtime is connected ──
  const consolePage = await context.newPage();
  await consolePage.addInitScript(() => {
    window.__runtime = [];
    window.addEventListener('message', (e) => { if (e.data?.source === 'ai4a11y-runtime') window.__runtime.push(e.data); });
  });
  await consolePage.goto(`${base}/developer`);
  const present = await consolePage.waitForFunction(() => window.__runtime.find(m => m.type === 'present' && m.connected), null, { timeout: 15000 });
  const presence = await present.jsonValue();
  assert.deepEqual([presence.uid, presence.userScripts, presence.adapters], ['dev', true, 3]);
  assert.ok(!JSON.stringify(presence).includes('aat_'), 'the token never reaches the page');
  // A save in the console wakes the runtime at once.
  await registry.publish({ descriptor: describe('big-buttons', 'Big buttons'), code: ADAPTER('r3') });
  await consolePage.evaluate(() => window.postMessage({ source: 'ai4a11y-console', type: 'adapters-changed' }, location.origin));
  await page.waitForFunction(() => document.body.dataset.bigButtons === 'r3:60', null, background);
  await consolePage.close();

  // ── uninstalling stops it in the open page ──
  await registry.uninstall('browser-runtime', { owner: 'other', appId: 'redbird', id: 'labels' });
  await page.waitForFunction(() => !document.getElementById('buy').hasAttribute('aria-label'), null, background);

  // ── the whole loop from the console: write an adapter there, it runs here, the console shows it ──
  const consoleUi = await context.newPage();
  consoleUi.on('pageerror', e => pageErrors.push(`console: ${e.message}`));
  await consoleUi.goto(`${base}/developer#/adapters`);
  // Still signed in from the popup connect above: the console keeps its session.
  await consoleUi.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Signed in'));
  await consoleUi.waitForFunction(() => document.getElementById('ws-runtime-state').textContent === 'Connected in this browser', null, { timeout: 15000 });
  await consoleUi.click('#ws-new');
  await consoleUi.fill('#ws-name', 'Shop heading label');
  await consoleUi.fill('#ws-urls', 'http://localhost/*');
  await consoleUi.fill('#ws-code', `export const HeadingLabel = {
  enable() { document.querySelector('h1').dataset.fromConsole = 'yes'; },
  disable() { delete document.querySelector('h1').dataset.fromConsole; },
};`);
  await consoleUi.click('#ws-save');
  await consoleUi.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved Shop heading label, revision 1.'));
  await page.waitForFunction(() => document.querySelector('h1').dataset.fromConsole === 'yes', null, background);
  const consoleCard = consoleUi.locator('.adapter-card[data-adapter="dev/console/shop-heading-label"]');
  await consoleCard.locator('.runtime-results li.applied').first().waitFor({ timeout: 15000 });
  assert.match(await consoleCard.locator('.runtime-results').innerText(), new RegExp(`Running on ${shop.replaceAll('.', '\\.')} · revision 1 · Chrome \\d+`));
  await consoleCard.getByRole('button', { name: 'Stop running Shop heading label in my browser' }).click();
  await page.waitForFunction(() => document.querySelector('h1').dataset.fromConsole === undefined, null, background);
  await consoleUi.close();

  // ── disconnecting removes every script and turns everything off ──
  await runtime(() => globalThis.ai4a11yRuntime.handlers.disconnect());
  await page.waitForFunction(() => document.body.dataset.bigButtons === undefined, null, background);
  assert.deepEqual(await runtime(() => chrome.userScripts.getScripts().then(s => s.length)), 0);
  assert.deepEqual(pageErrors, [], 'the adapters raised no page errors');
  console.log('Adapter runtime browser workflow passed: user-scripts switch, connect checks, run on target pages with parameters, live edit without reload, exact scope, per-site off and on, a shared pinned adapter, a failing adapter reported, popup, console bridge wake-up, uninstall, writing an adapter in the console that runs here and reports back, disconnect.');
} finally {
  await context?.close().catch(() => {});
  app.registry.closeAll();
  app.relay.closeAll();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  site.closeAllConnections?.();
  await new Promise(resolve => site.close(resolve));
  await rm(dir, { recursive: true, force: true });
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
