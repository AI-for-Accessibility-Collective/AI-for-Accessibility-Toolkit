// Magnifier — a text-reading lens for low-vision users. A high-contrast,
// large-print box follows the cursor and echoes the text under the pointer,
// enlarged. Unlike a pixel/screenshot magnifier it re-renders the text itself,
// so it stays sharp at any size and works without capture permissions.
//
// Reversible by construction: one injected lens element and document
// listeners (stored as refs, including Escape dismissal and focus handling),
// all removed on disable(). The lens is pointer-events:none and aria-hidden —
// it never intercepts input, and screen readers skip it (it only echoes text
// already on the page).
import { announce } from '../utils/ai.js';

export const Magnifier = {
  lensId: 'ai4a11y-magnifier',
  enabled: false,
  lens: null,
  moveHandler: null,     // ref kept so disable() can remove the exact listener
  leaveHandler: null,
  keyHandler: null,
  focusHandler: null,
  rafId: null,
  lastEvent: null,
  lastUpdate: 0,
  dismissedEl: null,
  currentEl: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;

    const fontSize = Number(options.fontSize) || 32;
    const lens = document.createElement('div');
    lens.id = this.lensId;
    lens.setAttribute('aria-hidden', 'true');
    lens.style.cssText = `
      display: none;
      position: fixed;
      box-sizing: border-box;
      max-width: min(calc(100vw - 16px), 640px);
      max-height: min(45vh, 360px);
      overflow: auto;
      padding: 12px 18px;
      font-size: ${fontSize}px;
      line-height: 1.35;
      font-family: system-ui, -apple-system, sans-serif;
      color: #ffffff;
      background: #111111;
      border: 2px solid #ffffff;
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
      overflow-wrap: break-word;
      word-break: break-word;
      pointer-events: none;
      z-index: 2147483646;
    `;
    (document.body || document.documentElement).appendChild(lens);
    this.lens = lens;

    this.moveHandler = (e) => this.onMove(e);
    this.leaveHandler = () => {
      this.dismissedEl = null;
      this.hide();
    };
    // WCAG 1.4.13: Content shown on hover can be dismissed with Escape without
    // moving hover, staying dismissed while pointer remains on that element.
    this.keyHandler = (e) => {
      if (e.key === 'Escape') {
        this.dismissedEl = this.currentEl || (this.lastEvent && typeof document.elementFromPoint === 'function'
          ? document.elementFromPoint(this.lastEvent.clientX, this.lastEvent.clientY)
          : null);
        this.hide();
      }
    };
    // WCAG 2.4.11: Keyboard focus must not be obscured by the lens.
    this.focusHandler = () => this.hide();

    document.addEventListener('mousemove', this.moveHandler, { passive: true });
    document.addEventListener('mouseleave', this.leaveHandler);
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('focusin', this.focusHandler);

    console.log('[AI4A11y] Magnifier enabled');
    announce('Magnifier on. Move the pointer over text to enlarge it');
  },

  // Coalesce the mousemove firehose into one lens update per frame (or a
  // ~30ms gate where requestAnimationFrame doesn't exist).
  onMove(e) {
    if (!this.enabled) return;
    this.lastEvent = e;
    if (typeof requestAnimationFrame === 'function') {
      if (this.rafId !== null) return; // an update is already scheduled
      this.rafId = requestAnimationFrame(() => { this.rafId = null; this.update(); });
    } else {
      const now = Date.now();
      if (now - this.lastUpdate < 30) return;
      this.lastUpdate = now;
      this.update();
    }
  },

  update() {
    const lens = this.lens;
    const e = this.lastEvent;
    if (!this.enabled || !lens || !e) return;
    try {
      // No real layout (e.g. jsdom) means no hit-testing — no-op safely.
      if (typeof document.elementFromPoint !== 'function') return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === lens || lens.contains(el)) return;
      if (this.dismissedEl && (el === this.dismissedEl || this.dismissedEl.contains(el))) return;
      this.dismissedEl = null;
      const text = this.textAt(e.clientX, e.clientY);
      if (!text) { this.hide(); return; }
      this.currentEl = el;
      lens.textContent = text;
      lens.style.display = 'block';
      this.position(e.clientX, e.clientY);
    } catch { /* elementFromPoint unavailable or hit-testing failed */ }
  },

  // The text the pointer is actually on. Taking the hit element's
  // textContent showed a whole card or section, words glued together
  // ("New in booksThe Weeknight Pantry…"), even over blank space. Use the text
  // node under the pointer instead: its element's words if short, else the
  // words around the pointer. Returns '' when the pointer isn't on text.
  textAt(x, y) {
    let node = null, offset = 0;
    if (typeof document.caretPositionFromPoint === 'function') {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (typeof document.caretRangeFromPoint === 'function') {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (node && node.nodeType === 1 && node.childNodes.length > 0) {
      const child = node.childNodes[offset] || node.childNodes[offset - 1];
      if (child && child.nodeType === 3) node = child;
    }
    if (!node || node.nodeType !== 3 || !node.parentElement) return '';
    // The caret lands on the nearest text even from blank space beside it.
    // Allow a small vertical tolerance between lines so moving across lines in a
    // paragraph doesn't flicker the lens off in the line gap.
    const range = document.createRange();
    range.selectNodeContents(node);
    const lineGap = 8;
    const on = Array.from(range.getClientRects()).some(r =>
      x >= r.left - 2 && x <= r.right + 2 && y >= r.top - lineGap && y <= r.bottom + lineGap
    );
    if (!on) return '';
    // innerText, not textContent: it leaves out hidden text (a closed
    // tooltip inside the element) and keeps blocks apart.
    const el = node.parentElement;
    const whole = String(el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (whole.length <= 180) return whole;
    const t = node.data;
    const start = Math.max(0, offset - 80);
    const end = Math.min(t.length, offset + 100);
    const part = t.slice(start, end).replace(/\s+/g, ' ').trim();
    return part ? `${start > 0 ? '…' : ''}${part}${end < t.length ? '…' : ''}` : '';
  },

  // Offset the lens from the cursor, flipping to the other side rather than
  // running off the viewport edge, and ensuring it never covers the pointer (WCAG 2.4.11).
  position(x, y) {
    const lens = this.lens;
    if (!lens) return;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    let w = 0, h = 0;
    try { const r = lens.getBoundingClientRect(); w = r.width || 0; h = r.height || 0; } catch { /* detached */ }

    // Vertical placement: place below cursor if it fits, else above.
    // If neither fits with full clearance, place on whichever side has more room
    // and guarantee top never overlaps y.
    const gap = 24;
    let top;
    if (y + gap + h <= vh - 8) {
      top = y + gap;
    } else if (y - gap - h >= 8) {
      top = y - gap - h;
    } else if (y >= vh / 2) {
      top = Math.max(8, y - h - 8);
    } else {
      top = Math.min(vh - h - 8, y + 8);
    }

    // Horizontal placement: offset right by default, flip left if overflowing right.
    // If it doesn't fit on either side (e.g. narrow screen), center/clamp within margins.
    // Because top is strictly above or below y, the lens never covers the pointer.
    let left;
    if (x + gap + w <= vw - 8) {
      left = x + gap;
    } else if (x - gap - w >= 8) {
      left = x - gap - w;
    } else {
      left = Math.max(8, Math.min(vw - w - 8, x - Math.round(w / 2)));
    }

    lens.style.left = `${left}px`;
    lens.style.top = `${top}px`;
  },

  hide() {
    if (this.lens) this.lens.style.display = 'none';
    this.currentEl = null;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.moveHandler) { document.removeEventListener('mousemove', this.moveHandler); this.moveHandler = null; }
    if (this.leaveHandler) { document.removeEventListener('mouseleave', this.leaveHandler); this.leaveHandler = null; }
    if (this.keyHandler) { document.removeEventListener('keydown', this.keyHandler); this.keyHandler = null; }
    if (this.focusHandler) { document.removeEventListener('focusin', this.focusHandler); this.focusHandler = null; }
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastEvent = null;
    this.lastUpdate = 0;
    this.dismissedEl = null;
    this.currentEl = null;
    document.getElementById(this.lensId)?.remove();
    this.lens = null;
    console.log('[AI4A11y] Magnifier disabled');
    announce('Magnifier off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yMagnifier = Magnifier;
