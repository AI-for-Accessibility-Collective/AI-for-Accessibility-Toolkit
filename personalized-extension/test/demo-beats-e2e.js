// E2E test for the three demo beats, driven through a real Chrome instance
// with the unpacked extension loaded (separate throwaway profile — does not
// touch the user's browser session).
//
//   ① Onboarding cold-start  → personal diagram traces + Librarian seeded
//   ② Suggestion             → agent-task observation → proposal → popup
//                              consent card → "Yes, apply" → saved profile
//   ③ Adaptive auto-replay   → visit a video site → profile matched →
//                              auto-replay traces fire
//
// The agent run in ② is simulated by feeding the Librarian the same
// observation a finished run produces (demo mode forces success), so the
// test is deterministic and needs no Gemini API key. Everything downstream
// of that observation — proposal gating, popup UI, accept handler, profile
// storage, site classification, auto-replay trigger — is the real code path.
//
// Usage: node test/demo-beats-e2e.js [--keep]   (--keep leaves Chrome open)

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const KEEP = process.argv.includes('--keep');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Surface page-side errors in the test output — extension pages fail
// silently otherwise.
function wirePage(page, tag) {
  page.on('pageerror', (e) => console.log(`  [${tag} pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${tag} console.error] ${m.text()}`);
  });
  return page;
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-demo-e2e-'));
  // Chrome for Testing (npx puppeteer browsers install chrome) — branded
  // Chrome 137+ ignores --load-extension, so the system binary can't be used.
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
    // ---- locate the extension service worker ----
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

    // ---- open both live diagram pages (turns demo mode on) ----
    const personalPage = await browser.newPage();
    await personalPage.goto(`chrome-extension://${extId}/demo/personal.html`);
    const skillPage = await browser.newPage();
    await skillPage.goto(`chrome-extension://${extId}/demo/skill-creation.html`);
    await sleep(800);

    check('demo mode enabled by diagram pages',
      await swEval(() => !!globalThis.AA_DEMO_MODE) === true);

    // ---- clean slate ----
    const reset = await personalPage.evaluate(() =>
      new Promise(r => chrome.runtime.sendMessage({ type: 'aaResetDemo' }, r)));
    check('aaResetDemo round-trip', !!reset?.ok, JSON.stringify(reset));

    // ============================================================
    // Beat 1 — Onboarding cold-start (Personalize path, no LLM)
    // ============================================================
    console.log('\n--- Beat 1: onboarding cold-start ---');
    let before = (await getTrace()).length;

    // Onboarding's Personalize gate requires a key in the field (it
    // auto-fills from storage). The Personalize path itself makes no LLM
    // calls, so a placeholder suffices; set GEMINI_API_KEY for real agent
    // runs in beat 3.
    await swEval((key) =>
      new Promise(r => chrome.storage.sync.set({ geminiApiKey: key }, r)),
      process.env.GEMINI_API_KEY || 'test-key-demo-e2e');

    const ob = wirePage(await browser.newPage(), "onboarding");
    await ob.goto(`chrome-extension://${extId}/onboarding/onboarding.html`);
    await ob.evaluate(() => document.querySelector('input[name="support"][value="vision"]').click());
    await ob.type('#freeText', 'small text is hard to read, news sites stress me out');
    await ob.click('#personalizeBtn');
    await ob.waitForSelector('#page-wizard.active', { timeout: 5000 });
    await ob.click('#wizNextBtn'); // single area selected -> goes to summary
    await ob.waitForSelector('#page-summary.active', { timeout: 5000 });
    await ob.click('#summaryFinishBtn'); // saveAndFinish + window.close()
    await sleep(1500);

    let events = (await getTrace()).slice(before);
    let personalRegions = regionsIn(events, 'personal');
    for (const region of ['user', 'coldstart', 'profiledb', 'librarian']) {
      check(`beat1 trace personal/${region}`, personalRegions.includes(region),
        `got: ${personalRegions.join(',') || '(none)'}`);
    }

    const lib = await swEval(() => globalThis.Librarian.getProfile());
    check('beat1 Librarian profile seeded with vision',
      !!lib && (lib.supportAreas || []).includes('vision'), JSON.stringify(lib?.supportAreas));
    check('beat1 Librarian profile carries freeText',
      /small text/.test(lib?.freeText || ''), JSON.stringify(lib?.freeText));

    const active1 = await personalPage.$$eval('.hl.active', els => els.map(e => e.dataset.region));
    check('beat1 personal diagram highlights visible',
      ['user', 'coldstart', 'profiledb', 'librarian'].every(r => active1.includes(r)),
      `active: ${active1.join(',') || '(none)'}`);

    // ============================================================
    // Beat 2 — Suggestion: agent outcome -> proposal -> popup consent
    // ============================================================
    console.log('\n--- Beat 2: suggestion (agent task -> proposal -> accept) ---');
    before = (await getTrace()).length;

    // Same observation a finished agent run feeds the Librarian
    // (run.js _bhAgentObserveOutcome); demo mode forces "success".
    const obsResult = await swEval(() => globalThis.Librarian.logObservation({
      type: 'agent-task',
      url: 'https://www.youtube.com/watch?v=demo123',
      text: 'Agent task "Turn on captions for this video" finished successfully: captions enabled',
      data: { task: 'Turn on captions for this video', summary: 'captions enabled', success: true },
    }));
    check('beat2 observation logged', !!obsResult?.logged, JSON.stringify(obsResult));
    await sleep(600);

    const pending = await swEval(() => globalThis.Librarian.listProposals('pending'));
    check('beat2 reusable-action proposal drafted',
      pending.length === 1 && pending[0]?.change?.op === 'add-profile-action',
      `pending: ${JSON.stringify(pending.map(p => p.aspect))}`);

    events = (await getTrace()).slice(before);
    let skillRegions = regionsIn(events, 'skill');
    check('beat2 trace skill/reusable_q', skillRegions.includes('reusable_q'),
      `got: ${skillRegions.join(',') || '(none)'}`);

    // Popup consent card (popup.html opened as a tab — same DOM/JS as toolbar popup)
    before = (await getTrace()).length;
    const popup = wirePage(await browser.newPage(), "popup");
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('.proposal-card', { timeout: 5000 })
      .catch(() => null);
    const cardText = await popup.$eval('.proposal-card', el => el.textContent)
      .catch(() => null);
    check('beat2 popup shows proposal card', !!cardText, 'no .proposal-card rendered');
    check('beat2 card describes the captions task on video sites',
      !!cardText && /captions/i.test(cardText) && /video/i.test(cardText),
      JSON.stringify(cardText));

    const clicked = await popup.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.proposal-card button'))
        .find(b => /yes, apply/i.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('beat2 clicked "Yes, apply"', clicked);
    await sleep(1200);

    const profiles = await swEval(() =>
      new Promise(r => chrome.storage.local.get('customProfiles', d => r(d.customProfiles || []))));
    const autoProfile = profiles.find(p => p.autoApply && (p.siteTypes || []).includes('video'));
    check('beat2 auto-apply video profile created', !!autoProfile,
      JSON.stringify(profiles.map(p => p.name)));
    check('beat2 profile carries the saved action',
      !!autoProfile && (autoProfile.actions || []).some(a => /captions/i.test(a.prompt)),
      JSON.stringify(autoProfile?.actions));

    events = (await getTrace()).slice(before);
    skillRegions = regionsIn(events, 'skill');
    for (const region of ['skillsdb', 'autoenable', 'profiledb_skill']) {
      check(`beat2 trace skill/${region}`, skillRegions.includes(region),
        `got: ${skillRegions.join(',') || '(none)'}`);
    }
    check('beat2 trace personal/continual',
      regionsIn(events, 'personal').includes('continual'));

    const active2 = await skillPage.$$eval('.hl.active', els => els.map(e => e.dataset.region));
    check('beat2 skill diagram highlights visible',
      ['skillsdb', 'autoenable', 'profiledb_skill'].every(r => active2.includes(r)),
      `active: ${active2.join(',') || '(none)'}`);

    // ============================================================
    // Beat 3 — Adaptive auto-replay on a new same-category site
    // ============================================================
    console.log('\n--- Beat 3: adaptive auto-replay on vimeo.com ---');
    before = (await getTrace()).length;

    const site = wirePage(await browser.newPage(), "site");
    try {
      await site.goto('https://vimeo.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`  (vimeo navigation: ${e.message} — content script may still have run)`);
    }
    await sleep(4000); // content script runs at document_idle; classify + traces

    events = (await getTrace()).slice(before);
    skillRegions = regionsIn(events, 'skill');
    check('beat3 trace skill/librarian_retrieves', skillRegions.includes('librarian_retrieves'),
      `got: ${skillRegions.join(',') || '(none)'}`);
    check('beat3 trace skill/autoenable', skillRegions.includes('autoenable'),
      `got: ${skillRegions.join(',') || '(none)'}`);
    check('beat3 trace personal/adapt', regionsIn(events, 'personal').includes('adapt'),
      `got: ${regionsIn(events, 'personal').join(',') || '(none)'}`);

    // The replay handed the saved action to the browser agent (it needs a
    // Gemini key to actually click captions, but the handoff must happen).
    const agentState = await swEval(() =>
      new Promise(r => chrome.storage.local.get('bhAgent', d => r(d.bhAgent || null))));
    check('beat3 agent run started for the saved action',
      !!agentState && /captions/i.test(agentState.task || ''),
      JSON.stringify(agentState && { task: agentState.task, status: agentState.status }));

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
