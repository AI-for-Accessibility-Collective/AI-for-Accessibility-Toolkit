// Generate alt text for images, canvas, SVG, and video using AI
import { describeImage, describeVideo } from '../utils/ai.js';
import { imageToDataUrl, captureVideoFrames } from '../utils/image.js';
import { markProcessed } from '../utils/dom.js';

// Stats tracking (injected by extension)
const logFix = globalThis.ai4a11yLogFix || (() => {});
const incrementStat = globalThis.ai4a11yIncrementStat || (() => {});

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

    if (result) {
      const altText = result;
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

    const description = await describeImage(dataUrl);

    if (description) {
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

    const description = await describeImage(dataUrl);

    if (description) {
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

    const description = await describeVideo(frames);

    if (description) {
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
