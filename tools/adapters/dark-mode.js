// Dark Mode - uses DarkReader or CSS fallback
import { announce } from '../utils/ai.js';

// dark-mode, reduce-brightness and color-blind all filter <html>, and one
// filter declaration replaces another: with two of them on, one silently did
// nothing (dark mode + dim gave a dimmed, light page). Each sets its own
// variable instead, and the same rule in each stylesheet combines whichever
// are set, in a fixed order.
const PAGE_FILTER = 'html { filter: var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,) !important; }';

export const DarkMode = {
  enabled: false,
  styleId: 'ai4a11y-dark-mode',
  settings: {
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0
  },

  enable(options = {}) {
    this.settings = { ...this.settings, ...options };
    this.enabled = true;

    if (typeof DarkReader !== 'undefined') {
      try {
        DarkReader.enable({
          brightness: this.settings.brightness,
          contrast: this.settings.contrast,
          sepia: this.settings.sepia,
          grayscale: this.settings.grayscale
        });
        console.log('[AI4A11y] Dark Mode enabled (DarkReader)');
      } catch (e) {
        console.log('[AI4A11y] DarkReader failed, using CSS fallback');
        this.enableCSSFallback();
      }
    } else {
      console.log('[AI4A11y] DarkReader not available, using CSS fallback');
      this.enableCSSFallback();
    }

    announce('Dark mode enabled');
  },

  enableCSSFallback() {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement('style');
    style.id = this.styleId;
    // Photos, video and colors set inline on an element (product color
    // swatches) are inverted back so they keep their real colors: inverted
    // with the page, the "White" swatch showed black. Inline SVG is not:
    // it is mostly icons drawn in the text color, and inverting those back
    // left a white cart icon on the now light header. Media inside an element
    // that is already inverted back stays as it is, or it would flip twice.
    const BACK = 'img, video, picture, canvas, iframe, [style*="background-image"], [style*="background:"], [style*="background-color"]';
    style.textContent = `
      html {
        --ai4a11y-filter-dark: invert(90%) hue-rotate(180deg);
        background: #111 !important;
      }
      ${PAGE_FILTER}
      ${BACK} {
        filter: invert(100%) hue-rotate(180deg) !important;
      }
      img, video {
        filter: invert(100%) hue-rotate(180deg) contrast(1.1) !important;
      }
      :is(${BACK}) :is(img, video, picture, canvas, iframe) {
        filter: none !important;
      }
    `;
    document.head.appendChild(style);
  },

  disable() {
    if (typeof DarkReader !== 'undefined') {
      try { DarkReader.disable(); } catch (e) {}
    }
    document.getElementById(this.styleId)?.remove();

    this.enabled = false;
    console.log('[AI4A11y] Dark Mode disabled');
    announce('Dark mode disabled');
  },

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  },

  setTheme(options) {
    if (this.enabled) {
      this.settings = { ...this.settings, ...options };
      if (typeof DarkReader !== 'undefined') {
        try { DarkReader.enable(this.settings); } catch (e) {}
      }
    }
  }
};

if (typeof window !== 'undefined') window.__ai4a11yDarkMode = DarkMode;
