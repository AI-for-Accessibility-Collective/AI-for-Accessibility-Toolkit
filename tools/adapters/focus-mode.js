// Focus Mode - hides distractions and highlights content
import { announce } from '../utils/ai.js';

const HIGHLIGHT = 'ai4a11y-focus-mode-highlight';

const DEFAULT_SETTINGS = {
  hideDistractions: false,
  dimBackground: false,
  dimOpacity: 0.5,
  highlightColor: '#fff3cd',
  showProgress: true
};

function parseColor(str) {
  if (!str) return null;
  if (str.startsWith('#')) {
    let hex = str.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) {
      const num = parseInt(hex, 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }
  }
  const m = str.match(/[\d.]+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null;
}

function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// True when the element's text has sufficient contrast (at least 4.5:1) against the highlight.
function hasDarkText(el, highlightColor = '#fff3cd') {
  const fg = parseColor(getComputedStyle(el).color);
  const bg = parseColor(highlightColor) || [255, 243, 205];
  if (!fg) return false;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio >= 4.5;
}

export const FocusMode = {
  styleId: 'ai4a11y-focus-mode-styles',
  enabled: false,
  progressEl: null,
  progressHandler: null,
  progressObserver: null,
  navHandler: null,
  hoverHandler: null,
  leaveHandler: null,
  focusHandler: null,
  blurHandler: null,
  keyHandler: null,
  hovered: null,         // the element carrying the highlight
  currentSettings: { ...DEFAULT_SETTINGS },

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

    this.currentSettings = { ...DEFAULT_SETTINGS, ...options };
    this.enabled = true;

    const s = this.currentSettings;
    const all = this.distractionSelectors.join(', ');
    let css = '';

    if (s.hideDistractions) {
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
          opacity: ${Math.min(1, Number(s.dimOpacity) + 0.3)} !important;
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
      @media (prefers-reduced-motion: reduce) {
        :is(${all}), .${HIGHLIGHT}, #ai4a11y-progress {
          transition: none !important;
        }
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
    document.querySelectorAll('.' + HIGHLIGHT).forEach((el) => el.classList.remove(HIGHLIGHT));
    console.log('[AI4A11y] Focus Mode disabled');
    announce('Focus mode disabled');
  },

  enableProgressIndicator() {
    // Clean up any existing progress indicator first to prevent orphaned listeners
    this.disableProgressIndicator();

    this.progressEl = document.createElement('div');
    this.progressEl.id = 'ai4a11y-progress';
    this.progressEl.setAttribute('aria-hidden', 'true');
    this.progressEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      height: 4px;
      background: linear-gradient(90deg, #4caf50, #8bc34a);
      z-index: 100000;
      transition: width 0.1s ease;
      width: 0%;
      pointer-events: none;
    `;
    document.body.appendChild(this.progressEl);

    this.progressRafPending = false;
    this.progressHandler = () => {
      if (this.progressRafPending) return;
      this.progressRafPending = true;
      requestAnimationFrame(() => {
        this.progressRafPending = false;
        const scrollTop = window.scrollY || window.pageYOffset || 0;
        const docHeight = (document.documentElement ? document.documentElement.scrollHeight : 0) - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
        if (this.progressEl) {
          this.progressEl.style.width = `${progress}%`;
        }
      });
    };
    document.addEventListener('scroll', this.progressHandler, { passive: true });
    this.progressHandler();

    // Re-attach progress bar on SPA navigation (popstate/hashchange and DOM replacements)
    this.navHandler = () => {
      if (!this.enabled || !this.currentSettings.showProgress) return;
      if (this.progressEl && !this.progressEl.isConnected && document.body) {
        document.body.appendChild(this.progressEl);
      }
      this.progressHandler?.();
    };
    window.addEventListener('popstate', this.navHandler);
    window.addEventListener('hashchange', this.navHandler);

    if (typeof MutationObserver !== 'undefined' && document.body) {
      this.progressObserver = new MutationObserver(() => {
        if (!this.enabled || !this.currentSettings.showProgress) return;
        if (this.progressEl && !this.progressEl.isConnected && document.body) {
          document.body.appendChild(this.progressEl);
          this.progressHandler?.();
        }
      });
      this.progressObserver.observe(document.body, { childList: true });
    }
  },

  disableProgressIndicator() {
    if (this.progressObserver) {
      this.progressObserver.disconnect();
      this.progressObserver = null;
    }
    if (this.navHandler) {
      window.removeEventListener('popstate', this.navHandler);
      window.removeEventListener('hashchange', this.navHandler);
      this.navHandler = null;
    }
    if (this.progressEl) {
      this.progressEl.remove();
      this.progressEl = null;
    }
    if (this.progressHandler) {
      document.removeEventListener('scroll', this.progressHandler);
      this.progressHandler = null;
    }
  },

  // Highlight the paragraph, list item or table cell under the pointer or focus.
  // Light text (white words on a banner photo, a dark footer's links) would all
  // but vanish on the light highlight, so only text with contrast >= 4.5:1 gets it.
  enableHoverHighlight() {
    this.hoverHandler = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('p, li, td') : null;
      if (el === this.hovered) return;
      this.hovered?.classList.remove(HIGHLIGHT);
      this.hovered = el && hasDarkText(el, this.currentSettings.highlightColor) ? el : null;
      this.hovered?.classList.add(HIGHLIGHT);
    };
    this.leaveHandler = () => {
      this.hovered?.classList.remove(HIGHLIGHT);
      this.hovered = null;
    };
    this.focusHandler = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('p, li, td') : null;
      if (el === this.hovered) return;
      this.hovered?.classList.remove(HIGHLIGHT);
      this.hovered = el && hasDarkText(el, this.currentSettings.highlightColor) ? el : null;
      this.hovered?.classList.add(HIGHLIGHT);
    };
    this.blurHandler = (e) => {
      if (this.hovered && (!e.relatedTarget || !this.hovered.contains(e.relatedTarget))) {
        this.hovered.classList.remove(HIGHLIGHT);
        this.hovered = null;
      }
    };
    // WCAG 1.4.13: Content shown on hover or focus can be dismissed with Escape
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        this.hovered?.classList.remove(HIGHLIGHT);
        this.hovered = null;
      }
    };

    document.addEventListener('mouseover', this.hoverHandler, true);
    document.documentElement.addEventListener('mouseleave', this.leaveHandler);
    document.addEventListener('focusin', this.focusHandler, true);
    document.addEventListener('focusout', this.blurHandler, true);
    document.addEventListener('keydown', this.keyHandler, true);
  },

  disableHoverHighlight() {
    if (this.hoverHandler) document.removeEventListener('mouseover', this.hoverHandler, true);
    if (this.leaveHandler) document.documentElement.removeEventListener('mouseleave', this.leaveHandler);
    if (this.focusHandler) document.removeEventListener('focusin', this.focusHandler, true);
    if (this.blurHandler) document.removeEventListener('focusout', this.blurHandler, true);
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler, true);
    this.hoverHandler = this.leaveHandler = this.focusHandler = this.blurHandler = this.keyHandler = null;
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
