import { isVisible, wasProcessed } from '../utils/dom.js';
import { isLikelyDecorative, getImageSize } from '../utils/image.js';

// Find images without alt text
export function findImagesWithoutAlt() {
  return Array.from(document.querySelectorAll('img'))
    .filter(img => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;

      // Has no alt attribute at all
      if (!img.hasAttribute('alt')) return true;

      return false;
    });
}

// Find images with empty alt that might need descriptions
// (large images that look like content, not icons)
export function findEmptyAltImages() {
  return Array.from(document.querySelectorAll('img[alt=""]'))
    .filter(img => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;
      if (isLikelyDecorative(img)) return false;

      const { width, height } = getImageSize(img);
      return width > 100 && height > 100;
    });
}

// Find images with unhelpful alt text
export function findBadAltImages() {
  const badPatterns = [
    /^image$/i,
    /^img$/i,
    /^photo$/i,
    /^picture$/i,
    /^graphic$/i,
    /^icon$/i,
    /^logo$/i,
    /^banner$/i,
    /^placeholder$/i,
    /^untitled$/i,
    /^\d+$/,
    /^DSC_?\d+/i,
    /^IMG_?\d+/i,
    /^screenshot/i,
    /\.jpe?g$/i,
    /\.png$/i,
    /\.gif$/i,
    /\.webp$/i
  ];

  return Array.from(document.querySelectorAll('img[alt]'))
    .filter(img => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;

      const alt = img.alt.trim();
      if (!alt) return false; // Empty alt handled separately

      return badPatterns.some(pattern => pattern.test(alt));
    });
}

// Find background images that might need descriptions
export function findBackgroundImages() {
  const found = [];

  document.querySelectorAll('*').forEach(el => {
    if (wasProcessed(el)) return;

    const style = getComputedStyle(el);
    const bg = style.backgroundImage;

    if (bg && bg !== 'none' && bg.includes('url(')) {
      const rect = el.getBoundingClientRect();
      // Only include reasonably sized elements
      if (rect.width > 100 && rect.height > 100) {
        found.push({
          element: el,
          imageUrl: bg.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
        });
      }
    }
  });

  return found;
}

// Find canvas elements that might need descriptions
export function findCanvasElements() {
  return Array.from(document.querySelectorAll('canvas'))
    .filter(canvas => {
      if (wasProcessed(canvas)) return false;

      const rect = canvas.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });
}

// Find SVG elements without accessible names
export function findSvgWithoutAlt() {
  return Array.from(document.querySelectorAll('svg'))
    .filter(svg => {
      if (wasProcessed(svg)) return false;

      // Skip if has accessible name
      if (svg.getAttribute('aria-label')) return false;
      if (svg.getAttribute('aria-labelledby')) return false;
      if (svg.querySelector('title')) return false;

      // Skip tiny icons
      const rect = svg.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) return false;

      return true;
    });
}
