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
  const fontWeight = parseInt(style.fontWeight, 10) || 400;
  const bold = fontWeight >= 700;
  // 18pt = 24px; 14pt = 18.67px
  return fontSize >= 24 || (bold && fontSize >= 18.67);
}

// Can't know the effective pixel color under a background-image, so a
// computed fix could still fail (or look wrong) against the real pixels —
// skip rather than guess.
function hasBackgroundImage(element) {
  const bgImg = getComputedStyle(element).backgroundImage;
  return !!bgImg && bgImg !== 'none';
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

// Fix low contrast text
export async function fixLowContrast(element, color, background) {
  if (wasProcessed(element)) return null;
  markProcessed(element, 'pending');

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

  link.style.textDecoration = 'underline';
  incrementStat('wcag');
  logFix('link-underline', link, '(none)', 'underline');
  console.log('[AI4A11y] Added underline to link');
}

// Axe rule ID to handler mapping
export const axeHandlers = {
  'color-contrast': fixLowContrast,
  'color-contrast-enhanced': fixLowContrast,
  'link-in-text-block': fixIndistinguishableLink
};
