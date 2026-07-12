import { fixContrast as aiFixContrast } from '../../utils/ai.js';
import { getLuminance, getEffectiveBackground } from '../../utils/color.js';
import { markProcessed, wasProcessed } from '../../utils/dom.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

export async function fixLowContrast(element, color, background) {
  if (wasProcessed(element, 'contrast')) return null;
  markProcessed(element, 'pending', 'contrast');

  if (!background || background === 'transparent') {
    background = getEffectiveBackground(element);
  }

  let fixedColor;

  try {
    fixedColor = await aiFixContrast(color, background);
    if (!fixedColor) {
      fixedColor = getLuminance(background) > 0.5 ? '#000000' : '#ffffff';
    }
  } catch (e) {
    console.warn('[AI4A11y] Contrast fix failed, using fallback:', e);
    fixedColor = getLuminance(background) > 0.5 ? '#000000' : '#ffffff';
  }

  if (color) {
    element.dataset.ai4a11yOriginalColor = color;
  }

  element.style.color = fixedColor;
  element.classList.add('ai4a11y-contrast-fixed');
  markProcessed(element, 'done', 'contrast');
  incrementStat('wcag');
  logFix('contrast', element, color, fixedColor);
  console.log('[AI4A11y] Fixed contrast:', color, '->', fixedColor);

  return fixedColor;
}

export function fixIndistinguishableLink(link) {
  if (wasProcessed(link, 'contrast')) return;
  markProcessed(link, 'done', 'contrast');

  link.style.textDecoration = 'underline';
  incrementStat('wcag');
  logFix('link-underline', link, '(none)', 'underline');
  console.log('[AI4A11y] Added underline to link');
}

export const axeHandlers = {
  'color-contrast': fixLowContrast,
  'color-contrast-enhanced': fixLowContrast,
  'link-in-text-block': fixIndistinguishableLink
};

export const FixContrast = {
  enabled: false,

  enable() {
    this.enabled = true;
    this.run();
  },

  disable() {
    this.enabled = false;
    document.querySelectorAll('.ai4a11y-contrast-fixed').forEach(el => {
      if (el.dataset.ai4a11yOriginalColor) {
        el.style.color = el.dataset.ai4a11yOriginalColor;
        el.classList.remove('ai4a11y-contrast-fixed');
        delete el.dataset.ai4a11yOriginalColor;
      }
    });
  },

  run() {
    const textEls = document.querySelectorAll('p, span, li, td, th, h1, h2, h3, h4, h5, h6, a, label, div');
    for (const el of textEls) {
      if (wasProcessed(el, 'contrast') || !el.textContent?.trim()) continue;
      const style = getComputedStyle(el);
      const color = style.color;
      const background = getEffectiveBackground(el);
      fixLowContrast(el, color, background);
    }
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
