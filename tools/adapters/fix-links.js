// Improve ambiguous link text ("click here", "read more") for screen reader users
import { improveLinkText } from '../utils/ai.js';
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Cap AI calls per page — ambiguous links can be plentiful on list pages
const MAX_LINKS_PER_PAGE = 10;

/**
 * Give an ambiguous link a descriptive accessible name.
 * Non-destructive: the visible text stays; we set aria-label so screen
 * readers announce the destination instead of "click here".
 */
export async function improveAmbiguousLink(link) {
  if (link.dataset.ai4a11yProcessed) return null;
  markProcessed(link, 'pending');

  const text = link.textContent?.trim() || '';
  const context = link.closest('p, li, td, article, section')?.textContent?.trim().substring(0, 200) || '';

  try {
    const improved = await improveLinkText(text, link.href, context);
    if (improved && improved.toLowerCase() !== text.toLowerCase()) {
      link.setAttribute('aria-label', improved);
      link.classList.add('ai4a11y-adapted');
      markProcessed(link, 'done');
      incrementStat('labels');
      logFix('link text', link, text, improved);
      return improved;
    }
  } catch (e) {
    console.warn('[AI4A11y] improveAmbiguousLink failed:', e);
  }

  markProcessed(link, 'failed');
  return null;
}

/**
 * Improve a batch of ambiguous links (pass the result of
 * auditors.findAmbiguousLinks()). Caps AI usage per page.
 */
export async function improveAmbiguousLinks(links) {
  const batch = Array.from(links).slice(0, MAX_LINKS_PER_PAGE);
  const results = [];
  for (const link of batch) {
    results.push(await improveAmbiguousLink(link));
  }
  return results.filter(Boolean);
}

export const axeHandlers = {};
