import { announce } from '../../utils/ai.js';

export const FocusMode = {
  styleId: 'ai4a11y-focus-mode-styles',
  enabled: false,
  progressEl: null,
  progressHandler: null,
  currentSettings: {
    hideDistractions: false,
    dimBackground: false,
    dimOpacity: 0.5,
    highlightColor: '#fff3cd',
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

    if (s.dimBackground) {
      css += `
        body > *:not(main):not(article):not([role="main"]):not(#ai4a11y-focus-mode-styles):not(#ai4a11y-progress) {
          opacity: ${s.dimOpacity + 0.3} !important;
        }
        main, article, [role="main"], .article, .post, .content, .entry-content {
          opacity: 1 !important;
          position: relative;
          z-index: 10;
        }
      `;
    }

    css += `
      p:hover, li:hover, td:hover {
        background-color: ${s.highlightColor} !important;
        transition: background-color 0.2s ease !important;
      }
    `;

    if (s.showProgress) {
      this.enableProgressIndicator();
    }

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);

    console.log('[AI4A11y] Focus Mode enabled', this.currentSettings);
    announce('Focus mode enabled');
  },

  disable() {
    this.enabled = false;
    document.getElementById(this.styleId)?.remove();
    this.disableProgressIndicator();
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
