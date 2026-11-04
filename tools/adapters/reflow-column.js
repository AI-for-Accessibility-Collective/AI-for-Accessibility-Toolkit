// Reflow — forces the page into one narrow readable column so a low-vision
// user who zooms in doesn't have to scroll horizontally or untangle content
// that overlaps when the viewport shrinks. Multi-column, floated, and wide
// grid/flex layouts are the usual culprits: at high zoom they push text off
// screen instead of wrapping. Targets WCAG 1.4.10 (Reflow — content usable at
// 320px width without two-dimensional scrolling).
//
// Reversible by construction: one class on <html> + one injected <style>
// whose rules are all scoped under that class, plus marker classes on the
// grid/flex boxes that didn't fit and on the floats it un-floated (tracked
// in a Set). disable() removes all of them and restores the page exactly.
import { announce } from '../utils/ai.js';
import { injectStyle } from './_primitives.js';
import { registerSweep } from '../utils/observe.js';

export const ReflowColumn = {
  styleId: 'ai4a11y-reflow-column-styles',
  rootClass: 'ai4a11y-reflow',
  gridClass: 'ai4a11y-reflow-grid',
  wrapClass: 'ai4a11y-reflow-wrap',
  floatClass: 'ai4a11y-reflow-float',
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
/* CSS multi-column puts text side by side. Scoped to a FINITE set of
 * block/layout/media elements rather than a universal selector: a universal
 * !important rule defeats the browser style-sharing and forces a whole-tree
 * style+layout recalc that locks the main thread for seconds on large pages. */
${scope} div, ${scope} section, ${scope} article, ${scope} aside, ${scope} main,
${scope} header, ${scope} footer, ${scope} nav, ${scope} figure, ${scope} figcaption,
${scope} p, ${scope} ul, ${scope} ol, ${scope} dl, ${scope} li, ${scope} table,
${scope} blockquote, ${scope} pre, ${scope} form, ${scope} fieldset {
  /* auto, not 1: column-count:1 still makes a multi-column box, which broke
   * two-line clamped product names (they spilled to their full length). */
  column-count: auto !important;
  column-width: auto !important;
}
/* Floats put content side by side too, but only the ones fit() marks are
 * un-floated: columns of blocks and floated media (see unfloat()). */
${scope} .${this.floatClass} { float: none !important; }
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
    this.unfloat();
    // A box already made one column or wrapping (an un-floated one may still be).
    const changed = (el) => el.classList.contains(this.gridClass) || el.classList.contains(this.wrapClass);
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
        if (changed(el) || found.has(el)) return;
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
            if (!changed(a) && kind(a)) outer = a;
          }
          if (outer) add(outer, kind(outer));
        }
      }
      if (!found.size) break;
      for (const [el, cls] of found) { el.classList.add(cls); this.marked.add(el); }
    }
  },

  // The elements a float is taken off (the same finite set the column rule
  // covers), and the media among them: a floated photo beside text.
  floatTags: new Set(['div', 'section', 'article', 'aside', 'main', 'header', 'footer', 'nav', 'figure', 'figcaption', 'p', 'ul', 'ol', 'dl', 'li', 'table', 'blockquote', 'pre', 'form', 'fieldset', 'img', 'picture', 'video', 'iframe']),
  floatMedia: new Set(['img', 'picture', 'video', 'iframe']),

  // Un-float the floats that are columns: a box holding blocks of its own
  // (a sidebar, an article beside it), or a floated photo. A float that is an
  // item in a row (a tab, a link, a label beside its field) holds only text,
  // or only floats of its own: un-floating that one does not make a column,
  // it breaks the row. The box no longer contains the floats inside it, so
  // it collapses to no height and its background goes out from under its
  // links (white text on the page's grey), and their floats pile onto the
  // next row's; an element the page sets display:inline goes back to inline.
  // Decided on the layout as it is (all reads before any change).
  unfloat() {
    const found = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.classList.contains(this.floatClass) || !this.floatTags.has(el.localName)) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (!cs.float || cs.float === 'none') continue;
      if (this.floatMedia.has(el.localName) || this.holdsBlocks(el)) found.push(el);
    }
    for (const el of found) { el.classList.add(this.floatClass); this.marked.add(el); }
  },

  // A child in the flow (not floated, not positioned out of it) that is laid
  // out as a block and has height: a paragraph, a heading, a list of items.
  // A list whose items are all floated has no height, and holds no blocks.
  holdsBlocks(el) {
    for (const c of el.children) {
      let cs;
      try { cs = getComputedStyle(c); } catch { continue; }
      if (cs.float !== 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      if (!/^(block|flow-root|list-item|table|flex|grid)\b/.test(cs.display)) continue;
      if (c.getBoundingClientRect().height > 0) return true;
    }
    return false;
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
        try { el.classList.remove(this.gridClass, this.wrapClass, this.floatClass); } catch { /* detached */ }
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
