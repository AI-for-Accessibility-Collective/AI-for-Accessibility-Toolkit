// Persistent Hover — keeps hover-revealed content on screen until the user
// dismisses it (WCAG 1.4.13 Content on Hover or Focus). CSS :hover tooltips
// and native `title` bubbles vanish the moment the pointer drifts, so
// low-vision users — who move slowly or track a magnified viewport — never
// get to read them. This adapter mirrors `title` text into one accessible
// tooltip that STAYS: it is hoverable (pointer-events: auto, per 1.4.13),
// survives plain mouseout, and hides only on Escape or when the pointer
// reaches a different titled element.
//
// Reversible by construction: one injected stylesheet, one tooltip element,
// and two document listeners stored as refs — disable() removes exactly
// those and never touches the page's own titles.
import { announce } from '../../utils/ai.js';
import { injectStyle } from './_primitives.js';

export const PersistentHover = {
  styleId: 'ai4a11y-persistent-hover-styles',
  tipId: 'ai4a11y-hover-tip',
  enabled: false,
  style: null,           // injectStyle handle
  tip: null,             // the single reusable tooltip element
  current: null,         // the titled element the tooltip is showing for
  onMouseOver: null,     // stored listener refs (for exact removal)
  onKeyDown: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    // High-contrast on both light and dark pages; overridable for
    // user-profile theming.
    const background = (options && options.background) || '#1c1c1e';
    const color = (options && options.color) || '#ffffff';
    this.style = injectStyle(this.styleId, `
      #${this.tipId} {
        position: fixed;
        z-index: 2147483647;
        max-width: 320px;
        padding: 8px 12px;
        border-radius: 6px;
        background: ${background};
        color: ${color};
        font: 500 15px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        pointer-events: auto !important;
      }
    `);

    const tip = document.createElement('div');
    tip.id = this.tipId;
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    // Inline too, so the tooltip is hoverable even if the page's own CSS
    // out-specifies our stylesheet.
    tip.style.pointerEvents = 'auto';
    (document.body || document.documentElement).appendChild(tip);
    this.tip = tip;

    // Show the tooltip when the pointer reaches a titled element. Untitled
    // targets (and the tooltip itself) are ignored, so plain mouseout never
    // hides it — that persistence is the whole point.
    this.onMouseOver = (e) => {
      if (!this.enabled) return;
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      if (this.tip && (target === this.tip || this.tip.contains(target))) return;
      const el = target.closest ? target.closest('[title]') : null;
      if (!el) return;
      const text = (el.getAttribute('title') || '').trim();
      if (!text || el === this.current) return;
      this.show(el, text);
    };
    document.addEventListener('mouseover', this.onMouseOver, true);

    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.onKeyDown, true);

    console.log('[AI4A11y] Persistent Hover enabled');
    announce('Hover tooltips now stay on screen. Press Escape to dismiss one');
  },

  // Fill the tooltip with the element's title text (textContent, never
  // innerHTML) and place it just below the element.
  show(el, text) {
    if (!this.tip) return;
    this.current = el;
    this.tip.textContent = text;
    let rect = null;
    try { rect = el.getBoundingClientRect(); } catch { /* detached */ }
    // position: fixed → viewport coordinates apply directly. No scroll offsets,
    // and no dependence on the initial containing block, which a positioned or
    // transformed ancestor would otherwise shift the tooltip against.
    const x = rect ? rect.left : 0;
    const y = (rect ? rect.bottom : 0) + 6;
    this.tip.style.left = `${Math.max(0, x)}px`;
    this.tip.style.top = `${Math.max(0, y)}px`;
    this.tip.hidden = false;
  },

  hide() {
    if (this.tip) this.tip.hidden = true;
    this.current = null;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.onMouseOver) { document.removeEventListener('mouseover', this.onMouseOver, true); this.onMouseOver = null; }
    if (this.onKeyDown) { document.removeEventListener('keydown', this.onKeyDown, true); this.onKeyDown = null; }
    if (this.style) { this.style.remove(); this.style = null; }
    if (this.tip) { this.tip.remove(); this.tip = null; }
    this.current = null;
    console.log('[AI4A11y] Persistent Hover disabled');
    announce('Persistent hover off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yPersistentHover = PersistentHover;
