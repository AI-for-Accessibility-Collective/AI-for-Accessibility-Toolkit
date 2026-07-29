// Skip Links — injects "Skip to main content" (and "Skip to navigation")
// links as the page's FIRST focusable elements (WCAG 2.4.1 Bypass Blocks).
// Keyboard and screen-reader users otherwise have to tab through the entire
// header and nav on every single page before reaching the content; these
// links jump focus straight to the target region. Visually hidden until
// focused, then shown as a high-contrast pill — the standard skip-link
// pattern, added for the many sites that never shipped one.
//
// Reversible by construction: one injected container, one stylesheet, plus
// any id/tabindex attributes the target regions lacked — every addition is
// tracked and removed by disable(), restoring the DOM exactly.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';

const MAIN_SELECTOR = 'main, [role="main"], #main, #content, .content';
const NAV_SELECTOR = 'nav, [role="navigation"]';

export const SkipLinks = {
  containerId: 'ai4a11y-skip-links',
  styleId: 'ai4a11y-skip-links-styles',
  enabled: false,
  container: null,
  styleHandle: null,
  addedIdTargets: [],       // elements we assigned an id to — reverted on disable
  addedTabindexTargets: [], // elements we set tabindex="-1" on — reverted on disable

  // Give `el` an id to link to, inventing one only when the page did not
  // already provide it (and remembering the addition for disable()).
  ensureId(el, base) {
    if (el.id) return el.id;
    let id = base;
    for (let n = 2; document.getElementById(id); n++) id = `${base}-${n}`;
    el.id = id;
    this.addedIdTargets.push(el);
    return id;
  },

  // A real <a href="#…"> so the link works even with no JS; the click handler
  // upgrades it to also move keyboard focus, because plain fragment
  // navigation scrolls the viewport but leaves focus behind on the link.
  buildLink(target, idBase, label) {
    const a = document.createElement('a');
    a.href = `#${this.ensureId(target, idBase)}`;
    a.textContent = label;
    a.addEventListener('click', (event) => {
      event.preventDefault();
      // Region elements are rarely focusable on their own; tabindex="-1"
      // makes them programmatically focusable without joining the tab order.
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        this.addedTabindexTargets.push(target);
      }
      try { target.focus(); } catch { /* hostile focus() override */ }
      try {
        if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
      } catch { /* not implemented (jsdom) or detached */ }
    });
    return a;
  },

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    const main = document.querySelector(options.mainSelector || MAIN_SELECTOR);
    const nav = document.querySelector(options.navSelector || NAV_SELECTOR);

    if (main || nav) {
      // Hidden until focused: parked with the standard clip-rect pattern
      // (still in the tab order and accessibility tree, unlike display:none),
      // then shown as a high-contrast pill in the top-left corner on :focus.
      this.styleHandle = injectStyle(this.styleId, `
        #${this.containerId} a {
          position: absolute;
          top: 0; left: 0;
          width: 1px; height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
          z-index: 2147483647;
        }
        #${this.containerId} a:focus {
          width: auto; height: auto;
          margin: 8px;
          padding: 12px 20px;
          overflow: visible;
          clip: auto;
          clip-path: none;
          border-radius: 999px;
          border: 2px solid #1a5fb4;
          background: #ffffff;
          color: #1a5fb4;
          font-size: 16px;
          font-weight: 600;
          text-decoration: underline;
        }
      `);

      const container = document.createElement('div');
      container.id = this.containerId;
      if (main) container.appendChild(this.buildLink(main, 'ai4a11y-main', 'Skip to main content'));
      if (nav && nav !== main) container.appendChild(this.buildLink(nav, 'ai4a11y-nav', 'Skip to navigation'));
      // FIRST child of <body>, so the links are the first Tab stop on the page.
      const parent = document.body || document.documentElement;
      parent.insertBefore(container, parent.firstChild);
      this.container = container;
    }

    console.log('[AI4A11y] Skip Links enabled');
    announce(main || nav
      ? 'Skip links added at the top of the page'
      : 'No main content or navigation region found to skip to');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.container) { this.container.remove(); this.container = null; }
    if (this.styleHandle) { this.styleHandle.remove(); this.styleHandle = null; }
    for (const el of this.addedIdTargets) {
      try { el.removeAttribute('id'); } catch { /* node gone */ }
    }
    this.addedIdTargets = [];
    for (const el of this.addedTabindexTargets) {
      try { el.removeAttribute('tabindex'); } catch { /* node gone */ }
    }
    this.addedTabindexTargets = [];
    console.log('[AI4A11y] Skip Links disabled');
    announce('Skip links removed');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11ySkipLinks = SkipLinks;
