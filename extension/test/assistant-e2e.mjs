// The assistant sidebar end to end: real Chromium with the real extension, a
// real toolkit service forwarding /v1/agent to a real agent host, and a test
// shop. The person asks, shares the page, previews the adapter on it, keeps
// their chat, adds the adapter to their account (it then runs in this browser)
// and exports it. Each chat keeps working on its page while the person moves
// to other tabs, until they choose another. The sidebar never shows code.
//
//   npm run test:assistant:e2e              # a stand-in agent (no LLM)
//   AGENT_E2E_REAL=1 npm run test:assistant:e2e
//                                           # real opencode + Gemini 3.8 Flash
//                                           # (GEMINI_API_KEY from .env)
//   AGENT_E2E_REAL=1 AGENT_E2E_HOST_URL=http://localhost:8791 AGENT_E2E_HOST_SECRET=… \
//     npm run test:assistant:e2e            # a deployed agent host (e.g. the VM,
//                                           # through an IAP tunnel): its sandboxes

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
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
const UID = process.env.AGENT_E2E_UID || 'ada';
const REMOTE = process.env.AGENT_E2E_HOST_URL ? { url: process.env.AGENT_E2E_HOST_URL, secret: process.env.AGENT_E2E_HOST_SECRET } : null;
// SHOTS=<folder> saves screenshots of the sidebar along the way.
const shot = (page, name) => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }) : null;
const quiet = { info() {}, warn() {}, error: (e, f) => console.log('host error', e, f) };

// The agent host, with the stand-in agent or real opencode.
const agentData = await mkdtemp(path.join(tmpdir(), 'assistant-e2e-agent-'));
const sandboxListen = await freePort(), apiListen = await freePort();
const agent = REMOTE ? null : createHost({
  dataDir: agentData, secret: SECRET, sandboxUrl: `http://127.0.0.1:${sandboxListen}`, runnerKind: 'local', repoDir: ROOT,
  opencodeBin: REAL ? 'opencode' : path.join(ROOT, 'agent-host/test/fake-opencode.mjs'),
  apiKey: REAL ? (process.env.GEMINI_API_KEY || readEnv('GEMINI_API_KEY')) : 'unused', log: REAL ? undefined : quiet,
  modelsJson: path.join(process.env.HOME, '.cache/opencode/models.json'),
  // The stand-in names chats without a model, and its background checks pass at once.
  ...(REAL ? {} : {
    titler: async ({ message }) => `Stand-in title: ${message.split(' ')[0]}`,
    fetchRubrics: async () => ({ have: [], missing: [] }),
    checkRunner: {
      kind: 'local',
      async check({ dir }) {
        // An adapter for one site, with a copy of the person's page there, is checked on that copy.
        const spec = JSON.parse(readFileSync(path.join(dir, 'in', 'check.json'), 'utf8'));
        const summary = spec.copies.length ? { passed: 3, failed: 0, skipped: 0, appliedOnTestPages: 0, testPages: 0, narrow: true, ownPages: spec.copies.length, appliedOnOwnPages: spec.copies.length, ownRunsFailed: 0, ownChecks: spec.checks.length }
          : { passed: 3, failed: 0, skipped: 1, appliedOnTestPages: 1, testPages: 14 };
        writeFileSync(path.join(dir, 'out', 'report.json'), JSON.stringify({ runs: [{ name: 'buttons.html', status: 'pass', result: 'applied', problems: [] }], summary, notes: [] }));
        return { code: 0, timedOut: false, stderr: '' };
      },
      async review({ dir }) {
        writeFileSync(path.join(dir, 'review', 'review.json'), JSON.stringify({ verdict: 'ok', report: 'Nothing to fix.', rubricsRead: [] }));
        return { code: 0, timedOut: false, stderr: '' };
      },
      cleanup: async () => {},
    },
  }),
});
const agentServers = REMOTE ? [] : [await listen(agent.sandboxHandler, `127.0.0.1:${sandboxListen}`), await listen(agent.apiHandler, `127.0.0.1:${apiListen}`)];

// The toolkit service, forwarding /v1/agent to it.
const store = fileStore(await mkdtemp(path.join(tmpdir(), 'assistant-e2e-')));
const toolkitHost = createToolkitHost({ store, geminiCaller: async () => { throw new Error('LLM disabled in test'); } });
// The toolkit's model, stood in: what the Profile tab's words mean (the `profile` task).
const profileModel = Object.assign(async (prompt, { onUsage } = {}) => {
  await new Promise(r => setTimeout(r, 400)); // long enough to see it working
  onUsage?.({ model: 'stand-in', promptTokens: 100, outputTokens: 50, thoughtsTokens: 0 });
  if (/their own abilities/.test(prompt)) return JSON.stringify({ supportAreas: ['motor', 'vision'], needs: { textSize: 1.5, labelControls: true, nonsense: true }, plainLanguage: false, summary: 'Pages will use larger text and name unlabeled buttons.' });
  return 'NO_ANSWER';
}, { model: 'stand-in' });
const app = createApp({ store, adminPassword: ADMIN, toolkitHost, ai: { caller: profileModel, price: () => ({ input: 0, output: 0 }) }, agentHost: REMOTE || { url: `http://127.0.0.1:${apiListen}`, secret: SECRET } });
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// A shop with small buttons.
const site = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><title>${req.url.startsWith('/other') ? 'Other' : 'Shop'}</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tea","offers":{"@type":"Offer","price":"4"}}</script><style>button{height:20px;font-size:11px}</style></head><body><main><h1>Shop</h1><p>Tea, 4 dollars.</p><button id="buy">Buy</button> <button id="later">Save for later</button></main></body></html>`);
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
  const made = await (await fetch(`${base}/admin/accounts`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ uid: UID }) })).json();
  const login = await (await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: UID, password: made.password }) })).json();
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
  // The panel opens on Profile: the person's words, what pages will do, then the adapters.
  assert.equal(await panel.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected'), 'true');
  await panel.getByRole('textbox', { name: 'Describe your abilities' }).waitFor();
  assert.match(await panel.locator('#words-hint').innerText(), /^For example:/);
  await panel.getByRole('button', { name: 'Speak' }).waitFor();
  await shot(panel, '0a-profile');
  await panel.getByRole('textbox', { name: 'Describe your abilities' }).fill('Small text tires my eyes and my hands shake, so small buttons are hard to press.');
  await panel.getByRole('button', { name: 'Save' }).click();
  await panel.locator('#profile-working', { hasText: 'Understanding what you wrote' }).waitFor();
  await shot(panel, '0b-profile-working');
  await panel.locator('#profile-working').waitFor({ state: 'hidden' });
  // Only what is on shows; the rest is folded.
  const selected = await panel.locator('#profile-selected').innerText();
  for (const line of ['Support for movement and dexterity', 'Support for vision', 'Larger text', 'Name unlabeled buttons and fields']) assert.ok(selected.includes(line), `${line} in ${selected}`);
  assert.equal(await panel.getByRole('spinbutton', { name: /Larger text/ }).inputValue(), '1.5');
  assert.match(await panel.locator('#profile-summary').innerText(), /larger text/);
  assert.equal(await panel.locator('#profile-others').isVisible(), false, 'the rest is folded');
  let saved = await (await fetch(`${base}/v1/librarian/getProfile`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ args: [] }) })).json();
  assert.deepEqual(saved.result.supportAreas, ['motor', 'vision']);
  assert.match(saved.result.freeText, /hands shake/);
  assert.deepEqual(saved.result.fields.needs.map(n => n.dimension).sort(), ['labelControls', 'textSize'], 'only known needs');
  // One more, from what is folded.
  await panel.getByText('More options').click();
  await panel.getByRole('checkbox', { name: 'Less motion and animation' }).check();
  await panel.locator('#status', { hasText: 'On: Less motion and animation.' }).waitFor();
  saved = await (await fetch(`${base}/v1/librarian/getProfile`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ args: [] }) })).json();
  assert.ok(saved.result.fields.needs.some(n => n.dimension === 'reduceMotion' && n.value === true));
  await shot(panel, '0c-profile-saved');
  // A preset chosen elsewhere (the console) shows here at once.
  await fetch(`${base}/v1/profile/select`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'wai-2' }) });
  await panel.locator('#profile-started', { hasText: 'started from Profile 2' }).waitFor({ state: 'attached' });
  // The adapters: Applied open, Recommended and All folded until opened.
  await panel.getByRole('heading', { name: 'Applied on this page' }).waitFor();
  assert.equal(await panel.locator('#recommended-box').getAttribute('open'), null);
  assert.equal(await panel.locator('#all-box').getAttribute('open'), null);
  await panel.locator('#recommended-box summary').click();
  await panel.locator('#recommended-list li').first().waitFor();
  await shot(panel, '0d-recommended');
  await panel.getByRole('tab', { name: 'Builder' }).click();
  await panel.locator('#state', { hasText: 'Ready' }).waitFor({ timeout: 30000 });
  assert.match(await panel.locator('#transcript').innerText(), /Say what gets in your way/);

  const ask = async (text) => { await panel.fill('#message', text); await panel.press('#message', 'Enter'); };
  // How tall the Buy button is to a press: the points down its middle where a press reaches it,
  // through the button itself, its pseudo-elements, or a hit-area ring right after it (blocks/targets.js).
  const heightOfBuy = () => page.evaluate(() => {
    const buy = document.getElementById('buy');
    const r = buy.getBoundingClientRect();
    const x = r.left + r.width / 2;
    let hits = 0;
    for (let y = Math.max(0, r.top - 40); y < r.bottom + 40; y++) {
      const el = document.elementFromPoint(x, y);
      if (el && (el === buy || buy.contains(el) || el === buy.nextElementSibling && el.getAttribute('aria-hidden') === 'true')) hits++;
    }
    return hits;
  });
  const before = await heightOfBuy();
  // What the sidebar's live regions say, in order.
  const listen = () => panel.evaluate(() => {
    window.__said = [];
    for (const id of ['live', 'alert']) {
      const node = document.getElementById(id);
      new MutationObserver(() => { if (node.textContent) window.__said.push(node.textContent); }).observe(node, { childList: true, characterData: true, subtree: true });
    }
  });
  const said = () => panel.evaluate(() => window.__said.join('\n'));
  // The steps, opened: they are folded by default.
  const transcriptOpen = async () => {
    for (const b of await panel.locator('#transcript .steps-head button', { hasText: 'Show steps' }).all()) await b.click();
    return panel.locator('#transcript').innerText();
  };
  await listen();

  if (!REAL) {
    // ── the stand-in agent: deterministic steps ───────────────────────────────
    await ask('build bigger buttons');
    await panel.getByRole('heading', { name: 'May the assistant see this page?' }).waitFor();
    assert.match(await panel.locator('.card').innerText(), /not used to identify you/);
    await shot(panel, '1-share-page');
    await panel.getByRole('button', { name: 'The address, the source and a screenshot' }).click();
    // The chat now works on the shop.
    assert.match(await panel.locator('#working-label').innerText(), /Working on Shop/);
    await panel.getByRole('heading', { name: 'Preview “Bigger buttons”?' }).waitFor();
    await shot(panel, '2-preview');
    await panel.getByRole('button', { name: 'Preview', exact: true }).click();
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the preview on the page');
    await panel.locator('#preview-label', { hasText: 'Previewing “Bigger buttons”' }).waitFor();
    await panel.locator('#ready-list', { hasText: 'Bigger buttons' }).waitFor();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    // The steps are one folded line until opened.
    assert.ok(await panel.locator('#transcript ol.steps[hidden]').count() > 0, 'the steps are folded');
    assert.doesNotMatch(await panel.locator('#transcript').innerText(), /Looking at the page/);
    assert.match(await panel.locator('#transcript').innerText(), /\d+ steps/);
    const toggleSteps = panel.locator('#transcript .steps-head button').first();
    assert.equal(await toggleSteps.getAttribute('aria-expanded'), 'false');
    const shown = await transcriptOpen();
    assert.equal(await toggleSteps.getAttribute('aria-expanded'), 'true');
    assert.match(shown, /Looking at the page/);
    assert.match(shown, /“Bigger buttons” is previewing on your page · 1 of 1 checks pass · no new accessibility problems/);
    assert.match(shown, /Axe: clean\./, 'axe-core ran in the page before and after enable()');
    assert.match(shown, /Reading the toolkit’s guides and code \(2 times\)/, 'a repeated step is one line');
    assert.match(shown, /Changed: yes\./, 'the preview counted what enable() changed in the page');
    assert.ok(!/export const|```/.test(shown), 'no code in the sidebar');
    // Usable at once, then checked in the background; the full review when asked.
    // Made for this site: checked on the copy of the page, not on the general test pages.
    await panel.locator('#ready-list', { hasText: `Background check passed: nothing broke in 3 runs. On the copy of your page on ${new URL(shop).host} it made its change and its check passed, also narrow and with reduced motion. The general test pages were skipped: they do not have what it changes.` }).waitFor();
    await panel.getByRole('button', { name: 'Full review', exact: true }).click();
    await panel.locator('#ready-list', { hasText: 'Full review: no issues found.' }).waitFor();
    // What a screen reader heard: each change once.
    await until(async () => /“Bigger buttons” passed the full review\./.test(await said()), 'the review said');
    const heard = await said();
    for (const line of ['The assistant is working.', 'The assistant asks to see this page.', 'The assistant asks to preview “Bigger buttons”.', 'Previewing “Bigger buttons” on this page.', '“Bigger buttons” is ready.', 'The assistant is done.', '“Bigger buttons” passed the background check.']) {
      assert.ok(heard.includes(line), `said: ${line}\n--- heard ---\n${heard}`);
    }
    assert.ok(!/Looking at the page/.test(heard), 'steps are not read out one by one');
    await shot(panel, '3-ready');

    // The page data stays on the agent host's disk, screenshot included.
    const chatDir = path.join(agentData, `accounts/${UID}/page-data`);
    const [chatId] = await readdir(chatDir);
    const files = await readdir(path.join(chatDir, chatId));
    assert.ok(files.some(f => f.endsWith('-page.jpg')), 'the screenshot was kept');
    assert.match(readFileSync(path.join(chatDir, chatId, files.find(f => f.endsWith('-page.json'))), 'utf8'), /Save for later/);
    // With the page source shared, a copy of the page as it was before the preview, for the background check.
    const copy = JSON.parse(readFileSync(path.join(chatDir, chatId, files.find(f => f.endsWith('-copy.json'))), 'utf8'));
    assert.ok(copy.url.startsWith(shop), 'a copy of the chat\'s page');
    const mhtml = readFileSync(path.join(chatDir, chatId, copy.file), 'latin1');
    assert.match(mhtml, /multipart\/related/);
    assert.ok(!/data-big|BiggerButtons/.test(mhtml), 'saved before the preview changed it');

    // The chat is named after its first reply.
    await panel.locator('#chat-select option', { hasText: 'Stand-in title: build' }).waitFor({ state: 'attached' });

    // The switch takes the preview off the page, and puts it back, without the agent.
    const toggle = panel.getByRole('switch', { name: 'Apply previews' });
    await until(async () => (await toggle.getAttribute('aria-checked')) === 'true', 'the switch on');
    await toggle.click();
    await until(() => page.evaluate(() => !document.body.dataset.big), 'the preview off');
    await until(async () => (await toggle.getAttribute('aria-checked')) === 'false', 'the switch off');
    assert.match(await panel.locator('#preview-label').innerText(), /“Bigger buttons” is not on the page/);
    await toggle.click();
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the preview on again');
    await until(async () => (await toggle.getAttribute('aria-checked')) === 'true', 'the switch on');
    // On stays on: after a reload of the page, and of the sidebar.
    await page.reload();
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the preview back after the page reloads');
    await panel.reload();
    await until(async () => (await panel.getByRole('switch', { name: 'Apply previews' }).getAttribute('aria-checked')) === 'true', 'the switch on after the sidebar reloads');
    await page.reload();
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the preview back after both reload');
    await toggle.click();
    await until(() => page.evaluate(() => !document.body.dataset.big), 'the preview off again');

    // The person moves to another tab: the chat still works on the shop.
    const windowId = await runtime((id) => chrome.tabs.get(id).then(t => t.windowId), tabId);
    const otherOpened = context.waitForEvent('page');
    const otherId = await runtime(([url, windowId]) => chrome.tabs.create({ url, windowId, active: true }).then(t => t.id), [shop + 'other', windowId]);
    const other = await otherOpened;
    await other.waitForLoadState();
    await panel.locator('#switch-page', { hasText: 'Work on this page instead' }).waitFor();
    assert.match(await panel.locator('#working-label').innerText(), /Working on Shop/);
    await shot(panel, '3b-other-tab');

    // Automatic previews, and the site's answer remembered in this chat: no cards this time,
    // and the preview goes to the shop, not the tab on screen.
    // The switch on: the next preview goes on without asking.
    await toggle.click();
    await until(async () => (await toggle.getAttribute('aria-checked')) === 'true', 'the switch on');
    await page.evaluate(() => { delete document.body.dataset.big; });
    await ask('build them again');
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the automatic preview on the shop');
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    assert.equal(await panel.locator('.card').count(), 0);
    assert.equal(await other.evaluate(() => document.body.dataset.big), undefined, 'nothing ran on the tab on screen');
    const active = () => runtime((w) => chrome.tabs.query({ active: true, windowId: w }).then(([t]) => t.id), windowId);
    assert.equal(await active(), otherId, 'the shop was not brought forward: its screenshot was left out');

    // Go to that tab brings the shop forward; Work on this page instead moves the chat.
    await panel.getByRole('button', { name: 'Go to that tab' }).click();
    await until(async () => (await active()) === tabId, 'the shop tab in front');
    await panel.locator('#go-to-page').waitFor({ state: 'hidden' });
    await runtime((id) => chrome.tabs.update(id, { active: true }), otherId);
    await panel.getByRole('button', { name: /Work on this page instead/ }).click();
    await panel.locator('#working-label', { hasText: 'Working on Other' }).waitFor();
    await runtime((id) => chrome.tabs.update(id, { active: true }), tabId);

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
    // The preview gives way to the installed adapter: the switch goes off.
    await until(async () => (await toggle.getAttribute('aria-checked')) === 'false', 'the switch off once installed');
    assert.match(await panel.locator('#preview-label').innerText(), /Previews go on the page when you say so/);
    await until(() => page.evaluate(() => document.body.dataset.big === '1'), 'the installed adapter on the page');
    await panel.locator('#ready-list', { hasText: 'In your account: it runs in this browser' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'In your account' }).isDisabled(), true, 'nothing to add until a newer version');

    // A newer version replaces it in the account once it passes its background check.
    // The switch on with nothing to put back: the next preview goes on without asking.
    await toggle.click();
    await panel.locator('#preview-label', { hasText: 'The assistant’s next preview goes on the page.' }).waitFor();
    await ask('build it again');
    // (The stand-in offers it twice in a run that changes nothing: the last version is the one kept.)
    const chatNow = async () => (await (await fetch(`${base}/v1/agent/chats/${await panel.locator('#chat-select').inputValue()}`, { headers: { authorization: `Bearer ${token}` } })).json()).chat;
    const latest = await until(async () => { const c = await chatNow(); const a = c.adapters[0]; return !c.busy && a.check?.status === 'passed' && a.version > 2 && a.version; }, 'the newest version checked', 30000);
    await panel.locator('#status', { hasText: `Updated “Bigger buttons” in your account to version ${latest}.` }).waitFor({ timeout: 30000 });
    await panel.locator('#ready-list', { hasText: 'In your account: it runs in this browser' }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'In your account' }).isDisabled(), true);

    // Chats keep their history: a new one starts empty, the old one comes back.
    const firstChat = await panel.locator('#chat-select').inputValue();
    await panel.getByRole('button', { name: 'New chat' }).click();
    await panel.locator('#transcript', { hasText: 'Say what gets in your way' }).waitFor();
    await panel.selectOption('#chat-select', firstChat);
    await panel.locator('#transcript', { hasText: 'build them again' }).waitFor();
    await panel.reload();
    await panel.locator('#transcript', { hasText: 'build them again' }).waitFor();

    // The event stream drops: the sidebar says so, reconnects, says Ready again, and has
    // what happened meanwhile (a message sent elsewhere, and its reply).
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    const openId = await panel.locator('#chat-select').inputValue();
    server.closeAllConnections();
    await panel.locator('#state', { hasText: 'Reconnecting' }).waitFor();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    // Kept from reconnecting while the chat gets a message and its reply.
    await panel.route('**/v1/agent/events', (route) => route.abort());
    server.closeAllConnections();
    await panel.locator('#state', { hasText: 'Reconnecting' }).waitFor();
    const agentApi = (p, init = {}) => fetch(`${base}/v1/agent${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    assert.equal((await agentApi(`/chats/${openId}/messages`, { method: 'POST', body: JSON.stringify({ text: 'sent while away' }) })).status, 202);
    await until(async () => { const c = (await (await agentApi(`/chats/${openId}`)).json()).chat; return !c.busy && c.entries.some(e => e.text === 'You said: sent while away'); }, 'the reply on the host');
    assert.ok(!/sent while away/.test(await panel.locator('#transcript').innerText()), 'the sidebar did not hear it');
    // While it is down it says when it tries next, and offers Try now.
    await panel.locator('#state', { hasText: /Reconnecting in \d+ s/ }).waitFor();
    await panel.getByRole('button', { name: 'Try now' }).waitFor();
    // An attempt that gets no answer (a connection a sleeping laptop left behind) is given up.
    await panel.unroute('**/v1/agent/events');
    await panel.route('**/v1/agent/events', () => { /* never answered */ });
    await panel.getByRole('button', { name: 'Try now' }).click();
    await panel.locator('#state', { hasText: 'Reconnecting…' }).waitFor();
    const hungAt = Date.now();
    await panel.locator('#state', { hasText: /Reconnecting in \d+ s/ }).waitFor({ timeout: 20000 });
    assert.ok(Date.now() - hungAt < 15000, 'the unanswered attempt was given up within about 10 s');
    // Try now reconnects at once, without waiting out the timer.
    await panel.unroute('**/v1/agent/events');
    await panel.getByRole('button', { name: 'Try now' }).click();
    await panel.locator('#transcript', { hasText: 'You said: sent while away' }).waitFor({ timeout: 3000 });
    assert.equal(await panel.getByRole('button', { name: 'Try now' }).isHidden(), true);
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();

    // The agent's questions are multiple choice, each with Other for the person's own words.
    await panel.getByRole('button', { name: 'New chat' }).click();
    await panel.locator('#transcript', { hasText: 'Say what gets in your way' }).waitFor();
    await ask('questions please');
    await panel.getByRole('group', { name: 'Which pages?' }).waitFor();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    await shot(panel, '4-questions');
    await panel.getByRole('radio', { name: 'This page (Recommended)' }).check();
    // Other opens a box for their own words.
    const ownWords = panel.getByRole('textbox', { name: 'Your own answer: Who does it help?' });
    assert.equal(await ownWords.isVisible(), false);
    await panel.getByRole('group', { name: 'Who does it help?' }).getByRole('checkbox', { name: 'Other' }).check();
    await ownWords.fill('people who use a stylus');
    await panel.getByRole('checkbox', { name: 'Vision' }).check();
    await panel.getByRole('button', { name: 'Send answers' }).click();
    await panel.locator('#transcript .msg.you', { hasText: '→ Vision; people who use a stylus' }).waitFor();
    await panel.locator('#questions form').waitFor({ state: 'detached' });
    assert.match(await panel.locator('#transcript').innerText(), /Which pages\?\n→ This page \(Recommended\)/);

    // Which pages: a type of page, this website with its address, all websites. Who it helps:
    // more than one, the other areas under Other. (After the reply to the answers has finished.)
    await until(async () => !(await (await fetch(`${base}/v1/agent/chats/${await panel.locator('#chat-select').inputValue()}`, { headers: { authorization: `Bearer ${token}` } })).json()).chat.busy, 'the reply to the answers');
    await ask('kinds please');
    const pagesQ = panel.getByRole('group', { name: 'Which pages should this apply to?' });
    await pagesQ.waitFor();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    const host = new URL(shop).host;
    for (const name of [`This type of page: Product pages on ${host}`, 'This type of page: Product pages on all websites', `This website: ${host}`, /^All websites/, /^Other/]) await pagesQ.getByRole('radio', { name }).waitFor();
    assert.match(await pagesQ.innerText(), new RegExp(`http://${host.replace(/[.]/g, '\\.')}/`));
    const areasQ = panel.getByRole('group', { name: 'Who does this change help most?' });
    assert.equal(await areasQ.getByRole('checkbox', { name: 'Hearing' }).isVisible(), false, 'the other areas wait under Other');
    await areasQ.getByRole('checkbox', { name: 'Other' }).check();
    await areasQ.getByRole('checkbox', { name: 'Hearing' }).check();
    await areasQ.getByRole('checkbox', { name: 'Motor' }).check();
    await pagesQ.getByRole('radio', { name: /^All websites/ }).check();
    await shot(panel, '4b-kinds');
    await panel.getByRole('button', { name: 'Send answers' }).click();
    await panel.locator('#transcript .msg.you', { hasText: '→ All websites' }).waitFor();
    assert.match(await panel.locator('#transcript').innerText(), /Who does this change help most\?\n→ Motor; Hearing/);
    const kindsChat = await panel.locator('#chat-select').inputValue();
    const agentApi2 = (p) => fetch(`${base}/v1/agent${p}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await (await agentApi2(`/chats/${kindsChat}`)).json()).chat.allSites, true, 'all websites, as the person chose');

    // Deleting a chat asks once more, then opens another.
    const doomed = await panel.locator('#chat-select').inputValue();
    await panel.locator('#state', { hasText: 'Ready' }).waitFor();
    await panel.getByRole('button', { name: 'Delete' }).click();
    await panel.locator('#status', { hasText: 'Press Confirm delete' }).waitFor();
    await panel.getByRole('button', { name: 'Confirm delete' }).click();
    await panel.locator('#status', { hasText: 'Deleted' }).waitFor();
    assert.equal(await panel.locator(`#chat-select option[value="${doomed}"]`).count(), 0);
    assert.notEqual(await panel.locator('#chat-select').inputValue(), doomed);
    console.log('Assistant browser workflow passed (stand-in agent): page sharing with consent, preview with checks, axe-core and removal, automatic preview on the chat’s page while another tab is on screen, go to that tab and work on another page, repeated steps folded, no code shown, page data on the host, export, add to account (runs from the account), chat history, reconnecting after the stream drops, the preview switch, chat titles, multiple-choice questions (pages, areas, Other), steps folded, what a screen reader hears, background check and full review, the account updated to a newer checked version, deleting a chat.');
  } else {
    // ── real opencode and Gemini 3.8 Flash ────────────────────────────────────
    // Send, then answer what the agent asks (share everything, preview) until its run ends;
    // its multiple-choice questions get the first (its recommended) choice of each.
    let questionsAsked = 0;
    const run = async () => {
      await until(async () => (await panel.locator('#state').innerText()) === 'Working', 'the agent to start', 30000);
      await until(async () => {
        const card = panel.locator('#requests .card button.primary').first();
        if (await card.count()) await card.click().catch(() => {});
        return (await panel.locator('#state').innerText()) === 'Ready';
      }, 'the agent to finish', 600000).catch(async (e) => { console.log(await panel.locator('#transcript').innerText()); throw e; });
    };
    const answerQuestions = async () => {
      const form = panel.locator('#questions form');
      if (!(await form.count())) return false;
      for (const set of await form.locator('fieldset').all()) await set.locator('input[type=radio], input[type=checkbox]').first().check();
      if (!questionsAsked) await shot(panel, 'real-questions');
      questionsAsked++;
      await form.getByRole('button', { name: 'Send answers' }).click();
      return true;
    };
    const turn = async (text) => {
      await ask(text);
      await run();
      for (let i = 0; i < 3 && await answerQuestions(); i++) await run();
    };
    const applyPreviews = panel.getByRole('switch', { name: 'Apply previews' });
    if ((await applyPreviews.getAttribute('aria-checked')) !== 'true') await applyPreviews.click();
    await turn('The Buy and Save for later buttons on this shop are too small for me to tap. Please make an adapter that makes them easier to tap.');
    console.log(`The agent asked ${questionsAsked} set${questionsAsked === 1 ? '' : 's'} of multiple-choice questions.`);
    assert.ok(questionsAsked > 0, 'the agent asked its questions as multiple choice');
    for (let i = 0; i < 2 && !(await panel.locator('#ready-list li').count()); i++) {
      await turn('That looks right on my page. Please offer it to me so I can add it to my account.');
    }
    const shown = await panel.locator('#transcript').innerText();
    console.log('--- what the sidebar showed ---\n' + shown + '\n---');
    const after = await heightOfBuy();
    console.log(`Buy button height to a press: ${before}px before, ${after}px with the preview.`);
    assert.ok(after >= 44, 'the previewed adapter made the button at least 44px tall to a press');
    assert.ok(await panel.locator('#ready-list li').count(), 'the agent offered the adapter');
    await shot(panel, 'real-ready');
    await panel.getByRole('button', { name: 'Add to my account' }).first().click();
    await panel.locator('#status', { hasText: 'is in your account' }).waitFor({ timeout: 30000 });
    const mine = await createRegistryClient({ url: base, token }).installed('browser-runtime');
    assert.ok(mine.adapters.some(a => a.adapter.appId === 'assistant'), 'added to the account and installed in this browser');
    await until(async () => (await heightOfBuy()) >= 44, 'the installed adapter on the page');
    console.log(`Installed from the account: ${mine.adapters.filter(a => a.adapter.appId === 'assistant').map(a => a.adapter.id).join(', ')}; the Buy button is ${await heightOfBuy()}px tall to a press.`);
    assert.ok(!/```/.test(shown), 'no code blocks in the sidebar');
    // The background check, on the host's verifier: it ends one way or the other.
    const checked = await until(async () => { const t = await panel.locator('#ready-list').innerText(); return /Background check (passed|found problems|could not run)[^\n]*/.exec(t)?.[0]; }, 'the background check', 20 * 60_000);
    console.log(`Background check: ${checked}`);
    await shot(panel, 'real-checked');
    console.log('Assistant browser workflow passed with real opencode and Gemini 3.8 Flash: asked multiple choice, shared the page, built, previewed, reviewed, offered, added to the account.');
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
