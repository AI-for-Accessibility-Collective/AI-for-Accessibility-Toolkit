// Generate alt text for images, canvas, SVG, and video using AI
import { describeImage, describeVideo } from '../utils/ai.js';
import { imageToDataUrl, captureVideoFrames } from '../utils/image.js';
import { markProcessed } from '../utils/dom.js';
import { REFUSAL_PREFIXES, UNCERTAINTY_TERMS } from '../utils/ai-output.js';

// Stats tracking (injected by extension)
const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

// ---------------------------------------------------------------------------
// Trust tiering — post-validate AI output before writing it to the DOM.
// A vision model asked to describe an image sometimes refuses, hedges, or
// returns junk ("image", "photo") instead of a real description; writing that
// straight into `alt` is worse than leaving the image unlabeled (it reads to
// a screen reader as false confidence). Every generate* function below runs
// its result through this gate first. The refusal and uncertainty lists are
// shared with the other output gates via utils/ai-output.js; the checks here
// are unchanged.
// FLAG(review): this gate matches its prefixes case-sensitively, so a
// lowercase "sorry, ..." passes it, while rejectShortText() in ai-output.js
// is case-insensitive. Left as it was to keep this gate's behavior unchanged.
// ---------------------------------------------------------------------------
const GENERIC_JUNK = new Set(['image', 'picture', 'photo', 'photograph', 'graphic', 'icon', 'logo', 'img']);

// Exported for unit tests.
export function isConfidentDescription(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (GENERIC_JUNK.has(t.toLowerCase())) return false;
  for (const prefix of REFUSAL_PREFIXES) {
    if (t.startsWith(prefix)) return false;
  }
  for (const term of UNCERTAINTY_TERMS) {
    if (t.includes(term)) return false;
  }
  return true;
}

// Generate alt text for an image using AI
export async function generateImageAlt(img) {
  if (img.dataset.ai4a11yProcessed) return null;
  markProcessed(img, 'pending');

  try {
    const dataUrl = await imageToDataUrl(img);
    if (!dataUrl) {
      markProcessed(img, 'failed');
      return null;
    }

    const result = await describeImage(dataUrl);

    if (isConfidentDescription(result)) {
      const altText = result.trim();
      img.setAttribute('alt', altText);
      markProcessed(img, 'done');
      incrementStat('images');
      logFix('alt text', img, '(empty)', altText);
      console.log('[AI4A11y] Generated alt:', altText);
      return altText;
    }

    markProcessed(img, 'failed');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to generate alt:', e);
    markProcessed(img, 'failed');
    return null;
  }
}

// Generate description for canvas element
export async function generateCanvasDescription(canvas) {
  if (canvas.dataset.ai4a11yProcessed) return null;
  markProcessed(canvas, 'pending');

  try {
    const dataUrl = canvas.toDataURL('image/png');

    const result = await describeImage(dataUrl);

    if (isConfidentDescription(result)) {
      const description = result.trim();
      canvas.setAttribute('aria-label', description);
      canvas.setAttribute('role', 'img');
      markProcessed(canvas, 'done');
      incrementStat('images');
      logFix('canvas description', canvas, '(none)', description);
      return description;
    }

    markProcessed(canvas, 'failed');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe canvas:', e);
    markProcessed(canvas, 'failed');
    return null;
  }
}

// Generate description for SVG
export async function generateSvgDescription(svg) {
  if (svg.dataset.ai4a11yProcessed) return null;
  markProcessed(svg, 'pending');

  try {
    // Serialize SVG to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);

    // Convert to data URL
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

    const result = await describeImage(dataUrl);

    if (isConfidentDescription(result)) {
      const description = result.trim();
      // Add title element to SVG
      let title = svg.querySelector('title');
      if (!title) {
        title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        svg.insertBefore(title, svg.firstChild);
      }
      title.textContent = description;

      svg.setAttribute('role', 'img');
      markProcessed(svg, 'done');
      incrementStat('images');
      logFix('svg description', svg, '(none)', description);
      return description;
    }

    markProcessed(svg, 'failed');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe SVG:', e);
    markProcessed(svg, 'failed');
    return null;
  }
}

// Generate video description from frames
export async function generateVideoDescription(video) {
  if (video.dataset.ai4a11yDescribed) return null;
  video.dataset.ai4a11yDescribed = 'pending';

  try {
    const frames = await captureVideoFrames(video, 6);

    const result = await describeVideo(frames);

    if (isConfidentDescription(result)) {
      // Actually expose the description to assistive tech — every sibling
      // (image alt, canvas/svg aria-label) applies its result; this one used
      // to compute it, mark the video "done", and drop it on the floor.
      const description = result.trim();
      video.setAttribute('aria-label', description);
      video.dataset.ai4a11yDescribed = 'done';
      incrementStat('images');
      logFix('video description', video, '(none)', description);
      return description;
    }

    video.dataset.ai4a11yDescribed = 'failed';
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe video:', e);
    video.dataset.ai4a11yDescribed = 'failed';
    return null;
  }
}

// Axe rule ID to handler mapping
export const axeHandlers = {
  'image-alt': generateImageAlt,
  'svg-img-alt': generateSvgDescription
};
