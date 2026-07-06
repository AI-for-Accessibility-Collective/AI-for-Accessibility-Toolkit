// E2E test for voice mode's tool chain, driven through a real Chrome with the
// unpacked extension (throwaway profile). The deterministic beats need NO
// Gemini key and NO mic: voiceDebugToolCall runs a tool exactly as the Live
// model would (dispatch + action chip) without opening a paid WS session, so
// the whole offscreen → SW → storage → content-script chain is real.
//
//   ① adjust_settings via voice tool → chrome.storage.sync persisted →
//     content script applies VisualAssist on a real page load
//   ② get_page_content reads the active tab through chrome.scripting
//   ③ pageZoom drives chrome.tabs.setZoom
//   ④ undo_last_change reverts, action chips land in voiceState
//   ⑤ consent gate: forget_memory refuses an id the session never fetched
//
// With GEMINI_API_KEY set and --live passed, a smoke beat additionally opens
// a real Gemini Live session (fake-device mic) and drives it over the typed
// text path; model nondeterminism downgrades that beat's assertions to WARN.
//
// Usage: node test/voice-e2e.js [--keep] [--live]

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const KEEP = process.argv.includes('--keep');
const LIVE = process.argv.includes('--live') && !!process.env.GEMINI_API_KEY;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
function warn(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'WARN'}: ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (ok) results.push({ name, ok });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function wirePage(page, tag) {
  page.on('pageerror', (e) => console.log(`  [${tag} pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${tag} console.error] ${m.text()}`);
  });
  return page;
}

// Local page so the content-script assertion doesn't depend on the network.
const PAGE_HTML = `<!DOCTYPE html><html><head><title>Voice E2E Fixture</title></head>
<body><main><h1>Quarterly Report</h1><p>The zebra invoice total is 4321 dollars.</p>
<p>${'filler sentence. '.repeat(80)}</p></main></body></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => server.listen(8791, r));

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-voice-e2e-'));
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--window-size=1400,900',
      // For the --live beat: silent auto-grant + tone-generating fake mic.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
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
    // chrome.runtime.sendMessage never delivers to the sender's own context,
    // so the SW can't drive its own routes — messages must originate from an
    // extension PAGE (like the real side panel does). Open the panel page as
    // a normal tab and evaluate there.
    const driver = wirePage(await browser.newPage(), 'driver');
    await driver.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
    const sendMsg = (msg) => driver.evaluate((m) =>
      new Promise(r => chrome.runtime.sendMessage(m, (resp) => { void chrome.runtime.lastError; r(resp ?? null); })), msg);
    const debugTool = (name, args) => sendMsg({ type: 'voiceDebugToolCall', name, args });
    const getSync = (key) => swEval((k) =>
      new Promise(r => chrome.storage.sync.get(k, d => r(d[k]))), key);

    // ---- boot the offscreen voice engine (no Live session) ----
    const ensure = await sendMsg({ type: 'voiceEnsure' });
    check('voiceEnsure creates the offscreen page', !!ensure?.ok, JSON.stringify(ensure));
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const ping = await sendMsg({ type: 'voicePing' });
      ready = !!ping?.ok;
      if (!ready) await sleep(150);
    }
    check('offscreen voice engine answers voicePing', ready);

    // ============================================================
    // Beat 1 — adjust_settings persists and the content script applies it
    // ============================================================
    console.log('\n--- Beat 1: adjust_settings → storage → page ---');
    const adj = await debugTool('adjust_settings', { changes: { fontScale: 150 } });
    check('adjust_settings tool returns applied', adj?.result?.applied?.fontScale === 150, JSON.stringify(adj));
    check('fontScale persisted to chrome.storage.sync', (await getSync('fontScale')) === 150);

    const page = wirePage(await browser.newPage(), 'fixture');
    await page.goto('http://localhost:8791/', { waitUntil: 'networkidle2' });
    await sleep(1200); // content script runs at document_idle + async init
    const vaCss = await page.evaluate(() =>
      document.getElementById('ai4a11y-visual-assist')?.textContent || null);
    check('content script applied VisualAssist from the voice-written setting',
      !!vaCss && /zoom:\s*1\.5/.test(vaCss), String(vaCss).slice(0, 120));

    // ============================================================
    // Beat 1b — an explicitly out-of-scope change persists but does NOT
    // re-style the current tab (review finding: scoped live-apply guard)
    // ============================================================
    console.log('\n--- Beat 1b: out-of-scope change does not touch the current page ---');
    await page.bringToFront();
    // Reset the page to a known baseline first (undo any residual), then apply
    // a change scoped to a DIFFERENT origin than the fixture.
    const scoped = await debugTool('adjust_settings', { changes: { letterSpacing: 0.3 }, scope: 'origin:some-other-site.example' });
    check('scoped change reports it landed in the origin scope',
      scoped?.result?.scopesUsed?.letterSpacing === 'origin:some-other-site.example', JSON.stringify(scoped?.result || {}));
    await sleep(400);
    const leaked = await page.evaluate(() => {
      const css = document.getElementById('ai4a11y-visual-assist')?.textContent || '';
      return /letter-spacing:\s*0\.3/.test(css);
    });
    check('out-of-scope change did NOT re-style the current tab', leaked === false);
    await debugTool('undo_last_change', {});

    // ============================================================
    // Beat 2 — get_page_content reads the active tab
    // ============================================================
    console.log('\n--- Beat 2: get_page_content ---');
    await page.bringToFront();
    const outline = await debugTool('get_page_content', {});
    check('outline returns title + headings',
      outline?.result?.title === 'Voice E2E Fixture' && (outline.result.headings || []).includes('Quarterly Report'),
      JSON.stringify(outline?.result || {}).slice(0, 200));
    check('outline text carries page facts', /zebra invoice total is 4321/.test(outline?.result?.text || ''));

    // ============================================================
    // Beat 3 — pageZoom via chrome.tabs.setZoom
    // ============================================================
    console.log('\n--- Beat 3: pageZoom ---');
    const zoomResp = await debugTool('adjust_settings', { changes: { pageZoom: 150 } });
    check('pageZoom tool reports applied', zoomResp?.result?.applied?.pageZoom === 150, JSON.stringify(zoomResp?.result || {}));
    const zoomNow = await swEval(() => new Promise(r =>
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => chrome.tabs.getZoom(t.id, r))));
    check('chrome.tabs zoom factor is 1.5', Math.abs(zoomNow - 1.5) < 0.01, String(zoomNow));

    // ============================================================
    // Beat 4 — undo steps back (zoom first, then fontScale), chips recorded
    // ============================================================
    console.log('\n--- Beat 4: undo + action chips ---');
    const undo1 = await debugTool('undo_last_change', {});
    check('first undo reverts the zoom', undo1?.result?.reverted?.pageZoom === 100, JSON.stringify(undo1?.result || {}));
    const undo2 = await debugTool('undo_last_change', {});
    check('second undo reverts fontScale to its previous value', undo2?.result?.reverted?.fontScale === 100, JSON.stringify(undo2?.result || {}));
    check('fontScale back to 100 in storage', (await getSync('fontScale')) === 100);
    const undo3 = await debugTool('undo_last_change', {});
    check('empty undo stack is a friendly error', /nothing to undo/.test(undo3?.result?.error || ''));

    const voiceState = await swEval(() => new Promise(r =>
      chrome.storage.local.get('voiceState', d => r(d.voiceState || {}))));
    const chips = (voiceState.transcript || []).filter(e => e.role === 'action');
    check('action chips recorded in voiceState (>= 4)', chips.length >= 4, JSON.stringify(chips.map(c => c.text)));
    check('chips carry undoable flags', chips.some(c => c.undoable === true) && chips.some(c => c.undoable === false));

    // ============================================================
    // Beat 5 — consent gate
    // ============================================================
    console.log('\n--- Beat 5: forget_memory gate ---');
    const forget = await debugTool('forget_memory', { id: 'mem-hallucinated' });
    check('forget_memory refuses an unfetched id',
      /unknown memory id/.test(forget?.result?.error || ''), JSON.stringify(forget?.result || {}));

    // ============================================================
    // Beat 6 (env-gated) — real Gemini Live session over the typed path
    // ============================================================
    if (LIVE) {
      console.log('\n--- Beat 6: live smoke (real Gemini Live session) ---');
      await swEval((key) => chrome.storage.sync.set({ geminiApiKey: key }), process.env.GEMINI_API_KEY);
      await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${extId}`, ['microphone']);
      const conn = await sendMsg({ type: 'voiceConnect' });
      check('voiceConnect accepted', !conn?.error, JSON.stringify(conn));
      let liveNow = false;
      for (let i = 0; i < 60 && !liveNow; i++) {
        const ping = await sendMsg({ type: 'voicePing' });
        liveNow = ping?.state?.connection === 'live';
        if (ping?.state?.connection === 'error') break;
        if (!liveNow) await sleep(500);
      }
      check('Live session reaches connection=live (setup accepted incl. composed prompt)', liveNow);
      if (liveNow) {
        const turn = await sendMsg({ type: 'voiceTextTurn', text: 'Please set my text size to exactly 150 percent right now, without asking anything back.' });
        check('typed turn accepted', !!turn?.ok, JSON.stringify(turn));
        let applied = false;
        for (let i = 0; i < 50 && !applied; i++) {
          applied = (await getSync('fontScale')) === 150;
          if (!applied) await sleep(500);
        }
        warn('model applied the setting via adjust_settings (nondeterministic)', applied);
      }
      await sendMsg({ type: 'voiceDisconnect' });
    } else {
      console.log('\n(live smoke skipped — set GEMINI_API_KEY and pass --live to enable)');
    }
  } finally {
    server.close();
    if (!KEEP) await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
