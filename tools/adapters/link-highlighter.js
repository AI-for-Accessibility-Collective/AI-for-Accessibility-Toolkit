// Link Highlighter — makes links unmistakable for low-vision and cognitive
// users (underline, bolder weight, a distinct accessible color, a strong
// focus ring) and reveals each link's destination host as a title, so users
// know where a link goes. From the co-design study: "click here" / "read
// more" links leave users unable to tell where a link actually leads.
//
// Reversible by construction: the styling is CSS only (a body class + one
// injected stylesheet), and destination titles are set ONLY on links that had
// none — tracked in a Set so disable() removes exactly those and never
// touches a title the page set itself. A MutationObserver titles links added
// after enable, and is disconnected on disable.
import { announce } from '../utils/ai.js';

export const LinkHighlighter = {
  styleId: 'ai4a11y-link-highlighter-styles',
  bodyClass: 'ai4a11y-highlight-links',
  dataAttr: 'data-ai4a11y-linkhl',
  enabled: false,
  titled: null,          // Set of links WE titled (for exact restore)
  observer: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.titled = new Set();

    // 7:1 contrast on white; overridable for user-profile theming.
    const color = (options && options.color) || '#0b57d0';
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      .${this.bodyClass} a[href] {
        text-decoration: underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px !important;
        font-weight: 600 !important;
        color: ${color} !important;
      }
      .${this.bodyClass} a[href]:focus,
      .${this.bodyClass} a[href]:focus-visible {
        outline: 3px solid ${color} !important;
        outline-offset: 2px !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    if (document.body) document.body.classList.add(this.bodyClass);

    const count = this.sweep(document);

    // Title links injected after load (infinite feeds, client-side routing).
    // Guarded by `enabled` so a disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) this.consider(node);
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    console.log(`[AI4A11y] Link Highlighter enabled (${count} destinations revealed)`);
    announce(count ? `Links highlighted, ${count} destination${count === 1 ? '' : 's'} revealed` : 'Links highlighted');
  },

  // Reveal destination hosts for every untitled link under root; returns how
  // many links were titled.
  sweep(root) {
    let n = 0;
    let links;
    try { links = root.querySelectorAll('a[href]'); } catch { return 0; }
    for (const a of links) if (this.reveal(a)) n++;
    return n;
  },

  // An added node may itself be a link, or contain links.
  consider(node) {
    if (!node || node.nodeType !== 1) return;
    try { if (node.matches && node.matches('a[href]')) this.reveal(node); } catch { /* detached */ }
    if (node.querySelectorAll) this.sweep(node);
  },

  // Set one link's title to its destination host. Returns true if we titled
  // it. NEVER overwrites a title the page already set — that text is the
  // page's own description and must survive disable() untouched.
  reveal(a) {
    if (!a || a.nodeType !== 1 || this.titled.has(a)) return false;
    if (a.hasAttribute('title')) return false;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) return false; // same-page jump, no destination to reveal
    let host = '';
    try { host = new URL(href, window.location.href).host; } catch { return false; }
    if (!host) return false; // javascript:, mailto:, data: — no host to show
    a.setAttribute('title', host);
    a.setAttribute(this.dataAttr, '');
    this.titled.add(a);
    return true;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    document.getElementById(this.styleId)?.remove();
    if (document.body) document.body.classList.remove(this.bodyClass);
    if (this.titled) {
      for (const a of this.titled) {
        try {
          a.removeAttribute('title');
          a.removeAttribute(this.dataAttr);
        } catch { /* detached */ }
      }
      this.titled.clear();
      this.titled = null;
    }
    console.log('[AI4A11y] Link Highlighter disabled');
    announce('Link highlighting off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yLinkHighlighter = LinkHighlighter;
