// Auto Transcriber - a caption control on every video
//
// Adds a "CC" button to each video. Pressing it turns on the captions the
// video already has (its caption/subtitle tracks); for a video with none it
// asks the AI provider for a transcript (transcribeVideo, or the YouTube
// transcript), and when nothing can produce one it says so plainly instead of
// a dead end. The button is a real toggle (aria-pressed, a name a screen
// reader says, a visible focus ring) and every result is announced.
//
// The button sits in the video's top-right corner. It stays below the page's
// own sticky header (a small z-index, not 10000), and is big enough to hit
// (44 by 32 px, opaque — the first version was a 27 by 16 px label at 60%
// opacity).
import { getYouTubeTranscript, transcribeVideo as transcribeWithAI, announce } from '../utils/ai.js';

const MESSAGE_MS = 4000; // how long "No captions are available" stays on the video

function captionTracks(video) {
  const list = video.textTracks ? [...video.textTracks] : [];
  return list.filter((t) => t && (t.kind === 'captions' || t.kind === 'subtitles'));
}

export const AutoTranscriber = {
  enabled: false,
  observer: null,
  videoStates: new Map(),
  styleId: 'ai4a11y-caption-helper-styles',
  _enableTimer: null,
  _pagehideHandler: null,

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.injectStyles();
    this.setupVideoObserver();
    this.enableCaptionsOnAllVideos();
    // The deferred sweep must not fire after a quick disable() (it would attach
    // CC UI to a tool that is now off), so keep its handle and gate on enabled.
    // It also catches a video that had no size yet on the first pass.
    this._enableTimer = setTimeout(() => {
      this._enableTimer = null;
      if (this.enabled) this.enableCaptionsOnAllVideos();
    }, 1000);
    console.log('[AI4A11y] Auto Transcriber enabled');
    const n = this.videoStates.size;
    announce(n ? `Caption button added to ${n === 1 ? 'the video' : n + ' videos'}` : 'Caption buttons on');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._enableTimer) { clearTimeout(this._enableTimer); this._enableTimer = null; }
    if (this._pagehideHandler) { window.removeEventListener('pagehide', this._pagehideHandler); this._pagehideHandler = null; }
    this.observer?.disconnect();
    this.observer = null;
    for (const video of [...this.videoStates.keys()]) this.cleanupVideo(video);
    document.querySelectorAll('.ai4a11y-audio-btn, .ai4a11y-caption-box').forEach(el => el.remove());
    document.getElementById(this.styleId)?.remove();
    // Clear the per-video setup flag, else a re-enable() finds every existing
    // video already flagged and silently skips setting up captions on it.
    document.querySelectorAll('video[data-ai4a11y-setup]').forEach(v => { delete v.dataset.ai4a11ySetup; });
    this.videoStates.clear();
    console.log('[AI4A11y] Auto Transcriber disabled');
    announce('Caption buttons removed');
  },

  injectStyles() {
    if (document.getElementById(this.styleId)) return;
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      .ai4a11y-audio-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 2;
        min-width: 44px;
        min-height: 32px;
        margin: 0;
        padding: 4px 10px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        border: 2px solid rgba(255, 255, 255, 0.9);
        border-radius: 6px;
        font: 700 14px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      .ai4a11y-audio-btn:hover { background: #000; }
      .ai4a11y-audio-btn[aria-pressed="true"] { background: #fff; color: #000; border-color: #000; }
      .ai4a11y-audio-btn:focus-visible { outline: 3px solid #fff !important; outline-offset: 2px; box-shadow: 0 0 0 6px #1a73e8 !important; }
      .ai4a11y-caption-box {
        position: absolute;
        bottom: 48px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 80%;
        max-height: 45%;
        overflow: hidden;
        padding: 5px 12px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        font: 16px/1.4 system-ui, sans-serif;
        border-radius: 4px;
        text-align: center;
        z-index: 2;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  },

  setupVideoObserver() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Handle added nodes
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO') this.setupVideo(node);
            if (node.tagName === 'IFRAME' && node.src?.includes('youtube')) {
              this.enableYouTubeCaptions(node);
            }
            node.querySelectorAll?.('video')?.forEach(v => this.setupVideo(v));
          }
        }
        // Clean up removed videos to prevent memory leaks
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO') this.cleanupVideo(node);
            node.querySelectorAll?.('video')?.forEach(v => this.cleanupVideo(v));
          }
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });

    // Cleanup on page unload to prevent memory leaks in SPAs. Keep the handler
    // reference so disable() can remove it (an anonymous one would accumulate
    // one leaked listener per enable/disable cycle in a long-lived SPA).
    this._pagehideHandler = () => this.disable();
    window.addEventListener('pagehide', this._pagehideHandler, { once: true });
  },

  // Puts the page back for one video: its button and caption box go, its
  // wrapper gets its old position, and track modes we changed are restored.
  cleanupVideo(video) {
    const state = this.videoStates.get(video);
    if (!state) return;
    state.btn?.remove();
    state.captionBox?.remove();
    clearTimeout(state.messageTimer);
    if (state.wrapper && state.prevPosition !== null) state.wrapper.style.position = state.prevPosition;
    for (const { track, prevMode } of state.trackModes) { try { track.mode = prevMode; } catch { /* read-only */ } }
    this.videoStates.delete(video);
    delete video.dataset.ai4a11ySetup;
  },

  enableCaptionsOnAllVideos() {
    document.querySelectorAll('video').forEach(v => this.setupVideo(v));
    document.querySelectorAll('iframe[src*="youtube"]').forEach(f => this.enableYouTubeCaptions(f));
    if (location.hostname.includes('youtube.com')) this.enableYouTubePageCaptions();
  },

  setupVideo(video) {
    if (this.videoStates.has(video)) return;
    // Too small to carry a button (or not laid out yet): not flagged, so the
    // deferred pass or a later mutation can still set it up.
    const rect = video.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 75) return;
    const wrapper = video.parentElement;
    if (!wrapper) return;
    video.dataset.ai4a11ySetup = 'true';

    let prevPosition = null;
    if (getComputedStyle(wrapper).position === 'static') {
      prevPosition = wrapper.style.position;
      wrapper.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai4a11y-audio-btn';
    btn.textContent = 'CC';
    btn.setAttribute('aria-label', 'Captions');
    const showing = captionTracks(video).some((t) => t.mode === 'showing');
    btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
    btn.title = showing ? 'Hide captions' : 'Show captions';
    btn.onclick = () => this.toggleTranscription(video, btn);
    wrapper.appendChild(btn);

    const captionBox = document.createElement('div');
    captionBox.className = 'ai4a11y-caption-box';
    captionBox.style.display = 'none';
    wrapper.appendChild(captionBox);

    this.videoStates.set(video, { btn, captionBox, wrapper, prevPosition, trackModes: [], isTranscribing: showing, messageTimer: null });
  },

  _setPressed(state, on) {
    state.isTranscribing = on;
    state.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    state.btn.title = on ? 'Hide captions' : 'Show captions';
  },

  async toggleTranscription(video, btn) {
    const state = this.videoStates.get(video);
    if (!state) return;
    clearTimeout(state.messageTimer);

    const tracks = captionTracks(video);
    // Captions the page already shows (a default track) count as on, so the
    // first press turns them off rather than "on" again.
    if (state.isTranscribing || tracks.some((t) => t.mode === 'showing')) {
      this._setPressed(state, false);
      state.captionBox.style.display = 'none';
      for (const t of tracks) {
        if (t.mode !== 'showing') continue;
        if (!state.trackModes.some((m) => m.track === t)) state.trackModes.push({ track: t, prevMode: t.mode });
        try { t.mode = 'hidden'; } catch { /* read-only */ }
      }
      announce('Captions off');
      return;
    }

    this._setPressed(state, true);
    // The video's own captions, when it has them: switch the best one on.
    if (tracks.length) {
      const lang = String((typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2).toLowerCase();
      const want = tracks.find((t) => (t.language || '').toLowerCase().startsWith(lang)) || tracks[0];
      if (!state.trackModes.some((m) => m.track === want)) state.trackModes.push({ track: want, prevMode: want.mode });
      try { want.mode = 'showing'; } catch { /* read-only */ }
      announce('Captions on');
      return;
    }
    state.captionBox.style.display = 'block';
    state.captionBox.textContent = 'Getting captions…';
    await this.transcribeVideo(video, state);
  },

  async transcribeVideo(video, state) {
    let text = null;
    try {
      // For YouTube, try to get existing transcript
      const ytMatch = video.closest('[data-video-id]')?.dataset.videoId ||
        (location.hostname.includes('youtube.com') && window.location.href.match(/[?&]v=([^&]+)/)?.[1]);
      if (ytMatch) text = await getYouTubeTranscript(ytMatch);
      if (!text) {
        const src = video.currentSrc || video.src;
        const result = src ? await transcribeWithAI(src) : null;
        text = result && result.text ? result.text : null;
      }
    } catch (e) {
      console.warn('[AI4A11y] Transcription error:', e);
    }
    if (!this.enabled || !state.isTranscribing || this.videoStates.get(video) !== state) return; // switched off meanwhile
    if (text) {
      state.captionBox.textContent = text;
      announce('Transcript shown on the video');
      return;
    }
    // Nothing can caption this video: say so, then put the button back.
    const msg = 'No captions are available for this video';
    state.captionBox.textContent = msg;
    announce(msg);
    this._setPressed(state, false);
    state.messageTimer = setTimeout(() => {
      if (!state.isTranscribing) state.captionBox.style.display = 'none';
    }, MESSAGE_MS);
  },

  enableYouTubeCaptions(iframe) {
    if (iframe.dataset.ai4a11yCaptionsEnabled) return;
    iframe.dataset.ai4a11yCaptionsEnabled = 'true';

    const src = iframe.src;
    if (!src.includes('cc_load_policy=1')) {
      const sep = src.includes('?') ? '&' : '?';
      iframe.src = src + sep + 'cc_load_policy=1&cc_lang_pref=en';
    }
  },

  enableYouTubePageCaptions() {
    const btn = document.querySelector('.ytp-subtitles-button');
    if (btn && btn.getAttribute('aria-pressed') !== 'true') {
      btn.click();
    }
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

if (typeof window !== 'undefined') window.__ai4a11yAutoTranscriber = AutoTranscriber;
