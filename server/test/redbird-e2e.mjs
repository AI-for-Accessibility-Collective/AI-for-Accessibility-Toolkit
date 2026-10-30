// Real browser + real toolkit service + the Redbird practice store: a
// developer signs in, presses Open Redbird, and the store tab shows up under
// Apps as "Redbird demo"; its adapters are then driven from the console's Try
// it panel and from an MCP client holding the same default token.
//
// Needs a Redbird checkout next to this repository (../redbird) or at
// REDBIRD_DIR; skips when there is none.
//
//   npm run test:redbird:e2e

import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createMcpClient, adapterClient } from '../../toolkit/adapter-mcp/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REDBIRD = path.resolve(process.env.REDBIRD_DIR || path.join(here, '../../../redbird'));
if (!existsSync(path.join(REDBIRD, 'workshop/toolkit.js'))) {
  console.log(`Skipped the Redbird workflow: no Redbird checkout with workshop/toolkit.js at ${REDBIRD} (set REDBIRD_DIR).`);
  process.exit(0);
}

// The store, served the way its tools/serve.py does: /search opens
// search.html, and /api/ai answers "no AI" so adapters use their fallbacks.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
async function resolveFile(urlPath) {
  const local = path.join(REDBIRD, path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, ''));
  if (!local.startsWith(REDBIRD)) return null;
  for (const candidate of [local, `${local}.html`, path.join(local, 'index.html')]) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile()) return candidate;
  }
  return null;
}
const store = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (req.method === 'POST' && urlPath === '/api/ai') {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"result": null, "error": "AI runs on the deployed site only"}');
  }
  const file = await resolveFile(urlPath);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise(resolve => store.listen(0, '127.0.0.1', resolve));
// localhost, not 127.0.0.1: a different origin from the toolkit, as in a workshop.
const storeUrl = `http://localhost:${store.address().port}`;

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'redbird-e2e-'));
const dataStore = fileStore(dir);
const app = createApp({ store: dataStore, adminPassword: ADMIN, corsOrigins: ['*'], toolkitHost: createToolkitHost({ store: dataStore, geminiCaller: async () => { throw new Error('LLM disabled in test'); } }) });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
try {
  // An account, made the way the admin console makes one.
  const made = await fetch(`${base}/admin/accounts`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`admin:${ADMIN}`).toString('base64')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ uid: 'team-3', displayName: 'Team 3' }),
  });
  assert.equal(made.status, 201);
  const { password } = await made.json();

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const dev = await context.newPage();
  dev.setDefaultTimeout(15000);
  dev.on('pageerror', e => errors.push(`developer: ${e.message}`));
  await dev.goto(`${base}/developer`);
  await dev.fill('#signin-username', 'team-3');
  await dev.fill('#signin-password', password);
  await dev.click('#signin');
  await dev.waitForFunction(() => document.getElementById('connection-state').textContent === 'Signed in');
  const token = (await dev.locator('#sidebar-token-value').innerText()).trim();

  // Something in the profile, so "Your toolkit profile" has content to read.
  const set = await fetch(`${base}/v1/librarian/setProfileField`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['freeText', 'Countdown timers make me rush.'] }),
  });
  assert.equal(set.status, 200);

  // ── Open Redbird from the console ──────────────────────────────────────
  await dev.click('.nav-link[data-page="apps"]');
  await dev.fill('#redbird-url', storeUrl);
  const [shop] = await Promise.all([context.waitForEvent('page'), dev.getByRole('button', { name: 'Open Redbird' }).click()]);
  shop.setDefaultTimeout(15000);
  shop.on('pageerror', e => errors.push(`redbird: ${e.message}`));
  await shop.waitForLoadState('domcontentloaded');
  await shop.waitForFunction(() => !location.hash, null, { timeout: 15000 });
  assert.ok(!shop.url().includes('aat_'), 'the token leaves the address bar once read');
  assert.equal(JSON.parse(await shop.evaluate(() => localStorage.getItem('redbird:toolkit'))).token, token);

  // The tab shows up grouped under Redbird demo, live.
  await dev.waitForFunction(() => [...document.querySelectorAll('#app-groups .app-group h3')].some(h => h.textContent.includes('Redbird demo')), null, { timeout: 20000 });
  const group = dev.locator('.app-group', { hasText: 'Redbird demo' });
  assert.match(await group.innerText(), /Live/);
  assert.match(await group.innerText(), /Store tab/);
  for (const name of ['Real arrival dates', 'Swatch names', 'Calm urgency', 'Reading level', 'Pause moving things', 'Fix this page']) {
    assert.ok(await group.getByRole('heading', { name, exact: true }).count(), `${name} is exported`);
  }

  // ── Try it from the console: calm urgency, hiding ──────────────────────
  await group.getByRole('button', { name: 'Try Calm urgency' }).click();
  const panel = dev.getByRole('group', { name: 'Try Calm urgency' });
  await dev.waitForFunction(() => /^http:\/\/localhost:\d+\/$/.test(document.querySelector('.try-panel input[id^="target-"]')?.value || ''));
  await panel.getByLabel(/^mode/).selectOption({ label: 'hide' });
  await panel.getByRole('button', { name: 'Turn on / update' }).click();
  await dev.waitForFunction(() => document.querySelector('.try-result')?.textContent.includes('Calm urgency: done'), null, { timeout: 20000 });
  await shop.waitForFunction(() => new URLSearchParams(location.search).get('try')?.split(',').includes('calm-urgency'));
  await dev.screenshot({ path: path.join(tmpdir(), 'toolkit-redbird-console.png'), fullPage: true });
  await shop.screenshot({ path: path.join(tmpdir(), 'toolkit-redbird-store.png') });

  // ── The same tab through MCP, as a coding agent would ─────────────────
  const mcp = createMcpClient({ url: `${base}/v1/mcp/apps/redbird`, token, clientInfo: { name: 'redbird-e2e', version: '0' } });
  assert.equal((await mcp.initialize()).serverInfo.name, 'redbird-adapters');
  const tools = (await mcp.listTools()).map(t => t.name);
  for (const tool of ['adapter_list', 'adapter_apply', 'adapter_revert', 'apply_calm-urgency']) assert.ok(tools.includes(tool), `${tool} is offered`);
  const api = adapterClient(mcp);
  const listing = await api.list();
  assert.equal(listing.application?.appId ?? listing.adapters[0].appId, 'redbird');
  const calm = (await api.describe('redbird', 'calm-urgency')).descriptor;
  const [{ target }] = (await api.targets(calm)).candidates;
  const state = await api.query(calm, target);
  assert.equal(state.state.enabled, true, 'MCP sees what the console turned on');
  assert.deepEqual(state.state.requestedParameters, { mode: 'hide' });

  const swatch = (await api.describe('redbird', 'swatch-names')).descriptor;
  const applied = await api.apply(swatch, target, { enabled: true, parameters: {} }, 'e2e-swatch-1');
  assert.equal(applied.status, 'applied', JSON.stringify(applied.reasons));
  await shop.waitForFunction(() => new URLSearchParams(location.search).get('try')?.split(',').includes('swatch-names'));
  const reverted = await api.revert(applied.undo.receiptId);
  assert.equal(reverted.status, 'applied', JSON.stringify(reverted.reasons));
  await shop.waitForFunction(() => !new URLSearchParams(location.search).get('try')?.split(',').includes('swatch-names'));

  const elsewhere = await api.check(swatch, { url: `${storeUrl}/cart` }, { enabled: true, parameters: {} });
  assert.equal(elsewhere.compatible, false, 'one tab is one page');
  assert.ok(elsewhere.reasons.some(r => r.code === 'target-unavailable'), JSON.stringify(elsewhere.reasons));

  // ── Loading a preset in the console reaches the open store, with no refresh ──
  await shop.evaluate(() => { window.__sameLoad = true; });
  const persona = shop.locator('#ws-persona');
  await persona.filter({ hasText: 'Countdown timers make me rush' }).waitFor();
  await dev.click('.nav-link[data-page="profiles"]');
  await dev.locator('button[data-load="wai-2"]').click();
  await dev.waitForFunction(() => document.getElementById('draft-state').textContent === 'Applied');
  await persona.filter({ hasText: 'remove distracting motion' }).waitFor();
  assert.match(await persona.innerText(), /Profile 2/, 'the store shows which preset is selected');
  assert.match(await shop.locator('#ws-prof option[value="toolkit"]').innerText(), /Profile 2/);
  assert.equal(await shop.evaluate(() => window.__sameLoad), true, 'the store was not reloaded');
  // An edit through the API keeps the preset's name and says it was edited.
  await fetch(`${base}/v1/librarian/setProfileField`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['freeText', 'Keep things calm and quiet.'] }),
  });
  await persona.filter({ hasText: 'calm and quiet' }).waitFor();
  assert.match(await persona.innerText(), /Profile 2.*edited/s);
  assert.equal(await shop.evaluate(() => window.__sameLoad), true, 'still the same page');

  // ── Picking a preset in the store changes the toolkit's profile, and the console sees it ──
  const picker = shop.locator('#ws-prof');
  await picker.locator('optgroup#ws-presets option', { hasText: 'Profile 3' }).waitFor({ state: 'attached' });
  assert.ok(await picker.locator('optgroup#ws-presets option').count() >= 9, 'the toolkit\'s presets are offered');
  await picker.selectOption({ label: await picker.locator('optgroup#ws-presets option', { hasText: 'Profile 3' }).innerText() });
  await persona.filter({ hasText: 'screen-reader structure' }).waitFor();
  assert.match(await persona.innerText(), /Profile 3/);
  assert.equal(await picker.inputValue(), 'toolkit', 'the store goes back to following the toolkit profile');
  const chosen = await (await fetch(`${base}/v1/profile/selection`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(chosen.selected, { id: 'wai-3', name: 'Profile 3', edited: false });
  assert.equal(await shop.evaluate(() => window.__sameLoad), true, 'picking a preset did not reload the store either');
  await dev.click('#refresh');
  await dev.waitForFunction(() => /screen-reader structure/.test(document.getElementById('profile-json').value));

  // ── Closing the tab leaves the app offline in the console ──────────────
  await shop.close({ runBeforeUnload: true });
  await dev.waitForFunction(() => [...document.querySelectorAll('.app-group')].some(g => g.textContent.includes('Redbird demo') && g.textContent.includes('Offline')), null, { timeout: 20000 });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Redbird browser workflow passed: Open Redbird from the console, the tab appearing live under Redbird demo, Try it with a parameter, the same tab through MCP (list, query, apply, revert, one-page targets), a preset loaded in the console reaching the open store with no refresh, picking a toolkit preset from the store dropdown, and going offline when the tab closes.');
} finally {
  await browser?.close();
  app.relay.closeAll();
  server.closeAllConnections?.();
  store.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => store.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
