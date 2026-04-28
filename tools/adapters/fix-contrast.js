import { fixContrast as aiFixContrast } from '../utils/ai.js';
import { getLuminance, getEffectiveBackground } from '../utils/color.js';
import { markProcessed } from '../utils/dom.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// Fix low contrast text
export async function fixLowContrast(element, color, background) {
  if (element.dataset.ai4a11yProcessed) return null;
  markProcessed(element, 'pending');

  // Get effective background if not provided
  if (!background || background === 'transparent') {
    background = getEffectiveBackground(element);
  }

  let fixedColor;

  try {
    // Try AI first for optimal color
    fixedColor = await aiFixContrast(color, background);
    if (!fixedColor) {
      // Fallback: simple black or white based on background luminance
      fixedColor = getLuminance(background) > 0.5 ? '#000000' : '#ffffff';
    }
  } catch (e) {
    console.warn('[AI4A11y] Contrast fix failed, using fallback:', e);
    fixedColor = getLuminance(background) > 0.5 ? '#000000' : '#ffffff';
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
  if (link.dataset.ai4a11yProcessed) return;
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
