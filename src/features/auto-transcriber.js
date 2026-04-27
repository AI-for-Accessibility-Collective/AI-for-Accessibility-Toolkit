// Auto Transcriber - AI-powered captions for video/audio
import { sendMessage, announce } from '../utils/messaging.js';

export const AutoTranscriber = {
  enabled: false,
  observer: null,
  videoStates: new Map(),
  styleId: 'ai4a11y-caption-helper-styles',

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.injectStyles();
    this.setupVideoObserver();
    this.enableCaptionsOnAllVideos();
    setTimeout(() => this.enableCaptionsOnAllVideos(), 1000);
    console.log('[AI4A11y] Auto Transcriber enabled');
    announce('Auto Transcriber enabled');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.observer?.disconnect();
    this.observer = null;
    document.querySelectorAll('.ai4a11y-audio-btn, .ai4a11y-caption-box').forEach(el => el.remove());
    document.getElementById(this.styleId)?.remove();
    this.videoStates.clear();
    console.log('[AI4A11y] Auto Transcriber disabled');
    announce('Auto Transcriber disabled');
  },

  injectStyles() {
    if (document.getElementById(this.styleId)) return;
    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = `
      .ai4a11y-audio-btn {
        position: absolute;
        top: 6px;
        right: 28px;
        z-index: 10000;
        padding: 3px 6px;
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        border: none;
        border-radius: 2px;
        font: 10px/1 system-ui, sans-serif;
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 0.15s;
      }
      .ai4a11y-audio-btn:hover { opacity: 1; }
      .ai4a11y-audio-btn.recording { color: #f66; }
      .ai4a11y-caption-box {
        position: absolute;
        bottom: 48px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 80%;
        padding: 5px 12px;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        font: 14px/1.4 system-ui, sans-serif;
        border-radius: 2px;
        text-align: center;
        z-index: 10000;
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

    // Cleanup on page unload to prevent memory leaks in SPAs
    window.addEventListener('pagehide', () => this.disable(), { once: true });
  },

  cleanupVideo(video) {
    const state = this.videoStates.get(video);
    if (state) {
      state.btn?.remove();
      state.captionBox?.remove();
      this.videoStates.delete(video);
    }
  },

  enableCaptionsOnAllVideos() {
    document.querySelectorAll('video').forEach(v => this.setupVideo(v));
    document.querySelectorAll('iframe[src*="youtube"]').forEach(f => this.enableYouTubeCaptions(f));
    if (location.hostname.includes('youtube.com')) this.enableYouTubePageCaptions();
  },

  setupVideo(video) {
    if (video.dataset.ai4a11ySetup) return;
    video.dataset.ai4a11ySetup = 'true';

    const rect = video.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 75) return;

    let wrapper = video.parentElement;
    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    const btn = document.createElement('button');
    btn.className = 'ai4a11y-audio-btn';
    btn.textContent = 'CC';
    btn.title = 'Auto transcribe';
    btn.onclick = () => this.toggleTranscription(video, btn);
    wrapper.appendChild(btn);

    const captionBox = document.createElement('div');
    captionBox.className = 'ai4a11y-caption-box';
    captionBox.style.display = 'none';
    wrapper.appendChild(captionBox);

    this.videoStates.set(video, { btn, captionBox, isTranscribing: false });
  },

  async toggleTranscription(video, btn) {
    const state = this.videoStates.get(video);
    if (!state) return;

    if (state.isTranscribing) {
      state.isTranscribing = false;
      btn.classList.remove('recording');
      btn.textContent = 'CC';
      state.captionBox.style.display = 'none';
    } else {
      state.isTranscribing = true;
      btn.classList.add('recording');
      btn.textContent = '⏺ CC';
      state.captionBox.style.display = 'block';
      state.captionBox.textContent = 'Transcribing...';
      await this.transcribeVideo(video, state);
    }
  },

  async transcribeVideo(video, state) {
    try {
      // For YouTube, try to get existing transcript
      const ytMatch = video.closest('[data-video-id]')?.dataset.videoId ||
        window.location.href.match(/[?&]v=([^&]+)/)?.[1];

      if (ytMatch) {
        const response = await sendMessage({ type: 'getYouTubeTranscript', videoId: ytMatch });
        if (response?.success && response.result) {
          state.captionBox.textContent = response.result;
          return;
        }
      }

      state.captionBox.textContent = 'Live transcription requires API key';
    } catch (e) {
      console.error('[AI4A11y] Transcription error:', e);
      state.captionBox.textContent = 'Transcription failed';
    }
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

window.__ai4a11yAutoTranscriber = AutoTranscriber;
