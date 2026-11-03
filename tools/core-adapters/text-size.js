// Text size and spacing: makes text bigger and gives it more room, as the person's settings say.
// For vision and reading barriers: text too small to read, crowded lines, cramped letters.
// Suggested in onboarding for: vision, reading (a suggestion only, never a gate).
//
// The person's settings it reads:
//   fontScale: text size in percent, 100 to 200 (default 100).
//   textSizeMethod: 'zoom' (browser zoom) or 'font' (text size alone).
//   lineHeight: line spacing multiplier, 1.0 to 3.0 (up to 2.0 via shortcut).
//   letterSpacing: letter spacing in em, 0 to 0.5 (up to 0.12 em for WCAG 1.4.12).
//
// What the person can adjust:
//   Alt+Shift+Equal: increases fontScale by 10% (up to 200%).
//   Alt+Shift+Minus: decreases fontScale by 10% (down to 100%).
//   Alt+Shift+L: cycles lineHeight through 1.5, 1.8, 2.0, and back to the page's own.
//   Alt+Shift+G: saves the current text size and spacing values for every site.
//   Each adjustment is saved for this site and announced to screen readers.
//
// Developer options (passed to enable()):
//   method: 'zoom' | 'font' (default 'zoom') - builder default when person has no preference.
//   fontScale: number (100-200) - builder default text size percentage.
//   lineHeight: number (1.0-3.0) - builder default line spacing ratio.
//   letterSpacing: number (0-0.5) - builder default letter spacing in em.
//   wordSpacing: number (e.g. 0.16) - builder default word spacing in em.
//   paragraphSpacing: number (e.g. 2.0) - builder default paragraph margin-bottom in em.
//   wcagSpacing: boolean - when true, sets WCAG 1.4.12 defaults (lineHeight 1.5, letterSpacing 0.12em, wordSpacing 0.16em, paragraphSpacing 2em).
//
// Key decisions:
//   - Zoom or text size alone, as s.zoom.method() says, never both.
//   - With 'zoom', adjusts the browser's native zoom via s.zoom.set(), which reflows the page
//     naturally and is restored on disable().
//   - With 'font', snapshots baseline computed font sizes across text elements synchronously
//     in Pass 1 before changing any inline styles, preventing cascade amplification (where nested
//     elements compound parent multipliers). Pass 2 applies explicit pixel sizes.
//   - Leaves banner text pinned at both top and bottom (fixed-inset boxes) untouched so absolute
//     layouts do not break.
//   - Detects boxes with fixed height or max-height where enlarged text causes vertical overflow
//     (scrollHeight > clientHeight + 1) and lets them grow (height: auto !important, min-height: original),
//     preventing text cut off.
//   - Line and letter spacing follow WCAG 1.4.12 on text-bearing elements without breaking icon glyphs.
//   - Radio buttons and checkboxes are protected from squishing in flex containers (flex-shrink: 0).
//   - Word-wrapping rules prevent horizontal overflow and sideways scrolling at 320px wide.
//   - Applies once synchronously in enable(); does nothing (returns false) when no setting asks for it
//     unless the person adjusts it via keyboard shortcuts.
//
// What it cannot do:
//   - Cannot scale text inside cross-origin iframes or closed shadow DOM roots.
//   - Cannot enlarge text embedded inside raster images (PNG, JPEG) or canvas drawings.

const TEXT_ELEMENT_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, td, th, div, span, a, button, ' +
  'input, select, textarea, label, blockquote, pre, figcaption, caption, dt, dd, ' +
  'summary, article, section, header, footer, nav, main, aside, ' +
  'small, b, strong, em, legend';

const SPACING_TEXT_SELECTOR =
  'body, p, h1, h2, h3, h4, h5, h6, li, td, th, dd, dt, label, blockquote, figcaption';

function isFixedInsetBox(el) {
  try {
    if (typeof el.computedStyleMap !== 'function') return false;
    const map = el.computedStyleMap();
    const top = map.get('top');
    const bottom = map.get('bottom');
    if (top && bottom && String(top) !== 'auto' && String(bottom) !== 'auto') {
      const cs = window.getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') return true;
    }
  } catch (_) {}
  return false;
}

export default {
  s: null,
  baselineMap: null,
  overflowingBefore: null,
  currentFontScale: 100,
  currentLineHeight: null,
  currentLetterSpacing: null,
  currentWordSpacing: null,
  currentParagraphSpacing: null,
  currentMethod: 'zoom',

  enable(options = {}, toolkit) {
    if (this.s && !this.s.ended) return;
    const s = (this.s = toolkit.session());
    this.baselineMap = new WeakMap();
    this.overflowingBefore = new WeakSet();

    // Snapshot pre-existing overflowing elements before touching anything
    if (typeof document !== 'undefined') {
      for (const el of document.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 1) {
          this.overflowingBefore.add(el);
        }
      }
    }

    // Determine initial settings from profile and options
    const p = s.profile.get() || {};
    const method = s.zoom.method(options.method || 'zoom');
    this.currentMethod = method;

    const initialFontScale = p.fontScale !== undefined ? p.fontScale : (options.fontScale !== undefined ? options.fontScale : 100);
    this.currentFontScale = typeof initialFontScale === 'number' ? Math.max(100, Math.min(200, Math.round(initialFontScale))) : 100;

    const wcag = !!options.wcagSpacing;
    this.currentLineHeight = p.lineHeight !== undefined ? p.lineHeight : (options.lineHeight !== undefined ? options.lineHeight : (wcag ? 1.5 : null));
    this.currentLetterSpacing = p.letterSpacing !== undefined ? p.letterSpacing : (options.letterSpacing !== undefined ? options.letterSpacing : (wcag ? 0.12 : null));
    this.currentWordSpacing = options.wordSpacing !== undefined ? options.wordSpacing : (p.wordSpacing !== undefined ? p.wordSpacing : (wcag ? 0.16 : null));
    this.currentParagraphSpacing = options.paragraphSpacing !== undefined ? options.paragraphSpacing : (p.paragraphSpacing !== undefined ? p.paragraphSpacing : (wcag ? 2 : null));

    // Register keyboard shortcuts
    s.keys.shortcut({ code: 'Equal', alt: true, shift: true }, async () => {
      const nextScale = Math.min(200, this.currentFontScale + 10);
      this.currentFontScale = nextScale;
      await s.profile.set({ fontScale: nextScale });
      await this.applyChanges(s, toolkit);
      s.announce(`Text size ${nextScale}% on this site. Use Alt+Shift+G to use on every site.`);
    });

    s.keys.shortcut({ code: 'Minus', alt: true, shift: true }, async () => {
      const nextScale = Math.max(100, this.currentFontScale - 10);
      this.currentFontScale = nextScale;
      await s.profile.set({ fontScale: nextScale });
      await this.applyChanges(s, toolkit);
      s.announce(`Text size ${nextScale}% on this site. Use Alt+Shift+G to use on every site.`);
    });

    s.keys.shortcut({ code: 'KeyL', alt: true, shift: true }, async () => {
      const lh = this.currentLineHeight;
      let nextLh;
      if (lh === 1.5) nextLh = 1.8;
      else if (lh === 1.8) nextLh = 2.0;
      else if (lh === 2.0) nextLh = null; // back to page's own
      else nextLh = 1.5;

      this.currentLineHeight = nextLh;
      if (nextLh !== null) {
        await s.profile.set({ lineHeight: nextLh });
        s.announce(`Line height ${nextLh} on this site. Use Alt+Shift+G to use on every site.`);
      } else {
        s.announce("Line height: page's own.");
      }
      await this.applyChanges(s, toolkit);
    });

    s.keys.shortcut({ code: 'KeyG', alt: true, shift: true }, async () => {
      const changes = {};
      if (this.currentFontScale !== undefined) changes.fontScale = this.currentFontScale;
      if (this.currentLineHeight !== null && this.currentLineHeight !== undefined) changes.lineHeight = this.currentLineHeight;
      if (this.currentLetterSpacing !== null && this.currentLetterSpacing !== undefined) changes.letterSpacing = this.currentLetterSpacing;
      if (this.currentMethod) changes.textSizeMethod = this.currentMethod;

      if (Object.keys(changes).length > 0) {
        await s.profile.set(changes, { scope: 'all' });
        s.announce(`Text size ${this.currentFontScale}% saved for every site.`);
      }
    });

    // Follow profile changes made elsewhere
    s.profile.onChange(async (personal, changed) => {
      if (!s.alive()) return;
      if (changed.fontScale !== undefined) this.currentFontScale = changed.fontScale;
      if (changed.lineHeight !== undefined) this.currentLineHeight = changed.lineHeight;
      if (changed.letterSpacing !== undefined) this.currentLetterSpacing = changed.letterSpacing;
      if (changed.textSizeMethod !== undefined) this.currentMethod = s.zoom.method(options.method || 'zoom');
      await this.applyChanges(s, toolkit);
    });

    // Check if any setting or option asks for enlargement or spacing
    const hasFontScale = this.currentFontScale > 100;
    const hasLineHeight = typeof this.currentLineHeight === 'number' && this.currentLineHeight > 0;
    const hasLetterSpacing = typeof this.currentLetterSpacing === 'number' && this.currentLetterSpacing > 0;
    const hasWordSpacing = typeof this.currentWordSpacing === 'number' && this.currentWordSpacing > 0;
    const hasParagraphSpacing = typeof this.currentParagraphSpacing === 'number' && this.currentParagraphSpacing > 0;

    const asked = hasFontScale || hasLineHeight || hasLetterSpacing || hasWordSpacing || hasParagraphSpacing;

    if (!asked) {
      return false;
    }

    return this.applyChanges(s, toolkit);
  },

  disable() {
    this.s?.end();
    this.s = null;
    this.baselineMap = null;
    this.overflowingBefore = null;
    this.currentFontScale = 100;
    this.currentLineHeight = null;
    this.currentLetterSpacing = null;
    this.currentWordSpacing = null;
    this.currentParagraphSpacing = null;
    this.currentMethod = 'zoom';
  },

  async applyChanges(s, toolkit) {
    if (!s.alive()) return;

    // 1. Spacing Stylesheet
    this.updateSpacingCSS(s);

    // 2. Text Sizing (Zoom or Font, never both)
    if (this.currentMethod === 'zoom') {
      const factor = (this.currentFontScale || 100) / 100;
      await s.zoom.set(factor);
    } else {
      // Font method: scale font-size in DOM
      const scale = (this.currentFontScale || 100) / 100;
      this.applyFontScale(scale, s, toolkit);
    }

    // 3. Let fixed-height boxes grow if text wraps and overflows
    this.growFixedBoxes(s, toolkit);
  },

  updateSpacingCSS(s) {
    let css = '';
    // Prevent radio buttons and checkboxes from squishing into ovals in flex rows
    css += 'input[type="radio"], input[type="checkbox"] { flex-shrink: 0 !important; }\n';
    // Ensure text wraps cleanly to prevent horizontal overflow and sideways scrolling at 320px
    css += 'body, p, li, td, th { overflow-wrap: break-word; }\n';

    if (this.currentLineHeight) {
      css += `${SPACING_TEXT_SELECTOR} { line-height: ${this.currentLineHeight} !important; }\n`;
    }
    if (this.currentLetterSpacing) {
      css += `${SPACING_TEXT_SELECTOR} { letter-spacing: ${this.currentLetterSpacing}em !important; }\n`;
    }
    if (this.currentWordSpacing) {
      const ws = typeof this.currentWordSpacing === 'number' ? this.currentWordSpacing : 0.16;
      css += `${SPACING_TEXT_SELECTOR} { word-spacing: ${ws}em !important; }\n`;
    }
    if (this.currentParagraphSpacing) {
      const ps = typeof this.currentParagraphSpacing === 'number' ? this.currentParagraphSpacing : 2;
      css += `p { margin-bottom: ${ps}em !important; }\n`;
    }

    s.css('text-size-spacing', css);
  },

  applyFontScale(scale, s, toolkit) {
    if (typeof document === 'undefined' || !document.body) return;

    const candidates = [];
    const elements = [document.body, ...document.body.querySelectorAll(TEXT_ELEMENT_SELECTOR)];

    for (const el of elements) {
      if (!el || !el.tagName) continue;
      if (toolkit.page.isOurs(el)) continue;
      const tag = el.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'MATH') continue;

      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.includes('material-icons') || cls.includes('material-symbols') || cls.includes('fa-') || (tag === 'I' && el.textContent.length < 4)) continue;
      if (el.getAttribute('aria-hidden') === 'true' && !el.textContent.trim()) continue;
      if (isFixedInsetBox(el)) continue;

      candidates.push(el);
    }

    // PASS 1: snapshot baseline computed font sizes before writing any styles
    const plan = [];
    for (const el of candidates) {
      let baselinePx = this.baselineMap.get(el);
      if (baselinePx === undefined) {
        try {
          const cs = window.getComputedStyle(el);
          baselinePx = parseFloat(cs.fontSize);
          if (baselinePx && baselinePx > 0) {
            this.baselineMap.set(el, baselinePx);
          }
        } catch (_) {}
      }
      if (baselinePx && baselinePx > 0) {
        plan.push({ el, baselinePx });
      }
    }

    // PASS 2: apply scaled pixel sizes
    for (const { el, baselinePx } of plan) {
      if (scale === 1.0) {
        s.setStyle(el, 'font-size', '');
      } else {
        const targetPx = Math.round(baselinePx * scale * 100) / 100;
        s.setStyle(el, 'font-size', `${targetPx}px`);
      }
    }
  },

  growFixedBoxes(s, toolkit) {
    if (typeof document === 'undefined') return;

    for (const el of document.querySelectorAll('*')) {
      if (toolkit.page.isOurs(el)) continue;
      if (el.scrollHeight > el.clientHeight + 1 && (!this.overflowingBefore || !this.overflowingBefore.has(el))) {
        let cs;
        try { cs = window.getComputedStyle(el); } catch (_) { continue; }
        if (cs.display === 'inline') continue;

        if (cs.height !== 'auto' && cs.height !== '0px') {
          s.setStyle(el, 'min-height', cs.height, 'important');
          s.setStyle(el, 'height', 'auto', 'important');
        }
        if (cs.maxHeight !== 'none') {
          s.setStyle(el, 'max-height', 'none', 'important');
        }
      }
    }
  },
};
