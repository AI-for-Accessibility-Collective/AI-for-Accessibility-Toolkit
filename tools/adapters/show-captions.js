// show-captions.js — turn ON the captions media ALREADY has. No AI, no network,
// no latency. This is the common case the catalog was missing: a YouTube (or
// any) video almost always ships a caption track that just needs switching on —
// `video.textTracks[i].mode = 'showing'`, or a click on the player's CC button.
// (Its expensive sibling, generate-captions, TRANSCRIBES media that has none.)
//
// Two behaviours that matter for a Deaf/HoH audience (see the shared sweep in
// utils/observe.js):
//   • Re-apply on new media. SPA nav and autoplay playlists swap the <video>
//     without a page load; a one-shot pass would caption only the first video.
//   • Don't fight the person. Each <video> is handled exactly once, and a
//     player's CC button is toggled at most once per URL — so if they turn
//     captions back off, a later mutation never re-enables them.
//
// Reversible: native track modes we changed are restored on disable. Player
// buttons are left as the user last had them (re-clicking could toggle the
// wrong way if they changed it meanwhile).

import { registerSweep } from '../utils/observe.js';

const logFix = globalThis.ai4a11yLogFix || (() => {});

function preferredLang() {
  const l = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return String(l).slice(0, 2).toLowerCase();
}

// Players that own their caption UI and don't expose a usable textTracks entry.
// A small table rather than a YouTube special case — Vimeo and the big news
// players each have their own CC control. `button` returns the toggle element (or
// null); `isOn` reads its pressed state.
const PLAYERS = [
  {
    name: 'youtube',
    button: () => document.querySelector('.ytp-subtitles-button'),
    isOn: (btn) => btn.getAttribute('aria-pressed') === 'true',
  },
  {
    name: 'vimeo',
    button: () => document.querySelector('.vp-captions-button, button[aria-label*="aptions" i]'),
    isOn: (btn) => btn.getAttribute('aria-pressed') === 'true',
  },
];

const DATA = 'ai4a11yCaptions'; // dataset marker on a handled <video>

export const ShowCaptions = {
  enabled: false,
  _restore: [],        // [{ track, prevMode }] for native tracks we switched on
  _clicked: null,      // Set of "player|url" we've already turned on (once per URL)
  _unregister: null,

  // Enable the best caption/subtitle track on each <video> that has one, once.
  _enableNativeTracks() {
    const lang = preferredLang();
    for (const v of document.querySelectorAll('video')) {
      if (v.dataset[DATA]) continue; // handled once — never fight a later user toggle
      const list = v.textTracks ? [...v.textTracks] : [];
      const tracks = list.filter((t) => t && (t.kind === 'captions' || t.kind === 'subtitles'));
      if (!tracks.length) continue;
      const want = tracks.find((t) => (t.language || '').toLowerCase().startsWith(lang)) || tracks[0];
      this._restore.push({ track: want, prevMode: want.mode });
      try { want.mode = 'showing'; } catch { /* some players make mode read-only */ }
      v.dataset[DATA] = 'on';
      logFix('showCaptions', v, '(off)', 'showing');
    }
  },

  // Turn on captions for players that own their CC UI — at most once per URL, so
  // the user turning them back off isn't overridden by the next mutation.
  _enablePlayerCaptions() {
    const url = typeof location !== 'undefined' ? location.href : '';
    for (const p of PLAYERS) {
      let btn;
      try { btn = p.button(); } catch { btn = null; }
      if (!btn) continue;
      const key = p.name + '|' + url;
      if (this._clicked.has(key)) continue;   // already acted for this video/URL
      this._clicked.add(key);
      if (!p.isOn(btn)) { try { btn.click(); } catch {} logFix('showCaptions', btn, '(off)', 'on'); }
    }
  },

  _sweep() {
    if (!this.enabled) return;
    this._enableNativeTracks();
    this._enablePlayerCaptions();
  },

  enable() {
    if (this.enabled) { this._sweep(); return; } // idempotent
    this.enabled = true;
    this._restore = [];
    this._clicked = new Set();
    this._sweep();
    this._unregister = registerSweep('show-captions', () => this._sweep(), { debounceMs: 400 });
    console.log('[AI4A11y] Show Captions enabled');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._unregister) { this._unregister(); this._unregister = null; }
    for (const { track, prevMode } of this._restore) { try { track.mode = prevMode; } catch {} }
    this._restore = [];
    for (const v of document.querySelectorAll('video[data-ai4a11y-captions]')) delete v.dataset[DATA];
    this._clicked = null;
    console.log('[AI4A11y] Show Captions disabled');
  },

  toggle() { if (this.enabled) this.disable(); else this.enable(); },
};

export default ShowCaptions;

if (typeof window !== 'undefined') window.__ai4a11yShowCaptions = ShowCaptions;
