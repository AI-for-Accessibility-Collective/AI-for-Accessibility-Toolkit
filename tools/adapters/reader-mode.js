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
    if (this.enabled) return true;
    if (typeof Readability === 'undefined') {
      console.warn('[AI4A11y] Readability library not loaded');
      announce('Reader mode not available');
      return false;
    }

    this.settings = { ...this.settings, ...options };

    // Clone the document BEFORE parsing (Readability mutates the tree).
    const docClone = document.cloneNode(true);

    // Fix lazy-loaded images: copy data-src/data-srcset -> src/srcset on the
    // clone BEFORE Readability runs. The page's IntersectionObserver never
    // fires inside the overlay, so images would otherwise stay blank.
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

    // Readability gate: reject a null parse AND a near-empty one (e.g. a
    // paywall stub or a page that isn't really an article) — rendering that
    // as "reader mode" would show the user an almost-blank overlay instead of
    // the real page, which is worse than not offering it at all.
    if (!article || !article.content || article.content.length < 200) {
      announce('Reader mode could not extract the article — the page may be behind a login or is too short.');
      return false;
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
    title.textContent = article.title || document.title || 'Article';
    container.appendChild(title);

    if (article.byline) {
      const byline = document.createElement('p');
      byline.className = 'ai4a11y-reader-byline';
      byline.textContent = article.byline;
      container.appendChild(byline);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'ai4a11y-reader-content';
    contentDiv.innerHTML = this.sanitize(article.content || '');
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

    return true;
  },

  // Strip Readability output down to safe HTML before injecting it with
  // innerHTML. No DOMPurify dependency is vendored for tools/ (only the
  // extension's popup.html loads it as a devDependency of
  // personalized-extension), so this replicates DOMPurify's HTML-profile
  // sanitize with a hand-rolled allowlist-of-dangers pass: strip
  // script-capable elements, all `on*` handlers, and URL-bearing attributes
  // that carry an executable scheme (javascript:/vbscript:/data:text/html
  // /data:application/data:image+svg — SVG can carry its own <script>).
  sanitize(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html || '';
    tempDiv.querySelectorAll('script, iframe, object, embed, form, input, svg, style, link, meta, base, noscript, template, math').forEach(el => el.remove());
    const dangerousUrlAttrs = ['href', 'src', 'srcset', 'action', 'formaction', 'srcdoc', 'poster', 'xlink:href'];
    const dangerousPrefixes = ['javascript:', 'vbscript:', 'data:text/html', 'data:application', 'data:image/svg+xml'];
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
        if (dangerousUrlAttrs.includes(name) && dangerousPrefixes.some(p => value.startsWith(p))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return tempDiv.innerHTML;
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
    if (!this.enabled && !this.readerOverlay) return;
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
