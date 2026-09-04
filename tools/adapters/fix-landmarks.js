// Add missing ARIA landmarks so screen reader users can navigate by region
import { markProcessed, looksLikeNavClass } from '../utils/dom.js';

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
    // Never overwrite an existing role — setting role="main" would destroy a
    // region/tabpanel/search/form/etc. semantic already on the element.
    if (el.getAttribute('role')) return false;
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
// "navbar" is intentionally NOT here — it's a navigation region, not a page
// banner, and matching it mislabels nav components. `\bheader\b` already covers
// site-header / page-header (word boundaries at the hyphen).
const HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar)\b/i;
// "banner" also names cookie and consent bars, which are not the masthead.
const NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo/i;
const FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon|copyright)\b/i;
const COPYRIGHT_RE = /©|\(c\)\s*\d|copyright|all rights reserved/i;
const hint = (re, el) => re.test(el.className || '') || re.test(el.id || '');

// Mark a page banner (site header) when none exists. Class/id-hinted, in
// document order (earliest wins), size-capped, and never a block that already
// contains the main content — so we tag the masthead, not the whole page.
export function ensureBanner() {
  if (document.querySelector('header, [role="banner"]')) return false;
  const el = Array.from(document.querySelectorAll('div, section, td, aside'))
    .filter((e) => !e.getAttribute('role') && hint(HEADER_HINT, e) && !hint(NOT_HEADER, e))
    .filter((e) => !e.querySelector('main, [role="main"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 2000)[0];
  if (!el) return false;
  el.setAttribute('role', 'banner');
  incrementStat('wcag');
  logFix('landmark', el, '(unmarked header)', 'role="banner"');
  return true;
}

// Mark a page contentinfo (footer) when none exists. Class/id-hinted OR carrying
// copyright text near its end; last match in document order (closest to the
// bottom), size-capped, and not a wrapper that contains other landmarks.
export function ensureContentinfo() {
  if (document.querySelector('footer, [role="contentinfo"]')) return false;
  const cands = Array.from(document.querySelectorAll('div, section, td, aside'))
    .filter((e) => !e.getAttribute('role'))
    .filter((e) => hint(FOOTER_HINT, e) || COPYRIGHT_RE.test((e.textContent || '').slice(-400)))
    .filter((e) => !e.querySelector('main, [role="main"], nav, [role="navigation"], header, [role="banner"]'))
    .filter((e) => (e.textContent?.trim().length || 0) < 1500);
  const el = cands[cands.length - 1];
  if (!el) return false;
  el.setAttribute('role', 'contentinfo');
  incrementStat('wcag');
  logFix('landmark', el, '(unmarked footer)', 'role="contentinfo"');
  return true;
}

export function ensureStructuralLandmarks() {
  let fixed = 0;

  // Top-of-body div that is mostly links → navigation
  document.querySelectorAll('div[class*="nav" i]:not([role])').forEach(el => {
    if (!looksLikeNavClass(el)) return; // reject substring false-positives ("unavailable" etc.)
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

  if (ensureBanner()) fixed++;
  if (ensureContentinfo()) fixed++;

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

// Toggle-style adapter so the catalog can enable landmark repair by id
// (settings.js maps `fixLandmarks: true` → 'fix-landmarks'). Landmark roles are
// additive and safe to leave in place, so disable() is a no-op beyond flipping
// the flag — a full revert would need per-element tracking and is not worth the
// risk of stripping a role the page actually had.
export const FixLandmarks = {
  id: 'fix-landmarks',
  enabled: false,
  enable() { if (this.enabled) return; this.enabled = true; try { fixLandmarks(); } catch { /* detached */ } },
  disable() { this.enabled = false; },
  toggle() { this.enabled ? this.disable() : this.enable(); },
};

if (typeof window !== 'undefined') window.__ai4a11yFixLandmarks = FixLandmarks;
