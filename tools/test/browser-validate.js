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
    <h1>Documentation Overview</h1>
    <h2>Section A</h2>
    <h2>Section B</h2>
    <p>Body text with a <a id="lnk" href="https://docs.example.org/guide">documentation link</a> in it.</p>
    <button id="btn" style="width:18px; height:16px; padding:0;">x</button>
    <div id="anim">spinning</div>
    <div class="carousel" id="car" style="animation: aa-spin 3s linear infinite;">carousel</div>
    <video id="vid" muted="false"></video>
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

  // ── Unpin Sticky Bars — REAL: the fixed header becomes position:static ──────
  {
    check('unpin: the header is really position:fixed before', (await css('#hdr', 'position')) === 'fixed');
    await enable('unpinSticky');
    check('unpin: the fixed header becomes position:static', (await css('#hdr', 'position')) === 'static');
    await disable('unpinSticky');
    check('unpin: the header is fixed again after disable', (await css('#hdr', 'position')) === 'fixed');
  }

  // ── Mute Sounds — REAL: the video's .muted property flips and reverts ───────
  {
    await page.evaluate(() => { document.querySelector('#vid').muted = false; });
    await enable('muteSounds');
    check('mute: the video is really muted', await page.evaluate(() => document.querySelector('#vid').muted === true));
    await disable('muteSounds');
    check('mute: the video is unmuted again after disable', await page.evaluate(() => document.querySelector('#vid').muted === false));
  }

  // ── Translate Page (AI) — REAL end-to-end with a STUBBED model injected as the
  // same window.ai4a11y_* callback the CLI uses. Validates the full path (real
  // DOM text replaced, inline link preserved, exact restore); only the real
  // Gemini OUTPUT quality needs a live key, which this can't assert. ──────────
  {
    await page.evaluate(() => { window.ai4a11y_translateText = (text, lang) => `[${lang}] ${text}`; });
    const before = await page.evaluate(() => document.querySelector('main p').textContent);
    await enable('translatePage', { targetLang: 'Spanish' });
    await page.waitForFunction(() => document.querySelector('main p').textContent.startsWith('[Spanish]'), { timeout: 5000 });
    check('translate: real page text is replaced by the (stubbed) translation', true);
    await disable('translatePage');
    check('translate: original text restored AND the inline link survives', (await page.evaluate(() => document.querySelector('main p').textContent)) === before && (await exists('#lnk')));
  }

  // ── Define Words (AI) — REAL: wrapping (AI-free) PLUS the hover→definition
  // path driven by a stubbed model injected as window.ai4a11y_defineWord. ─────
  {
    await page.evaluate(() => { window.ai4a11y_defineWord = () => 'a simple meaning'; });
    await enable('defineWords');
    const wrapped = await page.evaluate(() => document.querySelectorAll('.ai4a11y-define').length);
    check('define: long words are really wrapped as interactive spans', wrapped > 0);
    check('define: a wrapped word carries define affordances (role/tabindex)', await page.evaluate(() => {
      const s = document.querySelector('.ai4a11y-define');
      return !!s && s.getAttribute('role') === 'button' && s.getAttribute('tabindex') === '0';
    }));
    const tipShown = await page.evaluate(async () => {
      const s = document.querySelector('.ai4a11y-define');
      s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      const tip = document.getElementById('ai4a11y-define-tooltip');
      return !!tip && tip.textContent.includes('a simple meaning');
    });
    check('define: hovering a word really shows the AI definition (real browser, stubbed model)', tipShown);
    await disable('defineWords');
    check('define: word wrapping + tooltip removed after disable',
      (await page.evaluate(() => document.querySelectorAll('.ai4a11y-define').length)) === 0 &&
      !(await exists('#ai4a11y-define-tooltip')));
  }

  // ── Stop Auto-Advance — REAL: a carousel's animation pauses and resumes ─────
  {
    // Reset any inline pause an earlier adapter's async pass may have left on
    // this shared element, so we start from a known "running" state.
    await page.evaluate(() => { document.querySelector('#car').style.animationPlayState = 'running'; });
    check('autoadvance: carousel is really animating before', (await css('#car', 'animationPlayState')) === 'running');
    await enable('stopAutoAdvance');
    check('autoadvance: carousel animation is paused', (await css('#car', 'animationPlayState')) === 'paused');
    await disable('stopAutoAdvance');
    check('autoadvance: carousel animation resumes after disable', (await css('#car', 'animationPlayState')) === 'running');
  }

  // ── Reduce Brightness — REAL: a computed filter is applied to <html> ────────
  {
    check('brightness: no page filter before', (await css('html', 'filter')) === 'none');
    await enable('reduceBrightness');
    const filt = await css('html', 'filter');
    check(`brightness: a real brightness/saturate filter is applied (${filt})`, filt !== 'none' && /brightness|matrix/.test(filt));
    check('brightness: a dimming overlay is added', await exists('#ai4a11y-dim-overlay'));
    await disable('reduceBrightness');
    check('brightness: filter and overlay removed after disable', (await css('html', 'filter')) === 'none' && !(await exists('#ai4a11y-dim-overlay')));
  }

  // ── Sound Visualizer — REAL: playing sound flashes a visible indicator ──────
  {
    await page.evaluate(() => { const v = document.querySelector('#vid'); v.muted = false; v.volume = 1; });
    await enable('soundVisualizer');
    const shown = await page.evaluate(async () => {
      document.querySelector('#vid').dispatchEvent(new Event('play', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      const ind = document.getElementById('ai4a11y-sound-indicator');
      return !!ind && getComputedStyle(ind).display !== 'none';
    });
    check('sound-viz: playing sound really flashes a visual indicator', shown);
    await disable('soundVisualizer');
    check('sound-viz: indicator removed after disable', !(await exists('#ai4a11y-sound-indicator')));
  }

  // ── Live-Region Announcer — REAL: a dynamic update is mirrored to a live region
  {
    await enable('announceUpdates');
    check('live-region: a polite aria-live region is created', await page.evaluate(() => {
      const r = document.getElementById('ai4a11y-live-region');
      return !!r && r.getAttribute('aria-live') === 'polite';
    }));
    const announced = await page.evaluate(async () => {
      const d = document.createElement('div');
      d.textContent = 'New search results loaded';
      document.querySelector('main').appendChild(d);
      await new Promise((r) => setTimeout(r, 500));
      return document.getElementById('ai4a11y-live-region')?.textContent || '';
    });
    check('live-region: a dynamic content update is mirrored into the live region', announced.includes('New search results'));
    await disable('announceUpdates');
    check('live-region: the live region is removed after disable', !(await exists('#ai4a11y-live-region')));
  }

  // ── Magnifier — REAL: lens appears and shows text under the cursor ──────────
  {
    await enable('magnifier');
    check('magnifier: a lens element is created', await exists('#ai4a11y-magnifier'));
    const box = await page.evaluate(() => { const r = document.querySelector('main p').getBoundingClientRect(); return { x: r.x + 8, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    const shows = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 80));
      const l = document.getElementById('ai4a11y-magnifier');
      return !!l && getComputedStyle(l).display !== 'none' && l.textContent.trim().length > 0;
    });
    check('magnifier: moving the cursor shows magnified text of the element under it', shows);
    await disable('magnifier');
    check('magnifier: lens removed after disable', !(await exists('#ai4a11y-magnifier')));
  }

  // ── Flash Guard — REAL: video gets a dimming filter + autoplay removed ──────
  {
    await page.evaluate(() => { document.querySelector('#vid').setAttribute('autoplay', ''); });
    await enable('flashGuard');
    const filt = await css('#vid', 'filter');
    check(`flash-guard: video gets a reduced-brightness filter (${filt})`, filt !== 'none' && /brightness|matrix/.test(filt));
    check('flash-guard: autoplay is removed from the video', await page.evaluate(() => !document.querySelector('#vid').hasAttribute('autoplay')));
    await disable('flashGuard');
    check('flash-guard: filter removed after disable', (await css('#vid', 'filter')) === 'none');
  }

  // ── Describe on Demand (AI) — REAL: Alt+D describes the focused element ──────
  {
    await page.evaluate(() => { window.ai4a11y_summarizeText = () => 'a short plain summary'; });
    await enable('describeOnDemand');
    check('describe: enable creates the screen-reader live region', await exists('#ai4a11y-describe-live'));
    const shown = await page.evaluate(async () => {
      const p = document.createElement('p');
      p.id = 'desc-long'; p.setAttribute('tabindex', '-1');
      p.textContent = 'This is a deliberately long paragraph of text that comfortably exceeds the sixty-character threshold so the describe adapter routes it to the summarizer.';
      document.querySelector('main').appendChild(p);
      p.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', altKey: true }));
      await new Promise((r) => setTimeout(r, 80));
      const panel = document.getElementById('ai4a11y-describe-panel');
      return !!panel && panel.style.display === 'block' && panel.textContent.includes('short plain summary');
    });
    check('describe: Alt+D describes the focused element via the (stubbed) model', shown);
    await disable('describeOnDemand');
    check('describe: panel + live region removed after disable', !(await exists('#ai4a11y-describe-panel')) && !(await exists('#ai4a11y-describe-live')));
  }

  // ── Reflow to Column — REAL: body is constrained to a single narrow column ──
  {
    await enable('reflowColumn');
    const mw = await css('body', 'maxWidth');
    check(`reflow: body is capped to a readable column width (${mw})`, mw !== 'none' && parseInt(mw, 10) > 0 && parseInt(mw, 10) <= 900);
    await disable('reflowColumn');
    check('reflow: body width cap removed after disable', (await css('body', 'maxWidth')) === 'none');
  }

  // ── Focus Locator — REAL: a focus ring appears on the focused element ───────
  {
    await enable('focusLocator');
    check('focus-locator: injects a strong focus-outline style + a ring element', await page.evaluate(() =>
      !!document.getElementById('ai4a11y-focus-locator-styles') && !!document.getElementById('ai4a11y-focus-ring')));
    const ringShown = await page.evaluate(async () => {
      document.querySelector('#btn').focus();
      document.querySelector('#btn').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const ring = document.getElementById('ai4a11y-focus-ring');
      return !!ring && getComputedStyle(ring).display !== 'none';
    });
    check('focus-locator: the ring shows when an element is focused', ringShown);
    await disable('focusLocator');
    check('focus-locator: style + ring removed after disable', !(await exists('#ai4a11y-focus-ring')) && !(await exists('#ai4a11y-focus-locator-styles')));
  }

  // ── Persistent Hover — REAL: a title tooltip appears and survives, then Escape
  {
    await enable('persistentHover');
    const tipShown = await page.evaluate(async () => {
      const lnk = document.querySelector('#lnk'); lnk.setAttribute('title', 'Opens the documentation');
      lnk.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
      const tip = document.getElementById('ai4a11y-hover-tip');
      return !!tip && getComputedStyle(tip).display !== 'none' && tip.textContent.includes('documentation');
    });
    check('hover: a title tooltip appears and stays visible on hover', tipShown);
    const dismissed = await page.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
      const tip = document.getElementById('ai4a11y-hover-tip');
      return !tip || getComputedStyle(tip).display === 'none';
    });
    check('hover: Escape dismisses the persistent tooltip', dismissed);
    await disable('persistentHover');
    check('hover: tooltip removed after disable', !(await exists('#ai4a11y-hover-tip')));
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed  (real headless Chromium)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
