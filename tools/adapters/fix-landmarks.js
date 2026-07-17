// Add missing ARIA landmarks so screen reader users can navigate by region
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Landmark regions a genuine "main" content block should NOT itself contain.
// If a candidate wraps any of these, it's a layout/app shell, not main
// content — labeling it "main" would swallow the header/nav/footer and make
// landmark navigation worse than no main at all.
const LANDMARK_SELECTOR = 'header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';

/**
 * Ensure the page has a main landmark. Deterministic (no AI): picks the
 * largest top-level content block that is neither a landmark itself nor a
 * wrapper *containing* landmarks (the common SPA `<div id="root">` shell).
 * Descends one level into such a shell before giving up, so single-root apps
 * still get a sensible main. Returns false rather than mislabeling.
 */
export function ensureMainLandmark() {
  if (document.querySelector('main, [role="main"]')) return false;

  const isCandidate = (el) => {
    const tag = el.tagName.toLowerCase();
    if (['header', 'footer', 'nav', 'aside', 'script', 'style', 'noscript'].includes(tag)) return false;
    if (el.matches('[role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"]')) return false;
    if ((el.textContent?.trim().length || 0) <= 100) return false;
    // Reject wrappers that contain their own landmark regions.
    if (el.querySelector(LANDMARK_SELECTOR)) return false;
    return true;
  };

  // Start at body's children; if the only viable block is a landmark-wrapping
  // shell, descend into it once and retry (covers <div id="root"> SPAs).
  let level = Array.from(document.body.children);
  let candidates = level.filter(isCandidate);
  if (candidates.length === 0) {
    const shell = level.find(el =>
      (el.textContent?.trim().length || 0) > 100 && el.querySelector(LANDMARK_SELECTOR));
    if (shell) candidates = Array.from(shell.children).filter(isCandidate);
  }
  if (candidates.length === 0) return false;

  // Largest text block wins
  const main = candidates.reduce((a, b) =>
    (a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b);

  main.setAttribute('role', 'main');
  markProcessed(main, 'done');
  incrementStat('wcag');
  logFix('landmark', main, '(no main landmark)', 'role="main"');
  console.log('[AI4A11y] Added role="main" landmark');
  return true;
}

/**
 * Label banner/contentinfo/navigation landmarks that exist structurally
 * (top-level header/footer, obvious navs) but lack roles. Native <header>,
 * <footer>, and <nav> map to these roles implicitly — this only helps
 * div-soup pages.
 */
export function ensureStructuralLandmarks() {
  let fixed = 0;

  // Top-of-body div that is mostly links → navigation
  document.querySelectorAll('div[class*="nav" i]:not([role])').forEach(el => {
    if (el.closest('nav, [role="navigation"]')) return;
    const links = el.querySelectorAll('a').length;
    const textLength = el.textContent?.trim().length || 1;
    if (links >= 3 && (links * 15) / textLength > 0.5) {
      el.setAttribute('role', 'navigation');
      incrementStat('wcag');
      logFix('landmark', el, '(unmarked nav)', 'role="navigation"');
      fixed++;
    }
  });

  return fixed;
}

/** Run all landmark fixes. */
export function fixLandmarks() {
  let count = 0;
  if (ensureMainLandmark()) count++;
  count += ensureStructuralLandmarks();
  return count;
}

// landmark-one-main fires on the document when no main landmark exists
export const axeHandlers = {
  'landmark-one-main': () => ensureMainLandmark(),
};
