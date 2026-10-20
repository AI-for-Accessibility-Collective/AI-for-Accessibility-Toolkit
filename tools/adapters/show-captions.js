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
//   • Embedded players are reached through their URL. A YouTube or Vimeo embed
//     is a cross-origin iframe: no <video>, no CC button, only the embed's own
//     caption parameter — and reading it means reloading the frame. So that is
//     done for the embed the person is actually using, not for every one on the
//     page.
//
// Reversible: native track modes we changed are restored on disable, and embeds
// are reloaded with the URL they arrived with. Player buttons are left as the
// user last had them (re-clicking could toggle the wrong way if they changed it
// meanwhile).

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

// Embedded players are a different problem again. The player lives in a
// cross-origin iframe, so there is no <video> to reach into and no CC button to
// click — the only thing this document can touch is the embed's own URL, and
// both YouTube and Vimeo take a caption switch as a query parameter.
//
// Changing it means reloading the frame, which costs the person their place in
// what they were watching. That is why this is done for the one embed they are
// actually using rather than every embed on the page: a travel page with four
// documentaries on it would otherwise restart all four.
//
// Spotify is deliberately absent: its embed has no caption or transcript
// parameter, so there is nothing to switch and a reload would cost the person
// their place for nothing.
const EMBEDS = [
  {
    name: 'youtube',
    match: /(^|\.)(youtube\.com|youtube-nocookie\.com)$/,
    on: (u) => u.searchParams.set('cc_load_policy', '1'),
    off: (u) => u.searchParams.set('cc_load_policy', '0'),
  },
  {
    name: 'vimeo',
    match: /(^|\.)player\.vimeo\.com$/,
    on: (u) => u.searchParams.set('texttrack', preferredLang()),
    off: (u) => u.searchParams.delete('texttrack'),
  },
];

// The embed spec for a frame, or null for a frame nothing here can caption.
function embedFor(frame) {
  let host;
  try { host = new URL(frame.src, location.href).hostname; } catch { return null; }
  return EMBEDS.find((e) => e.match.test(host)) || null;
}

const DATA = 'ai4a11yCaptions'; // dataset marker on a handled <video>

export const ShowCaptions = {
  enabled: false,
  _restore: [],        // [{ track, prevMode }] for native tracks we switched on
  _clicked: null,      // Set of "player|url" we've already turned on (once per URL)
  _unregister: null,
  _current: null,      // the embed the person is using, if they have used one
  _embedSrc: new Map(),// frame -> the src it had before captions were switched on

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

  // Which embed the person is using. A click inside a cross-origin frame never
  // reaches this document as an event, but it does move focus, and
  // activeElement then names the frame that took it. That is the only thing
  // this page is ever told about what someone is watching.
  //
  // Read when it is wanted, rather than followed. The obvious signal — a blur
  // on this window — never arrives: this document is itself framed, so it never
  // held the focus it would have to lose, and the click moves focus straight
  // past it into the player. Measured on a page of four embeds: zero blur
  // events, and activeElement already correct.
  //
  // activeElement is per-document, so it keeps naming the player even after the
  // person has gone off to type "turn on captions" somewhere else entirely —
  // which is exactly when this gets asked.
  _currentEmbed() {
    const a = document.activeElement;
    if (a && a.tagName === 'IFRAME' && embedFor(a)) this._current = a;
    return this._current && this._current.isConnected ? this._current : null;
  },

  // Switch captions on for the embed in use, by reloading it with the parameter
  // its player reads. Only that one, and only when the parameter would actually
  // change — a reload the person did not ask for, that changes nothing, is pure
  // loss of their place.
  _enableEmbedCaptions() {
    const frame = this._currentEmbed();
    if (!frame) return;
    const spec = embedFor(frame);
    if (!spec) return;
    let url;
    try { url = new URL(frame.src, location.href); } catch { return; }
    spec.on(url);
    const next = url.toString();
    if (next === frame.src) return;
    if (!this._embedSrc.has(frame)) this._embedSrc.set(frame, frame.src);
    frame.src = next;
    logFix('showCaptions', frame, '(embed off)', 'embed on');
  },

  _sweep() {
    if (!this.enabled) return;
    this._enableNativeTracks();
    this._enablePlayerCaptions();
    this._enableEmbedCaptions();
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
    // Put the embeds back the way they were, which reloads them again — the
    // same cost as switching captions on, and the same reason: the parameter
    // is only read when the player loads.
    for (const [frame, src] of this._embedSrc) {
      try { if (frame.isConnected && frame.src !== src) frame.src = src; } catch { /* gone */ }
    }
    this._embedSrc = new Map();
    this._clicked = null;
    console.log('[AI4A11y] Show Captions disabled');
  },

  toggle() { if (this.enabled) this.disable(); else this.enable(); },
};

export default ShowCaptions;

if (typeof window !== 'undefined') window.__ai4a11yShowCaptions = ShowCaptions;
