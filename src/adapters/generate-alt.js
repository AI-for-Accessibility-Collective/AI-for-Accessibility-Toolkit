import { sendMessage } from '../utils/messaging.js';
import { imageToDataUrl, captureVideoFrames } from '../utils/image.js';
import { markProcessed } from '../utils/dom.js';
import { logFix, incrementStat } from '../stats.js';

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

    const response = await sendMessage({
      type: 'describeImage',
      imageData: dataUrl
    });

    if (!response?.success) {
      console.warn('[AI4A11y] Alt text API failed:', response?.error || 'unknown error');
    }

    if (response?.success && response.result) {
      const altText = response.result;
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

    const response = await sendMessage({
      type: 'describeImage',
      imageData: dataUrl
    });

    if (response?.success && response.result) {
      const description = response.result;
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

    const response = await sendMessage({
      type: 'describeImage',
      imageData: dataUrl
    });

    if (response?.success && response.result) {
      const description = response.result;

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

    const response = await sendMessage({
      type: 'describeVideo',
      frames
    });

    if (response?.success && response.result) {
      const description = response.result;
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
