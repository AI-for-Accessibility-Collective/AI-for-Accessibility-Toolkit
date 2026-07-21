// Reflow — forces the page into one narrow readable column so a low-vision
// user who zooms in doesn't have to scroll horizontally or untangle content
// that overlaps when the viewport shrinks. Multi-column, floated, and wide
// grid/flex layouts are the usual culprits: at high zoom they push text off
// screen instead of wrapping. Targets WCAG 1.4.10 (Reflow — content usable at
// 320px width without two-dimensional scrolling).
//
// Reversible by construction: one class on <html> + one injected <style>
// whose rules are all scoped under that class. CSS-only (no per-element
// mutation), so content added after enable is covered automatically and
// disable() restores the page exactly.
import { announce } from '../../utils/ai.js';
import { injectStyle } from './_primitives.js';

export const ReflowColumn = {
  styleId: 'ai4a11y-reflow-column-styles',
  rootClass: 'ai4a11y-reflow',
  enabled: false,
  style: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const width = options.width || 720; // px, comfortable reading measure

    const scope = `html.${this.rootClass}`;
    this.style = injectStyle(this.styleId, `
${scope} body {
  max-width: ${width}px !important;
  margin: 0 auto !important;
}
/* Floats and CSS multi-column are what put content side by side. */
${scope} * {
  float: none !important;
  column-count: 1 !important;
}
/* Linearize the common layout containers so rows stack into one column. */
${scope} [style*="display: flex"],
${scope} [style*="display:flex"],
${scope} [style*="display: grid"],
${scope} [style*="display:grid"],
${scope} main,
${scope} section,
${scope} article {
  display: block !important;
  max-width: 100% !important;
}
/* Media and tables must shrink to the column, never widen it. */
${scope} img,
${scope} video,
${scope} table {
  max-width: 100% !important;
  height: auto !important;
}`);

    // The rules only fire once the class is on the root element.
    try { document.documentElement.classList.add(this.rootClass); } catch { /* detached */ }

    console.log('[AI4A11y] Reflow enabled');
    announce('Page reflowed into a single column');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try { document.documentElement.classList.remove(this.rootClass); } catch { /* detached */ }
    try { this.style?.remove(); } catch { /* detached */ }
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    this.style = null;
    console.log('[AI4A11y] Reflow disabled');
    announce('Page layout restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yReflowColumn = ReflowColumn;
