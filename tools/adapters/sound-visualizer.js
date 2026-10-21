// Sound Visualizer — flashes an on-screen indicator whenever the page starts
// emitting sound, so Deaf and hard-of-hearing users don't miss non-speech
// audio cues: notification beeps, alert chimes, an autoplaying video in a
// background tab's corner. The indicator is also a live region, so users who
// pair a screen reader with residual hearing get the cue both ways.
//
// Detection is event-based, not audio-analysis: capture-phase 'play',
// 'volumechange', 'pause' and 'ended' listeners on document catch every
// <video>/<audio> on the page (media events don't bubble, but capture reaches
// them). Reversible by construction: disable() removes the listeners, clears
// the hide timer, and removes the injected indicator.
//
// The sign stays up for as long as sound is actually playing, not just for
// the first moment: a looping product video that unmutes at the first click
// fires 'play' once (or only 'volumechange') and then plays sound for minutes,
// and a sign that vanished after a second told a Deaf shopper nothing about
// that. It sits in the bottom-right corner and lets clicks through, so it
// never hides the header's cart or search.
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

// Media that is making sound right now.
function isSounding(el) {
  return isAudible(el) && el.paused === false && el.ended !== true;
}

export const SoundVisualizer = {
  enabled: false,
  indicator: null,
  playHandler: null,
  volumeHandler: null,
  stopHandler: null,
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
      'position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;' +
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
    // Paused, ended or muted: take the sign down once nothing is sounding.
    this.stopHandler = () => {
      if (!this.enabled || this.hideTimer) return; // a fresh cue is still showing
      if (!this._anySounding()) this._hide();
    };
    document.addEventListener('play', this.playHandler, true);
    document.addEventListener('volumechange', this.volumeHandler, true);
    document.addEventListener('pause', this.stopHandler, true);
    document.addEventListener('ended', this.stopHandler, true);
    document.addEventListener('volumechange', this.stopHandler, true);
    // Sound that was already playing before this was switched on.
    if (this._anySounding()) this.flash();

    console.log('[AI4A11y] Sound Visualizer enabled');
    announce('Sound indicator on. A sign shows on screen while the page plays sound');
  },

  // Show the indicator, restarting the auto-hide window on every new cue.
  // After the flash window it stays up while any media is still sounding.
  flash() {
    if (!this.indicator) return;
    // Newly shown: write the words again so the live region reads them once
    // per new sound, not on every cue while it is already up. The speaker
    // emoji is decoration: a screen reader would say "speaker high volume".
    if (this.indicator.style.display === 'none' || !this.indicator.textContent) {
      this.indicator.style.display = 'block';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '🔊 ';
      this.indicator.replaceChildren(icon, 'Sound playing');
    }
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this._anySounding()) this._hide();
    }, this.flashMs);
  },

  _hide() {
    if (this.indicator) this.indicator.style.display = 'none';
  },

  _anySounding() {
    return [...document.querySelectorAll('video, audio')].some(isSounding);
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      if (this.playHandler) document.removeEventListener('play', this.playHandler, true);
      if (this.volumeHandler) document.removeEventListener('volumechange', this.volumeHandler, true);
      if (this.stopHandler) {
        document.removeEventListener('pause', this.stopHandler, true);
        document.removeEventListener('ended', this.stopHandler, true);
        document.removeEventListener('volumechange', this.stopHandler, true);
      }
    } catch { /* document may be gone */ }
    this.playHandler = this.volumeHandler = this.stopHandler = null;
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
