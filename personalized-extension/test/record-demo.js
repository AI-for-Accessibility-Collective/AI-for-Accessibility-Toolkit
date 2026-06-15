// Records the 3-beat demo as a screen capture (.mov on the Desktop).
//
//   Layout:  demo browser window (left)  |  personal diagram (right top)
//                                        |  skill diagram   (right bottom)
//
//   Beat 1: onboarding cold-start + explicit need (interpretNeeds on a news
//           site) — personal diagram pulses, then skill diagram explicit path
//   Beat 2: real agent run turns on YouTube captions → reusable-task
//           proposal → popup consent card → "Yes, apply"
//   Beat 3: open another video page → Librarian retrieves the saved skill →
//           agent auto-replays it
//
// Requires GEMINI_API_KEY (real agent + interpretNeeds) and macOS Screen
// Recording permission for the terminal running this script.
//
// Usage: GEMINI_API_KEY=... node test/record-demo.js

const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const PAUSE_MS = 5000;
const YT_VIDEO_1 = 'https://www.youtube.com/watch?v=arj7oStGLkU'; // TED talk — reliable CC
const YT_VIDEO_2 = 'https://www.youtube.com/watch?v=9bZkp7q19f0'; // Gangnam Style — CC (verified replay)
const NEWS_SITE = 'https://www.nytimes.com';
const OUT = path.join(os.homedir(), 'Desktop',
  `aa-demo-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.mov`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function pause(label) { console.log(`  … ${label}`); await sleep(PAUSE_MS); }

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-rec-'));
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    ignoreDefaultArgs: ['--enable-automation'], // no "controlled by test software" bar
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--mute-audio',
      '--window-position=0,25', '--window-size=740,905',
    ],
    defaultViewport: null,
  });

  let rec = null;
  try {
    const swTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().includes('background'), { timeout: 15000 });
    const worker = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    const swEval = (fn, ...args) => worker.evaluate(fn, ...args);
    console.log(`extension: ${extId}`);

    // ---- layout: stack the two diagram windows on the right half ----
    const blank = (await browser.pages())[0];
    const { sw, sh } = await blank.evaluate(() => ({ sw: screen.width, sh: screen.availHeight }));
    const rightX = 740, rightW = Math.max(640, sw - rightX), halfH = Math.floor((sh - 25) / 2);
    // Create focused (raises above any pre-existing user windows — created
    // unfocused they sit BEHIND other apps and the recording captures those
    // instead), then hand focus back to the demo window.
    const w1 = await swEval((url, left, top, width, height) =>
      chrome.windows.create({ url, left, top, width, height, type: 'popup', focused: true }),
      `chrome-extension://${extId}/demo/personal.html`, rightX, 25, rightW, halfH);
    const w2 = await swEval((url, left, top, width, height) =>
      chrome.windows.create({ url, left, top, width, height, type: 'popup', focused: true }),
      `chrome-extension://${extId}/demo/skill-creation.html`, rightX, 25 + halfH, rightW, halfH);
    await sleep(1500);
    // Re-raise both (belt and braces) and put the demo window back on top.
    await swEval(async (a, b) => {
      await chrome.windows.update(a, { focused: true });
      await chrome.windows.update(b, { focused: true });
      const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
      if (all[0]) await chrome.windows.update(all[0].id, { focused: true });
    }, w1.id, w2.id);
    await sleep(800);

    // clean slate + key
    const personalTarget = await browser.waitForTarget(t => t.url().includes('demo/personal.html'));
    const personalPage = await personalTarget.page();
    await personalPage.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ type: 'aaResetDemo' }, r)));
    await swEval((k) => new Promise(r => chrome.storage.sync.set({ geminiApiKey: k }, r)), API_KEY);

    // ---- recording: 2s probe first to catch missing screen permission ----
    const probe = path.join(os.tmpdir(), 'aa-probe.mov');
    await new Promise((res) => {
      const p = spawn('screencapture', ['-v', '-V', '2', '-x', probe]);
      p.on('exit', res);
    });
    const probeOk = fs.existsSync(probe) && fs.statSync(probe).size > 20000;
    fs.rmSync(probe, { force: true });
    if (!probeOk) {
      throw new Error('Screen recording produced an empty file — grant Screen Recording '
        + 'permission to your terminal in System Settings → Privacy & Security, then rerun.');
    }
    console.log(`recording to ${OUT}`);
    rec = spawn('screencapture', ['-v', '-x', OUT]); // until SIGINT
    await sleep(2000);

    // helper: agent progress poll
    const agentState = () => swEval(() =>
      new Promise(r => chrome.storage.local.get('bhAgent', d => r(d.bhAgent || null))));
    async function waitAgent(label, timeoutMs) {
      const t0 = Date.now(); let last = '';
      while (Date.now() - t0 < timeoutMs) {
        const st = await agentState();
        const d = st ? `${st.status} step=${(st.log || []).length}` : 'none';
        if (d !== last) { console.log(`  [${label}] ${d}`); last = d; }
        if (st && (st.status === 'done' || st.status === 'error')) return st;
        await sleep(2500);
      }
      return agentState();
    }

    // ================= Beat 1: onboarding + explicit need =================
    console.log('\nBeat 1: onboarding');
    const ob = await browser.newPage();
    await ob.goto(`chrome-extension://${extId}/onboarding/onboarding.html`);
    await pause('onboarding open');
    await ob.evaluate(() => document.querySelector('input[name="support"][value="vision"]').click());
    await pause('selected Vision');
    await ob.click('#freeText');
    await ob.type('#freeText', 'small text is hard to read, news sites stress me out', { delay: 45 });
    await pause('described needs');
    await ob.click('#personalizeBtn');
    await ob.waitForSelector('#page-wizard.active', { timeout: 5000 });
    await pause('personalize wizard');
    await ob.click('#wizNextBtn');
    await ob.waitForSelector('#page-summary.active', { timeout: 5000 });
    await pause('review summary');
    await ob.click('#summaryFinishBtn').catch(() => {}); // tab closes itself
    await pause('finished onboarding — personal diagram pulses');

    console.log('Beat 1b: explicit need on a news site');
    const news = await browser.newPage();
    await news.goto(NEWS_SITE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await pause('news site open');
    const popup1 = await browser.newPage();
    await popup1.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup1.waitForSelector('#aiSupportInput', { timeout: 5000 });
    await pause('popup open');
    await popup1.click('#aiSupportInput');
    await popup1.type('#aiSupportInput', 'make text easier to read on news sites', { delay: 45 });
    await pause('typed support need');
    await popup1.click('#aiSupportBtn');
    await popup1.waitForSelector('#aiSuggestion:not([hidden])', { timeout: 60000 })
      .then(() => console.log('  suggestion rendered — skill diagram explicit path pulses'))
      .catch(() => console.log('  (no suggestion within 60s)'));
    await pause('suggestion shown');
    await popup1.click('#aiApplyBtn').catch(() => {});
    await pause('applied suggestions');
    await popup1.close();
    await news.bringToFront();
    await news.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await pause('news page with larger text');
    await news.close();

    // ================= Beat 2: one-off agent task → proposal ==============
    console.log('\nBeat 2: real agent run (captions)');
    const yt = await browser.newPage();
    await yt.goto(YT_VIDEO_1, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(6000); // player settles
    await pause('YouTube open');
    const ytTabId = await swEval(() => new Promise(r =>
      chrome.tabs.query({ url: '*://www.youtube.com/*' }, tabs => r(tabs[0]?.id ?? null))));
    await swEval((tabId) => {
      globalThis.BrowserAgent.run('Turn on captions (CC) for this video', { tabId, maxSteps: 10 })
        .catch(() => {});
      return true;
    }, ytTabId);
    const run1 = await waitAgent('agent', 240000);
    console.log(`  agent: ${run1?.summary || run1?.error}`);
    await pause('task done — proposal drafted (reusable_q pulses)');

    // Popup window sized so the "What I Know About You" panel and its
    // proposal card are on screen, positioned over the demo browser.
    await swEval((url) => chrome.windows.create(
      { url, type: 'popup', left: 60, top: 70, width: 460, height: 760, focused: true }),
      `chrome-extension://${extId}/popup/popup.html`);
    await sleep(1200);
    const pp = await (await browser.waitForTarget(t => t.url().includes('popup/popup.html'))).page();
    await pp.waitForSelector('.proposal-card', { timeout: 8000 }).catch(() => {});
    // Scroll the consent card into view and flag it so it's unmistakable.
    await pp.evaluate(() => {
      const card = document.querySelector('.proposal-card');
      if (card) {
        card.scrollIntoView({ block: 'center' });
        card.style.outline = '3px solid #ea4335';
        card.style.borderRadius = '10px';
      }
    });
    await pause('"Is this a reusable task?" consent card — Yes / Not now / Don\'t suggest');
    await pause('reading the suggestion');
    await pp.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.proposal-card button'))
        .find(x => /yes, apply/i.test(x.textContent));
      b?.click();
    });
    await pause('accepted — skillsdb / autoenable / profiledb pulse');
    await pp.close().catch(() => {});
    await yt.close();

    // ================= Beat 3: auto-replay on a new video page ============
    console.log('\nBeat 3: auto-replay');
    await swEval(() => new Promise(r => chrome.storage.local.remove('bhAgent', r)));
    const yt2 = await browser.newPage();
    await yt2.goto(YT_VIDEO_2, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    console.log('  new video page — librarian_retrieves / autoenable / adapt pulse');
    const run2 = await waitAgent('replay', 240000);
    console.log(`  replay: ${run2?.summary || run2?.error}`);
    await pause('captions on, hands-free');
    await sleep(3000);

    console.log('\ndone');
  } finally {
    if (rec) {
      rec.kill('SIGINT');
      await new Promise(r => rec.on('exit', r));
      if (fs.existsSync(OUT)) console.log(`\nrecording saved: ${OUT} (${Math.round(fs.statSync(OUT).size / 1e6)} MB)`);
    }
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
