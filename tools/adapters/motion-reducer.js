// Motion Reducer - stops animations, GIFs, parallax, and auto-playing media
import { announce } from '../utils/ai.js';

export const MotionReducer = {
  styleId: 'ai4a11y-motion-reducer-styles',
  enabled: false,
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
        *, *::before, *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.001ms !important;
          scroll-behavior: auto !important;
        }
        html { scroll-behavior: auto !important; }
        [class*="scroll"], [class*="slide"], [class*="marquee"],
        [class*="carousel"], [class*="ticker"] {
          animation: none !important;
          transform: none !important;
        }
        [class*="animate"], [class*="motion"], [class*="move"] {
          transform: none !important;
        }
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
    if (s.stopGifs) this.stopGifs();

    // Use requestIdleCallback to avoid blocking on complex pages
    const pauseAnimations = (deadline) => {
      const elements = document.querySelectorAll('*');
      let i = 0;
      const processChunk = () => {
        while (i < elements.length && (typeof deadline === 'undefined' || deadline.timeRemaining() > 0)) {
          const el = elements[i];
          try {
            const style = getComputedStyle(el);
            if (style.animationName !== 'none') {
              el.style.animationPlayState = 'paused';
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
      pauseAnimations()
    }

    console.log('[AI4A11y] Motion Reducer enabled');
    announce('Motion reduced');
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    document.getElementById(this.styleId)?.remove();

    document.querySelectorAll('[data-ai4a11y-gif-src]').forEach(canvas => {
      const img = document.createElement('img');
      img.src = canvas.dataset.ai4a11yGifSrc;
      img.alt = canvas.getAttribute('alt') || '';
      img.className = canvas.className;
      canvas.replaceWith(img);
    });

    document.querySelectorAll('[style*="animation-play-state"]').forEach(el => {
      el.style.animationPlayState = '';
    });

    // Resume videos that were playing before motion reducer paused them
    document.querySelectorAll('video[data-ai4a11y-was-playing="true"]').forEach(video => {
      video.play().catch(() => {});
      delete video.dataset.ai4a11yWasPlaying;
    });

    console.log('[AI4A11y] Motion Reducer disabled');
    announce('Motion restored');
  },

  pauseAllVideos() {
    document.querySelectorAll('video').forEach(video => {
      if (!video.paused) {
        video.pause();
        video.dataset.ai4a11yWasPlaying = 'true';
      }
    });
    document.querySelectorAll('iframe').forEach(iframe => {
      const src = iframe.src || '';
      if (src.includes('youtube.com')) {
        iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
      } else if (src.includes('vimeo.com')) {
        iframe.contentWindow?.postMessage('{"method":"pause"}', '*');
      }
    });
  },

  stopGifs() {
    document.querySelectorAll('img[src$=".gif"], img[src*=".gif?"]').forEach(img => {
      if (img.dataset.ai4a11yGifStopped) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 100;
      canvas.height = img.naturalHeight || img.height || 100;
      canvas.className = img.className;
      canvas.setAttribute('alt', img.alt || '');
      canvas.setAttribute('role', 'img');
      canvas.dataset.ai4a11yGifSrc = img.src;
      const ctx = canvas.getContext('2d');
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';
      tempImg.onload = () => {
        ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
        img.replaceWith(canvas);
        canvas.dataset.ai4a11yGifStopped = 'true';
      };
      tempImg.onerror = () => {
        img.style.visibility = 'visible';
        img.dataset.ai4a11yGifStopped = 'true';
      };
      tempImg.src = img.src;
    });
  },

  toggle() {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
};

window.__ai4a11yMotionReducer = MotionReducer;
