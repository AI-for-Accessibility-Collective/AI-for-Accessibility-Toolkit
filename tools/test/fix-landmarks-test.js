// Fix Landmarks — jsdom tests for banner/contentinfo inference (issue #3) plus
// the existing main/navigation behavior. jsdom doesn't compute layout, so we
// assert the roles written onto the DOM.
//
// Run: node tools/test/fix-landmarks-test.js
import { JSDOM } from 'jsdom';
import { ensureBanner, ensureContentinfo, ensureMainLandmark, fixLandmarks } from '../adapters/fix-landmarks.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

function mount(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { url: 'https://example.com' });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom.window.document;
}

// 1. div-soup page: header + footer by class, no native landmarks.
{
  const doc = mount(`
    <div class="site-header"><a href="/">Logo</a><a href="/a">About</a></div>
    <div class="content"><p>${'word '.repeat(80)}</p></div>
    <div class="site-footer">© 2026 Example. All rights reserved.</div>`);
  fixLandmarks();
  check('main is inferred', !!doc.querySelector('main, [role="main"]'));
  check('banner inferred from header-class block', doc.querySelector('[role="banner"]')?.className === 'site-header');
  check('contentinfo inferred from footer-class block', doc.querySelector('[role="contentinfo"]')?.className === 'site-footer');
}

// 2. footer detected by COPYRIGHT text alone (no footer-ish class).
{
  const doc = mount(`
    <div class="masthead"><a href="/">Site</a></div>
    <div><p>${'body '.repeat(80)}</p></div>
    <div class="tail"><small>Copyright 2026 Acme Inc</small></div>`);
  ensureContentinfo();
  check('contentinfo inferred from copyright text', doc.querySelector('[role="contentinfo"]')?.className === 'tail');
  check('banner inferred from masthead class', ensureBanner() && doc.querySelector('[role="banner"]')?.className === 'masthead');
}

// 3. Never double-mark when native landmarks already exist.
{
  mount(`<header>H</header><main>M</main><footer>© 2026</footer>`);
  check('ensureBanner no-op when <header> exists', ensureBanner() === false);
  check('ensureContentinfo no-op when <footer> exists', ensureContentinfo() === false);
}

// 4. Never mislabel: nothing header-like → no banner.
{
  mount(`<div class="content"><p>${'z '.repeat(80)}</p></div>`);
  check('no banner when nothing looks like a header', ensureBanner() === false);
}

// 5. Don't tag a wrapper that contains the main content as the banner.
{
  const doc = mount(`<div class="page-header"><main><p>${'m '.repeat(80)}</p></main></div>`);
  check('banner skips a block that contains main', ensureBanner() === false && doc.querySelector('[role="banner"]') === null);
}

console.log(`\nfix-landmarks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
