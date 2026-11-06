// Real browser + real toolkit service, Listings page: sidebar navigation,
// listings (the adapter marketplace) and shared registry adapters grouped by
// app and folded until opened, filters, install state, running a shared one
// in the browser, code viewing, and deletion. No LLM required.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/registry.js';
import { defineDescriptor } from '../../toolkit/protocol/adapter/index.js';

const dir = await mkdtemp(path.join(tmpdir(), 'adapters-e2e-'));
const store = fileStore(dir), host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: host }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const { token } = await (await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'adapters-e2e' }) })).json();
  // Seed the marketplace the way apps do: a browser extension syncing its
  // catalog (one entry with code), and an XR app with a data-only listing.
  const seed = await fetch(base + '/v1/adapters/sync', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'browser-extension', appName: 'Browser Extension', full: true, adapters: [
      { id: 'dark-mode', name: 'Dark Mode', description: 'Inverts the page to a dark theme.', settingsKeys: ['darkMode'], supportAreas: ['vision'], sourceUrl: 'https://example.test/dark' },
      { id: 'letter-spacing', name: 'Letter Spacing', description: 'Widens letter spacing for readability.', settingsKeys: ['letterSpacing'], supportAreas: ['vision', 'reading'], code: 'document.documentElement.style.letterSpacing = "0.12em";' },
    ] }),
  });
  assert.equal(seed.status, 200);
  await fetch(base + '/v1/adapters', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'xr', appName: 'XR Task Guide', id: 'one-step', name: 'One Step at a Time', description: 'Speak one action, then wait.', supportAreas: ['cognitive'] }),
  });

  // Another account shares an adapter through the registry: it is listed too, under its app.
  const { token: boToken } = await (await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'bo' }) })).json();
  const bo = createRegistryClient({ url: base, token: boToken });
  const shared = await bo.publish({ appName: 'Bo’s tools', code: 'export const Big = { enable() {}, disable() {} };\n', descriptor: defineDescriptor({
    appId: 'bo-tools', id: 'big-links', name: 'Bigger links', description: 'Makes small links bigger to hit.', version: '1.0.0',
    targets: [{ platforms: ['*'], urls: ['https://shop.example/*'] }], supportAreas: ['motor'],
    needs: [{ id: 'big-links', phrase: 'Bigger links', description: 'Makes small links bigger.', abilities: 'Small targets are hard to hit.' }] }) });
  await bo.share(shared.adapter);

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`${base}/developer#/listings`);
  assert.match(await page.locator('#environment').innerText(), /ADAPTER LISTINGS/);
  assert.equal(await page.locator('#page-profiles').isHidden(), true, 'the hash opens the Listings page');
  assert.match(await page.locator('#adapter-groups').innerText(), /Sign in \(or connect with a token\)/);

  // Sidebar navigation switches pages without losing the shell.
  await page.click('.nav-link[data-page="profiles"]');
  await page.waitForFunction(() => document.getElementById('environment').textContent.includes('PROFILE MANAGER'));
  assert.equal(await page.locator('#page-profiles').isHidden(), false);
  await page.click('.nav-link[data-page="listings"]');
  await page.waitForFunction(() => document.getElementById('environment').textContent.includes('ADAPTER LISTINGS'));
  assert.equal(await page.locator('#page-listings').isHidden(), false);

  // Connect; the marketplace loads.
  await page.click('#token-connect summary');
  await page.fill('#instance-token', token);
  await page.click('#connect');
  await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Connected'));
  await page.waitForFunction(() => document.querySelectorAll('#adapter-groups .adapter-group').length === 3);
  assert.equal(await page.locator('#adapter-count').innerText(), '4');
  const groupNames = await page.locator('.adapter-group > .section-heading h3').allInnerTexts();
  assert.deepEqual(groupNames, ['Browser Extension', 'XR Task Guide', 'Bo’s tools']);
  // Folded until opened; there is no form to register a listing (the skill does that).
  assert.equal(await page.locator('.listing-group[open]').count(), 0);
  assert.equal(await page.locator('#new-adapter, #register-form').count(), 0);
  assert.equal(await page.locator('.adapter-card').first().isVisible(), false);
  for (const name of groupNames) await page.locator('.listing-group > summary', { hasText: name }).click();
  assert.match(await page.locator('.adapter-group').first().innerText(), /app id: browser-extension/);
  // The shared adapter: by its owner, with its need, and it runs in this browser.
  const sharedCard = page.locator('.adapter-card', { hasText: 'Bigger links' });
  assert.match(await sharedCard.innerText(), /Shared[\s\S]*Bigger links[\s\S]*motor[\s\S]*by bo/);
  await sharedCard.getByRole('button', { name: 'Run Bigger links in my browser' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Bigger links runs in your browser runtime'));
  assert.ok((await createRegistryClient({ url: base, token }).installed('browser-runtime')).adapters.some(a => a.adapter.id === 'big-links'));
  await sharedCard.getByRole('button', { name: 'Stop running Bigger links in my browser' }).click();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Bigger links stopped'));
  // Opened groups stay open across a refresh.
  await page.click('#adapter-refresh');
  await page.waitForFunction(() => document.querySelectorAll('.listing-group[open]').length === 3);
  await page.selectOption('#adapter-kind', 'shared');
  assert.equal(await page.locator('#adapter-count').innerText(), '1');
  await page.selectOption('#adapter-kind', '');

  // Filters: by app, by kind, and by search text.
  await page.selectOption('#adapter-app', 'xr');
  assert.equal(await page.locator('#adapter-count').innerText(), '1');
  await page.selectOption('#adapter-app', '');
  await page.selectOption('#adapter-kind', 'code');
  assert.deepEqual(await page.locator('.adapter-card h3 .badge').first().allInnerTexts(), ['Data + code']);
  await page.selectOption('#adapter-kind', '');
  await page.fill('#adapter-search', 'dark');
  assert.equal(await page.locator('#adapter-count').innerText(), '1');
  await page.fill('#adapter-search', '');

  // View code on the data + code listing.
  await page.getByRole('button', { name: 'View code' }).first().click();
  await page.waitForFunction(() => document.querySelector('.adapter-code pre')?.textContent.includes('letterSpacing'));
  assert.match(await page.locator('.adapter-code summary').innerText(), /sha256/);

  // Install / uninstall round trip through per-user state.
  const xrCard = page.locator('.adapter-card', { hasText: 'One Step at a Time' });
  await xrCard.getByRole('button', { name: 'Install' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.adapter-card .pill.installed')].some(n => n.textContent === 'installed'));
  await page.check('#adapter-installed');
  assert.equal(await page.locator('#adapter-count').innerText(), '1');
  await page.uncheck('#adapter-installed');
  await xrCard.getByRole('button', { name: 'Uninstall' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.adapter-card .pill.installed')].length);

  // A listing this uid submitted (as the skill's list-app does): delete is offered and works.
  await fetch(base + '/v1/adapters/sync', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'demo-app', appName: 'Demo App', adapters: [{ id: 'focus-highlight', name: 'Focus Highlight', description: 'Outlines the focused element.', supportAreas: ['motor'], code: 'document.addEventListener("focusin", e => { e.target.style.outline = "3px solid #235f4f"; });' }] }) });
  await page.click('#adapter-refresh');
  await page.waitForFunction(() => document.querySelectorAll('#adapter-groups .adapter-group').length === 4);
  await page.locator('.listing-group > summary', { hasText: 'Demo App' }).click();
  const demoCard = page.locator('.adapter-card', { hasText: 'Focus Highlight' });
  assert.match(await demoCard.innerText(), /Data \+ code/);
  assert.match(await demoCard.innerText(), /mine/);

  await demoCard.getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Focus Highlight'));
  assert.equal(await page.locator('#adapter-count').innerText(), '4');

  // The Profiles page still works after the shell restructure.
  await page.click('.nav-link[data-page="profiles"]');
  assert.equal(await page.locator('.profile-card').count(), 9);

  // Mobile layout must not overflow with the sidebar stacked above.
  await page.click('.nav-link[data-page="listings"]');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'listings page fits the mobile viewport');

  assert.deepEqual(errors, [], 'browser must not raise JS errors');
  console.log('Listings browser workflow passed: sidebar navigation, listings and shared adapters grouped by app and folded, filters, code viewing, install state, running a shared adapter, deletion, and mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
