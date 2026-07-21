// Stop Auto-Advance — halts content that moves or reloads on its own: meta
// refreshes, auto-rotating carousels, tickers, marquees, and autoplaying
// media (WCAG 2.2.2 Pause/Stop/Hide, 2.2.1 Timing Adjustable). Content that
// advances by itself steals the page out from under screen-reader and
// switch users mid-read, and an auto-refresh throws away their position
// entirely.
//
// Reversible by construction: meta refreshes are removed but their exact
// position is recorded for re-insertion; carousel animations are paused via
// one injected rule; only media WE paused is resumed, and only marquees WE
// stopped are restarted. A MutationObserver catches media that starts
// playing after enable, and is disconnected on disable.
import { announce } from '../../utils/ai.js';

// Class-name fragments that indicate auto-rotating content. Paired with the
// injected rule below, matching elements (and their descendants) get their
// CSS animation paused — layout is untouched, so disable() is just removing
// the stylesheet.
const CAROUSEL_SELECTOR = '[class*="carousel"], [class*="slider"], [class*="rotat"], [class*="ticker"], [class*="marquee"], [aria-roledescription="carousel"]';

export const StopAutoAdvance = {
  styleId: 'ai4a11y-stop-autoadvance-styles',
  enabled: false,
  removedMetas: null,    // Array of { node, parent, nextSibling } for exact restore
  pausedMedia: null,     // Set of media elements we paused (resume exactly these)
  stoppedMarquees: null, // Set of <marquee> elements we stopped
  observer: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.removedMetas = [];
    this.pausedMedia = new Set();
    this.stoppedMarquees = new Set();

    // Remove <meta http-equiv="refresh"> so the page won't reload or
    // redirect out from under the reader. Recorded for exact re-insertion.
    let metas = [];
    try { metas = Array.from(document.querySelectorAll('meta[http-equiv]')); } catch { /* no DOM */ }
    for (const meta of metas) {
      try {
        if ((meta.getAttribute('http-equiv') || '').trim().toLowerCase() !== 'refresh') continue;
        this.removedMetas.push({ node: meta, parent: meta.parentNode, nextSibling: meta.nextSibling });
        meta.remove();
      } catch { /* skip */ }
    }

    // One rule pauses CSS-driven rotation on carousel-like containers and
    // everything inside them.
    const style = document.createElement('style');
    style.id = this.styleId;
    const descendants = CAROUSEL_SELECTOR.split(', ').map((s) => `${s} *`).join(', ');
    style.textContent = `${CAROUSEL_SELECTOR}, ${descendants} { animation-play-state: paused !important; }`;
    (document.head || document.documentElement).appendChild(style);

    const stilled = this.sweep(document);

    // Catch media injected (or set playing) after enable — ad players and
    // lazy-loaded heroes typically start late. Guarded by `enabled` so a
    // disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) this.considerLate(node);
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    const total = this.removedMetas.length + stilled;
    console.log(`[AI4A11y] Stop Auto-Advance enabled (${total} stopped)`);
    announce(total
      ? `Stopped ${total} auto-advancing item${total === 1 ? '' : 's'}; carousels paused`
      : 'Paused carousels; watching for auto-playing media');
  },

  // Still every playing media element and running marquee under root.
  // Returns how many were stopped.
  sweep(root) {
    let n = 0;
    let media = [];
    try { media = root.querySelectorAll('video, audio'); } catch { return 0; }
    for (const el of media) if (this.considerMedia(el)) n++;
    let marquees = [];
    try { marquees = root.querySelectorAll('marquee'); } catch { return n; }
    for (const el of marquees) if (this.considerMarquee(el)) n++;
    return n;
  },

  // Pause one media element if it is currently playing. Returns true if we
  // paused it (and will therefore resume it on disable).
  considerMedia(el) {
    try {
      if (!el || el.paused !== false || this.pausedMedia.has(el)) return false;
      if (typeof el.pause === 'function') el.pause();
      this.pausedMedia.add(el);
      return true;
    } catch { return false; }
  },

  considerMarquee(el) {
    try {
      if (!el || this.stoppedMarquees.has(el)) return false;
      if (typeof el.stop === 'function') el.stop(); // jsdom/old engines may lack it
      this.stoppedMarquees.add(el);
      return true;
    } catch { return false; }
  },

  // A node added after enable: still it if it is itself media/marquee,
  // otherwise sweep whatever it contains.
  considerLate(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'video' || tag === 'audio') { this.considerMedia(el); return; }
    if (tag === 'marquee') { this.considerMarquee(el); return; }
    if (el.querySelectorAll) this.sweep(el);
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    try { document.getElementById(this.styleId)?.remove(); } catch { /* no DOM */ }

    // Put each meta refresh back exactly where it was.
    if (this.removedMetas) {
      for (const { node, parent, nextSibling } of this.removedMetas) {
        if (!parent) continue;
        try { parent.insertBefore(node, nextSibling); }
        catch { try { parent.appendChild(node); } catch { /* parent gone */ } }
      }
      this.removedMetas = null;
    }

    // Resume only the media we paused; the user's own pauses stay paused.
    if (this.pausedMedia) {
      for (const el of this.pausedMedia) {
        try {
          if (typeof el.play === 'function') el.play()?.catch?.(() => {});
        } catch { /* autoplay policy may refuse */ }
      }
      this.pausedMedia.clear();
      this.pausedMedia = null;
    }

    if (this.stoppedMarquees) {
      for (const el of this.stoppedMarquees) {
        try { if (typeof el.start === 'function') el.start(); } catch { /* skip */ }
      }
      this.stoppedMarquees.clear();
      this.stoppedMarquees = null;
    }

    console.log('[AI4A11y] Stop Auto-Advance disabled');
    announce('Auto-advancing content resumed');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yStopAutoAdvance = StopAutoAdvance;
