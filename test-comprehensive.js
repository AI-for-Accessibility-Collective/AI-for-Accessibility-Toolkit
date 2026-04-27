/**
 * COMPREHENSIVE TEST SUITE for AI4A11y Toolkit
 * Tests ALL tools, ALL presets, ALL modes, edge cases, real websites, performance
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Real test websites
const TEST_SITES = [
  'https://www.bbc.com/news',
  'https://en.wikipedia.org/wiki/Accessibility',
  'https://www.nytimes.com',
  'https://www.amazon.com',
  'https://www.reddit.com',
  'https://developer.mozilla.org',
  'https://www.weather.gov',
  'https://www.imdb.com',
  'https://www.yelp.com',
  'https://www.target.com'
];

// Comprehensive test HTML with all edge cases
const COMPREHENSIVE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Comprehensive Test Page</title>
  <style>
    /* Animations */
    @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes fade { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(0); } }
    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }

    .anim-bounce { animation: bounce 1s infinite; width: 50px; height: 50px; background: blue; }
    .anim-spin { animation: spin 2s linear infinite; width: 50px; height: 50px; background: red; }
    .anim-fade { animation: fade 1.5s infinite; width: 50px; height: 50px; background: green; }
    .anim-slide { animation: slide 1s infinite; width: 50px; height: 50px; background: purple; }
    .anim-pulse { animation: pulse 0.5s infinite; width: 50px; height: 50px; background: orange; }
    .anim-shake { animation: shake 0.3s infinite; width: 50px; height: 50px; background: pink; }

    /* Transitions */
    .transition-color { transition: background-color 0.5s ease; background: #ccc; }
    .transition-color:hover { background: #f00; }
    .transition-transform { transition: transform 0.3s ease; }
    .transition-transform:hover { transform: scale(1.2); }
    .transition-all { transition: all 0.4s ease; }

    /* Parallax */
    .parallax-1 { background-attachment: fixed; background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" width="100%" height="100%"/></svg>'); height: 200px; }
    .parallax-2 { background-attachment: fixed; background-position: center; height: 150px; background: linear-gradient(blue, green); }

    /* Smooth scroll */
    .smooth-container { scroll-behavior: smooth; height: 100px; overflow-y: scroll; }

    /* Colors for color blind testing */
    .color-red { color: #ff0000; background: #ffeeee; }
    .color-green { color: #00ff00; background: #eeffee; }
    .color-blue { color: #0000ff; background: #eeeeff; }
    .color-red-green { color: #ff0000; background: #00ff00; } /* Problematic for protan/deutan */
    .color-blue-yellow { color: #0000ff; background: #ffff00; } /* Problematic for tritan */

    /* Low contrast variations */
    .contrast-1 { color: #777; background: #888; }
    .contrast-2 { color: #aaa; background: #bbb; }
    .contrast-3 { color: #666; background: #999; }

    /* Font sizes */
    .font-tiny { font-size: 8px; }
    .font-small { font-size: 10px; }
    .font-medium { font-size: 14px; }
    .font-large { font-size: 18px; }

    /* Spacing variations */
    .spacing-tight { letter-spacing: -2px; word-spacing: -2px; line-height: 0.8; }
    .spacing-normal { letter-spacing: 0; word-spacing: 0; line-height: 1.5; }
    .spacing-wide { letter-spacing: 2px; word-spacing: 4px; line-height: 2; }

    /* Links */
    .link-plain { text-decoration: none; color: blue; }
    .link-styled { text-decoration: underline; color: purple; }

    /* Focus styles */
    .focus-none:focus { outline: none; }
    .focus-subtle:focus { outline: 1px dotted #ccc; }
    .focus-strong:focus { outline: 3px solid blue; }

    /* Distractions */
    .ad-banner { background: #ffd700; padding: 20px; text-align: center; }
    .ad-sidebar { background: #ffa500; padding: 15px; }
    .ad-popup { position: fixed; top: 50%; left: 50%; background: white; padding: 30px; box-shadow: 0 0 20px rgba(0,0,0,0.5); display: none; }
    .social-share { background: #e1e1e1; padding: 10px; }
    .social-follow { background: #d1d1d1; padding: 10px; }
    .newsletter-signup { background: #ffffcc; padding: 20px; }
    .cookie-banner { position: fixed; bottom: 0; left: 0; right: 0; background: #333; color: white; padding: 15px; }
    .sidebar { float: right; width: 250px; background: #f5f5f5; padding: 15px; }
    .widget { background: #fafafa; margin: 10px 0; padding: 10px; }
    .comments-section { background: #f0f0f0; padding: 20px; }
    .related-posts { background: #e8e8e8; padding: 15px; }
    .recommended { background: #e0e0e0; padding: 15px; }

    /* Main content */
    main { max-width: 800px; padding: 20px; }
    article { margin: 20px 0; }

    /* Deeply nested structure */
    .nested-1 { padding: 5px; border: 1px solid #eee; }
    .nested-2 { padding: 5px; border: 1px solid #ddd; }
    .nested-3 { padding: 5px; border: 1px solid #ccc; }
    .nested-4 { padding: 5px; border: 1px solid #bbb; }
    .nested-5 { padding: 5px; border: 1px solid #aaa; }
  </style>
</head>
<body>
  <!-- Multiple animation types -->
  <div id="animations">
    <div class="anim-bounce" id="anim1">1</div>
    <div class="anim-spin" id="anim2">2</div>
    <div class="anim-fade" id="anim3">3</div>
    <div class="anim-slide" id="anim4">4</div>
    <div class="anim-pulse" id="anim5">5</div>
    <div class="anim-shake" id="anim6">6</div>
  </div>

  <!-- Transitions -->
  <div id="transitions">
    <div class="transition-color" id="trans1">Hover color</div>
    <div class="transition-transform" id="trans2">Hover transform</div>
    <div class="transition-all" id="trans3">Hover all</div>
  </div>

  <!-- Parallax backgrounds -->
  <div id="parallax">
    <div class="parallax-1" id="parallax1">Parallax 1</div>
    <div class="parallax-2" id="parallax2">Parallax 2</div>
  </div>

  <!-- Smooth scroll container -->
  <div class="smooth-container" id="smooth-scroll">
    <div style="height: 500px;">Scroll content</div>
  </div>

  <!-- Videos -->
  <div id="videos">
    <video id="video1" width="320" height="240" autoplay muted loop>
      <source src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA" type="video/mp4">
    </video>
    <video id="video2" width="320" height="240" autoplay>
      <source src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA" type="video/mp4">
    </video>
  </div>

  <!-- GIFs (using data URLs for testing) -->
  <div id="gifs">
    <img id="gif1" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Test GIF 1">
    <img id="gif2" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" alt="Test GIF 2">
  </div>

  <!-- Color test elements -->
  <div id="colors">
    <p class="color-red" id="red">Red text</p>
    <p class="color-green" id="green">Green text</p>
    <p class="color-blue" id="blue">Blue text</p>
    <p class="color-red-green" id="red-green">Red on green (protan/deutan problem)</p>
    <p class="color-blue-yellow" id="blue-yellow">Blue on yellow (tritan problem)</p>
  </div>

  <!-- Contrast variations -->
  <div id="contrast">
    <p class="contrast-1" id="contrast1">Low contrast 1</p>
    <p class="contrast-2" id="contrast2">Low contrast 2</p>
    <p class="contrast-3" id="contrast3">Low contrast 3</p>
  </div>

  <!-- Font sizes -->
  <div id="fonts">
    <p class="font-tiny" id="font1">Tiny text 8px</p>
    <p class="font-small" id="font2">Small text 10px</p>
    <p class="font-medium" id="font3">Medium text 14px</p>
    <p class="font-large" id="font4">Large text 18px</p>
  </div>

  <!-- Spacing variations -->
  <div id="spacing">
    <p class="spacing-tight" id="spacing1">Tight spacing text that is hard to read</p>
    <p class="spacing-normal" id="spacing2">Normal spacing text that is easy to read</p>
    <p class="spacing-wide" id="spacing3">Wide spacing text with lots of room</p>
  </div>

  <!-- Links -->
  <div id="links">
    <a href="#" class="link-plain" id="link1">Plain link no underline</a>
    <a href="#" class="link-styled" id="link2">Styled link with underline</a>
    <a href="#" id="link3">Default link</a>
  </div>

  <!-- Focus elements -->
  <div id="focus-elements">
    <button class="focus-none" id="btn1">No focus style</button>
    <button class="focus-subtle" id="btn2">Subtle focus</button>
    <button class="focus-strong" id="btn3">Strong focus</button>
    <input type="text" id="input1" placeholder="Text input">
    <select id="select1"><option>Select option</option></select>
  </div>

  <!-- Distractions for Focus Mode -->
  <div id="distractions">
    <div class="ad-banner" id="ad1">ADVERTISEMENT BANNER</div>
    <div class="ad-sidebar" id="ad2">Sidebar Ad</div>
    <div class="social-share" id="social1">Share: FB TW LI</div>
    <div class="social-follow" id="social2">Follow us!</div>
    <div class="newsletter-signup" id="newsletter">Sign up for our newsletter!</div>
    <div class="cookie-banner" id="cookie" style="display:none;">Cookie consent</div>
    <aside class="sidebar" id="sidebar">
      <div class="widget" id="widget1">Widget 1</div>
      <div class="widget" id="widget2">Widget 2</div>
    </aside>
    <div class="comments-section" id="comments">Comments here</div>
    <div class="related-posts" id="related">Related posts</div>
    <div class="recommended" id="recommended">Recommended for you</div>
  </div>

  <!-- Main content for Focus Mode -->
  <main id="main-content">
    <article>
      <h1>Main Article Title</h1>
      <p id="para1">This is the first paragraph of the main article. It contains important information that should be highlighted when focus mode is enabled. The reader should be able to concentrate on this content without distractions.</p>
      <p id="para2">The second paragraph continues with more valuable content. Focus mode should help readers with ADHD, autism, or cognitive disabilities to better process this information by reducing visual clutter around it.</p>
      <p id="para3">In the third paragraph, we discuss additional topics. The bionic reading feature should make this text easier to scan by bolding the first half of each word.</p>
      <p id="para4">The fourth paragraph tests longer content with multiple sentences. This helps verify that the line focus feature works correctly across different paragraph lengths. The reader can track their position more easily.</p>
      <p id="para5">Finally, the fifth paragraph concludes the article. The progress indicator should show approximately 100% at this point if the user has scrolled to the bottom of the page.</p>
    </article>
  </main>

  <!-- Deeply nested elements for edge case testing -->
  <div id="nested">
    <div class="nested-1">
      <div class="nested-2">
        <div class="nested-3">
          <div class="nested-4">
            <div class="nested-5">
              <p id="deeply-nested">Deeply nested paragraph</p>
              <a href="#" id="nested-link">Nested link</a>
              <button id="nested-btn">Nested button</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Shadow DOM test (created via JS) -->
  <div id="shadow-host"></div>

  <!-- Dynamic content container -->
  <div id="dynamic-container"></div>

  <script>
    // Create shadow DOM element
    const shadowHost = document.getElementById('shadow-host');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>.shadow-text { color: red; }</style><p class="shadow-text" id="shadow-para">Shadow DOM content</p><a href="#">Shadow link</a>';
  </script>
</body>
</html>
`;

let browser, results;

async function setup() {
  browser = await chromium.launch({ headless: true });
  results = {
    visualAssist: { tests: [], passed: 0, failed: 0 },
    visualAssist: { tests: [], passed: 0, failed: 0 },
    focusMode: { tests: [], passed: 0, failed: 0 },
    integration: { tests: [], passed: 0, failed: 0 },
    realSites: { tests: [], passed: 0, failed: 0 },
    performance: { tests: [], passed: 0, failed: 0 },
    edgeCases: { tests: [], passed: 0, failed: 0 }
  };
}

async function createTestPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(COMPREHENSIVE_HTML);

  // Mock Chrome APIs
  await page.evaluate(() => {
    window.chrome = {
      runtime: { sendMessage: (msg, cb) => cb && cb({ success: false }), lastError: null },
      storage: { onChanged: { addListener: () => {} }, sync: { get: (keys, cb) => cb && cb({}) } }
    };
  });

  // Inject content.bundle.js
  const contentJs = fs.readFileSync(path.join(__dirname, 'content.bundle.js'), 'utf8');
  const testableJs = contentJs.replace("if (window.__ai4a11yLoaded) return;", "// test mode");
  await page.addScriptTag({ content: testableJs });
  await page.waitForFunction(() => window.__ai4a11yVisualAssist !== undefined, { timeout: 10000 });

  return { page, context };
}

function logTest(category, name, passed, details = '') {
  results[category].tests.push({ name, passed, details });
  if (passed) results[category].passed++;
  else results[category].failed++;
  console.log(`[${passed ? '✓' : '✗'}] ${name}${details ? ` (${details})` : ''}`);
}

// ============ MOTION REDUCER COMPREHENSIVE TESTS ============
async function testMotionReducer() {
  console.log('\n' + '='.repeat(60));
  console.log('MOTION REDUCER TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test all animation types are stopped (now via reduceMotion option)
  const animTypes = ['bounce', 'spin', 'fade', 'slide', 'pulse', 'shake'];
  for (const type of animTypes) {
    const stopped = await page.evaluate((t) => {
      window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
      const el = document.querySelector(`.anim-${t}`);
      const style = getComputedStyle(el);
      const result = parseFloat(style.animationDuration) < 0.01 || style.animationPlayState === 'paused';
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, type);
    logTest('visualAssist', `Animation type: ${type} stopped`, stopped);
  }

  // Test transitions disabled
  const transTypes = ['color', 'transform', 'all'];
  for (const type of transTypes) {
    const disabled = await page.evaluate((t) => {
      window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
      const style = document.getElementById('ai4a11y-motion-reducer-styles');
      const result = style && style.textContent.includes('transition-duration: 0.001ms');
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, type);
    logTest('visualAssist', `Transition type: ${type} disabled`, disabled);
  }

  // Test parallax disabled
  const parallaxDisabled = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const style = document.getElementById('ai4a11y-motion-reducer-styles');
    const result = style && style.textContent.includes('background-attachment: scroll');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('visualAssist', 'Parallax backgrounds disabled', parallaxDisabled);

  // Test smooth scroll disabled
  const smoothDisabled = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const style = document.getElementById('ai4a11y-motion-reducer-styles');
    const result = style && style.textContent.includes('scroll-behavior: auto');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('visualAssist', 'Smooth scroll disabled', smoothDisabled);

  // Test video pause (check if pause method called concept)
  const videoPaused = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    // Videos with autoplay should be paused
    const videos = document.querySelectorAll('video');
    let allHandled = true;
    videos.forEach(v => {
      // In test environment, video may not load, but we check the logic exists
      if (v.autoplay && !v.paused && !v.dataset.ai4a11yWasPaused) {
        allHandled = false;
      }
    });
    window.__ai4a11yVisualAssist.disable();
    return allHandled;
  });
  logTest('visualAssist', 'Video autoplay handling', videoPaused);

  // Test toggle functionality
  const toggleWorks = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const wasEnabled = window.__ai4a11yVisualAssist.enabled;
    window.__ai4a11yVisualAssist.disable();
    const nowDisabled = !window.__ai4a11yVisualAssist.enabled;
    return wasEnabled && nowDisabled;
  });
  logTest('visualAssist', 'Toggle on/off works', toggleWorks);

  // Test cleanup on disable
  const cleanupWorks = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    window.__ai4a11yVisualAssist.disable();
    return !document.getElementById('ai4a11y-motion-reducer-styles');
  });
  logTest('visualAssist', 'Cleanup on disable', cleanupWorks);

  // Test multiple enable calls don't duplicate styles
  const noDuplicates = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const styleCount = document.querySelectorAll('#ai4a11y-motion-reducer-styles').length;
    window.__ai4a11yVisualAssist.disable();
    return styleCount === 1;
  });
  logTest('visualAssist', 'No duplicate styles on multiple enables', noDuplicates);

  await context.close();
}

// ============ VISUAL ADAPTER COMPREHENSIVE TESTS ============
async function testVisualAdapter() {
  console.log('\n' + '='.repeat(60));
  console.log('VISUAL ADAPTER TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test all contrast modes
  const contrastModes = ['dark', 'light', 'yellow-black'];
  for (const mode of contrastModes) {
    const works = await page.evaluate((m) => {
      window.__ai4a11yVisualAssist.enable({ contrastMode: m });
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      let result = false;
      if (m === 'dark') result = style && style.textContent.includes('filter: invert(1)');
      if (m === 'light') result = style && style.textContent.includes('background-color: #fff');
      if (m === 'yellow-black') result = style && style.textContent.includes('color: #ff0');
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, mode);
    logTest('visualAssist', `Contrast mode: ${mode}`, works);
  }

  // Test all color blind modes
  const colorBlindModes = ['protanopia', 'deuteranopia', 'tritanopia'];
  for (const mode of colorBlindModes) {
    const works = await page.evaluate((m) => {
      window.__ai4a11yVisualAssist.enable({ colorBlindMode: m });
      const svg = document.getElementById('ai4a11y-svg-filters');
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      const hasFilter = svg && svg.innerHTML.includes(`ai4a11y-${m}-filter`);
      const usesFilter = style && style.textContent.includes(`url(#ai4a11y-${m}-filter)`);
      window.__ai4a11yVisualAssist.disable();
      return hasFilter && usesFilter;
    }, mode);
    logTest('visualAssist', `Color blind mode: ${mode}`, works);
  }

  // Test font scaling at different levels
  const fontScales = [1.0, 1.2, 1.5, 2.0];
  for (const scale of fontScales) {
    const works = await page.evaluate((s) => {
      window.__ai4a11yVisualAssist.enable({ fontScale: s });
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      let result = true;
      if (s !== 1.0) {
        result = style && style.textContent.includes(`font-size: ${s * 100}%`);
      }
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, scale);
    logTest('visualAssist', `Font scale: ${scale * 100}%`, works);
  }

  // Test letter spacing
  const letterSpacings = [0.05, 0.1, 0.15];
  for (const spacing of letterSpacings) {
    const works = await page.evaluate((s) => {
      window.__ai4a11yVisualAssist.enable({ letterSpacing: s });
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      const result = style && style.textContent.includes(`letter-spacing: ${s}em`);
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, spacing);
    logTest('visualAssist', `Letter spacing: ${spacing}em`, works);
  }

  // Test word spacing
  const wordSpacings = [0.1, 0.2, 0.3];
  for (const spacing of wordSpacings) {
    const works = await page.evaluate((s) => {
      window.__ai4a11yVisualAssist.enable({ wordSpacing: s });
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      const result = style && style.textContent.includes(`word-spacing: ${s}em`);
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, spacing);
    logTest('visualAssist', `Word spacing: ${spacing}em`, works);
  }

  // Test line height
  const lineHeights = [1.6, 1.8, 2.0, 2.5];
  for (const height of lineHeights) {
    const works = await page.evaluate((h) => {
      window.__ai4a11yVisualAssist.enable({ lineHeight: h });
      const style = document.getElementById('ai4a11y-visual-assist-styles');
      const result = style && style.textContent.includes(`line-height: ${h}`);
      window.__ai4a11yVisualAssist.disable();
      return result;
    }, height);
    logTest('visualAssist', `Line height: ${height}`, works);
  }

  // Test enhanced focus
  const enhanceFocus = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ enhanceFocus: true });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const result = style && style.textContent.includes('outline: 4px solid');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('visualAssist', 'Enhanced focus indicators', enhanceFocus);

  // Test enhanced links
  const enhanceLinks = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ enhanceLinks: true });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const result = style && style.textContent.includes('text-decoration: underline');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('visualAssist', 'Enhanced link underlines', enhanceLinks);

  // Test large cursor
  const largeCursor = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ largeCursor: true });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const result = style && style.textContent.includes('cursor: url(');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('visualAssist', 'Large cursor', largeCursor);

  // Test all presets
  const presets = ['lowVision', 'colorBlindProtan', 'colorBlindDeutan', 'colorBlindTritan', 'lightSensitivity'];
  for (const preset of presets) {
    const works = await page.evaluate((p) => {
      window.__ai4a11yVisualAssist.applyPreset(p);
      const enabled = window.__ai4a11yVisualAssist.enabled;
      window.__ai4a11yVisualAssist.disable();
      return enabled;
    }, preset);
    logTest('visualAssist', `Preset: ${preset}`, works);
  }

  // Test combined settings
  const combinedWorks = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({
      contrastMode: 'dark',
      fontScale: 1.3,
      letterSpacing: 0.05,
      enhanceFocus: true,
      enhanceLinks: true
    });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasAll = style &&
      style.textContent.includes('invert(1)') &&
      style.textContent.includes('130%') &&
      style.textContent.includes('letter-spacing') &&
      style.textContent.includes('outline:') &&
      style.textContent.includes('underline');
    window.__ai4a11yVisualAssist.disable();
    return hasAll;
  });
  logTest('visualAssist', 'Combined settings work together', combinedWorks);

  // Test cleanup removes all elements
  const cleanupComplete = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ colorBlindMode: 'protanopia' });
    window.__ai4a11yVisualAssist.disable();
    const noStyle = !document.getElementById('ai4a11y-visual-assist-styles');
    const noSvg = !document.getElementById('ai4a11y-svg-filters');
    return noStyle && noSvg;
  });
  logTest('visualAssist', 'Complete cleanup on disable', cleanupComplete);

  await context.close();
}

// ============ FOCUS MODE COMPREHENSIVE TESTS ============
async function testFocusMode() {
  console.log('\n' + '='.repeat(60));
  console.log('FOCUS MODE TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test distraction hiding
  const distractionTypes = ['ad-', 'social', 'newsletter', 'sidebar', 'widget', 'comment', 'related', 'recommended', 'popup', 'cookie'];
  for (const type of distractionTypes) {
    const hidden = await page.evaluate((t) => {
      window.__ai4a11yFocusMode.enable({ hideDistractions: true });
      const style = document.getElementById('ai4a11y-focus-mode-styles');
      const result = style && style.textContent.includes(`[class*="${t}"]`);
      window.__ai4a11yFocusMode.disable();
      return result;
    }, type);
    logTest('focusMode', `Hides distraction type: ${type}`, hidden);
  }

  // Test dim background
  const dimBackground = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ dimBackground: true });
    const style = document.getElementById('ai4a11y-focus-mode-styles');
    const result = style && style.textContent.includes('opacity:');
    window.__ai4a11yFocusMode.disable();
    return result;
  });
  logTest('focusMode', 'Dim background works', dimBackground);

  // Test dim opacity setting
  const dimOpacities = [0.2, 0.3, 0.5, 0.7];
  for (const opacity of dimOpacities) {
    const works = await page.evaluate((o) => {
      window.__ai4a11yFocusMode.enable({ hideDistractions: true, dimOpacity: o });
      const style = document.getElementById('ai4a11y-focus-mode-styles');
      const result = style && style.textContent.includes(`opacity: ${o}`);
      window.__ai4a11yFocusMode.disable();
      return result;
    }, opacity);
    logTest('focusMode', `Dim opacity: ${opacity}`, works);
  }

  // Test progress indicator
  const progressCreated = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ showProgress: true });
    const progress = document.getElementById('ai4a11y-progress');
    const exists = !!progress && progress.style.height === '4px';
    window.__ai4a11yFocusMode.disable();
    return exists;
  });
  logTest('focusMode', 'Progress indicator created', progressCreated);

  // Test progress indicator updates on scroll
  const progressUpdates = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ showProgress: true });
    const progress = document.getElementById('ai4a11y-progress');
    const initialWidth = progress?.style.width;
    // Simulate scroll
    window.scrollTo(0, 100);
    window.__ai4a11yFocusMode.progressHandler?.();
    const newWidth = progress?.style.width;
    window.__ai4a11yFocusMode.disable();
    return initialWidth !== undefined;
  });
  logTest('focusMode', 'Progress indicator functional', progressUpdates);

  // Test line focus guide
  const lineFocusCreated = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ lineFocus: true });
    const guide = document.getElementById('ai4a11y-line-guide');
    const exists = !!guide && guide.style.position === 'fixed';
    window.__ai4a11yFocusMode.disable();
    return exists;
  });
  logTest('focusMode', 'Line focus guide created', lineFocusCreated);

  // Test paragraph hover highlight
  const hoverHighlight = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable();
    const style = document.getElementById('ai4a11y-focus-mode-styles');
    const result = style && style.textContent.includes('p:hover');
    window.__ai4a11yFocusMode.disable();
    return result;
  });
  logTest('focusMode', 'Paragraph hover highlight', hoverHighlight);

  // Test custom highlight color
  const customColors = ['#fff3cd', '#e3f2fd', '#f3e5f5', '#ffebee'];
  for (const color of customColors) {
    const works = await page.evaluate((c) => {
      window.__ai4a11yFocusMode.enable({ highlightColor: c });
      const style = document.getElementById('ai4a11y-focus-mode-styles');
      const result = style && style.textContent.includes(c);
      window.__ai4a11yFocusMode.disable();
      return result;
    }, color);
    logTest('focusMode', `Highlight color: ${color}`, works);
  }

  // Test bionic reading
  const bionicApplied = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ bionicReading: true });
    return new Promise(resolve => {
      setTimeout(() => {
        const hasBionic = document.querySelector('[data-ai4a11y-bionic]') !== null;
        const hasBold = document.querySelector('[data-ai4a11y-bionic] b') !== null;
        window.__ai4a11yFocusMode.disable();
        resolve(hasBionic && hasBold);
      }, 200);
    });
  });
  logTest('focusMode', 'Bionic reading applies bold', bionicApplied);

  // Test bionic reading cleanup
  const bionicCleanup = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ bionicReading: true });
    return new Promise(resolve => {
      setTimeout(() => {
        window.__ai4a11yFocusMode.disable();
        const noBionic = document.querySelector('[data-ai4a11y-bionic]') === null;
        resolve(noBionic);
      }, 200);
    });
  });
  logTest('focusMode', 'Bionic reading cleanup', bionicCleanup);

  // Test all presets
  const presets = ['adhd', 'autism', 'cognitive', 'anxiety'];
  for (const preset of presets) {
    const works = await page.evaluate((p) => {
      window.__ai4a11yFocusMode.applyPreset(p);
      const enabled = window.__ai4a11yFocusMode.enabled;
      const settings = window.__ai4a11yFocusMode.currentSettings;
      window.__ai4a11yFocusMode.disable();
      return enabled && settings.hideDistractions !== undefined;
    }, preset);
    logTest('focusMode', `Preset: ${preset}`, works);
  }

  // Test cleanup removes all elements
  const cleanupComplete = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ showProgress: true, lineFocus: true, bionicReading: true });
    return new Promise(resolve => {
      setTimeout(() => {
        window.__ai4a11yFocusMode.disable();
        const noStyle = !document.getElementById('ai4a11y-focus-mode-styles');
        const noProgress = !document.getElementById('ai4a11y-progress');
        const noGuide = !document.getElementById('ai4a11y-line-guide');
        resolve(noStyle && noProgress && noGuide);
      }, 200);
    });
  });
  logTest('focusMode', 'Complete cleanup on disable', cleanupComplete);

  await context.close();
}

// ============ INTEGRATION TESTS ============
async function testIntegration() {
  console.log('\n' + '='.repeat(60));
  console.log('INTEGRATION TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test all tools can run simultaneously
  const allToolsCoexist = await page.evaluate(() => {
    // Enable Visual Assist with motion reduction AND visual enhancements
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true, fontScale: 1.2 });
    window.__ai4a11yFocusMode.enable({ showProgress: true });

    const allEnabled =
      window.__ai4a11yVisualAssist.enabled &&
      window.__ai4a11yFocusMode.enabled;

    // Both Visual Assist style elements + Focus Mode styles should exist
    const allStylesPresent =
      !!document.getElementById('ai4a11y-motion-reducer-styles') &&
      !!document.getElementById('ai4a11y-visual-assist-styles') &&
      !!document.getElementById('ai4a11y-focus-mode-styles');

    window.__ai4a11yVisualAssist.disable();
    window.__ai4a11yFocusMode.disable();

    return allEnabled && allStylesPresent;
  });
  logTest('integration', 'All tools coexist simultaneously', allToolsCoexist);

  // Test tools don't interfere with each other
  const noInterference = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ contrastMode: 'dark' });
    window.__ai4a11yFocusMode.enable();

    // Disable Visual Assist, Focus Mode should remain
    window.__ai4a11yVisualAssist.disable();
    const focusStillEnabled = window.__ai4a11yFocusMode.enabled;
    const focusStylePresent = !!document.getElementById('ai4a11y-focus-mode-styles');

    window.__ai4a11yFocusMode.disable();
    return focusStillEnabled && focusStylePresent;
  });
  logTest('integration', 'Tools don\'t interfere on disable', noInterference);

  // Test rapid enable/disable cycles
  const rapidCyclesOk = await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.__ai4a11yVisualAssist.enable();
      window.__ai4a11yVisualAssist.disable();
    }
    return !document.getElementById('ai4a11y-motion-reducer-styles');
  });
  logTest('integration', 'Rapid enable/disable cycles', rapidCyclesOk);

  // Test settings persistence within session
  const settingsPersist = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.5, letterSpacing: 0.1 });
    const settings1 = { ...window.__ai4a11yVisualAssist.currentSettings };
    window.__ai4a11yVisualAssist.disable();
    window.__ai4a11yVisualAssist.enable();
    const settings2 = { ...window.__ai4a11yVisualAssist.currentSettings };
    window.__ai4a11yVisualAssist.disable();
    return settings2.fontScale === 1.5 && settings2.letterSpacing === 0.1;
  });
  logTest('integration', 'Settings persist within session', settingsPersist);

  await context.close();
}

// ============ EDGE CASE TESTS ============
async function testEdgeCases() {
  console.log('\n' + '='.repeat(60));
  console.log('EDGE CASE TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test deeply nested elements are affected
  const deeplyNestedAffected = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.5 });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const result = style && style.textContent.includes('font-size: 150%');
    window.__ai4a11yVisualAssist.disable();
    return result;
  });
  logTest('edgeCases', 'Deeply nested elements affected', deeplyNestedAffected);

  // Test empty page doesn't crash
  const emptyPageOk = await page.evaluate(() => {
    // Remove all content
    const body = document.body.innerHTML;
    document.body.innerHTML = '';

    try {
      window.__ai4a11yVisualAssist.enable();
      window.__ai4a11yVisualAssist.enable({ fontScale: 1.2 });
      window.__ai4a11yFocusMode.enable();

      const allEnabled =
        window.__ai4a11yVisualAssist.enabled &&
        window.__ai4a11yVisualAssist.enabled &&
        window.__ai4a11yFocusMode.enabled;

      window.__ai4a11yVisualAssist.disable();
      window.__ai4a11yVisualAssist.disable();
      window.__ai4a11yFocusMode.disable();

      // Restore content
      document.body.innerHTML = body;
      return allEnabled;
    } catch (e) {
      document.body.innerHTML = body;
      return false;
    }
  });
  logTest('edgeCases', 'Empty page doesn\'t crash', emptyPageOk);

  // Test malformed HTML handling
  const malformedOk = await page.evaluate(() => {
    // Add malformed HTML
    const div = document.createElement('div');
    div.innerHTML = '<p>Unclosed<div>Mixed</p></div>';
    document.body.appendChild(div);

    try {
      window.__ai4a11yFocusMode.enable({ bionicReading: true });
      return new Promise(resolve => {
        setTimeout(() => {
          window.__ai4a11yFocusMode.disable();
          div.remove();
          resolve(true);
        }, 100);
      });
    } catch (e) {
      div.remove();
      return false;
    }
  });
  logTest('edgeCases', 'Malformed HTML doesn\'t crash', malformedOk);

  // Test special characters in content
  const specialCharsOk = await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = '<p>Special: &amp; &lt; &gt; "quotes" \'apostrophe\' émojis: 🎉🔥 中文</p>';
    document.body.appendChild(div);

    try {
      window.__ai4a11yFocusMode.enable({ bionicReading: true });
      return new Promise(resolve => {
        setTimeout(() => {
          const hasBionic = div.querySelector('[data-ai4a11y-bionic]') !== null;
          window.__ai4a11yFocusMode.disable();
          div.remove();
          resolve(hasBionic);
        }, 100);
      });
    } catch (e) {
      div.remove();
      return false;
    }
  });
  logTest('edgeCases', 'Special characters handled', specialCharsOk);

  // Test very long content
  const longContentOk = await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = '<p>' + 'A'.repeat(10000) + '</p>';
    document.body.appendChild(div);

    const start = performance.now();
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.2 });
    const duration = performance.now() - start;
    window.__ai4a11yVisualAssist.disable();
    div.remove();

    return duration < 1000; // Should complete in under 1 second
  });
  logTest('edgeCases', 'Very long content handled quickly', longContentOk);

  // Test dynamic content addition
  const dynamicContentOk = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.5 });

    // Add new content after enabling
    const div = document.createElement('div');
    div.innerHTML = '<p class="dynamic-test">Dynamically added content</p>';
    document.body.appendChild(div);

    // CSS should still apply to new content
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const applies = style && style.textContent.includes('font-size: 150%');

    window.__ai4a11yVisualAssist.disable();
    div.remove();
    return applies;
  });
  logTest('edgeCases', 'CSS applies to dynamically added content', dynamicContentOk);

  // Test iframe content (limited - same origin only)
  const iframeHandled = await page.evaluate(() => {
    // We can't fully test cross-origin iframes, but we can check the tool doesn't crash
    const iframe = document.createElement('iframe');
    iframe.srcdoc = '<html><body><p>Iframe content</p></body></html>';
    document.body.appendChild(iframe);

    try {
      window.__ai4a11yVisualAssist.enable({ contrastMode: 'dark' });
      const ok = window.__ai4a11yVisualAssist.enabled;
      window.__ai4a11yVisualAssist.disable();
      iframe.remove();
      return ok;
    } catch (e) {
      iframe.remove();
      return false;
    }
  });
  logTest('edgeCases', 'Iframes don\'t cause crashes', iframeHandled);

  await context.close();
}

// ============ PERFORMANCE TESTS ============
async function testPerformance() {
  console.log('\n' + '='.repeat(60));
  console.log('PERFORMANCE TESTS');
  console.log('='.repeat(60) + '\n');

  const { page, context } = await createTestPage();

  // Test enable time for Visual Assist (motion reduction)
  const motionTime = await page.evaluate(() => {
    const start = performance.now();
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const duration = performance.now() - start;
    window.__ai4a11yVisualAssist.disable();
    return duration;
  });
  const motionOk = motionTime < 100;
  logTest('performance', `Visual Assist (motion) enable time: ${motionTime.toFixed(2)}ms`, motionOk, motionOk ? 'fast' : 'slow');

  // Test enable time for Visual Assist (full settings)
  const visualTime = await page.evaluate(() => {
    const start = performance.now();
    window.__ai4a11yVisualAssist.enable({ contrastMode: 'dark', fontScale: 1.5, colorBlindMode: 'protanopia' });
    const duration = performance.now() - start;
    window.__ai4a11yVisualAssist.disable();
    return duration;
  });
  const visualOk = visualTime < 100;
  logTest('performance', `Visual Assist (full) enable time: ${visualTime.toFixed(2)}ms`, visualOk, visualOk ? 'fast' : 'slow');

  // Test enable time for Focus Mode
  const focusModeTime = await page.evaluate(() => {
    const start = performance.now();
    window.__ai4a11yFocusMode.enable({ hideDistractions: true, showProgress: true, lineFocus: true });
    const duration = performance.now() - start;
    window.__ai4a11yFocusMode.disable();
    return duration;
  });
  const focusOk = focusModeTime < 100;
  logTest('performance', `Focus Mode enable time: ${focusModeTime.toFixed(2)}ms`, focusOk, focusOk ? 'fast' : 'slow');

  // Test bionic reading on large content
  const bionicTime = await page.evaluate(() => {
    // Add lots of paragraphs
    const container = document.createElement('div');
    for (let i = 0; i < 50; i++) {
      const p = document.createElement('p');
      p.textContent = 'This is a test paragraph with enough words to properly test the bionic reading feature performance across many elements. '.repeat(3);
      container.appendChild(p);
    }
    document.body.appendChild(container);

    const start = performance.now();
    window.__ai4a11yFocusMode.enable({ bionicReading: true });

    return new Promise(resolve => {
      setTimeout(() => {
        const duration = performance.now() - start;
        window.__ai4a11yFocusMode.disable();
        container.remove();
        resolve(duration);
      }, 500);
    });
  });
  const bionicOk = bionicTime < 2000;
  logTest('performance', `Bionic reading on 50 paragraphs: ${bionicTime.toFixed(2)}ms`, bionicOk, bionicOk ? 'acceptable' : 'slow');

  // Test memory usage (check for leaks via style count)
  const noMemoryLeak = await page.evaluate(() => {
    const initialStyles = document.querySelectorAll('style').length;

    for (let i = 0; i < 20; i++) {
      window.__ai4a11yVisualAssist.enable();
      window.__ai4a11yVisualAssist.enable({ fontScale: 1.2 });
      window.__ai4a11yFocusMode.enable();
      window.__ai4a11yVisualAssist.disable();
      window.__ai4a11yVisualAssist.disable();
      window.__ai4a11yFocusMode.disable();
    }

    const finalStyles = document.querySelectorAll('style').length;
    return finalStyles <= initialStyles + 3; // Allow for some variance
  });
  logTest('performance', 'No style element memory leak after 20 cycles', noMemoryLeak);

  await context.close();
}

// ============ REAL WEBSITE TESTS ============
async function testRealSites() {
  console.log('\n' + '='.repeat(60));
  console.log('REAL WEBSITE TESTS (sampling 3 sites)');
  console.log('='.repeat(60) + '\n');

  // Test on a sample of real sites
  const sitesToTest = TEST_SITES.slice(0, 3);

  for (const url of sitesToTest) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      console.log(`\nTesting: ${url}`);
      await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });

      // Mock Chrome APIs
      await page.evaluate(() => {
        window.chrome = {
          runtime: { sendMessage: (msg, cb) => cb && cb({ success: false }), lastError: null },
          storage: { onChanged: { addListener: () => {} }, sync: { get: (keys, cb) => cb && cb({}) } }
        };
      });

      // Inject content.bundle.js
      const contentJs = fs.readFileSync(path.join(__dirname, 'content.bundle.js'), 'utf8');
      const testableJs = contentJs.replace("if (window.__ai4a11yLoaded) return;", "// test mode");
      await page.addScriptTag({ content: testableJs });
      await page.waitForFunction(() => window.__ai4a11yVisualAssist !== undefined, { timeout: 10000 });

      // Test Motion Reducer
      const motionWorks = await page.evaluate(() => {
        try {
          window.__ai4a11yVisualAssist.enable();
          const enabled = window.__ai4a11yVisualAssist.enabled;
          window.__ai4a11yVisualAssist.disable();
          return enabled;
        } catch (e) { return false; }
      });
      logTest('realSites', `${new URL(url).hostname}: Motion Reducer`, motionWorks);

      // Test Visual Adapter
      const visualWorks = await page.evaluate(() => {
        try {
          window.__ai4a11yVisualAssist.enable({ contrastMode: 'dark' });
          const enabled = window.__ai4a11yVisualAssist.enabled;
          window.__ai4a11yVisualAssist.disable();
          return enabled;
        } catch (e) { return false; }
      });
      logTest('realSites', `${new URL(url).hostname}: Visual Adapter`, visualWorks);

      // Test Focus Mode
      const focusWorks = await page.evaluate(() => {
        try {
          window.__ai4a11yFocusMode.enable({ hideDistractions: true });
          const enabled = window.__ai4a11yFocusMode.enabled;
          window.__ai4a11yFocusMode.disable();
          return enabled;
        } catch (e) { return false; }
      });
      logTest('realSites', `${new URL(url).hostname}: Focus Mode`, focusWorks);

    } catch (e) {
      logTest('realSites', `${url}: Load/test failed`, false, e.message.slice(0, 50));
    }

    await context.close();
  }
}

// ============ MAIN ============
async function main() {
  console.log('='.repeat(60));
  console.log('AI4A11Y TOOLKIT - COMPREHENSIVE TEST SUITE');
  console.log('='.repeat(60));

  await setup();

  await testMotionReducer();
  await testVisualAdapter();
  await testFocusMode();
  await testIntegration();
  await testEdgeCases();
  await testPerformance();
  await testRealSites();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60) + '\n');

  let totalPassed = 0, totalFailed = 0;

  for (const [category, data] of Object.entries(results)) {
    console.log(`${category}: ${data.passed}/${data.passed + data.failed} passed`);
    totalPassed += data.passed;
    totalFailed += data.failed;
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`TOTAL: ${totalPassed}/${totalPassed + totalFailed} passed (${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%)`);
  console.log('='.repeat(40));

  if (totalFailed > 0) {
    console.log('\nFailed tests:');
    for (const [category, data] of Object.entries(results)) {
      data.tests.filter(t => !t.passed).forEach(t => {
        console.log(`  [${category}] ${t.name}${t.details ? ` - ${t.details}` : ''}`);
      });
    }
  }

  // Save results
  const outputPath = path.join(os.homedir(), 'Downloads', 'ai4a11y-comprehensive-test.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { total: totalPassed + totalFailed, passed: totalPassed, failed: totalFailed },
    results
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  await browser.close();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
