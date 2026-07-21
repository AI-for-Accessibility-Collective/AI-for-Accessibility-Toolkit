// Focus Locator — makes the keyboard focus position impossible to lose. For
// low-vision users the browser's default focus outline is often too subtle to
// find, and for motor users who tab through a page, losing track of focus
// means retracing the whole tab order. Two layers: a strong CSS outline on
// every :focus/:focus-visible element, plus a floating highlight ring that
// tracks the focused element via focusin/focusout.
//
// Reversible by construction: one injected stylesheet, one overlay element,
// and two document listeners stored as refs — disable() removes all four.
import { announce } from '../../utils/ai.js';
import { injectStyle } from './_primitives.js';

export const FocusLocator = {
  styleId: 'ai4a11y-focus-locator-styles',
  ringId: 'ai4a11y-focus-ring',
  enabled: false,
  styleHandle: null,
  ring: null,
  focusInHandler: null,
  focusOutHandler: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    // Amber reads on both light and dark pages; overridable for user-profile
    // theming.
    const color = (options && options.color) || '#ffbf00';

    // Layer 1: a strong outline on whatever holds focus, overriding site CSS
    // that suppresses or dims the default indicator.
    this.styleHandle = injectStyle(this.styleId, `
      *:focus, *:focus-visible {
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
      if (!this.enabled || !this.ring) return;
      const el = event.target;
      if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return;
      try {
        // The ring is position:fixed, so the viewport-relative rect applies
        // directly — no scroll offsets needed.
        const rect = el.getBoundingClientRect();
        this.ring.style.top = `${rect.top}px`;
        this.ring.style.left = `${rect.left}px`;
        this.ring.style.width = `${rect.width}px`;
        this.ring.style.height = `${rect.height}px`;
        this.ring.style.display = 'block';
      } catch { /* detached element or hostile getBoundingClientRect */ }
    };
    this.focusOutHandler = () => {
      if (this.ring) this.ring.style.display = 'none';
    };
    document.addEventListener('focusin', this.focusInHandler, true);
    document.addEventListener('focusout', this.focusOutHandler, true);

    console.log('[AI4A11y] Focus Locator enabled');
    announce('Focus highlighting on');
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
