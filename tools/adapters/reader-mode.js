// Reader Mode - distraction-free reading using Mozilla Readability
import { announce } from '../utils/ai.js';

export const ReaderMode = {
  enabled: false,
  originalContent: null,
  readerOverlay: null,
  escapeHandler: null,
  settings: {
    fontSize: 18,
    lineHeight: 1.8,
    maxWidth: 700,
    fontFamily: 'Georgia, serif',
    backgroundColor: '#fafafa',
    textColor: '#333'
  },

  enable(options = {}) {
    // Idempotent: a second enable() without an intervening disable() would
    // orphan the first overlay + Escape listener (disable() only knows the
    // latest references), leaving a stuck full-screen div and a leaked handler.
    if (this.enabled) return;
    if (typeof Readability === 'undefined') {
      console.warn('[AI4A11y] Readability library not loaded');
      announce('Reader mode not available');
      return;
    }

    this.settings = { ...this.settings, ...options };

    const docClone = document.cloneNode(true);
    const reader = new Readability(docClone);
    const article = reader.parse();

    if (!article) {
      announce('Could not extract article content');
      return;
    }

    this.originalContent = document.body.innerHTML;

    this.readerOverlay = document.createElement('div');
    this.readerOverlay.id = 'ai4a11y-reader-mode';
    this.readerOverlay.setAttribute('role', 'main');
    this.readerOverlay.setAttribute('aria-label', 'Reader mode content');

    const container = document.createElement('div');
    container.className = 'ai4a11y-reader-container';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai4a11y-reader-close';
    closeBtn.setAttribute('aria-label', 'Exit reader mode');
    closeBtn.textContent = '✕ Exit Reader Mode';
    container.appendChild(closeBtn);

    const title = document.createElement('h1');
    title.className = 'ai4a11y-reader-title';
    title.textContent = article.title || 'Article';
    container.appendChild(title);

    if (article.byline) {
      const byline = document.createElement('p');
      byline.className = 'ai4a11y-reader-byline';
      byline.textContent = article.byline;
      container.appendChild(byline);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'ai4a11y-reader-content';
    // Sanitize content for XSS safety
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content || '';
    tempDiv.querySelectorAll('script, iframe, object, embed, form, input, svg, style, link, meta, base, noscript, template, math').forEach(el => el.remove());
    const dangerousUrlAttrs = ['href', 'src', 'action', 'formaction', 'srcdoc', 'poster', 'xlink:href'];
    tempDiv.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = (attr.value || '').replace(/[\s\x00-\x1f]/g, '').toLowerCase();
        // Remove all event handlers
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }
        // Check URL-containing attributes for dangerous schemes
        if (dangerousUrlAttrs.includes(name)) {
          if (value.startsWith('javascript:') ||
              value.startsWith('vbscript:') ||
              value.startsWith('data:text/html') ||
              value.startsWith('data:application')) {
            el.removeAttribute(attr.name);
          }
        }
      });
    });
    contentDiv.innerHTML = tempDiv.innerHTML;
    container.appendChild(contentDiv);

    this.readerOverlay.appendChild(container);
    this.applyStyles();

    closeBtn.onclick = () => this.disable();

    document.body.style.overflow = 'hidden';
    document.body.appendChild(this.readerOverlay);

    this.enabled = true;
    console.log('[AI4A11y] Reader Mode enabled');
    announce('Reader mode enabled. Press Escape to exit.');

    this.escapeHandler = (e) => {
      if (e.key === 'Escape') this.disable();
    };
    document.addEventListener('keydown', this.escapeHandler);
  },

  applyStyles() {
    const s = this.settings;
    this.readerOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${s.backgroundColor};
      color: ${s.textColor};
      z-index: 999999;
      overflow-y: auto;
      font-family: ${s.fontFamily};
      font-size: ${s.fontSize}px;
      line-height: ${s.lineHeight};
    `;

    const container = this.readerOverlay.querySelector('.ai4a11y-reader-container');
    if (container) {
      container.style.cssText = `
        max-width: ${s.maxWidth}px;
        margin: 0 auto;
        padding: 40px 20px;
      `;
    }

    const title = this.readerOverlay.querySelector('.ai4a11y-reader-title');
    if (title) {
      title.style.cssText = 'margin-bottom: 20px; font-size: 1.8em;';
    }

    const closeBtn = this.readerOverlay.querySelector('.ai4a11y-reader-close');
    if (closeBtn) {
      closeBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        z-index: 1000000;
      `;
    }
  },

  disable() {
    if (this.readerOverlay) {
      this.readerOverlay.remove();
      this.readerOverlay = null;
    }
    document.body.style.overflow = '';
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
    }
    this.enabled = false;
    console.log('[AI4A11y] Reader Mode disabled');
    announce('Reader mode disabled');
  },

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
};

if (typeof window !== 'undefined') window.__ai4a11yReaderMode = ReaderMode;
