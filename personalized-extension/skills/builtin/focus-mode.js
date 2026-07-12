import { announce } from '../../utils/ai.js';
import { registerSweep } from '../../utils/observe.js';

// focus-mode — Phase 3 subtractive cleanup:
//   - Removed always-on hover-highlight (p:hover/li:hover/td:hover rule).
//     It fired even when all options were false and was unreadable on dark themes.
//   - Removed dead dimBackground code branch (option had no settingsMeta key
//     and no caller — only hideDistractions and showProgress are active).
//   - Progress bar re-appended via registerSweep if SPA body replacement detaches it.

export const FocusMode = {
  styleId: 'ai4a11y-focus-mode-styles',
  enabled: false,
  progressEl: null,
  progressHandler: null,
  _unwatchSweep: null,
  currentSettings: {
    hideDistractions: false,
    dimOpacity: 0.5,
    showProgress: true
  },

  distractionSelectors: [
    'ins.adsbygoogle', '[data-ad]', '.ad-container', '.ad-banner',
    '[id*="google_ads"]', '[class*="advert"]',
    '.social-buttons', '.share-buttons', '.social-share',
    '[class*="popup"]', '[class*="newsletter"]', '[class*="subscribe"]',
    '[class*="cookie-banner"]', '[class*="consent-banner"]', '[class*="gdpr-banner"]'
  ],

  enable(options = {}) {
    document.getElementById(this.styleId)?.remove();
    this.disableProgressIndicator();
    if (this._unwatchSweep) { this._unwatchSweep(); this._unwatchSweep = null; }

    this.currentSettings = { ...this.currentSettings, ...options };
    this.enabled = true;

    const s = this.currentSettings;
    let css = '';

    if (s.hideDistractions) {
      css += `
        ${this.distractionSelectors.join(', ')} {
          opacity: ${s.dimOpacity} !important;
          transition: opacity 0.3s ease !important;
        }
        ${this.distractionSelectors.join(':hover, ')}:hover {
          opacity: 1 !important;
        }
      `;
    }

    // NOTE: dimBackground option is intentionally absent — no settingsMeta key
    // or caller exists. The dead code branch was removed in Phase 3.

    // NOTE: the always-on hover-highlight rule (p:hover/li:hover/td:hover) was
    // removed in Phase 3 — it fired even with all options false and was
    // unreadable on dark themes.

    if (s.showProgress) {
      this.enableProgressIndicator();
    }

    if (css) {
      const style = document.createElement('style');
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }

    // Re-append progress bar if SPA body replacement detaches it.
    this._unwatchSweep = registerSweep('focus-mode', () => {
      if (this.enabled && this.progressEl && !document.contains(this.progressEl)) {
        document.body.appendChild(this.progressEl);
      }
    });

    console.log('[AI4A11y] Focus Mode enabled', this.currentSettings);
    announce('Focus mode enabled');
  },

  disable() {
    this.enabled = false;
    document.getElementById(this.styleId)?.remove();
    this.disableProgressIndicator();
    if (this._unwatchSweep) { this._unwatchSweep(); this._unwatchSweep = null; }
    console.log('[AI4A11y] Focus Mode disabled');
    announce('Focus mode disabled');
  },

  enableProgressIndicator() {
    this.disableProgressIndicator();

    this.progressEl = document.createElement('div');
    this.progressEl.id = 'ai4a11y-progress';
    this.progressEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      height: 4px;
      background: linear-gradient(90deg, #4caf50, #8bc34a);
      z-index: 100000;
      transition: width 0.1s ease;
      width: 0%;
    `;
    document.body.appendChild(this.progressEl);

    this.progressRafPending = false;
    this.progressHandler = () => {
      if (this.progressRafPending) return;
      this.progressRafPending = true;
      requestAnimationFrame(() => {
        this.progressRafPending = false;
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        if (this.progressEl) {
          this.progressEl.style.width = `${progress}%`;
        }
      });
    };
    document.addEventListener('scroll', this.progressHandler, { passive: true });
    this.progressHandler();
  },

  disableProgressIndicator() {
    if (this.progressEl) {
      this.progressEl.remove();
      this.progressEl = null;
    }
    if (this.progressHandler) {
      document.removeEventListener('scroll', this.progressHandler);
      this.progressHandler = null;
    }
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

window.__ai4a11yFocusMode = FocusMode;
