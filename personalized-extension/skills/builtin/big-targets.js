// Bigger Click Targets — enlarges and spaces out small interactive controls
// (links, buttons, inputs) so people with motor/tremor differences or eye-gaze
// input can hit them reliably. From the co-design study: Taylor types with two
// fingers and misses tiny links; Clive's eye-gaze pointer needs a generous
// dwell area. Targets WCAG 2.5.8 (24x24 minimum — we aim for the preferred
// 44x44), plus extra margin so adjacent controls don't merge into one blob.
//
// Reversible by construction: one body class + one injected <style> whose
// rules are all scoped under that class. CSS-only (no per-element mutation),
// so controls added after enable are covered automatically — no
// MutationObserver needed — and disable() restores the page exactly.
import { announce } from '../../utils/ai.js';

// Interactive controls worth enlarging. Matched structurally (tag / role /
// onclick), never on size, so the one rule covers current and future elements.
const TARGET_SELECTORS = ['a', 'button', 'input', '[role="button"]', '[onclick]'];

export const BigTargets = {
  styleId: 'ai4a11y-big-targets-styles',
  bodyClass: 'ai4a11y-big-targets',
  enabled: false,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const minSize = options.minSize || 44; // px, WCAG 2.5.8 preferred size
    const gap = options.gap || 6;          // px between adjacent controls

    const scope = (suffix = '') =>
      TARGET_SELECTORS.map((s) => `body.${this.bodyClass} ${s}${suffix}`).join(',\n');

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
${scope()} {
  min-width: ${minSize}px !important;
  min-height: ${minSize}px !important;
  padding: 8px 12px !important;
  margin: ${gap}px !important;
  box-sizing: border-box !important;
}
/* min-width/height are ignored on inline boxes, and bare links are inline. */
body.${this.bodyClass} a { display: inline-block !important; }
${scope(':focus')} {
  outline: 3px solid #1a73e8 !important;
  outline-offset: 2px !important;
}`;
    (document.head || document.documentElement).appendChild(style);

    // The rules only fire once the body class is on; if <body> doesn't exist
    // yet (script in <head>), enabling simply has no visible effect until it
    // does — never crash.
    try { if (document.body) document.body.classList.add(this.bodyClass); } catch { /* detached */ }

    console.log('[AI4A11y] Bigger Click Targets enabled');
    announce('Click targets enlarged');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    try { if (document.body) document.body.classList.remove(this.bodyClass); } catch { /* detached */ }
    console.log('[AI4A11y] Bigger Click Targets disabled');
    announce('Click targets restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yBigTargets = BigTargets;
