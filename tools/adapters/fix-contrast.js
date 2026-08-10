import { fixContrast as aiFixContrast } from '../utils/ai.js';
import { getLuminance, getEffectiveBackground, meetsContrastAA, nearestAccessibleColor } from '../utils/color.js';
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

// Fix low contrast text
export async function fixLowContrast(element, color, background) {
  if (wasProcessed(element)) return null;
  markProcessed(element, 'pending');

  if (hasBackgroundImage(element)) {
    // Can't verify contrast against an image background — leave untouched.
    markProcessed(element, 'done');
    return null;
  }

  // Get effective background if not provided
  if (!background || background === 'transparent') {
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
    if (!fixedColor) {
      // Deterministic fallback: step toward black/white preserving direction,
      // rather than jumping straight to pure black or white.
      fixedColor = nearestAccessibleColor(color, background, { target })
        || (getLuminance(background) > 0.5 ? '#000000' : '#ffffff');
    }
  } catch (e) {
    console.warn('[AI4A11y] Contrast fix failed, using fallback:', e);
    fixedColor = nearestAccessibleColor(color, background, { target })
      || (getLuminance(background) > 0.5 ? '#000000' : '#ffffff');
  }

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
