import { isVisible, wasProcessed } from '../utils/dom.js';
import { getContrastRatio, getEffectiveBackground } from '../utils/color.js';

// Find text elements with low contrast
export function findLowContrastText() {
  const textElements = document.querySelectorAll(
    'p, span, a, li, td, th, h1, h2, h3, h4, h5, h6, label, button, div'
  );

  const found = [];

  textElements.forEach(el => {
    if (wasProcessed(el)) return;
    if (!isVisible(el)) return;

    // Skip if has no direct text content
    const hasDirectText = Array.from(el.childNodes).some(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (!hasDirectText) return;

    const style = getComputedStyle(el);
    const color = style.color;
    const background = getEffectiveBackground(el);

    const ratio = getContrastRatio(color, background);
    if (ratio === null) return; // Skip if colors unparseable

    const fontSize = parseFloat(style.fontSize);
    const fontWeight = parseInt(style.fontWeight) || 400;

    // Large text: 18pt+ or 14pt+ bold
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const minRatio = isLarge ? 3 : 4.5;

    if (ratio < minRatio) {
      found.push({
        element: el,
        color,
        background,
        ratio,
        required: minRatio
      });
    }
  });

  return found;
}

// Find links that are indistinguishable from surrounding text
// Per WCAG 1.4.1: Links must have underline OR 3:1 contrast with surrounding text
export function findIndistinguishableLinks() {
  return Array.from(document.querySelectorAll('a'))
    .filter(link => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;

      const style = getComputedStyle(link);

      // Has underline - distinguishable
      if (style.textDecoration.includes('underline')) return false;

      // Check contrast against parent text color
      const parent = link.parentElement;
      if (!parent) return false;

      const parentStyle = getComputedStyle(parent);
      const linkParentRatio = getContrastRatio(style.color, parentStyle.color);

      // Skip if colors unparseable
      if (linkParentRatio === null) return false;

      // Needs 3:1 contrast ratio if no underline
      if (linkParentRatio >= 3) return false;

      // Insufficient contrast and no underline - indistinguishable
      return true;
    });
}
