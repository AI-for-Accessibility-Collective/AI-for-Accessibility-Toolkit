// Reflow — forces the page into one narrow readable column so a low-vision
// user who zooms in doesn't have to scroll horizontally or untangle content
// that overlaps when the viewport shrinks. Multi-column, floated, and wide
// grid/flex layouts are the usual culprits: at high zoom they push text off
// screen instead of wrapping. Targets WCAG 1.4.10 (Reflow — content usable at
// 320px width without two-dimensional scrolling).
//
// Reversible by construction: one class on <html> + one injected <style>
// whose rules are all scoped under that class, plus marker classes on the
// grid/flex boxes that didn't fit (tracked in a Set). disable() removes all
// of them and restores the page exactly.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';
import { registerSweep } from '../utils/observe.js';

export const ReflowColumn = {
  styleId: 'ai4a11y-reflow-column-styles',
  rootClass: 'ai4a11y-reflow',
  gridClass: 'ai4a11y-reflow-grid',
  wrapClass: 'ai4a11y-reflow-wrap',
  enabled: false,
  style: null,
  marked: null,          // Set of boxes we gave a marker class (for exact restore)
  unregisterSweep: null,
  resizeHandler: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.marked = new Set();
    const width = options.width || 720; // px, comfortable reading measure

    const scope = `html.${this.rootClass}`;
    this.style = injectStyle(this.styleId, `
${scope} body {
  max-width: ${width}px !important;
  margin: 0 auto !important;
}
/* A minimum width on the page itself is what forces sideways scrolling when
 * zoomed in (e.g. body { min-width: 1280px }). */
${scope}, ${scope} body { min-width: 0 !important; }
/* Floats and CSS multi-column are what put content side by side. Scoped to a
 * FINITE set of block/layout/media elements rather than a universal selector:
 * a universal !important rule defeats the browser style-sharing and forces a
 * whole-tree style+layout recalc that locks the main thread for seconds on
 * large pages. These are the elements that actually get floated or become
 * multi-column; inline/text/table-cell leaves are left untouched. */
${scope} div, ${scope} section, ${scope} article, ${scope} aside, ${scope} main,
${scope} header, ${scope} footer, ${scope} nav, ${scope} figure, ${scope} figcaption,
${scope} p, ${scope} ul, ${scope} ol, ${scope} dl, ${scope} li, ${scope} table,
${scope} blockquote, ${scope} pre, ${scope} form, ${scope} fieldset,
${scope} img, ${scope} picture, ${scope} video, ${scope} iframe {
  float: none !important;
  /* auto, not 1: column-count:1 still makes a multi-column box, which broke
   * two-line clamped product names (they spilled to their full length). */
  column-count: auto !important;
  column-width: auto !important;
}
/* Grid and flex boxes are only changed when they don't fit (fit() finds them):
 * forcing every flex/grid box to display:block also broke rows that fit fine
 * (photo thumbnails, price lines) and moved positioned badges out of place.
 * A grid that doesn't fit becomes one column, keeping its gaps. */
${scope} .${this.gridClass} {
  grid-template-columns: minmax(0, 1fr) !important;
  grid-template-areas: none !important;
}
${scope} .${this.gridClass} > * {
  grid-column: auto !important;
  grid-row: auto !important;
  min-width: 0 !important;
}
/* A flex row that doesn't fit wraps onto more lines. (Its items keep their
 * min-width: lowering it let a search box shrink to one letter instead of
 * moving to its own line.) */
${scope} .${this.wrapClass} { flex-wrap: wrap !important; }
${scope} .${this.wrapClass} > * { max-width: 100% !important; }
/* Media and tables must shrink to the column, never widen it. No height
 * override: height:auto !important re-cropped photos the page sizes with a
 * fixed height and object-fit, and stretched ones with an aspect-ratio. */
${scope} img,
${scope} video,
${scope} iframe,
${scope} table {
  max-width: 100% !important;
}`);

    // The rules only fire once the class is on the root element.
    try { document.documentElement.classList.add(this.rootClass); } catch { /* detached */ }
    this.fit();

    // Content added later (re-rendered results, client-side routing) and a
    // narrower window can make a box stop fitting.
    this.unregisterSweep = registerSweep('reflow-column', () => this.fit(), { debounceMs: 300 });
    this.resizeHandler = () => this.fit();
    try { window.addEventListener('resize', this.resizeHandler, { passive: true }); } catch { /* no window */ }

    console.log('[AI4A11y] Reflow enabled');
    announce('Page reflowed into a single column');
  },

  // Mark the grid and flex boxes that don't fit the column: their content is
  // wider than the box, or it squeezes text into a strip a few words wide
  // (a cart line's product name, one word per line, beside a fixed-width
  // photo). For squeezed text the OUTERMOST multi-column box around it is
  // changed first: making the page's own columns into one usually gives the
  // inner ones room again, so they keep their layout and their photos keep
  // their size. One pass marks only outermost boxes and the next pass
  // measures again. Only adds classes (never nodes), so the sweep's childList
  // observer does not see its own work.
  fit() {
    if (!this.enabled || typeof document === 'undefined' || !document.body) return;
    const kind = (el) => {
      let cs;
      try { cs = getComputedStyle(el); } catch { return null; }
      // A row that scrolls or clips on purpose (a carousel, a ticker) doesn't
      // make the page scroll sideways.
      if (cs.overflowX !== 'visible' || cs.position === 'fixed') return null;
      if (/grid$/.test(cs.display)) return (cs.gridTemplateColumns || '').trim().split(/\s+/).length > 1 ? this.gridClass : null;
      if (/flex$/.test(cs.display) && !cs.flexDirection.startsWith('column') && cs.flexWrap === 'nowrap') return this.wrapClass;
      return null;
    };
    for (let pass = 0; pass < 6; pass++) {
      const found = new Map();
      const add = (el, cls) => {
        if (this.marked.has(el) || found.has(el)) return;
        for (const f of found.keys()) if (f.contains(el)) return;
        for (const f of [...found.keys()]) if (el.contains(f)) found.delete(f);
        found.set(el, cls);
      };
      for (const el of document.body.querySelectorAll('*')) {
        if (el.id && el.id.startsWith('ai4a11y-')) continue;
        if (el.scrollWidth > el.clientWidth + 1) { // wider than its box (no layout, e.g. jsdom: never)
          const cls = kind(el);
          if (cls) add(el, cls);
        }
        if (this.squeezed(el)) {
          let outer = null;
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            if (!this.marked.has(a) && kind(a)) outer = a;
          }
          if (outer) add(outer, kind(outer));
        }
      }
      if (!found.size) break;
      for (const [el, cls] of found) { el.classList.add(cls); this.marked.add(el); }
    }
  },

  // Text of some length wrapped into a strip about two words wide (fewer
  // than ~14 characters a line). Narrower than a phone layout's columns, so
  // a page that is already one column is left as it is.
  squeezed(el) {
    let len = 0;
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) len += n.data.trim().length;
    if (len < 40) return false;
    let w = 0, fs = 0;
    try { w = el.getBoundingClientRect().width; fs = parseFloat(getComputedStyle(el).fontSize); } catch { return false; }
    if (!w || !fs || w < 2 * fs) return false; // no layout, or visually hidden text
    const perLine = w / (0.5 * fs);
    return perLine < 14 && len > 3 * perLine;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.unregisterSweep) { this.unregisterSweep(); this.unregisterSweep = null; }
    if (this.resizeHandler) {
      try { window.removeEventListener('resize', this.resizeHandler); } catch { /* no window */ }
      this.resizeHandler = null;
    }
    if (this.marked) {
      for (const el of this.marked) {
        try { el.classList.remove(this.gridClass, this.wrapClass); } catch { /* detached */ }
      }
      this.marked = null;
    }
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
