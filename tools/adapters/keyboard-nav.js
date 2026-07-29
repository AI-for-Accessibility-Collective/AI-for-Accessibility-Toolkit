// Keyboard Navigator - enhanced keyboard navigation using ally.js
import { announce } from '../utils/ai.js';

export const KeyboardNavigator = {
  enabled: false,
  styleId: 'ai4a11y-keyboard-nav-styles',
  skipLinkElement: null,
  tabSequenceOverlay: false,
  shortcutHandler: null,
  modifiedElements: [],
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
    console.log('[AI4A11y] Keyboard Navigator enabled');
    announce('Keyboard navigation enhanced');
  },

  disable() {
    this.enabled = false;
    document.getElementById(this.styleId)?.remove();
    this.skipLinkElement?.remove();
    this.skipLinkElement = null;
    this.hideTabSequence();
    if (this.shortcutHandler) {
      document.removeEventListener('keydown', this.shortcutHandler);
      this.shortcutHandler = null;
    }
    // Clean up tabindex="-1" added to all modified elements
    this.modifiedElements.forEach(el => {
      el.removeAttribute('tabindex');
      if (el.id === 'ai4a11y-main-content') el.removeAttribute('id');
      if (el.id === 'ai4a11y-nav') el.removeAttribute('id');
    });
    this.modifiedElements = [];
    console.log('[AI4A11y] Keyboard Navigator disabled');
    announce('Keyboard navigation restored');
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

    const container = document.createElement('div');
    container.id = 'ai4a11y-skip-links';

    const main = document.querySelector('main, [role="main"], #main, #content, article');
    if (main) {
      if (!main.id) main.id = 'ai4a11y-main-content';
      // Track the id we stamped so disable() strips it even if the (hidden)
      // skip link is never focused/clicked.
      if (main.id === 'ai4a11y-main-content' && !this.modifiedElements.includes(main)) this.modifiedElements.push(main);
      const skipToMain = document.createElement('a');
      skipToMain.href = '#' + main.id;
      skipToMain.className = 'ai4a11y-skip-link';
      skipToMain.textContent = 'Skip to main content';
      skipToMain.addEventListener('click', (e) => {
        e.preventDefault();
        main.setAttribute('tabindex', '-1');
        if (!this.modifiedElements.includes(main)) this.modifiedElements.push(main);
        main.focus();
        main.scrollIntoView({ behavior: 'smooth' });
      });
      container.appendChild(skipToMain);
    }

    const nav = document.querySelector('nav, [role="navigation"]');
    if (nav) {
      if (!nav.id) nav.id = 'ai4a11y-nav';
      if (nav.id === 'ai4a11y-nav' && !this.modifiedElements.includes(nav)) this.modifiedElements.push(nav);
      const skipToNav = document.createElement('a');
      skipToNav.href = '#' + nav.id;
      skipToNav.className = 'ai4a11y-skip-link';
      skipToNav.textContent = 'Skip to navigation';
      skipToNav.style.left = '200px';
      skipToNav.addEventListener('click', (e) => {
        e.preventDefault();
        nav.setAttribute('tabindex', '-1');
        if (!this.modifiedElements.includes(nav)) this.modifiedElements.push(nav);
        nav.focus();
      });
      container.appendChild(skipToNav);
    }

    this.skipLinkElement = container;
    document.body.insertBefore(container, document.body.firstChild);
  },

  showTabSequence() {
    this.hideTabSequence();

    const focusables = Array.from(document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    });

    focusables.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = 'ai4a11y-tab-badge';
      badge.textContent = String(idx + 1);
      badge.style.top = (rect.top + window.scrollY - 10) + 'px';
      badge.style.left = (rect.left + window.scrollX - 10) + 'px';
      document.body.appendChild(badge);
    });

    this.tabSequenceOverlay = true;
  },

  hideTabSequence() {
    document.querySelectorAll('.ai4a11y-tab-badge').forEach(el => el.remove());
    this.tabSequenceOverlay = false;
  },

  setupKeyboardShortcuts() {
    this.shortcutHandler = (e) => {
      // Track any element we stamp tabindex on so disable() removes it —
      // otherwise a shortcut leaves tabindex="-1" on page content forever.
      const focusTracked = (el) => {
        if (!el) return;
        el.setAttribute('tabindex', '-1');
        if (!this.modifiedElements.includes(el)) this.modifiedElements.push(el);
        el.focus();
        return el;
      };
      if (e.altKey && e.key === '1') {
        e.preventDefault();
        focusTracked(document.querySelector('main, [role="main"], #main, #content'));
      }
      if (e.altKey && e.key === '2') {
        e.preventDefault();
        focusTracked(document.querySelector('nav, [role="navigation"]'));
      }
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        const h = focusTracked(document.querySelector('h1, h2, h3'));
        if (h) h.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (e.altKey && e.key === 'f') {
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
