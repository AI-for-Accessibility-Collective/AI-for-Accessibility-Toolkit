/**
 * Visual Assist - text/display adjustments (font, spacing, cursor, focus)
 *
 * Note: DarkMode, MotionReducer, ColorBlindMode are in separate files.
 */

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
    this.disableReadingGuide();
  },

  apply() {
    this.remove();

    const css = this.generateCSS();
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);
  },

  remove() {
    document.getElementById(this.styleId)?.remove();
  },

  generateCSS() {
    const s = this.settings;
    let css = '';

    // High contrast modes
    if (s.contrastMode === 'light') {
      css += `
        html { background: #fff !important; }
        body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a {
          color: #000 !important;
          background: #fff !important;
        }
        a { text-decoration: underline !important; }
        img, video { filter: contrast(1.2) !important; }
      `;
    } else if (s.contrastMode === 'yellow-black') {
      css += `
        html { background: #000 !important; }
        body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
          color: #ff0 !important;
          background: #000 !important;
        }
        a { color: #0ff !important; text-decoration: underline !important; }
        img, video { filter: contrast(1.2) brightness(0.9) !important; }
      `;
    }

    // Normalize fontScale: values > 10 are percentages (e.g., 150), ≤ 10 are multipliers (e.g., 1.5)
    let scale = s.fontScale > 10 ? s.fontScale / 100 : s.fontScale;
    // Validate bounds (0.5 to 3.0 = 50% to 300%)
    if (scale && scale > 0 && scale !== 1.0) {
      scale = Math.max(0.5, Math.min(3.0, scale));
      // Use zoom for true scaling (better for low vision - scales everything including images)
      css += `html { zoom: ${scale} !important; }\n`;
    }

    if (s.lineHeight && s.lineHeight !== 1.5) {
      css += `body, p, li, td, th { line-height: ${s.lineHeight} !important; }\n`;
    }

    if (s.letterSpacing && s.letterSpacing !== 0) {
      css += `body { letter-spacing: ${s.letterSpacing}em !important; }\n`;
    }

    if (s.largeCursor) {
      css += `* { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="black"/><circle cx="16" cy="16" r="10" fill="white"/></svg>'), auto !important; }\n`;
    }

    if (s.enhanceFocus) {
      css += `
        *:focus, *:focus-visible {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
        a:focus, button:focus, input:focus, select:focus, textarea:focus, [tabindex]:focus {
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
      css += `body, p, li, td, th, span, div { font-family: 'OpenDyslexic', sans-serif !important; }\n`;
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

  // Reading guide element and handler
  readingGuideEl: null,
  readingGuideHandler: null,

  enableReadingGuide() {
    if (this.readingGuideEl) return;

    this.readingGuideEl = document.createElement('div');
    this.readingGuideEl.className = 'ai4a11y-reading-guide';
    document.body.appendChild(this.readingGuideEl);

    this.readingGuideRafPending = false;
    this.lastMouseY = 0;
    this.readingGuideHandler = (e) => {
      this.lastMouseY = e.clientY;
      if (this.readingGuideRafPending) return;
      this.readingGuideRafPending = true;
      requestAnimationFrame(() => {
        this.readingGuideRafPending = false;
        if (this.readingGuideEl) {
          this.readingGuideEl.style.top = `${this.lastMouseY - 20}px`;
        }
      });
    };
    document.addEventListener('mousemove', this.readingGuideHandler, { passive: true });
  },

  disableReadingGuide() {
    if (this.readingGuideEl) {
      this.readingGuideEl.remove();
      this.readingGuideEl = null;
    }
    if (this.readingGuideHandler) {
      document.removeEventListener('mousemove', this.readingGuideHandler);
      this.readingGuideHandler = null;
    }
  }
};

window.__ai4a11yVisualAssist = VisualAssist;
