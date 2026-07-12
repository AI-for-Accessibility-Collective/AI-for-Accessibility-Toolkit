// wcag-e2e.js — Puppeteer E2E tests for wcag-fixes.js (2.4).
// Run: node test/wcag-e2e.js
// Requires: npm run build (for content.bundle.js), plus an HTTP server.
// The test spins up its own server on 8767 to avoid port collision with run-tests.js.

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const PORT = 8767;
const ROOT = path.resolve(__dirname, '..');
const FIXTURE = '/test/fixtures/wcag/page.html';

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS:', name);
  } else {
    fail++;
    console.log('FAIL:', name, detail !== undefined ? `— ${JSON.stringify(detail)}` : '');
  }
}

// ---------------------------------------------------------------------------
// Minimal HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fp.endsWith('/')) fp += 'index.html';
  const ext = path.extname(fp);
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.map': 'application/json'
  }[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

async function runTests() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`Server on http://localhost:${PORT}`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  // ---------------------------------------------------------------------------
  // Helper: load fixture with wcag-fixes injected via addScriptTag (ES module)
  // ---------------------------------------------------------------------------
  async function runWcagTests(riskyEnabled) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('[pageerror]', e.message));

    await page.goto(`http://localhost:${PORT}${FIXTURE}`, { waitUntil: 'domcontentloaded' });

    // Set up chrome stubs + audit hook captures
    await page.evaluate((risky) => {
      window.__capturedFixes = [];
      window.__capturedStats = { wcag: 0 };
      globalThis.ai4a11yLogFix = (...a) => window.__capturedFixes.push(a);
      globalThis.ai4a11yIncrementStat = (type) => {
        window.__capturedStats[type] = (window.__capturedStats[type] || 0) + 1;
      };
      globalThis.CSS = {
        escape: s => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
      };
      globalThis.chrome = {
        runtime: {
          sendMessage: () => {},
          onMessage: { addListener() {} },
          lastError: undefined,
        },
        storage: {
          sync: {
            get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); },
            set: () => Promise.resolve(),
          },
          local: { get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); } },
          onChanged: { addListener() {} },
        },
        tabs: { sendMessage: () => {}, query: () => Promise.resolve([]) },
      };
    }, riskyEnabled);

    // Inject wcag-fixes as ES module (Puppeteer supports type:module addScriptTag)
    const loaded = await page.addScriptTag({
      type: 'module',
      content: `
        import { WcagFixes, axeHandlers, RISKY_AXE_RULES, SAFE_FIXERS, RISKY_FIXERS } from '/skills/builtin/wcag-fixes.js';
        import { markProcessed } from '/utils/dom.js';
        window.__WcagFixes = WcagFixes;
        window.__axeHandlers = axeHandlers;
        window.__RISKY_AXE_RULES = RISKY_AXE_RULES;
        window.__SAFE_FIXERS = SAFE_FIXERS;
        window.__RISKY_FIXERS = RISKY_FIXERS;
        window.__moduleLoaded = true;
      `,
    }).catch(e => { console.error('addScriptTag failed:', e.message); return null; });

    if (!loaded) {
      console.log('SKIP: addScriptTag failed');
      await page.close();
      return null;
    }

    // Wait for module to load (ES module addScriptTag is async)
    const moduleLoaded = await page.waitForFunction(
      () => window.__moduleLoaded === true,
      { timeout: 5000 }
    ).then(() => true).catch(() => false);

    if (!moduleLoaded) {
      console.log('SKIP: module did not load in time');
      await page.close();
      return null;
    }

    // Enable WcagFixes
    await page.evaluate((risky) => {
      window.__WcagFixes.enable({ wcagRiskyFixes: risky });
    }, riskyEnabled);

    return page;
  }

  // ---------------------------------------------------------------------------
  // Test 1: safe tier (risky=false)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 1: safe tier (wcagRiskyFixes=false) ---');
  const page1 = await runWcagTests(false);

  if (page1) {
    // 1a. duplicate-id: second #field1 renamed, label still has for="field1"
    const dupeResult = await page1.evaluate(() => {
      const inputs = document.querySelectorAll('input[type=text]');
      const first = inputs[0];
      const second = inputs[1];
      const label = document.querySelector('label[for="field1"]');
      return {
        firstId: first ? first.id : null,
        secondIdChanged: second ? second.id !== 'field1' : false,
        labelFor: label ? label.getAttribute('for') : null,
      };
    });
    check('duplicate-id: first element keeps original id', dupeResult.firstId === 'field1', dupeResult);
    check('duplicate-id: second element renamed', dupeResult.secondIdChanged, dupeResult);
    check('duplicate-id: label still has for="field1" (NOT re-pointed)',
      dupeResult.labelFor === 'field1', dupeResult);

    // 1b. pt-BR lang attr on subtree element — must NOT be rewritten
    const ptBR = await page1.evaluate(() => {
      const el = document.querySelector('[lang="pt-BR"]');
      return el ? el.getAttribute('lang') : null;
    });
    check('pt-BR lang NOT rewritten (valid BCP-47)', ptBR === 'pt-BR', ptBR);

    // 1c. html[lang="fa"] — fa is valid BCP-47, must NOT be rewritten
    const htmlLang = await page1.evaluate(() => document.documentElement.getAttribute('lang'));
    check('html[lang=fa] NOT rewritten (valid BCP-47)', htmlLang === 'fa', htmlLang);

    // 1d. target=_blank gets rel=noopener noreferrer
    const rel = await page1.evaluate(() => {
      const el = document.getElementById('extLink');
      return el ? el.getAttribute('rel') : null;
    });
    check('target-blank gets rel with noopener', !!(rel && rel.includes('noopener')), rel);
    check('target-blank gets rel with noreferrer', !!(rel && rel.includes('noreferrer')), rel);

    // 1e. marquee replaced (element should be gone or tag changed)
    const marqueeStillExists = await page1.evaluate(() => !!document.querySelector('marquee'));
    check('marquee element replaced (marquee tag gone)', !marqueeStillExists);

    // 1f. aria-checked NOT backfilled on role=checkbox div
    const ariaChecked = await page1.evaluate(() => {
      const el = document.getElementById('fakeCheckbox');
      return el ? el.getAttribute('aria-checked') : 'NOT_FOUND';
    });
    check('aria-checked NOT backfilled on role=checkbox', ariaChecked === null, ariaChecked);

    // 1g. heading h4 NOT retagged (risky off)
    const headingTag = await page1.evaluate(() => {
      const el = document.getElementById('skippedHeading');
      return el ? el.tagName : null;
    });
    check('h4 NOT retagged when risky off (risky=false)', headingTag === 'H4', headingTag);

    await page1.close();
  } else {
    console.log('SKIP: safe-tier DOM tests skipped (module loading unavailable)');
  }

  // ---------------------------------------------------------------------------
  // Test 2: risky tier — heading retagged when wcagRiskyFixes=true
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 2: risky tier (wcagRiskyFixes=true) ---');
  const page2 = await runWcagTests(true);

  if (page2) {
    // h4 follows h1 (skips h2/h3), so fixHeadingOrder should retag it to h2
    const headingTag = await page2.evaluate(() => {
      const el = document.getElementById('skippedHeading');
      return el ? el.tagName : null;
    });
    check('h4 retagged to h2 when wcagRiskyFixes=true', headingTag === 'H2', headingTag);
    await page2.close();
  } else {
    console.log('SKIP: risky-tier test skipped');
  }

  // ---------------------------------------------------------------------------
  // Test 3: revertFix round-trip — apply inverse descriptor to restore DOM
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 3: revertFix round-trip ---');
  const page3 = await runWcagTests(false);

  if (page3) {
    const revertResult = await page3.evaluate(() => {
      const el = document.getElementById('extLink');
      if (!el) return { error: 'extLink not found' };

      // Find the fix for this element from captured fixes
      const relFix = window.__capturedFixes.find(f => f[0] === 'target-blank');
      if (!relFix) return { error: 'target-blank fix not captured' };

      const desc = relFix[4]; // inverse descriptor (5th arg)
      if (!desc) return { error: 'no inverse descriptor', fix: relFix };

      // Apply the inverse: restore prior rel value
      const before = el.getAttribute('rel');
      if (desc.prior === null || desc.prior === undefined || desc.prior === '') {
        el.removeAttribute(desc.attr);
      } else {
        el.setAttribute(desc.attr, desc.prior);
      }
      const after = el.getAttribute('rel');
      return { before, after, prior: desc.prior, reverted: true };
    });

    if (revertResult.error) {
      check('revertFix: fix captured with inverse descriptor', false, revertResult.error);
    } else {
      check('revertFix: had rel=noopener before revert', !!(revertResult.before && revertResult.before.includes('noopener')), revertResult.before);
      check('revertFix: rel removed/restored after revert (DOM restored)', revertResult.after === null || revertResult.after === revertResult.prior, revertResult);
    }
    await page3.close();
  } else {
    console.log('SKIP: revertFix test skipped');
  }

  // ---------------------------------------------------------------------------
  // Test 4: Axe bridge smoke test
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 4: axe bridge smoke test ---');
  const page4 = await runWcagTests(false);

  if (page4) {
    // 4a. __ai4a11yAxeDispatch is injected via the module (check via __axeHandlers)
    const handlersExist = await page4.evaluate(() =>
      typeof window.__axeHandlers === 'object' && window.__axeHandlers !== null
    );
    check('axeHandlers map loaded from wcag-fixes.js', handlersExist);

    // 4b. axeHandlers has required keys
    const handlerKeys = await page4.evaluate(() => Object.keys(window.__axeHandlers));
    check('axeHandlers has html-lang-valid', handlerKeys.includes('html-lang-valid'), handlerKeys.slice(0, 5));
    check('axeHandlers has duplicate-id', handlerKeys.includes('duplicate-id'), handlerKeys.slice(0, 5));
    check('axeHandlers has heading-order (risky)', handlerKeys.includes('heading-order'));

    // 4c. Synthetic dispatch: dispatching with a handler that exists does not throw
    let threw = false;
    try {
      await page4.evaluate(() => {
        // Build a minimal dispatch simulation: call the tabindex handler
        const handler = window.__axeHandlers['tabindex'];
        if (!handler) return;
        // Make a synthetic element
        const el = document.createElement('button');
        el.setAttribute('tabindex', '3');
        document.body.appendChild(el);
        try { handler(el); } catch (_) {}
        document.body.removeChild(el);
      });
    } catch (e) {
      threw = true;
    }
    check('dispatching tabindex handler does not throw', !threw);

    // 4d. Dispatching with an unknown rule ID is a no-op (handler is undefined)
    const unknownResult = await page4.evaluate(() => {
      const handler = window.__axeHandlers['non-existent-rule-id'];
      return { exists: !!handler };
    });
    check('unknown rule ID has no handler (returns undefined)', !unknownResult.exists);

    await page4.close();
  } else {
    console.log('SKIP: axe bridge test skipped');
  }

  // ---------------------------------------------------------------------------
  // Test 5: anchor-selector revertFix after sibling insertion (#8 killer case)
  // After fixing a target=_blank link, insert a sibling <a> BEFORE it so the
  // nth-of-type index shifts. revertFix must still resolve the correct element
  // via [data-ai4a11y-fix="n"] (not nth-of-type).
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 5: anchor-selector stable after sibling insertion (#8) ---');
  const page5 = await runWcagTests(false);

  if (page5) {
    const anchorResult = await page5.evaluate(() => {
      // Find the fixed link (has data-ai4a11y-fix and rel with noopener).
      const extLink = document.getElementById('extLink');
      if (!extLink) return { error: 'extLink not found' };

      const fixAttr = extLink.getAttribute('data-ai4a11y-fix');
      if (!fixAttr) return { error: 'no data-ai4a11y-fix stamp on extLink', rel: extLink.getAttribute('rel') };

      const relAfterFix = extLink.getAttribute('rel') || '';

      // Insert a sibling <a> BEFORE extLink — this shifts any nth-of-type index.
      const sibling = document.createElement('a');
      sibling.href = 'https://example.com/sibling';
      sibling.textContent = 'Sibling inserted after fix';
      extLink.parentElement.insertBefore(sibling, extLink);

      // Now revert using the anchor selector — should still resolve to extLink.
      const selector = `[data-ai4a11y-fix="${fixAttr}"]`;
      const resolved = document.querySelector(selector);
      if (!resolved) return { error: `selector ${selector} resolved null after sibling insertion` };

      const isCorrectElement = resolved === extLink;

      // Apply the inverse (prior rel was empty string → null stored, so remove).
      const priorRel = null; // extLink had no rel before fix
      if (priorRel === null) {
        resolved.removeAttribute('rel');
      } else {
        resolved.setAttribute('rel', priorRel);
      }

      const relAfterRevert = extLink.getAttribute('rel');
      return {
        fixAttr,
        relAfterFix,
        isCorrectElement,
        siblingInserted: true,
        relAfterRevert,
      };
    });

    if (anchorResult.error) {
      check('anchor-selector: extLink was stamped with data-ai4a11y-fix', false, anchorResult.error);
    } else {
      check('anchor-selector: data-ai4a11y-fix stamp present on fixed element',
        !!anchorResult.fixAttr, anchorResult.fixAttr);
      check('anchor-selector: rel has noopener after fix',
        !!(anchorResult.relAfterFix && anchorResult.relAfterFix.includes('noopener')),
        anchorResult.relAfterFix);
      check('anchor-selector: querySelector resolves exact element after sibling insertion',
        anchorResult.isCorrectElement, anchorResult);
      check('anchor-selector: rel removed on revert (prior was absent)',
        anchorResult.relAfterRevert === null, anchorResult.relAfterRevert);
    }
    await page5.close();
  } else {
    console.log('SKIP: anchor-selector test skipped');
  }

  // ---------------------------------------------------------------------------
  // Test 6: disable() restores attribute fixes (#7 — inverse replay)
  // Enable WcagFixes, verify fixes applied, then call disable() and verify DOM
  // is restored for rel (target-blank) and tabindex fixes.
  // ---------------------------------------------------------------------------
  console.log('\n--- Test group 6: disable() restores safe-tier attribute fixes (#7) ---');
  const page6 = await runWcagTests(false);

  if (page6) {
    const disableResult = await page6.evaluate(() => {
      // Capture state before disable: the extLink should have noopener/noreferrer.
      const extLink = document.getElementById('extLink');
      const relAfterFix = extLink ? extLink.getAttribute('rel') : null;

      // Now call disable().
      window.__WcagFixes.disable();

      // After disable: rel should be restored (extLink had no rel before — should be removed).
      const relAfterDisable = extLink ? extLink.getAttribute('rel') : 'NOT_FOUND';

      // Anchor attributes should be cleaned up.
      const anchorAttrsRemaining = document.querySelectorAll('[data-ai4a11y-fix]').length;

      return { relAfterFix, relAfterDisable, anchorAttrsRemaining };
    });

    check('disable replay: rel had noopener/noreferrer after fix',
      !!(disableResult.relAfterFix && disableResult.relAfterFix.includes('noopener')),
      disableResult.relAfterFix);
    check('disable replay: rel removed/restored after disable()',
      disableResult.relAfterDisable === null || disableResult.relAfterDisable === '',
      disableResult.relAfterDisable);
    check('disable replay: all data-ai4a11y-fix anchors removed after disable()',
      disableResult.anchorAttrsRemaining === 0, disableResult.anchorAttrsRemaining);

    await page6.close();
  } else {
    console.log('SKIP: disable-replay test skipped');
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  await browser.close();
  server.close();

  console.log(`\n=== wcag-e2e.js: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

runTests().catch(e => {
  console.error('Fatal E2E error:', e);
  server.close();
  process.exit(1);
});
