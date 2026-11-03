// Describe on Demand — the BLV keystone. Lets a blind or low-vision user point
// at ANY element and get an AI description on request, instead of relying on
// whatever alt text a page happened to include. This is the "what's this?"
// primitive from the co-design study (Made, Daniel): press Alt+D to describe
// the focused element (keyboard / screen-reader path), or Alt+click one (mouse
// path). Images are sent to vision; charts on <canvas> are captured to an
// image; everything else is summarized from its text + labels.
//
// Reuses the already-wired describeImage / summarizeText providers, so it needs
// no new AI plumbing. Avoids obscuring the described element or its focus ring
// by flipping to the top when the target is in the bottom-right corner. The close
// button meets WCAG 2.5.8 target size (at least 24x24 px). Reversible: all
// listeners, the panel, the live region, and the injected style are removed on
// disable.
import { describeImage, summarizeText, announce } from '../utils/ai.js';
import { imageToDataUrl } from '../utils/image.js';
import { injectStyle } from './_primitives.js';

export const DescribeOnDemand = {
  // Shown when the provider throws. Fixed on purpose; see describe() below.
  PROVIDER_ERROR_TEXT: 'No description is available. The AI provider reported an error; check its settings and try again.',
  styleId: 'ai4a11y-describe-styles',
  enabled: false,
  panel: null,
  live: null,
  lastHover: null,
  _lastTarget: null,
  _reqSeq: 0,
  _liveTimer: null,
  _keyHandler: null,
  _clickHandler: null,
  _moveHandler: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    injectStyle(this.styleId, `
      #ai4a11y-describe-panel {
        position: fixed; bottom: 16px; right: 16px; max-width: min(360px, calc(100vw - 32px)); z-index: 2147483647;
        box-sizing: border-box;
        background: #10141a; color: #f2f5f9; border: 2px solid #1a73e8; border-radius: 10px;
        padding: 12px 14px; font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
        word-break: break-word; overflow-wrap: break-word;
      }
      #ai4a11y-describe-panel h2 { font-size: 13px; margin: 0 0 6px; padding-right: 28px; color: #8ab4f8; text-transform: uppercase; letter-spacing: .04em; }
      #ai4a11y-describe-panel .ai4a11y-describe-close {
        position: absolute; top: 6px; right: 8px;
        width: 28px; height: 28px; min-width: 24px; min-height: 24px;
        display: inline-flex; align-items: center; justify-content: center;
        background: none; border: none; color: #f2f5f9;
        font-size: 18px; line-height: 1; cursor: pointer; padding: 0;
        border-radius: 4px;
      }
      /* Our own focus ring: a page that turns outlines off everywhere (with
         !important) would otherwise hide the keyboard on the close button. */
      #ai4a11y-describe-panel .ai4a11y-describe-close:focus { outline: 3px solid #8ab4f8 !important; outline-offset: 2px !important; }
      #ai4a11y-describe-panel .ai4a11y-describe-close:focus-visible { outline: 3px solid #8ab4f8 !important; outline-offset: 2px !important; }
    `);

    // Screen-reader announcement channel (visually hidden, polite).
    this.live = document.createElement('div');
    this.live.id = 'ai4a11y-describe-live';
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    (document.body || document.documentElement).appendChild(this.live);

    // Alt+D describes the focused (or last-hovered) element — the keyboard path.
    this._keyHandler = (e) => {
      // e.code (physical key), not e.key: on macOS Option+D composes '∂', so
      // e.key === 'd' never matches while Alt is held — the keyboard path (the
      // screen-reader path this adapter exists for) would silently do nothing.
      if (e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        this.describe(this.target());
      }
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this._keyHandler, true);

    // Alt+click describes the clicked element — the mouse path.
    this._clickHandler = (e) => {
      if (e.altKey) { e.preventDefault(); e.stopPropagation(); this.describe(e.target); }
    };
    document.addEventListener('click', this._clickHandler, true);

    // Track the last-hovered element so the keyboard path has a target even
    // when nothing is focused.
    this._moveHandler = (e) => {
      if (this.panel && this.panel.contains(e.target)) return;
      this.lastHover = e.target;
    };
    document.addEventListener('mouseover', this._moveHandler, true);

    announce('Describe on demand ready. Press Alt plus D to describe the focused element, or Alt-click one.');
  },

  target() {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && (!this.panel || !this.panel.contains(a))) return a;
    return this.lastHover;
  },

  async describe(el) {
    if (!this.enabled) return;
    if (!el || el === document.body || el === document.documentElement) {
      this.show('Focus or point at an element first, then press Alt+D.', el);
      return;
    }
    this._lastTarget = el;
    const token = ++this._reqSeq; // a slow answer for an earlier request must
                                  // not overwrite the answer for a newer one.
    this.show('Describing…', el);
    let desc = null, failed = false;
    try {
      if (el.tagName === 'IMG' && (el.currentSrc || el.src)) {
        // Providers require a data URL, not a page URL — convert first (fetch/
        // canvas), exactly like generate-alt. Passing the raw src makes the
        // extension fail, and can make a lax provider describe nothing and
        // invent an answer, presenting a fabricated description as fact.
        const dataUrl = await imageToDataUrl(el);
        desc = dataUrl ? await describeImage(dataUrl) : null;
      } else if (el.tagName === 'CANVAS' && typeof el.toDataURL === 'function') {
        let dataUrl = null;
        try { dataUrl = el.toDataURL(); } catch { dataUrl = null; } // tainted canvas
        desc = dataUrl ? await describeImage(dataUrl) : null; // AI errors propagate
      } else {
        const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 60) desc = await summarizeText(text);
        else desc = label || text || `A ${el.tagName.toLowerCase()} with no readable content.`;
      }
    } catch (e) {
      // The provider's own text is not shown: a host's error message can
      // carry internal detail (an endpoint, a key fragment, a stack), and
      // the panel is read aloud. It goes to the console, where a person
      // fixing the setup can find it; the panel gets a fixed sentence.
      console.warn('[AI4A11y] Describe: no description shown, provider error:', e);
      desc = null; failed = true;
    }
    if (token !== this._reqSeq || !this.enabled) return; // a newer request superseded this one, or disabled
    this.show(desc || (failed ? this.PROVIDER_ERROR_TEXT : 'No description is available for that element.'), el);
  },

  show(text, targetEl) {
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'ai4a11y-describe-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-labelledby', 'ai4a11y-describe-heading');
      const h = document.createElement('h2');
      h.id = 'ai4a11y-describe-heading';
      h.textContent = 'Description';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'ai4a11y-describe-close';
      close.setAttribute('aria-label', 'Close description');
      close.setAttribute('title', 'Close description');
      close.textContent = '✕';
      close.addEventListener('click', () => this.hide());
      const body = document.createElement('p'); body.className = 'ai4a11y-describe-body'; body.style.margin = '0';
      this.panel.append(close, h, body);
      (document.body || document.documentElement).appendChild(this.panel);
    }
    const target = targetEl || this._lastTarget || this.target();
    if (target && typeof target.getBoundingClientRect === 'function') {
      try {
        const r = target.getBoundingClientRect();
        const vh = (typeof window !== 'undefined' && window.innerHeight) || document.documentElement.clientHeight || 800;
        const vw = (typeof window !== 'undefined' && window.innerWidth) || document.documentElement.clientWidth || 1280;
        // Avoid obscuring the target or its focus ring (WCAG 2.4.11).
        // Default placement is bottom-right. If target is in the bottom-right region, flip to top-right.
        if (r.bottom >= vh - 220 && r.top <= vh && r.right >= vw - 380 && r.left <= vw) {
          this.panel.style.bottom = 'auto';
          this.panel.style.top = '16px';
        } else {
          this.panel.style.top = 'auto';
          this.panel.style.bottom = '16px';
        }
      } catch { /* best effort */ }
    }
    this.panel.querySelector('.ai4a11y-describe-body').textContent = text;
    this.panel.style.display = 'block';
    // Announce to screen readers. Empty the region first and fill it a moment
    // later: a screen reader speaks only a change, so asking about the same
    // element twice ("Describing…" then the same answer, in one go) was silent.
    const live = this.live;
    if (live) {
      live.textContent = '';
      clearTimeout(this._liveTimer);
      this._liveTimer = setTimeout(() => { if (this.live === live) live.textContent = text; }, 50);
    }
  },

  hide() {
    this._reqSeq++;
    if (this.panel) {
      const hadFocus = this.panel.contains(document.activeElement);
      this.panel.style.display = 'none';
      if (hadFocus && this._lastTarget && typeof this._lastTarget.focus === 'function') {
        try { this._lastTarget.focus(); } catch { /* best effort */ }
      }
    }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._reqSeq++;
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler, true);
    if (this._moveHandler) document.removeEventListener('mouseover', this._moveHandler, true);
    this._keyHandler = this._clickHandler = this._moveHandler = null;
    clearTimeout(this._liveTimer); this._liveTimer = null;
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    try { document.getElementById('ai4a11y-describe-panel')?.remove(); } catch { /* detached */ }
    this.panel?.remove(); this.panel = null;
    try { document.getElementById('ai4a11y-describe-live')?.remove(); } catch { /* detached */ }
    this.live?.remove(); this.live = null;
    this.lastHover = null;
    this._lastTarget = null;
    announce('Describe on demand off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yDescribeOnDemand = DescribeOnDemand;
