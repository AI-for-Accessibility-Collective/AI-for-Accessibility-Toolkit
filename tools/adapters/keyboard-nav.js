// Keyboard Navigator - enhanced keyboard navigation
import { announce } from '../utils/ai.js';
import { registerSweep } from '../utils/observe.js';

// Manual focusable-element query (visible, not disabled). Deliberately not the
// `tabbable` npm package — this stays dependency-free so it bundles cleanly
// for both the extension and the CLI. Order is DOM order, not tab order, which
// is an approximation the badge overlay accepts as a tradeoff for zero deps.
function getFocusable(root) {
  return Array.from(root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  });
}

export const KeyboardNavigator = {
  enabled: false,
  styleId: 'ai4a11y-keyboard-nav-styles',
  skipLinkElement: null,
  tabSequenceOverlay: false,
  shortcutHandler: null,
  modifiedElements: [],   // {el, prior} tabindex changes — restored (not stripped) on disable
  injectedIdEls: [],      // {el, syntheticId} ids we stamped — removed on disable only if unchanged
  badgeContainer: null,
  resizeObserver: null,
  resizeTimer: null,
  lastHeading: null,
  unregisterSweep: null,
  settings: {
    showSkipLinks: true,
    enhanceFocusVisible: true,
    showTabSequence: false
  },

  enable(options = {}) {
    if (this.enabled) return;
    this.settings = { ...this.settings, ...options };
    this.enabled = true;
    this.injectStyles();
    if (this.settings.showSkipLinks) this.createSkipLinks();
    if (this.settings.showTabSequence) this.showTabSequence();
    this.setupKeyboardShortcuts();

    // Reposition badges after late-rendered content shifts layout. Uses the
    // shared debounced observer so this adapter doesn't run its own.
    this.unregisterSweep = registerSweep('keyboard-nav', ({ reason }) => {
      if (reason === 'mutation' && this.tabSequenceOverlay) this.repositionBadges();
    }, { debounceMs: 300 });

    console.log('[AI4A11y] Keyboard Navigator enabled');
    announce('Keyboard navigation enhanced');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.getElementById(this.styleId)?.remove();
    this.skipLinkElement?.remove();
    this.skipLinkElement = null;
    this.hideTabSequence();
    if (this.shortcutHandler) {
      document.removeEventListener('keydown', this.shortcutHandler);
      this.shortcutHandler = null;
    }
    this.unregisterSweep?.();
    this.unregisterSweep = null;

    // Restore each modified element to its PRIOR tabindex (or remove if it had
    // none) instead of blindly stripping — a blanket removeAttribute would
    // erase page-authored tabindex on elements we merely touched.
    this.modifiedElements.forEach(({ el, prior }) => {
      if (prior === null) el.removeAttribute('tabindex');
      else el.setAttribute('tabindex', prior);
    });
    this.modifiedElements = [];

    // Remove only ids we injected, and only if the page hasn't since changed
    // them — avoids clobbering an id the page (or user) assigned afterward.
    this.injectedIdEls.forEach(({ el, syntheticId }) => {
      if (el.id === syntheticId) el.removeAttribute('id');
    });
    this.injectedIdEls = [];

    this.lastHeading = null;

    console.log('[AI4A11y] Keyboard Navigator disabled');
    announce('Keyboard navigation restored');
  },

  // Tabindex write helper — records the prior value only once per element so
  // repeated shortcuts on the same element don't clobber the real original.
  setTabindex(el, val) {
    if (!el) return;
    if (!this.modifiedElements.some(r => r.el === el)) {
      const prior = el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : null;
      this.modifiedElements.push({ el, prior });
    }
    el.setAttribute('tabindex', val);
  },

  injectStyles() {
    document.getElementById(this.styleId)?.remove();

    const css = `
      ${this.settings.enhanceFocusVisible ? `
        *:focus-visible {
          outline: 3px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.25) !important;
        }
      ` : ''}
      .ai4a11y-skip-link {
        position: fixed;
        top: -100px;
        left: 10px;
        background: #000;
        color: #fff;
        padding: 12px 24px;
        text-decoration: none;
        font-family: system-ui, sans-serif;
        font-size: 16px;
        font-weight: 600;
        z-index: 999999;
        border-radius: 4px;
        transition: top 0.2s;
      }
      .ai4a11y-skip-link:focus {
        top: 10px;
        outline: 3px solid #fff;
        outline-offset: 2px;
      }
      .ai4a11y-tab-badge {
        position: absolute;
        background: #0066ff;
        color: white;
        font-size: 12px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 10px;
        z-index: 999998;
        pointer-events: none;
        font-family: system-ui, sans-serif;
      }
    `;

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);
  },

  createSkipLinks() {
    if (this.skipLinkElement) return;

    // Don't inject a redundant skip link when the page already has one near
    // the top — two "Skip to..." links in the tab order is confusing for the
    // keyboard/screen-reader users this feature is meant to help.
    const hasExistingSkip = Array.from(document.querySelectorAll('a[href^="#"]')).some(el => {
      if (!/skip/i.test(el.textContent || '')) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < 300;
    });
    if (hasExistingSkip) return;

    const container = document.createElement('div');
    container.id = 'ai4a11y-skip-links';

    const main = document.querySelector('main, [role="main"], #main, #content, article');
    if (main) {
      if (!main.id) {
        main.id = 'ai4a11y-main-content';
        this.injectedIdEls.push({ el: main, syntheticId: 'ai4a11y-main-content' });
      }
      const skipToMain = document.createElement('a');
      skipToMain.href = '#' + main.id;
      skipToMain.className = 'ai4a11y-skip-link';
      skipToMain.textContent = 'Skip to main content';
      skipToMain.addEventListener('click', (e) => {
        e.preventDefault();
        this.setTabindex(main, '-1');
        main.focus();
        main.scrollIntoView({ behavior: 'smooth' });
      });
      container.appendChild(skipToMain);
    }

    const nav = document.querySelector('nav, [role="navigation"]');
    if (nav) {
      if (!nav.id) {
        nav.id = 'ai4a11y-nav';
        this.injectedIdEls.push({ el: nav, syntheticId: 'ai4a11y-nav' });
      }
      const skipToNav = document.createElement('a');
      skipToNav.href = '#' + nav.id;
      skipToNav.className = 'ai4a11y-skip-link';
      skipToNav.textContent = 'Skip to navigation';
      skipToNav.style.left = '200px';
      skipToNav.addEventListener('click', (e) => {
        e.preventDefault();
        this.setTabindex(nav, '-1');
        nav.focus();
      });
      container.appendChild(skipToNav);
    }

    this.skipLinkElement = container;
    document.body.insertBefore(container, document.body.firstChild);
  },

  showTabSequence() {
    this.hideTabSequence();

    const focusables = getFocusable(document.body);

    // Badges are purely visual — wrap them in one aria-hidden container so
    // screen readers never announce the digit-only badge text as content.
    const container = document.createElement('div');
    container.setAttribute('aria-hidden', 'true');
    this.badgeContainer = container;

    focusables.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = 'ai4a11y-tab-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = String(idx + 1);
      badge.style.top = (rect.top + window.scrollY - 10) + 'px';
      badge.style.left = (rect.left + window.scrollX - 10) + 'px';
      container.appendChild(badge);
    });

    document.body.appendChild(container);
    this.tabSequenceOverlay = true;

    // Reposition on viewport/layout resize (throttled).
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.tabSequenceOverlay) return;
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          this.resizeTimer = null;
          if (this.tabSequenceOverlay) this.repositionBadges();
        }, 100);
      });
      this.resizeObserver.observe(document.body);
    }
  },

  repositionBadges() {
    if (!this.badgeContainer) return;
    const focusables = getFocusable(document.body);
    const badges = Array.from(this.badgeContainer.querySelectorAll('.ai4a11y-tab-badge'));
    focusables.forEach((el, i) => {
      if (!badges[i]) return;
      const rect = el.getBoundingClientRect();
      badges[i].style.top = (rect.top + window.scrollY - 10) + 'px';
      badges[i].style.left = (rect.left + window.scrollX - 10) + 'px';
    });
  },

  hideTabSequence() {
    if (this.badgeContainer) {
      this.badgeContainer.remove();
      this.badgeContainer = null;
    }
    this.tabSequenceOverlay = false;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  },

  setupKeyboardShortcuts() {
    this.shortcutHandler = (e) => {
      if (!e.altKey) return;
      if (e.ctrlKey || e.metaKey) return; // AltGr guard (AltGr reports as altKey+ctrlKey)

      // Editable-target guard: never steal focus from a field the user is
      // typing in. e.target is undefined when the handler is invoked directly
      // (e.g. tests) rather than via dispatchEvent — optional-chain through.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target?.isContentEditable) return;

      const key = (e.key || '').toLowerCase();

      if (key === '1') {
        e.preventDefault();
        const main = document.querySelector('main, [role="main"], #main, #content');
        if (main) { this.setTabindex(main, '-1'); main.focus(); }
      }
      if (key === '2') {
        e.preventDefault();
        const nav = document.querySelector('nav, [role="navigation"]');
        if (nav) { this.setTabindex(nav, '-1'); nav.focus(); }
      }
      if (key === 'h') {
        e.preventDefault();
        // Cycles through ALL headings (not just the first h1-h3 match), and
        // Shift+Alt+H goes backward — makes this a real heading-navigation
        // shortcut for screen-reader/keyboard users instead of a one-shot jump.
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        if (!headings.length) return;
        const currentIdx = this.lastHeading ? headings.indexOf(this.lastHeading) : -1;
        const idx = e.shiftKey
          ? (currentIdx <= 0 ? headings.length - 1 : currentIdx - 1)
          : (currentIdx + 1) % headings.length;
        const h = headings[idx];
        this.lastHeading = h;
        this.setTabindex(h, '-1');
        h.focus();
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (key === 'f') {
        e.preventDefault();
        if (this.tabSequenceOverlay) this.hideTabSequence();
        else this.showTabSequence();
      }
    };

    document.addEventListener('keydown', this.shortcutHandler);
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

if (typeof window !== 'undefined') window.__ai4a11yKeyboardNavigator = KeyboardNavigator;
