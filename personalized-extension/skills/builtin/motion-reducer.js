import { announce } from '../../utils/ai.js';
import { registerSweep } from '../../utils/observe.js';

export const MotionReducer = {
  styleId: 'ai4a11y-motion-reducer-styles',
  enabled: false,
  _unregisterSweep: null,
  _pausedWaapiRefs: [],
  _pausedPlayState: new Set(),
  _frozenImages: new Map(),
  _pausedIframes: new Set(),
  currentSettings: {
    stopAnimations: true,
    pauseVideos: true,
    stopGifs: true,
    disableParallax: true
  },

  enable(options = {}) {
    if (this.enabled) return;
    this.currentSettings = { ...this.currentSettings, ...options };
    this.enabled = true;

    const s = this.currentSettings;
    let css = '';

    if (s.stopAnimations) {
      css += `
        *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"]),
        *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"])::before,
        *:not([id^="ai4a11y-"]):not([class^="ai4a11y-"])::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
        html { scroll-behavior: auto !important; }
      `;
    }

    if (s.disableParallax) {
      css += `
        [class*="parallax"], [style*="background-attachment: fixed"] {
          background-attachment: scroll !important;
        }
      `;
    }

    const style = document.createElement('style');
    style.id = this.styleId;
    style.textContent = css;
    document.head.appendChild(style);

    if (s.pauseVideos) this.pauseAllVideos();
    if (s.stopGifs) this._freezeImages();

    // WAAPI pass
    this._pauseWaapiAnimations();

    // requestIdleCallback chunking for the CSS animationPlayState pass
    const pauseAnimations = (deadline) => {
      const elements = document.querySelectorAll('*');
      let i = 0;
      const processChunk = () => {
        while (i < elements.length && (typeof deadline === 'undefined' || deadline.timeRemaining() > 0)) {
          const el = elements[i];
          // Skip extension UI elements
          if ((el.id && el.id.startsWith('ai4a11y-')) || (el.className && typeof el.className === 'string' && el.className.startsWith('ai4a11y-'))) {
            i++;
            continue;
          }
          try {
            const computedStyle = getComputedStyle(el);
            if (computedStyle.animationName !== 'none') {
              el.style.animationPlayState = 'paused';
              this._pausedPlayState.add(el);
            }
          } catch (e) {}
          i++;
        }
        if (i < elements.length) {
          requestIdleCallback ? requestIdleCallback(processChunk) : setTimeout(processChunk, 0);
        }
      };
      processChunk();
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(pauseAnimations);
    } else {
      pauseAnimations();
    }

    // Register sweep so newly added videos/GIFs/animations also get handled.
    this._unregisterSweep = registerSweep('motion-reducer', () => {
      if (!this.enabled) return;
      this._pauseWaapiAnimations();
      if (s.stopGifs) this._freezeImages();
      if (s.pauseVideos) this.pauseAllVideos();
    }, { debounceMs: 600 });

    console.log('[AI4A11y] Motion Reducer enabled');
    announce('Motion reduced');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this._unregisterSweep) { this._unregisterSweep(); this._unregisterSweep = null; }
    document.getElementById(this.styleId)?.remove();

    // Restore frozen images
    for (const [canvas, img] of this._frozenImages) {
      if (canvas.parentNode) {
        canvas.parentNode.insertBefore(img, canvas);
        canvas.remove();
      }
      delete img.dataset.ai4a11yMrFrozen;
    }
    this._frozenImages.clear();

    // Resume only WAAPI animations this adapter paused
    for (const ref of this._pausedWaapiRefs) {
      const anim = ref.deref();
      if (anim && anim.playState === 'paused') {
        try { anim.play(); } catch (e) {}
      }
    }
    this._pausedWaapiRefs = [];

    // Clear only animationPlayState on elements this adapter set
    for (const el of this._pausedPlayState) {
      el.style.animationPlayState = '';
    }
    this._pausedPlayState.clear();

    // Resume iframes this adapter paused
    for (const iframe of this._pausedIframes) {
      const src = iframe.src || '';
      try {
        if (src.includes('youtube.com')) {
          iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        } else if (src.includes('vimeo.com')) {
          iframe.contentWindow?.postMessage('{"method":"play"}', '*');
        }
      } catch (e) {}
    }
    this._pausedIframes.clear();

    // Resume videos this adapter paused
    document.querySelectorAll('video[data-ai4a11y-was-paused="false"]').forEach(video => {
      video.play().catch(() => {});
      delete video.dataset.ai4a11yWasPaused;
    });

    console.log('[AI4A11y] Motion Reducer disabled');
    announce('Motion restored');
  },

  _pauseWaapiAnimations() {
    try {
      document.getAnimations().forEach(a => {
        if (a.playState === 'running') {
          a.pause();
          this._pausedWaapiRefs.push(new WeakRef(a));
        }
      });
    } catch (e) {}
  },

  _freezeImages() {
    document.querySelectorAll('img').forEach(img => {
      if (img.dataset.ai4a11yMrFrozen) return;
      const url = img.src || '';
      const mightAnimate = /\.(gif|webp|apng)(\?|$)/i.test(url)
        || url.startsWith('data:image/gif')
        || url.startsWith('data:image/webp');
      if (mightAnimate) {
        this._freezeSingleImage(img).catch(() => {});
      } else {
        img.dataset.ai4a11yMrFrozen = 'skip';
      }
    });
  },

  async _freezeSingleImage(img) {
    if (!img.src || img.dataset.ai4a11yMrFrozen) return;
    img.dataset.ai4a11yMrFrozen = 'pending';

    const w = img.naturalWidth || img.width || 100;
    const h = img.naturalHeight || img.height || 100;
    const altText = img.getAttribute('alt') || '';
    const origId = img.id;
    const origClass = img.className;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (origId) canvas.id = origId;
    if (origClass) canvas.className = origClass;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', altText);
    canvas.setAttribute('width', w);
    canvas.setAttribute('height', h);

    const ctx = canvas.getContext('2d');

    // Try same-origin fast path
    let drawn = false;
    try {
      ctx.drawImage(img, 0, 0, w, h);
      ctx.getImageData(0, 0, 1, 1); // throws SecurityError if tainted
      drawn = true;
    } catch (e) {
      // cross-origin — need to fetch bytes
    }

    if (!drawn) {
      // Try ImageDecoder path via background fetch
      if (typeof ImageDecoder !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
        try {
          const resp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'fetchImageBytes', url: img.src }, (r) => {
              resolve(r || { error: 'no response' });
            });
          });
          if (resp && resp.bytes && !resp.error) {
            // Decode type from URL
            const url = img.src;
            let type = 'image/gif';
            if (/\.webp(\?|$)/i.test(url)) type = 'image/webp';
            else if (/\.apng(\?|$)/i.test(url)) type = 'image/png';
            else if (/\.png(\?|$)/i.test(url)) type = 'image/png';

            // Convert base64 to Uint8Array
            const binStr = atob(resp.bytes);
            const bytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

            const decoder = new ImageDecoder({ data: bytes.buffer, type });
            const result = await decoder.decode({ frameIndex: 0 });
            ctx.drawImage(result.image, 0, 0, w, h);
            result.image.close();
            decoder.close();
            drawn = true;
          }
        } catch (e) {
          // ImageDecoder failed, leave drawn=false
        }
      }
    }

    if (!drawn) {
      // Last resort: crossOrigin re-fetch (may fail on CORS-blocked images)
      try {
        await new Promise((resolve, reject) => {
          const tmp = new Image();
          tmp.crossOrigin = 'anonymous';
          tmp.onload = () => { try { ctx.drawImage(tmp, 0, 0, w, h); resolve(); } catch (e) { reject(e); } };
          tmp.onerror = reject;
          tmp.src = img.src;
        });
        drawn = true;
      } catch (e) {
        img.dataset.ai4a11yMrFrozen = 'failed';
        return;
      }
    }

    // Store original and replace
    this._frozenImages.set(canvas, img);
    if (img.parentNode) {
      img.parentNode.insertBefore(canvas, img);
      img.remove();
    }
    img.dataset.ai4a11yMrFrozen = 'frozen'; // mark the original too
  },

  pauseAllVideos() {
    document.querySelectorAll('video').forEach(video => {
      if (!video.paused) {
        video.pause();
        video.dataset.ai4a11yWasPaused = 'false';
      }
    });
    document.querySelectorAll('iframe').forEach(iframe => {
      const src = iframe.src || '';
      if (src.includes('youtube.com') && src.includes('enablejsapi=1')) {
        iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
        this._pausedIframes.add(iframe);
      } else if (src.includes('youtube.com')) {
        iframe.dataset.ai4a11yMrIframe = 'unreachable'; // no enablejsapi, skip
      } else if (src.includes('vimeo.com')) {
        iframe.contentWindow?.postMessage('{"method":"pause"}', '*');
        this._pausedIframes.add(iframe);
      }
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

window.__ai4a11yMotionReducer = MotionReducer;
