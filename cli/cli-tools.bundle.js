(() => {
  // tools/utils/ai.js
  var provider = null;
  function setAIProvider(p) {
    provider = p;
  }
  async function describeImage(imageData) {
    if (!(provider == null ? void 0 : provider.describeImage)) {
      throw new Error("AI provider not set or missing describeImage");
    }
    return provider.describeImage(imageData);
  }
  async function simplifyText(text, options = {}) {
    if (!(provider == null ? void 0 : provider.simplifyText)) {
      throw new Error("AI provider not set or missing simplifyText");
    }
    return provider.simplifyText(text, options);
  }
  async function summarizeText(text) {
    if (!(provider == null ? void 0 : provider.summarizeText)) {
      throw new Error("AI provider not set or missing summarizeText");
    }
    return provider.summarizeText(text);
  }
  async function inferLabel(context) {
    if (!(provider == null ? void 0 : provider.inferLabel)) {
      throw new Error("AI provider not set or missing inferLabel");
    }
    return provider.inferLabel(context);
  }
  async function fixContrast(foreground, background) {
    if (!(provider == null ? void 0 : provider.fixContrast)) {
      return null;
    }
    return provider.fixContrast(foreground, background);
  }
  async function getYouTubeTranscript(videoId) {
    if (!(provider == null ? void 0 : provider.getYouTubeTranscript)) {
      return null;
    }
    return provider.getYouTubeTranscript(videoId);
  }
  function announce(message) {
    if (provider == null ? void 0 : provider.announce) {
      provider.announce(message);
    }
  }
  async function transcribeVideo(videoUrl) {
    if (!(provider == null ? void 0 : provider.transcribeVideo)) {
      return null;
    }
    return provider.transcribeVideo(videoUrl);
  }
  async function transcribeAudio(audioUrl) {
    if (!(provider == null ? void 0 : provider.transcribeAudio)) {
      return null;
    }
    return provider.transcribeAudio(audioUrl);
  }

  // tools/adapters/visual-assist.js
  var VisualAssist = {
    styleId: "ai4a11y-visual-assist",
    enabled: false,
    settings: {
      contrastMode: "none",
      fontScale: 1,
      lineHeight: 1.5,
      letterSpacing: 0,
      largeCursor: false,
      enhanceFocus: false,
      dyslexiaFont: false,
      readingGuide: false
    },
    enable(options = {}) {
      this.settings = { ...this.settings, ...options };
      this.enabled = true;
      this.apply();
      if (this.settings.readingGuide) {
        this.enableReadingGuide();
      } else {
        this.disableReadingGuide();
      }
    },
    disable() {
      this.enabled = false;
      this.remove();
      this.disableReadingGuide();
    },
    apply() {
      this.remove();
      const css = this.generateCSS();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
    },
    remove() {
      var _a;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
    },
    generateCSS() {
      var _a;
      const s = this.settings;
      let css = "";
      if (s.contrastMode === "light") {
        css += `
        html { background: #fff !important; }
        body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a {
          color: #000 !important;
          background: #fff !important;
        }
        a { text-decoration: underline !important; }
        img, video { filter: contrast(1.2) !important; }
      `;
      } else if (s.contrastMode === "yellow-black") {
        css += `
        html { background: #000 !important; }
        body, p, div, span, li, td, th, h1, h2, h3, h4, h5, h6 {
          color: #ff0 !important;
          background: #000 !important;
        }
        a { color: #0ff !important; text-decoration: underline !important; }
        img, video { filter: contrast(1.2) brightness(0.9) !important; }
      `;
      }
      let scale = s.fontScale > 10 ? s.fontScale / 100 : s.fontScale;
      if (scale && scale > 0 && scale !== 1) {
        scale = Math.max(0.5, Math.min(3, scale));
        css += `html { zoom: ${scale} !important; }
`;
      }
      if (s.lineHeight && s.lineHeight !== 1.5) {
        css += `body, p, li, td, th { line-height: ${s.lineHeight} !important; }
`;
      }
      if (s.letterSpacing && s.letterSpacing !== 0) {
        css += `body { letter-spacing: ${s.letterSpacing}em !important; }
`;
      }
      if (s.largeCursor) {
        css += `* { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="black"/><circle cx="16" cy="16" r="10" fill="white"/></svg>'), auto !important; }
`;
      }
      if (s.enhanceFocus) {
        css += `
        *:focus, *:focus-visible {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
        a:focus, button:focus, input:focus, select:focus, textarea:focus, [tabindex]:focus {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
      `;
      }
      if (s.dyslexiaFont) {
        const fontUrl = typeof chrome !== "undefined" && ((_a = chrome.runtime) == null ? void 0 : _a.getURL) ? chrome.runtime.getURL("lib/OpenDyslexic-Regular.woff2") : "https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff2";
        css += `@font-face { font-family: 'OpenDyslexic'; src: url('${fontUrl}'); }
`;
        css += `body, p, li, td, th, span, div { font-family: 'OpenDyslexic', sans-serif !important; }
`;
      }
      if (s.readingGuide) {
        css += `.ai4a11y-reading-guide { position: fixed; left: 0; right: 0; height: 40px; background: rgba(255, 255, 0, 0.2); pointer-events: none; z-index: 999999; transition: top 0.05s ease-out; }
`;
      }
      return css;
    },
    toggle() {
      if (this.enabled)
        this.disable();
      else
        this.enable();
    },
    // Reading guide element and handler
    readingGuideEl: null,
    readingGuideHandler: null,
    enableReadingGuide() {
      if (this.readingGuideEl)
        return;
      this.readingGuideEl = document.createElement("div");
      this.readingGuideEl.className = "ai4a11y-reading-guide";
      document.body.appendChild(this.readingGuideEl);
      this.readingGuideRafPending = false;
      this.lastMouseY = 0;
      this.readingGuideHandler = (e) => {
        this.lastMouseY = e.clientY;
        if (this.readingGuideRafPending)
          return;
        this.readingGuideRafPending = true;
        requestAnimationFrame(() => {
          this.readingGuideRafPending = false;
          if (this.readingGuideEl) {
            this.readingGuideEl.style.top = `${this.lastMouseY - 20}px`;
          }
        });
      };
      document.addEventListener("mousemove", this.readingGuideHandler, { passive: true });
    },
    disableReadingGuide() {
      if (this.readingGuideEl) {
        this.readingGuideEl.remove();
        this.readingGuideEl = null;
      }
      if (this.readingGuideHandler) {
        document.removeEventListener("mousemove", this.readingGuideHandler);
        this.readingGuideHandler = null;
      }
    }
  };
  window.__ai4a11yVisualAssist = VisualAssist;

  // tools/adapters/dark-mode.js
  var DarkMode = {
    enabled: false,
    styleId: "ai4a11y-dark-mode",
    settings: {
      brightness: 100,
      contrast: 100,
      sepia: 0,
      grayscale: 0
    },
    enable(options = {}) {
      this.settings = { ...this.settings, ...options };
      this.enabled = true;
      if (typeof DarkReader !== "undefined") {
        try {
          DarkReader.enable({
            brightness: this.settings.brightness,
            contrast: this.settings.contrast,
            sepia: this.settings.sepia,
            grayscale: this.settings.grayscale
          });
          console.log("[AI4A11y] Dark Mode enabled (DarkReader)");
        } catch (e) {
          console.log("[AI4A11y] DarkReader failed, using CSS fallback");
          this.enableCSSFallback();
        }
      } else {
        console.log("[AI4A11y] DarkReader not available, using CSS fallback");
        this.enableCSSFallback();
      }
      announce("Dark mode enabled");
    },
    enableCSSFallback() {
      if (document.getElementById(this.styleId))
        return;
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      html {
        filter: invert(90%) hue-rotate(180deg) !important;
        background: #111 !important;
      }
      img, video, picture, canvas, iframe, svg, [style*="background-image"] {
        filter: invert(100%) hue-rotate(180deg) !important;
      }
      img, video {
        filter: invert(100%) hue-rotate(180deg) contrast(1.1) !important;
      }
    `;
      document.head.appendChild(style);
    },
    disable() {
      var _a;
      if (typeof DarkReader !== "undefined") {
        try {
          DarkReader.disable();
        } catch (e) {
        }
      }
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      this.enabled = false;
      console.log("[AI4A11y] Dark Mode disabled");
      announce("Dark mode disabled");
    },
    toggle() {
      if (this.enabled) {
        this.disable();
      } else {
        this.enable();
      }
    },
    setTheme(options) {
      if (this.enabled) {
        this.settings = { ...this.settings, ...options };
        if (typeof DarkReader !== "undefined") {
          try {
            DarkReader.enable(this.settings);
          } catch (e) {
          }
        }
      }
    }
  };
  window.__ai4a11yDarkMode = DarkMode;

  // tools/adapters/motion-reducer.js
  var MotionReducer = {
    styleId: "ai4a11y-motion-reducer-styles",
    enabled: false,
    currentSettings: {
      stopAnimations: true,
      pauseVideos: true,
      stopGifs: true,
      disableParallax: true
    },
    enable(options = {}) {
      if (this.enabled)
        return;
      this.currentSettings = { ...this.currentSettings, ...options };
      this.enabled = true;
      const s = this.currentSettings;
      let css = "";
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
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
      if (s.pauseVideos)
        this.pauseAllVideos();
      if (s.stopGifs)
        this.stopGifs();
      const pauseAnimations = (deadline) => {
        const elements = document.querySelectorAll("*");
        let i = 0;
        const processChunk = () => {
          while (i < elements.length && (typeof deadline === "undefined" || deadline.timeRemaining() > 0)) {
            const el = elements[i];
            try {
              const style2 = getComputedStyle(el);
              if (style2.animationName !== "none") {
                el.style.animationPlayState = "paused";
              }
            } catch (e) {
            }
            i++;
          }
          if (i < elements.length) {
            requestIdleCallback ? requestIdleCallback(processChunk) : setTimeout(processChunk, 0);
          }
        };
        processChunk();
      };
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(pauseAnimations);
      } else {
        pauseAnimations();
      }
      console.log("[AI4A11y] Motion Reducer enabled");
      announce("Motion reduced");
    },
    disable() {
      var _a;
      if (!this.enabled)
        return;
      this.enabled = false;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      document.querySelectorAll("[data-ai4a11y-gif-src]").forEach((canvas) => {
        const img = document.createElement("img");
        img.src = canvas.dataset.ai4a11yGifSrc;
        img.alt = canvas.getAttribute("alt") || "";
        img.className = canvas.className;
        canvas.replaceWith(img);
      });
      document.querySelectorAll('[style*="animation-play-state"]').forEach((el) => {
        el.style.animationPlayState = "";
      });
      document.querySelectorAll('video[data-ai4a11y-was-paused="false"]').forEach((video) => {
        video.play().catch(() => {
        });
        delete video.dataset.ai4a11yWasPaused;
      });
      console.log("[AI4A11y] Motion Reducer disabled");
      announce("Motion restored");
    },
    pauseAllVideos() {
      document.querySelectorAll("video").forEach((video) => {
        if (!video.paused) {
          video.pause();
          video.dataset.ai4a11yWasPaused = "false";
        }
      });
      document.querySelectorAll("iframe").forEach((iframe) => {
        var _a, _b;
        const src = iframe.src || "";
        if (src.includes("youtube.com")) {
          (_a = iframe.contentWindow) == null ? void 0 : _a.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
        } else if (src.includes("vimeo.com")) {
          (_b = iframe.contentWindow) == null ? void 0 : _b.postMessage('{"method":"pause"}', "*");
        }
      });
    },
    stopGifs() {
      document.querySelectorAll('img[src$=".gif"], img[src*=".gif?"]').forEach((img) => {
        if (img.dataset.ai4a11yGifStopped)
          return;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 100;
        canvas.height = img.naturalHeight || img.height || 100;
        canvas.className = img.className;
        canvas.setAttribute("alt", img.alt || "");
        canvas.setAttribute("role", "img");
        canvas.dataset.ai4a11yGifSrc = img.src;
        const ctx = canvas.getContext("2d");
        const tempImg = new Image();
        tempImg.crossOrigin = "anonymous";
        tempImg.onload = () => {
          ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
          img.replaceWith(canvas);
          canvas.dataset.ai4a11yGifStopped = "true";
        };
        tempImg.onerror = () => {
          img.style.visibility = "visible";
          img.dataset.ai4a11yGifStopped = "true";
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

  // tools/adapters/focus-mode.js
  var FocusMode = {
    styleId: "ai4a11y-focus-mode-styles",
    enabled: false,
    progressEl: null,
    progressHandler: null,
    currentSettings: {
      hideDistractions: false,
      dimBackground: false,
      dimOpacity: 0.5,
      highlightColor: "#fff3cd",
      showProgress: true
    },
    distractionSelectors: [
      "ins.adsbygoogle",
      "[data-ad]",
      ".ad-container",
      ".ad-banner",
      '[id*="google_ads"]',
      '[class*="advert"]',
      ".social-buttons",
      ".share-buttons",
      ".social-share",
      '[class*="popup"]',
      '[class*="newsletter"]',
      '[class*="subscribe"]',
      '[class*="cookie-banner"]',
      '[class*="consent-banner"]',
      '[class*="gdpr-banner"]'
    ],
    enable(options = {}) {
      var _a;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      this.disableProgressIndicator();
      this.currentSettings = { ...this.currentSettings, ...options };
      this.enabled = true;
      const s = this.currentSettings;
      let css = "";
      if (s.hideDistractions) {
        css += `
        ${this.distractionSelectors.join(", ")} {
          opacity: ${s.dimOpacity} !important;
          transition: opacity 0.3s ease !important;
        }
        ${this.distractionSelectors.join(":hover, ")}:hover {
          opacity: 1 !important;
        }
      `;
      }
      if (s.dimBackground) {
        css += `
        body > *:not(main):not(article):not([role="main"]):not(#ai4a11y-focus-mode-styles):not(#ai4a11y-progress) {
          opacity: ${s.dimOpacity + 0.3} !important;
        }
        main, article, [role="main"], .article, .post, .content, .entry-content {
          opacity: 1 !important;
          position: relative;
          z-index: 10;
        }
      `;
      }
      css += `
      p:hover, li:hover, td:hover {
        background-color: ${s.highlightColor} !important;
        transition: background-color 0.2s ease !important;
      }
    `;
      if (s.showProgress) {
        this.enableProgressIndicator();
      }
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
      console.log("[AI4A11y] Focus Mode enabled", this.currentSettings);
      announce("Focus mode enabled");
    },
    disable() {
      var _a;
      this.enabled = false;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      this.disableProgressIndicator();
      console.log("[AI4A11y] Focus Mode disabled");
      announce("Focus mode disabled");
    },
    enableProgressIndicator() {
      this.disableProgressIndicator();
      this.progressEl = document.createElement("div");
      this.progressEl.id = "ai4a11y-progress";
      this.progressEl.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      height: 4px;
      background: linear-gradient(90deg, #4caf50, #8bc34a);
      z-index: 100000;
      transition: width 0.1s ease;
      width: 0%;
    `;
      document.body.appendChild(this.progressEl);
      this.progressRafPending = false;
      this.progressHandler = () => {
        if (this.progressRafPending)
          return;
        this.progressRafPending = true;
        requestAnimationFrame(() => {
          this.progressRafPending = false;
          const scrollTop = window.scrollY;
          const docHeight = document.documentElement.scrollHeight - window.innerHeight;
          const progress = docHeight > 0 ? scrollTop / docHeight * 100 : 0;
          if (this.progressEl) {
            this.progressEl.style.width = `${progress}%`;
          }
        });
      };
      document.addEventListener("scroll", this.progressHandler, { passive: true });
      this.progressHandler();
    },
    disableProgressIndicator() {
      if (this.progressEl) {
        this.progressEl.remove();
        this.progressEl = null;
      }
      if (this.progressHandler) {
        document.removeEventListener("scroll", this.progressHandler);
        this.progressHandler = null;
      }
    },
    toggle() {
      if (this.enabled) {
        this.disable();
      } else {
        this.enable();
      }
    }
  };
  window.__ai4a11yFocusMode = FocusMode;

  // tools/adapters/read-aloud.js
  var ReadAloud = {
    speaking: false,
    paused: false,
    utterance: null,
    currentWord: 0,
    words: [],
    settings: {
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
      highlightColor: "#ffeb3b"
    },
    getVoices() {
      return speechSynthesis.getVoices();
    },
    setVoice(voiceName) {
      const voices = this.getVoices();
      this.settings.voice = voices.find((v) => v.name === voiceName) || null;
    },
    setRate(rate) {
      this.settings.rate = Math.max(0.5, Math.min(2, rate));
    },
    speakSelection() {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      if (text) {
        this.speak(text);
      } else {
        announce("No text selected");
      }
    },
    speakPage(options = {}) {
      if (options.rate)
        this.settings.rate = options.rate;
      const main = document.querySelector('main, article, [role="main"], .content, #content');
      const target = main || document.body;
      const text = this.extractReadableText(target);
      if (text) {
        this.speak(text);
      }
    },
    extractReadableText(element) {
      var _a;
      const clone = element.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, aside, [aria-hidden="true"]').forEach((el) => el.remove());
      return ((_a = clone.textContent) == null ? void 0 : _a.replace(/\s+/g, " ").trim()) || "";
    },
    async speak(text) {
      this.stop();
      if (!text)
        return;
      this.speaking = true;
      this.paused = false;
      this.words = text.split(/\s+/);
      this.currentWord = 0;
      if (typeof EasySpeech !== "undefined") {
        try {
          await EasySpeech.init({ maxTimeout: 5e3 });
          await EasySpeech.speak({
            text,
            rate: this.settings.rate,
            pitch: this.settings.pitch,
            volume: this.settings.volume,
            voice: this.settings.voice,
            boundary: (event) => {
              if (event.name === "word" && this.words.length > 0 && text.length > 0) {
                const avgWordLength = text.length / this.words.length;
                if (avgWordLength > 0) {
                  this.currentWord = Math.min(
                    Math.floor(event.charIndex / avgWordLength),
                    this.words.length - 1
                  );
                }
              }
            },
            end: () => {
              this.speaking = false;
              announce("Finished reading");
            },
            error: (event) => {
              console.error("[AI4A11y] Speech error:", event);
              this.speaking = false;
            }
          });
          console.log("[AI4A11y] Read Aloud started (EasySpeech)");
          announce("Reading started");
          return;
        } catch (e) {
          console.warn("[AI4A11y] EasySpeech failed, falling back to native:", e);
        }
      }
      this.utterance = new SpeechSynthesisUtterance(text);
      this.utterance.rate = this.settings.rate;
      this.utterance.pitch = this.settings.pitch;
      this.utterance.volume = this.settings.volume;
      if (this.settings.voice) {
        this.utterance.voice = this.settings.voice;
      }
      this.utterance.onboundary = (event) => {
        if (event.name === "word" && this.words.length > 0 && text.length > 0) {
          const avgWordLength = text.length / this.words.length;
          if (avgWordLength > 0) {
            this.currentWord = Math.min(
              Math.floor(event.charIndex / avgWordLength),
              this.words.length - 1
            );
          }
        }
      };
      this.utterance.onend = () => {
        this.speaking = false;
        announce("Finished reading");
      };
      this.utterance.onerror = (event) => {
        console.error("[AI4A11y] Speech error:", event.error);
        this.speaking = false;
      };
      speechSynthesis.speak(this.utterance);
      console.log("[AI4A11y] Read Aloud started");
      announce("Reading started");
    },
    pause() {
      if (this.speaking && !this.paused) {
        speechSynthesis.pause();
        this.paused = true;
        announce("Reading paused");
      }
    },
    resume() {
      if (this.paused) {
        speechSynthesis.resume();
        this.paused = false;
        announce("Reading resumed");
      }
    },
    stop() {
      if (typeof EasySpeech !== "undefined" && EasySpeech.cancel) {
        try {
          EasySpeech.cancel();
        } catch (e) {
        }
      }
      speechSynthesis.cancel();
      this.speaking = false;
      this.paused = false;
    },
    toggle() {
      if (this.speaking) {
        if (this.paused) {
          this.resume();
        } else {
          this.pause();
        }
      } else {
        this.speakPage();
      }
    },
    presets: {
      slow: { rate: 0.7, pitch: 1 },
      normal: { rate: 1, pitch: 1 },
      fast: { rate: 1.5, pitch: 1 },
      veryFast: { rate: 2, pitch: 1 }
    },
    applyPreset(presetName) {
      if (this.presets[presetName]) {
        this.settings = { ...this.settings, ...this.presets[presetName] };
      }
    }
  };
  window.__ai4a11yReadAloud = ReadAloud;

  // tools/adapters/reader-mode.js
  var ReaderMode = {
    enabled: false,
    originalContent: null,
    readerOverlay: null,
    escapeHandler: null,
    settings: {
      fontSize: 18,
      lineHeight: 1.8,
      maxWidth: 700,
      fontFamily: "Georgia, serif",
      backgroundColor: "#fafafa",
      textColor: "#333"
    },
    enable(options = {}) {
      if (typeof Readability === "undefined") {
        console.warn("[AI4A11y] Readability library not loaded");
        announce("Reader mode not available");
        return;
      }
      this.settings = { ...this.settings, ...options };
      const docClone = document.cloneNode(true);
      const reader = new Readability(docClone);
      const article = reader.parse();
      if (!article) {
        announce("Could not extract article content");
        return;
      }
      this.originalContent = document.body.innerHTML;
      this.readerOverlay = document.createElement("div");
      this.readerOverlay.id = "ai4a11y-reader-mode";
      this.readerOverlay.setAttribute("role", "main");
      this.readerOverlay.setAttribute("aria-label", "Reader mode content");
      const container = document.createElement("div");
      container.className = "ai4a11y-reader-container";
      const closeBtn = document.createElement("button");
      closeBtn.className = "ai4a11y-reader-close";
      closeBtn.setAttribute("aria-label", "Exit reader mode");
      closeBtn.textContent = "\u2715 Exit Reader Mode";
      container.appendChild(closeBtn);
      const title = document.createElement("h1");
      title.className = "ai4a11y-reader-title";
      title.textContent = article.title || "Article";
      container.appendChild(title);
      if (article.byline) {
        const byline = document.createElement("p");
        byline.className = "ai4a11y-reader-byline";
        byline.textContent = article.byline;
        container.appendChild(byline);
      }
      const contentDiv = document.createElement("div");
      contentDiv.className = "ai4a11y-reader-content";
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = article.content || "";
      tempDiv.querySelectorAll("script, iframe, object, embed, form, input, svg, style, link, meta, base, noscript, template, math").forEach((el) => el.remove());
      const dangerousUrlAttrs = ["href", "src", "action", "formaction", "srcdoc", "poster", "xlink:href"];
      tempDiv.querySelectorAll("*").forEach((el) => {
        [...el.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = (attr.value || "").replace(/[\s\x00-\x1f]/g, "").toLowerCase();
          if (name.startsWith("on")) {
            el.removeAttribute(attr.name);
            return;
          }
          if (dangerousUrlAttrs.includes(name)) {
            if (value.startsWith("javascript:") || value.startsWith("vbscript:") || value.startsWith("data:text/html") || value.startsWith("data:application")) {
              el.removeAttribute(attr.name);
            }
          }
        });
      });
      contentDiv.innerHTML = tempDiv.innerHTML;
      container.appendChild(contentDiv);
      this.readerOverlay.appendChild(container);
      this.applyStyles();
      closeBtn.onclick = () => this.disable();
      document.body.style.overflow = "hidden";
      document.body.appendChild(this.readerOverlay);
      this.enabled = true;
      console.log("[AI4A11y] Reader Mode enabled");
      announce("Reader mode enabled. Press Escape to exit.");
      this.escapeHandler = (e) => {
        if (e.key === "Escape")
          this.disable();
      };
      document.addEventListener("keydown", this.escapeHandler);
    },
    applyStyles() {
      const s = this.settings;
      this.readerOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${s.backgroundColor};
      color: ${s.textColor};
      z-index: 999999;
      overflow-y: auto;
      font-family: ${s.fontFamily};
      font-size: ${s.fontSize}px;
      line-height: ${s.lineHeight};
    `;
      const container = this.readerOverlay.querySelector(".ai4a11y-reader-container");
      if (container) {
        container.style.cssText = `
        max-width: ${s.maxWidth}px;
        margin: 0 auto;
        padding: 40px 20px;
      `;
      }
      const title = this.readerOverlay.querySelector(".ai4a11y-reader-title");
      if (title) {
        title.style.cssText = "margin-bottom: 20px; font-size: 1.8em;";
      }
      const closeBtn = this.readerOverlay.querySelector(".ai4a11y-reader-close");
      if (closeBtn) {
        closeBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        z-index: 1000000;
      `;
      }
    },
    disable() {
      if (this.readerOverlay) {
        this.readerOverlay.remove();
        this.readerOverlay = null;
      }
      document.body.style.overflow = "";
      if (this.escapeHandler) {
        document.removeEventListener("keydown", this.escapeHandler);
      }
      this.enabled = false;
      console.log("[AI4A11y] Reader Mode disabled");
      announce("Reader mode disabled");
    },
    toggle() {
      if (this.enabled) {
        this.disable();
      } else {
        this.enable();
      }
    }
  };
  window.__ai4a11yReaderMode = ReaderMode;

  // tools/adapters/voice-commands.js
  var VoiceCommands = {
    enabled: false,
    recognition: null,
    feedbackElement: null,
    settings: {
      language: "en-US",
      continuous: true,
      interimResults: true
    },
    commands: {
      "scroll down": () => window.scrollBy(0, 300),
      "scroll up": () => window.scrollBy(0, -300),
      "page down": () => window.scrollBy(0, window.innerHeight),
      "page up": () => window.scrollBy(0, -window.innerHeight),
      "go to top": () => window.scrollTo(0, 0),
      "go to bottom": () => window.scrollTo(0, document.body.scrollHeight),
      "go back": () => history.back(),
      "go forward": () => history.forward(),
      "refresh": () => location.reload(),
      "click": () => {
        const focused = document.activeElement;
        if (focused && focused !== document.body) {
          focused.click();
        }
      },
      "next link": () => {
        const links = Array.from(document.querySelectorAll("a[href]"));
        const current = document.activeElement;
        const idx = links.indexOf(current);
        if (idx < links.length - 1)
          links[idx + 1].focus();
        else if (links.length > 0)
          links[0].focus();
      },
      "previous link": () => {
        const links = Array.from(document.querySelectorAll("a[href]"));
        const current = document.activeElement;
        const idx = links.indexOf(current);
        if (idx > 0)
          links[idx - 1].focus();
        else if (links.length > 0)
          links[links.length - 1].focus();
      },
      "next button": () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
        const current = document.activeElement;
        const idx = buttons.indexOf(current);
        if (idx < buttons.length - 1)
          buttons[idx + 1].focus();
        else if (buttons.length > 0)
          buttons[0].focus();
      },
      "read page": () => {
        var _a;
        return (_a = window.__ai4a11yReadAloud) == null ? void 0 : _a.speakPage();
      },
      "stop reading": () => {
        var _a;
        return (_a = window.__ai4a11yReadAloud) == null ? void 0 : _a.stop();
      }
    },
    enable(options = {}) {
      if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        announce("Voice recognition not supported in this browser");
        return;
      }
      this.settings = { ...this.settings, ...options };
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = this.settings.continuous;
      this.recognition.interimResults = this.settings.interimResults;
      this.recognition.lang = this.settings.language;
      this.recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const transcript = event.results[last][0].transcript.toLowerCase().trim();
        if (event.results[last].isFinal) {
          this.showFeedback(transcript, "recognized");
          this.executeCommand(transcript);
        } else {
          this.showFeedback(transcript, "interim");
        }
      };
      this.recognition.onerror = (event) => {
        if (event.error !== "no-speech") {
          this.showFeedback(`Error: ${event.error}`, "error");
        }
      };
      this.recognition.onend = () => {
        if (this.enabled)
          this.recognition.start();
      };
      this.createFeedbackElement();
      this.recognition.start();
      this.enabled = true;
      console.log("[AI4A11y] Voice Commands enabled");
      announce('Voice commands enabled. Say "stop listening" to disable.');
    },
    disable() {
      var _a;
      if (this.recognition) {
        this.enabled = false;
        this.recognition.onend = null;
        this.recognition.stop();
        this.recognition = null;
      }
      if (this.feedbackElement) {
        this.feedbackElement.remove();
        this.feedbackElement = null;
      }
      (_a = document.getElementById("ai4a11y-voice-pulse-style")) == null ? void 0 : _a.remove();
      console.log("[AI4A11y] Voice Commands disabled");
      announce("Voice commands disabled");
    },
    createFeedbackElement() {
      var _a;
      if (this.feedbackElement)
        return;
      this.feedbackElement = document.createElement("div");
      this.feedbackElement.id = "ai4a11y-voice-feedback";
      this.feedbackElement.setAttribute("role", "status");
      this.feedbackElement.setAttribute("aria-live", "polite");
      this.feedbackElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
      const indicator = document.createElement("span");
      indicator.style.cssText = "display:inline-block;width:12px;height:12px;background:#f00;border-radius:50%;animation:ai4a11y-pulse 1s infinite;";
      this.feedbackElement.appendChild(indicator);
      const textSpan = document.createElement("span");
      textSpan.className = "ai4a11y-voice-text";
      textSpan.textContent = "Listening...";
      this.feedbackElement.appendChild(textSpan);
      const pulseStyle = document.createElement("style");
      pulseStyle.id = "ai4a11y-voice-pulse-style";
      pulseStyle.textContent = "@keyframes ai4a11y-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }";
      (_a = document.getElementById("ai4a11y-voice-pulse-style")) == null ? void 0 : _a.remove();
      document.head.appendChild(pulseStyle);
      document.body.appendChild(this.feedbackElement);
    },
    showFeedback(text, type) {
      if (!this.feedbackElement)
        return;
      const textEl = this.feedbackElement.querySelector(".ai4a11y-voice-text");
      if (textEl) {
        textEl.textContent = text;
        textEl.style.color = type === "error" ? "#ff6b6b" : type === "interim" ? "#aaa" : "#fff";
      }
    },
    executeCommand(transcript) {
      if (transcript.includes("stop listening")) {
        this.disable();
        return true;
      }
      for (const [phrase, action] of Object.entries(this.commands)) {
        if (transcript.includes(phrase)) {
          action();
          return true;
        }
      }
      const clickMatch = transcript.match(/click (?:on )?(.+)/);
      if (clickMatch) {
        const el = this.findElementByText(clickMatch[1]);
        if (el) {
          el.click();
          el.focus();
          return true;
        }
      }
      const typeMatch = transcript.match(/type (.+)/);
      if (typeMatch && document.activeElement.matches("input, textarea")) {
        document.activeElement.value += typeMatch[1];
        document.activeElement.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      return false;
    },
    findElementByText(text) {
      const elements = document.querySelectorAll('a, button, [role="button"], input[type="submit"]');
      for (const el of elements) {
        const elText = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase();
        if (elText.includes(text.toLowerCase()))
          return el;
      }
      return null;
    },
    addCommand(phrase, action) {
      this.commands[phrase.toLowerCase()] = action;
    },
    toggle() {
      if (this.enabled)
        this.disable();
      else
        this.enable();
    }
  };
  window.__ai4a11yVoiceCommands = VoiceCommands;

  // tools/adapters/keyboard-nav.js
  var KeyboardNavigator = {
    enabled: false,
    styleId: "ai4a11y-keyboard-nav-styles",
    skipLinkElement: null,
    tabSequenceOverlay: false,
    shortcutHandler: null,
    modifiedElements: [],
    settings: {
      showSkipLinks: true,
      enhanceFocusVisible: true,
      showTabSequence: false
    },
    enable(options = {}) {
      this.settings = { ...this.settings, ...options };
      this.enabled = true;
      this.injectStyles();
      if (this.settings.showSkipLinks)
        this.createSkipLinks();
      if (this.settings.showTabSequence)
        this.showTabSequence();
      this.setupKeyboardShortcuts();
      console.log("[AI4A11y] Keyboard Navigator enabled");
      announce("Keyboard navigation enhanced");
    },
    disable() {
      var _a, _b;
      this.enabled = false;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      (_b = this.skipLinkElement) == null ? void 0 : _b.remove();
      this.skipLinkElement = null;
      this.hideTabSequence();
      if (this.shortcutHandler) {
        document.removeEventListener("keydown", this.shortcutHandler);
        this.shortcutHandler = null;
      }
      this.modifiedElements.forEach((el) => {
        el.removeAttribute("tabindex");
        if (el.id === "ai4a11y-main-content")
          el.removeAttribute("id");
        if (el.id === "ai4a11y-nav")
          el.removeAttribute("id");
      });
      this.modifiedElements = [];
      console.log("[AI4A11y] Keyboard Navigator disabled");
      announce("Keyboard navigation restored");
    },
    injectStyles() {
      var _a;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      const css = `
      ${this.settings.enhanceFocusVisible ? `
        *:focus-visible {
          outline: 3px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.25) !important;
        }
      ` : ""}
      .ai4a11y-skip-link {
        position: fixed;
        top: -100px;
        left: 10px;
        background: #000;
        color: #fff;
        padding: 12px 24px;
        text-decoration: none;
        font-family: system-ui, sans-serif;
        font-size: 16px;
        font-weight: 600;
        z-index: 999999;
        border-radius: 4px;
        transition: top 0.2s;
      }
      .ai4a11y-skip-link:focus {
        top: 10px;
        outline: 3px solid #fff;
        outline-offset: 2px;
      }
      .ai4a11y-tab-badge {
        position: absolute;
        background: #0066ff;
        color: white;
        font-size: 12px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 10px;
        z-index: 999998;
        pointer-events: none;
        font-family: system-ui, sans-serif;
      }
    `;
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
    },
    createSkipLinks() {
      if (this.skipLinkElement)
        return;
      const container = document.createElement("div");
      container.id = "ai4a11y-skip-links";
      const main = document.querySelector('main, [role="main"], #main, #content, article');
      if (main) {
        if (!main.id)
          main.id = "ai4a11y-main-content";
        const skipToMain = document.createElement("a");
        skipToMain.href = "#" + main.id;
        skipToMain.className = "ai4a11y-skip-link";
        skipToMain.textContent = "Skip to main content";
        skipToMain.addEventListener("click", (e) => {
          e.preventDefault();
          main.setAttribute("tabindex", "-1");
          if (!this.modifiedElements.includes(main))
            this.modifiedElements.push(main);
          main.focus();
          main.scrollIntoView({ behavior: "smooth" });
        });
        container.appendChild(skipToMain);
      }
      const nav = document.querySelector('nav, [role="navigation"]');
      if (nav) {
        if (!nav.id)
          nav.id = "ai4a11y-nav";
        const skipToNav = document.createElement("a");
        skipToNav.href = "#" + nav.id;
        skipToNav.className = "ai4a11y-skip-link";
        skipToNav.textContent = "Skip to navigation";
        skipToNav.style.left = "200px";
        skipToNav.addEventListener("click", (e) => {
          e.preventDefault();
          nav.setAttribute("tabindex", "-1");
          if (!this.modifiedElements.includes(nav))
            this.modifiedElements.push(nav);
          nav.focus();
        });
        container.appendChild(skipToNav);
      }
      this.skipLinkElement = container;
      document.body.insertBefore(container, document.body.firstChild);
    },
    showTabSequence() {
      this.hideTabSequence();
      const focusables = Array.from(document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
      });
      focusables.forEach((el, idx) => {
        const rect = el.getBoundingClientRect();
        const badge = document.createElement("span");
        badge.className = "ai4a11y-tab-badge";
        badge.textContent = String(idx + 1);
        badge.style.top = rect.top + window.scrollY - 10 + "px";
        badge.style.left = rect.left + window.scrollX - 10 + "px";
        document.body.appendChild(badge);
      });
      this.tabSequenceOverlay = true;
    },
    hideTabSequence() {
      document.querySelectorAll(".ai4a11y-tab-badge").forEach((el) => el.remove());
      this.tabSequenceOverlay = false;
    },
    setupKeyboardShortcuts() {
      this.shortcutHandler = (e) => {
        if (e.altKey && e.key === "1") {
          e.preventDefault();
          const main = document.querySelector('main, [role="main"], #main, #content');
          if (main) {
            main.setAttribute("tabindex", "-1");
            main.focus();
          }
        }
        if (e.altKey && e.key === "2") {
          e.preventDefault();
          const nav = document.querySelector('nav, [role="navigation"]');
          if (nav) {
            nav.setAttribute("tabindex", "-1");
            nav.focus();
          }
        }
        if (e.altKey && e.key === "h") {
          e.preventDefault();
          const h = document.querySelector("h1, h2, h3");
          if (h) {
            h.setAttribute("tabindex", "-1");
            h.focus();
            h.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
        if (e.altKey && e.key === "f") {
          e.preventDefault();
          if (this.tabSequenceOverlay)
            this.hideTabSequence();
          else
            this.showTabSequence();
        }
      };
      document.addEventListener("keydown", this.shortcutHandler);
    },
    toggle() {
      if (this.enabled)
        this.disable();
      else
        this.enable();
    }
  };
  window.__ai4a11yKeyboardNavigator = KeyboardNavigator;

  // tools/adapters/color-blind.js
  var ColorBlindMode = {
    styleId: "ai4a11y-color-blind-styles",
    filterId: "ai4a11y-svg-filters",
    enabled: false,
    currentMode: "none",
    filters: {
      protanopia: "url(#ai4a11y-protanopia-filter)",
      deuteranopia: "url(#ai4a11y-deuteranopia-filter)",
      tritanopia: "url(#ai4a11y-tritanopia-filter)"
    },
    enable(mode = "protanopia") {
      var _a;
      if (!this.filters[mode]) {
        console.warn("[AI4A11y] Invalid color blind mode:", mode);
        return;
      }
      this.currentMode = mode;
      this.enabled = true;
      this.injectSvgFilters();
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      html {
        filter: ${this.filters[mode]} !important;
      }
    `;
      document.head.appendChild(style);
      console.log("[AI4A11y] Color Blind Mode enabled:", mode);
      announce(`Color blind correction applied: ${mode}`);
    },
    disable() {
      var _a, _b;
      this.enabled = false;
      this.currentMode = "none";
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      (_b = document.getElementById(this.filterId)) == null ? void 0 : _b.remove();
      console.log("[AI4A11y] Color Blind Mode disabled");
      announce("Color blind correction removed");
    },
    injectSvgFilters() {
      if (document.getElementById(this.filterId))
        return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = this.filterId;
      svg.setAttribute("style", "position:absolute;width:0;height:0");
      svg.innerHTML = `
      <defs>
        <filter id="ai4a11y-protanopia-filter">
          <feColorMatrix type="matrix" values="
            0.567, 0.433, 0.000, 0, 0
            0.558, 0.442, 0.000, 0, 0
            0.000, 0.242, 0.758, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
        <filter id="ai4a11y-deuteranopia-filter">
          <feColorMatrix type="matrix" values="
            0.625, 0.375, 0.000, 0, 0
            0.700, 0.300, 0.000, 0, 0
            0.000, 0.300, 0.700, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
        <filter id="ai4a11y-tritanopia-filter">
          <feColorMatrix type="matrix" values="
            0.950, 0.050, 0.000, 0, 0
            0.000, 0.433, 0.567, 0, 0
            0.000, 0.475, 0.525, 0, 0
            0, 0, 0, 1, 0
          "/>
        </filter>
      </defs>
    `;
      document.body.appendChild(svg);
    },
    setMode(mode) {
      if (mode === "none") {
        this.disable();
      } else {
        this.enable(mode);
      }
    },
    toggle() {
      if (this.enabled) {
        this.disable();
      } else {
        this.enable();
      }
    }
  };
  window.__ai4a11yColorBlindMode = ColorBlindMode;

  // tools/adapters/auto-transcriber.js
  var AutoTranscriber = {
    enabled: false,
    observer: null,
    videoStates: /* @__PURE__ */ new Map(),
    styleId: "ai4a11y-caption-helper-styles",
    enable() {
      if (this.enabled)
        return;
      this.enabled = true;
      this.injectStyles();
      this.setupVideoObserver();
      this.enableCaptionsOnAllVideos();
      setTimeout(() => this.enableCaptionsOnAllVideos(), 1e3);
      console.log("[AI4A11y] Auto Transcriber enabled");
      announce("Auto Transcriber enabled");
    },
    disable() {
      var _a, _b;
      if (!this.enabled)
        return;
      this.enabled = false;
      (_a = this.observer) == null ? void 0 : _a.disconnect();
      this.observer = null;
      document.querySelectorAll(".ai4a11y-audio-btn, .ai4a11y-caption-box").forEach((el) => el.remove());
      (_b = document.getElementById(this.styleId)) == null ? void 0 : _b.remove();
      this.videoStates.clear();
      console.log("[AI4A11y] Auto Transcriber disabled");
      announce("Auto Transcriber disabled");
    },
    injectStyles() {
      if (document.getElementById(this.styleId))
        return;
      const style = document.createElement("style");
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
        var _a, _b, _c, _d, _e;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === "VIDEO")
                this.setupVideo(node);
              if (node.tagName === "IFRAME" && ((_a = node.src) == null ? void 0 : _a.includes("youtube"))) {
                this.enableYouTubeCaptions(node);
              }
              (_c = (_b = node.querySelectorAll) == null ? void 0 : _b.call(node, "video")) == null ? void 0 : _c.forEach((v) => this.setupVideo(v));
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === "VIDEO")
                this.cleanupVideo(node);
              (_e = (_d = node.querySelectorAll) == null ? void 0 : _d.call(node, "video")) == null ? void 0 : _e.forEach((v) => this.cleanupVideo(v));
            }
          }
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("pagehide", () => this.disable(), { once: true });
    },
    cleanupVideo(video) {
      var _a, _b;
      const state = this.videoStates.get(video);
      if (state) {
        (_a = state.btn) == null ? void 0 : _a.remove();
        (_b = state.captionBox) == null ? void 0 : _b.remove();
        this.videoStates.delete(video);
      }
    },
    enableCaptionsOnAllVideos() {
      document.querySelectorAll("video").forEach((v) => this.setupVideo(v));
      document.querySelectorAll('iframe[src*="youtube"]').forEach((f) => this.enableYouTubeCaptions(f));
      if (location.hostname.includes("youtube.com"))
        this.enableYouTubePageCaptions();
    },
    setupVideo(video) {
      if (video.dataset.ai4a11ySetup)
        return;
      video.dataset.ai4a11ySetup = "true";
      const rect = video.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 75)
        return;
      let wrapper = video.parentElement;
      if (getComputedStyle(wrapper).position === "static") {
        wrapper.style.position = "relative";
      }
      const btn = document.createElement("button");
      btn.className = "ai4a11y-audio-btn";
      btn.textContent = "CC";
      btn.title = "Auto transcribe";
      btn.onclick = () => this.toggleTranscription(video, btn);
      wrapper.appendChild(btn);
      const captionBox = document.createElement("div");
      captionBox.className = "ai4a11y-caption-box";
      captionBox.style.display = "none";
      wrapper.appendChild(captionBox);
      this.videoStates.set(video, { btn, captionBox, isTranscribing: false });
    },
    async toggleTranscription(video, btn) {
      const state = this.videoStates.get(video);
      if (!state)
        return;
      if (state.isTranscribing) {
        state.isTranscribing = false;
        btn.classList.remove("recording");
        btn.textContent = "CC";
        state.captionBox.style.display = "none";
      } else {
        state.isTranscribing = true;
        btn.classList.add("recording");
        btn.textContent = "\u23FA CC";
        state.captionBox.style.display = "block";
        state.captionBox.textContent = "Transcribing...";
        await this.transcribeVideo(video, state);
      }
    },
    async transcribeVideo(video, state) {
      var _a, _b;
      try {
        const ytMatch = ((_a = video.closest("[data-video-id]")) == null ? void 0 : _a.dataset.videoId) || ((_b = window.location.href.match(/[?&]v=([^&]+)/)) == null ? void 0 : _b[1]);
        if (ytMatch) {
          const transcript = await getYouTubeTranscript(ytMatch);
          if (transcript) {
            state.captionBox.textContent = transcript;
            return;
          }
        }
        state.captionBox.textContent = "Live transcription requires API key";
      } catch (e) {
        console.error("[AI4A11y] Transcription error:", e);
        state.captionBox.textContent = "Transcription failed";
      }
    },
    enableYouTubeCaptions(iframe) {
      if (iframe.dataset.ai4a11yCaptionsEnabled)
        return;
      iframe.dataset.ai4a11yCaptionsEnabled = "true";
      const src = iframe.src;
      if (!src.includes("cc_load_policy=1")) {
        const sep = src.includes("?") ? "&" : "?";
        iframe.src = src + sep + "cc_load_policy=1&cc_lang_pref=en";
      }
    },
    enableYouTubePageCaptions() {
      const btn = document.querySelector(".ytp-subtitles-button");
      if (btn && btn.getAttribute("aria-pressed") !== "true") {
        btn.click();
      }
    },
    toggle() {
      if (this.enabled)
        this.disable();
      else
        this.enable();
    }
  };
  window.__ai4a11yAutoTranscriber = AutoTranscriber;

  // tools/utils/image.js
  async function imageToDataUrl(img) {
    var _a, _b;
    if (((_a = img.src) == null ? void 0 : _a.startsWith("data:")) || ((_b = img.src) == null ? void 0 : _b.startsWith("blob:"))) {
      return img.src;
    }
    try {
      const response = await fetch(img.src);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return imageToCanvas(img);
    }
  }
  function imageToCanvas(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    try {
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (e) {
      console.warn("[AI4A11y] Canvas tainted, cannot export:", e);
      return null;
    }
  }
  function getImageSize(img) {
    return {
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0
    };
  }
  function isLikelyDecorative(img) {
    const { width, height } = getImageSize(img);
    if (width < 20 && height < 20)
      return true;
    if (width === 1 && height === 1)
      return true;
    if (img.getAttribute("role") === "presentation")
      return true;
    if (img.getAttribute("role") === "none")
      return true;
    return false;
  }

  // tools/utils/dom.js
  function isVisible(el) {
    if (!el)
      return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden")
      return false;
    if (parseFloat(style.opacity) === 0)
      return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function hasAccessibleName(el) {
    var _a, _b;
    if (el.getAttribute("aria-label"))
      return true;
    if (el.getAttribute("title"))
      return true;
    if ((_a = el.textContent) == null ? void 0 : _a.trim())
      return true;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const target = document.getElementById(labelledBy);
      if ((_b = target == null ? void 0 : target.textContent) == null ? void 0 : _b.trim())
        return true;
    }
    return false;
  }
  function markProcessed(el, status = "done") {
    el.dataset.ai4a11yProcessed = status;
  }
  function wasProcessed(el) {
    return !!el.dataset.ai4a11yProcessed;
  }

  // tools/adapters/generate-alt.js
  var logFix = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function generateImageAlt(img) {
    if (img.dataset.ai4a11yProcessed)
      return null;
    markProcessed(img, "pending");
    try {
      const dataUrl = await imageToDataUrl(img);
      if (!dataUrl) {
        markProcessed(img, "failed");
        return null;
      }
      const result = await describeImage(dataUrl);
      if (result) {
        const altText = result;
        img.setAttribute("alt", altText);
        markProcessed(img, "done");
        incrementStat("images");
        logFix("alt text", img, "(empty)", altText);
        console.log("[AI4A11y] Generated alt:", altText);
        return altText;
      }
      markProcessed(img, "failed");
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to generate alt:", e);
      markProcessed(img, "failed");
      return null;
    }
  }
  async function generateSvgDescription(svg) {
    if (svg.dataset.ai4a11yProcessed)
      return null;
    markProcessed(svg, "pending");
    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
      const description = await describeImage(dataUrl);
      if (description) {
        let title = svg.querySelector("title");
        if (!title) {
          title = document.createElementNS("http://www.w3.org/2000/svg", "title");
          svg.insertBefore(title, svg.firstChild);
        }
        title.textContent = description;
        svg.setAttribute("role", "img");
        markProcessed(svg, "done");
        incrementStat("images");
        logFix("svg description", svg, "(none)", description);
        return description;
      }
      markProcessed(svg, "failed");
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to describe SVG:", e);
      markProcessed(svg, "failed");
      return null;
    }
  }
  var axeHandlers = {
    "image-alt": generateImageAlt,
    "svg-img-alt": generateSvgDescription
  };

  // tools/constants.js
  var ARIA_REQUIRED_ATTRS = {
    checkbox: { "aria-checked": "false" },
    combobox: { "aria-expanded": "false" },
    heading: { "aria-level": "2" },
    listbox: {},
    meter: { "aria-valuenow": "0" },
    option: { "aria-selected": "false" },
    progressbar: {},
    radio: { "aria-checked": "false" },
    scrollbar: { "aria-controls": "", "aria-valuenow": "0" },
    separator: { "aria-valuenow": "0" },
    slider: { "aria-valuenow": "0" },
    spinbutton: {},
    switch: { "aria-checked": "false" },
    tab: { "aria-selected": "false" },
    tabpanel: {},
    tree: {},
    treeitem: {}
  };
  var DEPRECATED_ROLES = {
    directory: "list"
  };
  var VALID_LANGS = /* @__PURE__ */ new Set([
    "en",
    "es",
    "fr",
    "de",
    "it",
    "pt",
    "nl",
    "ru",
    "zh",
    "ja",
    "ko",
    "ar",
    "hi",
    "bn",
    "pa",
    "te",
    "mr",
    "ta",
    "ur",
    "gu",
    "kn",
    "ml",
    "th",
    "vi",
    "id",
    "ms",
    "tl",
    "pl",
    "uk",
    "ro",
    "el",
    "cs",
    "hu",
    "sv",
    "da",
    "fi",
    "no",
    "he",
    "tr"
  ]);
  var VALID_ARIA_ATTRS = /* @__PURE__ */ new Set([
    "aria-activedescendant",
    "aria-atomic",
    "aria-autocomplete",
    "aria-braillelabel",
    "aria-brailleroledescription",
    "aria-busy",
    "aria-checked",
    "aria-colcount",
    "aria-colindex",
    "aria-colindextext",
    "aria-colspan",
    "aria-controls",
    "aria-current",
    "aria-describedby",
    "aria-description",
    "aria-details",
    "aria-disabled",
    "aria-dropeffect",
    "aria-errormessage",
    "aria-expanded",
    "aria-flowto",
    "aria-grabbed",
    "aria-haspopup",
    "aria-hidden",
    "aria-invalid",
    "aria-keyshortcuts",
    "aria-label",
    "aria-labelledby",
    "aria-level",
    "aria-live",
    "aria-modal",
    "aria-multiline",
    "aria-multiselectable",
    "aria-orientation",
    "aria-owns",
    "aria-placeholder",
    "aria-posinset",
    "aria-pressed",
    "aria-readonly",
    "aria-relevant",
    "aria-required",
    "aria-roledescription",
    "aria-rowcount",
    "aria-rowindex",
    "aria-rowindextext",
    "aria-rowspan",
    "aria-selected",
    "aria-setsize",
    "aria-sort",
    "aria-valuemax",
    "aria-valuemin",
    "aria-valuenow",
    "aria-valuetext"
  ]);
  var VALID_ARIA_ROLES = /* @__PURE__ */ new Set([
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "command",
    "comment",
    "complementary",
    "composite",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "input",
    "insertion",
    "landmark",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "mark",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "range",
    "region",
    "roletype",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "section",
    "sectionhead",
    "select",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "structure",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem",
    "widget",
    "window"
  ]);
  var IFRAME_PATTERNS = {
    "youtube.com": "YouTube video",
    "vimeo.com": "Vimeo video",
    "maps.google": "Google Maps",
    "google.com/maps": "Google Maps",
    "twitter.com": "Twitter embed",
    "x.com": "Twitter embed",
    "facebook.com": "Facebook embed",
    "instagram.com": "Instagram embed",
    "spotify.com": "Spotify player",
    "soundcloud.com": "SoundCloud player",
    "codepen.io": "CodePen demo",
    "jsfiddle.net": "JSFiddle demo",
    "codesandbox.io": "CodeSandbox",
    "calendly.com": "Calendly scheduler",
    "typeform.com": "Form",
    "stripe.com": "Payment form",
    "recaptcha": "CAPTCHA verification"
  };

  // tools/adapters/generate-labels.js
  var logFix2 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat2 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function generateLinkLabel(link) {
    var _a;
    if (link.dataset.ai4a11yProcessed)
      return null;
    markProcessed(link, "pending");
    const href = link.href || "";
    const existingText = ((_a = link.textContent) == null ? void 0 : _a.trim()) || "";
    const context = getContextForElement(link);
    const label = await inferLabel({
      url: href,
      elementType: "link",
      existingText,
      context
    });
    if (label) {
      link.setAttribute("aria-label", label);
      markProcessed(link, "done");
      incrementStat2("labels");
      logFix2("link label", link, existingText || "(empty)", label);
      console.log("[AI4A11y] Generated link label:", label);
      return label;
    }
    markProcessed(link, "failed");
    return null;
  }
  async function generateButtonLabel(button) {
    var _a;
    if (button.dataset.ai4a11yProcessed)
      return null;
    markProcessed(button, "pending");
    const inferred = inferButtonLabel(button);
    if (inferred) {
      button.setAttribute("aria-label", inferred);
      markProcessed(button, "done");
      incrementStat2("labels");
      logFix2("button label", button, "(empty)", inferred);
      return inferred;
    }
    const context = getContextForElement(button);
    const svgContent = ((_a = button.querySelector("svg")) == null ? void 0 : _a.outerHTML) || "";
    const label = await inferLabel({
      elementType: "button",
      context,
      svgContent
    });
    if (label) {
      button.setAttribute("aria-label", label);
      markProcessed(button, "done");
      incrementStat2("labels");
      logFix2("button label", button, "(empty)", label);
      return label;
    }
    markProcessed(button, "failed");
    return null;
  }
  async function generateIframeTitle(iframe) {
    if (iframe.dataset.ai4a11yProcessed)
      return null;
    markProcessed(iframe, "pending");
    const src = iframe.src || "";
    for (const [pattern, title] of Object.entries(IFRAME_PATTERNS)) {
      if (src.includes(pattern)) {
        iframe.setAttribute("title", title);
        markProcessed(iframe, "done");
        incrementStat2("labels");
        logFix2("iframe title", iframe, "(empty)", title);
        return title;
      }
    }
    try {
      const url = new URL(src);
      const title = `Embedded content from ${url.hostname}`;
      iframe.setAttribute("title", title);
      markProcessed(iframe, "done");
      incrementStat2("labels");
      logFix2("iframe title", iframe, "(empty)", title);
      return title;
    } catch {
      const title = "Embedded content";
      iframe.setAttribute("title", title);
      markProcessed(iframe, "done");
      return title;
    }
  }
  async function generateFormLabel(input) {
    if (input.dataset.ai4a11yProcessed)
      return null;
    markProcessed(input, "pending");
    if (input.placeholder) {
      input.setAttribute("aria-label", input.placeholder);
      markProcessed(input, "done");
      incrementStat2("labels");
      logFix2("form label", input, "(empty)", input.placeholder);
      return input.placeholder;
    }
    if (input.name) {
      const label = input.name.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      input.setAttribute("aria-label", label);
      markProcessed(input, "done");
      incrementStat2("labels");
      logFix2("form label", input, "(empty)", label);
      return label;
    }
    const nearbyText = getNearbyText(input);
    if (nearbyText) {
      input.setAttribute("aria-label", nearbyText);
      markProcessed(input, "done");
      incrementStat2("labels");
      logFix2("form label", input, "(empty)", nearbyText);
      return nearbyText;
    }
    markProcessed(input, "skipped");
    return null;
  }
  function inferButtonLabel(button) {
    var _a, _b;
    const className = ((_a = button.className) == null ? void 0 : _a.toLowerCase()) || "";
    const svgPaths = ((_b = button.querySelector("svg path")) == null ? void 0 : _b.getAttribute("d")) || "";
    const patterns = {
      close: ["close", "dismiss", "x-btn", "btn-close"],
      menu: ["menu", "hamburger", "nav-toggle"],
      search: ["search", "find"],
      submit: ["submit", "send"],
      play: ["play"],
      pause: ["pause"],
      next: ["next", "forward", "arrow-right"],
      previous: ["prev", "back", "arrow-left"],
      expand: ["expand", "more", "dropdown"],
      collapse: ["collapse", "less"],
      settings: ["settings", "config", "gear", "cog"],
      delete: ["delete", "remove", "trash"],
      edit: ["edit", "pencil"],
      share: ["share"],
      like: ["like", "heart", "favorite"],
      copy: ["copy", "clipboard"]
    };
    for (const [label, keywords] of Object.entries(patterns)) {
      if (keywords.some((kw) => className.includes(kw))) {
        return label.charAt(0).toUpperCase() + label.slice(1);
      }
    }
    return null;
  }
  function getContextForElement(el) {
    var _a;
    const parent = el.parentElement;
    if (!parent)
      return "";
    const clone = parent.cloneNode(true);
    clone.querySelectorAll("script, style").forEach((s) => s.remove());
    return ((_a = clone.textContent) == null ? void 0 : _a.trim().substring(0, 200)) || "";
  }
  function getNearbyText(input) {
    var _a, _b, _c;
    const prev = input.previousElementSibling;
    const next = input.nextElementSibling;
    const parent = input.parentElement;
    if ((_a = prev == null ? void 0 : prev.textContent) == null ? void 0 : _a.trim()) {
      return prev.textContent.trim().replace(/:$/, "");
    }
    if ((_b = next == null ? void 0 : next.textContent) == null ? void 0 : _b.trim()) {
      return next.textContent.trim().replace(/:$/, "");
    }
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((e) => e.remove());
      const text = (_c = clone.textContent) == null ? void 0 : _c.trim();
      if (text && text.length < 50)
        return text.replace(/:$/, "");
    }
    return null;
  }
  var axeHandlers2 = {
    "link-name": generateLinkLabel,
    "button-name": generateButtonLabel,
    "frame-title": generateIframeTitle,
    "label": generateFormLabel,
    "select-name": generateFormLabel
  };

  // tools/adapters/generate-captions.js
  var logFix3 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat3 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function generateVideoCaptions(video) {
    var _a;
    if (video.dataset.ai4a11yCaptioned)
      return null;
    video.dataset.ai4a11yCaptioned = "pending";
    const src = video.src || ((_a = video.querySelector("source")) == null ? void 0 : _a.src);
    if (!src) {
      video.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
    try {
      const result = await transcribeVideo(src);
      if (result == null ? void 0 : result.text) {
        const text = result.text;
        addCaptionTrack(video, text);
        video.dataset.ai4a11yCaptioned = "done";
        incrementStat3("wcag");
        logFix3("captions", video, "(none)", "(generated)");
        console.log("[AI4A11y] Added video captions");
        return text;
      }
      video.dataset.ai4a11yCaptioned = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to caption video:", e);
      video.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
  }
  async function generateAudioCaptions(audio) {
    var _a;
    if (audio.dataset.ai4a11yCaptioned)
      return null;
    audio.dataset.ai4a11yCaptioned = "pending";
    const src = audio.src || ((_a = audio.querySelector("source")) == null ? void 0 : _a.src);
    if (!src) {
      audio.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
    try {
      const result = await transcribeAudio(src);
      if (result == null ? void 0 : result.text) {
        const text = result.text;
        addTranscriptBlock(audio, text);
        audio.dataset.ai4a11yCaptioned = "done";
        incrementStat3("wcag");
        logFix3("transcript", audio, "(none)", "(generated)");
        console.log("[AI4A11y] Added audio transcript");
        return text;
      }
      audio.dataset.ai4a11yCaptioned = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to transcribe audio:", e);
      audio.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
  }
  function addCaptionTrack(video, text) {
    const track = document.createElement("track");
    track.kind = "captions";
    track.label = "Auto-generated";
    track.srclang = "en";
    track.default = true;
    const vtt = createSimpleVTT(text);
    track.src = "data:text/vtt;charset=utf-8," + encodeURIComponent(vtt);
    video.appendChild(track);
  }
  function addTranscriptBlock(audio, text) {
    var _a;
    const container = document.createElement("details");
    container.className = "ai4a11y-transcript";
    const summary = document.createElement("summary");
    summary.textContent = "Transcript";
    container.appendChild(summary);
    const content = document.createElement("div");
    content.className = "ai4a11y-transcript-content";
    content.textContent = text;
    container.appendChild(content);
    (_a = audio.parentElement) == null ? void 0 : _a.insertBefore(container, audio.nextSibling);
  }
  function createSimpleVTT(text) {
    const words = text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; i += 10) {
      chunks.push(words.slice(i, i + 10).join(" "));
    }
    let vtt = "WEBVTT\n\n";
    const secondsPerChunk = 5;
    chunks.forEach((chunk, index) => {
      const start = formatTime(index * secondsPerChunk);
      const end = formatTime((index + 1) * secondsPerChunk);
      vtt += `${start} --> ${end}
${chunk}

`;
    });
    return vtt;
  }
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.000`;
  }
  var axeHandlers3 = {
    "video-caption": generateVideoCaptions,
    "audio-caption": generateAudioCaptions
  };

  // tools/adapters/simplify-text.js
  var logFix4 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat4 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function simplifyText2(element) {
    var _a;
    if (element.dataset.ai4a11ySimplified)
      return null;
    element.dataset.ai4a11ySimplified = "pending";
    if (element.tagName === "TABLE" || element.querySelector("table")) {
      element.dataset.ai4a11ySimplified = "skipped";
      return null;
    }
    const originalText = (_a = element.textContent) == null ? void 0 : _a.trim();
    if (!originalText || originalText.length < 100 || originalText.length > 1e4) {
      element.dataset.ai4a11ySimplified = "skipped";
      return null;
    }
    try {
      const simplified = await simplifyText(originalText);
      if (simplified) {
        element.dataset.ai4a11yOriginal = originalText;
        element.classList.add("ai4a11y-simplified");
        const textContainer = document.createElement("span");
        textContainer.className = "ai4a11y-text-content";
        textContainer.textContent = simplified;
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "ai4a11y-toggle-original";
        toggleBtn.textContent = "Show original";
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.onclick = () => {
          const showingOriginal = element.dataset.ai4a11yShowOriginal === "true";
          if (showingOriginal) {
            textContainer.textContent = simplified;
            toggleBtn.textContent = "Show original";
            toggleBtn.setAttribute("aria-pressed", "false");
            element.dataset.ai4a11yShowOriginal = "false";
          } else {
            textContainer.textContent = originalText;
            toggleBtn.textContent = "Show simplified";
            toggleBtn.setAttribute("aria-pressed", "true");
            element.dataset.ai4a11yShowOriginal = "true";
          }
        };
        element.textContent = "";
        element.appendChild(textContainer);
        element.appendChild(toggleBtn);
        element.dataset.ai4a11ySimplified = "done";
        incrementStat4("wcag");
        logFix4("simplify", element, "(complex)", "(simplified)");
        console.log("[AI4A11y] Simplified text");
        return simplified;
      }
      element.dataset.ai4a11ySimplified = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to simplify:", e);
      element.dataset.ai4a11ySimplified = "failed";
      return null;
    }
  }
  async function summarizeContent(element) {
    var _a;
    if (element.dataset.ai4a11ySummarize)
      return null;
    element.dataset.ai4a11ySummarize = "pending";
    if (element.tagName === "TABLE") {
      element.dataset.ai4a11ySummarize = "skipped";
      return null;
    }
    const text = (_a = element.textContent) == null ? void 0 : _a.trim();
    if (!text || text.length < 500) {
      element.dataset.ai4a11ySummarize = "skipped";
      return null;
    }
    try {
      const summary = await summarizeText(text.substring(0, 3e3));
      if (summary) {
        const summaryBox = document.createElement("div");
        summaryBox.className = "ai4a11y-summary-box";
        summaryBox.setAttribute("role", "region");
        summaryBox.setAttribute("aria-label", "Summary");
        const header = document.createElement("div");
        header.className = "ai4a11y-summary-header";
        const icon = document.createElement("span");
        icon.className = "ai4a11y-summary-icon";
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
        const headerText = document.createElement("span");
        headerText.textContent = "Summary";
        header.appendChild(icon);
        header.appendChild(headerText);
        const content = document.createElement("div");
        content.className = "ai4a11y-summary-content";
        content.textContent = summary;
        summaryBox.appendChild(header);
        summaryBox.appendChild(content);
        element.insertBefore(summaryBox, element.firstChild);
        element.dataset.ai4a11ySummarize = "done";
        incrementStat4("wcag");
        logFix4("summarize", element, "(long)", "(summarized)");
        return summary;
      }
      element.dataset.ai4a11ySummarize = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to summarize:", e);
      element.dataset.ai4a11ySummarize = "failed";
      return null;
    }
  }

  // tools/utils/color.js
  function parseColor(color) {
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") {
      return null;
    }
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3])
      };
    }
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    return null;
  }
  function getLuminance(color) {
    const rgb = parseColor(color);
    if (!rgb)
      return null;
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function getContrastRatio(color1, color2) {
    const l1 = getLuminance(color1);
    const l2 = getLuminance(color2);
    if (l1 === null || l2 === null)
      return null;
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function getEffectiveBackground(element) {
    let el = element;
    while (el && el !== document.body) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        return bg;
      }
      el = el.parentElement;
    }
    return "rgb(255, 255, 255)";
  }

  // tools/adapters/fix-contrast.js
  var logFix5 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat5 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function fixLowContrast(element, color, background) {
    if (element.dataset.ai4a11yProcessed)
      return null;
    markProcessed(element, "pending");
    if (!background || background === "transparent") {
      background = getEffectiveBackground(element);
    }
    let fixedColor;
    try {
      fixedColor = await fixContrast(color, background);
      if (!fixedColor) {
        fixedColor = getLuminance(background) > 0.5 ? "#000000" : "#ffffff";
      }
    } catch (e) {
      console.warn("[AI4A11y] Contrast fix failed, using fallback:", e);
      fixedColor = getLuminance(background) > 0.5 ? "#000000" : "#ffffff";
    }
    if (color) {
      element.dataset.ai4a11yOriginalColor = color;
    }
    element.style.color = fixedColor;
    element.classList.add("ai4a11y-contrast-fixed");
    markProcessed(element, "done");
    incrementStat5("wcag");
    logFix5("contrast", element, color, fixedColor);
    console.log("[AI4A11y] Fixed contrast:", color, "->", fixedColor);
    return fixedColor;
  }
  function fixIndistinguishableLink(link) {
    if (link.dataset.ai4a11yProcessed)
      return;
    markProcessed(link, "done");
    link.style.textDecoration = "underline";
    incrementStat5("wcag");
    logFix5("link-underline", link, "(none)", "underline");
    console.log("[AI4A11y] Added underline to link");
  }
  var axeHandlers4 = {
    "color-contrast": fixLowContrast,
    "color-contrast-enhanced": fixLowContrast,
    "link-in-text-block": fixIndistinguishableLink
  };

  // tools/adapters/wcag-fixes.js
  var logFix6 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat6 = globalThis.ai4a11yIncrementStat || (() => {
  });
  function fixInvalidLang(element) {
    const currentLang = element.getAttribute("lang");
    if (!currentLang)
      return;
    const baseLang = currentLang.split("-")[0].toLowerCase();
    const newLang = VALID_LANGS.has(baseLang) ? baseLang : "en";
    element.setAttribute("lang", newLang);
    incrementStat6("wcag");
    logFix6("lang", element, currentLang, newLang);
    console.log("[AI4A11y] Fixed lang attribute");
  }
  function fixMissingLang(element) {
    element.setAttribute("lang", detectLanguage());
    incrementStat6("wcag");
    logFix6("lang", element, "(missing)", element.getAttribute("lang"));
    console.log("[AI4A11y] Added lang attribute");
  }
  function fixDuplicateId(element) {
    const originalId = element.id;
    const newId = `${originalId}_${randomSuffix()}`;
    updateIdReferences(originalId, newId);
    element.id = newId;
    markProcessed(element, "done");
    incrementStat6("wcag");
    logFix6("duplicate-id", element, originalId, newId);
    console.log("[AI4A11y] Fixed duplicate ID:", originalId);
  }
  function fixHeadingOrder(element) {
    const match = element.tagName.match(/^H([1-6])$/);
    if (!match)
      return;
    const currentLevel = parseInt(match[1]);
    const allHeadings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const idx = allHeadings.indexOf(element);
    if (idx === -1 || idx === 0)
      return;
    const prevHeading = allHeadings[idx - 1];
    const prevLevel = parseInt(prevHeading.tagName[1]);
    if (currentLevel > prevLevel + 1) {
      const newLevel = prevLevel + 1;
      const newHeading = document.createElement(`h${newLevel}`);
      while (element.firstChild) {
        newHeading.appendChild(element.firstChild);
      }
      for (const attr of element.attributes) {
        newHeading.setAttribute(attr.name, attr.value);
      }
      element.replaceWith(newHeading);
      incrementStat6("wcag");
      logFix6("heading-order", newHeading, `h${currentLevel}`, `h${newLevel}`);
      console.log(`[AI4A11y] Fixed heading: h${currentLevel} -> h${newLevel}`);
    }
  }
  function fixPositiveTabindex(element) {
    const oldVal = element.getAttribute("tabindex");
    element.setAttribute("tabindex", "0");
    markProcessed(element, "done");
    incrementStat6("wcag");
    logFix6("tabindex", element, oldVal, "0");
    console.log("[AI4A11y] Fixed positive tabindex");
  }
  function fixTargetBlank(element) {
    const rel = element.getAttribute("rel") || "";
    const parts = rel.split(/\s+/).filter(Boolean);
    if (!parts.includes("noopener"))
      parts.push("noopener");
    if (!parts.includes("noreferrer"))
      parts.push("noreferrer");
    element.setAttribute("rel", parts.join(" "));
    markProcessed(element, "done");
    incrementStat6("wcag");
    logFix6("target-blank", element, rel || "(empty)", parts.join(" "));
    console.log('[AI4A11y] Added rel="noopener noreferrer"');
  }
  function fixInvalidAriaAttr(element) {
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith("aria-") && !VALID_ARIA_ATTRS.has(attr.name)) {
        element.removeAttribute(attr.name);
        console.log("[AI4A11y] Removed invalid ARIA attr:", attr.name);
      }
    }
    incrementStat6("wcag");
  }
  function fixInvalidAriaRole(element) {
    const role = element.getAttribute("role");
    if (role && !VALID_ARIA_ROLES.has(role)) {
      element.removeAttribute("role");
      incrementStat6("wcag");
      logFix6("aria-role", element, role, "(removed)");
      console.log("[AI4A11y] Removed invalid role:", role);
    }
  }
  function fixDeprecatedRole(element) {
    const role = element.getAttribute("role");
    if (role && DEPRECATED_ROLES[role]) {
      element.setAttribute("role", DEPRECATED_ROLES[role]);
      incrementStat6("wcag");
      logFix6("aria-role", element, role, DEPRECATED_ROLES[role]);
      console.log("[AI4A11y] Replaced deprecated role:", role);
    }
  }
  function fixMissingAriaAttrs(element) {
    const role = element.getAttribute("role");
    if (role && ARIA_REQUIRED_ATTRS[role]) {
      for (const [attr, value] of Object.entries(ARIA_REQUIRED_ATTRS[role])) {
        if (!element.hasAttribute(attr) && value !== "") {
          element.setAttribute(attr, value);
          console.log("[AI4A11y] Added required ARIA attr:", attr);
        }
      }
      incrementStat6("wcag");
    }
  }
  function fixNestedInteractive(element) {
    const parent = element.closest("a, button");
    if (!parent || element === parent)
      return;
    if (element.tagName === "BUTTON") {
      const span = document.createElement("span");
      while (element.firstChild) {
        span.appendChild(element.firstChild);
      }
      span.className = element.className;
      element.replaceWith(span);
      incrementStat6("wcag");
      logFix6("nested-interactive", span, "button", "span");
      console.log("[AI4A11y] Replaced nested button with span");
    } else if (element.tagName === "A") {
      element.removeAttribute("href");
      element.setAttribute("role", "presentation");
      incrementStat6("wcag");
      logFix6("nested-interactive", element, "a[href]", "a[role=presentation]");
      console.log("[AI4A11y] Made nested link non-interactive");
    }
  }
  function fixTargetSize(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width >= 44 && rect.height >= 44)
      return;
    const needWidth = Math.max(0, (44 - rect.width) / 2);
    const needHeight = Math.max(0, (44 - rect.height) / 2);
    const display = getComputedStyle(element).display;
    element.style.boxSizing = "border-box";
    element.style.padding = `${needHeight}px ${needWidth}px`;
    element.style.minWidth = "44px";
    element.style.minHeight = "44px";
    if (display === "inline") {
      element.style.display = "inline-block";
    }
    incrementStat6("wcag");
    logFix6("target-size", element, `${Math.round(rect.width)}x${Math.round(rect.height)}`, "44x44");
    console.log("[AI4A11y] Increased touch target size");
  }
  function fixViewportMeta(element) {
    const oldContent = element.getAttribute("content") || "";
    let content = oldContent;
    content = content.replace(/maximum-scale\s*=\s*[\d.]+/gi, "maximum-scale=5");
    content = content.replace(/user-scalable\s*=\s*no/gi, "user-scalable=yes");
    element.setAttribute("content", content);
    incrementStat6("wcag");
    logFix6("viewport", element, oldContent, content);
    console.log("[AI4A11y] Fixed viewport meta");
  }
  function removeMetaRefresh(element) {
    const oldContent = element.getAttribute("content") || "";
    element.remove();
    incrementStat6("wcag");
    logFix6("meta-refresh", element, oldContent, "(removed)");
    console.log("[AI4A11y] Removed meta refresh");
  }
  function replaceObsoleteElement(element) {
    const tag = element.tagName.toLowerCase();
    const replacement = tag === "blink" ? "span" : "div";
    const newEl = document.createElement(replacement);
    while (element.firstChild) {
      newEl.appendChild(element.firstChild);
    }
    element.replaceWith(newEl);
    incrementStat6("wcag");
    logFix6("obsolete", newEl, `<${tag}>`, `<${replacement}>`);
    console.log(`[AI4A11y] Replaced <${tag}> with <${replacement}>`);
  }
  function detectLanguage() {
    const meta = document.querySelector('meta[http-equiv="content-language"]');
    if (meta == null ? void 0 : meta.content)
      return meta.content.split("-")[0];
    const patterns = {
      "/es/": "es",
      "/fr/": "fr",
      "/de/": "de",
      "/zh/": "zh",
      "/ja/": "ja",
      "/ko/": "ko"
    };
    for (const [pattern, lang] of Object.entries(patterns)) {
      if (location.href.includes(pattern))
        return lang;
    }
    return "en";
  }
  function randomSuffix() {
    return Math.random().toString(36).substring(2, 7);
  }
  function updateIdReferences(oldId, newId) {
    const attrs = ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "headers", "list"];
    for (const attr of attrs) {
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        const val = el.getAttribute(attr);
        if (val) {
          const ids = val.split(/\s+/);
          const updated = ids.map((id) => id === oldId ? newId : id);
          if (updated.join(" ") !== val) {
            el.setAttribute(attr, updated.join(" "));
          }
        }
      });
    }
  }
  var axeHandlers5 = {
    "html-has-lang": fixMissingLang,
    "html-lang-valid": fixInvalidLang,
    "valid-lang": fixInvalidLang,
    "duplicate-id": fixDuplicateId,
    "duplicate-id-aria": fixDuplicateId,
    "duplicate-id-active": fixDuplicateId,
    "heading-order": fixHeadingOrder,
    "tabindex": fixPositiveTabindex,
    "aria-valid-attr": fixInvalidAriaAttr,
    "aria-roles": fixInvalidAriaRole,
    "aria-allowed-role": fixInvalidAriaRole,
    "aria-deprecated-role": fixDeprecatedRole,
    "aria-required-attr": fixMissingAriaAttrs,
    "nested-interactive": fixNestedInteractive,
    "target-size": fixTargetSize,
    "meta-viewport": fixViewportMeta,
    "meta-viewport-large": fixViewportMeta,
    "meta-refresh": removeMetaRefresh,
    "blink": replaceObsoleteElement,
    "marquee": replaceObsoleteElement
  };

  // tools/adapters/index.js
  var axeHandlers6 = {
    ...axeHandlers,
    ...axeHandlers2,
    ...axeHandlers3,
    ...axeHandlers4,
    ...axeHandlers5
  };
  function getAxeHandler(ruleId) {
    return axeHandlers6[ruleId] || null;
  }

  // tools/auditors/wcag-issues.js
  async function runAxeAnalysis() {
    if (typeof axe === "undefined") {
      console.warn("[AI4A11y] axe-core not loaded");
      return [];
    }
    try {
      const results = await axe.run();
      console.log(`[AI4A11y] axe-core found ${results.violations.length} violation types`);
      return results.violations;
    } catch (e) {
      console.warn("[AI4A11y] axe-core failed:", e);
      return [];
    }
  }

  // tools/auditors/missing-alt.js
  function findImagesWithoutAlt() {
    return Array.from(document.querySelectorAll("img")).filter((img) => {
      if (wasProcessed(img))
        return false;
      if (!isVisible(img))
        return false;
      if (!img.hasAttribute("alt"))
        return true;
      return false;
    });
  }
  function findEmptyAltImages() {
    return Array.from(document.querySelectorAll('img[alt=""]')).filter((img) => {
      if (wasProcessed(img))
        return false;
      if (!isVisible(img))
        return false;
      if (isLikelyDecorative(img))
        return false;
      const { width, height } = getImageSize(img);
      return width > 100 && height > 100;
    });
  }
  function findCanvasElements() {
    return Array.from(document.querySelectorAll("canvas")).filter((canvas) => {
      if (wasProcessed(canvas))
        return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });
  }

  // tools/auditors/missing-captions.js
  function findVideosWithoutCaptions() {
    return Array.from(document.querySelectorAll("video")).filter((video) => {
      var _a;
      if (wasProcessed(video))
        return false;
      if (!isVisible(video))
        return false;
      const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
      if (tracks.length > 0)
        return false;
      if (((_a = video.textTracks) == null ? void 0 : _a.length) > 0) {
        for (const track of video.textTracks) {
          if (track.kind === "captions" || track.kind === "subtitles") {
            return false;
          }
        }
      }
      return true;
    });
  }
  function findAudioWithoutTranscripts() {
    return Array.from(document.querySelectorAll("audio")).filter((audio) => {
      var _a;
      if (wasProcessed(audio))
        return false;
      if (!isVisible(audio))
        return false;
      const parent = audio.parentElement;
      if (!parent)
        return true;
      const text = ((_a = parent.textContent) == null ? void 0 : _a.toLowerCase()) || "";
      if (text.includes("transcript"))
        return false;
      if (audio.querySelector("track"))
        return false;
      return true;
    });
  }

  // tools/auditors/missing-labels.js
  function findEmptyLinks() {
    return Array.from(document.querySelectorAll("a[href]")).filter((link) => {
      if (wasProcessed(link))
        return false;
      if (!isVisible(link))
        return false;
      return !hasAccessibleName(link);
    });
  }
  function findEmptyButtons() {
    const buttons = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('[role="button"]')
    ];
    return buttons.filter((btn) => {
      if (wasProcessed(btn))
        return false;
      if (!isVisible(btn))
        return false;
      return !hasAccessibleName(btn);
    });
  }
  function findUnlabeledInputs() {
    const inputs = document.querySelectorAll("input, select, textarea");
    return Array.from(inputs).filter((input) => {
      if (wasProcessed(input))
        return false;
      if (!isVisible(input))
        return false;
      if (input.type === "hidden")
        return false;
      if (input.getAttribute("aria-label"))
        return false;
      if (input.getAttribute("aria-labelledby"))
        return false;
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label)
          return false;
      }
      if (input.closest("label"))
        return false;
      if (input.title)
        return false;
      return true;
    });
  }

  // tools/auditors/poor-contrast.js
  function findLowContrastText() {
    const textElements = document.querySelectorAll(
      "p, span, a, li, td, th, h1, h2, h3, h4, h5, h6, label, button, div"
    );
    const found = [];
    textElements.forEach((el) => {
      if (wasProcessed(el))
        return;
      if (!isVisible(el))
        return;
      const hasDirectText = Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );
      if (!hasDirectText)
        return;
      const style = getComputedStyle(el);
      const color = style.color;
      const background = getEffectiveBackground(el);
      const ratio = getContrastRatio(color, background);
      if (ratio === null)
        return;
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight) || 400;
      const isLarge = fontSize >= 24 || fontSize >= 18.66 && fontWeight >= 700;
      const minRatio = isLarge ? 3 : 4.5;
      if (ratio < minRatio) {
        found.push({
          element: el,
          color,
          background,
          ratio,
          required: minRatio
        });
      }
    });
    return found;
  }

  // tools/profiles/settings.js
  var defaults = {
    enabled: true,
    // AI tools
    autoDescribe: true,
    autoVideoDescribe: false,
    autoSimplify: false,
    autoWcagFix: true,
    autoSummarize: false,
    autoFixLabels: true,
    autoCaptions: false,
    fixContrast: true,
    // Visual tools
    darkMode: false,
    dyslexiaFont: false,
    largeCursor: false,
    enhanceFocus: false,
    readingGuide: false,
    motionReducer: false,
    // Reading tools
    readerMode: false,
    focusMode: false,
    // Navigation tools
    keyboardNav: false,
    voiceCommands: false,
    // Display settings
    fontScale: 100,
    lineHeight: 1.5,
    letterSpacing: 0,
    colorFilter: "none"
  };
  var settings = { ...defaults };
  var profiles = {
    // Vision impairments
    lowVision: {
      name: "Low Vision",
      description: "Larger text, enhanced focus indicators",
      tools: {
        fontScale: 150,
        lineHeight: 2,
        largeCursor: true,
        enhanceFocus: true,
        fixContrast: true
      }
    },
    blind: {
      name: "Blind",
      description: "Optimized for screen reader users",
      tools: {
        autoDescribe: true,
        autoVideoDescribe: true,
        autoFixLabels: true,
        autoWcagFix: true,
        keyboardNav: true
      }
    },
    colorBlind: {
      name: "Color Blindness",
      description: "Color filters and enhanced contrast",
      tools: {
        fixContrast: true,
        colorFilter: "deuteranopia"
      }
    },
    // Reading/cognitive
    dyslexia: {
      name: "Dyslexia",
      description: "Dyslexia-friendly font and spacing",
      tools: {
        dyslexiaFont: true,
        fontScale: 115,
        lineHeight: 2,
        letterSpacing: 0.12,
        focusMode: true
      }
    },
    adhd: {
      name: "ADHD",
      description: "Reduced distractions, focus mode",
      tools: {
        focusMode: true,
        motionReducer: true,
        readerMode: true
      }
    },
    cognitive: {
      name: "Cognitive",
      description: "Simplified text, summaries",
      tools: {
        autoSimplify: true,
        autoSummarize: true,
        fontScale: 120,
        lineHeight: 1.8,
        focusMode: true
      }
    },
    // Motor
    motor: {
      name: "Motor",
      description: "Keyboard navigation, large targets",
      tools: {
        largeCursor: true,
        enhanceFocus: true,
        keyboardNav: true
      }
    },
    // Sensory
    photosensitive: {
      name: "Photosensitive",
      description: "Dark mode, reduced motion",
      tools: {
        darkMode: true,
        motionReducer: true
      }
    },
    deaf: {
      name: "Deaf/HoH",
      description: "Auto captions for media",
      tools: {
        autoCaptions: true,
        autoVideoDescribe: true,
        enhanceFocus: true
      }
    },
    // Mental health
    anxiety: {
      name: "Anxiety",
      description: "Calm interface, reduced motion",
      tools: {
        focusMode: true,
        motionReducer: true,
        readerMode: true,
        lineHeight: 1.8
      }
    },
    // Older adults
    elderly: {
      name: "Elderly",
      description: "Larger text, simplified content",
      tools: {
        fontScale: 150,
        lineHeight: 1.8,
        enhanceFocus: true,
        autoSimplify: true,
        autoSummarize: true
      }
    },
    // Sensory processing
    sensory: {
      name: "Sensory Processing",
      description: "Reduced stimulation, calm interface",
      tools: {
        motionReducer: true,
        darkMode: true,
        focusMode: true
      }
    }
  };
  function getProfile(profileId) {
    return profiles[profileId];
  }
  function getAllProfiles() {
    return Object.entries(profiles).map(([id, profile]) => ({
      id,
      name: profile.name,
      description: profile.description
    }));
  }

  // cli/cli-tools.js
  function setupAIProvider() {
    setAIProvider({
      describeImage: async (imageData) => {
        if (typeof window.ai4a11y_describeImage === "function") {
          return await window.ai4a11y_describeImage(imageData);
        }
        console.warn("[AI4A11y] AI provider not available - run with AI enabled");
        return null;
      },
      simplifyText: async (text) => {
        if (typeof window.ai4a11y_simplifyText === "function") {
          return await window.ai4a11y_simplifyText(text);
        }
        return null;
      },
      summarizeText: async (text) => {
        if (typeof window.ai4a11y_summarizeText === "function") {
          return await window.ai4a11y_summarizeText(text);
        }
        return null;
      },
      generateLabels: async (ctx) => {
        if (typeof window.ai4a11y_generateLabels === "function") {
          return await window.ai4a11y_generateLabels(ctx);
        }
        return null;
      },
      inferLabel: async (ctx) => {
        if (typeof window.ai4a11y_generateLabels === "function") {
          return await window.ai4a11y_generateLabels(ctx);
        }
        return null;
      },
      fixContrast: async (fg, bg) => {
        if (typeof window.ai4a11y_fixContrast === "function") {
          return await window.ai4a11y_fixContrast(fg, bg);
        }
        return null;
      },
      describeElement: async (imageData, elementType, context) => {
        if (typeof window.ai4a11y_describeElement === "function") {
          return await window.ai4a11y_describeElement(imageData, elementType, context);
        }
        return null;
      },
      announce: (msg) => console.log(`[Announce] ${msg}`)
    });
  }
  var tools = {
    visualAssist: VisualAssist,
    darkMode: DarkMode,
    motionReducer: MotionReducer,
    focusMode: FocusMode,
    readAloud: ReadAloud,
    readerMode: ReaderMode,
    voiceCommands: VoiceCommands,
    keyboardNav: KeyboardNavigator,
    colorBlindMode: ColorBlindMode,
    autoTranscriber: AutoTranscriber
  };
  function normalizeTool(name) {
    const lower = name.toLowerCase().replace(/[-_]/g, "");
    const map = {
      "visualassist": "visualAssist",
      "darkmode": "darkMode",
      "motionreducer": "motionReducer",
      "focusmode": "focusMode",
      "readaloud": "readAloud",
      "readermode": "readerMode",
      "voicecommands": "voiceCommands",
      "keyboardnav": "keyboardNav",
      "keyboardnavigator": "keyboardNav",
      "colorblindmode": "colorBlindMode",
      "colorblind": "colorBlindMode",
      "colorfilter": "colorBlindMode",
      "autotranscriber": "autoTranscriber",
      "autocaptions": "autoTranscriber"
    };
    return map[lower] || name;
  }
  function enableTool(name, options = {}) {
    const normalized = normalizeTool(name);
    const tool = tools[normalized];
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }
    try {
      if (typeof tool.enable === "function") {
        tool.enable(options);
      } else if (typeof tool === "object" && tool.enable) {
        tool.enable(options);
      }
      return { success: true, tool: normalized };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  function disableTool(name) {
    const normalized = normalizeTool(name);
    const tool = tools[normalized];
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }
    try {
      if (typeof tool.disable === "function") {
        tool.disable();
      } else if (typeof tool === "object" && tool.disable) {
        tool.disable();
      }
      return { success: true, tool: normalized };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  function getToolStatus() {
    const status = {};
    for (const [name, tool] of Object.entries(tools)) {
      status[name] = tool.enabled || false;
    }
    return status;
  }
  function applyProfileByName(profileId) {
    const profile = getProfile(profileId);
    if (!profile) {
      return { success: false, error: `Unknown profile: ${profileId}` };
    }
    for (const tool of Object.values(tools)) {
      if (tool.disable) {
        try {
          tool.disable();
        } catch (e) {
        }
      }
    }
    const profileTools = profile.tools || {};
    const visualOpts = {};
    if (profileTools.fontScale)
      visualOpts.fontScale = profileTools.fontScale;
    if (profileTools.lineHeight)
      visualOpts.lineHeight = profileTools.lineHeight;
    if (profileTools.letterSpacing)
      visualOpts.letterSpacing = profileTools.letterSpacing;
    if (profileTools.largeCursor)
      visualOpts.largeCursor = true;
    if (profileTools.enhanceFocus)
      visualOpts.enhanceFocus = true;
    if (profileTools.dyslexiaFont)
      visualOpts.dyslexiaFont = true;
    if (profileTools.readingGuide)
      visualOpts.readingGuide = true;
    if (Object.keys(visualOpts).length > 0) {
      VisualAssist.enable(visualOpts);
    }
    if (profileTools.darkMode)
      DarkMode.enable();
    if (profileTools.motionReducer)
      MotionReducer.enable();
    if (profileTools.focusMode)
      FocusMode.enable();
    if (profileTools.readerMode)
      ReaderMode.enable();
    if (profileTools.keyboardNav)
      KeyboardNavigator.enable();
    if (profileTools.colorFilter && profileTools.colorFilter !== "none") {
      ColorBlindMode.enable(profileTools.colorFilter);
    }
    if (profileTools.autoCaptions)
      AutoTranscriber.enable();
    return {
      success: true,
      profile: profileId,
      name: profile.name,
      enabled: getToolStatus()
    };
  }
  function listProfiles() {
    return getAllProfiles();
  }
  function listTools() {
    return Object.keys(tools).map((name) => ({
      name,
      enabled: tools[name].enabled || false,
      description: getToolDescription(name)
    }));
  }
  function getToolDescription(name) {
    const descriptions = {
      visualAssist: "Font scaling, spacing, cursor, focus enhancement",
      darkMode: "Dark color scheme",
      motionReducer: "Reduce animations and motion",
      focusMode: "Hide distractions, show reading progress",
      readAloud: "Text-to-speech for page content",
      readerMode: "Clean reading view (article extraction)",
      voiceCommands: "Voice-controlled navigation",
      keyboardNav: "Enhanced keyboard navigation",
      colorBlindMode: "Color vision deficiency filters",
      autoTranscriber: "Auto-generate captions for media"
    };
    return descriptions[name] || "";
  }
  var auditors = {
    findMissingAlt() {
      const noAlt = findImagesWithoutAlt();
      const emptyAlt = findEmptyAltImages();
      const canvases = findCanvasElements();
      return {
        noAlt: noAlt.map((el) => ({
          tagName: el.tagName,
          src: el.src || el.currentSrc,
          selector: getSelector(el)
        })),
        emptyAlt: emptyAlt.map((el) => ({
          tagName: el.tagName,
          src: el.src || el.currentSrc,
          selector: getSelector(el)
        })),
        canvases: canvases.map((el) => ({
          selector: getSelector(el)
        })),
        total: noAlt.length + emptyAlt.length + canvases.length
      };
    },
    findMissingLabels() {
      const links = findEmptyLinks();
      const buttons = findEmptyButtons();
      const inputs = findUnlabeledInputs();
      return {
        links: links.map((el) => ({
          href: el.href,
          selector: getSelector(el)
        })),
        buttons: buttons.map((el) => ({
          selector: getSelector(el)
        })),
        inputs: inputs.map((el) => ({
          type: el.type,
          name: el.name,
          selector: getSelector(el)
        })),
        total: links.length + buttons.length + inputs.length
      };
    },
    findMissingCaptions() {
      const videos = findVideosWithoutCaptions();
      const audio = findAudioWithoutTranscripts();
      return {
        videos: videos.map((el) => ({
          src: el.src || el.currentSrc,
          selector: getSelector(el)
        })),
        audio: audio.map((el) => ({
          src: el.src || el.currentSrc,
          selector: getSelector(el)
        })),
        total: videos.length + audio.length
      };
    },
    findPoorContrast() {
      const results = findLowContrastText();
      return results.map((item) => {
        var _a, _b, _c;
        return {
          text: (_b = (_a = item.element) == null ? void 0 : _a.textContent) == null ? void 0 : _b.slice(0, 50),
          selector: getSelector(item.element),
          color: item.color,
          background: item.background,
          ratio: (_c = item.ratio) == null ? void 0 : _c.toFixed(2),
          required: item.required
        };
      });
    },
    async runFullAudit() {
      const results = await runAxeAnalysis();
      return results;
    }
  };
  var aiFixes = {
    async describeImages() {
      const { images } = await auditors.findMissingAlt();
      const results = [];
      for (const img of images) {
        const el = document.querySelector(img.selector);
        if (el) {
          const alt = await generateImageAlt(el);
          if (alt) {
            el.alt = alt;
            results.push({ selector: img.selector, alt });
          }
        }
      }
      return results;
    },
    async simplifyText(selector) {
      const el = selector ? document.querySelector(selector) : document.body;
      if (!el)
        return null;
      const simplified = await simplifyText2(el.textContent);
      return simplified;
    },
    async summarize(selector) {
      const el = selector ? document.querySelector(selector) : document.body;
      if (!el)
        return null;
      const summary = await summarizeContent(el.textContent);
      return summary;
    },
    async fixAxeViolation(ruleId, selector) {
      const handler = getAxeHandler(ruleId);
      if (!handler)
        return { error: `No handler for rule: ${ruleId}` };
      const el = document.querySelector(selector);
      if (!el)
        return { error: `Element not found: ${selector}` };
      await handler(el);
      return { success: true };
    }
  };
  var nonAiFixes = {
    "html-has-lang": fixMissingLang,
    "html-lang-valid": fixInvalidLang,
    "valid-lang": fixInvalidLang,
    "duplicate-id": fixDuplicateId,
    "duplicate-id-aria": fixDuplicateId,
    "duplicate-id-active": fixDuplicateId,
    "heading-order": fixHeadingOrder,
    "tabindex": fixPositiveTabindex,
    "aria-valid-attr": fixInvalidAriaAttr,
    "aria-roles": fixInvalidAriaRole,
    "aria-allowed-role": fixInvalidAriaRole,
    "aria-deprecated-role": fixDeprecatedRole,
    "aria-required-attr": fixMissingAriaAttrs,
    "nested-interactive": fixNestedInteractive,
    "target-size": fixTargetSize,
    "meta-viewport": fixViewportMeta,
    "meta-viewport-large": fixViewportMeta,
    "meta-refresh": removeMetaRefresh,
    "blink": replaceObsoleteElement,
    "marquee": replaceObsoleteElement
  };
  var aiRequiredRules = /* @__PURE__ */ new Set([
    "image-alt",
    "input-image-alt",
    "role-img-alt",
    "svg-img-alt",
    "object-alt",
    "area-alt",
    "link-name",
    "button-name",
    "input-button-name",
    "color-contrast",
    "color-contrast-enhanced"
  ]);
  async function runFullScan() {
    var _a;
    const results = {
      violations: [],
      fixed: { nonAi: 0, ai: 0 },
      skipped: { needsAi: [], noHandler: [] }
    };
    const violations = await runAxeAnalysis();
    results.violations = violations.map((v) => {
      var _a2;
      return { id: v.id, count: ((_a2 = v.nodes) == null ? void 0 : _a2.length) || 0 };
    });
    for (const violation of violations) {
      const ruleId = violation.id;
      const nodes = violation.nodes || [];
      for (const node of nodes) {
        const selector = (_a = node.target) == null ? void 0 : _a[0];
        if (!selector)
          continue;
        const el = document.querySelector(selector);
        if (!el || el.dataset.ai4a11yProcessed)
          continue;
        if (nonAiFixes[ruleId]) {
          try {
            nonAiFixes[ruleId](el);
            results.fixed.nonAi++;
          } catch (e) {
            console.warn(`[AI4A11y] Failed to fix ${ruleId}:`, e);
          }
          continue;
        }
        if (aiRequiredRules.has(ruleId)) {
          results.skipped.needsAi.push({ ruleId, selector });
          continue;
        }
        results.skipped.noHandler.push(ruleId);
      }
    }
    fixTargetBlankLinks();
    fixPositiveTabindexElements();
    fixDuplicateIds();
    return results;
  }
  function fixTargetBlankLinks() {
    document.querySelectorAll('a[target="_blank"]:not([rel*="noopener"])').forEach((link) => {
      if (!link.dataset.ai4a11yProcessed) {
        fixTargetBlank(link);
      }
    });
  }
  function fixPositiveTabindexElements() {
    document.querySelectorAll("[tabindex]").forEach((el) => {
      const val = parseInt(el.getAttribute("tabindex"));
      if (val > 0 && !el.dataset.ai4a11yProcessed) {
        fixPositiveTabindex(el);
      }
    });
  }
  function fixDuplicateIds() {
    const seen = /* @__PURE__ */ new Set();
    document.querySelectorAll("[id]").forEach((el) => {
      if (seen.has(el.id) && !el.dataset.ai4a11yProcessed) {
        fixDuplicateId(el);
      }
      seen.add(el.id);
    });
  }
  function getSelector(el) {
    if (!el || !el.tagName)
      return "unknown";
    const tag = el.tagName.toLowerCase();
    if (el.id)
      return `#${el.id}`;
    if (el.className && typeof el.className === "string") {
      const classes = el.className.trim().split(/\s+/).filter((c) => c).slice(0, 2).join(".");
      if (classes)
        return `${tag}.${classes}`;
    }
    return tag;
  }
  if (typeof window !== "undefined") {
    setupAIProvider();
    window.ai4a11y = {
      // Tool management
      tools,
      profiles,
      enableTool,
      disableTool,
      getToolStatus,
      applyProfile: applyProfileByName,
      listProfiles,
      listTools,
      // Auditors - find issues
      auditors,
      findMissingAlt: auditors.findMissingAlt,
      findMissingLabels: auditors.findMissingLabels,
      findMissingCaptions: auditors.findMissingCaptions,
      findPoorContrast: auditors.findPoorContrast,
      runFullAudit: auditors.runFullAudit,
      // AI fixes
      aiFixes,
      describeImages: aiFixes.describeImages,
      simplifyText: aiFixes.simplifyText,
      summarize: aiFixes.summarize,
      fixAxeViolation: aiFixes.fixAxeViolation,
      // Full scan (like extension)
      runFullScan,
      nonAiFixes,
      aiRequiredRules: [...aiRequiredRules],
      // Axe handlers
      axeHandlers: axeHandlers6,
      getAxeHandler,
      // Direct adapter access
      VisualAssist,
      DarkMode,
      MotionReducer,
      FocusMode,
      ReadAloud,
      ReaderMode,
      VoiceCommands,
      KeyboardNavigator,
      ColorBlindMode,
      AutoTranscriber
    };
  }
})();
//# sourceMappingURL=cli-tools.bundle.js.map
