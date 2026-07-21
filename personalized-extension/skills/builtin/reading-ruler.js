// Reading Ruler — a horizontal highlight band that follows the cursor's
// vertical position, keeping the eye anchored on the current line. For
// dyslexia, ADHD, and low-vision readers who lose their place mid-paragraph:
// the band acts like a finger under the text, and optional dimming shades
// above/below fade the rest of the page so only the current line pops.
//
// Reversible by construction: everything is injected nodes held as refs, and
// one document-level mousemove listener stored for exact removal. Position
// updates are throttled to one per animation frame (with a 16ms timer
// fallback where rAF is unavailable, e.g. jsdom).
import { announce } from '../../utils/ai.js';

export const ReadingRuler = {
  bandId: 'ai4a11y-reading-ruler',
  enabled: false,
  band: null,
  shadeTop: null,
  shadeBottom: null,
  height: 40,
  moveHandler: null,     // stored ref so disable() removes exactly this listener
  frame: null,           // pending rAF/timer id, cancelled on disable
  lastY: 0,
  raf: null,
  cancelRaf: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.height = options.height || 40;

    const band = document.createElement('div');
    band.id = this.bandId;
    band.setAttribute('aria-hidden', 'true');
    band.style.cssText = `position: fixed; left: 0; right: 0; height: ${this.height}px; ` +
      'background: rgba(255, 255, 0, 0.18); ' +
      'border-top: 1px solid rgba(0, 0, 0, 0.15); border-bottom: 1px solid rgba(0, 0, 0, 0.15); ' +
      'pointer-events: none; z-index: 2147483645;';
    (document.body || document.documentElement).appendChild(band);
    this.band = band;

    // Dimming shades above/below the band (skippable via options.dim: false —
    // some low-vision users want the guide line without losing page context).
    if (options.dim !== false) {
      const shade = () => {
        const el = document.createElement('div');
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position: fixed; left: 0; right: 0; ' +
          'background: rgba(0, 0, 0, 0.12); pointer-events: none; z-index: 2147483644;';
        (document.body || document.documentElement).appendChild(el);
        return el;
      };
      this.shadeTop = shade();
      this.shadeBottom = shade();
    }

    // Throttle to one reposition per frame; fall back to a 16ms timer where
    // rAF doesn't exist (jsdom without pretendToBeVisual).
    const hasRaf = typeof requestAnimationFrame === 'function';
    this.raf = hasRaf ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);
    this.cancelRaf = hasRaf ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

    this.moveHandler = (event) => {
      this.lastY = event.clientY;
      if (this.frame !== null) return;
      this.frame = this.raf(() => {
        this.frame = null;
        if (this.enabled) this.position(this.lastY);
      });
    };
    document.addEventListener('mousemove', this.moveHandler);

    // Start centered in the viewport so the ruler is visible before the first move.
    this.position((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight / 2 : 0);

    console.log('[AI4A11y] Reading Ruler enabled');
    announce('Reading ruler on. It follows your cursor.');
  },

  // Center the band (and reflow the shades) around viewport y-coordinate `y`.
  position(y) {
    if (!this.band) return;
    const top = Math.round(y - this.height / 2);
    this.band.style.top = `${top}px`;
    if (this.shadeTop) {
      this.shadeTop.style.top = '0px';
      this.shadeTop.style.height = `${Math.max(0, top)}px`;
    }
    if (this.shadeBottom) {
      this.shadeBottom.style.top = `${top + this.height}px`;
      this.shadeBottom.style.bottom = '0px';
    }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.moveHandler) {
      document.removeEventListener('mousemove', this.moveHandler);
      this.moveHandler = null;
    }
    if (this.frame !== null) { this.cancelRaf(this.frame); this.frame = null; }
    this.raf = this.cancelRaf = null;
    this.band?.remove();
    this.band = null;
    this.shadeTop?.remove();
    this.shadeTop = null;
    this.shadeBottom?.remove();
    this.shadeBottom = null;
    console.log('[AI4A11y] Reading Ruler disabled');
    announce('Reading ruler off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yReadingRuler = ReadingRuler;
