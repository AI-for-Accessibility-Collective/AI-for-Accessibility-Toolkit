// test/keyboard-e2e.js — Puppeteer E2E tests for the rebuilt keyboard-nav.js
// Run: node test/keyboard-e2e.js

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8795;
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/keyboard');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Inject helper: strip ES module syntax from a source file
function stripModule(src) {
  return src
    .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+\{[^}]+\};?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

async function injectKeyboardNav(page, tabbableUmdSrc, knSrc) {
  await page.evaluate((tabSrc, knSrc) => {
    // Inject tabbable UMD — it assigns to `this.tabbable` in non-strict mode.
    // We ensure `this` is window by wrapping in a function called with window as `this`.
    (function() { eval(tabSrc); }).call(window); // eslint-disable-line no-eval
    // After injection, window.tabbable is the exports object: { tabbable, focusable, ... }
    // We expose the `tabbable` function directly for use in keyboard-nav.js
    window.__tabbable = window.tabbable ? window.tabbable.tabbable : null;

    // Stub dependencies
    window.__ai4a11yAnnounce = (msg) => {
      window.__announceLog = window.__announceLog || [];
      window.__announceLog.push(msg);
    };
    window.__registerSweep = (name, cb, opts) => {
      window.__sweepCb = cb;
      return () => { window.__sweepCb = null; };
    };

    // Strip ES module import/export and replace stubs
    let code = knSrc
      .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^export\s+const\s+/gm, 'const ')
      .replace(/^export\s+\{[^}]+\};?\s*$/gm, '')
      .replace(/^export\s+/gm, '')
      // Replace `tabbable(` calls with our global stub
      .replace(/\btabbable\(/g, 'window.__tabbable(')
      // Replace announce( calls
      .replace(/\bannounce\(/g, 'window.__ai4a11yAnnounce(')
      // Replace registerSweep( calls
      .replace(/\bregisterSweep\(/g, 'window.__registerSweep(');

    eval(code); // eslint-disable-line no-eval
    window.__KN = window.__ai4a11yKeyboardNavigator;
  }, tabbableUmdSrc, knSrc);
}

async function main() {
  // Serve fixture files
  const server = http.createServer((req, res) => {
    const filePath = path.join(FIXTURE_DIR, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'page-no-skip.html');
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise(r => server.listen(PORT, r));
  console.log(`Fixture server on http://localhost:${PORT}`);

  // Read source files once
  const tabbableUmdSrc = fs.readFileSync(
    path.resolve(ROOT, 'node_modules/tabbable/dist/index.umd.js'), 'utf8'
  );
  const knSrc = fs.readFileSync(
    path.resolve(ROOT, 'skills/builtin/keyboard-nav.js'), 'utf8'
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // -------------------------------------------------------------------------
    // (a) AX-tree check: badges should not appear in the accessibility tree
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-a]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      await page.evaluate(() => {
        window.__KN.enable();
        window.__KN.showTabSequence();
      });
      await sleep(100);

      // Check AX tree — no node name should be a bare digit string
      const snapshot = await page.accessibility.snapshot();
      function collectNames(node) {
        const names = [];
        if (node && node.name) names.push(node.name);
        if (node && node.children) {
          for (const child of node.children) names.push(...collectNames(child));
        }
        return names;
      }
      const allNames = snapshot ? collectNames(snapshot) : [];
      const badgeInAX = allNames.some(n => /^\d+$/.test(n.trim()));
      check('(a) Badge numbers do not appear in AX tree (aria-hidden works)', !badgeInAX,
        badgeInAX ? `Found digit-only name in AX: ${allNames.filter(n => /^\d+$/.test(n.trim())).join(', ')}` : '');

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (b) Badge order matches tabbable order (positive-tabindex first)
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-b]', e.message));
      await page.goto(`http://localhost:${PORT}/page-with-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      await page.evaluate(() => {
        window.__KN.enable();
        window.__KN.showTabSequence();
      });
      await sleep(100);

      const badgeInfo = await page.evaluate(() => {
        // Get badges in DOM order
        const badges = Array.from(document.querySelectorAll('.ai4a11y-tab-badge'));
        const badgeNumbers = badges.map(b => parseInt(b.textContent, 10));

        // Find positions of positive-tabindex buttons
        const btnFirst = document.getElementById('btn-first');
        const btnSecond = document.getElementById('btn-second');
        const btnThird = document.getElementById('btn-third');

        // Get the tabbable order using the injected tabbable
        const tabbables = window.__tabbable(document.body);
        const firstIdx = tabbables.indexOf(btnFirst);
        const secondIdx = tabbables.indexOf(btnSecond);
        const thirdIdx = tabbables.indexOf(btnThird);

        return {
          badgeCount: badgeNumbers.length,
          sequential: badgeNumbers.every((n, i) => n === i + 1),
          firstIdx,
          secondIdx,
          thirdIdx,
          posTabBeforeNatural: firstIdx < tabbables.indexOf(document.getElementById('text-input')),
        };
      });

      check('(b) Badges are numbered sequentially from 1', badgeInfo.sequential,
        `got ${badgeInfo.badgeCount} badges`);
      check('(b) tabindex=1 element appears before tabindex=2', badgeInfo.firstIdx < badgeInfo.secondIdx,
        `firstIdx=${badgeInfo.firstIdx}, secondIdx=${badgeInfo.secondIdx}`);
      check('(b) tabindex=2 element appears before tabindex=3', badgeInfo.secondIdx < badgeInfo.thirdIdx,
        `secondIdx=${badgeInfo.secondIdx}, thirdIdx=${badgeInfo.thirdIdx}`);
      check('(b) Positive-tabindex elements appear before natural-order elements', badgeInfo.posTabBeforeNatural,
        `firstIdx=${badgeInfo.firstIdx}`);

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (c) Skip link detection
    // -------------------------------------------------------------------------
    {
      // page-with-skip.html: existing skip link detected → NO injection
      const page1 = await browser.newPage();
      page1.on('pageerror', e => console.log('[pageerror-c1]', e.message));
      await page1.goto(`http://localhost:${PORT}/page-with-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page1, tabbableUmdSrc, knSrc);
      await page1.evaluate(() => window.__KN.enable());
      await sleep(50);

      const skipInjected1 = await page1.evaluate(() => !!document.getElementById('ai4a11y-skip-links'));
      check('(c) page-with-skip: adapter does NOT inject skip links when existing skip link found', !skipInjected1,
        skipInjected1 ? 'ai4a11y-skip-links was injected despite existing skip link' : '');
      await page1.close();

      // page-no-skip.html: no existing skip link → injection happens
      const page2 = await browser.newPage();
      page2.on('pageerror', e => console.log('[pageerror-c2]', e.message));
      await page2.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page2, tabbableUmdSrc, knSrc);
      await page2.evaluate(() => window.__KN.enable());
      await sleep(50);

      const skipInjected2 = await page2.evaluate(() => !!document.getElementById('ai4a11y-skip-links'));
      check('(c) page-no-skip: adapter injects skip links when no existing skip link', skipInjected2,
        !skipInjected2 ? 'ai4a11y-skip-links was NOT injected on a page without skip links' : '');
      await page2.close();
    }

    // -------------------------------------------------------------------------
    // (d) Alt+H heading cycling
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-d]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);
      await page.evaluate(() => window.__KN.enable());
      await sleep(50);

      // Dispatch Alt+H (forward) — should focus first heading
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const active1 = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      check('(d) Alt+H focuses a heading', /^h[1-6]$/.test(active1 || ''), `activeElement=${active1}`);

      const heading1Id = await page.evaluate(() => document.activeElement?.textContent?.trim());

      // Dispatch Alt+H again — should focus second heading (not first)
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const active2 = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      const heading2Id = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check('(d) Second Alt+H moves to a different heading', heading1Id !== heading2Id,
        `First: "${heading1Id}", Second: "${heading2Id}"`);

      // Dispatch Shift+Alt+H — should go back to first heading
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: true, code: 'KeyH', key: 'H', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const heading3Text = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check('(d) Shift+Alt+H cycles backward to previous heading', heading3Text === heading1Id,
        `Expected "${heading1Id}", got "${heading3Text}"`);

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (e) AltGr guard + editable guard
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-e]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);
      await page.evaluate(() => window.__KN.enable());
      await sleep(50);

      // AltGr guard: altKey + ctrlKey should not move focus to heading
      await page.evaluate(() => {
        // Focus body first
        document.body.focus();
        const evt = new KeyboardEvent('keydown', {
          altKey: true, ctrlKey: true, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const activeAfterAltGr = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      const isHeadingAfterAltGr = /^h[1-6]$/.test(activeAfterAltGr || '');
      check('(e) AltGr (altKey+ctrlKey) does NOT trigger heading nav', !isHeadingAfterAltGr,
        `activeElement=${activeAfterAltGr}`);

      // Editable guard: focus text input, then dispatch Alt+H — input should keep focus
      await page.evaluate(() => {
        const input = document.getElementById('text-input');
        input.focus();
      });
      await sleep(30);

      await page.evaluate(() => {
        const input = document.getElementById('text-input');
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true,
          target: input
        });
        input.dispatchEvent(evt);
      });
      await sleep(50);

      const activeAfterInputShortcut = await page.evaluate(() => document.activeElement?.id);
      check('(e) Alt+H when input is focused does NOT steal focus from input',
        activeAfterInputShortcut === 'text-input',
        `activeElement id = ${activeAfterInputShortcut}`);

      // Verify input value is unchanged (no side effects)
      const inputVal = await page.evaluate(() => document.getElementById('text-input').value);
      check('(e) Input value unchanged after Alt+H on input', inputVal === '', `value="${inputVal}"`);

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (f) disable() — author tabindex preserved, injected removed, badges gone
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-f]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      // Confirm author-zero has tabindex=0 before enable
      const authorTabBefore = await page.evaluate(() => document.getElementById('author-zero').getAttribute('tabindex'));
      check('(f) #author-zero starts with tabindex="0"', authorTabBefore === '0', `got ${authorTabBefore}`);

      await page.evaluate(() => window.__KN.enable());
      await sleep(50);

      // Use Alt+H to set tabindex on a heading
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      // Show badges too
      await page.evaluate(() => window.__KN.showTabSequence());
      await sleep(50);

      const headingBeforeDisable = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      const headingEl = await page.evaluate(() => document.activeElement?.tagName);
      const badgesBeforeDisable = await page.evaluate(() => document.querySelectorAll('.ai4a11y-tab-badge').length);
      check('(f) Heading is focused and has tabindex before disable', /^h[1-6]$/i.test(headingBeforeDisable || ''), `tag=${headingBeforeDisable}`);
      check('(f) Badges exist before disable', badgesBeforeDisable > 0, `count=${badgesBeforeDisable}`);

      // Record the heading element that got the tabindex
      const headingHadTabindex = await page.evaluate(() => {
        const h = document.activeElement;
        return h ? h.getAttribute('tabindex') : null;
      });
      check('(f) Focused heading has tabindex=-1 set by shortcut', headingHadTabindex === '-1',
        `tabindex=${headingHadTabindex}`);

      // disable()
      await page.evaluate(() => window.__KN.disable());
      await sleep(50);

      // Check: #author-zero still has tabindex="0" (author value preserved)
      const authorTabAfter = await page.evaluate(() => document.getElementById('author-zero').getAttribute('tabindex'));
      check('(f) #author-zero retains tabindex="0" after disable', authorTabAfter === '0',
        `got ${authorTabAfter}`);

      // Check: heading that got tabindex="-1" from Alt+H → should now have no tabindex (prior was null)
      const headingTabAfter = await page.evaluate(() => {
        const h = document.querySelector('h1, h2, h3, h4, h5, h6');
        // Find which heading was focused (the one that got tabindex=-1)
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
        // Look for any heading that has a tabindex (shouldn't have one after restore)
        const withTab = headings.filter(h => h.hasAttribute('tabindex'));
        return withTab.map(h => h.getAttribute('tabindex'));
      });
      check('(f) Heading tabindex removed after disable (prior was null)', headingTabAfter.length === 0,
        `remaining tabindexes on headings: ${JSON.stringify(headingTabAfter)}`);

      // Check: no badges in DOM
      const badgesAfterDisable = await page.evaluate(() => document.querySelectorAll('.ai4a11y-tab-badge').length);
      check('(f) No badge elements remain after disable', badgesAfterDisable === 0,
        `found ${badgesAfterDisable} badges`);

      // Check: Alt+H does nothing after disable (shortcut removed)
      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const activeAfterDisabledShortcut = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
      check('(f) Alt+H does nothing after disable', !/^h[1-6]$/.test(activeAfterDisabledShortcut || ''),
        `focused: ${activeAfterDisabledShortcut}`);

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (g) Enable/disable twice is idempotent
    // -------------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-g]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-skip.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      // enable() twice
      await page.evaluate(() => {
        window.__KN.enable();
        window.__KN.enable(); // second call should be a no-op
      });
      await sleep(50);

      // Dispatch Alt+H once — heading should change exactly once
      const headingsBefore = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.textContent.trim());
      });

      await page.evaluate(() => {
        const evt = new KeyboardEvent('keydown', {
          altKey: true, shiftKey: false, code: 'KeyH', key: 'h', bubbles: true
        });
        document.dispatchEvent(evt);
      });
      await sleep(50);

      const activeAfterDoubleEnable = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check('(g) enable() twice: Alt+H focuses heading (listener works)', /\S/.test(activeAfterDoubleEnable || ''),
        `activeElement text: "${activeAfterDoubleEnable}"`);

      // Check that only one listener fired: if two listeners were registered, the heading
      // would jump to the second heading (first fires: idx 0→first, second fires: idx 1→second).
      // We verify active heading is the FIRST heading (index 0).
      const firstHeading = headingsBefore[0];
      check('(g) enable() twice: only one listener fires (active is first heading, not second)',
        activeAfterDoubleEnable === firstHeading,
        `expected "${firstHeading}", got "${activeAfterDoubleEnable}"`);

      // disable() twice — should not throw and DOM should be clean
      let disableError = null;
      await page.evaluate(() => {
        try {
          window.__KN.disable();
          window.__KN.disable(); // second call should be a no-op
          window.__disableOk = true;
        } catch (e) {
          window.__disableError = e.message;
          window.__disableOk = false;
        }
      });

      const disableOk = await page.evaluate(() => window.__disableOk);
      const disableErrMsg = await page.evaluate(() => window.__disableError);
      check('(g) disable() twice does not throw', disableOk === true,
        disableErrMsg || 'unknown error');

      const styleAfterDouble = await page.evaluate(() => !!document.getElementById('ai4a11y-keyboard-nav-styles'));
      check('(g) Style element removed after double disable', !styleAfterDouble, 'style still present');

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (h) disable() removes injected ids on main/nav — but only when WE set them
    //     (#3: enable→disable without clicking a skip link)
    // -------------------------------------------------------------------------
    {
      // page-no-ids.html: main and nav have no id → keyboard-nav injects them.
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-h]', e.message));
      await page.goto(`http://localhost:${PORT}/page-no-ids.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      // Verify main/nav have no id before enable.
      const idsBefore = await page.evaluate(() => ({
        main: document.querySelector('main')?.id || null,
        nav: document.querySelector('nav')?.id || null,
      }));
      check('(h) main has no id before enable', !idsBefore.main, `got "${idsBefore.main}"`);
      check('(h) nav has no id before enable', !idsBefore.nav, `got "${idsBefore.nav}"`);

      // enable() — skip links will be created, injecting ids on main and nav.
      await page.evaluate(() => window.__KN.enable());
      await sleep(50);

      const idsAfterEnable = await page.evaluate(() => ({
        main: document.querySelector('main')?.id || null,
        nav: document.querySelector('nav')?.id || null,
        skipLinksPresent: !!document.getElementById('ai4a11y-skip-links'),
      }));
      check('(h) main gets ai4a11y-main-content id after enable', idsAfterEnable.main === 'ai4a11y-main-content', idsAfterEnable.main);
      check('(h) nav gets ai4a11y-nav id after enable', idsAfterEnable.nav === 'ai4a11y-nav', idsAfterEnable.nav);
      check('(h) skip links container injected', idsAfterEnable.skipLinksPresent);

      // disable() WITHOUT clicking any skip link — the injected ids must be removed.
      await page.evaluate(() => window.__KN.disable());
      await sleep(50);

      const idsAfterDisable = await page.evaluate(() => ({
        main: document.querySelector('main')?.getAttribute('id'),
        nav: document.querySelector('nav')?.getAttribute('id'),
        skipLinksPresent: !!document.getElementById('ai4a11y-skip-links'),
      }));
      check('(h) main id removed after disable (injected id cleaned up)',
        idsAfterDisable.main === null, `got "${idsAfterDisable.main}"`);
      check('(h) nav id removed after disable (injected id cleaned up)',
        idsAfterDisable.nav === null, `got "${idsAfterDisable.nav}"`);
      check('(h) skip links container removed after disable', !idsAfterDisable.skipLinksPresent);

      await page.close();
    }

    // -------------------------------------------------------------------------
    // (i) disable() does NOT clobber a pre-existing id on main (#3 guard)
    // -------------------------------------------------------------------------
    {
      // page-existing-id.html: <main id="existing"> — keyboard-nav must leave it.
      const page = await browser.newPage();
      page.on('pageerror', e => console.log('[pageerror-i]', e.message));
      await page.goto(`http://localhost:${PORT}/page-existing-id.html`, { waitUntil: 'domcontentloaded' });
      await injectKeyboardNav(page, tabbableUmdSrc, knSrc);

      const idBefore = await page.evaluate(() => document.querySelector('main')?.id);
      check('(i) main starts with id="existing"', idBefore === 'existing', `got "${idBefore}"`);

      await page.evaluate(() => window.__KN.enable());
      await sleep(50);

      // main already had an id so keyboard-nav should NOT overwrite it.
      const idAfterEnable = await page.evaluate(() => document.querySelector('main')?.id);
      check('(i) main id unchanged after enable (was not injected)',
        idAfterEnable === 'existing', `got "${idAfterEnable}"`);

      await page.evaluate(() => window.__KN.disable());
      await sleep(50);

      // After disable the id should still be 'existing' (we never owned it).
      const idAfterDisable = await page.evaluate(() => document.querySelector('main')?.id);
      check('(i) pre-existing id="existing" preserved after disable',
        idAfterDisable === 'existing', `got "${idAfterDisable}"`);

      await page.close();
    }

    // Summary
    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    console.log(`\n=== keyboard-e2e: ${passed}/${total} passed ===`);
    if (passed < total) process.exitCode = 1;

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => {
  console.error('keyboard-e2e fatal:', e);
  process.exit(1);
});
