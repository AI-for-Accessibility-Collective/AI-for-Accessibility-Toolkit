// Bigger Click Targets — enlarges small interactive controls (links, buttons,
// inputs) so people with motor/tremor differences, older adults, or eye-gaze
// input can hit them reliably. From the co-design study: Taylor types with two
// fingers and misses tiny links; Clive's eye-gaze pointer needs a generous
// dwell area. Targets WCAG 2.5.8 (24x24 minimum — we aim for the preferred
// 44x44).
//
// It MEASURES before it changes anything. The first version put min-size,
// padding, margin and display:inline-block on every a/button/input, which
// re-flowed whole pages: product-card links grew padding around their photos
// (photos shrank), the header grew, checkboxes became 44px squares, and the
// page scrolled sideways. Now each control is sized up only as far as it is
// actually small, in one of three ways that leave the layout alone:
//   • grow — buttons, fields and icon-sized controls (a −/+ button, a heart,
//     a color swatch) get min-width/min-height. Checked afterwards: if that
//     makes its container overflow, it falls back to the next way.
//   • hit  — text links and everything else keep their look; an invisible
//     ::after extends the clickable area around them, only into free space
//     (never over a neighbouring control) and never past the page edge.
//   • box  — tiny checkboxes and radios are drawn at 24px, and a label the
//     page made unclickable (pointer-events:none) is made clickable again,
//     so the whole "Free shipping" row is the target, not an 11px box.
//
// Reversible: one body class, one <style>, and data-ai4a11y-bt* attributes;
// disable() removes all three. Re-runs (debounced) when the page adds
// controls or its size changes (fonts loading, another adapter enlarging
// text), always measuring the page without its own changes first.
import { announce } from '../utils/ai.js';
import { registerSweep } from '../utils/observe.js';

// Interactive controls. Matched structurally; elements the page made
// clickable with a script (a <div> "Add to cart", a color circle) are found by
// their pointer cursor instead.
const TARGET_SELECTORS = ['a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[onclick]', '[tabindex]:not([tabindex="-1"])'];
const TARGETS = TARGET_SELECTORS.join(',');
const MARK = 'data-ai4a11y-bt';      // grow | box | label | hit | rel (space-separated)
const NUM = 'data-ai4a11y-bt-n';     // per-element id for its hit-area rule
const NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|svg|OBJECT|EMBED)$/;
const BOX_TYPES = /^(checkbox|radio)$/;
const NO_GROW_TYPES = /^(hidden|range|file|color|image)$/;
const GROW_ROLES = /^(button|tab|menuitem|switch|option)$/;

function isClear(color) { return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color); }

export const BigTargets = {
  styleId: 'ai4a11y-big-targets-styles',
  bodyClass: 'ai4a11y-big-targets',
  enabled: false,
  minSize: 44,
  boxSize: 24,
  _marked: [],
  _seen: null,
  _count: -1,
  _bodySize: '',
  _unregister: null,
  _resizeObs: null,
  _timer: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.minSize = Number(options.minSize) > 0 ? Number(options.minSize) : 44; // px, WCAG 2.5.5 / 2.5.8 preferred
    this.boxSize = Math.max(24, Math.round(this.minSize * 0.55));             // checkbox / radio size

    const style = document.createElement('style');
    style.id = this.styleId;
    (document.head || document.documentElement).appendChild(style);
    this._writeStyle('');

    // The rules only fire once the body class is on; if <body> doesn't exist
    // yet (script in <head>), enabling simply has no visible effect until it
    // does — never crash.
    try { if (document.body) document.body.classList.add(this.bodyClass); } catch { /* detached */ }
    this._seen = new WeakSet();
    this._apply();

    // New controls (search results, an "Added to cart" panel) and late layout
    // changes. Both are debounced, and both skip the work when nothing new
    // turned up, so a ticking countdown doesn't keep the CPU busy.
    this._unregister = registerSweep('big-targets', () => this._maybeApply(), { debounceMs: 400 });
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      this._resizeObs = new ResizeObserver(() => {
        if (!this.enabled || this._sizeKey() === this._bodySize) return; // our own last pass
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._apply(), 300);
      });
      this._resizeObs.observe(document.body);
    }

    console.log('[AI4A11y] Bigger Click Targets enabled');
    announce('Click targets enlarged');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._unregister) { this._unregister(); this._unregister = null; }
    if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    clearTimeout(this._timer); this._timer = null;
    this._clearMarks();
    this._seen = null;
    this._count = -1;
    this._bodySize = '';
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    try { if (document.body) document.body.classList.remove(this.bodyClass); } catch { /* detached */ }
    console.log('[AI4A11y] Bigger Click Targets disabled');
    announce('Click targets restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },

  _sizeKey() {
    const b = document.body;
    return b ? b.offsetWidth + 'x' + b.offsetHeight : '';
  },

  _writeStyle(perElement) {
    const el = document.getElementById(this.styleId);
    if (!el) return;
    const b = `body.${this.bodyClass}`;
    const focus = TARGET_SELECTORS.map((s) => `${b} ${s}:focus-visible`).join(',\n');
    el.textContent = `
${b} [${MARK}~="grow"] { min-width: ${this.minSize}px !important; min-height: ${this.minSize}px !important; }
${b} [${MARK}~="glyph"] { font-size: ${Math.round(this.minSize * 0.45)}px !important; }
${b} [${MARK}~="box"] { width: ${this.boxSize}px !important; height: ${this.boxSize}px !important; flex-shrink: 0 !important; }
${b} [${MARK}~="label"] { pointer-events: auto !important; cursor: pointer; }
${b} [${MARK}~="rel"] { position: relative !important; }
${b} [${MARK}~="hit"]::after { content: "" !important; position: absolute !important; }
${focus} {
  outline: 3px solid #1a73e8 !important;
  outline-offset: 2px !important;
}
${perElement}`;
  },

  _clearMarks() {
    for (const el of this._marked) { try { el.removeAttribute(MARK); el.removeAttribute(NUM); } catch { /* detached */ } }
    this._marked = [];
  },

  _mark(el, token) {
    const cur = el.getAttribute(MARK);
    if (!cur) this._marked.push(el);
    el.setAttribute(MARK, cur ? cur + ' ' + token : token);
  },

  // Everything a person could click: the structural controls, plus the
  // outermost element with a pointer cursor that isn't inside one of them.
  _candidates() {
    const found = new Set();
    for (const el of document.querySelectorAll(TARGETS)) found.add(el);
    for (const el of document.body.getElementsByTagName('*')) {
      if (found.has(el) || el.id === this.styleId) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      if (cs.cursor !== 'pointer') continue;
      const p = el.parentElement;
      if (p && p !== document.body && getComputedStyle(p).cursor === 'pointer') continue;
      if (el.closest(TARGETS)) continue;
      found.add(el);
    }
    return [...found].filter((el) => !(el.closest && el.closest('#ws-root')));
  },

  _maybeApply() {
    if (!this.enabled || !document.body) return;
    const list = this._candidates();
    if (list.length === this._count && list.every((el) => this._seen.has(el))) return; // nothing new
    this._apply(list);
  },

  // Reads and writes are kept in separate passes: interleaving them would
  // make the browser lay out the whole page again once per control.
  _apply(list) {
    if (!this.enabled || !document.body || !document.getElementById(this.styleId)) return;
    const MIN = this.minSize, BOX = this.boxSize;
    const root = document.documentElement;
    // Measure the page as it is without us, so a re-run never compounds.
    this._clearMarks();
    this._writeStyle('');
    list = list || this._candidates();
    this._count = list.length;
    for (const el of list) this._seen.add(el);

    // ── read: what is small, and what kind of control it is
    const items = [];
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      items.push({ el, cs, r, small: r.width < MIN || r.height < MIN });
    }
    const docW = root.clientWidth, docSW = root.scrollWidth;
    const writes = [];
    const grown = [];
    for (const it of items) {
      const { el, cs, r } = it;
      if (!it.small || el.disabled) continue;
      const tag = el.tagName, type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'INPUT' && BOX_TYPES.test(type)) {
        // An invisible input laid over a custom control (opacity:0) is sized
        // by that control; only real, visible boxes are drawn bigger.
        if (cs.opacity !== '0' && cs.position !== 'absolute' && (r.width < BOX || r.height < BOX)) { writes.push([el, 'box']); it.kind = 'box'; }
        const label = el.closest('label') || (el.labels && el.labels[0]);
        if (label && getComputedStyle(label).pointerEvents === 'none') writes.push([label, 'label']);
        if (it.kind !== 'box') it.kind = 'input';
        continue;
      }
      if (cs.display === 'inline' || cs.display === 'contents') continue; // min sizes don't apply to inline boxes
      const role = el.getAttribute('role') || '';
      const text = (el.textContent || '').trim();
      const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;
      // A filled or outlined box reads as a button; a transparent border doesn't.
      const looksLikeButton = !isClear(cs.backgroundColor) || (parseFloat(cs.borderTopWidth) > 0 && !isClear(cs.borderTopColor));
      // A control laid over other things (a save heart in the corner of a product card) would cover
      // the title or photo under it if it grew, so it gets a hit area instead.
      const overlaid = cs.position === 'absolute' || cs.position === 'fixed';
      const growable = !overlaid && (tag === 'BUTTON' || tag === 'SELECT' || tag === 'SUMMARY' ||
        (tag === 'INPUT' && !NO_GROW_TYPES.test(type)) || GROW_ROLES.test(role) || iconLike ||
        (tag !== 'LABEL' && looksLikeButton));
      if (!growable) continue;
      const p = el.parentElement, g = p && p.parentElement;
      it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
      it.kind = 'grow';
      // A bigger −/+ or × button with the same 12px sign is still hard to see.
      writes.push([el, text && parseFloat(cs.fontSize) < this.minSize * 0.45 && iconLike ? 'grow glyph' : 'grow']);
      grown.push(it);
    }
    // ── write
    for (const [el, token] of writes) this._mark(el, token);

    // ── read: undo any growth that made its container overflow (it would
    // overlap the next thing, or scroll) or pushed past the page's right edge
    const undo = grown.filter((it) => {
      const r = it.el.getBoundingClientRect();
      return it.before.some(([a, w, h]) => (a.scrollWidth - a.clientWidth) > w + 1 || (a.scrollHeight - a.clientHeight) > h + 1) ||
        (r.right > docW + 0.5 && it.r.right <= docW + 0.5);
    });
    // ── write
    const ungrow = (it) => { it.el.setAttribute(MARK, (it.el.getAttribute(MARK) || '').replace(/\b(grow|glyph)\b/g, '').trim() || 'none'); it.kind = null; };
    undo.forEach(ungrow);
    if (grown.length && root.scrollWidth > docSW + 1) grown.filter((it) => it.kind === 'grow').forEach(ungrow);

    // ── read: hit areas, sized against where everything sits now
    const rects = items.map((it) => ({ el: it.el, r: it.el.getBoundingClientRect() }));
    const hits = [];
    for (const it of items) {
      if (!it.small || it.kind) continue;
      const { el, cs } = it;
      if (NO_PSEUDO.test(el.tagName) || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= MIN && r.height >= MIN) continue;
      if (el.getClientRects().length > 1) continue;                  // a link wrapped over two lines
      if (cs.overflow !== 'visible') continue;                         // it would clip its own ::after
      const after = getComputedStyle(el, '::after').content;
      if (after && after !== 'none' && after !== 'normal') continue;   // the page already uses ::after
      // It would cover the controls inside it. A label may cover its own box:
      // a click on the label is a click on the box.
      const inner = el.querySelector(TARGETS);
      if (inner && !(el.tagName === 'LABEL' && [...el.querySelectorAll(TARGETS)].every((c) => c.tagName === 'INPUT'))) continue;
      const relative = cs.position === 'static';
      if (relative && [...el.querySelectorAll('*')].some((d) => /absolute|fixed/.test(getComputedStyle(d).position))) continue;

      const want = { x: Math.max(0, (MIN - r.width) / 2), y: Math.max(0, (MIN - r.height) / 2) };
      let top = want.y, bottom = want.y, left = want.x, right = want.x;
      // Never over a neighbouring control: take at most half the free space.
      for (const o of rects) {
        if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
        const q = o.r;
        const overlapX = q.left < r.right + right && q.right > r.left - left;
        const overlapY = q.top < r.bottom + bottom && q.bottom > r.top - top;
        if (overlapX && q.bottom <= r.top + 0.5) top = Math.min(top, (r.top - q.bottom) / 2);
        if (overlapX && q.top >= r.bottom - 0.5) bottom = Math.min(bottom, (q.top - r.bottom) / 2);
        if (overlapY && q.right <= r.left + 0.5) left = Math.min(left, (r.left - q.right) / 2);
        if (overlapY && q.left >= r.right - 0.5) right = Math.min(right, (q.left - r.right) / 2);
      }
      // Never past the edge of the page or of a scrolling box, which would
      // make it scroll further (sideways, on a phone).
      let box = { left: 0, right: docW, top: -window.scrollY, bottom: root.scrollHeight - window.scrollY };
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const ar = a.getBoundingClientRect();
          const x0 = ar.left + a.clientLeft - a.scrollLeft, y0 = ar.top + a.clientTop - a.scrollTop;
          box = { left: x0, right: x0 + a.scrollWidth, top: y0, bottom: y0 + a.scrollHeight };
          break;
        }
      }
      const px = (v) => Math.max(0, Math.floor(v));
      const t = px(Math.min(top, r.top - box.top)), b = px(Math.min(bottom, box.bottom - r.bottom));
      const l = px(Math.min(left, r.left - box.left)), rt = px(Math.min(right, box.right - r.right));
      if (t + b + l + rt < 2) continue;
      hits.push({ el, relative, t, b, l, rt });
    }
    // ── write
    const rules = hits.map((h, i) => {
      h.el.setAttribute(NUM, String(i + 1));
      this._mark(h.el, h.relative ? 'hit rel' : 'hit');
      return `body.${this.bodyClass} [${NUM}="${i + 1}"]::after { top: -${h.t}px; right: -${h.rt}px; bottom: -${h.b}px; left: -${h.l}px; }`;
    });
    this._writeStyle(rules.join('\n'));
    // Our own pass changes the body's size; remember it so the resize
    // observer doesn't run us again for it.
    this._bodySize = this._sizeKey();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yBigTargets = BigTargets;
