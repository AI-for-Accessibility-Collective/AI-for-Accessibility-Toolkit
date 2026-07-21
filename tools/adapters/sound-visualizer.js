// Sound Visualizer — flashes an on-screen indicator whenever the page starts
// emitting sound, so Deaf and hard-of-hearing users don't miss non-speech
// audio cues: notification beeps, alert chimes, an autoplaying video in a
// background tab's corner. The indicator is also a live region, so users who
// pair a screen reader with residual hearing get the cue both ways.
//
// Detection is event-based, not audio-analysis: capture-phase 'play' and
// 'volumechange' listeners on document catch every <video>/<audio> on the
// page (media events don't bubble, but capture reaches them). Reversible by
// construction: disable() removes both listeners, clears the hide timer, and
// removes the injected indicator.
import { announce } from '../utils/ai.js';

const INDICATOR_ID = 'ai4a11y-sound-indicator';
const FLASH_MS = 1200;

// Only flash for media that would actually be heard.
function isAudible(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag !== 'VIDEO' && tag !== 'AUDIO') return false;
  return el.muted !== true && el.volume > 0;
}

export const SoundVisualizer = {
  enabled: false,
  indicator: null,
  playHandler: null,
  volumeHandler: null,
  hideTimer: null,
  flashMs: FLASH_MS,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this.flashMs = Number(options.duration) > 0 ? Number(options.duration) : FLASH_MS;

    const indicator = document.createElement('div');
    indicator.id = INDICATOR_ID;
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.style.cssText =
      'position: fixed; top: 16px; right: 16px; z-index: 2147483647;' +
      'padding: 10px 16px; border-radius: 8px;' +
      'background: rgba(0, 0, 0, 0.85); color: #fff;' +
      'font: 600 15px/1.2 system-ui, sans-serif;' +
      'pointer-events: none; display: none;';
    (document.body || document.documentElement).appendChild(indicator);
    this.indicator = indicator;

    this.playHandler = (e) => {
      if (!this.enabled) return;
      if (isAudible(e.target)) this.flash();
    };
    // Unmuting (or turning volume up from 0) while playing means sound just
    // became audible — flash for that too. Paused media stays silent.
    this.volumeHandler = (e) => {
      if (!this.enabled) return;
      if (isAudible(e.target) && e.target.paused === false) this.flash();
    };
    document.addEventListener('play', this.playHandler, true);
    document.addEventListener('volumechange', this.volumeHandler, true);

    console.log('[AI4A11y] Sound Visualizer enabled');
    announce('Sound indicator on — a visual cue will flash when the page plays sound');
  },

  // Show the indicator, restarting the auto-hide window on every new cue.
  flash() {
    if (!this.indicator) return;
    this.indicator.textContent = '🔊 Sound playing';
    this.indicator.style.display = 'block';
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.indicator) this.indicator.style.display = 'none';
    }, this.flashMs);
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      if (this.playHandler) document.removeEventListener('play', this.playHandler, true);
      if (this.volumeHandler) document.removeEventListener('volumechange', this.volumeHandler, true);
    } catch { /* document may be gone */ }
    this.playHandler = this.volumeHandler = null;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    this.indicator?.remove();
    this.indicator = null;
    console.log('[AI4A11y] Sound Visualizer disabled');
    announce('Sound indicator off');
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};

if (typeof window !== 'undefined') window.__ai4a11ySoundVisualizer = SoundVisualizer;
