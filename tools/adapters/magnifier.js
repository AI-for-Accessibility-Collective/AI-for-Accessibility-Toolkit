// Magnifier — a text-reading lens for low-vision users. A high-contrast,
// large-print box follows the cursor and echoes the text under the pointer,
// enlarged. Unlike a pixel/screenshot magnifier it re-renders the text itself,
// so it stays sharp at any size and works without capture permissions.
//
// Reversible by construction: one injected lens element and two document
// listeners (stored as refs), all removed on disable(). The lens is
// pointer-events:none and aria-hidden — it never intercepts input, and screen
// readers skip it (it only echoes text already on the page).
import { announce } from '../utils/ai.js';

export const Magnifier = {
  lensId: 'ai4a11y-magnifier',
  enabled: false,
  lens: null,
  moveHandler: null,     // ref kept so disable() can remove the exact listener
  leaveHandler: null,
  rafId: null,
  lastEvent: null,
  lastUpdate: 0,

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
      max-width: min(60vw, 640px);
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
      pointer-events: none;
      z-index: 2147483646;
    `;
    (document.body || document.documentElement).appendChild(lens);
    this.lens = lens;

    this.moveHandler = (e) => this.onMove(e);
    this.leaveHandler = () => this.hide();
    document.addEventListener('mousemove', this.moveHandler, { passive: true });
    document.addEventListener('mouseleave', this.leaveHandler);

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
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) { this.hide(); return; }
      lens.textContent = text.length > 180 ? `${text.slice(0, 180)}…` : text;
      lens.style.display = 'block';
      this.position(e.clientX, e.clientY);
    } catch { /* elementFromPoint unavailable or hit-testing failed */ }
  },

  // Offset the lens from the cursor, flipping to the other side rather than
  // running off the viewport edge.
  position(x, y) {
    const lens = this.lens;
    if (!lens) return;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    let w = 0, h = 0;
    try { const r = lens.getBoundingClientRect(); w = r.width || 0; h = r.height || 0; } catch { /* detached */ }
    let left = x + 24;
    let top = y + 24;
    if (left + w > vw) left = Math.max(8, x - w - 24);
    if (top + h > vh) top = Math.max(8, y - h - 24);
    lens.style.left = `${left}px`;
    lens.style.top = `${top}px`;
  },

  hide() {
    if (this.lens) this.lens.style.display = 'none';
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.moveHandler) { document.removeEventListener('mousemove', this.moveHandler); this.moveHandler = null; }
    if (this.leaveHandler) { document.removeEventListener('mouseleave', this.leaveHandler); this.leaveHandler = null; }
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastEvent = null;
    this.lastUpdate = 0;
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
