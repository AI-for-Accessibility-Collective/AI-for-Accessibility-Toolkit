import { announce } from '../../utils/ai.js';

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
    style.textContent = `
      html {
        filter: invert(90%) hue-rotate(180deg) !important;
        background: #111 !important;
      }
      img, video, picture, canvas, iframe, svg, [style*="background-image"] {
        filter: invert(100%) hue-rotate(180deg) !important;
      }
      img, video {
        filter: invert(100%) hue-rotate(180deg) contrast(1.1) !important;
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
    if (this.enabled) this.disable();
    else this.enable();
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

window.__ai4a11yDarkMode = DarkMode;
