// Real browser + real toolkit service, Adapters page: sidebar navigation,
// marketplace grouped by app, registration (data-only and data + code),
// filters, install state, code viewing, and deletion. No LLM required.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';

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

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`${base}/developer#/adapters`);
  assert.match(await page.locator('#environment').innerText(), /ADAPTER MARKETPLACE/);
  assert.equal(await page.locator('#page-profiles').isHidden(), true, 'the hash opens the Adapters page');
  assert.match(await page.locator('#adapter-groups').innerText(), /Sign in \(or connect with a token\)/);

  // Sidebar navigation switches pages without losing the shell.
  await page.click('.nav-link[data-page="profiles"]');
  await page.waitForFunction(() => document.getElementById('environment').textContent.includes('PROFILE MANAGER'));
  assert.equal(await page.locator('#page-profiles').isHidden(), false);
  await page.click('.nav-link[data-page="adapters"]');
  await page.waitForFunction(() => document.getElementById('environment').textContent.includes('ADAPTER MARKETPLACE'));
  assert.equal(await page.locator('#page-adapters').isHidden(), false);

  // Connect; the marketplace loads.
  await page.click('#token-connect summary');
  await page.fill('#instance-token', token);
  await page.click('#connect');
  await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Connected'));
  await page.waitForFunction(() => document.querySelectorAll('#adapter-groups .adapter-group').length === 2);
  assert.equal(await page.locator('#adapter-count').innerText(), '3');
  const groupNames = await page.locator('.adapter-group > .section-heading h3').allInnerTexts();
  assert.deepEqual(groupNames, ['Browser Extension', 'XR Task Guide']);
  assert.match(await page.locator('.adapter-group').first().innerText(), /app id: browser-extension/);

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

  // Register a new adapter (data + code) through the form.
  await page.click('#new-adapter');
  await page.fill('#reg-app', 'demo-app');
  await page.fill('#reg-app-name', 'Demo App');
  await page.fill('#reg-id', 'focus-highlight');
  await page.fill('#reg-name', 'Focus Highlight');
  await page.fill('#reg-description', 'Outlines the focused element.');
  await page.fill('#reg-keys', 'focusHighlight');
  await page.check('#register-form input[name=area][value=motor]');
  await page.check('#reg-has-code');
  await page.fill('#reg-code', 'document.addEventListener("focusin", e => { e.target.style.outline = "3px solid #235f4f"; });');
  await page.click('#register-submit');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Registered demo-app/focus-highlight'));
  await page.waitForFunction(() => document.querySelectorAll('#adapter-groups .adapter-group').length === 3);
  const demoCard = page.locator('.adapter-card', { hasText: 'Focus Highlight' });
  assert.match(await demoCard.innerText(), /Data \+ code/);
  assert.match(await demoCard.innerText(), /mine/);

  // The new listing is registered by this uid: delete is offered and works.
  await demoCard.getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Focus Highlight'));
  assert.equal(await page.locator('#adapter-count').innerText(), '3');

  // The Profiles page still works after the shell restructure.
  await page.click('.nav-link[data-page="profiles"]');
  assert.equal(await page.locator('.profile-card').count(), 9);

  // Mobile layout must not overflow with the sidebar stacked above.
  await page.click('.nav-link[data-page="adapters"]');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'adapters page fits the mobile viewport');

  assert.deepEqual(errors, [], 'browser must not raise JS errors');
  console.log('Adapters browser workflow passed: sidebar navigation, grouped marketplace, filters, code viewing, install state, registration, deletion, and mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
