// Unpin Sticky Bars — un-pins position:fixed and position:sticky page chrome
// (headers, footers, cookie-bar shells, floating widgets) by making it
// position:static. Pinned bars eat the viewport when a low-vision user zooms
// (WCAG 1.4.10 reflow leaves little room for the actual content) and force an
// eye-gaze user to scroll around them; unpinning returns the full viewport to
// the page.
//
// Reversible by construction: pinned position can't be selected in a
// stylesheet, so enable() scans computed styles and tags matches with a class
// (plus one injected rule); disable() removes the class from every tracked
// element and the rule, restoring the page exactly. A MutationObserver catches
// bars injected after load, and is disconnected on disable.
import { announce } from '../../utils/ai.js';

export const UnpinSticky = {
  styleId: 'ai4a11y-unpin-sticky-styles',
  unpinnedClass: 'ai4a11y-unpinned',
  enabled: false,
  unpinned: null,        // Set of elements we unpinned (for exact restore)
  observer: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.unpinned = new Set();

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `.${this.unpinnedClass} { position: static !important; }`;
    (document.head || document.documentElement).appendChild(style);

    const count = this.sweep(document);

    // Catch bars injected after load (chat widgets and consent shells usually
    // mount late). Guarded by `enabled` so a disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              this.consider(node);
              if (node.querySelectorAll) this.sweep(node);
            }
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    console.log(`[AI4A11y] Unpin Sticky Bars enabled (${count} unpinned)`);
    announce(count ? `Unpinned ${count} sticky bar${count === 1 ? '' : 's'}` : 'Watching for sticky bars to unpin');
  },

  // Scan a root for pinned elements and unpin them; returns how many.
  sweep(root) {
    let n = 0;
    let candidates;
    try {
      candidates = root.querySelectorAll('*');
    } catch { return 0; }
    for (const el of candidates) if (this.consider(el)) n++;
    return n;
  },

  // Unpin one element if its computed position is fixed or sticky. Returns
  // true if unpinned. Never touches our own injected nodes.
  consider(el) {
    if (!el || el.nodeType !== 1 || this.unpinned.has(el)) return false;
    if (el.id === this.styleId) return false;
    if (el.classList && el.classList.contains(this.unpinnedClass)) return false;
    let pos = '';
    try { pos = (getComputedStyle(el).position || '').toLowerCase(); } catch { return false; /* detached */ }
    if (pos !== 'fixed' && pos !== 'sticky') return false;
    el.classList.add(this.unpinnedClass);
    this.unpinned.add(el);
    return true;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    document.getElementById(this.styleId)?.remove();
    if (this.unpinned) {
      for (const el of this.unpinned) el.classList?.remove(this.unpinnedClass);
      this.unpinned.clear();
      this.unpinned = null;
    }
    console.log('[AI4A11y] Unpin Sticky Bars disabled');
    announce('Sticky bars restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yUnpinSticky = UnpinSticky;
