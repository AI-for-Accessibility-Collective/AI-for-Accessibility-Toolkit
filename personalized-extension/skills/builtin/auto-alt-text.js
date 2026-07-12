import { describeImage, describeVideo } from '../../utils/ai.js';
import { markProcessed, wasProcessed } from '../../utils/dom.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

async function imageToDataUrl(img) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.min(img.naturalWidth || img.width, 512);
    canvas.height = Math.min(img.naturalHeight || img.height, 512);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

async function captureVideoFrames(video, count = 6) {
  const frames = [];
  const duration = video.duration || 10;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = Math.min(video.videoWidth || 320, 320);
  canvas.height = Math.min(video.videoHeight || 240, 240);

  for (let i = 0; i < count; i++) {
    const time = (duration / count) * i;
    video.currentTime = time;
    await new Promise(r => { video.onseeked = r; });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL('image/jpeg', 0.5));
  }
  return frames;
}

export async function generateImageAlt(img) {
  if (wasProcessed(img, 'alt')) return null;
  markProcessed(img, 'pending', 'alt');

  try {
    const dataUrl = await imageToDataUrl(img);
    if (!dataUrl) {
      markProcessed(img, 'failed', 'alt');
      return null;
    }

    const result = await describeImage(dataUrl);

    if (result) {
      const altText = result;
      img.setAttribute('alt', altText);
      markProcessed(img, 'done', 'alt');
      incrementStat('images');
      logFix('alt text', img, '(empty)', altText);
      console.log('[AI4A11y] Generated alt:', altText);
      return altText;
    }

    markProcessed(img, 'failed', 'alt');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to generate alt:', e);
    markProcessed(img, 'failed', 'alt');
    return null;
  }
}

export async function generateCanvasDescription(canvas) {
  if (wasProcessed(canvas, 'alt')) return null;
  markProcessed(canvas, 'pending', 'alt');

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const description = await describeImage(dataUrl);

    if (description) {
      canvas.setAttribute('aria-label', description);
      canvas.setAttribute('role', 'img');
      markProcessed(canvas, 'done', 'alt');
      incrementStat('images');
      logFix('canvas description', canvas, '(none)', description);
      return description;
    }

    markProcessed(canvas, 'failed', 'alt');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe canvas:', e);
    markProcessed(canvas, 'failed', 'alt');
    return null;
  }
}

export async function generateSvgDescription(svg) {
  if (wasProcessed(svg, 'alt')) return null;
  markProcessed(svg, 'pending', 'alt');

  try {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

    const description = await describeImage(dataUrl);

    if (description) {
      let title = svg.querySelector('title');
      if (!title) {
        title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        svg.insertBefore(title, svg.firstChild);
      }
      title.textContent = description;

      svg.setAttribute('role', 'img');
      markProcessed(svg, 'done', 'alt');
      incrementStat('images');
      logFix('svg description', svg, '(none)', description);
      return description;
    }

    markProcessed(svg, 'failed', 'alt');
    return null;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe SVG:', e);
    markProcessed(svg, 'failed', 'alt');
    return null;
  }
}

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

export const axeHandlers = {
  'image-alt': generateImageAlt,
  'svg-img-alt': generateSvgDescription
};

export const AutoAltText = {
  enabled: false,

  async enable() {
    this.enabled = true;
    const images = document.querySelectorAll('img:not([alt]), img[alt=""]');
    for (const img of images) {
      if (!this.enabled) break;
      await generateImageAlt(img);
    }
  },

  disable() {
    this.enabled = false;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};
