// contrast-e2e.js — Puppeteer E2E tests for fix-contrast.js
//
// Drives the REAL adapter via the same load-unpacked-extension pattern used by
// reader-e2e.js and visual-assist-e2e.js.  fix-contrast is deterministic
// (requiresAI:false) so no Gemini API key is needed.
//
// ── REAL-PATH BEATS (drive the actual fix-contrast.js enable/disable/re-enable) ──
//   Beat A: failing text (#fail-gray-on-white) reaches ≥4.5:1 after enable.
//            State mark data-ai4a11y-contrast="done" is set.
//   Beat B: passing element (#pass-black-on-white) is UNTOUCHED (ratio already ≥4.5).
//   Beat C: bg-image element is SKIPPED (data-ai4a11yContrastState="skipped-bgimage").
//   Beat D: dark-body text (#dark-section p) color was changed (not stuck on near-black).
//   Beat E: disable() restores exact original computed colors; marks cleared.
//   Beat F: re-enable re-fixes (marks cleared on disable → adapter re-sweeps).
//
// ── MATH SECTION (kept for WCAG formula regression coverage) ──
//   Verifies fixture baseline ratios (confirming fixture is meaningful).
//
// Run: node test/contrast-e2e.js

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT_PATH = path.resolve(__dirname, '..', 'extension');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8773;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json',
};

// ---------------------------------------------------------------------------
// Minimal contrast ratio helper — used in the math section and Beat A assertion.
// Matches WCAG 2.x formula exactly.
// ---------------------------------------------------------------------------
const IN_PAGE_CONTRAST_FN = `
function _inPageLuminance(r, g, b) {
  const c = [r, g, b].map(v => {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function inPageContrastRatio(fgCss, bgCss) {
  function lum(css) {
    const m = css.match(/rgba?\\((\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/);
    if (!m) return 1;
    return _inPageLuminance(+m[1], +m[2], +m[3]);
  }
  const L1 = Math.max(lum(fgCss), lum(bgCss));
  const L2 = Math.min(lum(fgCss), lum(bgCss));
  return (L1 + 0.05) / (L2 + 0.05);
}
`;

// ---------------------------------------------------------------------------
// Server (serves fixture + extension source files for http:// origin)
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (filePath.endsWith('/')) filePath += 'index.html';
      const ext = path.extname(filePath);
      const mime = MIME[ext] || 'application/octet-stream';
      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function wirePage(page, tag) {
  page.on('pageerror', e => console.log(`  [${tag} pageerror] ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') console.log(`  [${tag} console.error] ${m.text()}`);
  });
  return page;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const server = await startServer();
  console.log(`Fixture server on http://localhost:${PORT}\n`);

  const FIXTURE_URL = `http://localhost:${PORT}/test/fixtures/contrast/page.html`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-contrast-e2e-'));
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--window-size=1400,900',
    ],
    defaultViewport: null,
  });

  try {
    // ── Wait for extension service worker ──────────────────────────────────
    const swTarget = await browser.waitForTarget(
      t => t.type() === 'service_worker' && t.url().includes('background'),
      { timeout: 15000 }
    );
    const worker = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    console.log(`Extension loaded: ${extId}\n`);

    const swEval = (fn, ...args) => worker.evaluate(fn, ...args);

    // Open the side-panel page as a driver (first-party extension page can
    // call chrome.tabs.sendMessage; SW-originated messages cannot reach content scripts).
    const driver = wirePage(await browser.newPage(), 'driver');
    await driver.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);

    const sendToTab = (tabId, msg) =>
      driver.evaluate((id, m) => new Promise(r =>
        chrome.tabs.sendMessage(id, m, resp => { void chrome.runtime.lastError; r(resp ?? null); })
      ), tabId, msg);

    // ── Seed chrome.storage.sync with {fixContrast: true} BEFORE loading the
    //    fixture page so initFromStorage() picks it up and calls FixContrast.enable()
    //    at document_idle without needing a Gemini API key. ──────────────────
    await swEval(() => new Promise(r =>
      chrome.storage.sync.set({ fixContrast: true }, r)
    ));
    console.log('Seeded chrome.storage.sync {fixContrast: true}\n');

    // ── Open fixture page ──────────────────────────────────────────────────
    const fixturePage = wirePage(await browser.newPage(), 'fixture');
    await fixturePage.goto(FIXTURE_URL, { waitUntil: 'networkidle2' });

    // content script runs at document_idle; give initFromStorage + sweep time
    await sleep(2000);

    // Inject the contrast ratio helper for in-page assertions
    await fixturePage.evaluate(IN_PAGE_CONTRAST_FN);

    // ── Get the fixture tab ID (needed for sendToTab) ──────────────────────
    const tabId = await swEval((url) =>
      new Promise(r => chrome.tabs.query({ url }, tabs => r(tabs[0]?.id ?? null)))
    , FIXTURE_URL);

    check('Got fixture tab ID', !!tabId, String(tabId));

    // ==========================================================================
    // Beat A — failing text reaches ≥4.5:1 after enable (real adapter path)
    // ==========================================================================
    console.log('\n--- Beat A: failing text fixed ---');

    const afterEnable = await fixturePage.evaluate(() => {
      const el = document.getElementById('fail-gray-on-white');
      if (!el) return null;
      const fg = getComputedStyle(el).color;
      const bg = 'rgb(255, 255, 255)';
      return {
        fg,
        ratio: inPageContrastRatio(fg, bg),
        state: el.getAttribute('data-ai4a11y-contrast'),       // 'done' when fixed
        contrastState: el.dataset.ai4a11yContrastState,        // undef or 'skipped-bgimage'
        hasClass: el.classList.contains('ai4a11y-contrast-fixed'),
        hasOriginalDataset: 'ai4a11yOriginalColor' in el.dataset,
      };
    });

    check('Beat A: fix-contrast.js ran (data-ai4a11y-contrast="done" on failing element)',
      afterEnable?.state === 'done',
      afterEnable ? `state=${afterEnable.state} fg=${afterEnable.fg}` : 'element not found');

    check('Beat A: failing text reaches ≥4.5:1 after enable',
      afterEnable?.ratio >= 4.5,
      afterEnable ? `ratio=${afterEnable.ratio?.toFixed(2)} fg=${afterEnable.fg}` : 'null');

    check('Beat A: ai4a11y-contrast-fixed class set on fixed element',
      afterEnable?.hasClass === true,
      afterEnable ? `hasClass=${afterEnable.hasClass}` : 'null');

    check('Beat A: ai4a11yOriginalColor dataset saved for later restore',
      afterEnable?.hasOriginalDataset === true,
      afterEnable ? `hasDataset=${afterEnable.hasOriginalDataset}` : 'null');

    // ==========================================================================
    // Beat B — passing element untouched
    // ==========================================================================
    console.log('\n--- Beat B: passing element untouched ---');

    const passEl = await fixturePage.evaluate(() => {
      const el = document.getElementById('pass-black-on-white');
      if (!el) return null;
      const fg = getComputedStyle(el).color;
      const bg = 'rgb(255, 255, 255)';
      return {
        fg,
        ratio: inPageContrastRatio(fg, bg),
        state: el.getAttribute('data-ai4a11y-contrast'),
        hasClass: el.classList.contains('ai4a11y-contrast-fixed'),
      };
    });

    check('Beat B: passing element (black on white) already ≥4.5:1',
      passEl?.ratio >= 4.5,
      passEl ? `ratio=${passEl.ratio?.toFixed(2)}` : 'null');

    // The adapter marks passing elements as 'done' too (they were processed and passed),
    // but must NOT add the fix class or change the color.
    check('Beat B: passing element does NOT have ai4a11y-contrast-fixed class (color unchanged)',
      passEl?.hasClass === false,
      passEl ? `hasClass=${passEl.hasClass}` : 'null');

    // ==========================================================================
    // Beat C — bg-image element skipped
    // ==========================================================================
    console.log('\n--- Beat C: bg-image element skipped ---');

    const bgImgEl = await fixturePage.evaluate(() => {
      const el = document.getElementById('bg-image-element');
      if (!el) return null;
      return {
        state: el.getAttribute('data-ai4a11y-contrast'),
        contrastState: el.dataset.ai4a11yContrastState,
        hasClass: el.classList.contains('ai4a11y-contrast-fixed'),
      };
    });

    check('Beat C: bg-image element state is "done" (processed and skipped)',
      bgImgEl?.state === 'done',
      bgImgEl ? `state=${bgImgEl.state} contrastState=${bgImgEl.contrastState}` : 'null');

    check('Beat C: bg-image element has skipped-bgimage marker',
      bgImgEl?.contrastState === 'skipped-bgimage',
      bgImgEl ? `contrastState=${bgImgEl.contrastState}` : 'null');

    check('Beat C: bg-image element NOT given fix class (color not modified)',
      bgImgEl?.hasClass === false,
      bgImgEl ? `hasClass=${bgImgEl.hasClass}` : 'null');

    // ==========================================================================
    // Beat D — dark-body text was changed (not stuck near-black on dark bg)
    // ==========================================================================
    console.log('\n--- Beat D: dark-body text color changed ---');

    const darkEl = await fixturePage.evaluate(() => {
      const el = document.querySelector('#dark-section p');
      if (!el) return null;
      const fg = getComputedStyle(el).color;
      const bg = 'rgb(26, 26, 46)'; // known dark-section bg
      return {
        fg,
        ratio: inPageContrastRatio(fg, bg),
        state: el.getAttribute('data-ai4a11y-contrast'),
        hasClass: el.classList.contains('ai4a11y-contrast-fixed'),
      };
    });

    check('Beat D: dark-body text now reaches ≥4.5:1 on dark background',
      darkEl?.ratio >= 4.5,
      darkEl ? `ratio=${darkEl.ratio?.toFixed(2)} fg=${darkEl.fg}` : 'null');

    check('Beat D: dark-body text has ai4a11y-contrast-fixed class',
      darkEl?.hasClass === true,
      darkEl ? `hasClass=${darkEl.hasClass}` : 'null');

    // ==========================================================================
    // Beat E — disable() restores exact original computed colors; marks cleared
    // ==========================================================================
    console.log('\n--- Beat E: disable restores exact original colors ---');

    // Record the CURRENT colors (post-enable) before we disable, to verify
    // change did happen. Also record the pre-enable baseline from the fixture CSS.
    const preDisable = await fixturePage.evaluate(() => {
      const grayEl = document.getElementById('fail-gray-on-white');
      const darkEl = document.querySelector('#dark-section p');
      return {
        grayFg: getComputedStyle(grayEl).color,
        darkFg: getComputedStyle(darkEl).color,
        grayHasClass: grayEl.classList.contains('ai4a11y-contrast-fixed'),
      };
    });

    // Send disable via the messaging path the popup uses
    const disableResp = await sendToTab(tabId, { type: 'settingsChanged', settings: { fixContrast: false } });
    check('Beat E: disable message delivered', !!disableResp, JSON.stringify(disableResp));
    await sleep(500); // give synchronous disable() time to complete

    const afterDisable = await fixturePage.evaluate(() => {
      const grayEl = document.getElementById('fail-gray-on-white');
      const darkEl = document.querySelector('#dark-section p');
      return {
        grayFg: getComputedStyle(grayEl).color,
        darkFg: getComputedStyle(darkEl).color,
        grayHasClass: grayEl.classList.contains('ai4a11y-contrast-fixed'),
        grayMark: grayEl.getAttribute('data-ai4a11y-contrast'),
        darkMark: darkEl.getAttribute('data-ai4a11y-contrast'),
        // Fixture CSS: #fail-gray-on-white { color: #cccccc; } = rgb(204, 204, 204)
        grayIsOriginal: getComputedStyle(grayEl).color === 'rgb(204, 204, 204)',
        // Fixture CSS: #dark-section p { color: #334466; } = rgb(51, 68, 102)
        darkIsOriginal: getComputedStyle(darkEl).color === 'rgb(51, 68, 102)',
      };
    });

    check('Beat E: gray element color restored to fixture original (#cccccc)',
      afterDisable.grayIsOriginal,
      `color=${afterDisable.grayFg} expected=rgb(204, 204, 204)`);

    check('Beat E: dark-body text color restored to fixture original (#334466)',
      afterDisable.darkIsOriginal,
      `color=${afterDisable.darkFg} expected=rgb(51, 68, 102)`);

    check('Beat E: ai4a11y-contrast-fixed class removed after disable',
      afterDisable.grayHasClass === false,
      `hasClass=${afterDisable.grayHasClass}`);

    check('Beat E: data-ai4a11y-contrast mark cleared after disable',
      afterDisable.grayMark === null && afterDisable.darkMark === null,
      `grayMark=${afterDisable.grayMark} darkMark=${afterDisable.darkMark}`);

    // ==========================================================================
    // Beat F — re-enable re-fixes (marks cleared → adapter re-sweeps)
    // ==========================================================================
    console.log('\n--- Beat F: re-enable re-fixes ---');

    const reEnableResp = await sendToTab(tabId, { type: 'settingsChanged', settings: { fixContrast: true } });
    check('Beat F: re-enable message delivered', !!reEnableResp, JSON.stringify(reEnableResp));
    await sleep(1000); // give enable() + sweep time

    await fixturePage.evaluate(IN_PAGE_CONTRAST_FN); // re-inject helper (page context)
    const afterReEnable = await fixturePage.evaluate(() => {
      const el = document.getElementById('fail-gray-on-white');
      if (!el) return null;
      const fg = getComputedStyle(el).color;
      const bg = 'rgb(255, 255, 255)';
      return {
        fg,
        ratio: inPageContrastRatio(fg, bg),
        state: el.getAttribute('data-ai4a11y-contrast'),
        hasClass: el.classList.contains('ai4a11y-contrast-fixed'),
      };
    });

    check('Beat F: re-enable re-fixes failing element (state=done)',
      afterReEnable?.state === 'done',
      afterReEnable ? `state=${afterReEnable.state}` : 'null');

    check('Beat F: re-enable: failing element again reaches ≥4.5:1',
      afterReEnable?.ratio >= 4.5,
      afterReEnable ? `ratio=${afterReEnable.ratio?.toFixed(2)} fg=${afterReEnable.fg}` : 'null');

    // ==========================================================================
    // ── MATH SECTION: WCAG formula regression checks ──
    //    Pure Node.js checks using fixture's known CSS values (no browser page needed).
    //    The extension always runs on new tabs so a browser-based "before-fix" check
    //    races with initFromStorage.  Instead, verify the WCAG formula directly against
    //    the hardcoded fixture hex values — these break if the fixture changes.
    // ==========================================================================
    console.log('\n--- Math section: fixture baseline ratio verification (Node WCAG math) ---');

    function nodeLuminance(r, g, b) {
      return [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * v, 0);
    }
    function nodeContrastRatio(r1,g1,b1, r2,g2,b2) {
      const L1 = Math.max(nodeLuminance(r1,g1,b1), nodeLuminance(r2,g2,b2));
      const L2 = Math.min(nodeLuminance(r1,g1,b1), nodeLuminance(r2,g2,b2));
      return (L1 + 0.05) / (L2 + 0.05);
    }

    // Fixture: #cccccc (204,204,204) on #ffffff (255,255,255) — fails AA at ~1.6:1
    const grayRatio = nodeContrastRatio(204, 204, 204, 255, 255, 255);
    check('Math: gray-on-white fixture CSS (#cccccc on #fff) fails AA (ratio < 4.5)',
      grayRatio < 4.5, `ratio=${grayRatio.toFixed(3)}`);

    // Fixture: #000000 on #ffffff — passes AA at 21:1
    const blackRatio = nodeContrastRatio(0, 0, 0, 255, 255, 255);
    check('Math: black-on-white fixture already passes AA (ratio ≈ 21)',
      blackRatio >= 4.5, `ratio=${blackRatio.toFixed(2)}`);

    // Fixture: #334466 (51,68,102) on #1a1a2e (26,26,46) — fails AA at ~1.75:1
    const darkRatio = nodeContrastRatio(51, 68, 102, 26, 26, 46);
    check('Math: dark-body fixture CSS (#334466 on #1a1a2e) fails AA (ratio < 4.5)',
      darkRatio < 4.5, `ratio=${darkRatio.toFixed(3)}`);

    // Confirm the WCAG threshold constant (sanity: borderline black-on-50%-gray)
    const borderlineRatio = nodeContrastRatio(0, 0, 0, 119, 119, 119);
    check('Math: WCAG formula sanity — black on ~mid-gray is near 4.5:1',
      borderlineRatio >= 4.0 && borderlineRatio <= 5.0, `ratio=${borderlineRatio.toFixed(3)}`);

  } finally {
    await browser.close();
    server.close();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== contrast-e2e.js: ${results.length - failed.length} pass, ${failed.length} fail ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL: ${f.name}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => {
  console.error('contrast-e2e crash:', e);
  process.exit(1);
});
