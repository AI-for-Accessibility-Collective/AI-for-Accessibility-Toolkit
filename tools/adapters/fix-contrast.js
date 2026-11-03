import { fixContrast as aiFixContrast } from '../utils/ai.js';
import { getContrastRatio, getEffectiveBackground, meetsContrastAA, nearestAccessibleColor } from '../utils/color.js';
import { markProcessed, wasProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Text is "large" per WCAG 2.x (>=18pt normal or >=14pt bold) — large text
// only needs 3:1 contrast instead of the normal 4.5:1.
function isLargeText(element) {
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 16; // px
  const weight = style.fontWeight;
  const bold = weight === 'bold' || weight === 'bolder' || (parseInt(weight, 10) || 400) >= 700;
  // 18pt = 24px; 14pt = 18.67px
  return fontSize >= 24 || (bold && fontSize >= 18.67);
}

// Can't know the effective pixel color under a background-image, so a
// computed fix could still fail (or look wrong) against the real pixels —
// skip rather than guess. Check the element and any transparent ancestor.
function hasBackgroundImage(element) {
  let el = element;
  while (el && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const bgImg = style.backgroundImage;
    if (bgImg && bgImg !== 'none') return true;
    if (isOpaque(style.backgroundColor)) break;
    el = el.parentElement;
  }
  return false;
}

// True only for a color with nothing showing through it: rgb(), hex, or an
// rgba() whose alpha is 1. Anything else is not the color behind the text.
function isOpaque(color) {
  if (!color) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return true;
  const m = color.match(/^rgba?\(\s*\d+,\s*\d+,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)$/);
  return !!m && (m[1] === undefined || parseFloat(m[1]) >= 1);
}

// Black or white, whichever reads better on this background.
function blackOrWhite(background) {
  const black = getContrastRatio('rgb(0, 0, 0)', background) ?? 0;
  const white = getContrastRatio('rgb(255, 255, 255)', background) ?? 0;
  return black >= white ? '#000000' : '#ffffff';
}

// Elements this module marked processed, changed or only checked, so
// restoreOriginal() clears its own marks and never another adapter's.
const marked = new Set();

// Fix low contrast text
export async function fixLowContrast(element, color, background) {
  if (wasProcessed(element)) return null;
  markProcessed(element, 'pending');
  marked.add(element);

  if (hasBackgroundImage(element)) {
    // Can't verify contrast against an image background — leave untouched.
    markProcessed(element, 'done');
    return null;
  }

  // Use the color actually behind the text. Callers pass the element's own
  // computed background, which for most text is "rgba(0, 0, 0, 0)": the box
  // is transparent and the real background belongs to an ancestor. Read as a
  // color, that has no luminance, so the fallback below picked white, and
  // grey text on a white store page turned invisible.
  if (!isOpaque(background)) {
    background = getEffectiveBackground(element);
  }

  if (!color) {
    color = getComputedStyle(element).color;
  }

  const large = isLargeText(element);

  // Gate: the element may already pass AA (axe's snapshot can be stale by
  // the time this runs, or a different violation on the same element already
  // fixed it) — don't touch a color that's already accessible.
  if (color && meetsContrastAA(color, background, large)) {
    markProcessed(element, 'done');
    return null;
  }

  let fixedColor;
  const target = large ? 3 : 4.5;

  try {
    // Try AI first for optimal color
    fixedColor = await aiFixContrast(color, background);
  } catch (e) {
    console.warn('[AI4A11y] Contrast fix failed, using fallback:', e);
    fixedColor = null;
  }
  // Whatever the AI said, the color applied must pass. Deterministic
  // fallback: step toward black/white preserving direction, rather than
  // jumping straight to pure black or white; then whichever of those reads.
  const passes = (c) => (getContrastRatio(c, background) ?? 0) >= target;
  if (!fixedColor || !passes(fixedColor)) fixedColor = nearestAccessibleColor(color, background, { target });
  if (!fixedColor || !passes(fixedColor)) fixedColor = blackOrWhite(background);

  // Store original color for revert (only if valid)
  if (color) {
    element.dataset.ai4a11yOriginalColor = color;
  }
  if (element.style.color) {
    element.dataset.ai4a11yOriginalInlineColor = element.style.color;
  }

  // Apply fix
  element.style.color = fixedColor;
  element.classList.add('ai4a11y-contrast-fixed');
  markProcessed(element, 'done');
  incrementStat('wcag');
  logFix('contrast', element, color, fixedColor);
  console.log('[AI4A11y] Fixed contrast:', color, '->', fixedColor);

  return fixedColor;
}

// Add underline to links that are indistinguishable from text
export function fixIndistinguishableLink(link) {
  if (wasProcessed(link)) return;
  markProcessed(link, 'done');
  marked.add(link);

  if (link.style.textDecoration) {
    link.dataset.ai4a11yOriginalTextDecoration = link.style.textDecoration;
  }
  link.style.textDecoration = 'underline';
  link.classList.add('ai4a11y-link-underlined');
  incrementStat('wcag');
  logFix('link-underline', link, '(none)', 'underline');
  console.log('[AI4A11y] Added underline to link');
}

// Restore original styling. Only elements this module marked or changed (its
// own record, class and original values): data-ai4a11y-processed is shared
// with other adapters, and clearing it page-wide would make them run again.
export function restoreOriginal(element) {
  if (!element) {
    const selector = '.ai4a11y-contrast-fixed, .ai4a11y-link-underlined, [data-ai4a11y-original-color], [data-ai4a11y-original-inline-color], [data-ai4a11y-original-text-decoration]';
    new Set([...marked, ...document.querySelectorAll(selector)]).forEach((el) => restoreOriginal(el));
    return;
  }

  let changed = false;
  if (element.classList.contains('ai4a11y-contrast-fixed') || element.dataset.ai4a11yOriginalColor !== undefined) {
    changed = true;
    if (element.dataset.ai4a11yOriginalInlineColor !== undefined) {
      element.style.color = element.dataset.ai4a11yOriginalInlineColor;
    } else {
      element.style.removeProperty('color');
    }
    element.classList.remove('ai4a11y-contrast-fixed');
    delete element.dataset.ai4a11yOriginalColor;
    delete element.dataset.ai4a11yOriginalInlineColor;
  }

  if (element.classList.contains('ai4a11y-link-underlined') || element.dataset.ai4a11yOriginalTextDecoration !== undefined) {
    changed = true;
    if (element.dataset.ai4a11yOriginalTextDecoration !== undefined) {
      element.style.textDecoration = element.dataset.ai4a11yOriginalTextDecoration;
    } else {
      element.style.removeProperty('text-decoration');
    }
    element.classList.remove('ai4a11y-link-underlined');
    delete element.dataset.ai4a11yOriginalTextDecoration;
  }

  if (!changed && !marked.has(element)) return;
  marked.delete(element);
  delete element.dataset.ai4a11yProcessed;

  if (element.hasAttribute('style') && !element.getAttribute('style').trim()) {
    element.removeAttribute('style');
  }
  if (element.hasAttribute('class') && !element.getAttribute('class').trim()) {
    element.removeAttribute('class');
  }
}

// Axe rule ID to handler mapping
export const axeHandlers = {
  'color-contrast': fixLowContrast,
  'color-contrast-enhanced': fixLowContrast,
  'link-in-text-block': fixIndistinguishableLink
};
