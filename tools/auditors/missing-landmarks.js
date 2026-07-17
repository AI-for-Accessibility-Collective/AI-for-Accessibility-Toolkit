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

/** Find nav-like blocks (link clusters) not marked as navigation. */
export function findUnmarkedNavigation() {
  return Array.from(document.querySelectorAll('div[class*="nav" i]:not([role])'))
    .filter(el => {
      if (!looksLikeNavClass(el)) return false; // reject substring false-positives ("unavailable" etc.)
      if (!isVisible(el)) return false;
      if (el.closest('nav, [role="navigation"]')) return false;
      return el.querySelectorAll('a').length >= 3;
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
