// Real browser + real toolkit service: the admin console makes accounts, a
// developer signs in, an Adapter MCP app connects with the default token and
// appears under Apps, and the developer tries, undoes and hides it.
//
//   npm run test:console:e2e

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createAdapterProvider, connectToToolkit, fromToggleAdapter, defineDescriptor, createRegistryClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin-password';
const dir = await mkdtemp(path.join(tmpdir(), 'console-e2e-'));
const store = fileStore(dir);
// The stub LLM learning answers with: one memory and one suggested profile change.
const LLM_ANSWER = JSON.stringify({
  operations: [{ op: 'ADD', record: { text: 'Prefers bigger buttons when shopping.', scope: 'general', tier: 'preference' } }],
  proposals: [{ aspect: 'profile.largeTargets', aspectLabel: 'Bigger buttons and links', change: { op: 'profile-set', path: 'fields.largeTargets', value: true }, rationale: 'You keep choosing bigger buttons.' }],
});
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: createToolkitHost({ store, geminiCaller: async () => LLM_ANSWER }) });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let browser, link;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const errors = [];

  // ── admin console ──────────────────────────────────────────────────────
  const adminContext = await browser.newContext({ acceptDownloads: true, httpCredentials: { username: 'admin', password: ADMIN }, viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(10000);
  admin.on('pageerror', e => errors.push(`admin: ${e.message}`));
  await admin.goto(`${base}/admin`);
  await admin.getByRole('heading', { name: 'Accounts and access' }).waitFor();
  assert.equal(await admin.getByRole('tab', { name: 'Accounts' }).getAttribute('aria-selected'), 'true');

  await admin.fill('#new-uid', 'team-1');
  await admin.fill('#new-name', 'Team 1');
  await admin.getByRole('button', { name: 'Make account', exact: true }).click();
  await admin.locator('#credentials').waitFor();
  const password = (await admin.locator('#credentials-body code').first().innerText()).trim();
  assert.match(password, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/, 'a generated password is shown once');

  await admin.getByRole('button', { name: 'Fill in team-1 … team-10' }).click();
  await admin.getByRole('button', { name: 'Make accounts' }).click();
  await admin.waitForFunction(() => document.getElementById('status').textContent.includes('Made 9 accounts'));
  assert.match(await admin.locator('#status').innerText(), /Skipped 1: team-1/, 'an existing username is reported, not overwritten');
  assert.equal(await admin.locator('#accounts-table tbody tr').count(), 10);
  await admin.screenshot({ path: path.join(tmpdir(), 'toolkit-admin-accounts.png'), fullPage: true });

  // The issued passwords can be shown again, one at a time or all together.
  await admin.getByRole('button', { name: 'Show password for team-1', exact: true }).click();
  const team1Row = admin.locator('#accounts-table tbody tr').filter({ hasText: 'team-1' }).first();
  await team1Row.locator('.password-reveal code').waitFor();
  assert.equal((await team1Row.locator('.password-reveal code').innerText()).trim(), password);
  const hide = admin.getByRole('button', { name: 'Hide password for team-1', exact: true });
  assert.equal(await hide.getAttribute('aria-expanded'), 'true');
  await hide.click();
  assert.equal(await team1Row.locator('.password-reveal code').count(), 0, 'Hide password hides it');
  await admin.getByRole('button', { name: 'Show all passwords' }).click();
  await admin.waitForFunction(() => document.getElementById('credentials-heading').textContent === 'Sign-in details');
  assert.equal(await admin.locator('#credentials-body tbody tr').count(), 10);
  assert.equal((await admin.locator('#credentials-body tbody tr').filter({ hasText: 'Team 1' }).first().locator('code').innerText()).trim(), password);
  assert.match(await admin.locator('#status').innerText(), /Showing 10 passwords/);
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('link', { name: 'Download CSV' }).click()]);
  assert.match(download.suggestedFilename(), /^accounts-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  assert.equal(csv.trimEnd().split('\r\n').length, 11, 'a header and ten accounts');
  assert.ok(csv.includes(`team-1,Team 1,${password},`), 'the download carries the passwords (with the browser\'s admin sign-in)');

  await admin.getByRole('tab', { name: 'Tokens' }).click();
  await admin.locator('#tokensTable').waitFor();
  await admin.keyboard.press('ArrowRight');
  assert.equal(await admin.getByRole('tab', { name: 'Stored data' }).getAttribute('aria-selected'), 'true', 'arrow keys move between tabs');

  // ── developer signs in ────────────────────────────────────────────────
  const dev = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  dev.setDefaultTimeout(10000);
  dev.on('pageerror', e => errors.push(`developer: ${e.message}`));
  await dev.goto(`${base}/developer`);
  await dev.fill('#signin-username', 'team-1');
  await dev.fill('#signin-password', 'wrong-password');
  await dev.click('#signin');
  await dev.waitForFunction(() => document.getElementById('status').textContent.includes('do not match'));
  await dev.fill('#signin-password', password);
  await dev.click('#signin');
  await dev.waitForFunction(() => document.getElementById('connection-state').textContent === 'Signed in');
  assert.equal(await dev.locator('#account-name').innerText(), 'Team 1');
  const defaultToken = (await dev.locator('#sidebar-token-value').innerText()).trim();
  assert.match(defaultToken, /^aat_/);
  assert.equal(await dev.locator('#signin-form').isHidden(), true);

  await dev.reload();
  await dev.waitForFunction(() => document.getElementById('connection-state').textContent === 'Signed in');
  assert.equal((await dev.locator('#sidebar-token-value').innerText()).trim(), defaultToken, 'the sign-in survives a reload with the same default token');

  // Account page: the default token, and an app token shown once.
  await dev.click('.nav-link[data-page="account"]');
  await dev.locator('#account-body .token-value').first().waitFor();
  assert.equal((await dev.locator('#account-body .token-value').first().innerText()).trim(), defaultToken);
  await dev.fill('#new-token-label', 'My XR prototype');
  await dev.getByRole('button', { name: 'Make app token' }).click();
  await dev.locator('.new-secret').waitFor();
  assert.match(await dev.locator('.new-secret').innerText(), /My XR prototype/);

  // The team renames itself; the sidebar and the admin list follow, the username does not.
  await dev.fill('#account-display-name', 'Team Kestrel');
  await dev.getByRole('button', { name: 'Save name' }).click();
  await dev.waitForFunction(() => document.getElementById('account-name').textContent === 'Team Kestrel');
  assert.equal(await dev.locator('#account-uid').innerText(), '(team-1)');
  assert.equal(await dev.getByRole('heading', { name: 'Team Kestrel' }).count(), 1);
  assert.equal(await dev.locator('#account-display-name').inputValue(), 'Team Kestrel');

  // ── an app connects with the default token ─────────────────────────────
  await dev.click('.nav-link[data-page="apps"]');
  await dev.locator('#page-apps').waitFor();
  await dev.waitForFunction(() => document.getElementById('app-groups').textContent.includes('No apps have connected'));
  assert.equal(await dev.locator('#connect-app').isVisible(), true, 'the connect setup opens when there are no apps');
  assert.equal(await dev.locator('#connect-app-toggle').getAttribute('aria-expanded'), 'true');
  assert.match(await dev.locator('#snippet-web').innerText(), new RegExp(defaultToken));

  const big = { enabled: false, options: null, enable(o) { this.enabled = true; this.options = o; }, disable() { this.enabled = false; } };
  const provider = createAdapterProvider({
    application: { appId: 'demo', name: 'Demo store', version: '1.0.0', supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node', os: 'linux' }, surfaces: ['web'] },
    adapters: [fromToggleAdapter({
      adapter: big,
      descriptor: defineDescriptor({
        appId: 'demo', id: 'big-text', name: 'Big text', description: 'Makes the text bigger.', version: '1.0.0',
        supportAreas: ['vision'], targets: [{ platforms: ['*'], urls: ['https://shop.test/*'] }],
        inputSchema: { type: 'object', properties: { scale: { type: 'number', minimum: 1, maximum: 2, default: 1.25, description: 'Text size multiplier' }, bold: { type: 'boolean', description: 'Bold text' } }, required: ['scale'], additionalProperties: false },
        operations: ['query', 'check', 'apply', 'revert', 'targets'],
      }),
      targets: () => ({ candidates: [{ target: { url: 'https://shop.test/product' } }], coverage: 'complete' }),
    })],
  });
  link = connectToToolkit({ url: base, token: defaultToken, provider, providerId: 'node-1', label: 'Test provider' });
  await link.ready;

  await dev.waitForFunction(() => document.querySelector('#app-groups .app-group h3')?.textContent.includes('Demo store'), null, { timeout: 15000 });
  assert.match(await dev.locator('.app-group').first().innerText(), /Live/);
  assert.equal(await dev.locator('#nav-live').innerText(), '1');

  // Try it: the target comes from adapter_targets, the form from the inputSchema.
  await dev.getByRole('button', { name: 'Try Big text' }).click();
  const panel = dev.getByRole('group', { name: 'Try Big text' });
  await dev.waitForFunction(() => document.querySelector('.try-panel input[id^="target-"]')?.value === 'https://shop.test/product');
  await panel.getByLabel(/^scale/).fill('1.5');
  await panel.getByLabel(/^bold/).check();
  await panel.getByRole('button', { name: 'Turn on / update' }).click();
  await dev.waitForFunction(() => document.querySelector('.try-result')?.textContent.includes('Big text: done'));
  assert.deepEqual(big.options, { scale: 1.5, bold: true });
  await panel.getByRole('button', { name: 'Read state' }).click();
  await dev.waitForFunction(() => document.querySelector('.try-result')?.textContent.includes('Big text is on'));
  await panel.getByRole('button', { name: 'Undo last change' }).click();
  await dev.waitForFunction(() => document.querySelector('.try-result')?.textContent.includes('Undid the last change'));
  assert.equal(big.enabled, false);
  await panel.getByLabel(/^scale/).fill('5');
  await panel.getByRole('button', { name: 'Check' }).click();
  await dev.waitForFunction(() => document.querySelector('.try-result')?.textContent.includes('cannot run'));
  assert.equal(big.enabled, false, 'check never applies');
  await dev.screenshot({ path: path.join(tmpdir(), 'toolkit-developer-apps.png'), fullPage: true });

  // Hide and show.
  await dev.getByRole('button', { name: 'Hide Demo store' }).click();
  await dev.waitForFunction(() => document.getElementById('app-groups').textContent.includes('hidden'));
  assert.equal(await dev.locator('.app-group').count(), 0);
  await dev.check('#apps-show-hidden');
  assert.match(await dev.locator('.app-group').first().innerText(), /Hidden/);
  await dev.getByRole('button', { name: 'Show Demo store' }).click();
  await dev.waitForFunction(() => document.querySelectorAll('.app-group.is-hidden').length === 0);

  // Presets go to the account.
  await dev.click('.nav-link[data-page="profiles"]');
  await dev.fill('#profile-name', 'Account preset');
  await dev.click('#save');
  await dev.waitForFunction(() => document.getElementById('status').textContent.includes('in your account'));

  // The top bar's text size control scales the console, and this browser remembers it.
  const rootSize = () => dev.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const defaultSize = await rootSize();
  assert.ok(Math.abs(defaultSize - (16 + 8 / 3)) < 0.1, `the default text is 2pt above 16px, got ${defaultSize}`);
  await dev.getByRole('button', { name: 'Larger text' }).click();
  await dev.getByRole('button', { name: 'Larger text' }).click();
  assert.match(await dev.locator('#text-reset').innerText(), /125%/);
  assert.ok(Math.abs(await rootSize() - defaultSize * 1.25) < 0.1);
  await dev.reload();
  await dev.waitForFunction(() => document.getElementById('connection-state').textContent === 'Signed in');
  await dev.locator('#text-reset', { hasText: '125%' }).waitFor();
  await dev.getByRole('button', { name: /back to the default text size/ }).click();
  assert.ok(Math.abs(await rootSize() - defaultSize) < 0.1);

  // What the toolkit learned, on the Memory page: an observation, Learn now, a suggestion to accept, pause, reset.
  await dev.click('.nav-link[data-page="memory"]');
  assert.match(await dev.locator('#memory-profile').innerText(), /^Current profile: \S/);
  const statusIs = (text) => dev.waitForFunction(t => document.getElementById('status').textContent.startsWith(t), text);
  await dev.locator('#learned-summary', { hasText: 'Learning is on.' }).waitFor();
  assert.match(await dev.locator('#learned-proposals').innerText(), /No suggestions waiting/);
  await createRegistryClient({ url: base, token: defaultToken }).profile.observe({ text: 'Turned on Big buttons on https://example.com.', origin: 'https://example.com', type: 'setting-change' });
  await dev.click('#learned-refresh');
  await dev.locator('#learned-summary', { hasText: '1 observation to learn from.' }).waitFor();
  await dev.click('#learned-now');
  await statusIs('Learned from 1 observation.');
  assert.match(await dev.locator('#learned-memories').innerText(), /Prefers bigger buttons when shopping\.\s*everywhere/);
  assert.match(await dev.locator('#learned-proposals').innerText(), /Bigger buttons and links\s*Set largeTargets to true\.\s*You keep choosing bigger buttons\./);
  await dev.getByRole('button', { name: 'Accept: Bigger buttons and links' }).click();
  await statusIs('Accepted: Bigger buttons and links.');
  await dev.waitForFunction(() => /"largeTargets": true/.test(document.getElementById('profile-json').value));
  await dev.check('#learned-paused');
  await statusIs('Learning is paused.');
  await dev.uncheck('#learned-paused');
  await statusIs('Learning is on again.');
  await dev.click('#learned-reset');
  await statusIs('Reset the suggestions: cleared 1');
  await dev.locator('#learned-summary', { hasText: '0 of' }).waitFor();
  dev.once('dialog', d => d.accept());
  await dev.click('#learned-reset-all');
  await statusIs('Reset everything learned: 1 memories');
  assert.match(await dev.locator('#learned-memories').innerText(), /Nothing learned yet/);
  await dev.setViewportSize({ width: 390, height: 844 });
  assert.ok(await dev.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the Memory page fits a phone');
  await dev.click('.nav-link[data-page="profiles"]');
  assert.ok(await dev.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the Profiles page fits a phone');
  await dev.setViewportSize({ width: 1440, height: 1000 });

  // Mobile: nothing overflows the Apps page.
  await dev.setViewportSize({ width: 390, height: 844 });
  await dev.click('.nav-link[data-page="apps"]');
  await dev.locator('.app-group').first().waitFor();
  assert.ok(await dev.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the Apps page fits a phone');
  await dev.screenshot({ path: path.join(tmpdir(), 'toolkit-developer-apps-mobile.png'), fullPage: true });

  // Closing the app leaves it offline, not gone.
  await link.close();
  await dev.waitForFunction(() => document.querySelector('.app-group')?.textContent.includes('Offline'), null, { timeout: 15000 });

  // Sign out.
  await dev.setViewportSize({ width: 1440, height: 1000 });
  await dev.click('#disconnect');
  await dev.waitForFunction(() => document.getElementById('connection-state').textContent === 'Signed out');
  assert.equal(await dev.locator('#signin-form').isVisible(), true);

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Console browser workflow passed: admin accounts (single + bulk), sign-in, session reload, default and app tokens, an Adapter MCP app connecting, Try it (apply, read, undo, check), hide/show, account presets, what the toolkit learned on the Memory page (learn now, accept, pause, reset), mobile layout, sign-out.');
} finally {
  await link?.close().catch(() => {});
  await browser?.close();
  app.relay.closeAll();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
