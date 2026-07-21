// Describe on Demand — the BLV keystone. Lets a blind or low-vision user point
// at ANY element and get an AI description on request, instead of relying on
// whatever alt text a page happened to include. This is the "what's this?"
// primitive from the co-design study (Made, Daniel): press Alt+D to describe
// the focused element (keyboard / screen-reader path), or Alt+click one (mouse
// path). Images are sent to vision; charts on <canvas> are captured to an
// image; everything else is summarized from its text + labels.
//
// Reuses the already-wired describeImage / summarizeText providers, so it needs
// no new AI plumbing. Reversible: all listeners, the panel, the live region,
// and the injected style are removed on disable.
import { describeImage, summarizeText, announce } from '../utils/ai.js';
import { imageToDataUrl } from '../utils/image.js';
import { injectStyle } from './_primitives.js';

export const DescribeOnDemand = {
  styleId: 'ai4a11y-describe-styles',
  enabled: false,
  panel: null,
  live: null,
  lastHover: null,
  _reqSeq: 0,
  _keyHandler: null,
  _clickHandler: null,
  _moveHandler: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;

    injectStyle(this.styleId, `
      #ai4a11y-describe-panel {
        position: fixed; bottom: 16px; right: 16px; max-width: 360px; z-index: 2147483647;
        background: #10141a; color: #f2f5f9; border: 2px solid #1a73e8; border-radius: 10px;
        padding: 12px 14px; font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
      }
      #ai4a11y-describe-panel h2 { font-size: 13px; margin: 0 0 6px; color: #8ab4f8; text-transform: uppercase; letter-spacing: .04em; }
      #ai4a11y-describe-panel .ai4a11y-describe-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #f2f5f9; font-size: 18px; cursor: pointer; }
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
      if (e.altKey && e.code === 'KeyD') { e.preventDefault(); this.describe(this.target()); }
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
    this._moveHandler = (e) => { this.lastHover = e.target; };
    document.addEventListener('mouseover', this._moveHandler, true);

    announce('Describe on demand ready. Press Alt plus D to describe the focused element, or Alt-click one.');
  },

  target() {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) return a;
    return this.lastHover;
  },

  async describe(el) {
    if (!el || el === document.body || el === document.documentElement) {
      this.show('Focus or point at an element first, then press Alt+D.');
      return;
    }
    const token = ++this._reqSeq; // a slow answer for an earlier request must
                                  // not overwrite the answer for a newer one.
    this.show('Describing…');
    let desc = null;
    try {
      if (el.tagName === 'IMG' && (el.currentSrc || el.src)) {
        // Providers require a data URL, not a page URL — convert first (fetch/
        // canvas), exactly like generate-alt. Passing the raw src makes the
        // extension fail, and can make a lax provider describe nothing and
        // invent an answer, presenting a fabricated description as fact.
        const dataUrl = await imageToDataUrl(el);
        desc = dataUrl ? await describeImage(dataUrl) : null;
      } else if (el.tagName === 'CANVAS' && typeof el.toDataURL === 'function') {
        try { desc = await describeImage(el.toDataURL()); } catch { desc = null; }
      } else {
        const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 60) desc = await summarizeText(text);
        else desc = label || text || `A ${el.tagName.toLowerCase()} with no readable content.`;
      }
    } catch { desc = null; }
    if (token !== this._reqSeq) return; // a newer request superseded this one
    this.show(desc || 'Couldn’t get a description. If this keeps happening, check that your AI key is set in the extension settings.');
  },

  show(text) {
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'ai4a11y-describe-panel';
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-label', 'Element description');
      const h = document.createElement('h2'); h.textContent = 'Description';
      const close = document.createElement('button');
      close.className = 'ai4a11y-describe-close'; close.setAttribute('aria-label', 'Close description'); close.textContent = '✕';
      close.addEventListener('click', () => this.hide());
      const body = document.createElement('p'); body.className = 'ai4a11y-describe-body'; body.style.margin = '0';
      this.panel.append(close, h, body);
      (document.body || document.documentElement).appendChild(this.panel);
    }
    this.panel.querySelector('.ai4a11y-describe-body').textContent = text;
    this.panel.style.display = 'block';
    if (this.live) this.live.textContent = text; // announce to screen readers
  },

  hide() {
    if (this.panel) this.panel.style.display = 'none';
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
    if (this._clickHandler) document.removeEventListener('click', this._clickHandler, true);
    if (this._moveHandler) document.removeEventListener('mouseover', this._moveHandler, true);
    this._keyHandler = this._clickHandler = this._moveHandler = null;
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    this.panel?.remove(); this.panel = null;
    this.live?.remove(); this.live = null;
    this.lastHover = null;
    announce('Describe on demand off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yDescribeOnDemand = DescribeOnDemand;
