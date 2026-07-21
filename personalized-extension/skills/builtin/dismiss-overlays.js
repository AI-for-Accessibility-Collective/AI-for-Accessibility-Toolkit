// Dismiss Overlays — hides cookie/consent banners, newsletter modals, sticky
// promo bars, and blocking interstitials that sit between the reader and the
// page. From the co-design study: eye-gaze and screen-reader users described
// "fighting past big banners and cookie pop-ups" as enough to "put me off"
// a page entirely, and cookie walls block an agent just as they block a person.
//
// Reversible by construction: overlays are HIDDEN (a class + one injected
// rule), never removed, so disable() restores the page exactly. A
// MutationObserver catches banners injected after load (the common case), and
// is disconnected on disable.
import { announce } from '../../utils/ai.js';

// Names that, combined with a blocking layout, strongly indicate an overlay.
// Matched against id / class / aria-label — never on text content, to avoid
// hiding real article sections that merely mention "cookies".
const OVERLAY_NAME_RE = /(cookie|consent|gdpr|ccpa|newsletter|subscribe|sign[-_]?up|paywall|interstitial|pop[-_]?up|lightbox|backdrop|promo[-_]?(bar|banner)|notification[-_]?bar)/i;

function classNameOf(el) {
  const c = el.className;
  if (typeof c === 'string') return c;
  if (c && typeof c.baseVal === 'string') return c.baseVal; // SVG
  return '';
}

export const DismissOverlays = {
  styleId: 'ai4a11y-dismiss-overlays-styles',
  hiddenClass: 'ai4a11y-overlay-dismissed',
  enabled: false,
  hidden: null,          // Set of elements we hid (for exact restore)
  observer: null,
  prevBodyOverflow: null,
  prevHtmlOverflow: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.hidden = new Set();

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `.${this.hiddenClass} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);

    // Restore scrolling that a modal may have locked (best-effort: many
    // libraries set overflow:hidden inline on <body>/<html>).
    this.prevBodyOverflow = document.body ? document.body.style.overflow : null;
    this.prevHtmlOverflow = document.documentElement ? document.documentElement.style.overflow : null;
    if (document.body && document.body.style.overflow === 'hidden') document.body.style.overflow = '';
    if (document.documentElement && document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = '';

    const count = this.sweep(document);

    // Catch banners injected after load (cookie consent scripts usually run
    // late). Guarded by `enabled` so a disable() mid-callback is a no-op.
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

    console.log(`[AI4A11y] Dismiss Overlays enabled (${count} hidden)`);
    announce(count ? `Hid ${count} popup${count === 1 ? '' : 's'}` : 'Watching for popups to hide');
  },

  // Scan a root for overlays and hide them; returns how many were hidden.
  sweep(root) {
    let n = 0;
    let candidates;
    try {
      candidates = root.querySelectorAll('div, section, aside, dialog, [role="dialog"], [aria-modal="true"]');
    } catch { return 0; }
    for (const el of candidates) if (this.consider(el)) n++;
    return n;
  },

  // Hide one element if it looks like a blocking overlay. Returns true if hidden.
  consider(el) {
    if (!el || el.nodeType !== 1 || this.hidden.has(el)) return false;
    if (el.classList && el.classList.contains(this.hiddenClass)) return false;
    if (!this.isOverlay(el)) {
      // The added node itself may not be the overlay, but may contain it.
      if (el.querySelector) { const inner = this.sweep(el); if (inner) return true; }
      return false;
    }
    el.classList.add(this.hiddenClass);
    this.hidden.add(el);
    return true;
  },

  isOverlay(el) {
    // A true modal (aria-modal traps the whole page) is an overlay regardless
    // of its name — that is exactly what blocks the reader.
    if (el.getAttribute && el.getAttribute('aria-modal') === 'true') return true;

    const nameHit = OVERLAY_NAME_RE.test(el.id || '') ||
      OVERLAY_NAME_RE.test(classNameOf(el)) ||
      OVERLAY_NAME_RE.test((el.getAttribute && el.getAttribute('aria-label')) || '');
    if (!nameHit) return false;

    // Name alone isn't enough — require a blocking layout so we don't hide an
    // inline "cookie policy" article link or a static promo card in the feed.
    let pos = '';
    try { pos = (getComputedStyle(el).position || '').toLowerCase(); } catch { /* detached */ }
    const blocking = pos === 'fixed' || pos === 'sticky' ||
      (el.getAttribute && el.getAttribute('role') === 'dialog');
    return blocking;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    document.getElementById(this.styleId)?.remove();
    if (this.hidden) {
      for (const el of this.hidden) el.classList?.remove(this.hiddenClass);
      this.hidden.clear();
      this.hidden = null;
    }
    // Restore the scroll locks exactly as we found them.
    if (document.body && this.prevBodyOverflow !== null) document.body.style.overflow = this.prevBodyOverflow;
    if (document.documentElement && this.prevHtmlOverflow !== null) document.documentElement.style.overflow = this.prevHtmlOverflow;
    this.prevBodyOverflow = this.prevHtmlOverflow = null;
    console.log('[AI4A11y] Dismiss Overlays disabled');
    announce('Popups restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yDismissOverlays = DismissOverlays;
