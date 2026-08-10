// Motion Reducer - stops animations, GIFs, parallax, and auto-playing media
import { announce } from '../utils/ai.js';
import { registerSweep } from '../utils/observe.js';

export const MotionReducer = {
  styleId: 'ai4a11y-motion-reducer-styles',
  enabled: false,
  unregisterSweep: null,
  pausedWaapiRefs: [],
  pausedPlayState: new Set(),
  frozenImages: new Map(),
  pausedIframes: new Set(),
  // Generation counter: incremented on every disable() call so in-flight
  // async freezeSingleImage continuations can detect they've been overtaken
  // and abort before mutating the DOM or repopulating frozenImages.
  freezeGen: 0,
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
    if (s.stopGifs) this.freezeImages();

    // Web Animations API pass — CSS `animation-duration` overrides above don't
    // touch animations created via element.animate()/WAAPI.
    this.pauseWaapiAnimations();

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
              this.pausedPlayState.add(el);
            }
          } catch (e) { /* element may have been removed */ }
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
    this.unregisterSweep = registerSweep('motion-reducer', () => {
      if (!this.enabled) return;
      this.pauseWaapiAnimations();
      if (s.stopGifs) this.freezeImages();
      if (s.pauseVideos) this.pauseAllVideos();
    }, { debounceMs: 600 });

    console.log('[AI4A11y] Motion Reducer enabled');
    announce('Motion reduced');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    // Bump the generation counter so any in-flight freezeSingleImage calls
    // that are currently awaiting image decode will detect the change and
    // abort before swapping the DOM or repopulating frozenImages.
    this.freezeGen++;
    if (this.unregisterSweep) { this.unregisterSweep(); this.unregisterSweep = null; }
    document.getElementById(this.styleId)?.remove();

    // Restore frozen images — put the exact original <img> node back
    // (preserving id, listeners, etc.), not a lossy reconstruction.
    for (const [canvas, img] of this.frozenImages) {
      if (canvas.parentNode) {
        canvas.parentNode.insertBefore(img, canvas);
        canvas.remove();
      }
      delete img.dataset.ai4a11yMrFrozen;
    }
    this.frozenImages.clear();

    // Resume only WAAPI animations this adapter paused
    for (const ref of this.pausedWaapiRefs) {
      const anim = ref.deref ? ref.deref() : ref;
      if (anim && anim.playState === 'paused') {
        try { anim.play(); } catch (e) {}
      }
    }
    this.pausedWaapiRefs = [];

    // Clear only animationPlayState on elements this adapter set
    for (const el of this.pausedPlayState) {
      el.style.animationPlayState = '';
    }
    this.pausedPlayState.clear();

    // Resume iframes this adapter paused
    for (const iframe of this.pausedIframes) {
      const src = iframe.src || '';
      try {
        if (src.includes('youtube.com')) {
          iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        } else if (src.includes('vimeo.com')) {
          iframe.contentWindow?.postMessage('{"method":"play"}', '*');
        }
      } catch (e) {}
    }
    this.pausedIframes.clear();

    // Resume videos this adapter paused
    document.querySelectorAll('video[data-ai4a11y-was-paused="false"]').forEach(video => {
      video.play().catch(() => {});
      delete video.dataset.ai4a11yWasPaused;
    });

    console.log('[AI4A11y] Motion Reducer disabled');
    announce('Motion restored');
  },

  pauseWaapiAnimations() {
    try {
      document.getAnimations().forEach(a => {
        if (a.playState === 'running') {
          a.pause();
          this.pausedWaapiRefs.push(typeof WeakRef !== 'undefined' ? new WeakRef(a) : a);
        }
      });
    } catch (e) {}
  },

  // Freeze every animatable image (gif/webp/apng) to its first frame.
  freezeImages() {
    document.querySelectorAll('img').forEach(img => {
      if (img.dataset.ai4a11yMrFrozen) return;
      const url = img.src || '';
      const mightAnimate = /\.(gif|webp|apng)(\?|$)/i.test(url)
        || url.startsWith('data:image/gif')
        || url.startsWith('data:image/webp');
      if (mightAnimate) {
        this.freezeSingleImage(img).catch(() => {});
      } else {
        img.dataset.ai4a11yMrFrozen = 'skip';
      }
    });
  },

  async freezeSingleImage(img) {
    if (!img.src || img.dataset.ai4a11yMrFrozen) return;
    img.dataset.ai4a11yMrFrozen = 'pending';

    // Capture the generation at invocation time. If disable() fires while we
    // are awaiting, it bumps freezeGen; we compare after each await and abort
    // without touching the DOM.
    const capturedGen = this.freezeGen;

    const w = img.naturalWidth || img.width || 100;
    const h = img.naturalHeight || img.height || 100;
    const altText = img.getAttribute('alt') || '';
    const origId = img.id;
    const origClass = img.className;

    // Determine whether the source image is decorative so we can set the
    // correct ARIA attributes on the replacement canvas.
    //   - alt="" -> explicitly decorative (HTML spec presentational)
    //   - aria-hidden="true" -> author removed from AX tree
    //   - role="presentation" or role="none" -> author marked as presentational
    const srcAriaHidden = img.getAttribute('aria-hidden');
    const srcRole = img.getAttribute('role') || '';
    const decorative = altText === '' ||
                       srcAriaHidden === 'true' ||
                       srcRole === 'presentation' ||
                       srcRole === 'none';

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (origId) canvas.id = origId;
    if (origClass) canvas.className = origClass;

    if (decorative) {
      // Hide from the AX tree, matching the source image's decorative status.
      canvas.setAttribute('aria-hidden', 'true');
    } else {
      // Named image: expose as img with the same accessible name.
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', altText);
      if (srcAriaHidden !== null) canvas.setAttribute('aria-hidden', srcAriaHidden);
    }

    canvas.setAttribute('width', w);
    canvas.setAttribute('height', h);

    const ctx = canvas.getContext('2d');

    // Try same-origin fast path
    let drawn = false;
    // True when drawImage painted a frame but the canvas is cross-origin-
    // tainted (no CORS headers): the paint itself never throws — only
    // reading pixels back does — so this is a valid display-only fallback.
    let taintedDraw = false;
    try {
      ctx.drawImage(img, 0, 0, w, h);
      try {
        ctx.getImageData(0, 0, 1, 1); // throws SecurityError if tainted
        drawn = true;
      } catch (taintErr) {
        taintedDraw = true;
      }
    } catch (e) {
      // drawImage itself failed (not decodable yet, 0-size, etc.) — fall
      // through to the crossOrigin re-fetch below.
    }

    if (!drawn) {
      // Last resort: crossOrigin re-fetch (may fail on CORS-blocked images).
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
        if (taintedDraw) {
          // Every clean path failed (server sent no CORS headers). The
          // fast-path canvas already has a valid painted frame from the
          // tainted draw above; it just can't be read back as pixel data,
          // which we never need for display-only freezing. Use it instead
          // of leaving the original GIF animating.
          drawn = true;
        } else {
          img.dataset.ai4a11yMrFrozen = 'failed';
          return;
        }
      }
    }

    // Abort guard: re-check after the awaited fetch so a disable() that fired
    // during the crossOrigin re-fetch does not swap the DOM after teardown.
    if (this.freezeGen !== capturedGen) { delete img.dataset.ai4a11yMrFrozen; return; }

    // Store original and replace
    this.frozenImages.set(canvas, img);
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
        this.pausedIframes.add(iframe);
      } else if (src.includes('vimeo.com')) {
        iframe.contentWindow?.postMessage('{"method":"pause"}', '*');
        this.pausedIframes.add(iframe);
      }
      // A youtube embed without enablejsapi=1 can't be controlled via
      // postMessage — skip it rather than post into the void.
    });
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }
};

if (typeof window !== 'undefined') window.__ai4a11yMotionReducer = MotionReducer;
