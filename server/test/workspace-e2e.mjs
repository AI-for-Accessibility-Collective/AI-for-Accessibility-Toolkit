// Real browser + real toolkit service, the Adapters page: New adapter's
// coding-agent guide, a coding agent publishing an adapter with the skill's
// helper (revision 1, running in the browser runtime, private), editing it
// here with live lint, sharing it, have a second developer install it at a pinned
// revision, edit it, and update the second developer to the new revision;
// runtime reports and the runtime badge show up, and the Apps page counts
// what each app shares and installs. No extension: the runtime's reports and
// its bridge message are sent the way the extension sends them.
//
//   npm run test:workspace:e2e

import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/index.js';

const ADMIN = 'test-admin';
const HELPER = fileURLToPath(new URL('../../.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs', import.meta.url));
const ADAPTER_CODE = `// Bigger buttons: makes small buttons at least 44 pixels tall.
export const MyAdapter = {
  enabled: false,
  changed: [],
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      this.changed.push({ el, before: el.style.minHeight });
      el.style.minHeight = '44px';
    }
  },
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    for (const { el, before } of this.changed) el.style.minHeight = before;
    this.changed = [];
  },
};
`;
const dir = await mkdtemp(path.join(tmpdir(), 'workspace-e2e-'));
const store = fileStore(dir);
const host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost: host });
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function account(uid) {
  const made = await (await fetch(`${base}/admin/accounts`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid }) })).json();
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: uid, password: made.password }) })).json();
  return { uid, password: made.password, token: login.defaultToken };
}
async function signIn(page, who) {
  await page.goto(`${base}/developer#/adapters`);
  await page.fill('#signin-username', who.uid);
  await page.fill('#signin-password', who.password);
  await page.click('#signin');
  await page.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Signed in'));
}
const statusStartsWith = (page, text) => page.waitForFunction(t => document.getElementById('status').textContent.startsWith(t), text);

let browser;
try {
  const ada = await account('ada');
  const bo = await account('bo');
  browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(`${base}/developer#/adapters`);
  assert.match(await page.locator('#environment').innerText(), /ADAPTERS/);
  assert.match(await page.locator('#ws-groups').innerText(), /Sign in in the sidebar/);
  assert.equal(await page.locator('#ws-new').isDisabled(), true);
  await signIn(page, ada);
  await page.waitForFunction(() => /You have no adapters yet/.test(document.getElementById('ws-groups').textContent));
  assert.equal(await page.locator('#ws-runtime-state').innerText(), 'Not found in this browser');
  assert.equal(await page.locator('#ws-runtime-setup').getAttribute('open'), '', 'setup steps are open while no runtime is found');

  // ── New adapter opens the coding-agent guide, with the two .env lines ──
  await page.click('#ws-new');
  await page.locator('#ws-guide[open]').waitFor();
  const envLines = await page.locator('#ws-guide-env').innerText();
  assert.equal(envLines, `TOOLKIT_URL=${base}\nTOOLKIT_TOKEN=${ada.token}`);
  await page.keyboard.press('Escape');
  await page.locator('#ws-guide:not([open])').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#ws-new').evaluate(el => el === document.activeElement), true, 'closing the guide returns focus to New adapter');

  // ── a coding agent publishes one with the skill's helper, which reads .env from a folder above ──
  const project = await mkdtemp(path.join(tmpdir(), 'agent-project-'));
  await writeFile(path.join(project, '.env'), `# toolkit\n${envLines}\n`);
  await mkdir(path.join(project, 'fixes'));
  await writeFile(path.join(project, 'fixes', 'bigger-buttons.js'), ADAPTER_CODE);
  const { TOOLKIT_URL: _u, TOOLKIT_TOKEN: _t, ...cleanEnv } = process.env;
  const { stdout } = await promisify(execFile)(process.execPath, [HELPER, 'publish', 'bigger-buttons.js',
    '--name', 'Bigger Buttons!', '--runs-on', 'https://example.com/shop/*', '--runs-on', 'http://localhost/*',
    '--for', 'motor', '--about', 'Makes buttons at least 44px tall.'], { cwd: path.join(project, 'fixes'), env: cleanEnv });
  assert.match(stdout, /Published Bigger Buttons! \(agent\/bigger-buttons\), revision 1\./);
  await rm(project, { recursive: true, force: true });

  const card = page.locator('.adapter-card[data-adapter="ada/agent/bigger-buttons"]');
  await card.waitFor();
  assert.equal(await card.getByRole('heading', { name: 'Bigger Buttons!', exact: true }).count(), 1);
  assert.deepEqual(await card.locator('.adapter-title .badge').allInnerTexts(), ['Private', 'In your browser']);
  assert.match(await card.innerText(), /agent\/bigger-buttons · revision 1/);
  assert.deepEqual(await card.locator('.pill.url').allInnerTexts(), ['https://example.com/shop/*', 'http://localhost/*']);
  const adaRegistry = createRegistryClient({ url: base, token: ada.token });
  const runtimeView = await adaRegistry.installed('browser-runtime');
  assert.deepEqual(runtimeView.adapters.map(a => [a.adapter.id, a.follows]), [['bigger-buttons', true]], 'publishing installs it into the browser runtime, following edits');

  // ── edit it here: lint speaks up, problems block saving, Cancel keeps revision 1 ──
  await card.getByRole('button', { name: 'Edit Bigger Buttons!' }).click();
  await page.locator('#ws-editor').waitFor();
  assert.equal(await page.locator('#ws-name').evaluate(el => el === document.activeElement), true, 'the editor opens with focus on the name');
  assert.equal(await page.locator('#ws-id').evaluate(el => el.readOnly), true, 'the id cannot change');
  assert.equal(await page.inputValue('#ws-code'), ADAPTER_CODE);
  await page.fill('#ws-code', ADAPTER_CODE.replace("el.style.minHeight = '44px';", "el.style.minHeight = '44px'; fetch('/track');"));
  await page.locator('#ws-lint li.error').first().waitFor();
  assert.match(await page.locator('#ws-lint').innerText(), /Error, line \d+: sends or fetches data over the network/);
  await page.click('#ws-save');
  await statusStartsWith(page, 'Fix this before saving — Line');
  await page.fill('#ws-code', ADAPTER_CODE);
  await page.waitForFunction(() => !document.querySelector('#ws-lint li'));
  await page.fill('#ws-urls', '');
  await page.click('#ws-save');
  await statusStartsWith(page, 'Fix this before saving — Runs on: add at least one address pattern');
  assert.equal(await page.locator('#ws-urls').evaluate(el => el === document.activeElement), true, 'focus goes to the field to fix');
  await page.screenshot({ path: path.join(tmpdir(), 'toolkit-adapters-editor.png'), fullPage: true });
  await page.click('#ws-cancel');
  assert.equal(await page.locator('#ws-editor').isHidden(), true);

  // ── the runtime's reports and its bridge message show up ──
  await adaRegistry.report('browser-runtime', 'chrome-test', [
    { adapter: { appId: 'agent', id: 'bigger-buttons' }, revision: 1, origin: 'http://localhost:8000', status: 'applied' },
    { adapter: { appId: 'agent', id: 'bigger-buttons' }, revision: 1, origin: 'https://example.com', status: 'failed', message: 'TypeError: el is null' },
  ], 'Chrome 147 on macOS');
  await card.locator('.runtime-results li').nth(1).waitFor();
  const lines = await card.locator('.runtime-results li').allInnerTexts();
  assert.ok(lines.some(l => /Running on http:\/\/localhost:8000 · revision 1 · Chrome 147 on macOS · just now/.test(l)), lines.join('\n'));
  assert.ok(lines.some(l => /Failed on https:\/\/example\.com .*TypeError: el is null/.test(l)), lines.join('\n'));
  assert.match(await page.locator('#ws-runtime-instances').innerText(), /Chrome 147 on macOS · last report just now/);
  await page.evaluate(() => window.postMessage({ source: 'ai4a11y-runtime', type: 'present', connected: true, uid: 'ada', userScripts: false }, location.origin));
  await page.waitForFunction(() => document.getElementById('ws-runtime-state').textContent === 'Allow User Scripts is off');
  await page.evaluate(() => window.postMessage({ source: 'ai4a11y-runtime', type: 'present', connected: true, uid: 'ada', userScripts: true }, location.origin));
  await page.waitForFunction(() => document.getElementById('ws-runtime-state').textContent === 'Connected in this browser');
  assert.equal(await page.locator('#ws-runtime-setup').getAttribute('open'), null);

  // ── share it; the second developer finds it and runs it, pinned ──
  await card.getByRole('button', { name: 'Share Bigger Buttons!' }).click();
  await statusStartsWith(page, 'Bigger Buttons! is shared');
  assert.deepEqual(await card.locator('.adapter-title .badge').allInnerTexts(), ['Shared', 'In your browser']);

  const boPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  boPage.on('pageerror', e => errors.push(e.message));
  await signIn(boPage, bo);
  await boPage.click('[data-ws-tab="shared"]');
  const boCard = boPage.locator('.adapter-card[data-adapter="ada/agent/bigger-buttons"]');
  await boCard.waitFor();
  assert.match(await boCard.innerText(), /Coding agent · by ada · revision 1/);
  await boCard.getByRole('button', { name: 'Run Bigger Buttons! in my browser' }).click();
  await statusStartsWith(boPage, 'Bigger Buttons! runs in your browser runtime');
  assert.deepEqual(await boCard.locator('.adapter-title .badge').allInnerTexts(), ['In your browser · revision 1']);
  assert.equal(await boCard.getByRole('button', { name: /^View code of/ }).count(), 1);
  await boCard.getByRole('button', { name: 'View code of Bigger Buttons!' }).click();
  assert.match(await boCard.locator('.adapter-code pre').innerText(), /export const MyAdapter/);

  // ── the owner edits it: revision 2; the second developer is offered the update ──
  await card.getByRole('button', { name: 'Edit Bigger Buttons!' }).click();
  await page.locator('#ws-editor').waitFor();
  assert.equal(await page.locator('#ws-editor-heading').innerText(), 'Edit Bigger Buttons!');
  assert.equal(await page.locator('#ws-id').evaluate(el => el.readOnly), true, 'the id cannot change');
  assert.equal(await page.locator('#ws-share').isChecked(), true);
  await page.fill('#ws-code', (await page.inputValue('#ws-code')).replaceAll('44px', '48px'));
  await page.click('#ws-save');
  await statusStartsWith(page, 'Saved Bigger Buttons!, revision 2.');
  await card.getByRole('button', { name: 'Edit Bigger Buttons!' }).click();
  await page.click('#ws-save');
  await statusStartsWith(page, 'Nothing changed in Bigger Buttons! since revision 2.');

  await boPage.click('[data-ws-tab="mine"]');
  await boPage.click('[data-ws-tab="shared"]');
  const update = boCard.getByRole('button', { name: 'Update Bigger Buttons! to revision 2' });
  await update.waitFor();
  await update.click();
  await statusStartsWith(boPage, 'Bigger Buttons! updated to revision 2');
  assert.deepEqual(await boCard.locator('.adapter-title .badge').allInnerTexts(), ['In your browser · revision 2']);
  const boView = await createRegistryClient({ url: base, token: bo.token }).installed('browser-runtime');
  assert.deepEqual(boView.adapters.map(a => [a.revision, a.follows]), [[2, false]], 'still pinned, now to revision 2');

  // ── the Apps page counts what each app shares and installs ──
  await adaRegistry.publish({
    appName: 'Redbird demo',
    descriptor: { ...(await adaRegistry.get({ appId: 'agent', id: 'bigger-buttons' })).descriptor, appId: 'redbird', id: 'swatches', name: 'Swatch names', descriptorDigest: undefined, executionArtifactDigest: undefined },
    code: 'export default { enable() {}, disable() {} };',
  });
  const { createAdapterProvider, connectToToolkit, fromToggleAdapter, defineDescriptor } = await import('../../toolkit/adapter-mcp/index.js');
  const toggle = { enabled: false, enable() { this.enabled = true; }, disable() { this.enabled = false; } };
  const link = connectToToolkit({
    url: base, token: ada.token, providerId: 'tab-1', label: 'Store tab',
    provider: createAdapterProvider({
      application: { appId: 'redbird', name: 'Redbird demo', version: '1.0.0', supportedPlatforms: [{ environment: 'node' }], platform: { environment: 'node' }, surfaces: ['web'] },
      adapters: [fromToggleAdapter({ adapter: toggle, descriptor: defineDescriptor({ appId: 'redbird', id: 'swatches', name: 'Swatch names', version: '1.0.0', targets: [{ platforms: ['*'], urls: ['http://localhost/*'] }] }) })],
    }),
  });
  await link.ready;
  await page.click('.nav-link[data-page="apps"]');
  const redbird = page.locator('.app-group', { has: page.getByRole('heading', { name: 'Redbird demo', exact: true }) });
  await redbird.waitFor();
  await page.waitForFunction(() => /Registry: 1 published \(0 shared\)/.test(document.querySelector('.app-registry')?.textContent || ''));
  assert.match(await page.locator('#snippet-mcp').innerText(), /\/v1\/mcp --header/);
  assert.match(await page.locator('#snippet-web').innerText(), /registry\.publish/);
  await link.close();

  // ── delete, and the mobile layout ──
  await page.click('.nav-link[data-page="adapters"]');
  await card.getByRole('button', { name: 'Delete Bigger Buttons!' }).click();
  await statusStartsWith(page, 'Deleted Bigger Buttons! and all its revisions.');
  assert.equal(await card.count(), 0);
  await boPage.reload();
  await boPage.waitForFunction(() => document.getElementById('connection-state').textContent.includes('Signed in'));
  await boPage.click('[data-ws-tab="shared"]');
  await boPage.waitForFunction(() => /Nobody has shared|No shared adapters/.test(document.getElementById('ws-groups').textContent));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#ws-new');
  const guide = await page.locator('#ws-guide').boundingBox();
  assert.ok(guide.x >= 0 && guide.x + guide.width <= 390, 'the New adapter guide fits a phone');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the Adapters page fits a phone');
  await page.screenshot({ path: path.join(tmpdir(), 'toolkit-adapters-mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], 'browser must not raise JS errors');
  console.log('Adapters workspace browser workflow passed: the coding-agent guide, publishing with the skill helper from .env, lint and blocking errors with focus in the editor, runtime reports and badge, share, a second developer installing pinned, edit to revision 2, unchanged save, update offered and applied, Apps page registry counts, delete, phone layout.');
} finally {
  await browser?.close();
  app.registry.closeAll();
  app.relay.closeAll();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
