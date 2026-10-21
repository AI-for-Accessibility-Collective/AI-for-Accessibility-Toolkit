// Reader Mode - distraction-free reading using Mozilla Readability
import { announce } from '../utils/ai.js';

const STYLE_ID = 'ai4a11y-reader-styles';
// Ads Readability would otherwise keep: anything a page marks as sponsored
// or as an advert, taken out with the card or list item it sits in.
const AD_SEL = '[class*="sponsor" i], [id*="sponsor" i], [aria-label*="sponsor" i], [alt*="sponsor" i], ' +
  '[class*="advert" i], [id*="advert" i]';
const AD_HOLDER = 'a, li, article, aside, [class*="card" i]';
// Kept reachable while the page behind the reader is inert: the page's own
// live regions (messages must still be heard) and a host's own panel.
const KEEP_LIVE = '[aria-live], [role="status"], [role="alert"], [role="log"], #ws-root';

export const ReaderMode = {
  enabled: false,
  originalContent: null,
  readerOverlay: null,
  escapeHandler: null,
  inerted: null,         // page elements we made inert, to give back on disable
  focusBefore: null,     // what had focus before the reader opened
  overflowBefore: null,  // the body's own inline overflow, put back on disable
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
    this.declutter(docClone);

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
    // The text itself is measured too: on a page with no article (a store's
    // home page) Readability can return a promo strip, a few hundred
    // characters of markup that are not the page's main text.
    if (!article || !article.content || article.content.length < 200 ||
        (article.textContent || '').replace(/\s+/g, ' ').trim().length < 400) {
      announce('Reader mode found no article text on this page');
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
    title.tabIndex = -1; // focused when the reader opens, so a screen reader starts here
    // "Saltgrass hoodie | Redbird": the site's name is not part of the title.
    let heading = article.title || document.title || 'Article';
    const site = (article.siteName || '').trim();
    if (site && heading.length > site.length + 3) {
      for (const sep of [' | ', ' - ', ' – ', ' — ', ' · ']) {
        if (heading.endsWith(sep + site)) { heading = heading.slice(0, -(sep + site).length); break; }
      }
    }
    title.textContent = heading;
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

    closeBtn.type = 'button';
    closeBtn.onclick = () => this.disable();

    this.overflowBefore = document.body.hasAttribute('style') ? document.body.style.overflow : null;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(this.readerOverlay);

    // The page behind the reader is covered, so the keyboard and screen
    // readers should not wander into it either. Focus starts at the title.
    this.focusBefore = document.activeElement;
    this.inerted = [];
    for (const el of document.body.children) {
      if (el === this.readerOverlay || el.inert || el.matches(KEEP_LIVE)) continue;
      el.inert = true;
      this.inerted.push(el);
    }
    try { title.focus({ preventScroll: true }); } catch { /* not focusable */ }

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
  // a browser host), so this replicates DOMPurify's HTML-profile
  // sanitize with a hand-rolled allowlist-of-dangers pass: strip
  // script-capable elements, all `on*` handlers, and URL-bearing attributes
  // that carry an executable scheme (javascript:/vbscript:/data:text/html
  // /data:application/data:image+svg — SVG can carry its own <script>).
  sanitize(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html || '';
    tempDiv.querySelectorAll('script, iframe, object, embed, form, input, svg, style, link, meta, base, noscript, template, math').forEach(el => el.remove());
    // Nothing in the reader plays by itself.
    tempDiv.querySelectorAll('video, audio').forEach(el => { el.removeAttribute('autoplay'); el.setAttribute('controls', ''); });
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

  // Take out of the copy what the reader never sees on the page, and ads,
  // before Readability picks the main text. The copy has the same elements
  // in the same order as the page, so what is hidden is read off the page.
  declutter(docClone) {
    try {
      const live = document.body ? document.body.querySelectorAll('*') : [];
      const copy = docClone.body ? docClone.body.querySelectorAll('*') : [];
      if (live.length === copy.length) {
        const drop = [];
        live.forEach((el, i) => {
          if (el.hidden || el.getAttribute('aria-hidden') === 'true') { drop.push(copy[i]); return; }
          const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) drop.push(copy[i]);
        });
        drop.forEach(el => el.remove());
      }
      docClone.querySelectorAll(AD_SEL).forEach(el => (el.closest(AD_HOLDER) || el).remove());
      // A section that opens with "Sponsored" is an ad row.
      docClone.querySelectorAll('section, aside').forEach(el => {
        if (/^\s*(sponsored|advertisement)\b/i.test(el.textContent || '')) el.remove();
      });
      // A page that sets its title after loading leaves the share metadata
      // ("Product | Store") behind, and Readability would use it as the title.
      const now = document.title;
      docClone.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"], meta[name="dc.title" i]').forEach(m => {
        if (now && m.getAttribute('content') !== now) m.remove();
      });
    } catch { /* parse the copy as it is */ }
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
      // In the flow and sticky, not fixed: a fixed button sat on top of the
      // title on a phone.
      closeBtn.style.cssText = `
        position: sticky;
        top: 12px;
        display: block;
        margin: 0 0 12px auto;
        padding: 10px 20px;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        z-index: 1;
      `;
    }

    // Article content comes with its own sizes: keep photos, tables and code
    // inside the column, so nothing is blown up or scrolls sideways on a
    // phone. The focus ring is a box-shadow, which pages that turn the focus
    // outline off cannot hide.
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
      #ai4a11y-reader-mode img, #ai4a11y-reader-mode video, #ai4a11y-reader-mode picture {
        max-width: 100% !important; height: auto !important; max-height: 70vh; object-fit: contain;
      }
      #ai4a11y-reader-mode a img { max-width: min(160px, 100%) !important; } /* product cards and promos, not article photos */
      #ai4a11y-reader-mode table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
      #ai4a11y-reader-mode td, #ai4a11y-reader-mode th { padding: 4px 8px; vertical-align: top; text-align: left; }
      #ai4a11y-reader-mode td > p, #ai4a11y-reader-mode th > p { margin: 0; }
      #ai4a11y-reader-mode pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
      #ai4a11y-reader-mode .ai4a11y-reader-content { overflow-wrap: anywhere; }
      #ai4a11y-reader-mode a { color: #0b57d0; }
      #ai4a11y-reader-mode :focus-visible { outline: 3px solid #0b57d0 !important; outline-offset: 2px; box-shadow: 0 0 0 5px #fff; }
      #ai4a11y-reader-mode .ai4a11y-reader-title:focus { outline: none !important; box-shadow: none; }
    `;
  },

  disable() {
    if (!this.enabled && !this.readerOverlay) return;
    if (this.readerOverlay) {
      this.readerOverlay.remove();
      this.readerOverlay = null;
    }
    document.getElementById(STYLE_ID)?.remove();
    document.body.style.overflow = this.overflowBefore || '';
    // The body had no style attribute: leave none behind.
    if (this.overflowBefore === null && !document.body.getAttribute('style')) document.body.removeAttribute('style');
    this.overflowBefore = null;
    for (const el of this.inerted || []) el.inert = false;
    this.inerted = null;
    // Back where the reader was before it opened.
    const back = this.focusBefore;
    this.focusBefore = null;
    if (back && back.isConnected && back !== document.body && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch { /* not focusable any more */ }
    }
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
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
