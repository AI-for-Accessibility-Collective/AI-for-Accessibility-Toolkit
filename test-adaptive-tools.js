/**
 * Test suite for adaptive tools: Visual Assist (incl. motion reduction), Focus Mode, Read Aloud
 * Uses Playwright to test in a real browser environment
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Test page with various elements to test against
const TEST_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Adaptive Tools Test Page</title>
  <style>
    /* Animations for Motion Reducer tests */
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .animated-box {
      width: 100px;
      height: 100px;
      background: blue;
      animation: bounce 1s infinite;
    }
    .spinning {
      width: 50px;
      height: 50px;
      background: red;
      animation: spin 2s linear infinite;
    }
    .parallax {
      background-attachment: fixed;
      background-image: linear-gradient(red, blue);
      height: 200px;
    }
    .smooth-scroll {
      scroll-behavior: smooth;
    }

    /* Elements for Visual Adapter tests */
    .low-contrast {
      color: #777;
      background: #999;
    }
    .small-text {
      font-size: 10px;
    }
    .tight-spacing {
      letter-spacing: -1px;
      line-height: 1.0;
    }
    a.plain-link {
      text-decoration: none;
      color: blue;
    }

    /* Elements for Focus Mode tests */
    .ad-banner {
      background: yellow;
      padding: 20px;
    }
    .sidebar {
      float: right;
      width: 200px;
      background: #eee;
    }
    .social-buttons {
      padding: 10px;
    }
    .popup-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
    }
    .newsletter-signup {
      padding: 20px;
      background: #ffd;
    }
    main {
      max-width: 600px;
    }
  </style>
</head>
<body>
  <!-- Motion Reducer test elements -->
  <div id="motion-test">
    <div class="animated-box" id="bouncing-box">Bouncing</div>
    <div class="spinning" id="spinning-box">Spin</div>
    <div class="parallax" id="parallax-bg">Parallax</div>
    <video id="test-video" width="320" height="240" autoplay muted loop>
      <source src="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAA" type="video/mp4">
    </video>
    <img id="test-gif" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Test GIF">
  </div>

  <!-- Visual Adapter test elements -->
  <div id="visual-test">
    <p class="low-contrast" id="low-contrast-text">Low contrast text</p>
    <p class="small-text" id="small-text">Small text that's hard to read</p>
    <p class="tight-spacing" id="tight-text">Tight spacing text</p>
    <a href="#" class="plain-link" id="plain-link">Plain link without underline</a>
    <button id="focus-test-btn">Focus Test Button</button>
  </div>

  <!-- Focus Mode test elements -->
  <div id="focus-test">
    <div class="ad-banner" id="ad-banner">Advertisement</div>
    <aside class="sidebar" id="sidebar">Sidebar content</aside>
    <div class="social-buttons" id="social">Share on social media</div>
    <div class="newsletter-signup" id="newsletter">Sign up for newsletter</div>
    <main id="main-content">
      <h1>Main Article</h1>
      <p id="para1">This is the first paragraph of the main content. It contains important information that the user wants to read without distractions.</p>
      <p id="para2">This is the second paragraph. It continues the main content with more valuable information for the reader.</p>
      <p id="para3">This is the third paragraph. The focus mode should highlight this content and dim the distractions around it.</p>
    </main>
  </div>
</body>
</html>
`;

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load test HTML
  await page.setContent(TEST_HTML);

  // Mock Chrome extension APIs
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        sendMessage: (msg, cb) => cb && cb({ success: false }),
        lastError: null
      },
      storage: {
        onChanged: { addListener: () => {} },
        sync: { get: (keys, cb) => cb && cb({}) }
      }
    };
  });

  // Inject content.bundle.js
  const contentJs = fs.readFileSync(path.join(__dirname, 'content.bundle.js'), 'utf8');

  // Remove the __ai4a11yLoaded check for testing
  const testableJs = contentJs.replace(
    "if (window.__ai4a11yLoaded) return;",
    "// Disabled for testing: if (window.__ai4a11yLoaded) return;"
  );

  await page.addScriptTag({ content: testableJs });

  // Wait for script to initialize (with shorter timeout)
  await page.waitForFunction(() => window.__ai4a11yVisualAssist !== undefined, { timeout: 10000 });

  const results = {
    visualAssist: [],
    focusMode: [],
    readAloud: [],
    passed: 0,
    failed: 0
  };

  // ============ MOTION REDUCTION TESTS (now part of Visual Assist) ============
  console.log('\n=== MOTION REDUCTION TESTS (Visual Assist) ===\n');

  // Test 1: Animations are stopped
  const test1 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const box = document.getElementById('bouncing-box');
    const style = getComputedStyle(box);
    const duration = parseFloat(style.animationDuration);
    return duration < 0.01 || style.animationPlayState === 'paused';
  });
  results.visualAssist.push({ name: 'Animations stopped', passed: test1 });
  console.log(`[${test1 ? '✓' : '✗'}] Animations stopped`);

  // Test 2: Transitions are disabled
  const test2 = await page.evaluate(() => {
    const style = document.getElementById('ai4a11y-motion-reducer-styles');
    return style && style.textContent.includes('transition-duration: 0.001ms');
  });
  results.visualAssist.push({ name: 'Transitions disabled', passed: test2 });
  console.log(`[${test2 ? '✓' : '✗'}] Transitions disabled`);

  // Test 3: Smooth scroll disabled
  const test3 = await page.evaluate(() => {
    const style = document.getElementById('ai4a11y-motion-reducer-styles');
    return style && style.textContent.includes('scroll-behavior: auto');
  });
  results.visualAssist.push({ name: 'Smooth scroll disabled', passed: test3 });
  console.log(`[${test3 ? '✓' : '✗'}] Smooth scroll disabled`);

  // Test 4: Can disable and re-enable
  const test4 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.disable();
    const styleGone = !document.getElementById('ai4a11y-motion-reducer-styles');
    window.__ai4a11yVisualAssist.enable({ reduceMotion: true });
    const styleBack = !!document.getElementById('ai4a11y-motion-reducer-styles');
    return styleGone && styleBack;
  });
  results.visualAssist.push({ name: 'Toggle enable/disable', passed: test4 });
  console.log(`[${test4 ? '✓' : '✗'}] Toggle enable/disable`);

  // Test 5: Parallax disabled
  const test5 = await page.evaluate(() => {
    const style = document.getElementById('ai4a11y-motion-reducer-styles');
    return style && style.textContent.includes('background-attachment: scroll');
  });
  results.visualAssist.push({ name: 'Parallax disabled', passed: test5 });
  console.log(`[${test5 ? '✓' : '✗'}] Parallax disabled`);

  // Disable for next tests
  await page.evaluate(() => window.__ai4a11yVisualAssist.disable());

  // ============ VISUAL ASSIST TESTS ============
  console.log('\n=== VISUAL ASSIST TESTS ===\n');

  // Test 6: High contrast dark mode
  const test6 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ contrastMode: 'dark' });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasInvert = style && style.textContent.includes('filter: invert(1)');
    window.__ai4a11yVisualAssist.disable();
    return hasInvert;
  });
  results.visualAssist.push({ name: 'High contrast dark mode', passed: test6 });
  console.log(`[${test6 ? '✓' : '✗'}] High contrast dark mode`);

  // Test 7: High contrast light mode
  const test7 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ contrastMode: 'light' });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasContrast = style && style.textContent.includes('background-color: #fff');
    window.__ai4a11yVisualAssist.disable();
    return hasContrast;
  });
  results.visualAssist.push({ name: 'High contrast light mode', passed: test7 });
  console.log(`[${test7 ? '✓' : '✗'}] High contrast light mode`);

  // Test 8: Yellow-black mode
  const test8 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ contrastMode: 'yellow-black' });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasYellow = style && style.textContent.includes('color: #ff0');
    window.__ai4a11yVisualAssist.disable();
    return hasYellow;
  });
  results.visualAssist.push({ name: 'Yellow-black contrast mode', passed: test8 });
  console.log(`[${test8 ? '✓' : '✗'}] Yellow-black contrast mode`);

  // Test 9: Font scaling
  const test9 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.5 });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasScale = style && style.textContent.includes('font-size: 150%');
    window.__ai4a11yVisualAssist.disable();
    return hasScale;
  });
  results.visualAssist.push({ name: 'Font scaling 150%', passed: test9 });
  console.log(`[${test9 ? '✓' : '✗'}] Font scaling 150%`);

  // Test 10: Letter spacing
  const test10 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ letterSpacing: 0.1 });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasSpacing = style && style.textContent.includes('letter-spacing: 0.1em');
    window.__ai4a11yVisualAssist.disable();
    return hasSpacing;
  });
  results.visualAssist.push({ name: 'Letter spacing adjustment', passed: test10 });
  console.log(`[${test10 ? '✓' : '✗'}] Letter spacing adjustment`);

  // Test 11: Enhanced focus indicators
  const test11 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ enhanceFocus: true });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasFocus = style && style.textContent.includes('outline: 4px solid');
    window.__ai4a11yVisualAssist.disable();
    return hasFocus;
  });
  results.visualAssist.push({ name: 'Enhanced focus indicators', passed: test11 });
  console.log(`[${test11 ? '✓' : '✗'}] Enhanced focus indicators`);

  // Test 12: Enhanced links
  const test12 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ enhanceLinks: true });
    const style = document.getElementById('ai4a11y-visual-assist-styles');
    const hasUnderline = style && style.textContent.includes('text-decoration: underline');
    window.__ai4a11yVisualAssist.disable();
    return hasUnderline;
  });
  results.visualAssist.push({ name: 'Enhanced link underlines', passed: test12 });
  console.log(`[${test12 ? '✓' : '✗'}] Enhanced link underlines`);

  // Test 13: Color blind filter injection
  const test13 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ colorBlindMode: 'protanopia' });
    const svg = document.getElementById('ai4a11y-svg-filters');
    const hasFilter = svg && svg.innerHTML.includes('ai4a11y-protanopia-filter');
    window.__ai4a11yVisualAssist.disable();
    return hasFilter;
  });
  results.visualAssist.push({ name: 'Protanopia color filter', passed: test13 });
  console.log(`[${test13 ? '✓' : '✗'}] Protanopia color filter`);

  // Test 14: Preset application
  const test14 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.applyPreset('lowVision');
    const settings = window.__ai4a11yVisualAssist.currentSettings;
    const correct = settings.fontScale === 1.3 && settings.enhanceFocus === true;
    window.__ai4a11yVisualAssist.disable();
    return correct;
  });
  results.visualAssist.push({ name: 'Low vision preset', passed: test14 });
  console.log(`[${test14 ? '✓' : '✗'}] Low vision preset`);

  // ============ FOCUS MODE TESTS ============
  console.log('\n=== FOCUS MODE TESTS ===\n');

  // Test 15: Distractions are dimmed
  const test15 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ hideDistractions: true, dimBackground: false });
    const style = document.getElementById('ai4a11y-focus-mode-styles');
    const hasDim = style && style.textContent.includes('[class*="ad-"]');
    window.__ai4a11yFocusMode.disable();
    return hasDim;
  });
  results.focusMode.push({ name: 'Distraction selectors applied', passed: test15 });
  console.log(`[${test15 ? '✓' : '✗'}] Distraction selectors applied`);

  // Test 16: Progress indicator created
  const test16 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ showProgress: true });
    const progress = document.getElementById('ai4a11y-progress');
    const exists = !!progress;
    window.__ai4a11yFocusMode.disable();
    return exists;
  });
  results.focusMode.push({ name: 'Progress indicator created', passed: test16 });
  console.log(`[${test16 ? '✓' : '✗'}] Progress indicator created`);

  // Test 17: Progress indicator removed on disable
  const test17 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ showProgress: true });
    window.__ai4a11yFocusMode.disable();
    return !document.getElementById('ai4a11y-progress');
  });
  results.focusMode.push({ name: 'Progress indicator cleanup', passed: test17 });
  console.log(`[${test17 ? '✓' : '✗'}] Progress indicator cleanup`);

  // Test 18: Line focus mode creates guide
  const test18 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ lineFocus: true });
    const guide = document.getElementById('ai4a11y-line-guide');
    const exists = !!guide;
    window.__ai4a11yFocusMode.disable();
    return exists;
  });
  results.focusMode.push({ name: 'Line focus guide created', passed: test18 });
  console.log(`[${test18 ? '✓' : '✗'}] Line focus guide created`);

  // Test 19: Line guide removed on disable
  const test19 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ lineFocus: true });
    window.__ai4a11yFocusMode.disable();
    return !document.getElementById('ai4a11y-line-guide');
  });
  results.focusMode.push({ name: 'Line guide cleanup', passed: test19 });
  console.log(`[${test19 ? '✓' : '✗'}] Line guide cleanup`);

  // Test 20: ADHD preset
  const test20 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.applyPreset('adhd');
    const settings = window.__ai4a11yFocusMode.currentSettings;
    const correct = settings.hideDistractions === true &&
                    settings.bionicReading === true &&
                    settings.showProgress === true;
    window.__ai4a11yFocusMode.disable();
    return correct;
  });
  results.focusMode.push({ name: 'ADHD preset settings', passed: test20 });
  console.log(`[${test20 ? '✓' : '✗'}] ADHD preset settings`);

  // Test 21: Paragraph hover highlight
  const test21 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable();
    const style = document.getElementById('ai4a11y-focus-mode-styles');
    const hasHover = style && style.textContent.includes('p:hover');
    window.__ai4a11yFocusMode.disable();
    return hasHover;
  });
  results.focusMode.push({ name: 'Paragraph hover highlight', passed: test21 });
  console.log(`[${test21 ? '✓' : '✗'}] Paragraph hover highlight`);

  // Test 22: Bionic reading applies bold
  const test22 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ bionicReading: true });
    // Wait a bit for bionic reading to apply
    return new Promise(resolve => {
      setTimeout(() => {
        const hasBionic = document.querySelector('[data-ai4a11y-bionic]') !== null;
        window.__ai4a11yFocusMode.disable();
        resolve(hasBionic);
      }, 100);
    });
  });
  results.focusMode.push({ name: 'Bionic reading applied', passed: test22 });
  console.log(`[${test22 ? '✓' : '✗'}] Bionic reading applied`);

  // Test 23: Bionic reading reverts on disable
  const test23 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.enable({ bionicReading: true });
    return new Promise(resolve => {
      setTimeout(() => {
        window.__ai4a11yFocusMode.disable();
        const bionicGone = document.querySelector('[data-ai4a11y-bionic]') === null;
        resolve(bionicGone);
      }, 100);
    });
  });
  results.focusMode.push({ name: 'Bionic reading cleanup', passed: test23 });
  console.log(`[${test23 ? '✓' : '✗'}] Bionic reading cleanup`);

  // Test 24: Toggle function works
  const test24 = await page.evaluate(() => {
    window.__ai4a11yFocusMode.toggle();
    const enabled = window.__ai4a11yFocusMode.enabled;
    window.__ai4a11yFocusMode.toggle();
    const disabled = !window.__ai4a11yFocusMode.enabled;
    return enabled && disabled;
  });
  results.focusMode.push({ name: 'Toggle function works', passed: test24 });
  console.log(`[${test24 ? '✓' : '✗'}] Toggle function works`);

  // Test 25: All tools can coexist
  const test25 = await page.evaluate(() => {
    window.__ai4a11yVisualAssist.enable({ fontScale: 1.2, reduceMotion: true });
    window.__ai4a11yFocusMode.enable({ showProgress: true });

    const allEnabled =
      window.__ai4a11yVisualAssist.enabled &&
      window.__ai4a11yFocusMode.enabled;

    const allStylesPresent =
      !!document.getElementById('ai4a11y-visual-assist-styles') &&
      !!document.getElementById('ai4a11y-focus-mode-styles');

    // Cleanup
    window.__ai4a11yVisualAssist.disable();
    window.__ai4a11yFocusMode.disable();

    return allEnabled && allStylesPresent;
  });
  results.focusMode.push({ name: 'All tools coexist', passed: test25 });
  console.log(`[${test25 ? '✓' : '✗'}] All tools coexist`);

  // ============ READ ALOUD TESTS ============
  console.log('\n=== READ ALOUD TESTS ===\n');

  // Test 26: ReadAloud object exists
  const test26 = await page.evaluate(() => {
    return typeof window.__ai4a11yReadAloud === 'object' &&
           typeof window.__ai4a11yReadAloud.speak === 'function' &&
           typeof window.__ai4a11yReadAloud.stop === 'function' &&
           typeof window.__ai4a11yReadAloud.pause === 'function' &&
           typeof window.__ai4a11yReadAloud.resume === 'function';
  });
  results.readAloud.push({ name: 'ReadAloud API exists', passed: test26 });
  console.log(`[${test26 ? '✓' : '✗'}] ReadAloud API exists`);

  // Test 27: setRate clamps to valid range
  const test27 = await page.evaluate(() => {
    const ra = window.__ai4a11yReadAloud;
    ra.setRate(0.1);
    const clampedLow = ra.settings.rate === 0.5;
    ra.setRate(3.0);
    const clampedHigh = ra.settings.rate === 2.0;
    ra.setRate(1.2);
    const validRate = ra.settings.rate === 1.2;
    return clampedLow && clampedHigh && validRate;
  });
  results.readAloud.push({ name: 'Rate clamping works', passed: test27 });
  console.log(`[${test27 ? '✓' : '✗'}] Rate clamping works`);

  // Test 28: Presets apply correctly
  const test28 = await page.evaluate(() => {
    const ra = window.__ai4a11yReadAloud;
    ra.applyPreset('slow');
    const slow = ra.settings.rate === 0.7;
    ra.applyPreset('fast');
    const fast = ra.settings.rate === 1.5;
    ra.applyPreset('veryFast');
    const veryFast = ra.settings.rate === 2.0;
    ra.applyPreset('normal');
    const normal = ra.settings.rate === 1.0;
    return slow && fast && veryFast && normal;
  });
  results.readAloud.push({ name: 'Presets work', passed: test28 });
  console.log(`[${test28 ? '✓' : '✗'}] Presets work`);

  // Test 29: extractReadableText works
  const test29 = await page.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = `
      <p>Readable text here.</p>
      <script>console.log('ignored');</script>
      <style>.ignored{}</style>
      <nav>Navigation ignored</nav>
      <p>More readable text.</p>
    `;
    document.body.appendChild(container);
    const text = window.__ai4a11yReadAloud.extractReadableText(container);
    document.body.removeChild(container);
    return text.includes('Readable text here') &&
           text.includes('More readable text') &&
           !text.includes('console.log') &&
           !text.includes('Navigation ignored');
  });
  results.readAloud.push({ name: 'Text extraction filters non-content', passed: test29 });
  console.log(`[${test29 ? '✓' : '✗'}] Text extraction filters non-content`);

  // Test 30: getVoices returns array
  const test30 = await page.evaluate(() => {
    const voices = window.__ai4a11yReadAloud.getVoices();
    return Array.isArray(voices);
  });
  results.readAloud.push({ name: 'getVoices returns array', passed: test30 });
  console.log(`[${test30 ? '✓' : '✗'}] getVoices returns array`);

  // Test 31: Initial state is not speaking
  const test31 = await page.evaluate(() => {
    const ra = window.__ai4a11yReadAloud;
    return ra.speaking === false && ra.paused === false;
  });
  results.readAloud.push({ name: 'Initial state correct', passed: test31 });
  console.log(`[${test31 ? '✓' : '✗'}] Initial state correct`);

  // Test 32: stop() resets state
  const test32 = await page.evaluate(() => {
    const ra = window.__ai4a11yReadAloud;
    ra.speaking = true;
    ra.paused = true;
    ra.stop();
    return ra.speaking === false && ra.paused === false;
  });
  results.readAloud.push({ name: 'stop() resets state', passed: test32 });
  console.log(`[${test32 ? '✓' : '✗'}] stop() resets state`);

  // Test 33: toggle() starts speaking when not speaking
  const test33 = await page.evaluate(() => {
    const ra = window.__ai4a11yReadAloud;
    ra.stop();
    // Can't fully test speech synthesis in headless, but can verify toggle calls speakPage
    let speakPageCalled = false;
    const originalSpeakPage = ra.speakPage.bind(ra);
    ra.speakPage = () => { speakPageCalled = true; };
    ra.toggle();
    ra.speakPage = originalSpeakPage;
    return speakPageCalled;
  });
  results.readAloud.push({ name: 'toggle() calls speakPage', passed: test33 });
  console.log(`[${test33 ? '✓' : '✗'}] toggle() calls speakPage`);

  // ============ SUMMARY ============
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================\n');

  const allTests = [
    ...results.visualAssist,
    ...results.focusMode,
    ...results.readAloud
  ];

  results.passed = allTests.filter(t => t.passed).length;
  results.failed = allTests.filter(t => !t.passed).length;

  console.log(`Visual Assist: ${results.visualAssist.filter(t => t.passed).length}/${results.visualAssist.length} passed`);
  console.log(`Focus Mode: ${results.focusMode.filter(t => t.passed).length}/${results.focusMode.length} passed`);
  console.log(`Read Aloud: ${results.readAloud.filter(t => t.passed).length}/${results.readAloud.length} passed`);
  console.log(`\nTotal: ${results.passed}/${results.passed + results.failed} passed`);

  if (results.failed > 0) {
    console.log('\nFailed tests:');
    allTests.filter(t => !t.passed).forEach(t => console.log(`  - ${t.name}`));
  }

  // Save results
  const os = require('os');
  const outputPath = path.join(os.homedir(), 'Downloads', 'ai4a11y-adaptive-tools-test.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total: results.passed + results.failed,
      passed: results.passed,
      failed: results.failed,
      passRate: `${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`
    },
    visualAssist: results.visualAssist,
    focusMode: results.focusMode,
    readAloud: results.readAloud
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  await browser.close();

  return results.failed === 0;
}

runTests()
  .then(passed => process.exit(passed ? 0 : 1))
  .catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
