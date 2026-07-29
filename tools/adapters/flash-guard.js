// Flash Guard — seizure safety for photosensitive users (WCAG 2.3.1).
// Flashing above three times a second can trigger seizures, and the user
// can't know in advance which page will do it. So instead of detecting
// flashes after the fact, this adapter removes the two main sources of
// unexpected flashing before they fire: (1) it pauses and de-autoplays all
// video, and (2) it dims video/canvas/animated-GIF surfaces so any flashing
// that still occurs (e.g. a canvas the page keeps drawing) is lower-intensity.
//
// Reversible by construction: every video's autoplay/playing state is
// recorded before we touch it, so disable() restores the page exactly. A
// MutationObserver catches videos injected after enable (lazy-loaded players
// are the common case), and is disconnected on disable.
import { announce } from '../utils/ai.js';

export const FlashGuard = {
  styleId: 'ai4a11y-flash-guard-styles',
  enabled: false,
  tracked: null,   // Set of { video, hadAutoplay, wasPlaying } for exact restore
  observer: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.tracked = new Set();

    document.querySelectorAll('video').forEach(video => this.guardVideo(video));

    // Dim the surfaces flashes come from. Media stays visible and legible —
    // the point is to pull peak luminance and contrast below harmful levels,
    // not to hide content.
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      video, canvas, img[src*=".gif"], img[src$=".gif"], [class*="gif"] {
        filter: brightness(0.8) contrast(0.85) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    // Videos injected after enable must not slip through and autoplay.
    // Guarded by `enabled` so a disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'VIDEO') this.guardVideo(node);
            if (node.querySelectorAll) {
              node.querySelectorAll('video').forEach(v => this.guardVideo(v));
            }
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    console.log('[AI4A11y] Flash Guard enabled');
    announce('Flash protection on: videos paused and media dimmed');
  },

  // Pause one video and strip its autoplay, recording prior state for restore.
  guardVideo(video) {
    if (!video || !this.tracked) return;
    for (const t of this.tracked) if (t.video === video) return;
    try {
      this.tracked.add({
        video,
        hadAutoplay: video.hasAttribute('autoplay'),
        wasPlaying: !video.paused
      });
      video.pause();
      video.removeAttribute('autoplay');
      video.autoplay = false;
    } catch (e) { /* media element may be detached or mid-load */ }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    document.getElementById(this.styleId)?.remove();

    if (this.tracked) {
      for (const { video, hadAutoplay, wasPlaying } of this.tracked) {
        try {
          if (hadAutoplay) {
            video.setAttribute('autoplay', '');
            video.autoplay = true;
          }
          // play() may reject (autoplay policy, detached element) — that's fine.
          if (wasPlaying) {
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
          }
        } catch (e) { /* restoring is best-effort */ }
      }
      this.tracked.clear();
      this.tracked = null;
    }

    console.log('[AI4A11y] Flash Guard disabled');
    announce('Flash protection off: media restored');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yFlashGuard = FlashGuard;
