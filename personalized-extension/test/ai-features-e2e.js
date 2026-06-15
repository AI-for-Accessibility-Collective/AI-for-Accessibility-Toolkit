// E2E test for the GEMINI-BACKED features, complementing demo-beats-e2e.js
// (which covers the deterministic paths). Requires a real key:
//
//   GEMINI_API_KEY=... node test/ai-features-e2e.js [--keep]
//
//   A. interpretNeeds  — popup "What support do you need?" → real Gemini
//                        suggestion mapped onto the global tools registry
//   B. Real agent run  — BrowserAgent drives a live YouTube tab to turn on
//                        captions (CDP + Gemini step loop), and the REAL
//                        outcome observation drafts the reusable-action
//                        proposal (no simulation)
//   C. Real auto-replay— accept the proposal, visit a Vimeo video page,
//                        content script triggers the saved action and the
//                        agent replays it for real
//
// Live-site caveats: YouTube/Vimeo UI changes, consent walls, or missing
// caption tracks can fail B/C without the toolkit being at fault — the test
// prints the agent's own summary/error so failures are diagnosable.

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const KEEP = process.argv.includes('--keep');
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY env var is required for this test.');
  process.exit(1);
}

const YOUTUBE_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // has CC
const VIMEO_VIDEO = 'https://vimeo.com/76979871'; // has CC

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function wirePage(page, tag) {
  page.on('pageerror', (e) => console.log(`  [${tag} pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${tag} console.error] ${m.text()}`);
  });
  return page;
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-ai-e2e-'));
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--window-size=1500,950',
    ],
    defaultViewport: null,
  });

  try {
    const swTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().includes('background'),
      { timeout: 15000 }
    );
    const worker = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    console.log(`extension loaded: ${extId}\n`);

    const swEval = (fn, ...args) => worker.evaluate(fn, ...args);
    const getTrace = () => swEval(() =>
      new Promise(r => chrome.storage.local.get('aaDemoTrace', d => r(d.aaDemoTrace || []))));
    const regionsIn = (events, diagram) =>
      events.filter(e => e.diagram === diagram).map(e => e.region);
    const getAgentState = () => swEval(() =>
      new Promise(r => chrome.storage.local.get('bhAgent', d => r(d.bhAgent || null))));

    // Poll the agent run until it leaves running state. Prints progress.
    async function waitForAgent(label, timeoutMs) {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < timeoutMs) {
        const st = await getAgentState();
        const desc = st ? `${st.status} step=${(st.log || []).length}` : 'none';
        if (desc !== last) { console.log(`  [${label}] ${desc}`); last = desc; }
        if (st && (st.status === 'done' || st.status === 'error')) return st;
        await sleep(3000);
      }
      return await getAgentState();
    }

    // ---- setup: demo pages on, clean state, REAL key, profile seeded ----
    const personalPage = await browser.newPage();
    await personalPage.goto(`chrome-extension://${extId}/demo/personal.html`);
    const skillPage = await browser.newPage();
    await skillPage.goto(`chrome-extension://${extId}/demo/skill-creation.html`);
    await sleep(800);
    await personalPage.evaluate(() =>
      new Promise(r => chrome.runtime.sendMessage({ type: 'aaResetDemo' }, r)));
    await swEval((key) =>
      new Promise(r => chrome.storage.sync.set({ geminiApiKey: key }, r)), API_KEY);
    await swEval(async () => {
      await globalThis.Librarian.setProfileField('supportAreas', ['vision']);
      await globalThis.Librarian.setProfileField('freeText',
        'small text is hard to read, news sites stress me out');
    });

    // ============================================================
    // A — interpretNeeds (explicit path) through the popup UI
    // ============================================================
    console.log('--- A: interpretNeeds (popup "What support do you need?") ---');
    let before = (await getTrace()).length;

    const popup = wirePage(await browser.newPage(), 'popup');
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('#aiSupportInput', { timeout: 5000 });
    await popup.type('#aiSupportInput', 'make text easier to read on news sites');
    await popup.click('#aiSupportBtn');
    const gotSuggestion = await popup
      .waitForSelector('#aiSuggestion:not([hidden])', { timeout: 60000 })
      .then(() => true).catch(() => false);
    check('A: Gemini suggestion rendered', gotSuggestion, 'no #aiSuggestion within 60s');

    if (gotSuggestion) {
      const summary = await popup.$eval('#aiSuggestionSummary', el => el.textContent.trim());
      const items = await popup.$$eval('#aiSuggestionList > *', els => els.map(e => e.textContent.trim()));
      check('A: suggestion has a summary', summary.length > 0);
      check('A: suggestion proposes concrete settings/tools', items.length > 0,
        'empty suggestion list');
      console.log(`  summary: ${summary.slice(0, 140)}`);
      console.log(`  items: ${items.slice(0, 4).join(' | ').slice(0, 200)}`);
    }
    let events = (await getTrace()).slice(before);
    let skillRegions = regionsIn(events, 'skill');
    for (const region of ['user', 'explicit', 'globaldb_q']) {
      check(`A: trace skill/${region}`, skillRegions.includes(region),
        `got: ${skillRegions.join(',') || '(none)'}`);
    }
    await popup.close();

    // ============================================================
    // B — REAL agent run: turn on captions on a live YouTube tab
    // ============================================================
    console.log('\n--- B: real agent run on YouTube (captions) ---');
    before = (await getTrace()).length;

    const yt = wirePage(await browser.newPage(), 'youtube');
    await yt.goto(YOUTUBE_VIDEO, { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch(e => console.log(`  (youtube nav: ${e.message})`));
    await sleep(4000); // let the player settle

    const ytTabId = await swEval(() =>
      new Promise(r => chrome.tabs.query({ url: '*://www.youtube.com/*' },
        tabs => r(tabs[0]?.id ?? null))));
    check('B: found YouTube tab id', ytTabId != null);

    await swEval((tabId) => {
      globalThis.BrowserAgent.run('Turn on captions (CC) for this video', { tabId, maxSteps: 10 })
        .catch(() => {}); // errors land in chrome.storage.local.bhAgent
      return true;
    }, ytTabId);

    const runState = await waitForAgent('agent', 240000);
    check('B: agent run completed', runState?.status === 'done',
      JSON.stringify(runState && { status: runState.status, error: runState.error, summary: runState.summary }));
    console.log(`  agent summary: ${runState?.summary || runState?.error || '(none)'}`);

    events = (await getTrace()).slice(before);
    skillRegions = regionsIn(events, 'skill');
    for (const region of ['user', 'assistant', 'assistant_perform']) {
      check(`B: trace skill/${region}`, skillRegions.includes(region),
        `got: ${skillRegions.join(',') || '(none)'}`);
    }

    // The REAL outcome observation must have drafted the reusable-action
    // proposal (this is the un-simulated version of demo-beats beat 2).
    await sleep(1500);
    const pending = await swEval(() => globalThis.Librarian.listProposals('pending'));
    check('B: real outcome drafted reusable-action proposal',
      pending.some(p => p?.change?.op === 'add-profile-action'
        && /captions/i.test(p?.change?.action?.prompt || '')),
      `pending: ${JSON.stringify(pending.map(p => p.aspect))}`);
    check('B: trace skill/reusable_q (proposal diamond)',
      regionsIn(events, 'skill').includes('reusable_q')
      || regionsIn((await getTrace()).slice(before), 'skill').includes('reusable_q'));

    // ============================================================
    // C — accept via popup, then REAL auto-replay on a Vimeo video
    // ============================================================
    console.log('\n--- C: accept proposal, real auto-replay on Vimeo ---');
    const popup2 = wirePage(await browser.newPage(), 'popup2');
    await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
    const hasCard = await popup2.waitForSelector('.proposal-card', { timeout: 5000 })
      .then(() => true).catch(() => false);
    check('C: popup shows proposal card', hasCard);
    if (hasCard) {
      await popup2.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.proposal-card button'))
          .find(b => /yes, apply/i.test(b.textContent));
        btn?.click();
      });
      await sleep(1200);
    }
    const profiles = await swEval(() =>
      new Promise(r => chrome.storage.local.get('customProfiles', d => r(d.customProfiles || []))));
    const auto = profiles.find(p => p.autoApply && (p.siteTypes || []).includes('video'));
    check('C: auto-apply video profile saved', !!auto && (auto.actions || []).length > 0,
      JSON.stringify(profiles.map(p => p.name)));
    await popup2.close();

    // Clear run B's terminal state so the poll below can only see the NEW
    // replay run, and give the content script (document_idle) time to
    // classify the site and fire the auto-replay before polling.
    await swEval(() => new Promise(r => chrome.storage.local.remove('bhAgent', r)));
    before = (await getTrace()).length;
    const vimeo = wirePage(await browser.newPage(), 'vimeo');
    await vimeo.goto(VIMEO_VIDEO, { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch(e => console.log(`  (vimeo nav: ${e.message})`));
    await sleep(8000);

    const replayState = await waitForAgent('replay', 240000);
    check('C: replay agent run completed', replayState?.status === 'done',
      JSON.stringify(replayState && { status: replayState.status, error: replayState.error, summary: replayState.summary }));
    console.log(`  replay summary: ${replayState?.summary || replayState?.error || '(none)'}`);
    check('C: replay ran the saved captions task',
      /captions/i.test(replayState?.task || ''), JSON.stringify(replayState?.task));

    events = (await getTrace()).slice(before);
    check('C: trace skill/librarian_retrieves',
      regionsIn(events, 'skill').includes('librarian_retrieves'),
      `got: ${regionsIn(events, 'skill').join(',') || '(none)'}`);
    check('C: trace skill/autoenable', regionsIn(events, 'skill').includes('autoenable'));
    check('C: trace personal/adapt', regionsIn(events, 'personal').includes('adapt'),
      `got: ${regionsIn(events, 'personal').join(',') || '(none)'}`);

    // ---- summary ----
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
      console.log('Failed:');
      for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    if (!KEEP) {
      await browser.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } else {
      console.log('\n--keep: leaving the test Chrome open for inspection.');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
