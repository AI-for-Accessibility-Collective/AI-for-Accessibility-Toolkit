// Mute Sounds — silences all audio/video on the page and blocks autoplay
// sound. From the co-design study: sensory-overload, anxiety, and cognitive
// users described unexpected page sound (autoplaying video, ambient audio) as
// disorienting enough to make them leave a page; a quiet page is a usable page.
//
// Reversible by construction: we only mute elements that were NOT already
// muted, and track exactly those in a Set, so disable() unmutes precisely what
// we touched — media the user muted themselves is never un-muted for them. A
// MutationObserver mutes media injected after enable, and a capture-phase
// 'play' listener re-mutes anything that tries to start with sound; both are
// torn down on disable.
import { announce } from '../../utils/ai.js';

export const MuteSounds = {
  enabled: false,
  muted: null,           // Set of elements we muted (for exact restore)
  observer: null,
  playHandler: null,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.muted = new Set();

    const count = this.sweep(document);

    // Mute media added after enable (players are often injected late). Guarded
    // by `enabled` so a disable() mid-callback is a no-op.
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((mutations) => {
        if (!this.enabled) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) this.consider(node);
          }
        }
      });
      this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    // Re-mute anything that tries to start with sound (scripts un-muting a
    // player, autoplay kicking in). Capture phase: 'play' does not bubble.
    this.playHandler = (e) => {
      if (!this.enabled) return;
      const el = e.target;
      if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) this.muteEl(el);
    };
    document.addEventListener('play', this.playHandler, true);

    console.log(`[AI4A11y] Mute Sounds enabled (${count} muted)`);
    announce(count ? `Muted ${count} sound source${count === 1 ? '' : 's'}` : 'Watching for sounds to mute');
  },

  // Scan a root for media and mute it; returns how many were muted.
  sweep(root) {
    let n = 0;
    let media;
    try {
      media = root.querySelectorAll('video, audio');
    } catch { return 0; }
    for (const el of media) if (this.muteEl(el)) n++;
    return n;
  },

  // An added node may itself be media, or contain media (embedded players).
  consider(node) {
    if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') this.muteEl(node);
    if (node.querySelectorAll) this.sweep(node);
  },

  // Mute one element if it is playing sound the user didn't silence. Only
  // elements WE mute are tracked, so disable() never un-mutes a user's choice.
  // No early-return for already-tracked elements: a script may have un-muted
  // one, and the play listener routes it back here to be re-muted.
  muteEl(el) {
    if (!el) return false;
    try {
      if (el.muted === false) {
        el.muted = true;
        this.muted.add(el);
        return true;
      }
    } catch { /* detached or exotic media element */ }
    return false;
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.playHandler) {
      document.removeEventListener('play', this.playHandler, true);
      this.playHandler = null;
    }
    if (this.muted) {
      for (const el of this.muted) {
        try { el.muted = false; } catch { /* element since removed */ }
      }
      this.muted.clear();
      this.muted = null;
    }
    console.log('[AI4A11y] Mute Sounds disabled');
    announce('Sounds unmuted');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11yMuteSounds = MuteSounds;
