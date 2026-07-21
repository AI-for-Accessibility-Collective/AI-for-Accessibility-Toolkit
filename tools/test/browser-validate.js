// REAL-BROWSER validation — launches actual headless Chromium (via Playwright),
// loads a real page with real layout + CSS cascade, injects the shipped adapter
// bundle (cli/cli-tools.bundle.js → window.ai4a11y), and asserts each adapter's
// REAL effect and its exact reversal. This is the layer jsdom can't cover: real
// getComputedStyle, real animation, real fixed-positioning, real font sizing.
//
// Local only (needs a Chromium download); not in CI. Run after `npm run build`:
//   node tools/test/browser-validate.js
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, '..', '..', 'cli', 'cli-tools.bundle.js');

const PAGE = `<!DOCTYPE html><html><head><style>
  @keyframes aa-spin { to { transform: rotate(360deg); } }
  #anim { animation: aa-spin 2s linear infinite; }
  body { font-size: 16px; }
</style></head><body>
  <div id="cookie" class="cookie-banner" style="position:fixed; bottom:0; left:0;">We use cookies <button>OK</button></div>
  <header id="hdr" style="position:fixed; top:0; left:0;">Sticky header</header>
  <main>
    <h1>Main Title</h1>
    <h2>Section A</h2>
    <h2>Section B</h2>
    <p>Body text with a <a id="lnk" href="https://docs.example.org/guide">documentation link</a> in it.</p>
    <button id="btn" style="width:18px; height:16px; padding:0;">x</button>
    <div id="anim">spinning</div>
  </main>
</body></html>`;

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent(PAGE, { waitUntil: 'load' });
  await page.addScriptTag({ path: BUNDLE });
  const ready = await page.evaluate(() => typeof window.ai4a11y?.enableTool === 'function');
  check('bundle injected: window.ai4a11y.enableTool present', ready);

  const enable = (name, opts) => page.evaluate(([n, o]) => window.ai4a11y.enableTool(n, o || {}), [name, opts]);
  const disable = (name) => page.evaluate((n) => window.ai4a11y.disableTool(n), name);
  const css = (sel, prop) => page.evaluate(([s, p]) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; }, [sel, prop]);
  const exists = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);
  const attr = (sel, a) => page.evaluate(([s, at]) => document.querySelector(s)?.getAttribute(at), [sel, a]);
  const height = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().height : -1; }, sel);

  // ── Bigger Click Targets — REAL layout: the tiny button grows to ≥44px ──────
  {
    const before = await height('#btn');
    await enable('bigTargets');
    const after = await height('#btn');
    check(`big-targets: tiny button (${Math.round(before)}px) grows to ≥44px (real layout: ${Math.round(after)}px)`, before < 44 && after >= 44);
    await disable('bigTargets');
    check('big-targets: button height reverts after disable', Math.round(await height('#btn')) === Math.round(before));
  }

  // ── Dismiss Overlays — REAL: the fixed cookie banner is display:none ─────────
  {
    check('overlays: fixed cookie banner is visible before', (await css('#cookie', 'display')) !== 'none');
    await enable('dismissOverlays');
    check('overlays: fixed cookie banner becomes display:none', (await css('#cookie', 'display')) === 'none');
    await disable('dismissOverlays');
    check('overlays: cookie banner is shown again after disable', (await css('#cookie', 'display')) !== 'none');
  }

  // ── Link Highlighter — REAL computed underline + destination title ──────────
  {
    await enable('highlightLinks');
    const deco = await css('#lnk', 'textDecorationLine');
    check('links: link is really underlined (computed text-decoration)', (deco || '').includes('underline'));
    check('links: link gets its destination host as a title', (await attr('#lnk', 'title') || '').includes('docs.example.org'));
    await disable('highlightLinks');
    check('links: the added title is removed after disable', (await attr('#lnk', 'title')) == null);
  }

  // ── Page Outline — REAL injected nav listing the headings ───────────────────
  {
    await enable('pageOutline');
    check('outline: an on-page navigator is injected', await exists('#ai4a11y-page-outline'));
    const links = await page.evaluate(() => document.querySelectorAll('#ai4a11y-page-outline a').length);
    check('outline: it lists one link per heading (h1 + 2×h2 = 3)', links === 3);
    await disable('pageOutline');
    check('outline: the navigator is removed after disable', !(await exists('#ai4a11y-page-outline')));
  }

  // ── Motion Reducer — REAL: the spinning element's animation is neutralized ──
  {
    check('motion: element is really animating before (2s duration)', (await css('#anim', 'animationDuration')) === '2s');
    await enable('motionReducer');
    const dur = await css('#anim', 'animationDuration');
    check(`motion: animation duration collapses to ~0 (was 2s, now ${dur})`, dur !== '2s' && parseFloat(dur) < 0.01);
    await disable('motionReducer');
    check('motion: animation is restored after disable', (await css('#anim', 'animationDuration')) === '2s');
  }

  // ── Keyboard Nav — REAL: skip-links injected then removed ───────────────────
  {
    await enable('keyboardNav');
    check('keyboard-nav: skip-links are injected into the page', await exists('#ai4a11y-skip-links'));
    await disable('keyboardNav');
    check('keyboard-nav: skip-links are removed after disable', !(await exists('#ai4a11y-skip-links')));
  }

  // ── Bionic Reading — REAL: word-starts wrapped in <b> in the body text ──────
  {
    const textBefore = await page.evaluate(() => document.querySelector('main p').textContent);
    await enable('bionicReading');
    const bolds = await page.evaluate(() => document.querySelectorAll('main .ai4a11y-bionic b').length);
    check('bionic: word-starts are really bolded in the body text', bolds > 0);
    await disable('bionicReading');
    check('bionic: all bolding removed after disable', (await page.evaluate(() => document.querySelectorAll('.ai4a11y-bionic').length)) === 0);
    check('bionic: the visible text is unchanged after the round-trip',
      (await page.evaluate(() => document.querySelector('main p').textContent)) === textBefore);
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed  (real headless Chromium)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
