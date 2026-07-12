import { describeImage } from '../../utils/ai.js';
import { markProcessed, wasProcessed, isVisible } from '../../utils/dom.js';
import { registerSweep } from '../../utils/observe.js';
import { computeAccessibleName } from 'dom-accessibility-api';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

// ---------------------------------------------------------------------------
// Confidence gate — post-validate AI output before writing to the DOM.
// Exported for unit tests.
// ---------------------------------------------------------------------------

// Refusal / uncertainty patterns that are never useful as alt text.
const REFUSAL_PREFIXES = ['I cannot', "I'm unable", 'I am unable', 'Sorry', 'I cannot describe', 'Unfortunately'];
const UNCERTAINTY_TERMS = ['unsure', "I don't know", 'unclear', 'I cannot tell', 'cannot determine'];
const GENERIC_JUNK = new Set(['image', 'picture', 'photo', 'photograph', 'graphic', 'icon', 'logo', 'img']);

/**
 * Returns true when the AI response is useful and safe to write as alt text.
 * Exported so test/alt-text-test.mjs can unit-test without a browser.
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
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

// ---------------------------------------------------------------------------
// Aspect-ratio-preserving downscale helper.
// Exported for unit tests.
// ---------------------------------------------------------------------------

const MAX_LONG_EDGE = 512;

/**
 * Compute canvas dimensions that fit within MAX_LONG_EDGE on the longer axis,
 * preserving the aspect ratio.  Both inputs are clamped to ≥1 so a zero-size
 * source never produces NaN.
 *
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @returns {{ w: number, h: number }}
 */
export function fitDimensions(naturalWidth, naturalHeight) {
  const w = Math.max(naturalWidth, 1);
  const h = Math.max(naturalHeight, 1);
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

// ---------------------------------------------------------------------------
// Skip-decision function — pure, no DOM side-effects.
// Exported for unit tests so the gates can be tested without a real browser.
//
// elInfo shape (all optional; absence treated as falsy):
//   hasAltAttr        — element has an `alt` attribute (even empty)
//   isEmptyAlt        — alt="" explicitly set
//   isAriaHidden      — any ancestor has aria-hidden="true"
//   role              — element's role attribute value
//   renderedWidth     — rendered width in px
//   renderedHeight    — rendered height in px
//   isElementVisible  — result of isVisible()
//   accessibleName    — result of computeAccessibleName() (string)
// ---------------------------------------------------------------------------

/**
 * @param {object} elInfo
 * @returns {{ skip: boolean, reason: string }}
 */
export function shouldDescribe(elInfo) {
  const {
    hasAltAttr,
    isEmptyAlt,
    isAriaHidden,
    role,
    renderedWidth = 0,
    renderedHeight = 0,
    isElementVisible = true,
    accessibleName = '',
  } = elInfo;

  // Author-intent decorative: alt="" is explicit; never overwrite.
  if (isEmptyAlt) return { skip: true, reason: 'decorative alt="" (author intent)' };

  // Ancestors that hide from AT.
  if (isAriaHidden) return { skip: true, reason: 'aria-hidden ancestor' };

  // Presentation roles hide from AT.
  if (role === 'presentation' || role === 'none') {
    return { skip: true, reason: `role="${role}"` };
  }

  // Tracking pixels / tiny images not meaningful to describe.
  if (renderedWidth < 32 || renderedHeight < 32) {
    return { skip: true, reason: `rendered size ${renderedWidth}×${renderedHeight} < 32×32` };
  }

  // Hidden elements — no useful context.
  if (!isElementVisible) return { skip: true, reason: 'element not visible' };

  // Already has an accessible name — do not add redundant AI text.
  if (accessibleName.trim().length > 0) {
    return { skip: true, reason: 'already has accessible name' };
  }

  return { skip: false, reason: '' };
}

// ---------------------------------------------------------------------------
// Byte acquisition helpers
// ---------------------------------------------------------------------------

/**
 * Fetch image bytes via the background service worker (cross-origin safe).
 * Returns a data URL on success, null on failure.
 *
 * Background route: { type: 'fetchImageBytes', url } → { bytes: base64 } | { error: ... }
 * The response `bytes` is base64-encoded raw image bytes (no MIME prefix).
 * We must reconstruct a data URL with the correct MIME type.
 *
 * @param {string} url
 * @param {string} [mimeType='image/jpeg']
 * @returns {Promise<string|null>}
 */
async function fetchCrossOriginDataUrl(url, mimeType = 'image/jpeg') {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage({ type: 'fetchImageBytes', url }, resp => {
      if (chrome.runtime.lastError || !resp || resp.error || !resp.bytes) {
        resolve(null);
        return;
      }
      resolve(`data:${mimeType};base64,${resp.bytes}`);
    });
  });
}

/**
 * Derive a MIME type hint from a URL.  Falls back to 'image/jpeg'.
 * @param {string} url
 * @returns {string}
 */
function mimeFromUrl(url) {
  const ext = (url.split('?')[0] || '').split('.').pop().toLowerCase();
  const map = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/png', avif: 'image/avif' };
  return map[ext] || 'image/jpeg';
}

/**
 * Convert an <img> to a data URL for AI description.
 * - Same-origin: draw to canvas (fast, exact MIME).
 * - Cross-origin: route through background fetchImageBytes.
 * Aspect ratio is preserved; long edge capped at MAX_LONG_EDGE.
 *
 * @param {HTMLImageElement} img
 * @returns {Promise<string|null>}
 */
async function imageToDataUrl(img) {
  const nw = img.naturalWidth || img.width || 0;
  const nh = img.naturalHeight || img.height || 0;
  const src = img.currentSrc || img.src || '';

  if (!nw || !nh || !src) return null;

  const { w, h } = fitDimensions(nw, nh);

  // Try same-origin canvas draw first.
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    // Canvas taint (cross-origin) — fall through to background fetch.
  }

  // Cross-origin: ask background.
  return fetchCrossOriginDataUrl(src, mimeFromUrl(src));
}

/**
 * Rasterize an inline SVG element to a PNG data URL.
 * (image/svg+xml is not accepted by Gemini; we rasterize via canvas.)
 *
 * @param {SVGElement} svg
 * @returns {Promise<string|null>}
 */
async function svgToDataUrl(svg) {
  try {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);

    const { w, h } = fitDimensions(img.naturalWidth || 300, img.naturalHeight || 150);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provenance helpers — store prior alt in data-ai4a11y-prev-alt so disable()
// can revert exactly.
// ---------------------------------------------------------------------------

const GENERATED_ATTR = 'data-ai4a11y-generated';
const PREV_ALT_ATTR = 'data-ai4a11y-prev-alt';
const EMPTY_SENTINEL = '\x00'; // sentinel for "attribute was absent before we wrote"

/**
 * Record provenance and write the alt attribute.
 * Stores the prior alt value (or EMPTY_SENTINEL when absent) in prev-alt.
 */
function writeAlt(el, altText, beforeValue) {
  const prevAttr = el.hasAttribute('alt') ? (el.getAttribute('alt') || EMPTY_SENTINEL) : EMPTY_SENTINEL;
  el.setAttribute(PREV_ALT_ATTR, prevAttr);
  el.setAttribute(GENERATED_ATTR, 'alt');
  el.setAttribute('alt', altText);
  return prevAttr;
}

/**
 * Revert an alt written by us.  Removes the alt or restores the old value.
 */
function revertAlt(el) {
  const prev = el.getAttribute(PREV_ALT_ATTR);
  if (prev === null) return; // wasn't written by us
  if (prev === EMPTY_SENTINEL) {
    el.removeAttribute('alt');
  } else {
    el.setAttribute('alt', prev);
  }
  el.removeAttribute(PREV_ALT_ATTR);
  el.removeAttribute(GENERATED_ATTR);
}

// ---------------------------------------------------------------------------
// Core per-element functions
// ---------------------------------------------------------------------------

/**
 * Gather the skip-decision inputs from a real DOM element.
 * @param {Element} el
 * @returns {object}  elInfo for shouldDescribe()
 */
function gatherElInfo(el) {
  const hasAltAttr = el.hasAttribute('alt');
  const isEmptyAlt = hasAltAttr && el.getAttribute('alt') === '';
  const isAriaHidden = !!el.closest('[aria-hidden="true"]');
  const role = el.getAttribute('role') || '';
  const rect = el.getBoundingClientRect();
  const renderedWidth = rect.width;
  const renderedHeight = rect.height;
  const isElementVisible = isVisible(el);
  const accessibleName = computeAccessibleName(el);
  return { hasAltAttr, isEmptyAlt, isAriaHidden, role, renderedWidth, renderedHeight, isElementVisible, accessibleName };
}

/**
 * Generate alt text for an <img>.  Used both by the sweep and by axeHandlers.
 * @param {HTMLImageElement} img
 * @returns {Promise<string|null>}
 */
export async function generateImageAlt(img) {
  if (wasProcessed(img, 'alt')) return null;
  markProcessed(img, 'pending', 'alt');

  try {
    const elInfo = gatherElInfo(img);
    const { skip, reason } = shouldDescribe(elInfo);
    if (skip) {
      // Not a failure — element is intentionally skipped; clear pending so
      // future sweeps don't retry unnecessarily.
      markProcessed(img, 'done', 'alt');
      return null;
    }

    const dataUrl = await imageToDataUrl(img);
    if (!dataUrl) {
      markProcessed(img, 'failed', 'alt');
      return null;
    }

    const result = await describeImage(dataUrl);

    if (!isConfidentDescription(result)) {
      markProcessed(img, 'failed', 'alt');
      return null;
    }

    const altText = result.trim();
    const before = img.getAttribute('alt') ?? '(absent)';
    writeAlt(img, altText, before);
    markProcessed(img, 'done', 'alt');
    incrementStat('images');
    logFix({ type: 'alt-text', before, after: altText, selector: selectorFor(img) });
    return altText;
  } catch (e) {
    console.warn('[AI4A11y] Failed to generate alt:', e);
    markProcessed(img, 'failed', 'alt');
    return null;
  }
}

/**
 * Generate an accessible label for an inline <canvas>.
 * Exported for the axe bridge dispatcher.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<string|null>}
 */
export async function generateCanvasDescription(canvas) {
  if (wasProcessed(canvas, 'alt')) return null;
  markProcessed(canvas, 'pending', 'alt');

  try {
    // Canvas is same-origin by definition if toDataURL succeeds.
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      markProcessed(canvas, 'failed', 'alt');
      return null;
    }

    const result = await describeImage(dataUrl);

    if (!isConfidentDescription(result)) {
      markProcessed(canvas, 'failed', 'alt');
      return null;
    }

    const description = result.trim();
    const before = canvas.getAttribute('aria-label') ?? '(absent)';
    canvas.setAttribute('aria-label', description);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(GENERATED_ATTR, 'alt');
    markProcessed(canvas, 'done', 'alt');
    incrementStat('images');
    logFix({ type: 'alt-text', before, after: description, selector: selectorFor(canvas) });
    return description;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe canvas:', e);
    markProcessed(canvas, 'failed', 'alt');
    return null;
  }
}

/**
 * Generate an accessible label for an inline <svg>.
 * Rasterizes to PNG first (image/svg+xml is not accepted by Gemini).
 * Respects accessible-name gate (<title> presence / computeAccessibleName).
 * Exported for the axe bridge dispatcher.
 *
 * @param {SVGElement} svg
 * @returns {Promise<string|null>}
 */
export async function generateSvgDescription(svg) {
  if (wasProcessed(svg, 'alt')) return null;
  markProcessed(svg, 'pending', 'alt');

  try {
    // Accessible-name gate: if the SVG already has a <title> or a computed name,
    // skip it — we never overwrite author intent.
    const existingName = computeAccessibleName(svg);
    if (existingName.trim().length > 0) {
      markProcessed(svg, 'done', 'alt');
      return null;
    }

    const dataUrl = await svgToDataUrl(svg);
    if (!dataUrl) {
      markProcessed(svg, 'failed', 'alt');
      return null;
    }

    const result = await describeImage(dataUrl);

    if (!isConfidentDescription(result)) {
      markProcessed(svg, 'failed', 'alt');
      return null;
    }

    const description = result.trim();
    const before = '(absent)';

    // Write a <title> as the primary name source for AT.
    let title = svg.querySelector('title');
    if (!title) {
      title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      svg.insertBefore(title, svg.firstChild);
    }
    title.textContent = description;
    svg.setAttribute('role', 'img');
    svg.setAttribute(GENERATED_ATTR, 'alt');
    markProcessed(svg, 'done', 'alt');
    incrementStat('images');
    logFix({ type: 'alt-text', before, after: description, selector: selectorFor(svg) });
    return description;
  } catch (e) {
    console.warn('[AI4A11y] Failed to describe SVG:', e);
    markProcessed(svg, 'failed', 'alt');
    return null;
  }
}

// ---------------------------------------------------------------------------
// axeHandlers — keeps the export shape expected by the axe bridge dispatcher.
// ---------------------------------------------------------------------------

export const axeHandlers = {
  'image-alt': generateImageAlt,
  'svg-img-alt': generateSvgDescription,
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function selectorFor(el) {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `${tag}${cls}`.slice(0, 80);
}

// ---------------------------------------------------------------------------
// AutoAltText adapter — sweep + enable/disable lifecycle
// ---------------------------------------------------------------------------

export const AutoAltText = {
  enabled: false,
  _unregisterSweep: null,

  async enable() {
    if (this.enabled) return true;
    this.enabled = true;

    // Initial sweep over all imgs.
    await this._sweepImages();

    // Register for late-loaded images via MutationObserver + SPA URL changes.
    this._unregisterSweep = registerSweep('auto-alt-text', async ({ reason }) => {
      if (!this.enabled) return;
      if (reason === 'urlchange') {
        // New page — clear all marks so we start fresh.
        document.querySelectorAll('[data-ai4a11y-alt]').forEach(el => {
          el.removeAttribute('data-ai4a11y-alt');
        });
      }
      await this._sweepImages();
    }, { debounceMs: 500 });

    return true;
  },

  /**
   * Sweep all <img> elements that need an alt.
   * Serial processing — relies on the provider limiter for concurrency;
   * per-element try/catch so one failure never aborts the sweep.
   */
  async _sweepImages() {
    // Query all imgs — gating is done inside generateImageAlt via shouldDescribe.
    // We do NOT use img[alt=""] in the selector to avoid accidentally including
    // deliberate decorative images in the candidate list.
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (!this.enabled) break;
      try {
        await generateImageAlt(img);
      } catch (e) {
        console.warn('[AI4A11y] sweep error on img:', e);
      }
    }
  },

  /**
   * Revert every alt written by this adapter and clear marks.
   */
  disable() {
    this.enabled = false;

    if (this._unregisterSweep) {
      this._unregisterSweep();
      this._unregisterSweep = null;
    }

    // Revert all alt writes: restore the prior alt (or remove if it was absent).
    document.querySelectorAll(`[${GENERATED_ATTR}="alt"]`).forEach(el => {
      revertAlt(el);
      el.removeAttribute('data-ai4a11y-alt');
    });

    // Also revert canvas/svg provenance marks (those set GENERATED_ATTR but not prev-alt).
    // Canvas: remove aria-label and role if we set them.
    document.querySelectorAll(`canvas[${GENERATED_ATTR}="alt"]`).forEach(el => {
      el.removeAttribute('aria-label');
      el.removeAttribute('role');
      el.removeAttribute(GENERATED_ATTR);
      el.removeAttribute('data-ai4a11y-alt');
    });

    // SVG: remove title we injected and role.
    document.querySelectorAll(`svg[${GENERATED_ATTR}="alt"]`).forEach(svg => {
      const title = svg.querySelector('title');
      if (title) title.remove();
      svg.removeAttribute('role');
      svg.removeAttribute(GENERATED_ATTR);
      svg.removeAttribute('data-ai4a11y-alt');
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};
