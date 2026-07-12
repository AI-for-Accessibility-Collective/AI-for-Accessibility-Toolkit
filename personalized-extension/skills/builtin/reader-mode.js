import { Readability, isProbablyReaderable } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { announce } from '../../utils/ai.js';
import { registerSweep } from '../../utils/observe.js';

export const ReaderMode = {
  enabled: false,
  readerOverlay: null,
  escapeHandler: null,
  _unregisterSweep: null,
  _cachedFocus: null,
  _inertedElements: [],

  settings: {
    fontSize: 18,
    lineHeight: 1.8,
    maxWidth: 700,
    fontFamily: 'Georgia, serif',
    backgroundColor: '#fafafa',
    textColor: '#333'
  },

  enable(options = {}) {
    if (this.enabled) return true;
    this.settings = { ...this.settings, ...options };

    // Gate: only proceed on pages that are probably readable articles.
    if (!isProbablyReaderable(document)) {
      announce('Reader mode is not available for this page — no article content detected.');
      return false;
    }

    // Clone the document BEFORE parsing (Readability mutates the tree).
    const docClone = document.cloneNode(true);

    // Fix lazy-loaded images: copy data-src/data-srcset → src/srcset on the
    // clone BEFORE Readability runs.  The page's IntersectionObserver never
    // fires inside the overlay, so images stay blank otherwise.
    const PLACEHOLDER_PATTERNS = /^(data:image\/gif|about:blank|javascript:|$)/i;
    docClone.querySelectorAll('img, source').forEach(el => {
      const dataSrc = el.getAttribute('data-src');
      const dataSrcset = el.getAttribute('data-srcset');
      if (dataSrc) {
        const currentSrc = el.getAttribute('src') || '';
        if (PLACEHOLDER_PATTERNS.test(currentSrc.trim())) {
          el.setAttribute('src', dataSrc);
        }
      }
      if (dataSrcset && !el.getAttribute('srcset')) {
        el.setAttribute('srcset', dataSrcset);
      }
    });

    const reader = new Readability(docClone);
    const article = reader.parse();

    if (!article || !article.content || article.content.length < 200) {
      announce('Reader mode could not extract the article — the page may be behind a login or is too short.');
      return false;
    }

    // Sanitize Readability output (removes scripts/event handlers/dangerous URLs).
    const cleanHtml = DOMPurify.sanitize(article.content, { USE_PROFILES: { html: true } });

    // Cache focus before we open the overlay (closed shadow roots report only
    // the host afterward, so we save it now for restore on close).
    this._cachedFocus = document.activeElement;

    // Build the overlay host.
    const host = document.createElement('div');
    host.id = 'ai4a11y-reader-mode';

    // Attach a CLOSED shadow root so page CSS cannot restyle article content.
    const shadow = host.attachShadow({ mode: 'closed' });

    // Build shadow DOM: stylesheet + container.
    const style = document.createElement('style');
    style.textContent = this._buildShadowStyles();
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.id = 'reader-container';
    container.setAttribute('role', 'main');
    container.setAttribute('aria-label', 'Reader mode content');

    // Close button (real focusable element — where focus lands on open).
    const closeBtn = document.createElement('button');
    closeBtn.id = 'reader-close';
    closeBtn.setAttribute('aria-label', 'Exit reader mode');
    closeBtn.textContent = '✕ Exit Reader Mode';
    closeBtn.addEventListener('click', () => this.disable());
    container.appendChild(closeBtn);

    // Title from Readability metadata (better than old title scrape).
    const titleEl = document.createElement('h1');
    titleEl.id = 'reader-title';
    titleEl.textContent = article.title || document.title || 'Article';
    container.appendChild(titleEl);

    // Byline from Readability metadata.
    if (article.byline) {
      const bylineEl = document.createElement('p');
      bylineEl.id = 'reader-byline';
      bylineEl.textContent = article.byline;
      container.appendChild(bylineEl);
    }

    // Article content injected as safe HTML.
    const contentEl = document.createElement('div');
    contentEl.id = 'reader-content';
    contentEl.innerHTML = cleanHtml;
    container.appendChild(contentEl);

    shadow.appendChild(container);

    // Keep a module-internal handle so the close button's shadow root is
    // reachable for style updates.  Also used by the test hook below.
    this._shadowRoot = shadow;

    // Apply current settings onto the shadow stylesheet.
    this._applySettingsToShadow();

    this.readerOverlay = host;

    // Test hook: store a truncated article text snippet in a data attribute on
    // the overlay host so puppeteer (main world) can read it without needing
    // access to the content script's isolated world window object.
    // The attribute is removed on disable().
    // This is load-bearing for the e2e: closed shadow roots aren't inspectable
    // from the main world, and window.__ai4a11yReaderMode lives in the
    // extension's isolated world which page.evaluate() cannot reach.
    const snippet = contentEl.textContent.slice(0, 500);
    host.setAttribute('data-ai4a11y-test-article-text', snippet);

    // SR safety: inert every body child EXCEPT the overlay host AND the
    // #ai4a11y-announcer live region.  Inerting the announcer would silence
    // every announce() for exactly this audience, which is load-bearing.
    this._inertedElements = [];
    const announcer = document.getElementById('ai4a11y-announcer');
    for (const child of Array.from(document.body.children)) {
      if (child === host || child === announcer) continue;
      // Only set inert if it isn't already (don't double-mark).
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        this._inertedElements.push(child);
      }
    }

    document.body.style.overflow = 'hidden';
    document.body.appendChild(host);

    // Move focus to the close button inside the shadow root.
    // We do this after appending so the element is in the DOM.
    closeBtn.focus();

    this.enabled = true;

    // Escape key closes the overlay.
    this.escapeHandler = (e) => {
      if (e.key === 'Escape') this.disable();
    };
    document.addEventListener('keydown', this.escapeHandler);

    // SPA teardown: close when the URL changes while the reader is open.
    this._unregisterSweep = registerSweep(
      'reader-mode-spa',
      ({ reason }) => {
        if (reason === 'urlchange' && this.enabled) {
          this.disable();
        }
      },
      { debounceMs: 300 }
    );

    console.log('[AI4A11y] Reader Mode enabled');
    announce('Reader mode enabled. Press Escape to exit.');
    return true;
  },

  _buildShadowStyles() {
    const s = this.settings;
    // Element selectors throughout — Readability strips classes, so class
    // selectors won't match.  Readability wraps content in #readability-page-1
    // and promotes h1→h2 (the original h1 becomes the reader title we render).
    return `
      :host {
        all: initial;
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 999999;
        background: ${s.backgroundColor};
        color: ${s.textColor};
        font-family: ${s.fontFamily};
        font-size: ${s.fontSize}px;
        line-height: ${s.lineHeight};
        overflow-y: auto;
      }
      #reader-container {
        max-width: ${s.maxWidth}px;
        margin: 0 auto;
        padding: 60px 20px 40px;
      }
      #reader-close {
        position: fixed;
        top: 16px;
        right: 20px;
        padding: 8px 18px;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-family: inherit;
        z-index: 1;
      }
      #reader-close:focus-visible {
        outline: 3px solid #005fcc;
        outline-offset: 2px;
      }
      #reader-title {
        font-size: 1.8em;
        font-weight: bold;
        margin-bottom: 8px;
        line-height: 1.3;
      }
      #reader-byline {
        font-size: 0.9em;
        opacity: 0.7;
        margin-bottom: 24px;
      }
      #reader-content h2 {
        font-size: 1.4em;
        margin-top: 1.6em;
        margin-bottom: 0.4em;
      }
      #reader-content h3 {
        font-size: 1.15em;
        margin-top: 1.4em;
        margin-bottom: 0.4em;
      }
      #reader-content p {
        margin-bottom: 1em;
      }
      #reader-content img {
        max-width: 100%;
        height: auto;
      }
      #reader-content a {
        color: inherit;
      }
      #reader-content blockquote {
        border-left: 3px solid currentColor;
        margin-left: 0;
        padding-left: 1em;
        opacity: 0.8;
      }
      #reader-content pre, #reader-content code {
        font-family: monospace;
        font-size: 0.9em;
      }
    `;
  },

  _applySettingsToShadow() {
    if (!this._shadowRoot) return;
    const styleEl = this._shadowRoot.querySelector('style');
    if (styleEl) styleEl.textContent = this._buildShadowStyles();
  },

  updateSettings(options = {}) {
    this.settings = { ...this.settings, ...options };
    this._applySettingsToShadow();
  },

  disable() {
    if (!this.enabled) return;

    // Remove the overlay host.
    if (this.readerOverlay) {
      this.readerOverlay.remove();
      this.readerOverlay = null;
    }

    // Remove inert from every element we marked (and only those).
    for (const el of this._inertedElements) {
      el.removeAttribute('inert');
    }
    this._inertedElements = [];

    document.body.style.overflow = '';

    // Unregister the SPA URL-change sweep.
    if (this._unregisterSweep) {
      this._unregisterSweep();
      this._unregisterSweep = null;
    }

    // Remove Escape key handler.
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    // Restore focus to the element that was active before opening.
    if (this._cachedFocus && typeof this._cachedFocus.focus === 'function') {
      try { this._cachedFocus.focus(); } catch (_) {}
    }
    this._cachedFocus = null;
    this._shadowRoot = null;

    this.enabled = false;
    console.log('[AI4A11y] Reader Mode disabled');
    announce('Reader mode disabled.');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },

  // ---------------------------------------------------------------------------
  // Test hook — exposes the sanitized article text for puppeteer assertions.
  // Closed shadow roots aren't scriptable from page JS, and window.__ai4a11y*
  // lives in the extension's isolated world (invisible to page.evaluate()).
  // We bridge via a data attribute on the overlay host (visible to both worlds).
  // Calling this from main-world JS (page.evaluate) via the DOM attribute is
  // the correct approach. The method here is kept for isolated-world callers.
  // Matches the existing window.__ai4a11y* naming pattern.
  // ---------------------------------------------------------------------------
  getArticleTextForTest() {
    if (!this.readerOverlay) return null;
    return this.readerOverlay.getAttribute('data-ai4a11y-test-article-text') || null;
  },
};

// Expose on window for content-script callers and the test hook.
window.__ai4a11yReaderMode = ReaderMode;
