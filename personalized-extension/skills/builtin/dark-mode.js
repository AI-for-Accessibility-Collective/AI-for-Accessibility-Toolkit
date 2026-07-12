import { announce } from '../../utils/ai.js';

// dark-mode — Phase 3 cleanup:
//   (a) Deleted dead DarkReader branch. DarkReader is NOT bundled; the typeof
//       guard could never pass. CSS-filter invert is the only implementation.
//       Registry description corrected (was "using DarkReader or CSS fallback").
//   (b) Fixed duplicate img/video rule (merged into one rule with contrast bump).
//   (c) Arbitration with color-filter: if color-filter's style element exists
//       when enable() is called, skip enabling dark mode (color-filter is the
//       assistive adapter and takes precedence). The reverse is handled by
//       injection order in content.js — color-filter's rule comes after dark mode.
//   (d) prefers-color-scheme auto-respect: handled in content.js (watchSystemPrefs
//       already wired; dark-mode.js is stateless about whether it was auto-enabled).

export const DarkMode = {
  enabled: false,
  styleId: 'ai4a11y-dark-mode',
  // The color-filter style id — used to detect the conflict at enable() time.
  _colorFilterStyleId: 'ai4a11y-color-blind-styles',

  enable(options = {}) {
    // Arbitration: color-filter is the assistive adapter; if it's active, dark
    // mode's html{filter} would compose with it in unpredictable ways.
    // Skip enabling and log — color-filter takes precedence.
    if (document.getElementById(this._colorFilterStyleId)) {
      console.log('[AI4A11y] Dark Mode skipped — color-filter is active and takes precedence');
      announce('Dark mode skipped: color filter is active');
      return false; // signal to content.js that enable did not start
    }

    this.enabled = true;
    this._enableCSS();
    announce('Dark mode enabled');
  },

  _enableCSS() {
    if (document.getElementById(this.styleId)) return;
    const style = document.createElement('style');
    style.id = this.styleId;
    // Single merged rule for media that should be re-inverted back to natural color
    // (images, video, canvas, iframe, SVG, inline background-image elements).
    // Uses a single selector block to avoid the silent-override bug from two rules.
    style.textContent = `
      html {
        filter: invert(90%) hue-rotate(180deg) !important;
        background: #111 !important;
      }
      img, video, picture, canvas, iframe, svg, [style*="background-image"] {
        filter: invert(100%) hue-rotate(180deg) contrast(1.1) !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[AI4A11y] Dark Mode enabled (CSS filter)');
  },

  disable() {
    document.getElementById(this.styleId)?.remove();
    this.enabled = false;
    console.log('[AI4A11y] Dark Mode disabled');
    announce('Dark mode disabled');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

window.__ai4a11yDarkMode = DarkMode;
