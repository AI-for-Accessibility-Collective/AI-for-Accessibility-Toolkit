// Visual Assist - text/display adjustments (font, spacing, cursor, focus)
import { announce } from '../utils/ai.js';
import { registerSweep } from '../utils/observe.js';

// WeakMap: element -> original inline font-size string ('' means no inline style was set)
const _fontScaleOriginals = new WeakMap();

// Selector for text-bearing elements that may need font-size scaling.
// NOTE: `body` is intentionally excluded. Scaling body AND its descendants
// that inherit font-size from body causes cascade-amplification: body scales
// 16->24px, then a child <p> sees computed 24px and scales to 36px rather
// than the expected 24px. By starting below body we avoid this.
const TEXT_ELEMENT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, div, span, a, button, ' +
  'input, select, textarea, label, blockquote, pre, figcaption, caption, dt, dd, ' +
  'summary, article, section, header, footer, nav, main, aside, ' +
  // Inline text with its own px size (header captions, labels) stayed small.
  'small, b, strong, em, legend';

// A box positioned over something with both top and bottom set (e.g. the
// text on a banner photo, `position:absolute; inset:0`) can't grow with its
// text: enlarged text there ran under the next row and hid the banner's
// button. Text in such a box keeps the page's own size and spacing.
const FIXED_BOX_ATTR = 'data-ai4a11y-fixed-box';

// Whether the page set this inset itself. getComputedStyle reports the used
// position (a px value even for `auto`), so a badge with only `top` set would
// look pinned at both ends; the typed computed value keeps `auto`. Without
// it (older browsers) nothing counts as pinned and text scales as before.
function _insetSet(el, side) {
  try {
    if (typeof el.computedStyleMap !== 'function') return false;
    const v = el.computedStyleMap().get(side);
    return !!v && String(v) !== 'auto';
  } catch (_) { return false; }
}

// Text that is already large gains less: at 1.25, 15 px text becomes 18.75 px
// but a 46 px banner heading 50.5 px, not 57.5 px. Large headings are readable
// as they are, and growing them by a quarter is what pushed buttons out of
// fixed-size boxes. Sizes keep their order (bigger text stays bigger).
function _scaledSize(px, scale) {
  return px + (scale - 1) * Math.min(px, 18);
}

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
    if (el.closest && el.closest('#ai4a11y-announcer, #ai4a11y-reader-mode')) return true;
  } catch (_) {}
  // Skip elements in shadow roots we can't reach from here
  if (el.shadowRoot) return true;
  // Skip icon font patterns (font-size change would break ligature sizing)
  const cls = (typeof el.className === 'string') ? el.className : '';
  if (cls.includes('material-icons') || cls.includes('material-symbols') ||
      cls.includes('icon') || cls.includes('fa-') || tag === 'I') return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  try { if (el.closest && el.closest(`[${FIXED_BOX_ATTR}]`)) return true; } catch (_) {}
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
  appliedScale: null,
  unregisterSweep: null,
  fixedBoxes: null,      // Map: box -> its inline font-size/line-height/letter-spacing before we set them
  fixedChecked: null,    // WeakSet of elements already looked at, so sweeps stay cheap
  overflowBefore: null,  // WeakSet of boxes whose content already overflowed before we changed anything
  grown: null,           // Map: fixed-height box we let grow -> its inline height/min-height before
  // Generation counter: incremented on every apply/restore cycle so in-flight
  // requestIdleCallback traversals that started before a re-apply or restore
  // detect the change and abort, preventing compounding.
  scaleGen: 0,

  enable(options = {}) {
    this.settings = { ...this.settings, ...options };
    this.enabled = true;
    this.apply();

    // Handle reading guide
    if (this.settings.readingGuide) {
      this.enableReadingGuide();
    } else {
      this.disableReadingGuide();
    }
  },

  disable() {
    this.enabled = false;
    this.remove();
    this.restoreFontScale();
    this.unmarkFixedBoxes();
    this.ungrowFixedBoxes();
    this.overflowBefore = null;
    if (this.unregisterSweep) { this.unregisterSweep(); this.unregisterSweep = null; }
    this.appliedScale = null;
    this.disableReadingGuide();
  },

  apply() {
    this.remove();
    if (!this.overflowBefore) this.overflowBefore = this.overflowing();

    const css = this.generateCSS();
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);
    this.markFixedBoxes();

    // Font scaling via computed-style DOM traversal, not CSS `zoom` — `zoom`
    // is non-standard (no Firefox support) and its layout side effects (e.g.
    // shifting fixed-position elements) made the old rule unreliable.
    const s = this.settings;
    let scale = s.fontScale > 10 ? s.fontScale / 100 : s.fontScale;
    scale = (scale && scale > 0) ? Math.max(0.5, Math.min(2.0, scale)) : 1.0;

    if (scale !== 1.0) {
      // If scale changed, restore the old values first so we read unscaled sizes.
      if (this.appliedScale !== null && this.appliedScale !== scale) {
        this.restoreFontScale();
      }
      if (this.appliedScale !== scale) {
        this.applyFontScale(scale);
      }
      // Register sweep for late-added nodes (SPA / dynamic content).
      if (!this.unregisterSweep) {
        this.unregisterSweep = registerSweep('visual-assist-font', () => {
          if (!this.enabled || this.appliedScale === null) return;
          this.markFixedBoxes();
          this.applyFontScale(this.appliedScale);
        }, { debounceMs: 500 });
      }
    } else {
      // Scale back to 1.0 — restore everything and unregister sweep.
      if (this.appliedScale !== null) {
        this.restoreFontScale();
      }
      if (this.unregisterSweep) { this.unregisterSweep(); this.unregisterSweep = null; }
      this.growFixedBoxes(); // line spacing alone can overflow a box too
    }

    // Dark mode arbitration: if a contrast preset is applied and dark-mode is
    // also on, announce a one-line conflict note. We do NOT modify
    // dark-mode.js — this is purely informational.
    if (s.contrastMode && s.contrastMode !== 'none') {
      if (typeof document !== 'undefined' && document.getElementById('ai4a11y-dark-mode')) {
        const msg = 'High contrast replaces dark mode while active';
        console.log('[AI4A11y] Visual Assist:', msg);
        announce(msg);
      }
    }
  },

  remove() {
    if (typeof document !== 'undefined') document.getElementById(this.styleId)?.remove();
  },

  // ── Font-scale DOM traversal ──────────────────────────────────────────────

  applyFontScale(scale) {
    this.appliedScale = scale;
    // Bump generation so any concurrent in-flight traversal aborts.
    const gen = ++this.scaleGen;

    const candidates = typeof document !== 'undefined'
      ? Array.from(document.querySelectorAll(TEXT_ELEMENT_SELECTOR)).filter(el =>
        !_shouldSkipScale(el) && !(el.dataset && el.dataset.ai4a11yFontScale === String(scale)))
      : [];
    if (!candidates.length) return;

    // PASS 1 (synchronous): snapshot every candidate's baseline computed
    // font-size BEFORE writing any inline styles. This prevents
    // cascade-amplification: scaling a parent element would otherwise change
    // descendant computed sizes before we read them, causing compounding.
    //
    // Incremental sweep path (content added after the first pass, inside text
    // we already enlarged): its computed size can't tell an inherited size
    // (already enlarged) from the page's own px size (not enlarged yet), so
    // dividing by the ancestor's scale left every re-rendered search result at
    // its old size. Read the true sizes with our enlargement briefly taken off;
    // it is put back in this same task, before anything paints.
    const scaled = typeof document !== 'undefined'
      ? Array.from(document.querySelectorAll('[data-ai4a11y-font-scale]'))
      : [];
    const scaledNow = scaled.map(el => el.style.fontSize);
    scaled.forEach(el => {
      const orig = _fontScaleOriginals.get(el);
      el.style.fontSize = (orig === undefined || orig === null) ? '' : orig;
    });
    const scalePlan = []; // [{ el, baselinePx }]
    for (const el of candidates) {
      // Record the original inline value on first visit.
      if (!_fontScaleOriginals.has(el)) {
        _fontScaleOriginals.set(el, el.style.fontSize);
      }
      try {
        const baselinePx = parseFloat(getComputedStyle(el).fontSize);
        if (!baselinePx || baselinePx <= 0) continue;
        scalePlan.push({ el, baselinePx });
      } catch (_) {}
    }
    scaled.forEach((el, k) => { el.style.fontSize = scaledNow[k]; });

    // PASS 2 (chunked, async): write the pre-computed scaled sizes.
    let i = 0;
    const processChunk = (deadline) => {
      // Abort if a newer traversal has started (scale changed or restore ran).
      if (gen !== this.scaleGen) return;

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
        if (gen !== this.scaleGen) return;
        const { el, baselinePx } = scalePlan[i++];
        el.style.fontSize = `${_scaledSize(baselinePx, scale)}px`;
        if (el.dataset) el.dataset.ai4a11yFontScale = String(scale);
      }
      this.growFixedBoxes();
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

  // Find boxes that can't grow with their text (see FIXED_BOX_ATTR) and pin
  // their text size and line and letter spacing to the page's own, which the
  // text inside inherits; the font traversal and the spacing rules skip what's
  // inside.
  markFixedBoxes() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!this.fixedBoxes) { this.fixedBoxes = new Map(); this.fixedChecked = new WeakSet(); }
    const found = [];
    for (const el of document.body.querySelectorAll(TEXT_ELEMENT_SELECTOR)) {
      if (this.fixedChecked.has(el)) continue;
      this.fixedChecked.add(el);
      if (_shouldSkipScale(el)) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (cs.position !== 'absolute' || !_insetSet(el, 'top') || !_insetSet(el, 'bottom')) continue;
      if (!(el.textContent || '').trim()) continue;
      found.push(el);
    }
    if (!found.length) return;
    // Read the page's own values: our stylesheet off, and text we already
    // enlarged around each box back to its size, for this synchronous read
    // only (nothing paints in between).
    const sheet = document.getElementById(this.styleId)?.sheet;
    if (sheet) sheet.disabled = true;
    const lifted = new Map();
    for (const el of found) {
      for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
        if (!a.dataset || !a.dataset.ai4a11yFontScale || lifted.has(a)) continue;
        lifted.set(a, a.style.fontSize);
        const orig = _fontScaleOriginals.get(a);
        a.style.fontSize = (orig === undefined || orig === null) ? '' : orig;
      }
    }
    const own = found.map(el => {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      // Line height as a ratio, so text of other sizes inside inherits the right spacing.
      const lh = cs.lineHeight === 'normal' || !fs || !parseFloat(cs.lineHeight)
        ? 'normal' : String(Math.round(parseFloat(cs.lineHeight) / fs * 1000) / 1000);
      return { 'font-size': cs.fontSize, 'line-height': lh, 'letter-spacing': cs.letterSpacing || 'normal' };
    });
    for (const [a, v] of lifted) a.style.fontSize = v;
    if (sheet) sheet.disabled = false;
    found.forEach((el, k) => {
      if (el.closest(`[${FIXED_BOX_ATTR}]`)) return; // inside one found in this same pass
      const saved = {};
      for (const prop of Object.keys(own[k])) {
        saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      }
      // Text in it that an earlier pass already enlarged goes back to its size.
      for (const t of [el, ...el.querySelectorAll('[data-ai4a11y-font-scale]')]) {
        if (!t.dataset || !t.dataset.ai4a11yFontScale) continue;
        const orig = _fontScaleOriginals.get(t);
        t.style.fontSize = (orig === undefined || orig === null) ? '' : orig;
        _fontScaleOriginals.delete(t);
        delete t.dataset.ai4a11yFontScale;
      }
      this.fixedBoxes.set(el, saved);
      el.setAttribute(FIXED_BOX_ATTR, '');
      for (const prop of Object.keys(own[k])) el.style.setProperty(prop, own[k][prop], 'important');
    });
  },

  unmarkFixedBoxes() {
    if (!this.fixedBoxes) return;
    for (const [el, saved] of this.fixedBoxes) {
      try {
        el.removeAttribute(FIXED_BOX_ATTR);
        for (const prop of Object.keys(saved)) el.style.setProperty(prop, saved[prop][0], saved[prop][1]);
        if (!el.getAttribute('style')) el.removeAttribute('style');
      } catch (_) { /* detached */ }
    }
    this.fixedBoxes = null;
    this.fixedChecked = null;
  },

  // Boxes whose content overflows them vertically right now.
  overflowing() {
    const out = new WeakSet();
    if (typeof document === 'undefined' || !document.body) return out;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 1) out.add(el);
    }
    return out;
  },

  // A box the page gave a fixed height (a 64 px header bar) can't hold
  // enlarged text that wraps onto another line: the text spilled out above
  // and below it and was cut off at the top of the page. Let such a box grow
  // (it keeps at least its old height). Only boxes that overflow now and
  // didn't before we changed anything, so a page's own overflow is left alone.
  growFixedBoxes() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!this.grown) this.grown = new Map();
    for (const el of document.body.querySelectorAll('*')) {
      if (!(el.scrollHeight > el.clientHeight + 1)) continue; // fits (also: no layout, e.g. jsdom)
      if (this.grown.has(el) || (this.overflowBefore && this.overflowBefore.has(el))) continue;
      if (_shouldSkipScale(el) || typeof el.computedStyleMap !== 'function') continue;
      let cs, h;
      try { cs = getComputedStyle(el); h = String(el.computedStyleMap().get('height')); } catch (_) { continue; }
      if (cs.overflowY !== 'visible' || cs.display === 'inline' || !/^[\d.]+(px|em|rem)$/.test(h)) continue;
      this.grown.set(el, [el.style.getPropertyValue('height'), el.style.getPropertyPriority('height'),
        el.style.getPropertyValue('min-height'), el.style.getPropertyPriority('min-height')]);
      el.style.setProperty('min-height', cs.height, 'important');
      el.style.setProperty('height', 'auto', 'important');
    }
  },

  ungrowFixedBoxes() {
    if (!this.grown) return;
    for (const [el, v] of this.grown) {
      try {
        el.style.setProperty('height', v[0], v[1]);
        el.style.setProperty('min-height', v[2], v[3]);
        if (!el.getAttribute('style')) el.removeAttribute('style');
      } catch (_) { /* detached */ }
    }
    this.grown = null;
  },

  restoreFontScale() {
    if (typeof document === 'undefined') return;
    // Bump generation to abort any in-flight applyFontScale traversal.
    this.scaleGen++;
    // dataset.ai4a11yFontScale (camelCase) -> attribute data-ai4a11y-font-scale (hyphen)
    document.querySelectorAll('[data-ai4a11y-font-scale]').forEach(el => {
      const orig = _fontScaleOriginals.get(el);
      // orig is the inline font-size string before we touched it.
      // Empty string '' means no inline style was set — clear it back to nothing.
      el.style.fontSize = (orig === undefined || orig === null) ? '' : orig;
      _fontScaleOriginals.delete(el);
      if (el.dataset) delete el.dataset.ai4a11yFontScale;
    });
    this.appliedScale = null;
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

    // fontScale is handled via DOM traversal (applyFontScale) — no CSS zoom rule.
    // Longer labels beside a radio or checkbox in a flex row squeezed the box
    // into an oval; keep it its own size.
    if (s.fontScale && s.fontScale !== 1 && s.fontScale !== 100) {
      css += `input[type="radio"], input[type="checkbox"] { flex-shrink: 0 !important; }\n`;
    }

    // Line and letter spacing go on running text only and reach the rest by
    // inheritance. Forcing them on every div/span/a also hit large headings
    // (many sites style divs as headings), stretching a two-line title over
    // twice the height, and pushed small badges (a cart count) onto their icons.
    const TEXT = 'body, ' + ['p', 'li', 'td', 'th', 'dd', 'dt', 'label', 'blockquote', 'figcaption']
      .map(t => `${t}:not([${FIXED_BOX_ATTR}] *)`).join(', ');
    if (s.lineHeight && s.lineHeight !== 1.5) {
      css += `${TEXT} { line-height: ${s.lineHeight} !important; }\n`;
    }

    if (s.letterSpacing && s.letterSpacing !== 0) {
      css += `${TEXT} { letter-spacing: ${s.letterSpacing}em !important; }\n`;
    }

    if (s.largeCursor) {
      css += `* { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="%230066ff" opacity="0.5"/><circle cx="16" cy="16" r="4" fill="%23000"/></svg>'), auto !important; }\n`;
    }

    if (s.enhanceFocus) {
      // Keep :focus-visible only — no bare *:focus rule (would flash outlines on
      // mouse clicks, which keyboard-nav.js also avoids).
      // :not(#ai4a11y-focus) adds an id's weight: sites that switch the outline
      // off do it with !important too (e.g. `html[data-x] *:focus-visible
      // { outline: none !important }`), and a plain *:focus-visible lost to that.
      css += `
        *:focus-visible:not(#ai4a11y-focus) {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
      `;
    }

    if (s.dyslexiaFont) {
      // chrome.runtime.getURL only available in extension context
      const fontUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('lib/OpenDyslexic-Regular.woff2')
        : 'https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff2';
      css += `@font-face { font-family: 'OpenDyslexic'; src: url('${fontUrl}'); }\n`;
      // Apply to broad text elements; exclude icon font patterns via :not() chains
      // rather than forcing font-family on everything (which broke icon glyphs).
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

  enableReadingGuide() {
    if (this.readingGuideEl) return;

    this.readingGuideEl = document.createElement('div');
    this.readingGuideEl.className = 'ai4a11y-reading-guide';
    document.body.appendChild(this.readingGuideEl);

    // Mouse tracking: plain clientY — no zoom-compensation needed because
    // fontScale uses DOM traversal instead of the old CSS `zoom` rule.
    this.readingGuideMouseHandler = (e) => {
      if (this.readingGuideEl) {
        this.readingGuideEl.style.top = `${e.clientY - 20}px`;
      }
    };
    document.addEventListener('mousemove', this.readingGuideMouseHandler, { passive: true });

    // Keyboard mode: on focusin, snap the guide to the focused element's
    // vertical center — makes the reading guide usable for keyboard-only users.
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
  }
};

if (typeof window !== 'undefined') window.__ai4a11yVisualAssist = VisualAssist;
