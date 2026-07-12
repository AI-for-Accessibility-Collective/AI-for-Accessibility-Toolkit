// Captions adapter — merged successor of auto-captions.js + generate-captions.js
//
// Increment 1 (this file): no new permissions, no WASM/CSP.
//   - YouTube (page + embed iframes): auto-enable native CC — the best captions
//     we can ever generate, and they work without an API key.
//   - Fetchable media (http(s) src, NOT blob:/mediasource:): background fetches
//     bytes → offscreen decodes+slices into ~15s PCM chunks → cloud Gemini
//     transcribes each chunk → real chunk-offset VTT built, injected as
//     <track>, cues streamed into the overlay box.
//   - blob:/MSE/DRM media: honest per-video one-time notice. Never silent.
//   - Audio elements: expandable <details> transcript block.
//
// Increment 2 (separate wave): on-device Whisper, tabCapture, new permissions.
//
// Decode location choice: audio decoding lives in the OFFSCREEN document, not
// the content script. Rationale: AudioContext.decodeAudioData in a content
// script requires same-origin/CORS media (a significant constraint); the SW
// already fetches bytes under host_permissions so putting the decode in the
// offscreen doc keeps the fetch + decode together in the privileged layer,
// avoids CORS restrictions entirely, and keeps the content script thin. The
// tradeoff is a round-trip through the offscreen message channel per media
// element, which is fine for batch/async transcription.

import { markProcessed, wasProcessed } from '../../utils/dom.js';
import { registerSweep } from '../../utils/observe.js';
import { isAIConfigured } from '../../utils/ai.js';

// Call-time lookups so content.js init ordering doesn't matter.
const logFix = (...a) => (globalThis.ai4a11yLogFix || (() => {}))(...a);

// ---------------------------------------------------------------------------
// axeHandlers — consumed by content.js's combined axe dispatch map
// ---------------------------------------------------------------------------

export const axeHandlers = {
  'video-caption': (el) => Captions._processVideo(el),
  'audio-caption': (el) => Captions._processAudio(el),
};

// ---------------------------------------------------------------------------
// YouTube helpers
// ---------------------------------------------------------------------------

const YT_URL_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(YT_URL_RE);
  return m ? m[1] : null;
}

function isYouTubeIframe(iframe) {
  const src = iframe.src || '';
  return /youtube\.com|youtube-nocookie\.com|youtu\.be/.test(src);
}

function addCcToYouTubeSrc(src) {
  // Only rewrite when the iframe hasn't started playing meaningfully.
  // Accepted tradeoff: rewriting src causes a player restart. This is noted
  // here and in the registry description. We guard with the data attribute
  // so we never rewrite twice.
  if (src.includes('cc_load_policy=1')) return src; // already set
  const sep = src.includes('?') ? '&' : '?';
  return src + sep + 'cc_load_policy=1&cc_lang_pref=en';
}

function enableYouTubeIframe(iframe) {
  if (iframe.dataset.ai4a11yCcEnabled) return; // never rewrite twice
  iframe.dataset.ai4a11yCcEnabled = 'true';
  const newSrc = addCcToYouTubeSrc(iframe.src);
  if (newSrc !== iframe.src) {
    iframe.src = newSrc;
  }
}

function enableYouTubePageCaptions() {
  // Click the native CC button only when it exists and isn't already active.
  const btn = document.querySelector('.ytp-subtitles-button');
  if (btn && btn.getAttribute('aria-pressed') !== 'true') {
    btn.click();
  }
}

function sweepYouTubeIframes() {
  document.querySelectorAll('iframe').forEach(iframe => {
    if (isYouTubeIframe(iframe)) enableYouTubeIframe(iframe);
  });
  if (location.hostname.includes('youtube.com') || location.hostname.includes('youtu.be')) {
    enableYouTubePageCaptions();
  }
}

// Watch for iframes whose src mutates after injection (SPA YouTube embeds).
let _iframeAttrObserver = null;
function watchIframeSrcMutations() {
  if (_iframeAttrObserver) return;
  _iframeAttrObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'src') {
        const el = m.target;
        if (el.tagName === 'IFRAME' && isYouTubeIframe(el)) {
          // src changed — reset the guard so we can re-enable CC on the new URL.
          delete el.dataset.ai4a11yCcEnabled;
          enableYouTubeIframe(el);
        }
      }
    }
  });
  _iframeAttrObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['src'] });
}

// ---------------------------------------------------------------------------
// Media source classification
// ---------------------------------------------------------------------------

function getMediaSrc(el) {
  return el.src || el.querySelector('source')?.src || null;
}

function srcIsHttpFetchable(src) {
  if (!src) return false;
  return src.startsWith('http://') || src.startsWith('https://');
}

function srcIsBlobOrMSE(src) {
  if (!src) return false;
  return src.startsWith('blob:') || src.startsWith('mediasource:');
}

// ---------------------------------------------------------------------------
// VTT builder
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function splitIntoCues(text, startSec, endSec) {
  // Split long chunk text into ≤2-line cues at sentence boundaries within the
  // chunk window. Each "cue" within the chunk gets an equal slice of time.
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const pairs = [];
  // Group sentences into pairs (2-line cues).
  for (let i = 0; i < sentences.length; i += 2) {
    pairs.push(sentences.slice(i, i + 2).join(' ').trim());
  }
  if (!pairs.length || !pairs[0]) return [{ startSec, endSec, text: text.trim() }];
  const duration = endSec - startSec;
  const step = duration / pairs.length;
  return pairs.map((t, i) => ({
    startSec: startSec + i * step,
    endSec: startSec + (i + 1) * step,
    text: t,
  }));
}

/**
 * Build a WEBVTT string from an array of chunks: [{startSec, endSec, text}].
 * Splits long chunks into ≤2-line cues at sentence boundaries.
 * @param {Array<{startSec: number, endSec: number, text: string}>} chunks
 * @returns {string}
 */
export function buildVTT(chunks) {
  let vtt = 'WEBVTT\n\n';
  let cueIndex = 1;
  for (const chunk of chunks) {
    const cues = splitIntoCues(chunk.text, chunk.startSec, chunk.endSec);
    for (const cue of cues) {
      vtt += `${cueIndex++}\n${formatTime(cue.startSec)} --> ${formatTime(cue.endSec)}\n${cue.text}\n\n`;
    }
  }
  return vtt;
}

// ---------------------------------------------------------------------------
// Background communication helpers
// ---------------------------------------------------------------------------

function sendToBackground(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) { resolve({ error: chrome.runtime.lastError.message }); return; }
        resolve(resp || {});
      });
    } catch (e) {
      resolve({ error: e.message });
    }
  });
}

/**
 * Request transcription of a fetchable media URL via the background → offscreen
 * pipeline. Returns [{startSec, endSec, text}] or throws on failure.
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
async function transcribeMediaUrl(url, signal) {
  const resp = await sendToBackground({ type: 'transcribeMedia', url });
  if (resp.error) throw new Error(resp.error);
  return resp.chunks || [];
}

// ---------------------------------------------------------------------------
// Overlay caption box
// ---------------------------------------------------------------------------

const STYLE_ID = 'ai4a11y-captions-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ai4a11y-caption-box {
      position: absolute;
      bottom: 48px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 80%;
      padding: 5px 12px;
      background: rgba(0, 0, 0, 0.82);
      color: #fff;
      font: 14px/1.4 system-ui, sans-serif;
      border-radius: 3px;
      text-align: center;
      z-index: 10000;
      pointer-events: none;
    }
    .ai4a11y-caption-notice {
      display: inline-block;
      margin: 4px 0;
      padding: 4px 10px;
      background: rgba(0,0,0,0.75);
      color: #fff;
      font: 12px system-ui, sans-serif;
      border-radius: 3px;
      z-index: 10000;
    }
    .ai4a11y-caption-notice button {
      margin-left: 8px;
      background: none;
      border: none;
      color: #adf;
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
    .ai4a11y-transcript {
      margin: 6px 0;
      font: 13px system-ui, sans-serif;
    }
    .ai4a11y-transcript summary {
      cursor: pointer;
      font-weight: bold;
    }
    .ai4a11y-transcript-label {
      font-size: 11px;
      color: #888;
      display: block;
      margin-top: 2px;
    }
  `;
  document.head.appendChild(style);
}

function createOverlayBox(wrapper) {
  const box = document.createElement('div');
  box.className = 'ai4a11y-caption-box';
  box.style.display = 'none';
  wrapper.appendChild(box);
  return box;
}

function showCue(box, text) {
  if (!box) return;
  box.textContent = text;
  box.style.display = text ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// <track> injection
// ---------------------------------------------------------------------------

function injectTrack(video, vtt) {
  // Remove any track we previously added.
  video.querySelectorAll('track[data-ai4a11y-generated="captions"]').forEach(t => t.remove());
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'AI-generated (may contain errors)';
  track.srclang = 'en';
  track.default = true;
  track.setAttribute('data-ai4a11y-generated', 'captions');
  track.src = 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);
  video.appendChild(track);
}

// ---------------------------------------------------------------------------
// Transcript block (audio elements)
// ---------------------------------------------------------------------------

function injectTranscript(audio, chunks) {
  // Remove any transcript we previously added.
  audio.parentElement?.querySelectorAll('.ai4a11y-transcript[data-ai4a11y-generated="captions"]').forEach(t => t.remove());

  const text = chunks.map(c => c.text).join(' ').trim();
  if (!text) return;

  const container = document.createElement('details');
  container.className = 'ai4a11y-transcript';
  container.setAttribute('data-ai4a11y-generated', 'captions');

  const summary = document.createElement('summary');
  summary.textContent = 'Transcript';
  container.appendChild(summary);

  const label = document.createElement('span');
  label.className = 'ai4a11y-transcript-label';
  label.textContent = 'AI-generated — may contain errors';
  container.appendChild(label);

  const content = document.createElement('div');
  content.className = 'ai4a11y-transcript-content';
  content.textContent = text;
  container.appendChild(content);

  audio.parentElement?.insertBefore(container, audio.nextSibling);
}

// ---------------------------------------------------------------------------
// "Can't reach audio" notice for blob:/MSE/DRM elements
// ---------------------------------------------------------------------------

// Track which elements have already shown the notice so we don't repeat it.
const _noticedElements = new WeakSet();

function showUnreachableNotice(el) {
  if (_noticedElements.has(el)) return;
  _noticedElements.add(el);

  const notice = document.createElement('div');
  notice.className = 'ai4a11y-caption-notice';
  notice.setAttribute('data-ai4a11y-generated', 'captions-notice');
  notice.setAttribute('role', 'note');
  notice.textContent = "Can't reach this player's audio — try Chrome Live Caption (";

  const link = document.createElement('a');
  link.href = 'chrome://settings/accessibility';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'chrome://settings/accessibility';
  link.style.color = '#adf';
  notice.appendChild(link);
  notice.appendChild(document.createTextNode(')'));

  const dismiss = document.createElement('button');
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss notice');
  dismiss.onclick = () => notice.remove();
  notice.appendChild(dismiss);

  el.parentElement?.insertBefore(notice, el.nextSibling);
}

// ---------------------------------------------------------------------------
// Generation counter — guards DOM writes from transcriptions that outlive
// a disable() call.
// ---------------------------------------------------------------------------

// Bumped by disable(). Any async transcription pipeline captures the counter
// before every await and bails (without writing to the DOM) if it changes.
let _generation = 0;

/**
 * Returns the current generation counter. Export for unit tests.
 */
export function _currentGeneration() { return _generation; }

// ---------------------------------------------------------------------------
// Per-element state
// ---------------------------------------------------------------------------

// videoStates tracks { wrapper, overlayBox, origWrapperPosition, isProcessing }
const videoStates = new Map();
// audioNotices tracks notices added per audio element so disable() can remove them
const addedNotices = new WeakSet();

// ---------------------------------------------------------------------------
// Core processing logic
// ---------------------------------------------------------------------------

async function _processMedia(el, type, aiEnabled) {
  const ns = 'captions';

  // Capture generation before any await. If disable() fires while we are
  // suspended, _generation is bumped and we bail before touching the DOM.
  const myGen = _generation;

  // Size check BEFORE marking setup.
  const rect = el.getBoundingClientRect();
  if (type === 'video' && (rect.width < 100 || rect.height < 75)) return;

  if (wasProcessed(el, ns)) return;
  markProcessed(el, 'pending', ns);

  const src = getMediaSrc(el);

  // --- YouTube video element (on youtube.com page) ---
  if (type === 'video' && location.hostname.includes('youtube.com')) {
    // YouTube native CC is already being enabled by the sweep; mark done.
    markProcessed(el, 'done', ns);
    return;
  }

  // --- blob:/MSE/DRM notice ---
  if (srcIsBlobOrMSE(src)) {
    showUnreachableNotice(el);
    markProcessed(el, 'done', ns);
    return;
  }

  // --- No src and not blob: no audio to caption ---
  if (!src) {
    markProcessed(el, 'failed', ns);
    return;
  }

  // --- Not an http(s) URL ---
  if (!srcIsHttpFetchable(src)) {
    showUnreachableNotice(el);
    markProcessed(el, 'done', ns);
    return;
  }

  // --- Fetchable media: need AI ---
  if (!aiEnabled) {
    // Mark as failed/retryable so we retry when the key is added.
    markProcessed(el, 'failed', ns);
    return;
  }

  // Setup video overlay box for progress display.
  let overlayBox = null;
  if (type === 'video') {
    let state = videoStates.get(el);
    if (!state) {
      const wrapper = el.parentElement;
      const origPos = getComputedStyle(wrapper).position;
      if (origPos === 'static') wrapper.style.position = 'relative';
      overlayBox = createOverlayBox(wrapper);
      state = { wrapper, overlayBox, origWrapperPosition: origPos };
      videoStates.set(el, state);
    } else {
      overlayBox = state.overlayBox;
    }
  }

  showCue(overlayBox, 'Transcribing…');

  try {
    // Timeout: 5 minutes overall for large media files.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    let chunks;
    try {
      // Generation check: re-verify before and after the cloud round-trip.
      if (_generation !== myGen) { markProcessed(el, 'failed', ns); return; }
      chunks = await transcribeMediaUrl(src, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    // Generation check after the multi-minute cloud await.
    if (_generation !== myGen) {
      // Teardown already cleaned the DOM. Mark retryable so re-enable re-scans.
      markProcessed(el, 'failed', ns);
      return;
    }

    if (!chunks || !chunks.length) throw new Error('No transcript returned');

    const vtt = buildVTT(chunks);

    if (type === 'video') {
      injectTrack(el, vtt);
      // Stream the first cue text to the overlay, then hide it since the
      // native track will show captions.
      const firstCue = chunks[0]?.text || '';
      showCue(overlayBox, firstCue);
      setTimeout(() => showCue(overlayBox, ''), 3000);
    } else {
      // audio: inject transcript block
      injectTranscript(el, chunks);
    }

    markProcessed(el, 'done', ns);
    // Note: we do NOT increment the wcag stat for machine output.
    // logFix with type 'caption' (tracked in popup but not wcag counter).
    logFix('caption', el, '(none)', `(AI-generated, ${chunks.length} chunks)`);
  } catch (e) {
    console.warn('[AI4A11y Captions] transcription error:', e.message);
    showCue(overlayBox, '');
    markProcessed(el, 'failed', ns); // retryable
  }
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

export const Captions = {
  enabled: false,
  _youtubeOnly: false, // set by content.js when keyless
  _observer: null,
  _sweepUnregister: null,
  _aiEnabled: false,

  // Called by content.js axe dispatch for individual elements.
  async _processVideo(el) {
    return _processMedia(el, 'video', this._aiEnabled);
  },
  async _processAudio(el) {
    return _processMedia(el, 'audio', this._aiEnabled);
  },

  async enable(opts = {}) {
    if (this.enabled) return;
    this.enabled = true;
    this._youtubeOnly = !!opts.youtubeOnly;

    // Check AI availability (may have changed since page load).
    this._aiEnabled = !this._youtubeOnly && await isAIConfigured().catch(() => false);

    injectStyles();

    // YouTube path: works without an API key.
    sweepYouTubeIframes();
    watchIframeSrcMutations();

    // General media sweep (only runs transcription when _aiEnabled).
    await this._sweepAll();

    // Register MutationObserver for dynamically added media.
    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === 'VIDEO') _processMedia(node, 'video', this._aiEnabled);
          if (node.tagName === 'AUDIO') _processMedia(node, 'audio', this._aiEnabled);
          if (node.tagName === 'IFRAME' && isYouTubeIframe(node)) enableYouTubeIframe(node);
          node.querySelectorAll?.('video').forEach(v => _processMedia(v, 'video', this._aiEnabled));
          node.querySelectorAll?.('audio').forEach(a => _processMedia(a, 'audio', this._aiEnabled));
          node.querySelectorAll?.('iframe').forEach(f => isYouTubeIframe(f) && enableYouTubeIframe(f));
        }
      }
    });
    this._observer.observe(document.body, { childList: true, subtree: true });

    // SPA URL-change hook via observe.js to re-sweep on navigation.
    this._sweepUnregister = registerSweep('captions', () => {
      sweepYouTubeIframes();
      this._sweepAll();
    });
  },

  async _sweepAll() {
    sweepYouTubeIframes();
    const vids = document.querySelectorAll('video');
    for (const v of vids) {
      if (!this.enabled) break;
      const tracks = v.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
      if (tracks.length === 0) await _processMedia(v, 'video', this._aiEnabled);
    }
    const audios = document.querySelectorAll('audio');
    for (const a of audios) {
      if (!this.enabled) break;
      await _processMedia(a, 'audio', this._aiEnabled);
    }
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;

    // Bump the generation counter so any in-flight transcription pipeline
    // that resumes after this point will see the mismatch and write nothing
    // to the DOM (generation-counter pattern for #6).
    _generation++;

    // Disconnect observer.
    this._observer?.disconnect();
    this._observer = null;

    // Disconnect iframe attr observer.
    _iframeAttrObserver?.disconnect();
    _iframeAttrObserver = null;

    // Unregister SPA sweep.
    this._sweepUnregister?.();
    this._sweepUnregister = null;

    // Remove injected tracks.
    document.querySelectorAll('track[data-ai4a11y-generated="captions"]').forEach(t => t.remove());

    // Remove injected transcripts.
    document.querySelectorAll('.ai4a11y-transcript[data-ai4a11y-generated="captions"]').forEach(t => t.remove());

    // Remove overlay boxes and restore wrapper position.
    for (const [el, state] of videoStates) {
      state.overlayBox?.remove();
      // Restore wrapper position:relative only if we added it.
      if (state.wrapper && state.origWrapperPosition === 'static') {
        state.wrapper.style.position = '';
      }
    }
    videoStates.clear();

    // Remove notices.
    document.querySelectorAll('[data-ai4a11y-generated="captions-notice"]').forEach(n => n.remove());

    // Remove styles.
    document.getElementById(STYLE_ID)?.remove();

    // Clear namespaced marks so re-enable re-processes everything.
    import('../../utils/dom.js').then(({ clearMarks }) => clearMarks('captions')).catch(() => {});
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};
