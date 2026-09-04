// Find pages/regions missing ARIA landmarks
import { isVisible, looksLikeNavClass } from '../utils/dom.js';

/** Does the page lack a main landmark entirely? */
export function pageMissingMainLandmark() {
  return !document.querySelector('main, [role="main"]');
}

// <header>/<footer> only carry the implicit banner/contentinfo role when NOT
// nested inside sectioning content — a per-article header is not a page banner.
const SECTIONING = 'article, aside, main, nav, section';
function hasPageBanner() {
  if (document.querySelector('[role="banner"]')) return true;
  return Array.from(document.querySelectorAll('header')).some(h => !h.closest(SECTIONING));
}
function hasPageContentinfo() {
  if (document.querySelector('[role="contentinfo"]')) return true;
  return Array.from(document.querySelectorAll('footer')).some(f => !f.closest(SECTIONING));
}

// How many links a nav-classed <div> needs before it is called navigation.
// Marking navigation serves WCAG 1.3.1 (Info and Relationships) and 2.4.1
// (Bypass Blocks), but neither gives a link count. The class test lives in
// looksLikeNavClass; this number is a guess that keeps a div with one or two
// links from being reported. Heuristic, best-effort.
const NAV_LIKE_MIN_LINKS = 3;

/** Find nav-like blocks (link clusters) not marked as navigation. */
export function findUnmarkedNavigation() {
  return Array.from(document.querySelectorAll('div[class*="nav" i]:not([role])'))
    .filter(el => {
      if (!looksLikeNavClass(el)) return false; // reject substring false-positives ("unavailable" etc.)
      if (!isVisible(el)) return false;
      if (el.closest('nav, [role="navigation"]')) return false;
      return el.querySelectorAll('a').length >= NAV_LIKE_MIN_LINKS;
    });
}

/** Summarize the page's landmark coverage (for audits/CLI). */
export function auditLandmarks() {
  return {
    hasMain: !pageMissingMainLandmark(),
    hasBanner: hasPageBanner(),
    hasContentinfo: hasPageContentinfo(),
    hasNavigation: !!document.querySelector('nav, [role="navigation"]'),
    unmarkedNavCandidates: findUnmarkedNavigation().length,
  };
}
