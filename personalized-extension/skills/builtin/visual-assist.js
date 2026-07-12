import { registerSweep } from '../../utils/observe.js';

// WeakMap: element → original inline font-size string ('' means no inline style was set)
const _fontScaleOriginals = new WeakMap();

// Selector for text-bearing elements that may need font-size scaling.
// NOTE: `body` is intentionally excluded. Scaling body AND its descendants
// that inherit font-size from body causes cascade-amplification: body scales
// 16→24px, then a child <p> sees computed 24px and scales to 36px rather
// than the expected 24px. By starting below body we avoid this.
const TEXT_ELEMENT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, div, span, a, button, ' +
  'input, textarea, label, blockquote, pre, figcaption, caption, dt, dd, ' +
  'summary, article, section, header, footer, nav, main, aside';

// Elements to skip when applying font scaling: extension UI + icon fonts.
function _shouldSkipScale(el) {
  if (!el || !el.tagName) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' ||
      tag === 'SVG' || tag === 'MATH') return true;
  // Skip extension's own nodes
  const id = el.id || '';
  if (id.startsWith('ai4a11y-')) return true;
  try {
    if (el.closest && el.closest('#ai4a11y-announcer, #ai4a11y-reader-overlay')) return true;
  } catch (_) {}
  // Skip elements in shadow roots we can't reach from here
  if (el.shadowRoot) return true;
  // Skip icon font patterns (font-size change would break ligature sizing)
  const cls = (typeof el.className === 'string') ? el.className : '';
  if (cls.includes('material-icons') || cls.includes('material-symbols') ||
      cls.includes('icon') || cls.includes('fa-') || tag === 'I') return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  return false;
}

export const VisualAssist = {
  styleId: 'ai4a11y-visual-assist',
  enabled: false,
  settings: {
    contrastMode: 'none',
    fontScale: 1.0,
    lineHeight: 1.5,
    letterSpacing: 0,
    largeCursor: false,
    enhanceFocus: false,
    dyslexiaFont: false,
    readingGuide: false
  },

  // Track the scale currently committed to the DOM.
  _appliedScale: null,
  _unregisterSweep: null,
  // Generation counter: incremented on every apply/restore cycle so in-flight
  // requestIdleCallback traversals that started before a re-apply or restore
  // detect the change and abort, preventing compounding.
  _scaleGen: 0,

  enable(options = {}) {
    this.settings = { ...this.settings, ...options };
    this.enabled = true;
    this.apply();
    if (this.settings.readingGuide) this.enableReadingGuide();
    else this.disableReadingGuide();
  },

  disable() {
    this.enabled = false;
    this.remove();
    this._restoreFontScale();
    if (this._unregisterSweep) { this._unregisterSweep(); this._unregisterSweep = null; }
    this._appliedScale = null;
    this.disableReadingGuide();
  },

  apply() {
    this.remove();
    const css = this.generateCSS();
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);

    // Font scaling via computed-style traversal (not CSS zoom).
    const s = this.settings;
    let scale = s.fontScale > 10 ? s.fontScale / 100 : s.fontScale;
    scale = (scale && scale > 0) ? Math.max(0.5, Math.min(2.0, scale)) : 1.0;

    if (scale !== 1.0) {
      // If scale changed, restore the old values first so we read unscaled sizes.
      if (this._appliedScale !== null && this._appliedScale !== scale) {
        this._restoreFontScale();
      }
      if (this._appliedScale !== scale) {
        this._applyFontScale(scale);
      }
      // Register sweep for late-added nodes (SPA / dynamic content).
      if (!this._unregisterSweep) {
        this._unregisterSweep = registerSweep('visual-assist-font', () => {
          if (!this.enabled || this._appliedScale === null) return;
          this._applyFontScale(this._appliedScale);
        }, { debounceMs: 500 });
      }
    } else {
      // Scale back to 1.0 — restore everything and unregister sweep.
      if (this._appliedScale !== null) {
        this._restoreFontScale();
      }
      if (this._unregisterSweep) { this._unregisterSweep(); this._unregisterSweep = null; }
    }

    // Dark mode arbitration: if a contrast preset is applied and dark-mode
    // is also on, log and announce a one-line conflict note. We do NOT modify
    // dark-mode.js — the note is purely informational.
    if (s.contrastMode && s.contrastMode !== 'none') {
      if (typeof document !== 'undefined' && document.getElementById('ai4a11y-dark-mode')) {
        const msg = 'High contrast replaces dark mode while active';
        console.log('[AI4A11y] Visual Assist:', msg);
        // Use the content-script's announce if available (call-time lookup).
        if (typeof globalThis.ai4a11yAnnounce === 'function') globalThis.ai4a11yAnnounce(msg);
      }
    }
  },

  remove() {
    if (typeof document !== 'undefined') document.getElementById(this.styleId)?.remove();
  },

  // ── Font-scale DOM traversal ──────────────────────────────────────────────

  _applyFontScale(scale) {
    this._appliedScale = scale;
    // Bump generation so any concurrent in-flight traversal aborts.
    const gen = ++this._scaleGen;

    const candidates = typeof document !== 'undefined'
      ? Array.from(document.querySelectorAll(TEXT_ELEMENT_SELECTOR))
      : [];

    // PASS 1 (synchronous): snapshot every candidate's baseline computed
    // font-size BEFORE writing any inline styles. This prevents
    // cascade-amplification: scaling a parent element would otherwise change
    // descendant computed sizes before we read them, causing compounding.
    const scalePlan = []; // [{ el, baselinePx }]
    for (const el of candidates) {
      if (_shouldSkipScale(el)) continue;
      if (el.dataset && el.dataset.ai4a11yFontScale === String(scale)) continue;
      // Record the original inline value on first visit.
      if (!_fontScaleOriginals.has(el)) {
        _fontScaleOriginals.set(el, el.style.fontSize);
      }
      try {
        const baselinePx = parseFloat(getComputedStyle(el).fontSize);
        if (baselinePx && baselinePx > 0) {
          scalePlan.push({ el, baselinePx });
        }
      } catch (_) {}
    }

    // PASS 2 (chunked, async): write the pre-computed scaled sizes.
    let i = 0;
    const processChunk = (deadline) => {
      // Abort if a newer traversal has started (scale changed or restore ran).
      if (gen !== this._scaleGen) return;

      // When deadline.timeRemaining() is 0 on entry (common in headless Chrome
      // when the callback fires via the timeout option rather than true idle time),
      // skip per-element time checks and process the whole remaining batch in one
      // call to avoid an infinite reschedule loop where each call processes 0
      // elements and immediately yields again.
      const hasTime = !deadline || deadline.timeRemaining() > 0;

      while (i < scalePlan.length) {
        if (hasTime && deadline && deadline.timeRemaining() <= 0) {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(processChunk, { timeout: 500 });
          } else {
            setTimeout(() => processChunk(null), 0);
          }
          return;
        }
        if (gen !== this._scaleGen) return;
        const { el, baselinePx } = scalePlan[i++];
        el.style.fontSize = `${baselinePx * scale}px`;
        if (el.dataset) el.dataset.ai4a11yFontScale = String(scale);
      }
    };

    if (typeof requestIdleCallback !== 'undefined') {
      // timeout: 500ms ensures the traversal starts even in low-activity
      // headless environments where idle callbacks may be delayed.
      requestIdleCallback(processChunk, { timeout: 500 });
    } else {
      // Fallback for environments without requestIdleCallback.
      setTimeout(() => processChunk(null), 0);
    }
  },

  _restoreFontScale() {
    if (typeof document === 'undefined') return;
    // Bump generation to abort any in-flight _applyFontScale traversal.
    this._scaleGen++;
    // dataset.ai4a11yFontScale (camelCase) → attribute data-ai4a11y-font-scale (hyphen)
    document.querySelectorAll('[data-ai4a11y-font-scale]').forEach(el => {
      const orig = _fontScaleOriginals.get(el);
      // orig is the inline font-size string before we touched it.
      // Empty string '' means no inline style was set — clear it back to nothing.
      el.style.fontSize = (orig === undefined || orig === null) ? '' : orig;
      _fontScaleOriginals.delete(el);
      if (el.dataset) delete el.dataset.ai4a11yFontScale;
    });
    this._appliedScale = null;
  },

  // ── CSS generation ────────────────────────────────────────────────────────

  generateCSS() {
    const s = this.settings;
    let css = '';

    // ── Contrast presets ──
    // Force `color` broadly but `background-color` only on structural containers.
    // Never force background-image:none or background-color on span/div/a/button
    // because that erases sprite icons and gradients.
    // Exempt [aria-hidden="true"] icon spans from color forcing.
    if (s.contrastMode === 'light') {
      css += `
        html { background: #fff !important; }
        body, main, article, section, p,
        h1, h2, h3, h4, h5, h6,
        li, td, th {
          background-color: #fff !important;
        }
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        a, button, input, label,
        span:not([aria-hidden="true"]),
        div:not([aria-hidden="true"]) {
          color: #000 !important;
        }
        a { text-decoration: underline !important; }
        img, video { filter: contrast(1.2) !important; }
      `;
    } else if (s.contrastMode === 'yellow-black') {
      css += `
        html { background: #000 !important; }
        body, main, article, section, p,
        h1, h2, h3, h4, h5, h6,
        li, td, th {
          background-color: #000 !important;
        }
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        button, input, label,
        span:not([aria-hidden="true"]),
        div:not([aria-hidden="true"]) {
          color: #ff0 !important;
        }
        a { color: #0ff !important; text-decoration: underline !important; }
        img, video { filter: contrast(1.2) brightness(0.9) !important; }
      `;
    }

    // fontScale is handled via DOM traversal (_applyFontScale) — no CSS zoom rule.

    if (s.lineHeight && s.lineHeight !== 1.5) {
      css += `body, p, li, td, th, div, span, a, label { line-height: ${s.lineHeight} !important; }\n`;
    }

    if (s.letterSpacing && s.letterSpacing !== 0) {
      css += `body, p, li, td, th, div, span, a, label { letter-spacing: ${s.letterSpacing}em !important; }\n`;
    }

    if (s.largeCursor) {
      css += `* { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="%230066ff" opacity="0.5"/><circle cx="16" cy="16" r="4" fill="%23000"/></svg>'), auto !important; }\n`;
    }

    if (s.enhanceFocus) {
      // Keep :focus-visible only — no bare *:focus rule (would flash outlines on
      // mouse clicks, which keyboard-nav.js also avoids).
      css += `
        *:focus-visible {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
        a:focus-visible, button:focus-visible, input:focus-visible,
        select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
      `;
    }

    if (s.dyslexiaFont) {
      const fontUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('lib/OpenDyslexic-Regular.woff2')
        : 'https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff2';
      css += `@font-face { font-family: 'OpenDyslexic'; src: url('${fontUrl}'); }\n`;
      // Apply to broad text elements; exclude icon font patterns via :not() chains.
      // No !important override is added for icon elements: the page's own
      // .material-icons / FontAwesome CSS rules (which define the icon font-family)
      // beat inherited values in the cascade, so icons remain correct.
      // Elements with no icon CSS at all but no text either (decorative icon spans)
      // are excluded via aria-hidden="true" — they inherit but aren't visible text.
      css += `
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        a, button, input, textarea, label,
        span:not(.material-icons):not(.material-symbols-outlined):not([class*="icon"]):not([class*="fa-"]):not([aria-hidden="true"]),
        div:not(.material-icons):not(.material-symbols-outlined):not([class*="icon"]):not([class*="fa-"]):not([aria-hidden="true"]) {
          font-family: 'OpenDyslexic', sans-serif !important;
        }
      `;
    }

    if (s.readingGuide) {
      css += `.ai4a11y-reading-guide { position: fixed; left: 0; right: 0; height: 40px; background: rgba(255, 255, 0, 0.2); pointer-events: none; z-index: 999999; transition: top 0.05s ease-out; }\n`;
    }

    return css;
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },

  // ── Reading guide ─────────────────────────────────────────────────────────

  readingGuideEl: null,
  readingGuideMouseHandler: null,
  readingGuideFocusHandler: null,
  readingGuideRafPending: false,
  lastMouseY: 0,

  enableReadingGuide() {
    if (this.readingGuideEl) return;
    this.readingGuideEl = document.createElement('div');
    this.readingGuideEl.className = 'ai4a11y-reading-guide';
    document.body.appendChild(this.readingGuideEl);

    this.readingGuideRafPending = false;
    this.lastMouseY = 0;

    // Mouse tracking: plain clientY — no zoom-compensation needed because fontScale
    // uses DOM traversal instead of the old CSS magnification rule.
    // Set top directly in the handler (no RAF) for reliable behavior in both
    // normal browser usage and headless test environments.
    this.readingGuideMouseHandler = (e) => {
      if (this.readingGuideEl) {
        this.readingGuideEl.style.top = `${e.clientY - 20}px`;
      }
    };
    document.addEventListener('mousemove', this.readingGuideMouseHandler, { passive: true });

    // Keyboard mode: on focusin, snap the guide to the focused element's vertical center.
    // This makes the flagship "reading ruler" feature usable for keyboard-only users.
    this.readingGuideFocusHandler = (e) => {
      const target = e.target;
      if (!target || !this.readingGuideEl) return;
      try {
        const rect = target.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        this.readingGuideEl.style.top = `${centerY - 20}px`;
      } catch (_) {}
    };
    document.addEventListener('focusin', this.readingGuideFocusHandler, { passive: true });
  },

  disableReadingGuide() {
    if (this.readingGuideEl) {
      this.readingGuideEl.remove();
      this.readingGuideEl = null;
    }
    if (this.readingGuideMouseHandler) {
      document.removeEventListener('mousemove', this.readingGuideMouseHandler);
      this.readingGuideMouseHandler = null;
    }
    if (this.readingGuideFocusHandler) {
      document.removeEventListener('focusin', this.readingGuideFocusHandler);
      this.readingGuideFocusHandler = null;
    }
    this.readingGuideRafPending = false;
  }
};

window.__ai4a11yVisualAssist = VisualAssist;
