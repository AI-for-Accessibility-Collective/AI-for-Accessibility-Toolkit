import { isVisible, wasProcessed, getLabelledByText } from '../utils/dom.js';
import { isLikelyDecorative, getImageSize } from '../utils/image.js';

// Pixel cutoffs. None of these come from WCAG: 1.1.1 (Non-text Content) says
// which images need a text alternative and which are decorative, but gives no
// size. They are guesses that separate icons and spacers from images a person
// would want described, and a large icon or a small chart lands on the wrong
// side. Heuristic, best-effort.
const CONTENT_IMAGE_MIN_PX = 100; // an <img alt=""> or a background image wider AND taller than this may be content
const CANVAS_MIN_PX = 50;         // a <canvas> wider AND taller than this may be a chart or drawing worth describing
const SVG_ICON_MAX_PX = 50;       // an <svg> narrower OR shorter than this is skipped as an icon

// Alt text that names the file or the medium instead of the content. WCAG
// 1.1.1 asks for a text alternative that serves the same purpose as the image;
// "image", "IMG_1234" or "photo.jpg" do not. Whole-word English matches plus
// file-name shapes, so: heuristic, English-only, best-effort.
// FLAG(review): /^logo$/ and /^icon$/ are kept because a bare "logo" does not
// say whose logo it is (the WAI images tutorial wants the organization name),
// but both are legitimate alt text in some contexts. /^screenshot/ is a prefix
// match and also catches "Screenshot of the settings page". All kept as they
// were so this pass does not change what the auditor reports.
const UNHELPFUL_ALT_PATTERNS = [
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
      return width > CONTENT_IMAGE_MIN_PX && height > CONTENT_IMAGE_MIN_PX;
    });
}

// Find images with unhelpful alt text
export function findBadAltImages() {
  return Array.from(document.querySelectorAll('img[alt]'))
    .filter(img => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;

      const alt = img.alt.trim();
      if (!alt) return false; // Empty alt handled separately

      return UNHELPFUL_ALT_PATTERNS.some(pattern => pattern.test(alt));
    });
}

// Find background images that might need descriptions
export function findBackgroundImages() {
  const found = [];
  // Target common container elements instead of '*' for better performance
  const selector = 'div, section, header, footer, article, aside, main, figure, [style*="background"]';

  document.querySelectorAll(selector).forEach(el => {
    if (wasProcessed(el)) return;

    const style = getComputedStyle(el);
    const bg = style.backgroundImage;

    if (bg && bg !== 'none' && bg.includes('url(')) {
      const rect = el.getBoundingClientRect();
      // Only include reasonably sized elements
      if (rect.width > CONTENT_IMAGE_MIN_PX && rect.height > CONTENT_IMAGE_MIN_PX) {
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
      return rect.width > CANVAS_MIN_PX && rect.height > CANVAS_MIN_PX;
    });
}

// Find SVG elements without accessible names
export function findSvgWithoutAlt() {
  return Array.from(document.querySelectorAll('svg'))
    .filter(svg => {
      if (wasProcessed(svg)) return false;

      // Skip if has accessible name
      if (svg.getAttribute('aria-label')) return false;
      if (svg.querySelector('title')) return false;

      // An aria-labelledby only counts when it resolves to text (same rule
      // as links, buttons and form controls)
      if (getLabelledByText(svg)) return false;

      // Skip tiny icons
      const rect = svg.getBoundingClientRect();
      if (rect.width < SVG_ICON_MAX_PX || rect.height < SVG_ICON_MAX_PX) return false;

      return true;
    });
}
