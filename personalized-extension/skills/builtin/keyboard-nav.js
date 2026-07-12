import { tabbable } from 'tabbable';
import { announce } from '../../utils/ai.js';
import { registerSweep } from '../../utils/observe.js';

export const KeyboardNav = {
  enabled: false,
  styleId: 'ai4a11y-keyboard-nav-styles',
  tabSequenceOverlay: false,
  settings: {
    showSkipLinks: true,
    enhanceFocusVisible: false,
    showTabSequence: false
  },

  // Private state
  _listenerRegistered: false,
  _unregisterSweep: null,
  _modifiedElements: [],   // [{el, prior}] — prior is prior tabindex string or null
  _badgeContainer: null,
  _skipContainer: null,
  _resizeObserver: null,
  _resizeTimer: null,
  _lastHeading: null,
  _shortcutHandler: null,

  // -----------------------------------------------------------------------
  // Tabindex write helper — deduplicates: only records prior value once per el.
  // -----------------------------------------------------------------------
  _setTabindex(el, val) {
    if (!this._modifiedElements.some(r => r.el === el)) {
      const prior = el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : null;
      this._modifiedElements.push({ el, prior });
    }
    el.setAttribute('tabindex', val);
  },

  // -----------------------------------------------------------------------
  // enable
  // -----------------------------------------------------------------------
  enable(options = {}) {
    if (this.enabled) return;

    this.settings = { ...this.settings, ...options };
    this.enabled = true;

    this.injectStyles();
    if (this.settings.showSkipLinks) this.createSkipLinks();
    if (this.settings.showTabSequence) this.showTabSequence();
    this.setupKeyboardShortcuts();

    // Register sweep for SPA URL changes and badge repositioning.
    this._unregisterSweep = registerSweep('keyboard-nav-badges', ({ reason }) => {
      if (reason === 'urlchange') {
        this.disable();
        return;
      }
      // mutation: reposition badges if overlay is visible
      if (reason === 'mutation' && this.tabSequenceOverlay) {
        this._repositionBadges();
      }
    }, { debounceMs: 300 });

    console.log('[AI4A11y] Keyboard Navigator enabled');
    // No announce() call here — W1 suppression handles auto paths.
  },

  // -----------------------------------------------------------------------
  // disable
  // -----------------------------------------------------------------------
  disable() {
    this.enabled = false;

    // Remove injected styles
    document.getElementById(this.styleId)?.remove();

    // Remove skip link container
    this._skipContainer?.remove();
    this._skipContainer = null;

    // Remove badge container and clear resize observer
    this.hideTabSequence();

    // Remove keydown listener
    if (this._shortcutHandler) {
      document.removeEventListener('keydown', this._shortcutHandler);
      this._shortcutHandler = null;
    }
    this._listenerRegistered = false;

    // Unregister sweep
    this._unregisterSweep?.();
    this._unregisterSweep = null;

    // Restore all modified elements to their prior tabindex state
    for (const { el, prior } of this._modifiedElements) {
      if (prior === null) {
        el.removeAttribute('tabindex');
      } else {
        el.setAttribute('tabindex', prior);
      }
      if (el.id === 'ai4a11y-main-content') el.removeAttribute('id');
      if (el.id === 'ai4a11y-nav') el.removeAttribute('id');
    }
    this._modifiedElements = [];
    this._lastHeading = null;

    console.log('[AI4A11y] Keyboard Navigator disabled');
    // No announce() call here.
  },

  // -----------------------------------------------------------------------
  // injectStyles — skip-link styles + badge styles only (no focus ring rules).
  // -----------------------------------------------------------------------
  injectStyles() {
    document.getElementById(this.styleId)?.remove();

    const css = `
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

  // -----------------------------------------------------------------------
  // createSkipLinks — detects existing skip links, injects only if absent.
  // -----------------------------------------------------------------------
  createSkipLinks() {
    if (this._skipContainer) return;

    // Detect existing skip links: scan first 3 tabbable elements
    const firstTabbables = tabbable(document.body).slice(0, 3);
    const hasExistingSkip = firstTabbables.some(
      el => el.tagName === 'A' && el.getAttribute('href')?.startsWith('#') && /skip/i.test(el.textContent)
    );
    if (hasExistingSkip) return;

    // Also check any anchors with #-hrefs — look for skip links near the top of the document
    const allHashAnchors = Array.from(document.querySelectorAll('a[href^="#"]'));
    const hasTopSkip = allHashAnchors.some(el => {
      if (!/skip/i.test(el.textContent)) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < 300;
    });
    if (hasTopSkip) return;

    const container = document.createElement('div');
    container.id = 'ai4a11y-skip-links';

    const main = document.querySelector('main, [role="main"], #main, #content, article');
    if (main) {
      if (!main.id) main.id = 'ai4a11y-main-content';
      const skipToMain = document.createElement('a');
      skipToMain.href = '#' + main.id;
      skipToMain.className = 'ai4a11y-skip-link';
      skipToMain.textContent = 'Skip to main content';
      skipToMain.addEventListener('click', (e) => {
        e.preventDefault();
        this._setTabindex(main, '-1');
        main.focus();
        main.scrollIntoView({ behavior: 'smooth' });
      });
      container.appendChild(skipToMain);
    }

    const nav = document.querySelector('nav, [role="navigation"]');
    if (nav) {
      if (!nav.id) nav.id = 'ai4a11y-nav';
      const skipToNav = document.createElement('a');
      skipToNav.href = '#' + nav.id;
      skipToNav.className = 'ai4a11y-skip-link';
      skipToNav.textContent = 'Skip to navigation';
      skipToNav.style.left = '200px';
      skipToNav.addEventListener('click', (e) => {
        e.preventDefault();
        this._setTabindex(nav, '-1');
        nav.focus();
      });
      container.appendChild(skipToNav);
    }

    this._skipContainer = container;
    document.body.insertBefore(container, document.body.firstChild);
  },

  // -----------------------------------------------------------------------
  // showTabSequence
  // -----------------------------------------------------------------------
  showTabSequence() {
    this.hideTabSequence();

    const focusables = tabbable(document.body);

    const container = document.createElement('div');
    container.setAttribute('aria-hidden', "true");
    this._badgeContainer = container;

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

    // ResizeObserver for badge repositioning (throttled with 100ms debounce)
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (!this.tabSequenceOverlay) return;
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          this._resizeTimer = null;
          if (this.tabSequenceOverlay) this._repositionBadges();
        }, 100);
      });
      this._resizeObserver.observe(document.body);
    }
  },

  // -----------------------------------------------------------------------
  // _repositionBadges
  // -----------------------------------------------------------------------
  _repositionBadges() {
    if (!this._badgeContainer) return;
    const focusables = tabbable(document.body);
    const badges = Array.from(this._badgeContainer.querySelectorAll('.ai4a11y-tab-badge'));
    focusables.forEach((el, i) => {
      if (!badges[i]) return;
      const rect = el.getBoundingClientRect();
      badges[i].style.top = (rect.top + window.scrollY - 10) + 'px';
      badges[i].style.left = (rect.left + window.scrollX - 10) + 'px';
    });
  },

  // -----------------------------------------------------------------------
  // hideTabSequence
  // -----------------------------------------------------------------------
  hideTabSequence() {
    if (this._badgeContainer) {
      this._badgeContainer.remove();
      this._badgeContainer = null;
    }
    this.tabSequenceOverlay = false;

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }
  },

  // -----------------------------------------------------------------------
  // setupKeyboardShortcuts — idempotent
  // -----------------------------------------------------------------------
  setupKeyboardShortcuts() {
    if (this._listenerRegistered) return;

    const handler = (e) => {
      if (!e.altKey) return;
      if (e.ctrlKey || e.metaKey) return; // AltGr protection

      // Editable target guard
      const target = e.target;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;

      if (e.code === 'Digit1') {
        e.preventDefault();
        const main = document.querySelector('main, [role="main"], #main, #content');
        if (main) { this._setTabindex(main, '-1'); main.focus(); }
      }

      if (e.code === 'Digit2') {
        e.preventDefault();
        const nav = document.querySelector('nav, [role="navigation"]');
        if (nav) { this._setTabindex(nav, '-1'); nav.focus(); }
      }

      if (e.code === 'KeyH') {
        e.preventDefault();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        if (!headings.length) return;

        let currentIdx = -1;
        if (e.shiftKey) {
          // Shift+Alt+H goes backward
          if (this._lastHeading) {
            currentIdx = headings.indexOf(this._lastHeading);
          }
          const prevIdx = currentIdx <= 0 ? headings.length - 1 : currentIdx - 1;
          const h = headings[prevIdx];
          this._lastHeading = h;
          this._setTabindex(h, '-1');
          h.focus();
          h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          // Alt+H goes forward
          if (this._lastHeading) {
            currentIdx = headings.indexOf(this._lastHeading);
          }
          const nextIdx = (currentIdx + 1) % headings.length;
          const h = headings[nextIdx];
          this._lastHeading = h;
          this._setTabindex(h, '-1');
          h.focus();
          h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      if (e.code === 'KeyF') {
        e.preventDefault();
        if (this.tabSequenceOverlay) {
          this.hideTabSequence();
          announce('Tab order hidden');
        } else {
          this.showTabSequence();
          announce('Tab order shown');
        }
      }
    };

    this._shortcutHandler = handler;
    document.addEventListener('keydown', handler);
    this._listenerRegistered = true;
  },

  // -----------------------------------------------------------------------
  // toggle
  // -----------------------------------------------------------------------
  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

window.__ai4a11yKeyboardNavigator = KeyboardNav;
