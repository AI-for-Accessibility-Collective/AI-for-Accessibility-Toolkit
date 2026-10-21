// Focus Mode - hides distractions and highlights content
import { announce } from '../utils/ai.js';

const HIGHLIGHT = 'ai4a11y-focus-mode-highlight';

// True when the element's text is dark enough to stay readable on a light highlight.
function hasDarkText(el) {
  const m = (getComputedStyle(el).color || '').match(/[\d.]+/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export const FocusMode = {
  styleId: 'ai4a11y-focus-mode-styles',
  enabled: false,
  progressEl: null,
  progressHandler: null,
  hoverHandler: null,
  leaveHandler: null,
  hovered: null,         // the element carrying the hover highlight
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
    '[class*="cookie-banner"]', '[class*="consent-banner"]', '[class*="gdpr-banner"]',
    // Shops mark ads with a "Sponsored" label inside the product card, or with
    // an "ad" class of their own (brand-ad, ad-row): dim the whole card.
    ':has(> [class*="sponsored"])', '[class~="ad"]', '[class^="ad-"]', '[class*=" ad-"]', '[class$="-ad"]', '[class*="-ad "]'
  ],

  enable(options = {}) {
    document.getElementById(this.styleId)?.remove();
    this.disableProgressIndicator();
    this.disableHoverHighlight();

    this.currentSettings = { ...this.currentSettings, ...options };
    this.enabled = true;

    const s = this.currentSettings;
    let css = '';

    if (s.hideDistractions) {
      const all = this.distractionSelectors.join(', ');
      // An ad inside an ad is dimmed once, not twice. Pointing at it or moving
      // keyboard focus into it brings it back to full strength. :is() so a
      // browser without :has() still dims the rest instead of dropping the rule.
      css += `
        :is(${all}) {
          opacity: ${s.dimOpacity} !important;
          transition: opacity 0.3s ease !important;
        }
        :is(${all}) :is(${all}),
        :is(${all}):hover, :is(${all}):focus-within {
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
      .${HIGHLIGHT} {
        background-color: ${s.highlightColor} !important;
        transition: background-color 0.2s ease !important;
      }
    `;
    this.enableHoverHighlight();

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
    this.disableHoverHighlight();
    console.log('[AI4A11y] Focus Mode disabled');
    announce('Focus mode disabled');
  },

  enableProgressIndicator() {
    // Clean up any existing progress indicator first to prevent orphaned listeners
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

  // Highlight the paragraph, list item or table cell under the pointer. Light
  // text (white words on a banner photo, a dark footer's links) would all
  // but vanish on the light highlight, so only dark text gets it.
  enableHoverHighlight() {
    this.hoverHandler = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('p, li, td') : null;
      if (el === this.hovered) return;
      this.hovered?.classList.remove(HIGHLIGHT);
      this.hovered = el && hasDarkText(el) ? el : null;
      this.hovered?.classList.add(HIGHLIGHT);
    };
    this.leaveHandler = () => { this.hovered?.classList.remove(HIGHLIGHT); this.hovered = null; };
    document.addEventListener('mouseover', this.hoverHandler, true);
    document.documentElement.addEventListener('mouseleave', this.leaveHandler);
  },

  disableHoverHighlight() {
    if (this.hoverHandler) document.removeEventListener('mouseover', this.hoverHandler, true);
    if (this.leaveHandler) document.documentElement.removeEventListener('mouseleave', this.leaveHandler);
    this.hoverHandler = this.leaveHandler = null;
    this.hovered?.classList.remove(HIGHLIGHT);
    this.hovered = null;
  },

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
};

if (typeof window !== 'undefined') window.__ai4a11yFocusMode = FocusMode;
