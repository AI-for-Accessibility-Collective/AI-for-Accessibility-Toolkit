// fix-contrast.js — deterministic WCAG AA contrast fixer
//
// Pipeline (no LLM in the correctness path):
//   1. Sweep text-bearing elements.
//   2. Resolve effective background by walking ancestors and compositing alpha
//      (including body and documentElement; falls back to white only when
//      truly nothing is set).  Skip elements whose background-image is set
//      (we can't know the effective pixel color).
//   3. Gate: skip elements that already pass WCAG AA (4.5:1 normal, 3:1 large).
//   4. For failures: nearestAccessibleColor → set inline color, save original.
//   5. logFix with before/after.  markProcessed ns='contrast'.
//   6. registerSweep for incremental re-scan on DOM mutation / SPA nav.
//   7. disable(): restore original colors, clear marks so re-enable re-fixes.
//
// Note on requiresAI: skills/registry.js already sets requiresAI:false for
// fix-contrast.  The adapter is now fully deterministic.

import {
  parseColor,
  meetsContrastAA,
  nearestAccessibleColor,
  compositeOver,
} from '../../utils/color.js';
import { markProcessed, wasProcessed } from '../../utils/dom.js';
import { registerSweep } from '../../utils/observe.js';

const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);
const incrementStat = (...a) => (globalThis.ai4a11yIncrementStat || (() => {}))(...a);

// ---------------------------------------------------------------------------
// Selector — text-bearing elements excluding bare divs without direct text
// ---------------------------------------------------------------------------
const TEXT_SELECTOR = 'p, span, li, td, th, h1, h2, h3, h4, h5, h6, a, label, button, caption, figcaption, blockquote, dt, dd, cite, time, mark, abbr, code, pre, legend, summary';

// ---------------------------------------------------------------------------
// Effective background resolver
// ---------------------------------------------------------------------------
// Walk up the ancestor chain, compositing alpha layers.  Unlike the old
// getEffectiveBackground in color.js, this also checks the element itself
// and explicitly handles documentElement.
function resolveBackground(element) {
  const layers = [];

  // Collect background colors from element upward through documentElement.
  let el = element;
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    const style = getComputedStyle(el);
    const bg = style.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const parsed = parseColor(bg);
      if (parsed) {
        layers.push({ bg, parsed });
        // Fully opaque layer — stop walking
        if ((parsed.alpha ?? 1) >= 1) break;
      }
    }
    el = el.parentElement;
  }

  if (layers.length === 0) return 'rgb(255 255 255)';

  // Composite from bottom-most (outermost) layer upward toward element
  // bottom = layers[last], top = layers[0]
  // Parse white as the canvas behind everything.
  let { parse: cjsParse } = _colorjsImport();
  let composite = cjsParse('white');
  for (let i = layers.length - 1; i >= 0; i--) {
    composite = compositeOver(layers[i].parsed, composite);
  }
  return _serializeComposite(composite);
}

// Lazy import shim — color.js imports colorjs.io which is bundled; in the
// browser build these are satisfied by esbuild.  We need a tiny helper here
// rather than duplicating serialize logic.
let _cjsCache = null;
function _colorjsImport() {
  if (!_cjsCache) {
    // These functions are re-exported from color.js which wraps colorjs.io
    _cjsCache = {
      parse: (str) => {
        const { parseColor: pc } = _selfImport();
        return pc(str);
      }
    };
  }
  return _cjsCache;
}
let _selfCache = null;
function _selfImport() {
  if (!_selfCache) {
    _selfCache = { parseColor };
  }
  return _selfCache;
}

// Serialize a composited color object back to an rgb() string.
// We use the same algorithm as in color.js (_serializeSRGB is not exported)
// to avoid another dependency.
function _serializeComposite(colorObj) {
  // colorObj may be a colorjs PlainColorObject in sRGB space
  if (!colorObj) return 'rgb(255 255 255)';
  if (typeof colorObj === 'string') return colorObj;
  // coords are 0–1 floats
  const coords = colorObj.coords || [1, 1, 1];
  const r = Math.round(Math.min(255, Math.max(0, (coords[0] ?? 1) * 255)));
  const g = Math.round(Math.min(255, Math.max(0, (coords[1] ?? 1) * 255)));
  const b = Math.round(Math.min(255, Math.max(0, (coords[2] ?? 1) * 255)));
  return `rgb(${r} ${g} ${b})`;
}

// ---------------------------------------------------------------------------
// Background image detection
// ---------------------------------------------------------------------------
function hasBackgroundImage(el) {
  const style = getComputedStyle(el);
  const bgImg = style.backgroundImage;
  return bgImg && bgImg !== 'none';
}

// ---------------------------------------------------------------------------
// Large text detection (WCAG: ≥18pt normal or ≥14pt bold)
// ---------------------------------------------------------------------------
function isLargeText(el) {
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 16; // px
  const fontWeight = parseInt(style.fontWeight, 10) || 400;
  const bold = fontWeight >= 700;
  // 18pt = 24px; 14pt = 18.67px
  return fontSize >= 24 || (bold && fontSize >= 18.67);
}

// ---------------------------------------------------------------------------
// Has direct text content (at least one non-whitespace text node child)
// ---------------------------------------------------------------------------
function hasDirectText(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Single-element fixer
// ---------------------------------------------------------------------------
function fixElement(el) {
  if (wasProcessed(el, 'contrast')) return;

  // Must have some visible text
  if (!el.textContent?.trim()) return;

  // Check background-image on element or direct ancestors — skip if present
  // because we can't know the effective pixel color under the image
  if (hasBackgroundImage(el)) {
    markProcessed(el, 'done', 'contrast');
    el.dataset.ai4a11yContrastState = 'skipped-bgimage';
    return;
  }

  const style = getComputedStyle(el);
  const fgCss = style.color;
  if (!fgCss) return;

  // Resolve effective background
  const bgCss = resolveBackground(el);

  // Gate: already passes AA?
  const large = isLargeText(el);
  if (meetsContrastAA(fgCss, bgCss, { largeText: large })) {
    markProcessed(el, 'done', 'contrast');
    return;
  }

  // Compute nearest accessible color
  const fixed = nearestAccessibleColor(fgCss, bgCss, { target: large ? 3 : 4.5 });
  if (!fixed) {
    markProcessed(el, 'failed', 'contrast');
    return;
  }

  // Save original inline color (or sentinel if there was none)
  const originalInline = el.style.color || '';
  el.dataset.ai4a11yOriginalColor = originalInline;

  el.style.color = fixed;
  el.classList.add('ai4a11y-contrast-fixed');
  markProcessed(el, 'done', 'contrast');

  incrementStat('wcag');
  logFix('contrast', el, fgCss, fixed);
  console.log('[AI4A11y] Fixed contrast:', fgCss, '->', fixed, '(bg:', bgCss, ')');
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------
function sweep() {
  const elements = document.querySelectorAll(TEXT_SELECTOR);
  for (const el of elements) {
    if (wasProcessed(el, 'contrast')) continue;
    fixElement(el);
  }
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------
let _unregisterSweep = null;

export const FixContrast = {
  enabled: false,

  enable() {
    this.enabled = true;
    sweep();
    // Register incremental re-scan on DOM mutation / SPA URL change
    if (!_unregisterSweep) {
      _unregisterSweep = registerSweep('contrast', () => sweep(), { debounceMs: 600 });
    }
    return true;
  },

  disable() {
    this.enabled = false;

    // Unregister sweep
    if (_unregisterSweep) {
      _unregisterSweep();
      _unregisterSweep = null;
    }

    // Restore original inline colors
    document.querySelectorAll('.ai4a11y-contrast-fixed').forEach(el => {
      const original = el.dataset.ai4a11yOriginalColor;
      if (original === undefined) {
        // Wasn't saved — leave as-is (shouldn't happen with correct flow)
        el.classList.remove('ai4a11y-contrast-fixed');
        return;
      }
      if (original === '') {
        // There was no inline color before — remove the inline property
        el.style.removeProperty('color');
      } else {
        el.style.color = original;
      }
      delete el.dataset.ai4a11yOriginalColor;
      el.classList.remove('ai4a11y-contrast-fixed');
    });

    // Clear contrast namespace marks so re-enable re-fixes everything
    document.querySelectorAll('[data-ai4a11y-contrast]').forEach(el => {
      el.removeAttribute('data-ai4a11y-contrast');
      delete el.dataset.ai4a11yContrastState;
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

// ---------------------------------------------------------------------------
// fixLowContrast — deterministic version for direct/axe-handler callers
// ---------------------------------------------------------------------------
export function fixLowContrast(element, _fgHint, _bgHint) {
  // Ignore the hints — we always resolve from computed style for correctness.
  fixElement(element);
}

// ---------------------------------------------------------------------------
// fixIndistinguishableLink — adds underline for links that lack decoration
// ---------------------------------------------------------------------------
export function fixIndistinguishableLink(link) {
  if (wasProcessed(link, 'contrast')) return;
  markProcessed(link, 'done', 'contrast');

  link.style.textDecoration = 'underline';
  incrementStat('wcag');
  logFix('link-underline', link, '(none)', 'underline');
  console.log('[AI4A11y] Added underline to link');
}

// ---------------------------------------------------------------------------
// axeHandlers — W2b axe work will consume these
// ---------------------------------------------------------------------------
export const axeHandlers = {
  'color-contrast':          fixLowContrast,
  'color-contrast-enhanced': fixLowContrast,
  'link-in-text-block':      fixIndistinguishableLink,
};
