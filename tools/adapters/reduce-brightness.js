// Reduce Brightness — dims and desaturates the whole page for people with
// photosensitivity, migraine, or sensory-overload needs. Distinct from dark
// mode: nothing is inverted or re-themed — the page keeps its layout and
// colors, just turned down to a lower-stimulation level.
//
// The default is a clean brightness/saturation reduction via a single CSS
// filter — the page stays crisp and readable, just calmer. An extra flat
// overlay is available (options.dim) for the rare context where CSS filters
// don't apply (e.g. some fullscreen plugins), but it is OFF by default because
// a black veil over everything reads as muddy rather than a real adaptation.
// Reversible by construction: disable() removes the class, style, and overlay
// and restores the page exactly.
import { announce } from '../utils/ai.js';

export const ReduceBrightness = {
  styleId: 'ai4a11y-reduce-brightness-styles',
  htmlClass: 'ai4a11y-dimmed',
  overlayId: 'ai4a11y-dim-overlay',
  enabled: false,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const bright = options.brightness ?? 0.82; // 1 = unchanged, lower = dimmer
    const sat = options.saturation ?? 0.9;      // 1 = unchanged, lower = muted
    const dimLevel = options.dim ?? 0;          // extra flat overlay, off by default

    try { document.documentElement.classList.add(this.htmlClass); } catch { /* detached */ }

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
html.${this.htmlClass} { filter: brightness(${bright}) saturate(${sat}) !important; }`;
    (document.head || document.documentElement).appendChild(style);

    // Optional extra overlay — off by default. Only for contexts where the CSS
    // filter can't reach (e.g. some fullscreen plugins). It never intercepts
    // input. Left off, the filter alone does the dimming, which looks clean.
    if (dimLevel > 0) {
      const overlay = document.createElement('div');
      overlay.id = this.overlayId;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = `rgba(0, 0, 0, ${dimLevel})`;
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2147483646';
      (document.body || document.documentElement).appendChild(overlay);
    }

    console.log('[AI4A11y] Reduce Brightness enabled');
    announce('Screen dimmed');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try { document.documentElement?.classList.remove(this.htmlClass); } catch { /* detached */ }
    try { document.getElementById(this.styleId)?.remove(); } catch { /* detached */ }
    try { document.getElementById(this.overlayId)?.remove(); } catch { /* detached */ }
    console.log('[AI4A11y] Reduce Brightness disabled');
    announce('Screen brightness restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yReduceBrightness = ReduceBrightness;
