// The assistant sidebar end to end: real Chromium with the real extension, a
// real toolkit service forwarding /v1/agent to a real agent host, and a test
// shop. The person asks, shares the page, previews the adapter on it, keeps
// their chat, adds the adapter to their account (it then runs in this browser)
// and exports it. The sidebar never shows code.
//
//   npm run test:assistant:e2e              # a stand-in agent (no LLM)
//   AGENT_E2E_REAL=1 npm run test:assistant:e2e
//                                           # real opencode + Gemini 3.8 Flash
//                                           # (GEMINI_API_KEY from .env)

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../../server/src/app.js';
import { fileStore } from '../../server/src/store.js';
import { createToolkitHost } from '../../server/src/toolkit-host.js';
import { createRegistryClient } from '../../toolkit/adapter-mcp/index.js';
import { createHost, listen } from '../../agent-host/src/host.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const EXT_DIR = path.resolve(HERE, '..');
const ADMIN = 'test-admin';
const SECRET = 'assistant-e2e-secret-0123456789abcdef';
const REAL = process.env.AGENT_E2E_REAL === '1';
// SHOTS=<folder> saves screenshots of the sidebar along the way.
const shot = (page, name) => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }) : null;
const quiet = { info() {}, warn() {}, error: (e, f) => console.log('host error', e, f) };

// The agent host, with the stand-in agent or real opencode.
const agentData = await mkdtemp(path.join(tmpdir(), 'assistant-e2e-agent-'));
const sandboxListen = await freePort(), apiListen = await freePort();
const agent = createHost({
  dataDir: agentData, secret: SECRET, sandboxUrl: `http://127.0.0.1:${sandboxListen}`, runnerKind: 'local', repoDir: ROOT,
  opencodeBin: REAL ? 'opencode' : path.join(ROOT, 'agent-host/test/fake-opencode.mjs'),
  apiKey: REAL ? (process.env.GEMINI_API_KEY || readEnv('GEMINI_API_KEY')) : 'unused', log: REAL ? undefined : quiet,
  modelsJson: path.join(process.env.HOME, '.cache/opencode/models.json'),
});
const agentServers = [await listen(agent.sandboxHandler, `127.0.0.1:${sandboxListen}`), await listen(agent.apiHandler, `127.0.0.1:${apiListen}`)];

// The toolkit service, forwarding /v1/agent to it.
const store = fileStore(await mkdtemp(path.join(tmpdir(), 'assistant-e2e-')));
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost, agentHost: { url: `http://127.0.0.1:${apiListen}`, secret: SECRET } });
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// A shop with small buttons.
const site = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><title>Shop</title><style>button{height:20px;font-size:11px}</style></head><body><main><h1>Shop</h1><p>Tea, 4 dollars.</p><button id="buy">Buy</button> <button id="later">Save for later</button></main></body></html>`);
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const shop = `http://localhost:${site.address().port}/`;

const until = async (check, what, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 150));
  }
};

let context, failureReport = async () => {};
try {
  const made = await (await fetch(`${base}/admin/accounts`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid: 'ada' }) })).json();
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ada', password: made.password }) })).json();
  const token = login.defaultToken;

  context = await chromium.launchPersistentContext(await mkdtemp(path.join(tmpdir(), 'assistant-e2e-profile-')), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--no-first-run'],
  });
  const firstWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 60000 });
  const extId = new URL(firstWorker.url()).host;
  const worker = () => context.serviceWorkers().find(w => w.url().includes(extId));
  const runtime = async (fn, arg) => worker().evaluate(fn, arg);
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${extId}`);
  await settings.getByRole('button', { name: /user scripts/i }).click();
  await until(async () => worker() && runtime(() => typeof chrome.userScripts === 'object' && !!globalThis.ai4a11yRuntime), 'user scripts');
  await settings.close();
  await runtime(([url, token]) => globalThis.ai4a11yRuntime.handlers.connect({ url, token }), [base, token]);

  // The shop in one window, the sidebar beside it in another (as a page, named ?tab=).
  const page = await context.newPage();
  await page.goto(shop);
  const tabId = await runtime(async (url) => (await chrome.tabs.query({ url: url + '*' }))[0].id, shop);
  const opened = context.waitForEvent('page');
  await runtime(([id, tab]) => chrome.windows.create({ url: `chrome-extension://${id}/sidepanel/sidepanel.html?tab=${tab}`, type: 'popup', width: 420, height: 900 }), [extId, tabId]);
  const panel = await opened;
  panel.on('console', (m) => { if (m.type() === 'error' || process.env.DEBUG) console.log('sidebar console:', m.text()); });
  panel.on('pageerror', (e) => console.log('sidebar error:', e.message));
  failureReport = async () => console.log('--- sidebar ---\n' + await panel.locator('body').innerText());
  await panel.waitForLoadState();
  await panel.locator('#state', { hasText: 'Ready' }).waitFor({ timeout: 30000 });
  assert.match(await panel.locator('#transcript').innerText(), /Say what gets in your way/);

  const ask = async (text) => { await panel.fill('#message', text); await panel.press('#message', 'Enter'); };
  const heightOfBuy = () => page.evaluate(() => document.getElementById('buy').getBoundingClientRect().height);
  const before = await heightOfBuy();

  if (!REAL) {
    // ── the stand-in agent: deterministic steps ───────────────────────────────
    await ask('build bigger buttons');
    await panel.getByRole('heading', { name: 'May the assistant see this page?' }).waitFor();
    assert.match(await panel.locator('.card').innerText(), /not used to identify you/);
    await shot(panel, '1-share-page');
    await panel.getByRole('button', { name: 'The address, the source and a screenshot' }).click();
    await panel.getByRole('heading', { name: 'Preview “Bigger buttons” on this page?' }).waitFor();
    await shot(panel, '2-preview');
    await panel.getByRole('button', { name: 'Preview', exact: true }).click();
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the preview on the page');
    await panel.locator('#preview-label', { hasText: 'Previewing “Bigger buttons”' }).waitFor();
    await panel.locator('#ready-list', { hasText: 'Bigger buttons' }).waitFor();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    const shown = await panel.locator('#transcript').innerText();
    assert.match(shown, /Looking at the page/);
    assert.match(shown, /“Bigger buttons” is previewing on your page/);
    assert.ok(!/export const|```/.test(shown), 'no code in the sidebar');
    await shot(panel, '3-ready');

    // The page data stays on the agent host's disk, screenshot included.
    const chatDir = path.join(agentData, 'accounts/ada/page-data');
    const [chatId] = await readdir(chatDir);
    const files = await readdir(path.join(chatDir, chatId));
    assert.ok(files.some(f => f.endsWith('-page.jpg')), 'the screenshot was kept');
    assert.match(readFileSync(path.join(chatDir, chatId, files.find(f => f.endsWith('-page.json'))), 'utf8'), /Save for later/);

    // Removing the preview puts the page back.
    await panel.getByRole('button', { name: 'Remove preview' }).click();
    await until(() => page.evaluate(() => !document.body.dataset.big), 'the preview removed');

    // Automatic previews, and the site's answer remembered in this chat: no cards this time.
    await panel.check('#auto-preview');
    await ask('build them again');
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the automatic preview');
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    assert.equal(await panel.locator('.card').count(), 0);

    // Export, then add to the account: it then runs here from the account.
    const download = panel.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    assert.equal(file.suggestedFilename(), 'bigger-buttons.js');
    assert.match(readFileSync(await file.path(), 'utf8'), /^\/\/ Bigger buttons: Makes buttons bigger\.[\s\S]*export const BiggerButtons/);
    await panel.getByRole('button', { name: 'Add to my account' }).click();
    await panel.locator('#status', { hasText: 'is in your account' }).waitFor();
    const installed = await createRegistryClient({ url: base, token }).installed('browser-runtime');
    assert.ok(installed.adapters.some(a => a.adapter.appId === 'assistant' && a.adapter.id === 'bigger-buttons'));
    assert.equal(await panel.locator('#preview-bar').isHidden(), true, 'the preview gives way to the installed adapter');
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the installed adapter on the page');

    // Chats keep their history: a new one starts empty, the old one comes back.
    const firstChat = await panel.locator('#chat-select').inputValue();
    await panel.getByRole('button', { name: 'New chat' }).click();
    await panel.locator('#transcript', { hasText: 'Say what gets in your way' }).waitFor();
    await panel.selectOption('#chat-select', firstChat);
    await panel.locator('#transcript', { hasText: 'build them again' }).waitFor();
    await panel.reload();
    await panel.locator('#transcript', { hasText: 'build them again' }).waitFor();
    console.log('Assistant browser workflow passed (stand-in agent): page sharing with consent, preview and removal, automatic preview, no code shown, page data on the host, export, add to account (runs from the account), chat history.');
  } else {
    // ── real opencode and Gemini 3.8 Flash ────────────────────────────────────
    await panel.check('#auto-preview');
    await ask('The Buy and Save for later buttons on this shop are too small for me to tap. Please make an adapter that makes them at least 44 pixels tall. It helps motor. Go ahead with defaults, no questions.');
    const asked = await until(async () => (await panel.locator('.card').count()) || (await panel.locator('#state').innerText()) === 'Ready', 'the agent to ask for the page or finish', 240000);
    if ((await panel.locator('.card').count())) await panel.getByRole('button', { name: 'The address, the source and a screenshot' }).click();
    await until(async () => (await panel.locator('#state').innerText()) === 'Ready' && (await panel.locator('.card').count()) === 0, 'the agent to finish', 600000)
      .catch(async (e) => { console.log(await panel.locator('#transcript').innerText()); throw e; });
    // Let a follow-up run if the agent stopped to ask.
    let shown = await panel.locator('#transcript').innerText();
    if (!(await panel.locator('#ready-list li').count())) {
      await ask('Yes, that is right. Build it, preview it here, review it, and offer it to me when it works.');
      await until(async () => { if (await panel.locator('.card').count()) await panel.locator('.card button.primary').first().click(); return (await panel.locator('#state').innerText()) === 'Ready' && (await panel.locator('#ready-list li').count()); }, 'the adapter ready', 600000)
        .catch(async (e) => { console.log(await panel.locator('#transcript').innerText()); throw e; });
      shown = await panel.locator('#transcript').innerText();
    }
    console.log('--- what the sidebar showed ---\n' + shown + '\n---');
    const after = await heightOfBuy();
    console.log(`Buy button height: ${before}px before, ${after}px with the preview.`);
    assert.ok(after >= 44, 'the previewed adapter made the button at least 44px tall');
    assert.ok(!/```/.test(shown), 'no code blocks in the sidebar');
    console.log('Assistant browser workflow passed with real opencode and Gemini 3.8 Flash.');
  }
} catch (e) {
  await failureReport().catch(() => {});
  throw e;
} finally {
  await context?.close();
  server.closeAllConnections?.(); server.close(); site.close();
  for (const s of agentServers) { s.closeAllConnections?.(); s.close(); }
}
process.exit(0);

async function freePort() {
  const s = http.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise(r => s.close(r));
  return port;
}
function readEnv(name) {
  try { return (readFileSync(path.join(ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1]?.trim(); } catch { return undefined; }
}
