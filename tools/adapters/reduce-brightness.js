// Reduce Brightness — dims and desaturates the whole page for people with
// photosensitivity, migraine, or sensory-overload needs. Distinct from dark
// mode: nothing is inverted or re-themed — the page keeps its layout and
// colors, just turned down to a lower-stimulation level.
//
// Reversible by construction: one root class + one injected <style> scoped
// under that class, plus a pointer-events:none overlay div for extra dimming
// that also covers contexts where CSS filters don't apply. disable() removes
// all three and restores the page exactly.
import { announce } from '../utils/ai.js';

export const ReduceBrightness = {
  styleId: 'ai4a11y-reduce-brightness-styles',
  htmlClass: 'ai4a11y-dimmed',
  overlayId: 'ai4a11y-dim-overlay',
  enabled: false,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    const bright = options.brightness ?? 0.8; // 1 = unchanged, lower = dimmer
    const sat = options.saturation ?? 0.85;   // 1 = unchanged, lower = muted
    const dimLevel = options.dim ?? 0.15;     // overlay opacity, 0 = none

    try { document.documentElement.classList.add(this.htmlClass); } catch { /* detached */ }

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
html.${this.htmlClass} { filter: brightness(${bright}) saturate(${sat}) !important; }`;
    (document.head || document.documentElement).appendChild(style);

    // Overlay sits above everything but never intercepts input; it deepens the
    // dim and still works where the filter doesn't (e.g. fullscreen plugins).
    const overlay = document.createElement('div');
    overlay.id = this.overlayId;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = `rgba(0, 0, 0, ${dimLevel})`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483646';
    (document.body || document.documentElement).appendChild(overlay);

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
