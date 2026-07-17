// Find pages/regions missing ARIA landmarks
import { isVisible } from '../utils/dom.js';

/** Does the page lack a main landmark entirely? */
export function pageMissingMainLandmark() {
  return !document.querySelector('main, [role="main"]');
}

/** Find nav-like blocks (link clusters) not marked as navigation. */
export function findUnmarkedNavigation() {
  return Array.from(document.querySelectorAll('div[class*="nav" i]:not([role])'))
    .filter(el => {
      if (!isVisible(el)) return false;
      if (el.closest('nav, [role="navigation"]')) return false;
      return el.querySelectorAll('a').length >= 3;
    });
}

/** Summarize the page's landmark coverage (for audits/CLI). */
export function auditLandmarks() {
  return {
    hasMain: !pageMissingMainLandmark(),
    hasBanner: !!document.querySelector('header, [role="banner"]'),
    hasContentinfo: !!document.querySelector('footer, [role="contentinfo"]'),
    hasNavigation: !!document.querySelector('nav, [role="navigation"]'),
    unmarkedNavCandidates: findUnmarkedNavigation().length,
  };
}
