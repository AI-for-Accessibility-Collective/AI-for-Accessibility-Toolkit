// Focus Locator — makes the keyboard focus position impossible to lose. For
// low-vision users the browser's default focus outline is often too subtle to
// find, and for motor users who tab through a page, losing track of focus
// means retracing the whole tab order. Two layers: a strong CSS outline on
// every :focus/:focus-visible element, plus a floating highlight ring that
// tracks the focused element via focusin/focusout.
//
// Reversible by construction: one injected stylesheet, one overlay element,
// and two document listeners stored as refs — disable() removes all four.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';

export const FocusLocator = {
  styleId: 'ai4a11y-focus-locator-styles',
  ringId: 'ai4a11y-focus-ring',
  enabled: false,
  styleHandle: null,
  ring: null,
  tracked: null,        // the element the ring is currently following
  focusInHandler: null,
  focusOutHandler: null,
  scrollHandler: null,
  resizeHandler: null,
  rafId: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    // Amber reads on both light and dark pages; overridable for user-profile
    // theming.
    const color = (options && options.color) || '#ffbf00';

    // Layer 1: a strong outline on whatever holds focus, overriding site CSS
    // that suppresses or dims the default indicator. :not(#id) adds an id's
    // weight: sites switch the outline off with !important too (e.g.
    // `html[data-x] *:focus { outline: none !important }`), which beat a plain *:focus.
    this.styleHandle = injectStyle(this.styleId, `
      *:focus:not(#${this.ringId}), *:focus-visible:not(#${this.ringId}) {
        outline: 4px solid ${color} !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 7px color-mix(in srgb, ${color} 40%, transparent) !important;
      }
    `);

    // Layer 2: a floating ring overlaying the focused element — visible even
    // when the element clips or hides its own outline.
    const ring = document.createElement('div');
    ring.id = this.ringId;
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = [
      'position: fixed',
      'display: none',
      'pointer-events: none',
      `border: 3px solid ${color}`,
      'border-radius: 4px',
      'background: none',
      'z-index: 2147483646',
      'box-sizing: border-box',
    ].join('; ');
    (document.body || document.documentElement).appendChild(ring);
    this.ring = ring;

    this.focusInHandler = (event) => {
      if (!this.enabled) return;
      let el = event.target;
      // Focus inside a shadow root (a widget, the workshop panel) is reported
      // on its host, so the ring framed the whole host; follow it to the
      // element that actually has focus.
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return;
      this.tracked = el;
      this.position();
    };
    this.focusOutHandler = () => {
      this.tracked = null;
      if (this.ring) this.ring.style.display = 'none';
    };
    document.addEventListener('focusin', this.focusInHandler, true);
    document.addEventListener('focusout', this.focusOutHandler, true);

    // The ring is position:fixed, so it does not move with the page. Without
    // this, scrolling or resizing without changing focus would leave the ring
    // at stale viewport coordinates, confidently highlighting the wrong region.
    // Re-rect the tracked element on both. passive so it never blocks scrolling.
    // One update per frame: the capture listener also hears every inner
    // scroller, and rows that scroll by themselves fire scroll on every frame.
    const schedule = () => {
      if (!this.tracked || this.rafId !== null) return;
      if (typeof requestAnimationFrame !== 'function') { this.position(); return; }
      this.rafId = requestAnimationFrame(() => { this.rafId = null; this.position(); });
    };
    this.scrollHandler = schedule;
    this.resizeHandler = schedule;
    window.addEventListener('scroll', this.scrollHandler, { capture: true, passive: true });
    window.addEventListener('resize', this.resizeHandler, { passive: true });

    console.log('[AI4A11y] Focus Locator enabled');
    announce('Focus highlighting on');
  },

  // Draw the ring over the tracked element's current viewport rect. Hides
  // (rather than drawing a stray ring) once the element leaves the DOM.
  position() {
    if (!this.enabled || !this.ring || !this.tracked) return;
    if (this.tracked.isConnected === false) { this.ring.style.display = 'none'; return; }
    try {
      const rect = this.tracked.getBoundingClientRect();
      const st = this.ring.style;
      // Only write when something moved, so a scroll elsewhere costs a read.
      const box = [`${rect.top}px`, `${rect.left}px`, `${rect.width}px`, `${rect.height}px`];
      if (st.top !== box[0]) st.top = box[0];
      if (st.left !== box[1]) st.left = box[1];
      if (st.width !== box[2]) st.width = box[2];
      if (st.height !== box[3]) st.height = box[3];
      if (st.display !== 'block') st.display = 'block';
    } catch { /* detached element or hostile getBoundingClientRect */ }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.focusInHandler) {
      document.removeEventListener('focusin', this.focusInHandler, true);
      this.focusInHandler = null;
    }
    if (this.focusOutHandler) {
      document.removeEventListener('focusout', this.focusOutHandler, true);
      this.focusOutHandler = null;
    }
    if (this.scrollHandler) { window.removeEventListener('scroll', this.scrollHandler, { capture: true }); this.scrollHandler = null; }
    if (this.resizeHandler) { window.removeEventListener('resize', this.resizeHandler); this.resizeHandler = null; }
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.tracked = null;
    if (this.styleHandle) { this.styleHandle.remove(); this.styleHandle = null; }
    if (this.ring) { this.ring.remove(); this.ring = null; }
    console.log('[AI4A11y] Focus Locator disabled');
    announce('Focus highlighting off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yFocusLocator = FocusLocator;
