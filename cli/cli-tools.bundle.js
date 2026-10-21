(() => {
  // tools/utils/ai.js
  var provider = null;
  function setAIProvider(p) {
    provider = p;
  }
  function getAIProvider() {
    return provider;
  }
  async function describeImage(imageData) {
    if (!provider?.describeImage) {
      throw new Error("AI provider not set or missing describeImage");
    }
    return provider.describeImage(imageData);
  }
  async function simplifyText(text, options = {}) {
    if (!provider?.simplifyText) {
      throw new Error("AI provider not set or missing simplifyText");
    }
    return provider.simplifyText(text, options);
  }
  async function summarizeText(text) {
    if (!provider?.summarizeText) {
      throw new Error("AI provider not set or missing summarizeText");
    }
    return provider.summarizeText(text);
  }
  async function inferLabel(context) {
    if (!provider?.inferLabel) {
      throw new Error("AI provider not set or missing inferLabel");
    }
    return provider.inferLabel(context);
  }
  async function fixContrast(foreground, background) {
    if (!provider?.fixContrast) {
      return null;
    }
    return provider.fixContrast(foreground, background);
  }
  async function getYouTubeTranscript(videoId) {
    if (!provider?.getYouTubeTranscript) {
      return null;
    }
    return provider.getYouTubeTranscript(videoId);
  }
  function announce(message) {
    if (provider?.announce) {
      provider.announce(message);
    }
  }
  async function transcribeVideo(videoUrl) {
    if (!provider?.transcribeVideo) {
      return null;
    }
    return provider.transcribeVideo(videoUrl);
  }
  async function transcribeAudio(audioUrl) {
    if (!provider?.transcribeAudio) {
      return null;
    }
    return provider.transcribeAudio(audioUrl);
  }
  async function improveLinkText(linkText, href, context) {
    if (!provider?.improveLinkText) {
      return null;
    }
    return provider.improveLinkText(linkText, href, context);
  }
  async function inferColumnHeader(sampleData) {
    if (!provider?.inferColumnHeader) {
      return null;
    }
    return provider.inferColumnHeader(sampleData);
  }
  async function translateText(text, targetLang) {
    if (!provider?.translateText) {
      return null;
    }
    return provider.translateText(text, targetLang);
  }
  async function defineWord(word, context) {
    if (!provider?.defineWord) {
      return null;
    }
    return provider.defineWord(word, context);
  }
  async function extractChartData(imageDataUrl, context) {
    if (!provider?.extractChartData) {
      return null;
    }
    return provider.extractChartData(imageDataUrl, context);
  }

  // tools/utils/observe.js
  var _sweeps = /* @__PURE__ */ new Map();
  var _observer = null;
  var _debounceTimers = /* @__PURE__ */ new Map();
  var _lastHref = typeof location !== "undefined" ? location.href : "";
  function _flush(reason) {
    _lastHref = typeof location !== "undefined" ? location.href : _lastHref;
    for (const [name, { callback }] of _sweeps) {
      try {
        callback({ reason });
      } catch (e) {
        console.warn(`[AI4A11y] observe: sweep "${name}" error:`, e);
      }
    }
  }
  function _scheduleSweep(reason) {
    for (const [name, { callback, debounceMs }] of _sweeps) {
      if (_debounceTimers.has(name)) clearTimeout(_debounceTimers.get(name));
      _debounceTimers.set(name, setTimeout(() => {
        _debounceTimers.delete(name);
        const currentHref = typeof location !== "undefined" ? location.href : _lastHref;
        const effectiveReason = currentHref !== _lastHref ? "urlchange" : reason;
        _lastHref = currentHref;
        try {
          callback({ reason: effectiveReason });
        } catch (e) {
          console.warn(`[AI4A11y] observe: sweep "${name}" error:`, e);
        }
      }, debounceMs));
    }
  }
  function _startObserver() {
    if (_observer || typeof MutationObserver === "undefined") return;
    if (typeof document === "undefined" || !document.body) return;
    _observer = new MutationObserver(() => _scheduleSweep("mutation"));
    _observer.observe(document.body, { childList: true, subtree: true });
  }
  function _stopObserver() {
    if (!_observer) return;
    _observer.disconnect();
    _observer = null;
    for (const t of _debounceTimers.values()) clearTimeout(t);
    _debounceTimers.clear();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", () => {
      const currentHref = typeof location !== "undefined" ? location.href : _lastHref;
      if (_sweeps.size > 0 && currentHref !== _lastHref) {
        _lastHref = currentHref;
        _flush("urlchange");
      }
    });
  }
  function registerSweep(name, callback, { debounceMs = 500 } = {}) {
    _sweeps.set(name, { callback, debounceMs });
    if (_sweeps.size === 1) _startObserver();
    return function unregister() {
      _sweeps.delete(name);
      if (_debounceTimers.has(name)) {
        clearTimeout(_debounceTimers.get(name));
        _debounceTimers.delete(name);
      }
      if (_sweeps.size === 0) _stopObserver();
    };
  }

  // tools/adapters/visual-assist.js
  var _fontScaleOriginals = /* @__PURE__ */ new WeakMap();
  var TEXT_ELEMENT_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, td, th, div, span, a, button, input, select, textarea, label, blockquote, pre, figcaption, caption, dt, dd, summary, article, section, header, footer, nav, main, aside, small, b, strong, em, legend";
  var FIXED_BOX_ATTR = "data-ai4a11y-fixed-box";
  function _insetSet(el, side) {
    try {
      if (typeof el.computedStyleMap !== "function") return false;
      const v = el.computedStyleMap().get(side);
      return !!v && String(v) !== "auto";
    } catch (_) {
      return false;
    }
  }
  function _scaledSize(px, scale) {
    return px + (scale - 1) * Math.min(px, 18);
  }
  function _shouldSkipScale(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName.toUpperCase();
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG" || tag === "MATH") return true;
    const id = el.id || "";
    if (id.startsWith("ai4a11y-")) return true;
    try {
      if (el.closest && el.closest("#ai4a11y-announcer, #ai4a11y-reader-mode")) return true;
    } catch (_) {
    }
    if (el.shadowRoot) return true;
    const cls = typeof el.className === "string" ? el.className : "";
    if (cls.includes("material-icons") || cls.includes("material-symbols") || cls.includes("icon") || cls.includes("fa-") || tag === "I") return true;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    try {
      if (el.closest && el.closest(`[${FIXED_BOX_ATTR}]`)) return true;
    } catch (_) {
    }
    return false;
  }
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
    // Track the scale currently committed to the DOM.
    appliedScale: null,
    unregisterSweep: null,
    fixedBoxes: null,
    // Map: box -> its inline font-size/line-height/letter-spacing before we set them
    fixedChecked: null,
    // WeakSet of elements already looked at, so sweeps stay cheap
    overflowBefore: null,
    // WeakSet of boxes whose content already overflowed before we changed anything
    grown: null,
    // Map: fixed-height box we let grow -> its inline height/min-height before
    // Generation counter: incremented on every apply/restore cycle so in-flight
    // requestIdleCallback traversals that started before a re-apply or restore
    // detect the change and abort, preventing compounding.
    scaleGen: 0,
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
      this.restoreFontScale();
      this.unmarkFixedBoxes();
      this.ungrowFixedBoxes();
      this.overflowBefore = null;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      this.appliedScale = null;
      this.disableReadingGuide();
    },
    apply() {
      this.remove();
      if (!this.overflowBefore) this.overflowBefore = this.overflowing();
      const css = this.generateCSS();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
      this.markFixedBoxes();
      const s = this.settings;
      let scale = s.fontScale > 10 ? s.fontScale / 100 : s.fontScale;
      scale = scale && scale > 0 ? Math.max(0.5, Math.min(2, scale)) : 1;
      if (scale !== 1) {
        if (this.appliedScale !== null && this.appliedScale !== scale) {
          this.restoreFontScale();
        }
        if (this.appliedScale !== scale) {
          this.applyFontScale(scale);
        }
        if (!this.unregisterSweep) {
          this.unregisterSweep = registerSweep("visual-assist-font", () => {
            if (!this.enabled || this.appliedScale === null) return;
            this.markFixedBoxes();
            this.applyFontScale(this.appliedScale);
          }, { debounceMs: 500 });
        }
      } else {
        if (this.appliedScale !== null) {
          this.restoreFontScale();
        }
        if (this.unregisterSweep) {
          this.unregisterSweep();
          this.unregisterSweep = null;
        }
        this.growFixedBoxes();
      }
      if (s.contrastMode && s.contrastMode !== "none") {
        if (typeof document !== "undefined" && document.getElementById("ai4a11y-dark-mode")) {
          const msg = "High contrast replaces dark mode while active";
          console.log("[AI4A11y] Visual Assist:", msg);
          announce(msg);
        }
      }
    },
    remove() {
      if (typeof document !== "undefined") document.getElementById(this.styleId)?.remove();
    },
    // ── Font-scale DOM traversal ──────────────────────────────────────────────
    applyFontScale(scale) {
      this.appliedScale = scale;
      const gen = ++this.scaleGen;
      const candidates = typeof document !== "undefined" ? Array.from(document.querySelectorAll(TEXT_ELEMENT_SELECTOR)).filter((el) => !_shouldSkipScale(el) && !(el.dataset && el.dataset.ai4a11yFontScale === String(scale))) : [];
      if (!candidates.length) return;
      const scaled = typeof document !== "undefined" ? Array.from(document.querySelectorAll("[data-ai4a11y-font-scale]")) : [];
      const scaledNow = scaled.map((el) => el.style.fontSize);
      scaled.forEach((el) => {
        const orig = _fontScaleOriginals.get(el);
        el.style.fontSize = orig === void 0 || orig === null ? "" : orig;
      });
      const scalePlan = [];
      for (const el of candidates) {
        if (!_fontScaleOriginals.has(el)) {
          _fontScaleOriginals.set(el, el.style.fontSize);
        }
        try {
          const baselinePx = parseFloat(getComputedStyle(el).fontSize);
          if (!baselinePx || baselinePx <= 0) continue;
          scalePlan.push({ el, baselinePx });
        } catch (_) {
        }
      }
      scaled.forEach((el, k) => {
        el.style.fontSize = scaledNow[k];
      });
      let i = 0;
      const processChunk = (deadline) => {
        if (gen !== this.scaleGen) return;
        const hasTime = !deadline || deadline.timeRemaining() > 0;
        while (i < scalePlan.length) {
          if (hasTime && deadline && deadline.timeRemaining() <= 0) {
            if (typeof requestIdleCallback !== "undefined") {
              requestIdleCallback(processChunk, { timeout: 500 });
            } else {
              setTimeout(() => processChunk(null), 0);
            }
            return;
          }
          if (gen !== this.scaleGen) return;
          const { el, baselinePx } = scalePlan[i++];
          el.style.fontSize = `${_scaledSize(baselinePx, scale)}px`;
          if (el.dataset) el.dataset.ai4a11yFontScale = String(scale);
        }
        this.growFixedBoxes();
      };
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(processChunk, { timeout: 500 });
      } else {
        setTimeout(() => processChunk(null), 0);
      }
    },
    // Find boxes that can't grow with their text (see FIXED_BOX_ATTR) and pin
    // their text size and line and letter spacing to the page's own, which the
    // text inside inherits; the font traversal and the spacing rules skip what's
    // inside.
    markFixedBoxes() {
      if (typeof document === "undefined" || !document.body) return;
      if (!this.fixedBoxes) {
        this.fixedBoxes = /* @__PURE__ */ new Map();
        this.fixedChecked = /* @__PURE__ */ new WeakSet();
      }
      const found = [];
      for (const el of document.body.querySelectorAll(TEXT_ELEMENT_SELECTOR)) {
        if (this.fixedChecked.has(el)) continue;
        this.fixedChecked.add(el);
        if (_shouldSkipScale(el)) continue;
        let cs;
        try {
          cs = getComputedStyle(el);
        } catch (_) {
          continue;
        }
        if (cs.position !== "absolute" || !_insetSet(el, "top") || !_insetSet(el, "bottom")) continue;
        if (!(el.textContent || "").trim()) continue;
        found.push(el);
      }
      if (!found.length) return;
      const sheet = document.getElementById(this.styleId)?.sheet;
      if (sheet) sheet.disabled = true;
      const lifted = /* @__PURE__ */ new Map();
      for (const el of found) {
        for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
          if (!a.dataset || !a.dataset.ai4a11yFontScale || lifted.has(a)) continue;
          lifted.set(a, a.style.fontSize);
          const orig = _fontScaleOriginals.get(a);
          a.style.fontSize = orig === void 0 || orig === null ? "" : orig;
        }
      }
      const own = found.map((el) => {
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        const lh = cs.lineHeight === "normal" || !fs || !parseFloat(cs.lineHeight) ? "normal" : String(Math.round(parseFloat(cs.lineHeight) / fs * 1e3) / 1e3);
        return { "font-size": cs.fontSize, "line-height": lh, "letter-spacing": cs.letterSpacing || "normal" };
      });
      for (const [a, v] of lifted) a.style.fontSize = v;
      if (sheet) sheet.disabled = false;
      found.forEach((el, k) => {
        if (el.closest(`[${FIXED_BOX_ATTR}]`)) return;
        const saved = {};
        for (const prop of Object.keys(own[k])) {
          saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
        }
        for (const t of [el, ...el.querySelectorAll("[data-ai4a11y-font-scale]")]) {
          if (!t.dataset || !t.dataset.ai4a11yFontScale) continue;
          const orig = _fontScaleOriginals.get(t);
          t.style.fontSize = orig === void 0 || orig === null ? "" : orig;
          _fontScaleOriginals.delete(t);
          delete t.dataset.ai4a11yFontScale;
        }
        this.fixedBoxes.set(el, saved);
        el.setAttribute(FIXED_BOX_ATTR, "");
        for (const prop of Object.keys(own[k])) el.style.setProperty(prop, own[k][prop], "important");
      });
    },
    unmarkFixedBoxes() {
      if (!this.fixedBoxes) return;
      for (const [el, saved] of this.fixedBoxes) {
        try {
          el.removeAttribute(FIXED_BOX_ATTR);
          for (const prop of Object.keys(saved)) el.style.setProperty(prop, saved[prop][0], saved[prop][1]);
          if (!el.getAttribute("style")) el.removeAttribute("style");
        } catch (_) {
        }
      }
      this.fixedBoxes = null;
      this.fixedChecked = null;
    },
    // Boxes whose content overflows them vertically right now.
    overflowing() {
      const out = /* @__PURE__ */ new WeakSet();
      if (typeof document === "undefined" || !document.body) return out;
      for (const el of document.body.querySelectorAll("*")) {
        if (el.scrollHeight > el.clientHeight + 1) out.add(el);
      }
      return out;
    },
    // A box the page gave a fixed height (a 64 px header bar) can't hold
    // enlarged text that wraps onto another line: the text spilled out above
    // and below it and was cut off at the top of the page. Let such a box grow
    // (it keeps at least its old height). Only boxes that overflow now and
    // didn't before we changed anything, so a page's own overflow is left alone.
    growFixedBoxes() {
      if (typeof document === "undefined" || !document.body) return;
      if (!this.grown) this.grown = /* @__PURE__ */ new Map();
      for (const el of document.body.querySelectorAll("*")) {
        if (!(el.scrollHeight > el.clientHeight + 1)) continue;
        if (this.grown.has(el) || this.overflowBefore && this.overflowBefore.has(el)) continue;
        if (_shouldSkipScale(el) || typeof el.computedStyleMap !== "function") continue;
        let cs, h;
        try {
          cs = getComputedStyle(el);
          h = String(el.computedStyleMap().get("height"));
        } catch (_) {
          continue;
        }
        if (cs.overflowY !== "visible" || cs.display === "inline" || !/^[\d.]+(px|em|rem)$/.test(h)) continue;
        this.grown.set(el, [
          el.style.getPropertyValue("height"),
          el.style.getPropertyPriority("height"),
          el.style.getPropertyValue("min-height"),
          el.style.getPropertyPriority("min-height")
        ]);
        el.style.setProperty("min-height", cs.height, "important");
        el.style.setProperty("height", "auto", "important");
      }
    },
    ungrowFixedBoxes() {
      if (!this.grown) return;
      for (const [el, v] of this.grown) {
        try {
          el.style.setProperty("height", v[0], v[1]);
          el.style.setProperty("min-height", v[2], v[3]);
          if (!el.getAttribute("style")) el.removeAttribute("style");
        } catch (_) {
        }
      }
      this.grown = null;
    },
    restoreFontScale() {
      if (typeof document === "undefined") return;
      this.scaleGen++;
      document.querySelectorAll("[data-ai4a11y-font-scale]").forEach((el) => {
        const orig = _fontScaleOriginals.get(el);
        el.style.fontSize = orig === void 0 || orig === null ? "" : orig;
        _fontScaleOriginals.delete(el);
        if (el.dataset) delete el.dataset.ai4a11yFontScale;
      });
      this.appliedScale = null;
    },
    // ── CSS generation ────────────────────────────────────────────────────────
    generateCSS() {
      const s = this.settings;
      let css = "";
      if (s.contrastMode === "light") {
        css += `
        html { background: #fff !important; }
        body, main, article, section, p,
        h1, h2, h3, h4, h5, h6,
        li, td, th {
          background-color: #fff !important;
        }
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        a, button, input, label,
        span:not([aria-hidden="true"]),
        div:not([aria-hidden="true"]) {
          color: #000 !important;
        }
        a { text-decoration: underline !important; }
        img, video { filter: contrast(1.2) !important; }
      `;
      } else if (s.contrastMode === "yellow-black") {
        css += `
        html { background: #000 !important; }
        body, main, article, section, p,
        h1, h2, h3, h4, h5, h6,
        li, td, th {
          background-color: #000 !important;
        }
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        button, input, label,
        span:not([aria-hidden="true"]),
        div:not([aria-hidden="true"]) {
          color: #ff0 !important;
        }
        a { color: #0ff !important; text-decoration: underline !important; }
        img, video { filter: contrast(1.2) brightness(0.9) !important; }
      `;
      }
      if (s.fontScale && s.fontScale !== 1 && s.fontScale !== 100) {
        css += `input[type="radio"], input[type="checkbox"] { flex-shrink: 0 !important; }
`;
      }
      const TEXT = "body, " + ["p", "li", "td", "th", "dd", "dt", "label", "blockquote", "figcaption"].map((t) => `${t}:not([${FIXED_BOX_ATTR}] *)`).join(", ");
      if (s.lineHeight && s.lineHeight !== 1.5) {
        css += `${TEXT} { line-height: ${s.lineHeight} !important; }
`;
      }
      if (s.letterSpacing && s.letterSpacing !== 0) {
        css += `${TEXT} { letter-spacing: ${s.letterSpacing}em !important; }
`;
      }
      if (s.largeCursor) {
        css += `* { cursor: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="%230066ff" opacity="0.5"/><circle cx="16" cy="16" r="4" fill="%23000"/></svg>'), auto !important; }
`;
      }
      if (s.enhanceFocus) {
        css += `
        *:focus-visible:not(#ai4a11y-focus) {
          outline: 4px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.3) !important;
        }
      `;
      }
      if (s.dyslexiaFont) {
        const fontUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("lib/OpenDyslexic-Regular.woff2") : "https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff2";
        css += `@font-face { font-family: 'OpenDyslexic'; src: url('${fontUrl}'); }
`;
        css += `
        body, p, li, td, th,
        h1, h2, h3, h4, h5, h6,
        a, button, input, textarea, label,
        span:not(.material-icons):not(.material-symbols-outlined):not([class*="icon"]):not([class*="fa-"]):not([aria-hidden="true"]),
        div:not(.material-icons):not(.material-symbols-outlined):not([class*="icon"]):not([class*="fa-"]):not([aria-hidden="true"]) {
          font-family: 'OpenDyslexic', sans-serif !important;
        }
      `;
      }
      if (s.readingGuide) {
        css += `.ai4a11y-reading-guide { position: fixed; left: 0; right: 0; height: 40px; background: rgba(255, 255, 0, 0.2); pointer-events: none; z-index: 999999; transition: top 0.05s ease-out; }
`;
      }
      return css;
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    },
    // ── Reading guide ─────────────────────────────────────────────────────────
    readingGuideEl: null,
    readingGuideMouseHandler: null,
    readingGuideFocusHandler: null,
    enableReadingGuide() {
      if (this.readingGuideEl) return;
      this.readingGuideEl = document.createElement("div");
      this.readingGuideEl.className = "ai4a11y-reading-guide";
      document.body.appendChild(this.readingGuideEl);
      this.readingGuideMouseHandler = (e) => {
        if (this.readingGuideEl) {
          this.readingGuideEl.style.top = `${e.clientY - 20}px`;
        }
      };
      document.addEventListener("mousemove", this.readingGuideMouseHandler, { passive: true });
      this.readingGuideFocusHandler = (e) => {
        const target = e.target;
        if (!target || !this.readingGuideEl) return;
        try {
          const rect = target.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          this.readingGuideEl.style.top = `${centerY - 20}px`;
        } catch (_) {
        }
      };
      document.addEventListener("focusin", this.readingGuideFocusHandler, { passive: true });
    },
    disableReadingGuide() {
      if (this.readingGuideEl) {
        this.readingGuideEl.remove();
        this.readingGuideEl = null;
      }
      if (this.readingGuideMouseHandler) {
        document.removeEventListener("mousemove", this.readingGuideMouseHandler);
        this.readingGuideMouseHandler = null;
      }
      if (this.readingGuideFocusHandler) {
        document.removeEventListener("focusin", this.readingGuideFocusHandler);
        this.readingGuideFocusHandler = null;
      }
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yVisualAssist = VisualAssist;

  // tools/adapters/dark-mode.js
  var PAGE_FILTER = "html { filter: var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,) !important; }";
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
      if (document.getElementById(this.styleId)) return;
      const style = document.createElement("style");
      style.id = this.styleId;
      const BACK = 'img, video, picture, canvas, iframe, [style*="background-image"], [style*="background:"], [style*="background-color"]';
      style.textContent = `
      html {
        --ai4a11y-filter-dark: invert(90%) hue-rotate(180deg);
        background: #111 !important;
      }
      ${PAGE_FILTER}
      ${BACK} {
        filter: invert(100%) hue-rotate(180deg) !important;
      }
      img, video {
        filter: invert(100%) hue-rotate(180deg) contrast(1.1) !important;
      }
      :is(${BACK}) :is(img, video, picture, canvas, iframe) {
        filter: none !important;
      }
    `;
      document.head.appendChild(style);
    },
    disable() {
      if (typeof DarkReader !== "undefined") {
        try {
          DarkReader.disable();
        } catch (e) {
        }
      }
      document.getElementById(this.styleId)?.remove();
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
  if (typeof window !== "undefined") window.__ai4a11yDarkMode = DarkMode;

  // tools/adapters/motion-reducer.js
  var MotionReducer = {
    styleId: "ai4a11y-motion-reducer-styles",
    enabled: false,
    unregisterSweep: null,
    pausedWaapiRefs: [],
    pausedPlayState: /* @__PURE__ */ new Set(),
    frozenImages: /* @__PURE__ */ new Map(),
    pausedIframes: /* @__PURE__ */ new Set(),
    seenVideos: /* @__PURE__ */ new WeakSet(),
    // videos already handled, see pauseAllVideos
    stillImages: /* @__PURE__ */ new WeakMap(),
    // img -> the address it was found not to animate at
    playHandler: null,
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
      let css = "";
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
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = css;
      document.head.appendChild(style);
      this.seenVideos = /* @__PURE__ */ new WeakSet();
      this.stillImages = /* @__PURE__ */ new WeakMap();
      if (s.pauseVideos) {
        this.pauseAllVideos();
        this.playHandler = (e) => {
          const v = e.target;
          if (!this.enabled || !v || v.tagName !== "VIDEO") return;
          if (navigator.userActivation && navigator.userActivation.isActive) return;
          this.pauseVideo(v);
        };
        document.addEventListener("play", this.playHandler, true);
      }
      if (s.stopGifs) this.freezeImages();
      this.pauseWaapiAnimations();
      const pauseAnimations = (deadline) => {
        const elements = document.querySelectorAll("*");
        let i = 0;
        const processChunk = () => {
          while (i < elements.length && (typeof deadline === "undefined" || deadline.timeRemaining() > 0)) {
            const el = elements[i];
            if (el.id && el.id.startsWith("ai4a11y-") || el.className && typeof el.className === "string" && el.className.startsWith("ai4a11y-")) {
              i++;
              continue;
            }
            try {
              const computedStyle = getComputedStyle(el);
              if (computedStyle.animationName !== "none") {
                el.style.animationPlayState = "paused";
                this.pausedPlayState.add(el);
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
      this.unregisterSweep = registerSweep("motion-reducer", () => {
        if (!this.enabled) return;
        this.pauseWaapiAnimations();
        if (s.stopGifs) this.freezeImages();
        if (s.pauseVideos) this.pauseAllVideos();
      }, { debounceMs: 600 });
      console.log("[AI4A11y] Motion Reducer enabled");
      announce("Motion reduced");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      this.freezeGen++;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      document.getElementById(this.styleId)?.remove();
      for (const [canvas, img] of this.frozenImages) {
        if (canvas.parentNode) {
          canvas.parentNode.insertBefore(img, canvas);
          canvas.remove();
        }
        delete img.dataset.ai4a11yMrFrozen;
      }
      this.frozenImages.clear();
      document.querySelectorAll("img[data-ai4a11y-mr-frozen]").forEach((img) => {
        delete img.dataset.ai4a11yMrFrozen;
      });
      for (const ref of this.pausedWaapiRefs) {
        const anim = ref.deref ? ref.deref() : ref;
        if (anim && anim.playState === "paused") {
          try {
            anim.play();
          } catch (e) {
          }
        }
      }
      this.pausedWaapiRefs = [];
      for (const el of this.pausedPlayState) {
        el.style.animationPlayState = "";
      }
      this.pausedPlayState.clear();
      for (const iframe of this.pausedIframes) {
        const src = iframe.src || "";
        try {
          if (src.includes("youtube.com")) {
            iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', "*");
          } else if (src.includes("vimeo.com")) {
            iframe.contentWindow?.postMessage('{"method":"play"}', "*");
          }
        } catch (e) {
        }
      }
      this.pausedIframes.clear();
      if (this.playHandler) {
        document.removeEventListener("play", this.playHandler, true);
        this.playHandler = null;
      }
      document.querySelectorAll("video[data-ai4a11y-mr-controls]").forEach((video) => {
        video.controls = false;
        delete video.dataset.ai4a11yMrControls;
      });
      document.querySelectorAll('video[data-ai4a11y-was-paused="false"]').forEach((video) => {
        video.play().catch(() => {
        });
        delete video.dataset.ai4a11yWasPaused;
      });
      console.log("[AI4A11y] Motion Reducer disabled");
      announce("Motion restored");
    },
    pauseWaapiAnimations() {
      try {
        document.getAnimations().forEach((a) => {
          if (a.playState === "running") {
            a.pause();
            this.pausedWaapiRefs.push(typeof WeakRef !== "undefined" ? new WeakRef(a) : a);
          }
        });
      } catch (e) {
      }
    },
    // Freeze every image that really animates to its first frame. A .gif, .webp or .apng
    // file name only says it might: most .webp files are still photos, and swapping a
    // still photo for a canvas only risks breaking the page's layout. So the start of the
    // file is read first, and only animated ones are frozen.
    freezeImages() {
      document.querySelectorAll("img").forEach((img) => {
        const url = img.currentSrc || img.src || "";
        if (this.stillImages.get(img) === url || img.dataset.ai4a11yMrFrozen) return;
        const mightAnimate = /\.(gif|webp|apng)(\?|$)/i.test(url) || url.startsWith("data:image/gif") || url.startsWith("data:image/webp");
        if (!mightAnimate) {
          this.stillImages.set(img, url);
          return;
        }
        img.dataset.ai4a11yMrFrozen = "checking";
        const gen = this.freezeGen;
        isAnimated(url).then((animated) => {
          if (this.freezeGen !== gen) {
            delete img.dataset.ai4a11yMrFrozen;
            return;
          }
          if (animated === false) {
            delete img.dataset.ai4a11yMrFrozen;
            this.stillImages.set(img, url);
            return;
          }
          delete img.dataset.ai4a11yMrFrozen;
          this.freezeSingleImage(img).catch(() => {
          });
        });
      });
    },
    async freezeSingleImage(img) {
      if (!img.src || img.dataset.ai4a11yMrFrozen) return;
      img.dataset.ai4a11yMrFrozen = "pending";
      const capturedGen = this.freezeGen;
      const w = img.naturalWidth || img.width || 100;
      const h = img.naturalHeight || img.height || 100;
      const altText = img.getAttribute("alt") || "";
      const origId = img.id;
      const origClass = img.className;
      const srcAriaHidden = img.getAttribute("aria-hidden");
      const srcRole = img.getAttribute("role") || "";
      const decorative = altText === "" || srcAriaHidden === "true" || srcRole === "presentation" || srcRole === "none";
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      if (origId) canvas.id = origId;
      if (origClass) canvas.className = origClass;
      if (decorative) {
        canvas.setAttribute("aria-hidden", "true");
      } else {
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", altText);
        if (srcAriaHidden !== null) canvas.setAttribute("aria-hidden", srcAriaHidden);
      }
      canvas.setAttribute("width", w);
      canvas.setAttribute("height", h);
      const box = getComputedStyle(img);
      if (img.getClientRects().length) {
        canvas.style.width = box.width;
        canvas.style.height = box.height;
      } else {
        canvas.style.maxWidth = "100%";
      }
      canvas.style.objectFit = box.objectFit;
      canvas.style.objectPosition = box.objectPosition;
      canvas.style.borderRadius = box.borderRadius;
      if (box.display !== "inline") canvas.style.display = box.display;
      const ctx = canvas.getContext("2d");
      let drawn = false;
      let taintedDraw = false;
      try {
        ctx.drawImage(img, 0, 0, w, h);
        try {
          ctx.getImageData(0, 0, 1, 1);
          drawn = true;
        } catch (taintErr) {
          taintedDraw = true;
        }
      } catch (e) {
      }
      if (!drawn) {
        try {
          await new Promise((resolve, reject) => {
            const tmp = new Image();
            tmp.crossOrigin = "anonymous";
            tmp.onload = () => {
              try {
                ctx.drawImage(tmp, 0, 0, w, h);
                resolve();
              } catch (e) {
                reject(e);
              }
            };
            tmp.onerror = reject;
            tmp.src = img.src;
          });
          drawn = true;
        } catch (e) {
          if (taintedDraw) {
            drawn = true;
          } else {
            img.dataset.ai4a11yMrFrozen = "failed";
            return;
          }
        }
      }
      if (this.freezeGen !== capturedGen) {
        delete img.dataset.ai4a11yMrFrozen;
        return;
      }
      this.frozenImages.set(canvas, img);
      if (img.parentNode) {
        img.parentNode.insertBefore(canvas, img);
        img.remove();
      }
      img.dataset.ai4a11yMrFrozen = "frozen";
    },
    pauseAllVideos() {
      document.querySelectorAll("video").forEach((video) => {
        if (this.seenVideos.has(video)) return;
        this.seenVideos.add(video);
        if (!video.paused) this.pauseVideo(video);
      });
      document.querySelectorAll("iframe").forEach((iframe) => {
        const src = iframe.src || "";
        if (src.includes("youtube.com") && src.includes("enablejsapi=1")) {
          iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
          this.pausedIframes.add(iframe);
        } else if (src.includes("vimeo.com")) {
          iframe.contentWindow?.postMessage('{"method":"pause"}', "*");
          this.pausedIframes.add(iframe);
        }
      });
    },
    pauseVideo(video) {
      video.dataset.ai4a11yWasPaused = "false";
      if (!video.paused && video.readyState < 3 && video.currentSrc) {
        const done = () => {
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("pause", done);
        };
        const onPlaying = () => {
          done();
          if (this.enabled) video.pause();
        };
        video.addEventListener("playing", onPlaying);
        video.addEventListener("pause", done);
      } else {
        video.pause();
      }
      if (!video.controls) {
        video.controls = true;
        video.dataset.ai4a11yMrControls = "added";
      }
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  var animatedCache = /* @__PURE__ */ new Map();
  var HEAD_BYTES = 8192;
  function isAnimated(url) {
    if (!animatedCache.has(url)) animatedCache.set(url, readHead(url).then(animatedFromHead, () => null));
    return animatedCache.get(url);
  }
  async function readHead(url) {
    if (url.startsWith("data:")) {
      const b64 = url.slice(url.indexOf(",") + 1, url.indexOf(",") + 1 + Math.ceil(HEAD_BYTES / 3) * 4);
      const bin = atob(b64.slice(0, b64.length - b64.length % 4));
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    }
    const res = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, credentials: "omit" });
    if (!res.ok || !res.body) throw new Error("unreadable");
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    while (n < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
    reader.cancel().catch(() => {
    });
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return bytes;
  }
  function animatedFromHead(b) {
    const text = (from, len) => String.fromCharCode(...b.subarray(from, from + len));
    if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
      return text(12, 4) === "VP8X" ? (b[20] & 2) !== 0 : false;
    }
    if (text(0, 3) === "GIF") {
      const all = text(0, b.length);
      if (all.includes("NETSCAPE2.0") || all.includes("ANIMEXTS1.0")) return true;
      return b.length < HEAD_BYTES ? false : null;
    }
    if (b[0] === 137 && text(1, 3) === "PNG") {
      const all = text(0, b.length);
      const actl = all.indexOf("acTL"), idat = all.indexOf("IDAT");
      return actl !== -1 && (idat === -1 || actl < idat);
    }
    return null;
  }
  if (typeof window !== "undefined") window.__ai4a11yMotionReducer = MotionReducer;

  // tools/adapters/focus-mode.js
  var HIGHLIGHT = "ai4a11y-focus-mode-highlight";
  function hasDarkText(el) {
    const m = (getComputedStyle(el).color || "").match(/[\d.]+/g);
    if (!m) return false;
    const [r, g, b] = m.map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }
  var FocusMode = {
    styleId: "ai4a11y-focus-mode-styles",
    enabled: false,
    progressEl: null,
    progressHandler: null,
    hoverHandler: null,
    leaveHandler: null,
    hovered: null,
    // the element carrying the hover highlight
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
      '[class*="gdpr-banner"]',
      // Shops mark ads with a "Sponsored" label inside the product card, or with
      // an "ad" class of their own (brand-ad, ad-row): dim the whole card.
      ':has(> [class*="sponsored"])',
      '[class~="ad"]',
      '[class^="ad-"]',
      '[class*=" ad-"]',
      '[class$="-ad"]',
      '[class*="-ad "]'
    ],
    enable(options = {}) {
      document.getElementById(this.styleId)?.remove();
      this.disableProgressIndicator();
      this.disableHoverHighlight();
      this.currentSettings = { ...this.currentSettings, ...options };
      this.enabled = true;
      const s = this.currentSettings;
      let css = "";
      if (s.hideDistractions) {
        const all = this.distractionSelectors.join(", ");
        css += `
        :is(${all}) {
          opacity: ${s.dimOpacity} !important;
          transition: opacity 0.3s ease !important;
        }
        :is(${all}) :is(${all}),
        :is(${all}):hover, :is(${all}):focus-within {
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
      .${HIGHLIGHT} {
        background-color: ${s.highlightColor} !important;
        transition: background-color 0.2s ease !important;
      }
    `;
      this.enableHoverHighlight();
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
      this.enabled = false;
      document.getElementById(this.styleId)?.remove();
      this.disableProgressIndicator();
      this.disableHoverHighlight();
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
        if (this.progressRafPending) return;
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
    // Highlight the paragraph, list item or table cell under the pointer. Light
    // text (white words on a banner photo, a dark footer's links) would all
    // but vanish on the light highlight, so only dark text gets it.
    enableHoverHighlight() {
      this.hoverHandler = (e) => {
        const el = e.target && e.target.closest ? e.target.closest("p, li, td") : null;
        if (el === this.hovered) return;
        this.hovered?.classList.remove(HIGHLIGHT);
        this.hovered = el && hasDarkText(el) ? el : null;
        this.hovered?.classList.add(HIGHLIGHT);
      };
      this.leaveHandler = () => {
        this.hovered?.classList.remove(HIGHLIGHT);
        this.hovered = null;
      };
      document.addEventListener("mouseover", this.hoverHandler, true);
      document.documentElement.addEventListener("mouseleave", this.leaveHandler);
    },
    disableHoverHighlight() {
      if (this.hoverHandler) document.removeEventListener("mouseover", this.hoverHandler, true);
      if (this.leaveHandler) document.documentElement.removeEventListener("mouseleave", this.leaveHandler);
      this.hoverHandler = this.leaveHandler = null;
      this.hovered?.classList.remove(HIGHLIGHT);
      this.hovered = null;
    },
    toggle() {
      if (this.enabled) {
        this.disable();
      } else {
        this.enable();
      }
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yFocusMode = FocusMode;

  // tools/adapters/read-aloud.js
  var SKIP_SEL = 'script, style, noscript, template, select, textarea, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [aria-hidden="true"], [hidden], [aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  var BLOCK_TAGS = /* @__PURE__ */ new Set([
    "P",
    "DIV",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "TD",
    "TH",
    "TR",
    "DT",
    "DD",
    "SECTION",
    "ARTICLE",
    "BLOCKQUOTE",
    "FIGCAPTION",
    "CAPTION",
    "LEGEND",
    "FIELDSET",
    "LABEL",
    "BUTTON",
    "SUMMARY",
    "BR"
  ]);
  var CHUNK_CHARS = 220;
  var ReadAloud = {
    speaking: false,
    paused: false,
    utterance: null,
    currentWord: 0,
    words: [],
    run: 0,
    // bumped by stop(); callbacks from an older run are ignored
    gestureHandler: null,
    // waiting for a click or key to start (see waitForGesture)
    settings: {
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
      highlightColor: "#ffeb3b"
    },
    getVoices() {
      return typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
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
      if (options.rate) this.settings.rate = options.rate;
      const main = document.querySelector('main, article, [role="main"], #main, .content, #content');
      const target = main || document.body;
      const text = this.extractReadableText(target);
      if (text) {
        this.speak(text);
      } else {
        announce("Read aloud: no text to read on this page");
      }
    },
    // The text a sighted reader sees in element, in order, with a pause between
    // blocks. Text hidden on the page (closed menus, error boxes not shown yet)
    // is left out; visually hidden text meant for listeners is kept.
    extractReadableText(element) {
      if (!element) return "";
      const parts = [];
      let lastBlock = null;
      const visible2 = (el) => typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true });
      const blockOf = (el) => {
        for (let e = el; e && e !== element; e = e.parentElement) if (BLOCK_TAGS.has(e.tagName)) return e;
        return element;
      };
      const walk = (el) => {
        for (let n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) {
            const t = n.nodeValue.replace(/\s+/g, " ");
            if (!t.trim()) {
              if (parts.length) parts.push(" ");
              continue;
            }
            const block = blockOf(el);
            if (block !== lastBlock && parts.length) {
              const prev = parts.join("").trimEnd();
              parts.push(/[.!?:;,]$/.test(prev) ? " " : ". ");
            }
            lastBlock = block;
            parts.push(t);
          } else if (n.nodeType === 1 && !(n.matches && n.matches(SKIP_SEL)) && visible2(n)) {
            walk(n);
          }
        }
      };
      try {
        walk(element);
      } catch {
      }
      return parts.join("").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
    },
    // Sentence-sized pieces, none longer than CHUNK_CHARS where a space allows.
    chunk(text) {
      const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
      const out = [];
      let cur = "";
      for (let s of sentences) {
        while (s.length > CHUNK_CHARS) {
          const cut = s.lastIndexOf(" ", CHUNK_CHARS);
          const at = cut > 40 ? cut : CHUNK_CHARS;
          if (cur) {
            out.push(cur);
            cur = "";
          }
          out.push(s.slice(0, at));
          s = s.slice(at);
        }
        if ((cur + s).length > CHUNK_CHARS && cur) {
          out.push(cur);
          cur = "";
        }
        cur += s;
      }
      if (cur.trim()) out.push(cur);
      return out.map((c) => c.trim()).filter(Boolean);
    },
    // Browsers only start speech after the person has clicked or pressed a key
    // on the page. When reading was switched on as the page loaded (a saved
    // setting, a profile), wait for that first click or key, then start.
    waitForGesture(text, run) {
      if (this.gestureHandler) return;
      this.speaking = false;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      announce("Read aloud is ready: click anywhere on the page or press a key to start");
      console.log("[AI4A11y] Read Aloud: waiting for a click or key press before speaking");
      this.gestureHandler = () => {
        this.clearGesture();
        if (run === this.run) this.speak(text);
      };
      document.addEventListener("pointerdown", this.gestureHandler, true);
      document.addEventListener("keydown", this.gestureHandler, true);
    },
    clearGesture() {
      if (!this.gestureHandler) return;
      document.removeEventListener("pointerdown", this.gestureHandler, true);
      document.removeEventListener("keydown", this.gestureHandler, true);
      this.gestureHandler = null;
    },
    async speak(text) {
      this.stop();
      if (!text) return;
      if (typeof EasySpeech === "undefined" && typeof speechSynthesis === "undefined") {
        announce("Text-to-speech is not available in this browser");
        return;
      }
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
      if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
        announce("Text-to-speech is not available in this browser");
        this.speaking = false;
        return;
      }
      const run = this.run;
      const chunks = this.chunk(text);
      let started = false, offset = 0;
      chunks.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.rate = this.settings.rate;
        u.pitch = this.settings.pitch;
        u.volume = this.settings.volume;
        if (this.settings.voice) u.voice = this.settings.voice;
        const base = offset;
        offset += part.length + 1;
        u.onboundary = (event) => {
          if (run !== this.run || event.name !== "word" || !this.words.length) return;
          const avgWordLength = text.length / this.words.length;
          if (avgWordLength > 0) {
            this.currentWord = Math.min(Math.floor((base + event.charIndex) / avgWordLength), this.words.length - 1);
          }
        };
        u.onstart = () => {
          if (run !== this.run || started) return;
          started = true;
          console.log("[AI4A11y] Read Aloud started");
          announce("Reading started");
        };
        u.onend = () => {
          if (run !== this.run || i !== chunks.length - 1) return;
          this.speaking = false;
          announce("Finished reading");
        };
        u.onerror = (event) => {
          if (run !== this.run) return;
          if (event.error === "interrupted" || event.error === "canceled") return;
          if (event.error === "not-allowed" && !started) {
            this.waitForGesture(text, run);
            return;
          }
          console.warn("[AI4A11y] Speech error:", event.error);
          this.speaking = false;
        };
        this.utterance = u;
        speechSynthesis.speak(u);
      });
    },
    pause() {
      if (this.speaking && !this.paused && typeof speechSynthesis !== "undefined") {
        speechSynthesis.pause();
        this.paused = true;
        announce("Reading paused");
      }
    },
    resume() {
      if (this.paused && typeof speechSynthesis !== "undefined") {
        speechSynthesis.resume();
        this.paused = false;
        announce("Reading resumed");
      }
    },
    stop() {
      this.run++;
      this.clearGesture();
      if (typeof EasySpeech !== "undefined" && EasySpeech.cancel) {
        try {
          EasySpeech.cancel();
        } catch (e) {
        }
      }
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
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
  if (typeof window !== "undefined") window.__ai4a11yReadAloud = ReadAloud;

  // tools/adapters/reader-mode.js
  var STYLE_ID = "ai4a11y-reader-styles";
  var AD_SEL = '[class*="sponsor" i], [id*="sponsor" i], [aria-label*="sponsor" i], [alt*="sponsor" i], [class*="advert" i], [id*="advert" i]';
  var AD_HOLDER = 'a, li, article, aside, [class*="card" i]';
  var KEEP_LIVE = '[aria-live], [role="status"], [role="alert"], [role="log"], #ws-root';
  var ReaderMode = {
    enabled: false,
    originalContent: null,
    readerOverlay: null,
    escapeHandler: null,
    inerted: null,
    // page elements we made inert, to give back on disable
    focusBefore: null,
    // what had focus before the reader opened
    overflowBefore: null,
    // the body's own inline overflow, put back on disable
    settings: {
      fontSize: 18,
      lineHeight: 1.8,
      maxWidth: 700,
      fontFamily: "Georgia, serif",
      backgroundColor: "#fafafa",
      textColor: "#333"
    },
    enable(options = {}) {
      if (this.enabled) return true;
      if (typeof Readability === "undefined") {
        console.warn("[AI4A11y] Readability library not loaded");
        announce("Reader mode not available");
        return false;
      }
      this.settings = { ...this.settings, ...options };
      const docClone = document.cloneNode(true);
      this.declutter(docClone);
      const PLACEHOLDER_PATTERNS = /^(data:image\/gif|about:blank|javascript:|$)/i;
      docClone.querySelectorAll("img, source").forEach((el) => {
        const dataSrc = el.getAttribute("data-src");
        const dataSrcset = el.getAttribute("data-srcset");
        if (dataSrc) {
          const currentSrc = el.getAttribute("src") || "";
          if (PLACEHOLDER_PATTERNS.test(currentSrc.trim())) {
            el.setAttribute("src", dataSrc);
          }
        }
        if (dataSrcset && !el.getAttribute("srcset")) {
          el.setAttribute("srcset", dataSrcset);
        }
      });
      const reader = new Readability(docClone);
      const article = reader.parse();
      if (!article || !article.content || article.content.length < 200 || (article.textContent || "").replace(/\s+/g, " ").trim().length < 400) {
        announce("Reader mode found no article text on this page");
        return false;
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
      title.tabIndex = -1;
      let heading = article.title || document.title || "Article";
      const site = (article.siteName || "").trim();
      if (site && heading.length > site.length + 3) {
        for (const sep of [" | ", " - ", " \u2013 ", " \u2014 ", " \xB7 "]) {
          if (heading.endsWith(sep + site)) {
            heading = heading.slice(0, -(sep + site).length);
            break;
          }
        }
      }
      title.textContent = heading;
      container.appendChild(title);
      if (article.byline) {
        const byline = document.createElement("p");
        byline.className = "ai4a11y-reader-byline";
        byline.textContent = article.byline;
        container.appendChild(byline);
      }
      const contentDiv = document.createElement("div");
      contentDiv.className = "ai4a11y-reader-content";
      contentDiv.innerHTML = this.sanitize(article.content || "");
      container.appendChild(contentDiv);
      this.readerOverlay.appendChild(container);
      this.applyStyles();
      closeBtn.type = "button";
      closeBtn.onclick = () => this.disable();
      this.overflowBefore = document.body.hasAttribute("style") ? document.body.style.overflow : null;
      document.body.style.overflow = "hidden";
      document.body.appendChild(this.readerOverlay);
      this.focusBefore = document.activeElement;
      this.inerted = [];
      for (const el of document.body.children) {
        if (el === this.readerOverlay || el.inert || el.matches(KEEP_LIVE)) continue;
        el.inert = true;
        this.inerted.push(el);
      }
      try {
        title.focus({ preventScroll: true });
      } catch {
      }
      this.enabled = true;
      console.log("[AI4A11y] Reader Mode enabled");
      announce("Reader mode enabled. Press Escape to exit.");
      this.escapeHandler = (e) => {
        if (e.key === "Escape") this.disable();
      };
      document.addEventListener("keydown", this.escapeHandler);
      return true;
    },
    // Strip Readability output down to safe HTML before injecting it with
    // innerHTML. No DOMPurify dependency is vendored for tools/ (only the
    // extension's popup.html loads it as a devDependency of
    // a browser host), so this replicates DOMPurify's HTML-profile
    // sanitize with a hand-rolled allowlist-of-dangers pass: strip
    // script-capable elements, all `on*` handlers, and URL-bearing attributes
    // that carry an executable scheme (javascript:/vbscript:/data:text/html
    // /data:application/data:image+svg — SVG can carry its own <script>).
    sanitize(html) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html || "";
      tempDiv.querySelectorAll("script, iframe, object, embed, form, input, svg, style, link, meta, base, noscript, template, math").forEach((el) => el.remove());
      tempDiv.querySelectorAll("video, audio").forEach((el) => {
        el.removeAttribute("autoplay");
        el.setAttribute("controls", "");
      });
      const dangerousUrlAttrs = ["href", "src", "srcset", "action", "formaction", "srcdoc", "poster", "xlink:href"];
      const dangerousPrefixes = ["javascript:", "vbscript:", "data:text/html", "data:application", "data:image/svg+xml"];
      tempDiv.querySelectorAll("*").forEach((el) => {
        [...el.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = (attr.value || "").replace(/[\s\x00-\x1f]/g, "").toLowerCase();
          if (name.startsWith("on")) {
            el.removeAttribute(attr.name);
            return;
          }
          if (dangerousUrlAttrs.includes(name) && dangerousPrefixes.some((p) => value.startsWith(p))) {
            el.removeAttribute(attr.name);
          }
        });
      });
      return tempDiv.innerHTML;
    },
    // Take out of the copy what the reader never sees on the page, and ads,
    // before Readability picks the main text. The copy has the same elements
    // in the same order as the page, so what is hidden is read off the page.
    declutter(docClone) {
      try {
        const live = document.body ? document.body.querySelectorAll("*") : [];
        const copy = docClone.body ? docClone.body.querySelectorAll("*") : [];
        if (live.length === copy.length) {
          const drop = [];
          live.forEach((el, i) => {
            if (el.hidden || el.getAttribute("aria-hidden") === "true") {
              drop.push(copy[i]);
              return;
            }
            const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
            if (cs && (cs.display === "none" || cs.visibility === "hidden")) drop.push(copy[i]);
          });
          drop.forEach((el) => el.remove());
        }
        docClone.querySelectorAll(AD_SEL).forEach((el) => (el.closest(AD_HOLDER) || el).remove());
        docClone.querySelectorAll("section, aside").forEach((el) => {
          if (/^\s*(sponsored|advertisement)\b/i.test(el.textContent || "")) el.remove();
        });
        const now = document.title;
        docClone.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"], meta[name="dc.title" i]').forEach((m) => {
          if (now && m.getAttribute("content") !== now) m.remove();
        });
      } catch {
      }
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
        position: sticky;
        top: 12px;
        display: block;
        margin: 0 0 12px auto;
        padding: 10px 20px;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        z-index: 1;
      `;
      }
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = `
      #ai4a11y-reader-mode img, #ai4a11y-reader-mode video, #ai4a11y-reader-mode picture {
        max-width: 100% !important; height: auto !important; max-height: 70vh; object-fit: contain;
      }
      #ai4a11y-reader-mode a img { max-width: min(160px, 100%) !important; } /* product cards and promos, not article photos */
      #ai4a11y-reader-mode table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
      #ai4a11y-reader-mode td, #ai4a11y-reader-mode th { padding: 4px 8px; vertical-align: top; text-align: left; }
      #ai4a11y-reader-mode td > p, #ai4a11y-reader-mode th > p { margin: 0; }
      #ai4a11y-reader-mode pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
      #ai4a11y-reader-mode .ai4a11y-reader-content { overflow-wrap: anywhere; }
      #ai4a11y-reader-mode a { color: #0b57d0; }
      #ai4a11y-reader-mode :focus-visible { outline: 3px solid #0b57d0 !important; outline-offset: 2px; box-shadow: 0 0 0 5px #fff; }
      #ai4a11y-reader-mode .ai4a11y-reader-title:focus { outline: none !important; box-shadow: none; }
    `;
    },
    disable() {
      if (!this.enabled && !this.readerOverlay) return;
      if (this.readerOverlay) {
        this.readerOverlay.remove();
        this.readerOverlay = null;
      }
      document.getElementById(STYLE_ID)?.remove();
      document.body.style.overflow = this.overflowBefore || "";
      if (this.overflowBefore === null && !document.body.getAttribute("style")) document.body.removeAttribute("style");
      this.overflowBefore = null;
      for (const el of this.inerted || []) el.inert = false;
      this.inerted = null;
      const back = this.focusBefore;
      this.focusBefore = null;
      if (back && back.isConnected && back !== document.body && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch {
        }
      }
      if (this.escapeHandler) {
        document.removeEventListener("keydown", this.escapeHandler);
        this.escapeHandler = null;
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
  if (typeof window !== "undefined") window.__ai4a11yReaderMode = ReaderMode;

  // tools/adapters/voice-commands.js
  var FATAL = ["not-allowed", "service-not-allowed", "audio-capture"];
  var MAX_FAILURES = 4;
  var NOTICE_MS = 6e3;
  var CLICKABLE = 'a[href], button, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], summary, label, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [onclick], [tabindex]:not([tabindex="-1"])';
  function squash(s) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function nameOf(el) {
    return squash(el.getAttribute("aria-label") || el.textContent || el.value || el.getAttribute("title") || el.querySelector?.("img[alt]")?.getAttribute("alt") || "");
  }
  function visible(el) {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }
  var VoiceCommands = {
    enabled: false,
    recognition: null,
    feedbackElement: null,
    _fatal: false,
    _failures: 0,
    _restartTimer: null,
    _noticeTimer: null,
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
        const links = Array.from(document.querySelectorAll("a[href]")).filter(visible);
        const current = document.activeElement;
        const idx = links.indexOf(current);
        if (idx < links.length - 1) links[idx + 1].focus();
        else if (links.length > 0) links[0].focus();
      },
      "previous link": () => {
        const links = Array.from(document.querySelectorAll("a[href]")).filter(visible);
        const current = document.activeElement;
        const idx = links.indexOf(current);
        if (idx > 0) links[idx - 1].focus();
        else if (links.length > 0) links[links.length - 1].focus();
      },
      "next button": () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(visible);
        const current = document.activeElement;
        const idx = buttons.indexOf(current);
        if (idx < buttons.length - 1) buttons[idx + 1].focus();
        else if (buttons.length > 0) buttons[0].focus();
      },
      "read page": () => window.__ai4a11yReadAloud?.speakPage(),
      "stop reading": () => window.__ai4a11yReadAloud?.stop()
    },
    enable(options = {}) {
      if (this.enabled) return;
      if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        announce("Voice recognition not supported in this browser");
        return;
      }
      this.settings = { ...this.settings, ...options };
      this._fatal = false;
      this._failures = 0;
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = this.settings.continuous;
      this.recognition.interimResults = this.settings.interimResults;
      this.recognition.lang = this.settings.language;
      this.recognition.onresult = (event) => {
        this._failures = 0;
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
        if (event.error === "no-speech") return;
        this._failures++;
        if (FATAL.includes(event.error) || this._failures >= MAX_FAILURES) this._giveUp(event.error);
        else this.showFeedback("Trouble hearing. Trying again\u2026", "error");
      };
      this.recognition.onend = () => {
        if (!this.enabled || this._fatal) return;
        clearTimeout(this._restartTimer);
        this._restartTimer = setTimeout(() => {
          this._restartTimer = null;
          if (!this.enabled || this._fatal || !this.recognition) return;
          try {
            this.recognition.start();
          } catch {
          }
        }, this._failures ? 500 * this._failures : 0);
      };
      this.createFeedbackElement();
      this.enabled = true;
      try {
        this.recognition.start();
      } catch (e) {
        this._giveUp(e && e.name);
        return;
      }
      console.log("[AI4A11y] Voice Commands enabled");
      announce(`Voice commands on. Say "click" and a button's name, "scroll down", or "stop listening".`);
    },
    // The microphone can't be used: say so once, stop listening, and take the
    // note down after a moment instead of leaving a pulsing "Error" on the page.
    _giveUp(error) {
      if (this._fatal) return;
      this._fatal = true;
      const msg = /not-allowed|NotAllowed|service-not-allowed/.test(String(error)) ? "Voice commands can't use the microphone. Allow it in the browser to use them" : "Voice commands can't hear anything: no microphone or speech service";
      announce(msg);
      this.showFeedback(msg, "error");
      if (this.feedbackElement) this.feedbackElement.classList.add("ai4a11y-voice-off");
      try {
        this.recognition && this.recognition.abort();
      } catch {
      }
      clearTimeout(this._noticeTimer);
      this._noticeTimer = setTimeout(() => {
        this._noticeTimer = null;
        if (this.feedbackElement) this.feedbackElement.style.display = "none";
      }, NOTICE_MS);
    },
    disable() {
      if (!this.enabled && !this.recognition && !this.feedbackElement) return;
      this.enabled = false;
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
      if (this.recognition) {
        this.recognition.onend = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        try {
          this.recognition.stop();
        } catch {
        }
        this.recognition = null;
      }
      if (this.feedbackElement) {
        this.feedbackElement.remove();
        this.feedbackElement = null;
      }
      document.getElementById("ai4a11y-voice-pulse-style")?.remove();
      console.log("[AI4A11y] Voice Commands disabled");
      announce("Voice commands off");
    },
    createFeedbackElement() {
      if (this.feedbackElement) return;
      this.feedbackElement = document.createElement("div");
      this.feedbackElement.id = "ai4a11y-voice-feedback";
      this.feedbackElement.setAttribute("aria-hidden", "true");
      this.feedbackElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: max-content;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
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
      pointer-events: none;
    `;
      const indicator = document.createElement("span");
      indicator.className = "ai4a11y-voice-dot";
      indicator.style.cssText = "display:inline-block;flex:none;width:12px;height:12px;background:#f00;border-radius:50%;";
      this.feedbackElement.appendChild(indicator);
      const textSpan = document.createElement("span");
      textSpan.className = "ai4a11y-voice-text";
      textSpan.textContent = "Listening...";
      this.feedbackElement.appendChild(textSpan);
      const pulseStyle = document.createElement("style");
      pulseStyle.id = "ai4a11y-voice-pulse-style";
      pulseStyle.textContent = "@keyframes ai4a11y-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }.ai4a11y-voice-dot { animation: ai4a11y-pulse 1s infinite; }.ai4a11y-voice-off .ai4a11y-voice-dot { animation: none; background: #888 !important; }@media (prefers-reduced-motion: reduce) { .ai4a11y-voice-dot { animation: none; } }";
      document.getElementById("ai4a11y-voice-pulse-style")?.remove();
      document.head.appendChild(pulseStyle);
      document.body.appendChild(this.feedbackElement);
    },
    showFeedback(text, type) {
      if (!this.feedbackElement) return;
      const textEl = this.feedbackElement.querySelector(".ai4a11y-voice-text");
      if (textEl) {
        textEl.textContent = text;
        textEl.style.color = type === "error" ? "#ff9b9b" : type === "interim" ? "#ccc" : "#fff";
      }
    },
    executeCommand(transcript) {
      transcript = squash(transcript);
      if (transcript.includes("stop listening")) {
        this.disable();
        return true;
      }
      const clickMatch = transcript.match(/^(?:click|press|tap)(?: on)? (.+)$/);
      if (clickMatch && !/^(it|this|that)$/.test(clickMatch[1])) {
        const el = this.findElementByText(clickMatch[1]);
        if (el) {
          el.click();
          if (el.isConnected) el.focus({ preventScroll: true });
          announce(`Clicked ${nameOf(el).slice(0, 60)}`);
        } else {
          announce(`Nothing called "${clickMatch[1]}" to click`);
        }
        return !!el;
      }
      const typeMatch = transcript.match(/^type (.+)/);
      if (typeMatch) {
        const field = document.activeElement;
        if (field && field.matches("input, textarea")) {
          field.value += typeMatch[1];
          field.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
        announce('Go to a text field first, then say "type" and the words');
        return false;
      }
      for (const [phrase, action] of Object.entries(this.commands)) {
        if (transcript === phrase || transcript.includes(phrase)) {
          action();
          return true;
        }
      }
      announce(`No command for "${transcript}"`);
      return false;
    },
    // The visible control whose name matches best: the exact name, then one
    // that starts with it, then one that contains it. Includes things a page
    // made clickable with a script (a pointer cursor), like a <div> button.
    findElementByText(text) {
      const want = squash(text);
      if (!want) return null;
      const seen = new Set(document.querySelectorAll(CLICKABLE));
      for (const el of document.querySelectorAll("div, span, li, img")) {
        if (!seen.has(el) && getComputedStyle(el).cursor === "pointer" && !el.parentElement?.closest(CLICKABLE)) seen.add(el);
      }
      const tiers = [[], [], []];
      for (const el of seen) {
        if (el.closest("#ws-root, #ai4a11y-voice-feedback")) continue;
        const name = nameOf(el);
        if (!name) continue;
        const tier = name === want ? 0 : name.startsWith(want) ? 1 : name.includes(want) ? 2 : -1;
        if (tier >= 0 && visible(el)) tiers[tier].push(el);
      }
      return tiers[0][0] || tiers[1][0] || tiers[2][0] || null;
    },
    addCommand(phrase, action) {
      this.commands[phrase.toLowerCase()] = action;
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yVoiceCommands = VoiceCommands;

  // tools/adapters/keyboard-nav.js
  function getFocusable(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
    });
  }
  var KeyboardNavigator = {
    enabled: false,
    styleId: "ai4a11y-keyboard-nav-styles",
    skipLinkElement: null,
    tabSequenceOverlay: false,
    shortcutHandler: null,
    modifiedElements: [],
    // {el, prior} tabindex changes — restored (not stripped) on disable
    injectedIdEls: [],
    // {el, syntheticId} ids we stamped — removed on disable only if unchanged
    badgeContainer: null,
    resizeObserver: null,
    resizeTimer: null,
    scrollHandler: null,
    badgeFrame: 0,
    lastHeading: null,
    unregisterSweep: null,
    settings: {
      showSkipLinks: true,
      enhanceFocusVisible: true,
      showTabSequence: false
    },
    enable(options = {}) {
      if (this.enabled) return;
      this.settings = { ...this.settings, ...options };
      this.enabled = true;
      this.injectStyles();
      if (this.settings.showSkipLinks) this.createSkipLinks();
      if (this.settings.showTabSequence) this.showTabSequence();
      this.setupKeyboardShortcuts();
      this.unregisterSweep = registerSweep("keyboard-nav", ({ reason }) => {
        if (reason === "mutation" && this.tabSequenceOverlay) this.repositionBadges();
      }, { debounceMs: 300 });
      console.log("[AI4A11y] Keyboard Navigator enabled");
      announce("Keyboard shortcuts on. Alt+1 goes to the main content, Alt+H to the next heading, Alt+O shows the tab order");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      document.getElementById(this.styleId)?.remove();
      this.skipLinkElement?.remove();
      this.skipLinkElement = null;
      this.hideTabSequence();
      if (this.shortcutHandler) {
        document.removeEventListener("keydown", this.shortcutHandler);
        this.shortcutHandler = null;
      }
      this.unregisterSweep?.();
      this.unregisterSweep = null;
      this.modifiedElements.forEach(({ el, prior }) => {
        if (prior === null) el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", prior);
      });
      this.modifiedElements = [];
      this.injectedIdEls.forEach(({ el, syntheticId }) => {
        if (el.id === syntheticId) el.removeAttribute("id");
      });
      this.injectedIdEls = [];
      this.lastHeading = null;
      console.log("[AI4A11y] Keyboard Navigator disabled");
      announce("Keyboard navigation restored");
    },
    // Tabindex write helper — records the prior value only once per element so
    // repeated shortcuts on the same element don't clobber the real original.
    setTabindex(el, val) {
      if (!el) return;
      if (!this.modifiedElements.some((r) => r.el === el)) {
        const prior = el.hasAttribute("tabindex") ? el.getAttribute("tabindex") : null;
        this.modifiedElements.push({ el, prior });
      }
      el.setAttribute("tabindex", val);
    },
    injectStyles() {
      document.getElementById(this.styleId)?.remove();
      const css = `
      ${this.settings.enhanceFocusVisible ? `
        /* Specific enough to beat a page that turns focus rings off with
           its own !important rule (e.g. html[data-x] *:focus { outline:
           none !important }, the store's planted issue 20). */
        html:root body *:focus-visible {
          outline: 3px solid #0066ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 0 6px rgba(0, 102, 255, 0.25) !important;
        }
      ` : ""}
      /* OUT OF FLOW \u2014 see skip-links.js. These wrappers are injected as
         children of <body> (one of them as the FIRST child), and an in-flow
         child shifts every positional layout on body by one: grid rows/areas,
         :first-child, :nth-child(), flex layouts assuming a child count. Their
         contents are already fixed/absolute; only the wrappers were in flow. */
      #ai4a11y-skip-links, .ai4a11y-badge-layer {
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        z-index: 999999;
      }
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
      if (this.skipLinkElement) return;
      const hasExistingSkip = Array.from(document.querySelectorAll('a[href^="#"]')).some((el) => {
        if (!/skip/i.test(el.textContent || "")) return false;
        const rect = el.getBoundingClientRect();
        return rect.top < 300;
      });
      if (hasExistingSkip) return;
      const container = document.createElement("div");
      container.id = "ai4a11y-skip-links";
      const main = document.querySelector('main, [role="main"], #main, #content, article');
      if (main) {
        if (!main.id) {
          main.id = "ai4a11y-main-content";
          this.injectedIdEls.push({ el: main, syntheticId: "ai4a11y-main-content" });
        }
        const skipToMain = document.createElement("a");
        skipToMain.href = "#" + main.id;
        skipToMain.className = "ai4a11y-skip-link";
        skipToMain.textContent = "Skip to main content";
        skipToMain.addEventListener("click", (e) => {
          e.preventDefault();
          this.setTabindex(main, "-1");
          main.focus();
          main.scrollIntoView({ behavior: "smooth" });
        });
        container.appendChild(skipToMain);
      }
      const nav = this.findNav();
      if (nav) {
        if (!nav.id) {
          nav.id = "ai4a11y-nav";
          this.injectedIdEls.push({ el: nav, syntheticId: "ai4a11y-nav" });
        }
        const skipToNav = document.createElement("a");
        skipToNav.href = "#" + nav.id;
        skipToNav.className = "ai4a11y-skip-link";
        skipToNav.textContent = "Skip to navigation";
        skipToNav.style.left = "200px";
        skipToNav.addEventListener("click", (e) => {
          e.preventDefault();
          this.setTabindex(nav, "-1");
          nav.focus();
        });
        container.appendChild(skipToNav);
      }
      this.skipLinkElement = container;
      document.body.insertBefore(container, document.body.firstChild);
    },
    // The navigation landmark with the most links: on a page whose only <nav>
    // is a three-link breadcrumb trail next to a real menu, "navigation"
    // should still mean the menu when there is one.
    findNav() {
      const navs = [...document.querySelectorAll('nav, [role="navigation"]')];
      navs.sort((a, b) => b.querySelectorAll("a[href]").length - a.querySelectorAll("a[href]").length);
      return navs[0] || null;
    },
    // The layer is position:fixed, so badges are placed in VIEWPORT coordinates
    // and moved on scroll. (They used to be placed at document coordinates
    // inside the fixed layer, so after any scroll every number sat a scroll's
    // height away from its control.) Badges for controls outside the window are
    // hidden, never pushed past its edge.
    showTabSequence() {
      this.hideTabSequence();
      const focusables = getFocusable(document.body).filter((el) => !el.closest("#ws-root, #ai4a11y-skip-links"));
      const container = document.createElement("div");
      container.setAttribute("aria-hidden", "true");
      container.className = "ai4a11y-badge-layer";
      this.badgeContainer = container;
      focusables.forEach((el, idx) => {
        const badge = document.createElement("span");
        badge.className = "ai4a11y-tab-badge";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = String(idx + 1);
        badge._target = el;
        container.appendChild(badge);
      });
      document.body.appendChild(container);
      this.tabSequenceOverlay = true;
      this.repositionBadges();
      const schedule = () => {
        if (!this.tabSequenceOverlay || this.badgeFrame) return;
        this.badgeFrame = requestAnimationFrame(() => {
          this.badgeFrame = 0;
          this.repositionBadges();
        });
      };
      this.scrollHandler = schedule;
      window.addEventListener("scroll", schedule, { capture: true, passive: true });
      window.addEventListener("resize", schedule, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(schedule);
        this.resizeObserver.observe(document.body);
      }
      announce(`Tab order numbers shown on ${focusables.length} controls. Alt+O hides them`);
    },
    repositionBadges() {
      if (!this.badgeContainer) return;
      const badges = Array.from(this.badgeContainer.querySelectorAll(".ai4a11y-tab-badge"));
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const rects = badges.map((b) => b._target && b._target.isConnected ? b._target.getBoundingClientRect() : null);
      badges.forEach((badge, i) => {
        const r = rects[i];
        const onScreen = r && r.width > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        badge.style.display = onScreen ? "" : "none";
        if (!onScreen) return;
        badge.style.top = Math.max(0, r.top - 10) + "px";
        badge.style.left = Math.min(Math.max(0, r.left - 10), vw - 32) + "px";
      });
    },
    hideTabSequence() {
      if (this.badgeContainer) {
        this.badgeContainer.remove();
        this.badgeContainer = null;
      }
      this.tabSequenceOverlay = false;
      if (this.scrollHandler) {
        window.removeEventListener("scroll", this.scrollHandler, { capture: true });
        window.removeEventListener("resize", this.scrollHandler);
        this.scrollHandler = null;
      }
      if (this.badgeFrame) {
        cancelAnimationFrame(this.badgeFrame);
        this.badgeFrame = 0;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
    },
    setupKeyboardShortcuts() {
      this.shortcutHandler = (e) => {
        if (!e.altKey) return;
        if (e.ctrlKey || e.metaKey) return;
        const path = typeof e.composedPath === "function" ? e.composedPath() : [];
        const target = path[0] || e.target;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target?.isContentEditable) return;
        if (/^(textbox|searchbox|combobox)$/.test(target?.getAttribute?.("role") || "")) return;
        const code = e.code || "";
        const key = /^(Key|Digit)/.test(code) ? code.replace(/^(Key|Digit)/, "").toLowerCase() : (e.key || "").toLowerCase();
        if (key === "1") {
          e.preventDefault();
          const main = document.querySelector('main, [role="main"], #main, #content');
          if (main) {
            this.setTabindex(main, "-1");
            main.focus();
          } else announce("This page has no main content area marked");
        }
        if (key === "2") {
          e.preventDefault();
          const nav = this.findNav();
          if (nav) {
            this.setTabindex(nav, "-1");
            nav.focus();
          } else announce("This page has no navigation marked");
        }
        if (key === "h") {
          e.preventDefault();
          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).filter((h2) => !h2.closest("#ws-root, [hidden]") && (h2.getClientRects().length || !document.body.getClientRects().length));
          if (!headings.length) {
            announce("This page has no headings marked");
            return;
          }
          const currentIdx = this.lastHeading ? headings.indexOf(this.lastHeading) : -1;
          const idx = e.shiftKey ? currentIdx <= 0 ? headings.length - 1 : currentIdx - 1 : (currentIdx + 1) % headings.length;
          const h = headings[idx];
          this.lastHeading = h;
          this.setTabindex(h, "-1");
          h.focus();
          h.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (key === "o") {
          e.preventDefault();
          if (this.tabSequenceOverlay) {
            this.hideTabSequence();
            announce("Tab order numbers hidden");
          } else this.showTabSequence();
        }
      };
      document.addEventListener("keydown", this.shortcutHandler);
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yKeyboardNavigator = KeyboardNavigator;

  // tools/adapters/color-blind.js
  var PAGE_FILTER2 = "html { filter: var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,) !important; }";
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
      if (!this.filters[mode]) {
        console.warn("[AI4A11y] Invalid color blind mode:", mode);
        return;
      }
      this.currentMode = mode;
      this.enabled = true;
      this.injectSvgFilters();
      document.getElementById(this.styleId)?.remove();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      html {
        --ai4a11y-filter-color: ${this.filters[mode]};
      }
      ${PAGE_FILTER2}
    `;
      document.head.appendChild(style);
      console.log("[AI4A11y] Color Blind Mode enabled:", mode);
      announce(`Color blind correction applied: ${mode}`);
    },
    disable() {
      this.enabled = false;
      this.currentMode = "none";
      document.getElementById(this.styleId)?.remove();
      document.getElementById(this.filterId)?.remove();
      console.log("[AI4A11y] Color Blind Mode disabled");
      announce("Color blind correction removed");
    },
    injectSvgFilters() {
      if (document.getElementById(this.filterId)) return;
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
  if (typeof window !== "undefined") window.__ai4a11yColorBlindMode = ColorBlindMode;

  // tools/adapters/dismiss-overlays.js
  var OVERLAY_NAME_RE = /(cookie|consent|gdpr|ccpa|newsletter|subscribe|sign[-_]?up|paywall|interstitial|pop[-_]?up|lightbox|backdrop|promo[-_]?(bar|banner)|notification[-_]?bar)/i;
  var INPUT_EVENTS = ["pointerdown", "keydown", "click"];
  function classNameOf(el) {
    const c = el.className;
    if (typeof c === "string") return c;
    if (c && typeof c.baseVal === "string") return c.baseVal;
    return "";
  }
  var DismissOverlays = {
    styleId: "ai4a11y-dismiss-overlays-styles",
    hiddenClass: "ai4a11y-overlay-dismissed",
    enabled: false,
    hidden: null,
    // Set of elements we hid (for exact restore)
    observer: null,
    inputHandler: null,
    lastInput: 0,
    // when the person last clicked or pressed a key
    prevBodyOverflow: null,
    prevHtmlOverflow: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.hidden = /* @__PURE__ */ new Set();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `.${this.hiddenClass} { display: none !important; }`;
      (document.head || document.documentElement).appendChild(style);
      this.prevBodyOverflow = document.body ? document.body.style.overflow : null;
      this.prevHtmlOverflow = document.documentElement ? document.documentElement.style.overflow : null;
      if (document.body && document.body.style.overflow === "hidden") document.body.style.overflow = "";
      if (document.documentElement && document.documentElement.style.overflow === "hidden") document.documentElement.style.overflow = "";
      const count = this.sweep(document);
      this.lastInput = 0;
      this.inputHandler = (e) => {
        if (e.isTrusted) this.lastInput = Date.now();
      };
      for (const type of INPUT_EVENTS) document.addEventListener(type, this.inputHandler, true);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          if (Date.now() - this.lastInput < 1e3) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) this.consider(node);
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      console.log(`[AI4A11y] Dismiss Overlays enabled (${count} hidden)`);
      announce(count ? `Hid ${count} popup${count === 1 ? "" : "s"}` : "Watching for popups to hide");
    },
    // Scan a root for overlays and hide them; returns how many were hidden.
    sweep(root) {
      let n = 0;
      let candidates;
      try {
        candidates = root.querySelectorAll('div, section, aside, dialog, [role="dialog"], [aria-modal="true"]');
      } catch {
        return 0;
      }
      for (const el of candidates) if (this.consider(el)) n++;
      return n;
    },
    // Hide one element if it looks like a blocking overlay. Returns true if hidden.
    consider(el) {
      if (!el || el.nodeType !== 1 || this.hidden.has(el)) return false;
      if (el.classList && el.classList.contains(this.hiddenClass)) return false;
      if (!this.isOverlay(el)) {
        if (el.querySelector) {
          const inner = this.sweep(el);
          if (inner) return true;
        }
        return false;
      }
      el.classList.add(this.hiddenClass);
      this.hidden.add(el);
      return true;
    },
    isOverlay(el) {
      if (el.getAttribute && el.getAttribute("aria-modal") === "true") return true;
      const nameHit = OVERLAY_NAME_RE.test(el.id || "") || OVERLAY_NAME_RE.test(classNameOf(el)) || OVERLAY_NAME_RE.test(el.getAttribute && el.getAttribute("aria-label") || "");
      if (!nameHit) return false;
      let pos = "";
      try {
        pos = (getComputedStyle(el).position || "").toLowerCase();
      } catch {
      }
      const blocking = pos === "fixed" || pos === "sticky" || el.getAttribute && el.getAttribute("role") === "dialog";
      return blocking;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.inputHandler) {
        for (const type of INPUT_EVENTS) document.removeEventListener(type, this.inputHandler, true);
        this.inputHandler = null;
      }
      document.getElementById(this.styleId)?.remove();
      if (this.hidden) {
        for (const el of this.hidden) el.classList?.remove(this.hiddenClass);
        this.hidden.clear();
        this.hidden = null;
      }
      if (document.body && this.prevBodyOverflow !== null) document.body.style.overflow = this.prevBodyOverflow;
      if (document.documentElement && this.prevHtmlOverflow !== null) document.documentElement.style.overflow = this.prevHtmlOverflow;
      this.prevBodyOverflow = this.prevHtmlOverflow = null;
      console.log("[AI4A11y] Dismiss Overlays disabled");
      announce("Popups restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yDismissOverlays = DismissOverlays;

  // tools/adapters/big-targets.js
  var TARGET_SELECTORS = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "label",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    "[onclick]",
    '[tabindex]:not([tabindex="-1"])'
  ];
  var TARGETS = TARGET_SELECTORS.join(",");
  var MARK = "data-ai4a11y-bt";
  var NUM = "data-ai4a11y-bt-n";
  var NO_PSEUDO = /^(INPUT|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|IFRAME|CANVAS|svg|OBJECT|EMBED)$/;
  var BOX_TYPES = /^(checkbox|radio)$/;
  var NO_GROW_TYPES = /^(hidden|range|file|color|image)$/;
  var GROW_ROLES = /^(button|tab|menuitem|switch|option)$/;
  function isClear(color) {
    return !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  }
  var BigTargets = {
    styleId: "ai4a11y-big-targets-styles",
    bodyClass: "ai4a11y-big-targets",
    enabled: false,
    minSize: 44,
    boxSize: 24,
    _marked: [],
    _seen: null,
    _count: -1,
    _bodySize: "",
    _unregister: null,
    _resizeObs: null,
    _timer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.minSize = Number(options.minSize) > 0 ? Number(options.minSize) : 44;
      this.boxSize = Math.max(24, Math.round(this.minSize * 0.55));
      const style = document.createElement("style");
      style.id = this.styleId;
      (document.head || document.documentElement).appendChild(style);
      this._writeStyle("");
      try {
        if (document.body) document.body.classList.add(this.bodyClass);
      } catch {
      }
      this._seen = /* @__PURE__ */ new WeakSet();
      this._apply();
      this._unregister = registerSweep("big-targets", () => this._maybeApply(), { debounceMs: 400 });
      if (typeof ResizeObserver !== "undefined" && document.body) {
        this._resizeObs = new ResizeObserver(() => {
          if (!this.enabled || this._sizeKey() === this._bodySize) return;
          clearTimeout(this._timer);
          this._timer = setTimeout(() => this._apply(), 300);
        });
        this._resizeObs.observe(document.body);
      }
      console.log("[AI4A11y] Bigger Click Targets enabled");
      announce("Click targets enlarged");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this._unregister) {
        this._unregister();
        this._unregister = null;
      }
      if (this._resizeObs) {
        this._resizeObs.disconnect();
        this._resizeObs = null;
      }
      clearTimeout(this._timer);
      this._timer = null;
      this._clearMarks();
      this._seen = null;
      this._count = -1;
      this._bodySize = "";
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      try {
        if (document.body) document.body.classList.remove(this.bodyClass);
      } catch {
      }
      console.log("[AI4A11y] Bigger Click Targets disabled");
      announce("Click targets restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    },
    _sizeKey() {
      const b = document.body;
      return b ? b.offsetWidth + "x" + b.offsetHeight : "";
    },
    _writeStyle(perElement) {
      const el = document.getElementById(this.styleId);
      if (!el) return;
      const b = `body.${this.bodyClass}`;
      const focus = TARGET_SELECTORS.map((s) => `${b} ${s}:focus-visible`).join(",\n");
      el.textContent = `
${b} [${MARK}~="grow"] { min-width: ${this.minSize}px !important; min-height: ${this.minSize}px !important; }
${b} [${MARK}~="glyph"] { font-size: ${Math.round(this.minSize * 0.45)}px !important; }
${b} [${MARK}~="box"] { width: ${this.boxSize}px !important; height: ${this.boxSize}px !important; flex-shrink: 0 !important; }
${b} [${MARK}~="label"] { pointer-events: auto !important; cursor: pointer; }
${b} [${MARK}~="rel"] { position: relative !important; }
${b} [${MARK}~="hit"]::after { content: "" !important; position: absolute !important; }
${focus} {
  outline: 3px solid #1a73e8 !important;
  outline-offset: 2px !important;
}
${perElement}`;
    },
    _clearMarks() {
      for (const el of this._marked) {
        try {
          el.removeAttribute(MARK);
          el.removeAttribute(NUM);
        } catch {
        }
      }
      this._marked = [];
    },
    _mark(el, token) {
      const cur = el.getAttribute(MARK);
      if (!cur) this._marked.push(el);
      el.setAttribute(MARK, cur ? cur + " " + token : token);
    },
    // Everything a person could click: the structural controls, plus the
    // outermost element with a pointer cursor that isn't inside one of them.
    _candidates() {
      const found = /* @__PURE__ */ new Set();
      for (const el of document.querySelectorAll(TARGETS)) found.add(el);
      for (const el of document.body.getElementsByTagName("*")) {
        if (found.has(el) || el.id === this.styleId) continue;
        let cs;
        try {
          cs = getComputedStyle(el);
        } catch {
          continue;
        }
        if (cs.cursor !== "pointer") continue;
        const p = el.parentElement;
        if (p && p !== document.body && getComputedStyle(p).cursor === "pointer") continue;
        if (el.closest(TARGETS)) continue;
        found.add(el);
      }
      return [...found].filter((el) => !(el.closest && el.closest("#ws-root")));
    },
    _maybeApply() {
      if (!this.enabled || !document.body) return;
      const list = this._candidates();
      if (list.length === this._count && list.every((el) => this._seen.has(el))) return;
      this._apply(list);
    },
    // Reads and writes are kept in separate passes: interleaving them would
    // make the browser lay out the whole page again once per control.
    _apply(list) {
      if (!this.enabled || !document.body || !document.getElementById(this.styleId)) return;
      const MIN = this.minSize, BOX = this.boxSize;
      const root = document.documentElement;
      this._clearMarks();
      this._writeStyle("");
      list = list || this._candidates();
      this._count = list.length;
      for (const el of list) this._seen.add(el);
      const items = [];
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        items.push({ el, cs, r, small: r.width < MIN || r.height < MIN });
      }
      const docW = root.clientWidth, docSW = root.scrollWidth;
      const writes = [];
      const grown = [];
      for (const it of items) {
        const { el, cs, r } = it;
        if (!it.small || el.disabled) continue;
        const tag = el.tagName, type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "INPUT" && BOX_TYPES.test(type)) {
          if (cs.opacity !== "0" && cs.position !== "absolute" && (r.width < BOX || r.height < BOX)) {
            writes.push([el, "box"]);
            it.kind = "box";
          }
          const label = el.closest("label") || el.labels && el.labels[0];
          if (label && getComputedStyle(label).pointerEvents === "none") writes.push([label, "label"]);
          if (it.kind !== "box") it.kind = "input";
          continue;
        }
        if (cs.display === "inline" || cs.display === "contents") continue;
        const role = el.getAttribute("role") || "";
        const text = (el.textContent || "").trim();
        const iconLike = r.width < MIN && r.height < MIN && text.length <= 2;
        const looksLikeButton = !isClear(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 && !isClear(cs.borderTopColor);
        const overlaid = cs.position === "absolute" || cs.position === "fixed";
        const growable = !overlaid && (tag === "BUTTON" || tag === "SELECT" || tag === "SUMMARY" || tag === "INPUT" && !NO_GROW_TYPES.test(type) || GROW_ROLES.test(role) || iconLike || tag !== "LABEL" && looksLikeButton);
        if (!growable) continue;
        const p = el.parentElement, g = p && p.parentElement;
        it.before = [p, g].filter(Boolean).map((a) => [a, a.scrollWidth - a.clientWidth, a.scrollHeight - a.clientHeight]);
        it.kind = "grow";
        writes.push([el, text && parseFloat(cs.fontSize) < this.minSize * 0.45 && iconLike ? "grow glyph" : "grow"]);
        grown.push(it);
      }
      for (const [el, token] of writes) this._mark(el, token);
      const undo = grown.filter((it) => {
        const r = it.el.getBoundingClientRect();
        return it.before.some(([a, w, h]) => a.scrollWidth - a.clientWidth > w + 1 || a.scrollHeight - a.clientHeight > h + 1) || r.right > docW + 0.5 && it.r.right <= docW + 0.5;
      });
      const ungrow = (it) => {
        it.el.setAttribute(MARK, (it.el.getAttribute(MARK) || "").replace(/\b(grow|glyph)\b/g, "").trim() || "none");
        it.kind = null;
      };
      undo.forEach(ungrow);
      if (grown.length && root.scrollWidth > docSW + 1) grown.filter((it) => it.kind === "grow").forEach(ungrow);
      const rects = items.map((it) => ({ el: it.el, r: it.el.getBoundingClientRect() }));
      const hits = [];
      for (const it of items) {
        if (!it.small || it.kind) continue;
        const { el, cs } = it;
        if (NO_PSEUDO.test(el.tagName) || el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) continue;
        if (el.getClientRects().length > 1) continue;
        if (cs.overflow !== "visible") continue;
        const after = getComputedStyle(el, "::after").content;
        if (after && after !== "none" && after !== "normal") continue;
        const inner = el.querySelector(TARGETS);
        if (inner && !(el.tagName === "LABEL" && [...el.querySelectorAll(TARGETS)].every((c) => c.tagName === "INPUT"))) continue;
        const relative = cs.position === "static";
        if (relative && [...el.querySelectorAll("*")].some((d) => /absolute|fixed/.test(getComputedStyle(d).position))) continue;
        const want = { x: Math.max(0, (MIN - r.width) / 2), y: Math.max(0, (MIN - r.height) / 2) };
        let top = want.y, bottom = want.y, left = want.x, right = want.x;
        for (const o of rects) {
          if (o.el === el || o.el.contains(el) || el.contains(o.el)) continue;
          const q = o.r;
          const overlapX = q.left < r.right + right && q.right > r.left - left;
          const overlapY = q.top < r.bottom + bottom && q.bottom > r.top - top;
          if (overlapX && q.bottom <= r.top + 0.5) top = Math.min(top, (r.top - q.bottom) / 2);
          if (overlapX && q.top >= r.bottom - 0.5) bottom = Math.min(bottom, (q.top - r.bottom) / 2);
          if (overlapY && q.right <= r.left + 0.5) left = Math.min(left, (r.left - q.right) / 2);
          if (overlapY && q.left >= r.right - 0.5) right = Math.min(right, (q.left - r.right) / 2);
        }
        let box = { left: 0, right: docW, top: -window.scrollY, bottom: root.scrollHeight - window.scrollY };
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            const ar = a.getBoundingClientRect();
            const x0 = ar.left + a.clientLeft - a.scrollLeft, y0 = ar.top + a.clientTop - a.scrollTop;
            box = { left: x0, right: x0 + a.scrollWidth, top: y0, bottom: y0 + a.scrollHeight };
            break;
          }
        }
        const px = (v) => Math.max(0, Math.floor(v));
        const t = px(Math.min(top, r.top - box.top)), b = px(Math.min(bottom, box.bottom - r.bottom));
        const l = px(Math.min(left, r.left - box.left)), rt = px(Math.min(right, box.right - r.right));
        if (t + b + l + rt < 2) continue;
        hits.push({ el, relative, t, b, l, rt });
      }
      const rules = hits.map((h, i) => {
        h.el.setAttribute(NUM, String(i + 1));
        this._mark(h.el, h.relative ? "hit rel" : "hit");
        return `body.${this.bodyClass} [${NUM}="${i + 1}"]::after { top: -${h.t}px; right: -${h.rt}px; bottom: -${h.b}px; left: -${h.l}px; }`;
      });
      this._writeStyle(rules.join("\n"));
      this._bodySize = this._sizeKey();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yBigTargets = BigTargets;

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
    if (!rgb) return null;
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function getContrastRatio(color1, color2) {
    const l1 = getLuminance(color1);
    const l2 = getLuminance(color2);
    if (l1 === null || l2 === null) return null;
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function meetsContrastAA(foreground, background, isLarge = false) {
    const ratio = getContrastRatio(foreground, background);
    if (ratio === null) return false;
    return ratio >= (isLarge ? 3 : 4.5);
  }
  function nearestAccessibleColor(foreground, background, { target = 4.5 } = {}) {
    const fg = parseColor(foreground);
    if (!fg) return null;
    if (getLuminance(background) === null) return null;
    const STEPS = 50;
    function stepToward(endpoint) {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const r = Math.round(fg.r + (endpoint.r - fg.r) * t);
        const g = Math.round(fg.g + (endpoint.g - fg.g) * t);
        const b = Math.round(fg.b + (endpoint.b - fg.b) * t);
        const candidate = `rgb(${r}, ${g}, ${b})`;
        const ratio = getContrastRatio(candidate, background);
        if (ratio !== null && ratio >= target) return { color: candidate, steps: i };
      }
      return null;
    }
    const dark = stepToward({ r: 0, g: 0, b: 0 });
    const light = stepToward({ r: 255, g: 255, b: 255 });
    if (!dark && !light) {
      const blackRatio = getContrastRatio("rgb(0, 0, 0)", background) ?? 0;
      const whiteRatio = getContrastRatio("rgb(255, 255, 255)", background) ?? 0;
      return blackRatio >= whiteRatio ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
    }
    if (!dark) return light.color;
    if (!light) return dark.color;
    return dark.steps <= light.steps ? dark.color : light.color;
  }
  function parseRgba(color) {
    if (!color) return null;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== void 0 ? parseFloat(m[4]) : 1 };
    const rgb = parseColor(color);
    return rgb ? { ...rgb, a: 1 } : null;
  }
  function getEffectiveBackground(element) {
    const layers = [];
    let el = element;
    while (el) {
      const parsed = parseRgba(getComputedStyle(el).backgroundColor);
      if (parsed && parsed.a > 0) {
        layers.push(parsed);
        if (parsed.a >= 1) break;
      }
      if (el === document.documentElement) break;
      el = el.parentElement;
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const top = layers[i];
      base = {
        r: Math.round(top.r * top.a + base.r * (1 - top.a)),
        g: Math.round(top.g * top.a + base.g * (1 - top.a)),
        b: Math.round(top.b * top.a + base.b * (1 - top.a))
      };
    }
    return `rgb(${base.r}, ${base.g}, ${base.b})`;
  }

  // tools/adapters/link-highlighter.js
  var LinkHighlighter = {
    styleId: "ai4a11y-link-highlighter-styles",
    bodyClass: "ai4a11y-highlight-links",
    dataAttr: "data-ai4a11y-linkhl",
    ownColorAttr: "data-ai4a11y-linkhl-own-color",
    enabled: false,
    titled: null,
    // Set of links WE titled (for exact restore)
    ownColor: null,
    // Set of links that keep the page's color (see keepOwnColor)
    color: null,
    observer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.titled = /* @__PURE__ */ new Set();
      this.ownColor = /* @__PURE__ */ new Set();
      const color = options && options.color || "#0b57d0";
      this.color = color;
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      .${this.bodyClass} a[href] {
        text-decoration: underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px !important;
        font-weight: 600 !important;
      }
      .${this.bodyClass} a[href]:not([${this.ownColorAttr}]) {
        color: ${color} !important;
      }
      .${this.bodyClass} a[href]:focus,
      .${this.bodyClass} a[href]:focus-visible {
        outline: 3px solid ${color} !important;
        outline-offset: 2px !important;
      }
    `;
      (document.head || document.documentElement).appendChild(style);
      if (document.body) document.body.classList.add(this.bodyClass);
      const count = this.sweep(document);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) this.consider(node);
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      console.log(`[AI4A11y] Link Highlighter enabled (${count} destinations revealed)`);
      announce(count ? `Links highlighted, ${count} destination${count === 1 ? "" : "s"} revealed` : "Links highlighted");
    },
    // Reveal destination hosts for every untitled link under root; returns how
    // many links were titled.
    sweep(root) {
      let n = 0;
      let links;
      try {
        links = root.querySelectorAll("a[href]");
      } catch {
        return 0;
      }
      for (const a of links) {
        this.keepOwnColor(a);
        if (this.reveal(a)) n++;
      }
      return n;
    },
    // The link color is dark: on a dark header or a colored button it made
    // links unreadable (dark blue on dark red). Those keep the page's own
    // color, which the page already made readable there; the underline and
    // weight still mark them as links.
    keepOwnColor(a) {
      if (!a || a.nodeType !== 1 || this.ownColor.has(a)) return;
      try {
        const ratio = getContrastRatio(this.color, getEffectiveBackground(a));
        if (ratio === null || ratio >= 4.5) return;
        a.setAttribute(this.ownColorAttr, "");
        this.ownColor.add(a);
      } catch {
      }
    },
    // An added node may itself be a link, or contain links.
    consider(node) {
      if (!node || node.nodeType !== 1) return;
      try {
        if (node.matches && node.matches("a[href]")) {
          this.keepOwnColor(node);
          this.reveal(node);
        }
      } catch {
      }
      if (node.querySelectorAll) this.sweep(node);
    },
    // Set one link's title to its destination host. Returns true if we titled
    // it. NEVER overwrites a title the page already set — that text is the
    // page's own description and must survive disable() untouched.
    reveal(a) {
      if (!a || a.nodeType !== 1 || this.titled.has(a)) return false;
      if (a.hasAttribute("title")) return false;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return false;
      let host = "";
      try {
        host = new URL(href, window.location.href).host;
      } catch {
        return false;
      }
      if (!host) return false;
      a.setAttribute("title", host);
      a.setAttribute(this.dataAttr, "");
      this.titled.add(a);
      return true;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      document.getElementById(this.styleId)?.remove();
      if (document.body) document.body.classList.remove(this.bodyClass);
      if (this.titled) {
        for (const a of this.titled) {
          try {
            a.removeAttribute("title");
            a.removeAttribute(this.dataAttr);
          } catch {
          }
        }
        this.titled.clear();
        this.titled = null;
      }
      if (this.ownColor) {
        for (const a of this.ownColor) {
          try {
            a.removeAttribute(this.ownColorAttr);
          } catch {
          }
        }
        this.ownColor = null;
      }
      console.log("[AI4A11y] Link Highlighter disabled");
      announce("Link highlighting off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yLinkHighlighter = LinkHighlighter;

  // tools/adapters/_primitives.js
  function injectStyle(id, css, doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return { remove() {
    } };
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElement("style");
      el.id = id;
      (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css;
    return { el, remove() {
      try {
        doc.getElementById(id)?.remove();
      } catch {
      }
    } };
  }
  var DEFAULT_SKIP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "INPUT", "NOSCRIPT", "SELECT", "OPTION"]);
  var HTML_NS = "http://www.w3.org/1999/xhtml";
  function transformTextNodes(root, transform, opts = {}) {
    const doc = root && root.ownerDocument ? root.ownerDocument : typeof document !== "undefined" ? document : null;
    const records = [];
    if (!root || !doc) return { records, capped: false, restore() {
    } };
    const skipTags = opts.skipTags || DEFAULT_SKIP;
    const skipClass = opts.skipClass || null;
    const cap = opts.cap ?? 5e3;
    const texts = [];
    const walk = (node) => {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          if (child.nodeValue && child.nodeValue.trim()) texts.push(child);
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (skipTags.has(tag)) continue;
          if (child.namespaceURI && child.namespaceURI !== HTML_NS) continue;
          if (child.isContentEditable === true) continue;
          const ce = child.getAttribute && child.getAttribute("contenteditable");
          if (ce === "" || ce === "true") continue;
          if (skipClass && child.classList && child.classList.contains(skipClass)) continue;
          walk(child);
        }
      }
    };
    try {
      walk(root);
    } catch {
    }
    let capped = false;
    for (const textNode of texts) {
      if (records.length >= cap) {
        capped = true;
        break;
      }
      let replacement;
      try {
        replacement = transform(textNode.nodeValue, textNode);
      } catch {
        replacement = null;
      }
      if (!replacement) continue;
      try {
        textNode.parentNode.replaceChild(replacement, textNode);
        records.push({ replacement, original: textNode });
      } catch {
      }
    }
    return {
      records,
      capped,
      restore() {
        for (const { replacement, original } of records) {
          try {
            if (replacement.parentNode) replacement.parentNode.replaceChild(original, replacement);
          } catch {
          }
        }
        records.length = 0;
      }
    };
  }
  function mainRoot(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return null;
    return doc.querySelector('main, article, [role="main"], #main, .content, #content') || doc.body || null;
  }

  // tools/adapters/page-outline.js
  var STYLED_HEADINGS = '[role="heading"], .h1, .h2, .h3, .h4, .h5, .h6';
  function levelOf(el) {
    const tag = /^H([1-6])$/.exec(el.tagName);
    if (tag) return Number(tag[1]);
    const aria = Number(el.getAttribute("aria-level"));
    if (aria >= 1) return aria;
    const cls = el.classList && [...el.classList].map((c) => /^h([1-6])$/.exec(c)).find(Boolean);
    if (cls) return Number(cls[1]);
    return 2;
  }
  var PageOutline = {
    containerId: "ai4a11y-page-outline",
    enabled: false,
    style: null,
    // the scoped colour stylesheet (removed on disable)
    addedIds: null,
    // Set of headings we gave a generated id (for exact restore)
    addedTabindex: null,
    // Set of headings we gave tabindex="-1" (for exact restore)
    nav: null,
    toggleBtn: null,
    listBox: null,
    selector: "h1, h2, h3",
    maxLevel: 3,
    _keyHandler: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.addedIds = /* @__PURE__ */ new Set();
      this.addedTabindex = /* @__PURE__ */ new Set();
      this.selector = options.selector || "h1, h2, h3";
      this.maxLevel = options.selector ? 6 : 3;
      this.style = injectStyle(`${this.containerId}-styles`, `
#${this.containerId} { background: #ffffff !important; color: #111111 !important; border-color: #333333 !important; }
#${this.containerId} p, #${this.containerId} li { color: #111111 !important; }
#${this.containerId} a,
#${this.containerId} a:link,
#${this.containerId} a:visited,
#${this.containerId} a:hover,
#${this.containerId} a:focus { color: #0b3d91 !important; background: transparent !important; text-decoration: underline !important; }
#${this.containerId} button { all: unset; box-sizing: border-box; display: block; cursor: pointer; padding: 8px 14px; font: 600 14px/1.4 system-ui, sans-serif !important; color: #111111 !important; }
#${this.containerId} :focus { outline: 3px solid #1a5fb4 !important; outline-offset: 2px !important; }
#${this.containerId} [hidden] { display: none !important; }`);
      const nav = document.createElement("nav");
      nav.id = this.containerId;
      nav.setAttribute("role", "navigation");
      nav.setAttribute("aria-label", "Page outline");
      nav.style.cssText = "position: fixed; bottom: 12px; right: 12px; max-width: min(320px, calc(100vw - 24px)); z-index: 2147483646; background: #fff; color: #111; border: 2px solid #333; border-radius: 8px; font: 14px/1.6 system-ui, sans-serif;";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = "Page outline";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", `${this.containerId}-list`);
      toggle.addEventListener("click", () => this.setOpen(toggle.getAttribute("aria-expanded") !== "true"));
      const box = document.createElement("div");
      box.id = `${this.containerId}-list`;
      box.hidden = true;
      box.style.cssText = "max-height: 60vh; overflow: auto; padding: 0 14px 10px;";
      nav.append(toggle, box);
      this.nav = nav;
      this.toggleBtn = toggle;
      this.listBox = box;
      const count = this.render();
      this._keyHandler = (e) => {
        if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
          this.setOpen(false);
          toggle.focus();
        }
      };
      nav.addEventListener("keydown", this._keyHandler);
      try {
        const parent = document.body || document.documentElement;
        parent.insertBefore(nav, parent.firstChild);
      } catch {
      }
      console.log(`[AI4A11y] Page Outline enabled (${count} headings)`);
      announce(count ? `Page outline ready: ${count} heading${count === 1 ? "" : "s"}` : "Page outline: no headings found");
    },
    // The page's headings, in document order: real ones, plus ones that are only
    // styled as headings. Hidden ones (a carousel's other slides) are left out —
    // their link would jump to nothing.
    findHeadings() {
      let found = [];
      try {
        found = [...document.querySelectorAll(`${this.selector}, ${STYLED_HEADINGS}`)];
      } catch {
      }
      return found.filter((h) => !(this.nav && this.nav.contains(h)) && levelOf(h) <= this.maxLevel && h.textContent.trim() && !h.closest('[hidden], [aria-hidden="true"]') && (typeof h.checkVisibility !== "function" || h.checkVisibility()));
    },
    // (Re)build the list from the page as it is now, so headings the page adds
    // after load show up the next time the outline is opened.
    render() {
      const headings = this.findHeadings();
      const box = this.listBox;
      box.replaceChildren();
      if (headings.length === 0) {
        const note = document.createElement("p");
        note.textContent = "No headings on this page";
        note.style.margin = "0";
        box.appendChild(note);
      } else {
        const list = document.createElement("ul");
        list.style.cssText = "list-style: none; margin: 0; padding: 0;";
        let n = 0;
        for (const heading of headings) {
          if (!heading.id) {
            let id;
            do {
              id = `ai4a11y-outline-h-${n++}`;
            } while (document.getElementById(id));
            heading.id = id;
            this.addedIds.add(heading);
          }
          const item = document.createElement("li");
          const level = levelOf(heading);
          item.style.paddingLeft = `${(level - 1) * 16}px`;
          const link = document.createElement("a");
          link.href = `#${heading.id}`;
          link.textContent = heading.textContent.replace(/\s+/g, " ").trim();
          link.addEventListener("click", (e) => {
            e.preventDefault();
            this.setOpen(false);
            this.jumpTo(heading);
          });
          item.appendChild(link);
          list.appendChild(item);
        }
        box.appendChild(list);
      }
      this.toggleBtn.textContent = headings.length ? `Page outline (${headings.length})` : "Page outline";
      return headings.length;
    },
    setOpen(open) {
      if (!this.toggleBtn) return;
      if (open) this.render();
      this.toggleBtn.setAttribute("aria-expanded", String(open));
      this.listBox.hidden = !open;
    },
    // Move both the viewport and keyboard/screen-reader focus to the heading.
    // Headings aren't focusable by default, so add tabindex="-1" — tracked so
    // disable() removes it again.
    jumpTo(heading) {
      try {
        if (!heading.hasAttribute("tabindex")) {
          heading.setAttribute("tabindex", "-1");
          this.addedTabindex?.add(heading);
        }
        if (typeof heading.scrollIntoView === "function") heading.scrollIntoView({ block: "center" });
        heading.focus({ preventScroll: true });
      } catch {
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      document.getElementById(this.containerId)?.remove();
      this.nav = this.toggleBtn = this.listBox = null;
      this._keyHandler = null;
      try {
        this.style?.remove();
      } catch {
      }
      try {
        document.getElementById(`${this.containerId}-styles`)?.remove();
      } catch {
      }
      this.style = null;
      if (this.addedIds) {
        for (const h of this.addedIds) h.removeAttribute("id");
        this.addedIds.clear();
        this.addedIds = null;
      }
      if (this.addedTabindex) {
        for (const h of this.addedTabindex) h.removeAttribute("tabindex");
        this.addedTabindex.clear();
        this.addedTabindex = null;
      }
      console.log("[AI4A11y] Page Outline disabled");
      announce("Page outline removed");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yPageOutline = PageOutline;

  // tools/adapters/bionic-reading.js
  var MAX_TEXT_NODES = 2e3;
  var LIVE_SEL = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  var RESET = "all: unset;";
  var SR_ONLY = RESET + "position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;user-select:none;-webkit-user-select:none;";
  var RESCAN_MS = 400;
  var BionicReading = {
    markerClass: "ai4a11y-bionic",
    enabled: false,
    handle: null,
    // transformTextNodes handle for the first pass (owns the exact-restore)
    handles: null,
    // later passes, for content the page adds after enable()
    observer: null,
    rescanTimer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const ratio = typeof options.boldRatio === "number" && options.boldRatio > 0 && options.boldRatio <= 1 ? options.boldRatio : 0.4;
      const root = mainRoot();
      if (!root) {
        announce("Bionic reading: no readable text found");
        return;
      }
      this.handles = [];
      this.handle = this.pass(root, ratio, MAX_TEXT_NODES);
      const count = this.handle.records.length;
      if (this.handle.capped) console.log(`[AI4A11y] Bionic Reading: capped at ${MAX_TEXT_NODES} text nodes`);
      console.log(`[AI4A11y] Bionic Reading enabled (${count} text blocks)`);
      announce(count ? "Bionic reading on" : "Bionic reading: no readable text found");
      this.watch(root, ratio);
    },
    // One walk over root. Skips our own wrappers (the primitive skips code/pre/etc.
    // by default) and live regions.
    pass(root, ratio, cap) {
      return transformTextNodes(root, (text, node) => {
        const parent = node.parentElement;
        if (parent && parent.closest && parent.closest(LIVE_SEL)) return null;
        return this.buildSpan(text, ratio);
      }, { skipClass: this.markerClass, cap });
    },
    // Pages add text after load (search results, a cart sheet, a countdown that
    // rewrites itself). Wrap that too, a moment after it lands. Our own
    // wrappers are ignored, so this never reacts to itself.
    watch(root, ratio) {
      if (typeof MutationObserver === "undefined") return;
      const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.markerClass);
      this.observer = new MutationObserver((records) => {
        const fresh = records.some((r) => [...r.addedNodes].some((n) => !ours(n) && !(n.parentElement && n.parentElement.closest && n.parentElement.closest(`.${this.markerClass}`)) && (n.nodeType === 1 || n.nodeType === 3 && /\S/.test(n.nodeValue))));
        if (!fresh || this.rescanTimer) return;
        this.rescanTimer = setTimeout(() => {
          this.rescanTimer = null;
          if (!this.enabled) return;
          const used = this.handles.reduce((n, h2) => n + h2.records.length, this.handle.records.length);
          if (used >= MAX_TEXT_NODES) return;
          const h = this.pass(root, ratio, MAX_TEXT_NODES - used);
          if (h.records.length) this.handles.push(h);
        }, RESCAN_MS);
      });
      this.observer.observe(root, { childList: true, subtree: true });
    },
    // Rebuild one text node's content as a marker <span>, bolding each word's
    // prefix. Whitespace runs are preserved verbatim.
    //
    // A bold prefix splits each word into two text pieces, and screen readers
    // that move by element (VoiceOver on iOS and macOS, TalkBack) then read
    // "Fa ll De als". So the bolded copy is hidden from them and the original
    // text sits beside it, visually hidden, for them to read whole.
    buildSpan(text, ratio) {
      const span = document.createElement("span");
      span.className = this.markerClass;
      span.style.cssText = RESET;
      const shown = document.createElement("span");
      shown.style.cssText = RESET;
      shown.setAttribute("aria-hidden", "true");
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/\s/.test(part)) shown.appendChild(document.createTextNode(part));
        else this.boldWord(shown, part, ratio);
      }
      const spoken = document.createElement("span");
      spoken.style.cssText = SR_ONLY;
      spoken.textContent = text;
      span.appendChild(shown);
      span.appendChild(spoken);
      return span;
    },
    // One word: <b>prefix</b> + plain text node for the rest.
    boldWord(span, word, ratio) {
      const prefixLen = Math.min(word.length, Math.ceil(word.length * ratio));
      const b = document.createElement("b");
      b.style.cssText = "all: unset; font-weight: 700;";
      b.textContent = word.slice(0, prefixLen);
      span.appendChild(b);
      if (prefixLen < word.length) span.appendChild(document.createTextNode(word.slice(prefixLen)));
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.rescanTimer) {
        clearTimeout(this.rescanTimer);
        this.rescanTimer = null;
      }
      for (const h of (this.handles || []).reverse()) h.restore();
      this.handles = null;
      if (this.handle) {
        this.handle.restore();
        this.handle = null;
      }
      console.log("[AI4A11y] Bionic Reading disabled");
      announce("Bionic reading off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yBionicReading = BionicReading;

  // tools/adapters/unpin-sticky.js
  var UnpinSticky = {
    styleId: "ai4a11y-unpin-sticky-styles",
    unpinnedClass: "ai4a11y-unpinned",
    enabled: false,
    unpinned: null,
    // Set of elements we unpinned (for exact restore)
    observer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.unpinned = /* @__PURE__ */ new Set();
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `.${this.unpinnedClass} { position: static !important; }`;
      (document.head || document.documentElement).appendChild(style);
      const count = this.sweep(document);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) {
                this.consider(node);
                if (node.querySelectorAll) this.sweep(node);
              }
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      console.log(`[AI4A11y] Unpin Sticky Bars enabled (${count} unpinned)`);
      announce(count ? `Unpinned ${count} sticky bar${count === 1 ? "" : "s"}` : "Watching for sticky bars to unpin");
    },
    // Scan a root for pinned elements and unpin them; returns how many.
    sweep(root) {
      let n = 0;
      let candidates;
      try {
        candidates = root.querySelectorAll("*");
      } catch {
        return 0;
      }
      for (const el of candidates) if (this.consider(el)) n++;
      return n;
    },
    // Unpin one element if its computed position is fixed or sticky. Returns
    // true if unpinned. Never touches our own injected nodes.
    consider(el) {
      if (!el || el.nodeType !== 1 || this.unpinned.has(el)) return false;
      if (el.id && el.id.startsWith("ai4a11y-")) return false;
      if (el.classList && el.classList.contains(this.unpinnedClass)) return false;
      let pos = "";
      try {
        pos = (getComputedStyle(el).position || "").toLowerCase();
      } catch {
        return false;
      }
      if (pos !== "fixed" && pos !== "sticky") return false;
      if (pos === "fixed") {
        try {
          if (el.matches('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return false;
          const vh = window.innerHeight || 0;
          if (vh && el.getBoundingClientRect().height >= vh * 0.5) return false;
        } catch {
        }
      }
      el.classList.add(this.unpinnedClass);
      this.unpinned.add(el);
      return true;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      document.getElementById(this.styleId)?.remove();
      if (this.unpinned) {
        for (const el of this.unpinned) el.classList?.remove(this.unpinnedClass);
        this.unpinned.clear();
        this.unpinned = null;
      }
      console.log("[AI4A11y] Unpin Sticky Bars disabled");
      announce("Sticky bars restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yUnpinSticky = UnpinSticky;

  // tools/utils/ai-output.js
  var REFUSAL_PREFIXES = ["I cannot", "I'm unable", "I am unable", "Sorry", "I cannot describe", "Unfortunately"];
  var UNCERTAINTY_TERMS = ["unsure", "I don't know", "unclear", "I cannot tell", "cannot determine"];
  var REFUSAL_RE = /^(i (cannot|can't|am unable|don't know)|sorry|unable to|not sure|(n\/a|unknown|no label|not available|unsure)[.!]?\s*$)/i;
  var MAX_SHORT_TEXT_CHARS = 60;
  function straightenApostrophes(text) {
    return text.replace(/[’ʼ]/g, "'");
  }
  function startsWithRefusal(text) {
    if (typeof text !== "string") return false;
    const t = straightenApostrophes(text.trim());
    const lower = t.toLowerCase();
    return REFUSAL_RE.test(t) || REFUSAL_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
  }
  function containsUncertainty(text) {
    if (typeof text !== "string") return false;
    const lower = straightenApostrophes(text).toLowerCase();
    return UNCERTAINTY_TERMS.some((term) => lower.includes(term.toLowerCase()));
  }
  var REFUSAL_VERBS = "translate|simplify|summari[sz]e|rewrite|rephrase|restate|interpret|render|make\\s+out|help|assist|provide|process|read|access|determine|identify|see|view|do|fulfill|complete|comply|generate|produce|answer|respond|perform|proceed|continue|work";
  var TASK_NOUN = "text|content|passage|page|request|translation|simplification|summary|rewrite|rephrasing";
  var TASK_OBJECT = String.raw`(?:with\s+|on\s+)?(?:(?:translat|simplify|summari[sz]|rewrit|rephras)ing\s+)?` + String.raw`(?:(?:this|that|these|those)\b|it[,.!]?\s*$|(?:(?:a|an|the|this|that|these|those|your|any)\s+)?(?:${TASK_NOUN})\b)`;
  var APOLOGY = String.raw`unfortunately|sorry|i(?:['’]m| am) sorry|i apologi[sz]e|as an ai(?: language model| assistant| model)?`;
  var CANNOT = String.raw`i\s+(?:can(?:['’]t|not)|could(?:n['’]t|\s+not)|won['’]t|will\s+not)`;
  var UNABLE = String.raw`i(?:['’]m|\s+am)\s+(?:unable|not\s+(?:able|permitted|allowed))\s+to` + String.raw`|i\s+do(?:n['’]t|\s+not)\s+have\s+(?:the\s+)?(?:ability|permission)\s+to`;
  var FIRST_PERSON_REFUSAL_RE = new RegExp(
    String.raw`^(?:(?:${APOLOGY})\b[,\s]*(?:but\s+)?)*` + String.raw`(?:i(?:['’]m| am) sorry[,.!]?\s*$` + String.raw`|(?:${CANNOT})(?:\s+(?:${REFUSAL_VERBS}))?[,.!]?\s*$` + String.raw`|(?:${UNABLE})\s+(?:${REFUSAL_VERBS})\b` + String.raw`|i do(?:n['’]t| not) know\s+(?:what|which|the|this|that|enough)\b` + String.raw`|(?:${CANNOT})\s+(?:${REFUSAL_VERBS})\s+${TASK_OBJECT})`,
    "i"
  );
  function opensWithFirstPersonRefusal(text) {
    if (typeof text !== "string") return false;
    return FIRST_PERSON_REFUSAL_RE.test(text.trim());
  }
  var PASSIVE_REFUSAL_RE = new RegExp(
    String.raw`^(?:(?:${APOLOGY})\b[,\s]*(?:but\s+)?)*` + String.raw`(?:this|that|the|your)\s+(?:${TASK_NOUN})\s+` + String.raw`(?:can(?:['’]t|not)|could(?:n['’]t|\s+not)|won['’]t|will\s+not)\s+be\s+` + String.raw`(?:translated|simplified|summari[sz]ed|rewritten|rephrased|restated|interpreted|rendered|processed)\b`,
    "i"
  );
  function opensWithPassiveRefusal(text) {
    if (typeof text !== "string") return false;
    return PASSIVE_REFUSAL_RE.test(text.trim());
  }
  var WRAP_PAIRS = [['"', '"'], ["'", "'"], ["\u201C", "\u201D"], ["\u2018", "\u2019"], ["**", "**"], ["`", "`"]];
  var LABEL_PREFIX_RE = /^[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?:\s+(?=\S)/;
  function unwrapOnce(value) {
    for (const [open, close] of WRAP_PAIRS) {
      if (value.length < open.length + close.length) continue;
      if (!value.startsWith(open) || !value.endsWith(close)) continue;
      const inner = value.slice(open.length, value.length - close.length);
      const nested = inner.startsWith(open) && inner.endsWith(close);
      if (inner.includes(open) && !nested) continue;
      return inner.trim();
    }
    return value;
  }
  function cleanShortText(text) {
    if (typeof text !== "string") return text;
    let t = unwrapOnce(text.trim());
    const unlabeled = t.replace(LABEL_PREFIX_RE, "");
    if (unlabeled !== t) {
      t = unwrapOnce(unlabeled);
    }
    return t;
  }
  var SHORT_NON_ANSWER_RE = /^(?:i(?:'m| am) not sure|i do not know|(?:i have )?no idea)\b/i;
  function rejectShortText(text, maxChars = MAX_SHORT_TEXT_CHARS) {
    if (typeof text !== "string") return "not a string";
    const t = cleanShortText(text);
    if (!t) return "empty";
    if (t.length > maxChars) return `longer than ${maxChars} characters`;
    if (/[\r\n]/.test(t)) return "contains a line break";
    if (startsWithRefusal(t)) return "reads as a refusal";
    if (opensWithFirstPersonRefusal(t) || opensWithPassiveRefusal(t)) return "reads as a refusal";
    if (SHORT_NON_ANSWER_RE.test(straightenApostrophes(t))) return "reads as a refusal";
    if (containsUncertainty(t)) return "reads as uncertain";
    return null;
  }
  var RATIO_MIN_INPUT_CHARS = 16;
  function rejectRewrite(output, input, { minRatio = 0, maxRatio = Infinity, minChars = 0 } = {}) {
    if (typeof output !== "string") return "not a string";
    const out = output.trim();
    if (!out) return "empty";
    if (opensWithFirstPersonRefusal(out) || opensWithPassiveRefusal(out)) return "reads as a refusal";
    if (out.length < minChars) return `shorter than ${minChars} characters`;
    const inLen = typeof input === "string" ? input.trim().length : 0;
    if (inLen >= RATIO_MIN_INPUT_CHARS) {
      if (out.length < inLen * minRatio) return `shorter than ${minRatio} of the input`;
      if (out.length > inLen * maxRatio) return `longer than ${maxRatio} times the input`;
    }
    return null;
  }

  // tools/adapters/translate-page.js
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "CODE", "PRE", "TEXTAREA", "KBD", "SAMP"]);
  var SKIP_SEL2 = '[translate="no"], .notranslate, [contenteditable]:not([contenteditable="false"]), [aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  var HTML_NS2 = "http://www.w3.org/1999/xhtml";
  var MAX_PIECES = 1500;
  var MAX_CALLS = 40;
  var BATCH_CHARS = 2e3;
  var BATCH_LINES = 50;
  var CONCURRENCY = 4;
  var RESCAN_MS2 = 800;
  var MAX_REDOS = 2;
  var MIN_TRANSLATED_RATIO = 0.1;
  var MAX_TRANSLATED_RATIO = 8;
  var LANG_CODES = {
    english: "en",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    dutch: "nl",
    chinese: "zh",
    "simplified chinese": "zh-Hans",
    "traditional chinese": "zh-Hant",
    japanese: "ja",
    korean: "ko",
    vietnamese: "vi",
    tagalog: "tl",
    filipino: "fil",
    hindi: "hi",
    arabic: "ar",
    russian: "ru",
    polish: "pl",
    ukrainian: "uk",
    turkish: "tr",
    persian: "fa",
    hebrew: "he",
    greek: "el",
    thai: "th",
    indonesian: "id"
  };
  var memory = /* @__PURE__ */ new Map();
  var MEMORY_MAX = 5e3;
  function remember(key, value) {
    if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
    memory.set(key, value);
  }
  var TranslatePage = {
    enabled: false,
    translated: null,
    // Set of { node, original, value } — one per translated text piece
    targetLang: "English",
    session: 0,
    calls: 0,
    observer: null,
    rescanTimer: null,
    redos: null,
    // WeakMap element -> times its text was translated again
    values: null,
    // WeakMap text node -> the translation we put in it
    tried: null,
    // WeakMap text node -> the text it had when we last sent it
    langBefore: void 0,
    async enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const session = ++this.session;
      this.translated = /* @__PURE__ */ new Set();
      this.redos = /* @__PURE__ */ new WeakMap();
      this.values = /* @__PURE__ */ new WeakMap();
      this.tried = /* @__PURE__ */ new WeakMap();
      this.calls = 0;
      this.targetLang = options.targetLang || options.lang || "English";
      const root = document.body;
      if (!root) {
        announce("Nothing to translate");
        return;
      }
      announce(`Translating to ${this.targetLang}\u2026`);
      const done = await this.translateUnder(root, session, false);
      if (session !== this.session || !this.enabled) return;
      console.log(`[AI4A11y] Translate Page: ${done} text pieces \u2192 ${this.targetLang}` + (this.calls >= MAX_CALLS ? " (stopped at the AI call limit)" : ""));
      announce(done ? `Translated ${done} passages to ${this.targetLang}` : "Translation unavailable");
      this.watch(root, session);
    },
    // Every text piece under root worth translating: it has letters, and it is
    // not code, a script, a live region, or text marked not to translate.
    collect(root) {
      const out = [];
      const walk = (el) => {
        for (let n = el.firstChild; n && out.length < MAX_PIECES; n = n.nextSibling) {
          if (n.nodeType === 3) {
            if (/\p{L}/u.test(n.nodeValue) && !this.isOurs(n)) out.push(n);
          } else if (n.nodeType === 1) {
            if (SKIP_TAGS.has(n.tagName)) continue;
            if (n.namespaceURI && n.namespaceURI !== HTML_NS2) continue;
            if (n.matches && n.matches(SKIP_SEL2)) continue;
            walk(n);
          }
        }
      };
      try {
        walk(root);
      } catch {
      }
      return out;
    },
    isOurs(node) {
      return !!this.values && this.values.get(node) === node.nodeValue;
    },
    // Translate every piece under root: answers already in memory land at once,
    // the rest go to the AI in batches. Returns how many pieces changed.
    async translateUnder(root, session, later) {
      const lang = this.targetLang;
      const nodes = this.collect(root);
      const pending = /* @__PURE__ */ new Map();
      let done = 0;
      for (const node of nodes) {
        if (this.tried.get(node) === node.nodeValue) continue;
        this.tried.set(node, node.nodeValue);
        if (later) {
          const host = node.parentElement;
          const n = host && this.redos.get(host) || 0;
          if (host && n >= MAX_REDOS) continue;
          if (host) this.redos.set(host, n + 1);
        }
        const text = node.nodeValue.replace(/\s+/g, " ").trim();
        const known = memory.get(lang + "\n" + text);
        if (known) {
          done += this.apply(node, known);
          continue;
        }
        if (!pending.has(text)) pending.set(text, []);
        pending.get(text).push(node);
      }
      const batches = [];
      let batch = [], size = 0;
      for (const text of pending.keys()) {
        if (batch.length && (batch.length >= BATCH_LINES || size + text.length > BATCH_CHARS)) {
          batches.push(batch);
          batch = [];
          size = 0;
        }
        batch.push(text);
        size += text.length;
      }
      if (batch.length) batches.push(batch);
      let next = 0;
      const worker = async () => {
        while (next < batches.length && this.enabled && session === this.session && this.calls < MAX_CALLS) {
          const texts = batches[next++];
          this.calls++;
          const answers = await this.ask(texts, lang);
          if (!this.enabled || session !== this.session) return;
          texts.forEach((text, i) => {
            const out = answers[i];
            if (out == null) return;
            remember(lang + "\n" + text, out);
            for (const node of pending.get(text)) done += this.apply(node, out);
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
      if (done && this.langBefore === void 0 && LANG_CODES[lang.toLowerCase()]) {
        this.langBefore = document.documentElement.getAttribute("lang");
        document.documentElement.setAttribute("lang", LANG_CODES[lang.toLowerCase()]);
      }
      return done;
    },
    // One AI call for a batch. A single piece goes as it is; several go as
    // numbered lines, and each line that comes back is matched to its piece by
    // its number, so one garbled line costs only that piece. Every answer is
    // gated before it replaces what the reader sees: a refusal or a fragment
    // leaves the piece as it was.
    async ask(texts, lang) {
      const answers = new Array(texts.length).fill(null);
      let reply;
      const input = texts.length === 1 ? texts[0] : texts.map((t, i) => `[${i + 1}] ${t}`).join("\n");
      try {
        reply = await translateText(input, lang);
      } catch (e) {
        console.warn("[AI4A11y] Translate: left text untouched, provider error:", e);
        return answers;
      }
      if (reply == null) return answers;
      let outs;
      if (texts.length === 1) outs = [reply];
      else {
        if (typeof reply !== "string") return answers;
        outs = new Array(texts.length).fill(null);
        let at = -1;
        for (const line of reply.split("\n")) {
          const m = /^\s*\[(\d{1,3})\]\s?(.*)$/.exec(line);
          if (m) {
            at = Number(m[1]) - 1;
            if (at >= 0 && at < outs.length) outs[at] = m[2];
            else at = -1;
          } else if (at >= 0 && line.trim()) outs[at] += " " + line.trim();
        }
      }
      let rejectedCount = 0;
      outs.forEach((out, i) => {
        if (out == null) return;
        const rejected = rejectRewrite(out, texts[i], { minRatio: MIN_TRANSLATED_RATIO, maxRatio: MAX_TRANSLATED_RATIO }) || (texts.length > 1 && /\[\d{1,3}\]/.test(out) ? "holds another line" : null);
        if (rejected) {
          rejectedCount++;
          return;
        }
        answers[i] = out.trim();
      });
      if (rejectedCount) console.warn(`[AI4A11y] Translate: left ${rejectedCount} piece(s) untouched, rejected model output`);
      return answers;
    },
    // Put a translation in one text node, keeping the spaces around it so words
    // next to links and bold text do not run together.
    apply(node, out) {
      if (!node.parentNode) return 0;
      const original = node.nodeValue;
      const lead = /^\s*/.exec(original)[0], trail = /\s*$/.exec(original)[0];
      const value = lead + out + trail;
      if (value === original) return 0;
      node.nodeValue = value;
      this.values.set(node, value);
      this.translated.add({ node, original, value });
      return 1;
    },
    // Pages add text after load (search results, a cart sheet, an error). It is
    // translated too, a moment after it lands, within the same call budget.
    watch(root, session) {
      if (typeof MutationObserver === "undefined" || this.calls >= MAX_CALLS) return;
      this.observer = new MutationObserver((records) => {
        const fresh = records.some((r) => r.type === "characterData" ? !this.isOurs(r.target) : [...r.addedNodes].some((n) => n.nodeType === 1 || n.nodeType === 3 && /\p{L}/u.test(n.nodeValue)));
        if (!fresh || this.rescanTimer) return;
        this.rescanTimer = setTimeout(async () => {
          this.rescanTimer = null;
          if (!this.enabled || session !== this.session) return;
          if (this.calls >= MAX_CALLS) {
            this.observer?.disconnect();
            return;
          }
          await this.translateUnder(root, session, true);
        }, RESCAN_MS2);
      });
      this.observer.observe(root, { childList: true, characterData: true, subtree: true });
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      this.session++;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.rescanTimer) {
        clearTimeout(this.rescanTimer);
        this.rescanTimer = null;
      }
      if (this.translated) {
        for (const { node, original, value } of this.translated) {
          try {
            if (node.nodeValue === value) node.nodeValue = original;
          } catch {
          }
        }
        this.translated.clear();
        this.translated = null;
      }
      if (this.langBefore !== void 0) {
        if (this.langBefore === null) document.documentElement.removeAttribute("lang");
        else document.documentElement.setAttribute("lang", this.langBefore);
        this.langBefore = void 0;
      }
      announce("Original text restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yTranslatePage = TranslatePage;

  // tools/adapters/mute-sounds.js
  var MuteSounds = {
    enabled: false,
    muted: null,
    // Set of elements we muted (for exact restore)
    observer: null,
    playHandler: null,
    volumeHandler: null,
    // re-mutes media a script un-mutes
    inputHandler: null,
    // remembers the person's last click or key, see volumeHandler
    lastInput: null,
    userUnmuted: null,
    // WeakSet of media the person un-muted with its own controls
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.muted = /* @__PURE__ */ new Set();
      const count = this.sweep(document);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) this.consider(node);
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      this.playHandler = (e) => {
        if (!this.enabled) return;
        const el = e.target;
        if (el && (el.tagName === "VIDEO" || el.tagName === "AUDIO")) this.muteEl(el);
      };
      document.addEventListener("play", this.playHandler, true);
      this.lastInput = null;
      this.inputHandler = (e) => {
        if (e.isTrusted) this.lastInput = { target: e.target, at: Date.now() };
      };
      for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, this.inputHandler, true);
      this.userUnmuted = /* @__PURE__ */ new WeakSet();
      this.volumeHandler = (e) => {
        if (!this.enabled) return;
        const el = e.target;
        if (!el || el.tagName !== "VIDEO" && el.tagName !== "AUDIO" || el.muted) return;
        const last = this.lastInput;
        const own = last && Date.now() - last.at < 1e3 && (last.target === el || el.contains && el.contains(last.target));
        if (own) {
          this.userUnmuted.add(el);
          return;
        }
        this.muteEl(el);
      };
      document.addEventListener("volumechange", this.volumeHandler, true);
      console.log(`[AI4A11y] Mute Sounds enabled (${count} muted)`);
      announce(count ? `Muted ${count} sound source${count === 1 ? "" : "s"}` : "Watching for sounds to mute");
    },
    // Scan a root for media and mute it; returns how many were muted.
    sweep(root) {
      let n = 0;
      let media;
      try {
        media = root.querySelectorAll("video, audio");
      } catch {
        return 0;
      }
      for (const el of media) if (this.muteEl(el)) n++;
      return n;
    },
    // An added node may itself be media, or contain media (embedded players).
    consider(node) {
      if (node.tagName === "VIDEO" || node.tagName === "AUDIO") this.muteEl(node);
      if (node.querySelectorAll) this.sweep(node);
    },
    // Mute one element if it is playing sound the user didn't silence. Only
    // elements WE mute are tracked, so disable() never un-mutes a user's choice.
    // No early-return for already-tracked elements: a script may have un-muted
    // one, and the play listener routes it back here to be re-muted.
    muteEl(el) {
      if (!el) return false;
      if (this.userUnmuted && this.userUnmuted.has(el)) return false;
      try {
        if (el.muted === false) {
          el.muted = true;
          this.muted.add(el);
          return true;
        }
      } catch {
      }
      return false;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.playHandler) {
        document.removeEventListener("play", this.playHandler, true);
        this.playHandler = null;
      }
      if (this.volumeHandler) {
        document.removeEventListener("volumechange", this.volumeHandler, true);
        this.volumeHandler = null;
      }
      if (this.inputHandler) {
        for (const type of ["pointerdown", "keydown"]) document.removeEventListener(type, this.inputHandler, true);
        this.inputHandler = null;
      }
      this.lastInput = null;
      this.userUnmuted = null;
      if (this.muted) {
        for (const el of this.muted) {
          try {
            el.muted = false;
          } catch {
          }
        }
        this.muted.clear();
        this.muted = null;
      }
      console.log("[AI4A11y] Mute Sounds disabled");
      announce("Sounds unmuted");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yMuteSounds = MuteSounds;

  // tools/adapters/define-words.js
  var SKIP_TAGS2 = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "CODE",
    "PRE",
    "TEXTAREA",
    "INPUT",
    "A",
    "BUTTON",
    "LABEL",
    "SELECT",
    "OPTION",
    "SUMMARY",
    "NOSCRIPT",
    "TEMPLATE"
  ]);
  var SKIP_SEL3 = '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable], [aria-hidden="true"], [hidden], [aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  var MAX_WORDS = 500;
  var MAX_TAB_STOPS = 60;
  var MAX_LOOKUPS = 40;
  var HOVER_DELAY_MS = 350;
  var RESCAN_MS3 = 400;
  var STYLE_ID2 = "ai4a11y-define-styles";
  var TOOLTIP_ID = "ai4a11y-define-tooltip";
  var HINT_ID = "ai4a11y-define-hint";
  var CONTEXT_SEL = "p, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6";
  var CONTEXT_CHARS = 200;
  var DefineWords = {
    markerClass: "ai4a11y-define",
    // the per-word interactive spans
    wrapperClass: "ai4a11y-define-wrap",
    // the text-node replacement wrappers
    enabled: false,
    wrapped: null,
    // Set of { span (wrapper), originalNode } (for exact restore)
    definitions: null,
    // Map lowercased word -> Promise of a definition or null (null cached too, so a dead provider isn't re-asked)
    showHandler: null,
    hideHandler: null,
    keyHandler: null,
    current: null,
    // the word span the reader is on right now
    hoverTimer: null,
    observer: null,
    rescanTimer: null,
    count: 0,
    // words wrapped
    tabStops: 0,
    seen: null,
    // lowercased words that already have a Tab stop
    said: null,
    // definitions already read out to a keyboard user
    ready: null,
    // Map lowercased word -> definition, for lookups that have finished
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.wrapped = /* @__PURE__ */ new Set();
      this.definitions = /* @__PURE__ */ new Map();
      this.ready = /* @__PURE__ */ new Map();
      this.seen = /* @__PURE__ */ new Set();
      this.count = 0;
      this.tabStops = 0;
      const minLength = typeof options.minLength === "number" && options.minLength > 0 ? options.minLength : 8;
      let root = null;
      try {
        root = document.querySelector('main, article, [role="main"]') || document.getElementById("main") || mainRoot();
      } catch {
      }
      if (!root) {
        console.log("[AI4A11y] Define Words: no content root found");
        announce("Define words: no readable text found");
        return;
      }
      this.injectStyles();
      this.wrapUnder(root, minLength);
      if (this.count >= MAX_WORDS) console.log(`[AI4A11y] Define Words: capped at ${MAX_WORDS} words`);
      this.showHandler = (e) => this.handleShow(e);
      this.hideHandler = (e) => this.handleHide(e);
      this.keyHandler = (e) => {
        if (e.key === "Escape") this.hideTooltip();
      };
      document.addEventListener("mouseover", this.showHandler);
      document.addEventListener("focusin", this.showHandler);
      document.addEventListener("mouseout", this.hideHandler);
      document.addEventListener("focusout", this.hideHandler);
      document.addEventListener("keydown", this.keyHandler);
      this.watch(root, minLength);
      console.log(`[AI4A11y] Define Words enabled (${this.count} words)`);
      announce(this.count ? "Word definitions on: hover or focus an underlined word" : "Define words: no long words found");
    },
    // Collect first, then mutate — replacing nodes mid-walk would skip text.
    wrapUnder(root, minLength) {
      const textNodes = [];
      try {
        this.collect(root, textNodes);
      } catch {
      }
      let added = 0;
      for (const textNode of textNodes) {
        if (this.count >= MAX_WORDS) break;
        try {
          const parent = textNode.parentNode;
          if (!parent) continue;
          const built = this.buildWrapper(textNode.nodeValue, minLength, MAX_WORDS - this.count);
          if (!built) continue;
          parent.replaceChild(built.wrap, textNode);
          this.wrapped.add({ span: built.wrap, originalNode: textNode });
          this.count += built.wrappedCount;
          added += built.wrappedCount;
        } catch {
        }
      }
      return added;
    },
    // Depth-first text-node collection under root, skipping SKIP_TAGS subtrees,
    // SKIP_SEL subtrees, wrappers we already built, and text nobody can see
    // (a focusable word inside visually hidden text would be an invisible Tab stop).
    collect(el, out) {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          if (/\S/.test(node.nodeValue) && this.isVisible(el)) out.push(node);
        } else if (node.nodeType === 1 && !SKIP_TAGS2.has(node.tagName) && !(node.classList && node.classList.contains(this.wrapperClass)) && !(node.matches && node.matches(SKIP_SEL3))) {
          this.collect(node, out);
        }
      }
    },
    // Rendered and bigger than a visually-hidden 1px box. Where there is no
    // layout (jsdom, a detached tree) everything counts as visible.
    isVisible(el) {
      if (typeof el.getClientRects !== "function") return true;
      if (!el.getClientRects().length) return !document.documentElement.getClientRects().length;
      const r = el.getBoundingClientRect();
      return !(r.width <= 1 && r.height <= 1 && (r.width || r.height));
    },
    // Pages add text after load (search results, a cart sheet). Wrap that too,
    // a moment after it lands. Our own wrappers are ignored, so this never
    // reacts to itself.
    watch(root, minLength) {
      if (typeof MutationObserver === "undefined") return;
      const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.wrapperClass);
      this.observer = new MutationObserver((records) => {
        const fresh = records.some((r) => [...r.addedNodes].some((n) => !ours(n) && n.id !== TOOLTIP_ID && (n.nodeType === 1 || n.nodeType === 3 && /\S/.test(n.nodeValue))));
        if (!fresh || this.rescanTimer || this.count >= MAX_WORDS) return;
        this.rescanTimer = setTimeout(() => {
          this.rescanTimer = null;
          if (this.enabled) this.wrapUnder(root, minLength);
        }, RESCAN_MS3);
      });
      this.observer.observe(root, { childList: true, subtree: true });
    },
    // Rebuild one text node as a wrapper <span>: qualifying words (alphabetic,
    // long enough, within budget) become interactive spans; everything else —
    // short words, punctuation, whitespace — is re-emitted verbatim as text.
    // Returns null when nothing qualified, so the caller leaves the node alone.
    buildWrapper(text, minLength, budget) {
      const wrap = document.createElement("span");
      wrap.className = this.wrapperClass;
      wrap.style.cssText = "all: unset;";
      let last = 0, wrappedCount = 0;
      const re = /[A-Za-z]+/g;
      let m;
      while (m = re.exec(text)) {
        if (m[0].length < minLength || wrappedCount >= budget) continue;
        if (m.index > last) wrap.appendChild(document.createTextNode(text.slice(last, m.index)));
        wrap.appendChild(this.buildWordSpan(m[0]));
        last = m.index + m[0].length;
        wrappedCount++;
      }
      if (!wrappedCount) return null;
      if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
      return { wrap, wrappedCount };
    },
    buildWordSpan(word) {
      const span = document.createElement("span");
      span.className = this.markerClass;
      span.style.cssText = "all: unset; text-decoration: underline dotted; text-underline-offset: 2px; cursor: help;";
      span.textContent = word;
      const key = word.toLowerCase();
      if (!this.seen || this.seen.has(key) || this.tabStops >= MAX_TAB_STOPS) return span;
      this.seen.add(key);
      this.tabStops++;
      span.setAttribute("tabindex", "0");
      span.setAttribute("role", "button");
      span.setAttribute("aria-describedby", HINT_ID);
      return span;
    },
    injectStyles() {
      try {
        if (!document.getElementById(STYLE_ID2)) {
          const style = document.createElement("style");
          style.id = STYLE_ID2;
          style.textContent = `
          .${this.markerClass}:focus {
            outline: 2px solid #1a5fb4 !important;
            outline-offset: 1px !important;
            box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1a5fb4 !important;
            border-radius: 2px !important;
          }
          #${TOOLTIP_ID} {
            position: absolute;
            z-index: 2147483647;
            box-sizing: border-box;
            max-width: min(320px, calc(100vw - 16px));
            padding: 8px 10px;
            background: #1c1c1e;
            color: #ffffff;
            font: 14px/1.4 system-ui, sans-serif;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
            pointer-events: none;
          }`;
          (document.head || document.documentElement).appendChild(style);
        }
        if (!document.getElementById(HINT_ID)) {
          const hint2 = document.createElement("span");
          hint2.id = HINT_ID;
          hint2.hidden = true;
          hint2.style.cssText = "display: none !important;";
          hint2.textContent = "Shows a short definition";
          (document.body || document.documentElement).appendChild(hint2);
        }
      } catch {
      }
    },
    handleShow(event) {
      try {
        const target = event.target;
        const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
        if (!span) return;
        clearTimeout(this.hoverTimer);
        this.current = span;
        const byKeyboard = event.type === "focusin";
        if (this.ready && this.ready.has((span.textContent || "").trim().toLowerCase())) {
          this.showDefinition(span, byKeyboard).catch(() => {
          });
          return;
        }
        this.hoverTimer = setTimeout(() => {
          this.hoverTimer = null;
          if (this.current === span) this.showDefinition(span, byKeyboard).catch(() => {
          });
        }, HOVER_DELAY_MS);
      } catch {
      }
    },
    handleHide(event) {
      try {
        const target = event.target;
        const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
        if (!span) return;
        if (event.type === "mouseout" && event.relatedTarget && span.contains(event.relatedTarget)) return;
        if (this.current === span) this.current = null;
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
        this.hideTooltip();
      } catch {
      }
    },
    // One lookup per word, shared by every hover and focus that asks while it
    // is on its way. Returns null once the lookup budget is spent.
    lookup(word, span) {
      const key = word.toLowerCase();
      if (this.definitions.has(key)) return this.definitions.get(key);
      if (this.definitions.size >= MAX_LOOKUPS) return null;
      const p = (async () => {
        let def = null;
        try {
          def = await defineWord(word, this.sentenceContext(span)) || null;
        } catch (e) {
          console.warn("[AI4A11y] Define Words: no definition shown, provider error:", e);
        }
        this.ready?.set(key, def);
        return def;
      })();
      this.definitions.set(key, p);
      return p;
    },
    async showDefinition(span, byKeyboard) {
      if (!this.enabled || !this.definitions) return;
      const word = (span.textContent || "").trim();
      if (!word) return;
      const key = word.toLowerCase();
      const p = this.lookup(word, span);
      if (!p) return;
      const def = await p;
      if (!this.enabled || !this.definitions) return;
      if (!def) return;
      if (this.current !== span) return;
      this.showTooltip(span, def);
      if (byKeyboard && !this.said?.has(key)) {
        this.said = this.said || /* @__PURE__ */ new Set();
        this.said.add(key);
        announce(`${word}: ${def}`);
      }
    },
    // The surrounding sentence(s) for the AI prompt: the enclosing text block's
    // content, whitespace-collapsed and truncated to a bounded prompt size.
    sentenceContext(span) {
      try {
        const block = span.closest(CONTEXT_SEL) || span.parentNode;
        return (block?.textContent || "").replace(/\s+/g, " ").trim().slice(0, CONTEXT_CHARS);
      } catch {
        return "";
      }
    },
    showTooltip(span, text) {
      try {
        let tip = document.getElementById(TOOLTIP_ID);
        if (!tip) {
          tip = document.createElement("div");
          tip.id = TOOLTIP_ID;
          tip.setAttribute("role", "tooltip");
          document.body.appendChild(tip);
        }
        tip.textContent = text;
        tip.style.display = "block";
        const rect = span.getBoundingClientRect();
        const viewW = document.documentElement.clientWidth || window.innerWidth || 0;
        const tipW = tip.offsetWidth || 0;
        const left = viewW && tipW ? Math.min(rect.left, viewW - tipW - 8) : rect.left;
        tip.style.left = `${Math.max(8, left) + (window.scrollX || 0)}px`;
        tip.style.top = `${rect.bottom + (window.scrollY || 0) + 6}px`;
        if (span.hasAttribute("tabindex")) span.setAttribute("aria-describedby", TOOLTIP_ID);
      } catch {
      }
    },
    hideTooltip() {
      try {
        const tip = document.getElementById(TOOLTIP_ID);
        if (tip) tip.style.display = "none";
        for (const s of document.querySelectorAll(`[aria-describedby="${TOOLTIP_ID}"]`)) s.setAttribute("aria-describedby", HINT_ID);
      } catch {
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.showHandler) {
        document.removeEventListener("mouseover", this.showHandler);
        document.removeEventListener("focusin", this.showHandler);
        this.showHandler = null;
      }
      if (this.hideHandler) {
        document.removeEventListener("mouseout", this.hideHandler);
        document.removeEventListener("focusout", this.hideHandler);
        this.hideHandler = null;
      }
      if (this.keyHandler) {
        document.removeEventListener("keydown", this.keyHandler);
        this.keyHandler = null;
      }
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
      this.current = null;
      try {
        document.getElementById(TOOLTIP_ID)?.remove();
      } catch {
      }
      try {
        document.getElementById(STYLE_ID2)?.remove();
      } catch {
      }
      try {
        document.getElementById(HINT_ID)?.remove();
      } catch {
      }
      if (this.wrapped) {
        const active = document.activeElement;
        const onWord = active && active.classList && active.classList.contains(this.markerClass);
        let block = null;
        for (const { span, originalNode } of this.wrapped) {
          try {
            if (onWord && span.contains(active)) block = span.parentElement;
            span.parentNode?.replaceChild(originalNode, span);
          } catch {
          }
        }
        if (block && block.isConnected && !block.hasAttribute("tabindex")) {
          block.setAttribute("tabindex", "-1");
          block.addEventListener("blur", () => block.removeAttribute("tabindex"), { once: true });
          try {
            block.focus({ preventScroll: true });
          } catch {
          }
        }
        this.wrapped.clear();
        this.wrapped = null;
      }
      if (this.definitions) {
        this.definitions.clear();
        this.definitions = null;
      }
      this.seen = null;
      this.said = null;
      this.ready = null;
      console.log("[AI4A11y] Define Words disabled");
      announce("Word definitions off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yDefineWords = DefineWords;

  // tools/adapters/stop-auto-advance.js
  var CAROUSEL_SELECTOR = '[class*="carousel"], [class*="slider"], [class*="rotat"], [class*="ticker"], [class*="marquee"], [aria-roledescription="carousel"]';
  var ROTATOR_RE = /carousel|slide|swiper|slick|rotat|hero|banner|ticker|marquee/i;
  var USER_MS = 1500;
  function classNameOf2(el) {
    const c = el && el.className;
    if (typeof c === "string") return c;
    if (c && typeof c.baseVal === "string") return c.baseVal;
    return "";
  }
  function tokensOf(cls) {
    return (cls || "").split(/\s+/).filter(Boolean);
  }
  function pauseQuietly(media, stillWanted) {
    if (!media.paused && media.readyState < 3 && media.currentSrc) {
      const done = () => {
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("pause", done);
      };
      const onPlaying = () => {
        done();
        if (stillWanted()) media.pause();
      };
      media.addEventListener("playing", onPlaying);
      media.addEventListener("pause", done);
    } else {
      media.pause();
    }
  }
  var StopAutoAdvance = {
    styleId: "ai4a11y-stop-autoadvance-styles",
    enabled: false,
    removedMetas: null,
    // Array of { node, parent, nextSibling } for exact restore
    pausedMedia: null,
    // Set of media elements we paused (resume exactly these)
    stoppedMarquees: null,
    // Set of <marquee> elements we stopped
    addedControls: null,
    // Set of paused videos we showed controls on
    observer: null,
    slideObserver: null,
    // watches slides' classes, see onClassChange
    rotating: null,
    // WeakMap slides' parent -> the classes that move between them
    pageHas: null,
    // Map slide -> which of those classes the page last gave it
    scrollPins: null,
    // WeakMap sideways scroller -> its held scrollLeft
    scrollHandler: null,
    inputHandler: null,
    // these three remember the person's last click or key,
    focusHandler: null,
    // focus and pointer move, with where it happened
    hoverHandler: null,
    lastInput: null,
    lastFocus: null,
    lastHover: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.removedMetas = [];
      this.pausedMedia = /* @__PURE__ */ new Set();
      this.stoppedMarquees = /* @__PURE__ */ new Set();
      this.addedControls = /* @__PURE__ */ new Set();
      let metas = [];
      try {
        metas = Array.from(document.querySelectorAll("meta[http-equiv]"));
      } catch {
      }
      for (const meta of metas) {
        try {
          if ((meta.getAttribute("http-equiv") || "").trim().toLowerCase() !== "refresh") continue;
          this.removedMetas.push({ node: meta, parent: meta.parentNode, nextSibling: meta.nextSibling });
          meta.remove();
        } catch {
        }
      }
      const style = document.createElement("style");
      style.id = this.styleId;
      const descendants = CAROUSEL_SELECTOR.split(", ").map((s) => `${s} *`).join(", ");
      style.textContent = `${CAROUSEL_SELECTOR}, ${descendants} { animation-play-state: paused !important; }
${CAROUSEL_SELECTOR} { scroll-behavior: auto !important; }`;
      (document.head || document.documentElement).appendChild(style);
      const stilled = this.sweep(document);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) this.considerLate(node);
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      this.holdScriptedCarousels();
      const total = this.removedMetas.length + stilled;
      console.log(`[AI4A11y] Stop Auto-Advance enabled (${total} stopped)`);
      announce(total ? `Stopped ${total} auto-advancing item${total === 1 ? "" : "s"}; carousels paused` : "Paused carousels; watching for auto-playing media");
    },
    // Still every playing media element and running marquee under root.
    // Returns how many were stopped.
    sweep(root) {
      let n = 0;
      let media = [];
      try {
        media = root.querySelectorAll("video, audio");
      } catch {
        return 0;
      }
      for (const el of media) if (this.considerMedia(el)) n++;
      let marquees = [];
      try {
        marquees = root.querySelectorAll("marquee");
      } catch {
        return n;
      }
      for (const el of marquees) if (this.considerMarquee(el)) n++;
      return n;
    },
    // Pause one media element if it is currently playing. Returns true if we
    // paused it (and will therefore resume it on disable).
    considerMedia(el) {
      try {
        if (!el || el.paused !== false || this.pausedMedia.has(el)) return false;
        if (typeof el.pause === "function") pauseQuietly(el, () => this.enabled);
        this.pausedMedia.add(el);
        if (el.tagName === "VIDEO" && !el.controls) {
          el.controls = true;
          this.addedControls.add(el);
        }
        return true;
      } catch {
        return false;
      }
    },
    considerMarquee(el) {
      try {
        if (!el || this.stoppedMarquees.has(el)) return false;
        if (typeof el.stop === "function") el.stop();
        this.stoppedMarquees.add(el);
        return true;
      } catch {
        return false;
      }
    },
    // A node added after enable: still it if it is itself media/marquee,
    // otherwise sweep whatever it contains.
    considerLate(el) {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "video" || tag === "audio") {
        this.considerMedia(el);
        return;
      }
      if (tag === "marquee") {
        this.considerMarquee(el);
        return;
      }
      if (el.querySelectorAll) {
        this.sweep(el);
        this.pinScrollers(el);
      }
    },
    // Carousels a script moves on a timer: the stylesheet above can't reach
    // them. Two kinds are held still, each time they move with no click, key
    // press, touch, wheel or focus inside that carousel just before: a row
    // whose scrollLeft a timer steps along, and slides where a timer moves a
    // class such as "is-current" or "active" from one slide to the next. Its
    // arrow buttons, swipes, the wheel and the keyboard still move it. Only
    // boxes named like a carousel, slider, banner or ticker are held, so a
    // page scrolling its own tab strip to the open tab is left alone.
    holdScriptedCarousels() {
      if (typeof document === "undefined" || !document.addEventListener || !document.body) return;
      this.lastInput = this.lastFocus = this.lastHover = null;
      const note = (key) => (e) => {
        if (e.isTrusted) this[key] = { at: Date.now(), target: e.target };
      };
      this.inputHandler = note("lastInput");
      this.focusHandler = note("lastFocus");
      this.hoverHandler = note("lastHover");
      for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
        document.addEventListener(type, this.inputHandler, { capture: true, passive: true });
      }
      document.addEventListener("focusin", this.focusHandler, true);
      document.addEventListener("mouseover", this.hoverHandler, { capture: true, passive: true });
      this.scrollPins = /* @__PURE__ */ new WeakMap();
      this.pinScrollers(document.body);
      this.scrollHandler = (e) => this.onScroll(e);
      document.addEventListener("scroll", this.scrollHandler, { capture: true, passive: true });
      this.rotating = /* @__PURE__ */ new WeakMap();
      this.pageHas = /* @__PURE__ */ new Map();
      if (typeof MutationObserver !== "undefined") {
        this.slideObserver = new MutationObserver((records) => this.onClassChange(records));
        this.slideObserver.observe(document.body, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });
      }
    },
    // The carousel around a node: the outermost of it and its two parents
    // named like one (arrow buttons usually sit there), or null.
    carouselOf(node) {
      let box = null;
      for (let n = node, i = 0; n && n.nodeType === 1 && n !== document.body && i < 3; n = n.parentElement, i++) {
        if (ROTATOR_RE.test(classNameOf2(n)) || /carousel|slide/i.test(n.getAttribute("aria-roledescription") || "")) box = n;
      }
      return box;
    },
    // Did the person just click, press a key, touch, scroll or focus inside this carousel?
    byUser(box, hoverToo) {
      const near = (rec, ms) => !!rec && Date.now() - rec.at < ms && rec.target && rec.target.nodeType === 1 && box.contains(rec.target);
      return near(this.lastInput, USER_MS) || near(this.lastFocus, USER_MS) || hoverToo && near(this.lastHover, 50);
    },
    // Remember where each carousel row that scrolls sideways is now.
    pinScrollers(root) {
      if (!this.scrollPins || !root || !root.querySelectorAll) return;
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (el.scrollWidth > el.clientWidth + 1 && !this.scrollPins.has(el) && this.carouselOf(el)) this.scrollPins.set(el, el.scrollLeft);
      }
    },
    onScroll(e) {
      const el = e.target;
      if (!this.enabled || !el || el.nodeType !== 1) return;
      const box = this.carouselOf(el);
      if (!box) return;
      const pin = this.scrollPins.get(el);
      if (pin === void 0 || this.byUser(box, false)) {
        this.scrollPins.set(el, el.scrollLeft);
        return;
      }
      if (Math.abs(el.scrollLeft - pin) < 0.5) return;
      try {
        el.scrollTo({ left: pin, behavior: "instant" });
      } catch {
        el.scrollLeft = pin;
      }
    },
    // A class moved from one slide to the next. Only such moving classes are
    // touched (other adapters' classes on the same elements are left alone),
    // and each move is put back unless the person made it.
    onClassChange(records) {
      if (!this.enabled) return;
      const before = /* @__PURE__ */ new Map();
      for (const r of records) if (r.target.nodeType === 1 && !before.has(r.target)) before.set(r.target, r.oldValue);
      const changes = [];
      for (const [el, was] of before) {
        const now = el.getAttribute("class");
        const a = tokensOf(was), b = tokensOf(now);
        changes.push({ el, now, gained: b.filter((t) => !a.includes(t)), lost: a.filter((t) => !b.includes(t)) });
      }
      for (const c of changes) {
        const parent = c.el.parentElement;
        for (const t of c.gained) {
          if (/^ai4a11y-/.test(t) || (this.rotating.get(parent) || /* @__PURE__ */ new Set()).has(t)) continue;
          if (changes.some((d) => d !== c && d.el.parentElement === parent && d.lost.includes(t)) && this.isSlide(c.el)) {
            if (!this.rotating.has(parent)) this.rotating.set(parent, /* @__PURE__ */ new Set());
            this.rotating.get(parent).add(t);
          }
        }
      }
      let wrote = false;
      for (const c of changes) {
        const moving = c.el.parentElement && this.rotating.get(c.el.parentElement);
        if (!moving) continue;
        this.pageHas.set(c.el, new Set(tokensOf(c.now).filter((t) => moving.has(t))));
        if (!c.gained.concat(c.lost).some((t) => moving.has(t))) continue;
        if (this.byUser(this.carouselOf(c.el) || c.el.parentElement, true)) {
          this.showPageView(c.el.parentElement);
        } else {
          for (const t of c.gained) if (moving.has(t)) c.el.classList.remove(t);
          for (const t of c.lost) if (moving.has(t)) c.el.classList.add(t);
        }
        wrote = true;
      }
      if (wrote && this.slideObserver) this.slideObserver.takeRecords();
    },
    showPageView(parent) {
      const moving = this.rotating.get(parent);
      if (!moving) return;
      for (const sib of Array.from(parent.children)) {
        const has = this.pageHas.get(sib);
        if (has) for (const t of moving) sib.classList.toggle(t, has.has(t));
      }
    },
    // One of two or more like siblings (same tag, a class in common) in
    // something named like a carousel, slider or banner.
    isSlide(el) {
      const parent = el.parentElement;
      if (!parent || el === document.body || parent === document.documentElement || !this.carouselOf(el)) return false;
      const mine = tokensOf(classNameOf2(el));
      return Array.from(parent.children).some((s) => s !== el && s.tagName === el.tagName && tokensOf(classNameOf2(s)).some((t) => mine.includes(t)));
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      if (this.removedMetas) {
        for (const { node, parent, nextSibling } of this.removedMetas) {
          if (!parent) continue;
          try {
            parent.insertBefore(node, nextSibling);
          } catch {
            try {
              parent.appendChild(node);
            } catch {
            }
          }
        }
        this.removedMetas = null;
      }
      if (this.pausedMedia) {
        for (const el of this.pausedMedia) {
          try {
            if (typeof el.play === "function") el.play()?.catch?.(() => {
            });
          } catch {
          }
        }
        this.pausedMedia.clear();
        this.pausedMedia = null;
      }
      if (this.stoppedMarquees) {
        for (const el of this.stoppedMarquees) {
          try {
            if (typeof el.start === "function") el.start();
          } catch {
          }
        }
        this.stoppedMarquees.clear();
        this.stoppedMarquees = null;
      }
      if (this.addedControls) {
        for (const el of this.addedControls) {
          try {
            el.controls = false;
          } catch {
          }
        }
        this.addedControls = null;
      }
      if (this.slideObserver) {
        this.slideObserver.disconnect();
        this.slideObserver = null;
      }
      if (this.pageHas) {
        for (const [el, has] of this.pageHas) {
          const moving = el.parentElement && this.rotating.get(el.parentElement);
          if (moving) for (const t of moving) el.classList.toggle(t, has.has(t));
        }
        this.pageHas = null;
        this.rotating = null;
      }
      if (this.scrollHandler) {
        document.removeEventListener("scroll", this.scrollHandler, { capture: true });
        this.scrollHandler = null;
      }
      if (this.inputHandler) {
        for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) document.removeEventListener(type, this.inputHandler, { capture: true });
        this.inputHandler = null;
      }
      if (this.hoverHandler) {
        document.removeEventListener("mouseover", this.hoverHandler, { capture: true });
        this.hoverHandler = null;
      }
      if (this.focusHandler) {
        document.removeEventListener("focusin", this.focusHandler, true);
        this.focusHandler = null;
      }
      this.scrollPins = null;
      this.lastInput = this.lastFocus = this.lastHover = null;
      console.log("[AI4A11y] Stop Auto-Advance disabled");
      announce("Auto-advancing content resumed");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yStopAutoAdvance = StopAutoAdvance;

  // tools/adapters/reduce-brightness.js
  var PAGE_FILTER3 = "html { filter: var(--ai4a11y-filter-dark,) var(--ai4a11y-filter-dim,) var(--ai4a11y-filter-color,) !important; }";
  var ReduceBrightness = {
    styleId: "ai4a11y-reduce-brightness-styles",
    htmlClass: "ai4a11y-dimmed",
    overlayId: "ai4a11y-dim-overlay",
    enabled: false,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const bright = options.brightness ?? 0.82;
      const sat = options.saturation ?? 0.9;
      const dimLevel = options.dim ?? 0;
      try {
        document.documentElement.classList.add(this.htmlClass);
      } catch {
      }
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
html.${this.htmlClass} { --ai4a11y-filter-dim: brightness(${bright}) saturate(${sat}); }
${PAGE_FILTER3}`;
      (document.head || document.documentElement).appendChild(style);
      if (dimLevel > 0) {
        const overlay = document.createElement("div");
        overlay.id = this.overlayId;
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = `rgba(0, 0, 0, ${dimLevel})`;
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483646";
        (document.body || document.documentElement).appendChild(overlay);
      }
      console.log("[AI4A11y] Reduce Brightness enabled");
      announce("Screen dimmed");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      try {
        document.documentElement?.classList.remove(this.htmlClass);
      } catch {
      }
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      try {
        document.getElementById(this.overlayId)?.remove();
      } catch {
      }
      console.log("[AI4A11y] Reduce Brightness disabled");
      announce("Screen brightness restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yReduceBrightness = ReduceBrightness;

  // tools/adapters/sound-visualizer.js
  var INDICATOR_ID = "ai4a11y-sound-indicator";
  var FLASH_MS = 1200;
  function isAudible(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag !== "VIDEO" && tag !== "AUDIO") return false;
    return el.muted !== true && el.volume > 0;
  }
  function isSounding(el) {
    return isAudible(el) && el.paused === false && el.ended !== true;
  }
  var SoundVisualizer = {
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
      const indicator = document.createElement("div");
      indicator.id = INDICATOR_ID;
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");
      indicator.style.cssText = "position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;padding: 10px 16px; border-radius: 8px;background: rgba(0, 0, 0, 0.85); color: #fff;font: 600 15px/1.2 system-ui, sans-serif;pointer-events: none; display: none;";
      (document.body || document.documentElement).appendChild(indicator);
      this.indicator = indicator;
      this.playHandler = (e) => {
        if (!this.enabled) return;
        if (isAudible(e.target)) this.flash();
      };
      this.volumeHandler = (e) => {
        if (!this.enabled) return;
        if (isAudible(e.target) && e.target.paused === false) this.flash();
      };
      this.stopHandler = () => {
        if (!this.enabled || this.hideTimer) return;
        if (!this._anySounding()) this._hide();
      };
      document.addEventListener("play", this.playHandler, true);
      document.addEventListener("volumechange", this.volumeHandler, true);
      document.addEventListener("pause", this.stopHandler, true);
      document.addEventListener("ended", this.stopHandler, true);
      document.addEventListener("volumechange", this.stopHandler, true);
      if (this._anySounding()) this.flash();
      console.log("[AI4A11y] Sound Visualizer enabled");
      announce("Sound indicator on. A sign shows on screen while the page plays sound");
    },
    // Show the indicator, restarting the auto-hide window on every new cue.
    // After the flash window it stays up while any media is still sounding.
    flash() {
      if (!this.indicator) return;
      if (this.indicator.style.display === "none" || !this.indicator.textContent) {
        this.indicator.style.display = "block";
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "\u{1F50A} ";
        this.indicator.replaceChildren(icon, "Sound playing");
      }
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (!this._anySounding()) this._hide();
      }, this.flashMs);
    },
    _hide() {
      if (this.indicator) this.indicator.style.display = "none";
    },
    _anySounding() {
      return [...document.querySelectorAll("video, audio")].some(isSounding);
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      try {
        if (this.playHandler) document.removeEventListener("play", this.playHandler, true);
        if (this.volumeHandler) document.removeEventListener("volumechange", this.volumeHandler, true);
        if (this.stopHandler) {
          document.removeEventListener("pause", this.stopHandler, true);
          document.removeEventListener("ended", this.stopHandler, true);
          document.removeEventListener("volumechange", this.stopHandler, true);
        }
      } catch {
      }
      this.playHandler = this.volumeHandler = this.stopHandler = null;
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.indicator?.remove();
      this.indicator = null;
      console.log("[AI4A11y] Sound Visualizer disabled");
      announce("Sound indicator off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11ySoundVisualizer = SoundVisualizer;

  // tools/adapters/live-region-announcer.js
  var MAX_ANNOUNCE_CHARS = 120;
  var MAX_LINES = 3;
  var TICK_MS = 1100;
  var LIST_REDRAW = 3;
  var ACTION_MS = 3e3;
  var PAGE_SPOKE_MS = 2e3;
  var LIVE = '[aria-live]:not([aria-live="off"]), [role="alert"], [role="status"], [role="log"]';
  var OTHER_UI = '[id^="ai4a11y-"], [class*="ai4a11y-"], [id^="ws-"], [class^="ws-"], [class*=" ws-"]';
  var MESSAGE_HINT = /\b(error|alert|warning|notice|toast|snackbar|notification|message|status)/i;
  var INTERACTIVE = 'a[href], button, [role="button"], [role="link"], input, select, textarea';
  var LiveRegionAnnouncer = {
    enabled: false,
    observer: null,
    debounceMs: 300,
    debounceTimer: null,
    pending: null,
    lastAction: 0,
    // when the person last clicked, typed Enter/Space, or changed a field
    pageSpokeAt: 0,
    // when one of the page's own live regions last changed
    textTimers: null,
    // Map: element -> timer for text written into it (see TICK_MS)
    textChangedAt: null,
    // Map: element -> when its text last changed
    tickers: null,
    // WeakSet of elements found to change on a timer
    _onAction: null,
    _onKey: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.debounceMs = options.debounceMs ?? 300;
      this.pending = null;
      this.lastAction = 0;
      this.pageSpokeAt = 0;
      this.textTimers = /* @__PURE__ */ new Map();
      this.textChangedAt = /* @__PURE__ */ new Map();
      this.tickers = /* @__PURE__ */ new WeakSet();
      this._onAction = () => {
        this.lastAction = Date.now();
      };
      this._onKey = (e) => {
        if (e.key === "Enter" || e.key === " ") this.lastAction = Date.now();
      };
      for (const type of ["click", "change", "input", "submit"]) document.addEventListener(type, this._onAction, true);
      document.addEventListener("keydown", this._onKey, true);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          this.onMutations(mutations);
        });
        const target = document.body || document.documentElement;
        if (target) this.observer.observe(target, { childList: true, subtree: true, characterData: false });
      }
      console.log("[AI4A11y] Live-Region Announcer enabled");
      announce("Announcing page updates");
    },
    onMutations(mutations) {
      const answering = Date.now() - this.lastAction < ACTION_MS;
      for (const m of mutations) {
        const parent = m.target && m.target.nodeType === 1 ? m.target : null;
        if (!parent || parent.closest(OTHER_UI)) continue;
        if (parent.closest(LIVE)) {
          this.pageSpokeAt = Date.now();
          continue;
        }
        const added = [...m.addedNodes];
        if (added.some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
          if (answering || this.isMessage(parent)) this.textChanged(parent);
          continue;
        }
        const elements = added.filter((n) => n.nodeType === 1);
        if (elements.length >= LIST_REDRAW) continue;
        for (const node of elements) {
          if (this.ignored(node)) continue;
          if (node.getAttribute("role") === "alert") {
            this.pageSpokeAt = Date.now();
            continue;
          }
          if (this.isUrgent(node)) {
            const text = this.summarize(node);
            if (text) this.speak(text);
          } else if (answering || this.isMessage(node)) {
            this.pending = node;
            this.schedule();
          }
        }
      }
    },
    // Other adapters' panels and notes, and anything added inside a live region
    // the screen reader already reads by itself.
    ignored(el) {
      if (!el.closest) return false;
      if (el.closest(OTHER_UI)) return true;
      return !!(el.parentElement && el.parentElement.closest(LIVE));
    },
    // The page calls it an error, alert, notice, toast... (itself or the box it is in).
    isMessage(el) {
      for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
        if (MESSAGE_HINT.test(`${e.id || ""} ${typeof e.className === "string" ? e.className : ""}`)) return true;
      }
      return false;
    },
    textChanged(el) {
      if (this.tickers.has(el)) return;
      if (this.textTimers.has(el)) {
        clearTimeout(this.textTimers.get(el));
        this.textTimers.delete(el);
        if (!(this.lastAction > this.textChangedAt.get(el))) {
          this.tickers.add(el);
          return;
        }
      }
      this.textChangedAt.set(el, Date.now());
      this.textTimers.set(el, setTimeout(() => {
        this.textTimers.delete(el);
        if (!this.enabled) return;
        this.pending = el;
        this.schedule();
      }, TICK_MS));
    },
    // Short spoken summary of an element, or '' if it isn't worth announcing
    // (scripts/styles, hidden or near-empty nodes). Read when it is spoken, not
    // when it changed: an error box is often filled first and shown after.
    // The panel's own links and buttons are left out (they are what to do
    // next, not what happened), and only its first few lines are read.
    summarize(el) {
      if (!el || el.nodeType !== 1 || !el.isConnected) return "";
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return "";
      if (el.closest('[hidden], [aria-hidden="true"]')) return "";
      if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return "";
      const focused = document.activeElement;
      if (focused && focused !== document.body && el.contains(focused)) return "";
      const lines = (el2) => {
        const raw = typeof el2.innerText === "string" ? el2.innerText : el2.textContent;
        return (raw || "").split(/\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
      };
      const all = lines(el);
      const controls = /* @__PURE__ */ new Set();
      if (!el.matches(INTERACTIVE)) el.querySelectorAll(INTERACTIVE).forEach((c) => lines(c).forEach((l) => controls.add(l)));
      let kept = all.filter((l) => !controls.has(l));
      if (!kept.length) kept = all;
      let text = "";
      for (const part of kept.slice(0, MAX_LINES)) {
        const next = !text ? part : text + (/[.!?:;,…]$/.test(text) ? " " : ". ") + part;
        if (text && next.length > MAX_ANNOUNCE_CHARS) break;
        text = next;
      }
      if (text.length < 3 && !(tag === "OUTPUT" && text)) return "";
      if (text.length > MAX_ANNOUNCE_CHARS) text = text.slice(0, MAX_ANNOUNCE_CHARS - 1) + "\u2026";
      return text;
    },
    // The page already marked this node as an announcement — speak it now.
    isUrgent(el) {
      if (!el.getAttribute) return false;
      const role = el.getAttribute("role");
      return role === "alert" || role === "status" || el.hasAttribute("aria-live");
    },
    speak(text) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.pending = null;
      announce(text);
    },
    schedule() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (!this.enabled || !this.pending) return;
        if (Date.now() - this.pageSpokeAt < PAGE_SPOKE_MS) {
          this.pending = null;
          return;
        }
        const text = this.summarize(this.pending);
        this.pending = null;
        if (text) announce(text);
      }, this.debounceMs);
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      for (const t of this.textTimers.values()) clearTimeout(t);
      this.textTimers = null;
      this.textChangedAt = null;
      this.tickers = null;
      this.pending = null;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      for (const type of ["click", "change", "input", "submit"]) document.removeEventListener(type, this._onAction, true);
      document.removeEventListener("keydown", this._onKey, true);
      this._onAction = this._onKey = null;
      console.log("[AI4A11y] Live-Region Announcer disabled");
      announce("Stopped announcing page updates");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yLiveRegionAnnouncer = LiveRegionAnnouncer;

  // tools/adapters/magnifier.js
  var Magnifier = {
    lensId: "ai4a11y-magnifier",
    enabled: false,
    lens: null,
    moveHandler: null,
    // ref kept so disable() can remove the exact listener
    leaveHandler: null,
    rafId: null,
    lastEvent: null,
    lastUpdate: 0,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const fontSize = Number(options.fontSize) || 32;
      const lens = document.createElement("div");
      lens.id = this.lensId;
      lens.setAttribute("aria-hidden", "true");
      lens.style.cssText = `
      display: none;
      position: fixed;
      max-width: min(60vw, 640px);
      padding: 12px 18px;
      font-size: ${fontSize}px;
      line-height: 1.35;
      font-family: system-ui, -apple-system, sans-serif;
      color: #ffffff;
      background: #111111;
      border: 2px solid #ffffff;
      border-radius: 12px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
      overflow-wrap: break-word;
      pointer-events: none;
      z-index: 2147483646;
    `;
      (document.body || document.documentElement).appendChild(lens);
      this.lens = lens;
      this.moveHandler = (e) => this.onMove(e);
      this.leaveHandler = () => this.hide();
      document.addEventListener("mousemove", this.moveHandler, { passive: true });
      document.addEventListener("mouseleave", this.leaveHandler);
      console.log("[AI4A11y] Magnifier enabled");
      announce("Magnifier on. Move the pointer over text to enlarge it");
    },
    // Coalesce the mousemove firehose into one lens update per frame (or a
    // ~30ms gate where requestAnimationFrame doesn't exist).
    onMove(e) {
      if (!this.enabled) return;
      this.lastEvent = e;
      if (typeof requestAnimationFrame === "function") {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this.update();
        });
      } else {
        const now = Date.now();
        if (now - this.lastUpdate < 30) return;
        this.lastUpdate = now;
        this.update();
      }
    },
    update() {
      const lens = this.lens;
      const e = this.lastEvent;
      if (!this.enabled || !lens || !e) return;
      try {
        if (typeof document.elementFromPoint !== "function") return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === lens || lens.contains(el)) return;
        const text = this.textAt(e.clientX, e.clientY);
        if (!text) {
          this.hide();
          return;
        }
        lens.textContent = text;
        lens.style.display = "block";
        this.position(e.clientX, e.clientY);
      } catch {
      }
    },
    // The text the pointer is actually on. Taking the hit element's
    // textContent showed a whole card or section, words glued together
    // ("New in booksThe Weeknight Pantry…"), even over blank space. Use the text
    // node under the pointer instead: its element's words if short, else the
    // words around the pointer. Returns '' when the pointer isn't on text.
    textAt(x, y) {
      let node = null, offset = 0;
      if (typeof document.caretPositionFromPoint === "function") {
        const p = document.caretPositionFromPoint(x, y);
        if (p) {
          node = p.offsetNode;
          offset = p.offset;
        }
      } else if (typeof document.caretRangeFromPoint === "function") {
        const r = document.caretRangeFromPoint(x, y);
        if (r) {
          node = r.startContainer;
          offset = r.startOffset;
        }
      }
      if (!node || node.nodeType !== 3 || !node.parentElement) return "";
      const range = document.createRange();
      range.selectNodeContents(node);
      const on = Array.from(range.getClientRects()).some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      if (!on) return "";
      const el = node.parentElement;
      const whole = String(el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (whole.length <= 180) return whole;
      const t = node.data;
      const start = Math.max(0, offset - 80);
      const end = Math.min(t.length, offset + 100);
      const part = t.slice(start, end).replace(/\s+/g, " ").trim();
      return part ? `${start > 0 ? "\u2026" : ""}${part}${end < t.length ? "\u2026" : ""}` : "";
    },
    // Offset the lens from the cursor, flipping to the other side rather than
    // running off the viewport edge.
    position(x, y) {
      const lens = this.lens;
      if (!lens) return;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      let w = 0, h = 0;
      try {
        const r = lens.getBoundingClientRect();
        w = r.width || 0;
        h = r.height || 0;
      } catch {
      }
      let left = x + 24;
      let top = y + 24;
      if (left + w > vw) left = Math.max(8, x - w - 24);
      if (top + h > vh) top = Math.max(8, y - h - 24);
      lens.style.left = `${left}px`;
      lens.style.top = `${top}px`;
    },
    hide() {
      if (this.lens) this.lens.style.display = "none";
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.moveHandler) {
        document.removeEventListener("mousemove", this.moveHandler);
        this.moveHandler = null;
      }
      if (this.leaveHandler) {
        document.removeEventListener("mouseleave", this.leaveHandler);
        this.leaveHandler = null;
      }
      if (this.rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.lastEvent = null;
      this.lastUpdate = 0;
      document.getElementById(this.lensId)?.remove();
      this.lens = null;
      console.log("[AI4A11y] Magnifier disabled");
      announce("Magnifier off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yMagnifier = Magnifier;

  // tools/adapters/flash-guard.js
  var FlashGuard = {
    styleId: "ai4a11y-flash-guard-styles",
    enabled: false,
    tracked: null,
    // Set of { video, hadAutoplay, wasPlaying, hadControls } for exact restore
    observer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.tracked = /* @__PURE__ */ new Set();
      document.querySelectorAll("video").forEach((video) => this.guardVideo(video));
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      video, canvas, img[src*=".gif"], img[src$=".gif"], [class*="gif"] {
        filter: brightness(0.8) contrast(0.85) !important;
      }
    `;
      (document.head || document.documentElement).appendChild(style);
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.tagName === "VIDEO") this.guardVideo(node);
              if (node.querySelectorAll) {
                node.querySelectorAll("video").forEach((v) => this.guardVideo(v));
              }
            }
          }
        });
        this.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      console.log("[AI4A11y] Flash Guard enabled");
      announce("Flash protection on: videos paused and media dimmed");
    },
    // Pause one video and strip its autoplay, recording prior state for restore.
    guardVideo(video) {
      if (!video || !this.tracked) return;
      for (const t of this.tracked) if (t.video === video) return;
      try {
        this.tracked.add({
          video,
          hadAutoplay: video.hasAttribute("autoplay"),
          wasPlaying: !video.paused,
          hadControls: video.controls
        });
        if (!video.paused && video.readyState < 3 && video.currentSrc) {
          const done = () => {
            video.removeEventListener("playing", onPlaying);
            video.removeEventListener("pause", done);
          };
          const onPlaying = () => {
            done();
            if (this.enabled) video.pause();
          };
          video.addEventListener("playing", onPlaying);
          video.addEventListener("pause", done);
        } else {
          video.pause();
        }
        video.removeAttribute("autoplay");
        video.autoplay = false;
        video.controls = true;
      } catch (e) {
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      document.getElementById(this.styleId)?.remove();
      if (this.tracked) {
        for (const { video, hadAutoplay, wasPlaying, hadControls } of this.tracked) {
          try {
            video.controls = hadControls;
            if (hadAutoplay) {
              video.setAttribute("autoplay", "");
              video.autoplay = true;
            }
            if (wasPlaying) {
              const p = video.play();
              if (p && p.catch) p.catch(() => {
              });
            }
          } catch (e) {
          }
        }
        this.tracked.clear();
        this.tracked = null;
      }
      console.log("[AI4A11y] Flash Guard disabled");
      announce("Flash protection off: media restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yFlashGuard = FlashGuard;

  // tools/utils/image.js
  async function imageToDataUrl(img) {
    if (img.src?.startsWith("data:") || img.src?.startsWith("blob:")) {
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
    if (width < 20 && height < 20) return true;
    if (width === 1 && height === 1) return true;
    if (img.getAttribute("role") === "presentation") return true;
    if (img.getAttribute("role") === "none") return true;
    return false;
  }

  // tools/adapters/describe-on-demand.js
  var DescribeOnDemand = {
    // Shown when the provider throws. Fixed on purpose; see describe() below.
    PROVIDER_ERROR_TEXT: "No description is available. The AI provider reported an error; check its settings and try again.",
    styleId: "ai4a11y-describe-styles",
    enabled: false,
    panel: null,
    live: null,
    lastHover: null,
    _reqSeq: 0,
    _liveTimer: null,
    _keyHandler: null,
    _clickHandler: null,
    _moveHandler: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      injectStyle(this.styleId, `
      #ai4a11y-describe-panel {
        position: fixed; bottom: 16px; right: 16px; max-width: 360px; z-index: 2147483647;
        background: #10141a; color: #f2f5f9; border: 2px solid #1a73e8; border-radius: 10px;
        padding: 12px 14px; font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
      }
      #ai4a11y-describe-panel h2 { font-size: 13px; margin: 0 0 6px; color: #8ab4f8; text-transform: uppercase; letter-spacing: .04em; }
      #ai4a11y-describe-panel .ai4a11y-describe-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #f2f5f9; font-size: 18px; cursor: pointer; }
      /* Our own focus ring: a page that turns outlines off everywhere (with
         !important) would otherwise hide the keyboard on the close button. */
      #ai4a11y-describe-panel .ai4a11y-describe-close:focus { outline: 3px solid #8ab4f8 !important; outline-offset: 2px !important; }
    `);
      this.live = document.createElement("div");
      this.live.id = "ai4a11y-describe-live";
      this.live.setAttribute("aria-live", "polite");
      this.live.setAttribute("aria-atomic", "true");
      this.live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      (document.body || document.documentElement).appendChild(this.live);
      this._keyHandler = (e) => {
        if (e.altKey && e.code === "KeyD") {
          e.preventDefault();
          this.describe(this.target());
        }
        if (e.key === "Escape") this.hide();
      };
      document.addEventListener("keydown", this._keyHandler, true);
      this._clickHandler = (e) => {
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          this.describe(e.target);
        }
      };
      document.addEventListener("click", this._clickHandler, true);
      this._moveHandler = (e) => {
        this.lastHover = e.target;
      };
      document.addEventListener("mouseover", this._moveHandler, true);
      announce("Describe on demand ready. Press Alt plus D to describe the focused element, or Alt-click one.");
    },
    target() {
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return a;
      return this.lastHover;
    },
    async describe(el) {
      if (!el || el === document.body || el === document.documentElement) {
        this.show("Focus or point at an element first, then press Alt+D.");
        return;
      }
      const token = ++this._reqSeq;
      this.show("Describing\u2026");
      let desc = null, failed = false;
      try {
        if (el.tagName === "IMG" && (el.currentSrc || el.src)) {
          const dataUrl = await imageToDataUrl(el);
          desc = dataUrl ? await describeImage(dataUrl) : null;
        } else if (el.tagName === "CANVAS" && typeof el.toDataURL === "function") {
          let dataUrl = null;
          try {
            dataUrl = el.toDataURL();
          } catch {
            dataUrl = null;
          }
          desc = dataUrl ? await describeImage(dataUrl) : null;
        } else {
          const label = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title")) || "";
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (text.length > 60) desc = await summarizeText(text);
          else desc = label || text || `A ${el.tagName.toLowerCase()} with no readable content.`;
        }
      } catch (e) {
        console.warn("[AI4A11y] Describe: no description shown, provider error:", e);
        desc = null;
        failed = true;
      }
      if (token !== this._reqSeq) return;
      this.show(desc || (failed ? this.PROVIDER_ERROR_TEXT : "No description is available for that element."));
    },
    show(text) {
      if (!this.panel) {
        this.panel = document.createElement("div");
        this.panel.id = "ai4a11y-describe-panel";
        this.panel.setAttribute("role", "dialog");
        this.panel.setAttribute("aria-label", "Element description");
        const h = document.createElement("h2");
        h.textContent = "Description";
        const close = document.createElement("button");
        close.className = "ai4a11y-describe-close";
        close.setAttribute("aria-label", "Close description");
        close.textContent = "\u2715";
        close.addEventListener("click", () => this.hide());
        const body = document.createElement("p");
        body.className = "ai4a11y-describe-body";
        body.style.margin = "0";
        this.panel.append(close, h, body);
        (document.body || document.documentElement).appendChild(this.panel);
      }
      this.panel.querySelector(".ai4a11y-describe-body").textContent = text;
      this.panel.style.display = "block";
      const live = this.live;
      if (live) {
        live.textContent = "";
        clearTimeout(this._liveTimer);
        this._liveTimer = setTimeout(() => {
          if (this.live === live) live.textContent = text;
        }, 50);
      }
    },
    hide() {
      if (this.panel) this.panel.style.display = "none";
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
      if (this._clickHandler) document.removeEventListener("click", this._clickHandler, true);
      if (this._moveHandler) document.removeEventListener("mouseover", this._moveHandler, true);
      this._keyHandler = this._clickHandler = this._moveHandler = null;
      clearTimeout(this._liveTimer);
      this._liveTimer = null;
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      this.panel?.remove();
      this.panel = null;
      this.live?.remove();
      this.live = null;
      this.lastHover = null;
      announce("Describe on demand off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yDescribeOnDemand = DescribeOnDemand;

  // tools/adapters/reflow-column.js
  var ReflowColumn = {
    styleId: "ai4a11y-reflow-column-styles",
    rootClass: "ai4a11y-reflow",
    gridClass: "ai4a11y-reflow-grid",
    wrapClass: "ai4a11y-reflow-wrap",
    enabled: false,
    style: null,
    marked: null,
    // Set of boxes we gave a marker class (for exact restore)
    unregisterSweep: null,
    resizeHandler: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.marked = /* @__PURE__ */ new Set();
      const width = options.width || 720;
      const scope = `html.${this.rootClass}`;
      this.style = injectStyle(this.styleId, `
${scope} body {
  max-width: ${width}px !important;
  margin: 0 auto !important;
}
/* A minimum width on the page itself is what forces sideways scrolling when
 * zoomed in (e.g. body { min-width: 1280px }). */
${scope}, ${scope} body { min-width: 0 !important; }
/* Floats and CSS multi-column are what put content side by side. Scoped to a
 * FINITE set of block/layout/media elements rather than a universal selector:
 * a universal !important rule defeats the browser style-sharing and forces a
 * whole-tree style+layout recalc that locks the main thread for seconds on
 * large pages. These are the elements that actually get floated or become
 * multi-column; inline/text/table-cell leaves are left untouched. */
${scope} div, ${scope} section, ${scope} article, ${scope} aside, ${scope} main,
${scope} header, ${scope} footer, ${scope} nav, ${scope} figure, ${scope} figcaption,
${scope} p, ${scope} ul, ${scope} ol, ${scope} dl, ${scope} li, ${scope} table,
${scope} blockquote, ${scope} pre, ${scope} form, ${scope} fieldset,
${scope} img, ${scope} picture, ${scope} video, ${scope} iframe {
  float: none !important;
  /* auto, not 1: column-count:1 still makes a multi-column box, which broke
   * two-line clamped product names (they spilled to their full length). */
  column-count: auto !important;
  column-width: auto !important;
}
/* Grid and flex boxes are only changed when they don't fit (fit() finds them):
 * forcing every flex/grid box to display:block also broke rows that fit fine
 * (photo thumbnails, price lines) and moved positioned badges out of place.
 * A grid that doesn't fit becomes one column, keeping its gaps. */
${scope} .${this.gridClass} {
  grid-template-columns: minmax(0, 1fr) !important;
  grid-template-areas: none !important;
}
${scope} .${this.gridClass} > * {
  grid-column: auto !important;
  grid-row: auto !important;
  min-width: 0 !important;
}
/* A flex row that doesn't fit wraps onto more lines. (Its items keep their
 * min-width: lowering it let a search box shrink to one letter instead of
 * moving to its own line.) */
${scope} .${this.wrapClass} { flex-wrap: wrap !important; }
${scope} .${this.wrapClass} > * { max-width: 100% !important; }
/* Media and tables must shrink to the column, never widen it. No height
 * override: height:auto !important re-cropped photos the page sizes with a
 * fixed height and object-fit, and stretched ones with an aspect-ratio. */
${scope} img,
${scope} video,
${scope} iframe,
${scope} table {
  max-width: 100% !important;
}`);
      try {
        document.documentElement.classList.add(this.rootClass);
      } catch {
      }
      this.fit();
      this.unregisterSweep = registerSweep("reflow-column", () => this.fit(), { debounceMs: 300 });
      this.resizeHandler = () => this.fit();
      try {
        window.addEventListener("resize", this.resizeHandler, { passive: true });
      } catch {
      }
      console.log("[AI4A11y] Reflow enabled");
      announce("Page reflowed into a single column");
    },
    // Mark the grid and flex boxes that don't fit the column: their content is
    // wider than the box, or it squeezes text into a strip a few words wide
    // (a cart line's product name, one word per line, beside a fixed-width
    // photo). For squeezed text the OUTERMOST multi-column box around it is
    // changed first: making the page's own columns into one usually gives the
    // inner ones room again, so they keep their layout and their photos keep
    // their size. One pass marks only outermost boxes and the next pass
    // measures again. Only adds classes (never nodes), so the sweep's childList
    // observer does not see its own work.
    fit() {
      if (!this.enabled || typeof document === "undefined" || !document.body) return;
      const kind = (el) => {
        let cs;
        try {
          cs = getComputedStyle(el);
        } catch {
          return null;
        }
        if (cs.overflowX !== "visible" || cs.position === "fixed") return null;
        if (/grid$/.test(cs.display)) return (cs.gridTemplateColumns || "").trim().split(/\s+/).length > 1 ? this.gridClass : null;
        if (/flex$/.test(cs.display) && !cs.flexDirection.startsWith("column") && cs.flexWrap === "nowrap") return this.wrapClass;
        return null;
      };
      for (let pass = 0; pass < 6; pass++) {
        const found = /* @__PURE__ */ new Map();
        const add = (el, cls) => {
          if (this.marked.has(el) || found.has(el)) return;
          for (const f of found.keys()) if (f.contains(el)) return;
          for (const f of [...found.keys()]) if (el.contains(f)) found.delete(f);
          found.set(el, cls);
        };
        for (const el of document.body.querySelectorAll("*")) {
          if (el.id && el.id.startsWith("ai4a11y-")) continue;
          if (el.scrollWidth > el.clientWidth + 1) {
            const cls = kind(el);
            if (cls) add(el, cls);
          }
          if (this.squeezed(el)) {
            let outer = null;
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              if (!this.marked.has(a) && kind(a)) outer = a;
            }
            if (outer) add(outer, kind(outer));
          }
        }
        if (!found.size) break;
        for (const [el, cls] of found) {
          el.classList.add(cls);
          this.marked.add(el);
        }
      }
    },
    // Text of some length wrapped into a strip about two words wide (fewer
    // than ~14 characters a line). Narrower than a phone layout's columns, so
    // a page that is already one column is left as it is.
    squeezed(el) {
      let len = 0;
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) len += n.data.trim().length;
      if (len < 40) return false;
      let w = 0, fs = 0;
      try {
        w = el.getBoundingClientRect().width;
        fs = parseFloat(getComputedStyle(el).fontSize);
      } catch {
        return false;
      }
      if (!w || !fs || w < 2 * fs) return false;
      const perLine = w / (0.5 * fs);
      return perLine < 14 && len > 3 * perLine;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      if (this.resizeHandler) {
        try {
          window.removeEventListener("resize", this.resizeHandler);
        } catch {
        }
        this.resizeHandler = null;
      }
      if (this.marked) {
        for (const el of this.marked) {
          try {
            el.classList.remove(this.gridClass, this.wrapClass);
          } catch {
          }
        }
        this.marked = null;
      }
      try {
        document.documentElement.classList.remove(this.rootClass);
      } catch {
      }
      try {
        this.style?.remove();
      } catch {
      }
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      this.style = null;
      console.log("[AI4A11y] Reflow disabled");
      announce("Page layout restored");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yReflowColumn = ReflowColumn;

  // tools/adapters/focus-locator.js
  var FocusLocator = {
    styleId: "ai4a11y-focus-locator-styles",
    ringId: "ai4a11y-focus-ring",
    enabled: false,
    styleHandle: null,
    ring: null,
    tracked: null,
    // the element the ring is currently following
    focusInHandler: null,
    focusOutHandler: null,
    scrollHandler: null,
    resizeHandler: null,
    rafId: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const color = options && options.color || "#ffbf00";
      this.styleHandle = injectStyle(this.styleId, `
      *:focus:not(#${this.ringId}), *:focus-visible:not(#${this.ringId}) {
        outline: 4px solid ${color} !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 7px color-mix(in srgb, ${color} 40%, transparent) !important;
      }
    `);
      const ring = document.createElement("div");
      ring.id = this.ringId;
      ring.setAttribute("aria-hidden", "true");
      ring.style.cssText = [
        "position: fixed",
        "display: none",
        "pointer-events: none",
        `border: 3px solid ${color}`,
        "border-radius: 4px",
        "background: none",
        "z-index: 2147483646",
        "box-sizing: border-box"
      ].join("; ");
      (document.body || document.documentElement).appendChild(ring);
      this.ring = ring;
      this.focusInHandler = (event) => {
        if (!this.enabled) return;
        let el = event.target;
        while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
        if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return;
        this.tracked = el;
        this.position();
      };
      this.focusOutHandler = () => {
        this.tracked = null;
        if (this.ring) this.ring.style.display = "none";
      };
      document.addEventListener("focusin", this.focusInHandler, true);
      document.addEventListener("focusout", this.focusOutHandler, true);
      const schedule = () => {
        if (!this.tracked || this.rafId !== null) return;
        if (typeof requestAnimationFrame !== "function") {
          this.position();
          return;
        }
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          this.position();
        });
      };
      this.scrollHandler = schedule;
      this.resizeHandler = schedule;
      window.addEventListener("scroll", this.scrollHandler, { capture: true, passive: true });
      window.addEventListener("resize", this.resizeHandler, { passive: true });
      console.log("[AI4A11y] Focus Locator enabled");
      announce("Focus highlighting on");
    },
    // Draw the ring over the tracked element's current viewport rect. Hides
    // (rather than drawing a stray ring) once the element leaves the DOM.
    position() {
      if (!this.enabled || !this.ring || !this.tracked) return;
      if (this.tracked.isConnected === false) {
        this.ring.style.display = "none";
        return;
      }
      try {
        const rect = this.tracked.getBoundingClientRect();
        const st = this.ring.style;
        const box = [`${rect.top}px`, `${rect.left}px`, `${rect.width}px`, `${rect.height}px`];
        if (st.top !== box[0]) st.top = box[0];
        if (st.left !== box[1]) st.left = box[1];
        if (st.width !== box[2]) st.width = box[2];
        if (st.height !== box[3]) st.height = box[3];
        if (st.display !== "block") st.display = "block";
      } catch {
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.focusInHandler) {
        document.removeEventListener("focusin", this.focusInHandler, true);
        this.focusInHandler = null;
      }
      if (this.focusOutHandler) {
        document.removeEventListener("focusout", this.focusOutHandler, true);
        this.focusOutHandler = null;
      }
      if (this.scrollHandler) {
        window.removeEventListener("scroll", this.scrollHandler, { capture: true });
        this.scrollHandler = null;
      }
      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeHandler = null;
      }
      if (this.rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.tracked = null;
      if (this.styleHandle) {
        this.styleHandle.remove();
        this.styleHandle = null;
      }
      if (this.ring) {
        this.ring.remove();
        this.ring = null;
      }
      console.log("[AI4A11y] Focus Locator disabled");
      announce("Focus highlighting off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yFocusLocator = FocusLocator;

  // tools/adapters/persistent-hover.js
  var OPEN_ATTR = "data-ai4a11y-hover-open";
  var HOVER = /:hover(?![\w-])/g;
  function splitSelectors(text) {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of text) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function hoverTrigger(sel) {
    const m = /:hover(?![\w-])/.exec(sel);
    if (!m) return null;
    let depth = 0, i;
    for (i = 0; i < m.index; i++) {
      const c = sel[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
    }
    if (depth) return null;
    for (i = m.index + 6; i < sel.length; i++) {
      const c = sel[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (!depth && /[\s>+~]/.test(c)) break;
    }
    if (!sel.slice(i).trim()) return null;
    let trigger = sel.slice(0, i).replace(HOVER, "").trim();
    if (!trigger || /[\s>+~]$/.test(trigger)) trigger += "*";
    return trigger;
  }
  function reveals(style) {
    const d = style.getPropertyValue("display"), v = style.getPropertyValue("visibility"), o = style.getPropertyValue("opacity");
    return d && d !== "none" || v === "visible" || o !== "" && parseFloat(o) > 0;
  }
  var PersistentHover = {
    styleId: "ai4a11y-persistent-hover-styles",
    tipId: "ai4a11y-hover-tip",
    enabled: false,
    style: null,
    // injectStyle handle
    tip: null,
    // the single reusable tooltip element
    current: null,
    // the titled element the tooltip is showing for
    triggers: "",
    // selector list of elements whose :hover reveals a pop-up
    opened: null,
    // the one element holding OPEN_ATTR
    onMouseOver: null,
    // stored listener refs (for exact removal)
    onKeyDown: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const background = options && options.background || "#1c1c1e";
      const color = options && options.color || "#ffffff";
      const kept = this.hoverRules();
      this.triggers = kept.triggers.join(", ");
      this.style = injectStyle(this.styleId, kept.css + `
      #${this.tipId} {
        position: fixed;
        z-index: 2147483647;
        max-width: 320px;
        padding: 8px 12px;
        border-radius: 6px;
        background: ${background};
        color: ${color};
        font: 500 15px/1.45 system-ui, -apple-system, sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        pointer-events: auto !important;
      }
    `);
      const tip = document.createElement("div");
      tip.id = this.tipId;
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      tip.style.pointerEvents = "auto";
      (document.body || document.documentElement).appendChild(tip);
      this.tip = tip;
      this.onMouseOver = (e) => {
        if (!this.enabled) return;
        const target = e.target;
        if (!target || target.nodeType !== 1) return;
        if (this.tip && (target === this.tip || this.tip.contains(target))) return;
        this.keepOpen(target);
        const el = target.closest ? target.closest("[title]") : null;
        if (!el) return;
        const text = (el.getAttribute("title") || "").trim();
        if (!text || el === this.current) return;
        this.show(el, text);
      };
      document.addEventListener("mouseover", this.onMouseOver, true);
      this.onKeyDown = (e) => {
        if (!this.enabled) return;
        if (e.key === "Escape") {
          this.hide();
          this.close();
        }
      };
      document.addEventListener("keydown", this.onKeyDown, true);
      console.log("[AI4A11y] Persistent Hover enabled");
      announce("Hover tooltips now stay on screen. Press Escape to dismiss one");
    },
    // Fill the tooltip with the element's title text (textContent, never
    // innerHTML) and place it just below the element.
    show(el, text) {
      if (!this.tip) return;
      this.current = el;
      this.tip.textContent = text;
      let rect = null;
      try {
        rect = el.getBoundingClientRect();
      } catch {
      }
      const x = rect ? rect.left : 0;
      const y = (rect ? rect.bottom : 0) + 6;
      this.tip.style.left = `${Math.max(0, x)}px`;
      this.tip.style.top = `${Math.max(0, y)}px`;
      this.tip.hidden = false;
    },
    hide() {
      if (this.tip) this.tip.hidden = true;
      this.current = null;
    },
    // Copies of the page's :hover rules that reveal something, keyed to
    // OPEN_ATTR instead of :hover. Same specificity as the originals and later
    // in the page, so they show exactly what hovering shows. Stylesheets from
    // other origins can't be read and are skipped.
    hoverRules() {
      const out = { css: "", triggers: [] };
      if (typeof document === "undefined" || !document.styleSheets) return out;
      const walk = (rules, wrap) => {
        for (const rule of Array.from(rules || [])) {
          try {
            if (rule.selectorText && rule.style && rule.selectorText.includes(":hover") && reveals(rule.style)) {
              const keep2 = [];
              for (const sel of splitSelectors(rule.selectorText)) {
                const trigger = hoverTrigger(sel);
                if (!trigger) continue;
                keep2.push(sel.replace(HOVER, `[${OPEN_ATTR}]`));
                if (!out.triggers.includes(trigger)) out.triggers.push(trigger);
              }
              if (keep2.length) out.css += wrap(`${keep2.join(", ")} { ${rule.style.cssText} }`) + "\n";
            } else if (rule.cssRules) {
              const cond = rule.media ? `@media ${rule.media.mediaText}` : rule.conditionText ? `@supports ${rule.conditionText}` : "";
              walk(rule.cssRules, cond ? (css) => wrap(`${cond} { ${css} }`) : wrap);
            }
          } catch {
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.ownerNode && sheet.ownerNode.id && sheet.ownerNode.id.startsWith("ai4a11y-")) continue;
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        walk(rules, (css) => css);
      }
      out.triggers = out.triggers.filter((t) => {
        try {
          document.documentElement.matches(t);
          return true;
        } catch {
          return false;
        }
      });
      return out;
    },
    // The pointer reached `el`: if it is in an element whose :hover opens a
    // pop-up, that element's pop-up stays open (and any other one closes).
    keepOpen(el) {
      if (!this.triggers || !el.closest) return;
      let host = null;
      try {
        host = el.closest(this.triggers);
      } catch {
        return;
      }
      if (!host || host === this.opened) return;
      this.close();
      host.setAttribute(OPEN_ATTR, "");
      this.opened = host;
    },
    close() {
      if (this.opened) {
        try {
          this.opened.removeAttribute(OPEN_ATTR);
        } catch {
        }
      }
      this.opened = null;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.onMouseOver) {
        document.removeEventListener("mouseover", this.onMouseOver, true);
        this.onMouseOver = null;
      }
      if (this.onKeyDown) {
        document.removeEventListener("keydown", this.onKeyDown, true);
        this.onKeyDown = null;
      }
      if (this.style) {
        this.style.remove();
        this.style = null;
      }
      if (this.tip) {
        this.tip.remove();
        this.tip = null;
      }
      this.current = null;
      this.close();
      this.triggers = "";
      console.log("[AI4A11y] Persistent Hover disabled");
      announce("Persistent hover off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yPersistentHover = PersistentHover;

  // tools/adapters/reading-ruler.js
  var ReadingRuler = {
    bandId: "ai4a11y-reading-ruler",
    enabled: false,
    band: null,
    shadeTop: null,
    shadeBottom: null,
    height: 40,
    moveHandler: null,
    // stored ref so disable() removes exactly this listener
    frame: null,
    // pending rAF/timer id, cancelled on disable
    lastY: 0,
    raf: null,
    cancelRaf: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.height = options.height || 40;
      const band = document.createElement("div");
      band.id = this.bandId;
      band.setAttribute("aria-hidden", "true");
      band.style.cssText = `position: fixed; left: 0; right: 0; height: ${this.height}px; background: rgba(255, 255, 0, 0.18); border-top: 1px solid rgba(0, 0, 0, 0.15); border-bottom: 1px solid rgba(0, 0, 0, 0.15); pointer-events: none; z-index: 2147483645;`;
      (document.body || document.documentElement).appendChild(band);
      this.band = band;
      if (options.dim !== false) {
        const shade = () => {
          const el = document.createElement("div");
          el.setAttribute("aria-hidden", "true");
          el.style.cssText = "position: fixed; left: 0; right: 0; background: rgba(0, 0, 0, 0.12); pointer-events: none; z-index: 2147483644;";
          (document.body || document.documentElement).appendChild(el);
          return el;
        };
        this.shadeTop = shade();
        this.shadeBottom = shade();
      }
      const hasRaf = typeof requestAnimationFrame === "function";
      this.raf = hasRaf ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);
      this.cancelRaf = hasRaf ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);
      this.moveHandler = (event) => {
        this.lastY = event.clientY;
        if (this.frame !== null) return;
        this.frame = this.raf(() => {
          this.frame = null;
          if (this.enabled) this.position(this.lastY);
        });
      };
      document.addEventListener("mousemove", this.moveHandler);
      this.position(typeof window !== "undefined" && window.innerHeight ? window.innerHeight / 2 : 0);
      console.log("[AI4A11y] Reading Ruler enabled");
      announce("Reading ruler on. It follows your cursor.");
    },
    // Center the band (and reflow the shades) around viewport y-coordinate `y`.
    position(y) {
      if (!this.band) return;
      const top = Math.round(y - this.height / 2);
      this.band.style.top = `${top}px`;
      if (this.shadeTop) {
        this.shadeTop.style.top = "0px";
        this.shadeTop.style.height = `${Math.max(0, top)}px`;
      }
      if (this.shadeBottom) {
        this.shadeBottom.style.top = `${top + this.height}px`;
        this.shadeBottom.style.bottom = "0px";
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.moveHandler) {
        document.removeEventListener("mousemove", this.moveHandler);
        this.moveHandler = null;
      }
      if (this.frame !== null) {
        this.cancelRaf(this.frame);
        this.frame = null;
      }
      this.raf = this.cancelRaf = null;
      this.band?.remove();
      this.band = null;
      this.shadeTop?.remove();
      this.shadeTop = null;
      this.shadeBottom?.remove();
      this.shadeBottom = null;
      console.log("[AI4A11y] Reading Ruler disabled");
      announce("Reading ruler off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yReadingRuler = ReadingRuler;

  // tools/adapters/confirm-actions.js
  var ACTION_WORDS = "delete|remove|submit|buy|pay|confirm|send|publish|unsubscribe|deactivate|close account|place (?:your |my |the )?order|complete (?:your |my |the )?(?:order|purchase)";
  var DESTRUCTIVE_RE = new RegExp(`\\b(?:${ACTION_WORDS})\\b`, "i");
  var STARTS_WITH_ACTION_RE = new RegExp(`^(?:${ACTION_WORDS})\\b`, "i");
  var MIN_CONFIRM_GAP_MS = 400;
  var ConfirmActions = {
    promptId: "ai4a11y-confirm-prompt",
    armedAttr: "data-ai4a11y-armed",
    enabled: false,
    clickHandler: null,
    // stored ref so disable() removes this exact listener
    prompt: null,
    // the injected "Click again to confirm" element
    promptTimer: null,
    armed: null,
    // Set of elements currently carrying the data flag
    armedAt: null,
    // timeStamp of the click that armed it
    windowMs: 4e3,
    // how long a first click stays armed
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.armed = /* @__PURE__ */ new Set();
      this.windowMs = typeof options.windowMs === "number" ? options.windowMs : 4e3;
      this.clickHandler = (e) => this.onClick(e);
      document.addEventListener("click", this.clickHandler, true);
      console.log("[AI4A11y] Confirm Actions enabled");
      announce("Confirm actions on: risky buttons need a second click");
    },
    onClick(e) {
      if (!this.enabled) return;
      if (e.isTrusted === false) return;
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      if (this.prompt && (t === this.prompt || this.prompt.contains(t))) return;
      const el = t.closest ? t.closest('button, [type="submit"], a') : null;
      if (!el || !this.looksDestructive(el)) return;
      if (el.hasAttribute(this.armedAttr)) {
        const gap = typeof e.timeStamp === "number" && this.armedAt != null ? e.timeStamp - this.armedAt : Infinity;
        if (gap < MIN_CONFIRM_GAP_MS) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        this.clearArmed();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      this.clearArmed();
      el.setAttribute(this.armedAttr, "true");
      this.armed.add(el);
      this.armedAt = typeof e.timeStamp === "number" ? e.timeStamp : null;
      this.showPrompt(el, e.detail === 0);
      this.promptTimer = setTimeout(() => this.clearArmed(), this.windowMs);
    },
    // The control's accessible name, as matched and as said back to the person.
    nameOf(el) {
      return (el.getAttribute && el.getAttribute("aria-label") || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
    },
    looksDestructive(el) {
      const name = this.nameOf(el);
      if (!name) return false;
      if (name.length > 40) return STARTS_WITH_ACTION_RE.test(name);
      return DESTRUCTIVE_RE.test(name);
    },
    showPrompt(el, byKeyboard = false) {
      const prompt = document.createElement("span");
      prompt.id = this.promptId;
      prompt.setAttribute("aria-hidden", "true");
      prompt.textContent = byKeyboard ? "Press again to confirm" : "Click again to confirm";
      let name = this.nameOf(el);
      if (name.length > 60) name = name.slice(0, 59) + "\u2026";
      announce(`${name}: ${byKeyboard ? "press" : "click"} again to confirm`);
      prompt.style.cssText = "position:fixed;z-index:2147483647;margin:0;padding:2px 8px;border-radius:4px;background:#b91c1c;color:#fff;font:600 12px/1.6 system-ui,sans-serif;pointer-events:none;";
      (document.body || document.documentElement).appendChild(prompt);
      let rect = null;
      try {
        rect = el.getBoundingClientRect();
      } catch {
      }
      prompt.style.left = `${rect ? Math.max(4, rect.left) : 4}px`;
      prompt.style.top = `${rect ? Math.max(4, rect.top - 24) : 4}px`;
      this.prompt = prompt;
    },
    // Drop any pending confirmation: timer, prompt, and armed flags.
    clearArmed() {
      if (this.promptTimer) {
        clearTimeout(this.promptTimer);
        this.promptTimer = null;
      }
      if (this.prompt) {
        this.prompt.remove();
        this.prompt = null;
      }
      this.armedAt = null;
      if (this.armed) {
        for (const el of this.armed) el.removeAttribute?.(this.armedAttr);
        this.armed.clear();
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.clickHandler) {
        document.removeEventListener("click", this.clickHandler, true);
        this.clickHandler = null;
      }
      this.clearArmed();
      this.armed = null;
      console.log("[AI4A11y] Confirm Actions disabled");
      announce("Confirm actions off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yConfirmActions = ConfirmActions;

  // tools/adapters/reading-spot.js
  var KEY_PREFIX = "ai4a11y-spot:";
  var SAVE_DELAY_MS = 500;
  var STYLE_ID3 = "ai4a11y-spot-styles";
  var ReadingSpot = {
    buttonId: "ai4a11y-spot-restore",
    enabled: false,
    key: null,
    savedY: null,
    // the spot from a previous visit, if any
    restorePending: false,
    // a jump-back button is showing and not yet used
    scrollHandler: null,
    // stored ref so disable() can removeEventListener
    saveTimer: null,
    // debounce timeout, cleared on disable
    // localStorage can throw on ANY access in private mode or a sandboxed
    // frame, so every touch goes through these two guarded helpers. Access is
    // via `window.localStorage` (never the bare global) so tests can stub it.
    readSpot() {
      try {
        if (typeof window.localStorage === "undefined") return null;
        const raw = window.localStorage.getItem(this.key);
        const y = raw === null ? NaN : Number(raw);
        return Number.isFinite(y) ? y : null;
      } catch {
        return null;
      }
    },
    saveSpot(y) {
      try {
        if (typeof window.localStorage === "undefined") return;
        window.localStorage.setItem(this.key, String(y));
      } catch {
      }
    },
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.key = options.key || KEY_PREFIX + window.location.pathname + window.location.search;
      const savedY = this.readSpot();
      this.savedY = savedY;
      this.restorePending = false;
      if (savedY !== null && savedY > 0 && !document.getElementById(this.buttonId)) {
        this.restorePending = true;
        const btn = document.createElement("button");
        btn.id = this.buttonId;
        btn.type = "button";
        btn.textContent = "Jump back to where you were";
        btn.style.cssText = "position: fixed; bottom: 16px; right: 16px; z-index: 2147483647;padding: 10px 16px; font-size: 16px; border-radius: 8px;border: 2px solid #1a5fb4; background: #ffffff; color: #1a5fb4; cursor: pointer;";
        btn.addEventListener("click", () => {
          const fromKeyboard = document.activeElement === btn;
          window.scrollTo(0, savedY);
          this.restorePending = false;
          btn.remove();
          if (fromKeyboard) this.focusAtSpot();
          announce("Back where you were");
        });
        if (!document.getElementById(STYLE_ID3) && document.head) {
          const style = document.createElement("style");
          style.id = STYLE_ID3;
          style.textContent = `#${this.buttonId}:focus-visible{outline:3px solid #1a5fb4 !important;outline-offset:2px;box-shadow:0 0 0 3px #fff,0 0 0 6px #1a5fb4}`;
          document.head.appendChild(style);
        }
        const body = document.body || document.documentElement;
        body.insertBefore(btn, body.firstChild);
      }
      this.scrollHandler = () => {
        if (!this.enabled) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null;
          if (!this.enabled) return;
          const y = window.scrollY;
          if (this.restorePending && this.savedY != null && y <= this.savedY) return;
          if (this.restorePending) document.getElementById(this.buttonId)?.remove();
          this.restorePending = false;
          this.saveSpot(y);
        }, SAVE_DELAY_MS);
      };
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
      console.log("[AI4A11y] Save Reading Spot enabled");
      announce(savedY !== null && savedY > 0 ? "Found your last reading spot \u2014 a jump-back button was added" : "Saving your reading spot as you scroll");
    },
    // Focus something at the middle of the screen, so the next Tab continues
    // from the spot the reader jumped to.
    focusAtSpot() {
      try {
        let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        while (el && el !== document.body && !el.matches("p, li, h1, h2, h3, h4, h5, h6, section, article, td, div")) el = el.parentElement;
        if (!el || el === document.body) return;
        if (!el.hasAttribute("tabindex")) {
          el.setAttribute("tabindex", "-1");
          el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
        }
        el.focus({ preventScroll: true });
      } catch {
      }
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.scrollHandler) {
        window.removeEventListener("scroll", this.scrollHandler);
        this.scrollHandler = null;
      }
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.restorePending = false;
      this.savedY = null;
      document.getElementById(this.buttonId)?.remove();
      document.getElementById(STYLE_ID3)?.remove();
      console.log("[AI4A11y] Save Reading Spot disabled");
      announce("Reading spot saving turned off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yReadingSpot = ReadingSpot;

  // tools/adapters/abbreviation-expand.js
  var logFix = globalThis.ai4a11yLogFix || (() => {
  });
  var MAX_TEXT_NODES2 = 2e3;
  var STYLE_ID4 = "ai4a11y-abbr-styles";
  var SKIP_TAGS3 = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "INPUT", "NOSCRIPT", "SELECT", "OPTION", "ABBR"]);
  var DICTIONARY = {
    WCAG: "Web Content Accessibility Guidelines",
    ARIA: "Accessible Rich Internet Applications",
    API: "Application Programming Interface",
    URL: "Uniform Resource Locator",
    HTML: "HyperText Markup Language",
    CSS: "Cascading Style Sheets",
    PDF: "Portable Document Format",
    FAQ: "Frequently Asked Questions",
    CEO: "Chief Executive Officer",
    CFO: "Chief Financial Officer",
    CTO: "Chief Technology Officer",
    CPU: "Central Processing Unit",
    GPU: "Graphics Processing Unit",
    RAM: "Random Access Memory",
    USB: "Universal Serial Bus",
    HTTP: "HyperText Transfer Protocol",
    HTTPS: "HyperText Transfer Protocol Secure",
    JSON: "JavaScript Object Notation",
    SQL: "Structured Query Language",
    GPS: "Global Positioning System",
    ATM: "Automated Teller Machine",
    NASA: "National Aeronautics and Space Administration",
    FBI: "Federal Bureau of Investigation",
    CIA: "Central Intelligence Agency",
    UN: "United Nations",
    EU: "European Union",
    DNA: "deoxyribonucleic acid",
    ETA: "estimated time of arrival",
    ASAP: "as soon as possible",
    DIY: "do it yourself",
    FYI: "for your information",
    IMO: "in my opinion",
    TBD: "to be determined",
    AKA: "also known as",
    RSVP: "please reply",
    DOB: "date of birth",
    "e.g.": "for example",
    "i.e.": "that is",
    "vs.": "versus",
    "etc.": "and so on",
    // Shopping and product-spec abbreviations. Stores lean on these in price
    // lines, spec tables and order summaries, where there is no room to spell
    // them out.
    MSRP: "manufacturer's suggested retail price",
    OOS: "out of stock",
    "S&S": "Subscribe & Save, a repeat order",
    Qty: "quantity",
    "Qty.": "quantity",
    "Incl.": "includes",
    "incl.": "including",
    "mo.": "months",
    "Avail.": "available",
    "Cust.": "customer",
    BSR: "Best Sellers Rank",
    "Mfr.": "manufacturer",
    "Mfg.": "manufacturer",
    "Cert.": "certification",
    "config.": "configuration",
    "I/O": "input and output",
    "Wt.": "weight",
    "Dims.": "dimensions",
    "Dia.": "diameter",
    "Ht.": "height",
    "Thk.": "thickness",
    "Vol.": "volume",
    "Compat.": "compatible with",
    "Batt.": "battery",
    "Insul.": "insulation",
    "Lum.": "lumens, how bright it is",
    "Ingr.": "ingredients",
    "Pcs.": "pieces",
    "Fmt.": "format",
    "pp.": "pages",
    "Pp.": "pages",
    "Pub. date": "publication date",
    "Lang.": "language",
    "ver.": "version",
    "len.": "length",
    PD: "USB Power Delivery, a fast-charging standard",
    PPS: "Programmable Power Supply, a fast-charging standard",
    GaN: "gallium nitride, a chip material that runs cooler",
    LED: "light-emitting diode",
    FCC: "Federal Communications Commission",
    UL: "Underwriters Laboratories, a safety testing lab",
    BT: "Bluetooth",
    ANC: "active noise cancellation",
    "IP rating": "Ingress Protection rating, how well it keeps out dust and water",
    CCT: "correlated color temperature, how warm or cool the light looks",
    CRI: "color rendering index, how true colors look under the light",
    BPA: "bisphenol A, a chemical in some plastics",
    GMO: "genetically modified organism"
  };
  var LIVE_SEL2 = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
  var RESCAN_MS4 = 400;
  var AbbreviationExpand = {
    markerClass: "ai4a11y-abbr",
    // the injected <abbr> elements
    wrapperClass: "ai4a11y-abbr-wrap",
    // the text-node replacement wrappers
    enabled: false,
    handle: null,
    // transformTextNodes handle (owns the exact-restore)
    handles: null,
    // later passes, for text the page adds after enable()
    titled: null,
    // pre-existing <abbr> elements whose title WE set
    style: null,
    // injectStyle handle
    observer: null,
    rescanTimer: null,
    spellOut: false,
    // options.spellOut: also write the full form out once, after the first use
    spelled: null,
    // abbreviations already written out on this page
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.titled = [];
      this.spellOut = options.spellOut === true;
      this.spelled = /* @__PURE__ */ new Set();
      const dict = Object.assign(/* @__PURE__ */ Object.create(null), DICTIONARY, options.dictionary || {});
      const matcher = this.buildMatcher(dict);
      const root = mainRoot();
      if (!root || !matcher) {
        announce("Abbreviation expansion: no readable text found");
        return;
      }
      this.fillTitles(root, dict);
      this.handles = [];
      this.handle = this.pass(root, dict, matcher, MAX_TEXT_NODES2);
      this.style = injectStyle(STYLE_ID4, `
      .${this.markerClass} {
        text-decoration: underline dotted;
        text-underline-offset: 2px;
        cursor: help;
      }`);
      const count = this.handle.records.length + this.titled.length;
      if (this.handle.capped) console.log(`[AI4A11y] Abbreviation Expand: capped at ${MAX_TEXT_NODES2} text nodes`);
      console.log(`[AI4A11y] Abbreviation Expand enabled (${this.handle.records.length} text blocks, ${this.titled.length} existing abbr titles)`);
      announce(count ? "Abbreviation expansion on" : "Abbreviation expansion: no known abbreviations found");
      this.watch(root, dict, matcher);
    },
    pass(root, dict, matcher, cap) {
      return transformTextNodes(root, (text, node) => {
        const parent = node.parentElement;
        if (parent && parent.closest && parent.closest(LIVE_SEL2)) return null;
        return this.buildWrapper(text, dict, matcher);
      }, { skipTags: SKIP_TAGS3, skipClass: this.wrapperClass, cap });
    },
    // Stores re-render parts of the page (a cart line after a quantity change,
    // search results after a filter). Mark the new text too, a moment after it
    // lands. Our own wrappers are ignored, so this never reacts to itself.
    watch(root, dict, matcher) {
      if (typeof MutationObserver === "undefined") return;
      const ours = (n) => n.nodeType === 1 && n.classList && n.classList.contains(this.wrapperClass);
      this.observer = new MutationObserver((records) => {
        const fresh = records.some((r) => [...r.addedNodes].some((n) => !ours(n) && (n.nodeType === 1 || n.nodeType === 3 && /\S/.test(n.nodeValue))));
        if (!fresh || this.rescanTimer) return;
        this.rescanTimer = setTimeout(() => {
          this.rescanTimer = null;
          if (!this.enabled) return;
          this.fillTitles(root, dict);
          const used = this.handles.reduce((n, h2) => n + h2.records.length, this.handle.records.length);
          if (used >= MAX_TEXT_NODES2) return;
          const h = this.pass(root, dict, matcher, MAX_TEXT_NODES2 - used);
          if (h.records.length) this.handles.push(h);
        }, RESCAN_MS4);
      });
      this.observer.observe(root, { childList: true, subtree: true });
    },
    // One global alternation over the dictionary keys, longest-first so HTTPS
    // wins over HTTP at the same position. Word boundaries are checked manually
    // per match (see buildWrapper) because keys like "e.g." end in non-word
    // characters where \b does not behave.
    buildMatcher(dict) {
      const keys = Object.keys(dict).filter((k) => k && typeof dict[k] === "string" && dict[k]).sort((a, b) => b.length - a.length);
      if (!keys.length) return null;
      const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return new RegExp(`(?:${escaped.join("|")})`, "g");
    },
    // Set title on every dictionary-known <abbr> under root that has none,
    // remembering each so disable() can remove exactly what we added.
    fillTitles(root, dict) {
      for (const abbr of root.querySelectorAll("abbr:not([title])")) {
        try {
          if (abbr.classList.contains(this.markerClass)) continue;
          const expansion = dict[(abbr.textContent || "").trim()];
          if (typeof expansion !== "string" || !expansion) continue;
          abbr.setAttribute("title", expansion);
          this.titled.push(abbr);
          logFix("abbr-title", abbr, "(none)", expansion);
        } catch {
        }
      }
    },
    // Rebuild one text node's content as a wrapper <span> where each dictionary
    // match becomes <abbr class=... title=...>MATCH</abbr> and everything else
    // is re-emitted verbatim as text. Whole-word only: a match glued to a word
    // character on either side ("APIs", "SCRAPI") is skipped. Returns null when
    // nothing matched, so the caller leaves the node untouched.
    buildWrapper(text, dict, matcher) {
      matcher.lastIndex = 0;
      let wrap = null;
      let last = 0;
      let m;
      while (m = matcher.exec(text)) {
        const start = m.index;
        const end = start + m[0].length;
        if (start > 0 && /\w/.test(text[start - 1])) continue;
        if (end < text.length && /\w/.test(text[end])) continue;
        if (!wrap) {
          wrap = document.createElement("span");
          wrap.className = this.wrapperClass;
          wrap.style.cssText = "all: unset;";
        }
        if (start > last) wrap.appendChild(document.createTextNode(text.slice(last, start)));
        const abbr = document.createElement("abbr");
        abbr.className = this.markerClass;
        abbr.setAttribute("title", dict[m[0]]);
        abbr.textContent = m[0];
        wrap.appendChild(abbr);
        if (this.spellOut && !this.spelled.has(m[0])) {
          this.spelled.add(m[0]);
          const full = document.createElement("span");
          full.className = `${this.markerClass}-full`;
          full.style.cssText = "all: unset;";
          full.textContent = ` (${dict[m[0]].split(", ")[0]})`;
          wrap.appendChild(full);
        }
        logFix("abbr-expand", abbr, m[0], dict[m[0]]);
        last = end;
      }
      if (!wrap) return null;
      if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
      return wrap;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.rescanTimer) {
        clearTimeout(this.rescanTimer);
        this.rescanTimer = null;
      }
      for (const h of (this.handles || []).reverse()) h.restore();
      this.handles = null;
      if (this.handle) {
        this.handle.restore();
        this.handle = null;
      }
      if (this.titled) {
        for (const abbr of this.titled) {
          try {
            abbr.removeAttribute("title");
          } catch {
          }
        }
        this.titled = null;
      }
      if (this.style) {
        this.style.remove();
        this.style = null;
      }
      this.spelled = null;
      console.log("[AI4A11y] Abbreviation Expand disabled");
      announce("Abbreviation expansion off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yAbbreviationExpand = AbbreviationExpand;

  // tools/adapters/language-tag.js
  var logFix2 = globalThis.ai4a11yLogFix || (() => {
  });
  var MAX_TEXT_NODES3 = 2e3;
  var SAMPLE_CHAR_BUDGET = 4e3;
  var SCRIPT_RANGES = [
    ["Latin", [[65, 90], [97, 122], [192, 591]]],
    ["Han", [[19968, 40959], [13312, 19903], [63744, 64255]]],
    ["Hiragana", [[12352, 12447]]],
    ["Katakana", [[12448, 12543], [12784, 12799]]],
    ["Hangul", [[44032, 55215], [4352, 4607], [12592, 12687]]],
    ["Arabic", [[1536, 1791], [1872, 1919], [2208, 2303]]],
    ["Cyrillic", [[1024, 1279], [1280, 1327]]],
    ["Hebrew", [[1424, 1535]]],
    ["Devanagari", [[2304, 2431]]],
    ["Greek", [[880, 1023], [7936, 8191]]],
    ["Thai", [[3584, 3711]]]
  ];
  var SCRIPT_LANG = {
    Latin: "en",
    Han: "zh",
    Hiragana: "ja",
    Katakana: "ja",
    Hangul: "ko",
    Arabic: "ar",
    Cyrillic: "ru",
    Hebrew: "he",
    Devanagari: "hi",
    Greek: "el",
    Thai: "th"
  };
  var KANA_RE = /[぀-ヿㇰ-ㇿ]/;
  function scriptOf(cp) {
    for (const [script, ranges] of SCRIPT_RANGES) {
      for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return script;
    }
    return null;
  }
  var SAMPLE_SKIP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "NOSCRIPT", "SELECT", "OPTION"]);
  function detectMainLang(root) {
    const counts = /* @__PURE__ */ new Map();
    let budget = SAMPLE_CHAR_BUDGET;
    const walk = (node) => {
      for (let child = node.firstChild; child && budget > 0; child = child.nextSibling) {
        if (child.nodeType === 3) {
          for (const ch of child.nodeValue) {
            if (budget-- <= 0) break;
            const script = scriptOf(ch.codePointAt(0));
            if (script) counts.set(script, (counts.get(script) || 0) + 1);
          }
        } else if (child.nodeType === 1 && !SAMPLE_SKIP.has(child.tagName)) {
          walk(child);
        }
      }
    };
    try {
      walk(root);
    } catch {
    }
    let main = "Latin", best = 0;
    for (const [script, n] of counts) {
      if (n > best) {
        best = n;
        main = script;
      }
    }
    const kana = (counts.get("Hiragana") || 0) + (counts.get("Katakana") || 0);
    if (main === "Han" && kana > 0) return "ja";
    return SCRIPT_LANG[main] || "en";
  }
  var LanguageTag = {
    markerClass: "ai4a11y-lang",
    enabled: false,
    handles: [],
    // transformTextNodes handles (initial enable + each sweep), each owns exact-restore
    mainLang: null,
    // page's dominant language while enabled
    htmlLangAdded: false,
    // we added <html lang>; remove it on disable
    unregisterSweep: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.handles = [];
      const root = mainRoot();
      if (!root) {
        announce("Language tags: no readable text found");
        return;
      }
      this.mainLang = typeof options.mainLang === "string" && options.mainLang ? options.mainLang : detectMainLang(root);
      const html = document.documentElement;
      if (html && !html.hasAttribute("lang")) {
        html.setAttribute("lang", this.mainLang);
        this.htmlLangAdded = true;
        logFix2("lang", html, "(none)", this.mainLang);
      }
      const count = this.sweepRoot(root);
      console.log(`[AI4A11y] Language Tag enabled (${count} text nodes tagged, main language "${this.mainLang}")`);
      announce(count ? "Language tags on" : "Language tags: no foreign-language text found");
      this.unregisterSweep = registerSweep("language-tag", ({ reason }) => {
        if (!this.enabled) return;
        const freshRoot = mainRoot();
        if (freshRoot) this.sweepRoot(freshRoot, reason);
      }, { debounceMs: 600 });
    },
    // Run one transformTextNodes pass over `root`, recording the handle for
    // disable()'s restore and logging each newly-tagged run. Returns the count
    // of text nodes tagged in THIS pass (0 on a re-sweep with nothing new).
    sweepRoot(root, reason = "enable") {
      const handle = transformTextNodes(root, (text) => this.buildWrapper(text), {
        skipClass: this.markerClass,
        cap: MAX_TEXT_NODES3
      });
      this.handles.push(handle);
      if (handle.capped) console.log(`[AI4A11y] Language Tag: capped at ${MAX_TEXT_NODES3} text nodes`);
      for (const { replacement } of handle.records) {
        logFix2("language-tag", replacement, "(untagged)", `lang spans (${reason})`);
      }
      return handle.records.length;
    },
    // Rebuild one mixed-script text node as a marker <span>: runs of a foreign
    // script become <span lang="xx"> children, everything else stays plain text
    // nodes. Returns null (skip) when the node has no foreign-script run, so
    // same-script text is left untouched.
    buildWrapper(text) {
      const hasKana = KANA_RE.test(text);
      const runs = [];
      for (const ch of text) {
        const lang = this.langOfChar(ch.codePointAt(0), hasKana);
        const last = runs[runs.length - 1];
        if (last && last.lang === lang) last.text += ch;
        else runs.push({ lang, text: ch });
      }
      if (!runs.some((run) => run.lang)) return null;
      const span = document.createElement("span");
      span.className = this.markerClass;
      for (const run of runs) {
        if (run.lang) {
          const tagged = document.createElement("span");
          tagged.setAttribute("lang", run.lang);
          tagged.textContent = run.text;
          span.appendChild(tagged);
        } else {
          span.appendChild(document.createTextNode(run.text));
        }
      }
      return span;
    },
    // Language a character should be announced in, or null when it needs no tag
    // (neutral chars, Latin, or the page's own language).
    langOfChar(cp, hasKana) {
      const script = scriptOf(cp);
      if (!script || script === "Latin") return null;
      let lang = SCRIPT_LANG[script];
      if (script === "Han" && (hasKana || this.mainLang === "ja")) lang = "ja";
      return lang === this.mainLang ? null : lang;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      for (const handle of this.handles) handle.restore();
      this.handles = [];
      if (this.htmlLangAdded) {
        try {
          document.documentElement.removeAttribute("lang");
        } catch {
        }
        this.htmlLangAdded = false;
      }
      this.mainLang = null;
      console.log("[AI4A11y] Language Tag disabled");
      announce("Language tags off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yLanguageTag = LanguageTag;

  // tools/adapters/explore-a-chart.js
  var logFix3 = globalThis.ai4a11yLogFix || (() => {
  });
  var CHART_HINT = /chart|graph|plot|diagram/i;
  var HTML_NS3 = "http://www.w3.org/1999/xhtml";
  var MAX_CHARTS = 20;
  var MAX_ROWS = 200;
  var ExploreAChart = {
    styleId: "ai4a11y-chart-styles",
    enabled: false,
    panel: null,
    live: null,
    charts: [],
    buttons: [],
    lastHover: null,
    _reqSeq: 0,
    _keyHandler: null,
    _moveHandler: null,
    unregisterSweep: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      injectStyle(this.styleId, `
      .ai4a11y-chart-btn {
        display: inline-block; margin: 4px 0; padding: 4px 10px;
        background: #1a73e8; color: #fff; border: none; border-radius: 6px;
        font: 13px/1.4 system-ui, sans-serif; cursor: pointer;
      }
      .ai4a11y-chart-btn:focus-visible { outline: 3px solid #8ab4f8; outline-offset: 2px; }
      #ai4a11y-chart-panel {
        position: fixed; bottom: 16px; right: 16px; max-width: 480px; max-height: 70vh;
        overflow: auto; z-index: 2147483647;
        background: #10141a; color: #f2f5f9; border: 2px solid #1a73e8; border-radius: 10px;
        padding: 12px 14px; font: 15px/1.5 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
      }
      #ai4a11y-chart-panel h2 { font-size: 13px; margin: 0 0 6px; color: #8ab4f8; text-transform: uppercase; letter-spacing: .04em; }
      #ai4a11y-chart-panel .ai4a11y-chart-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #f2f5f9; font-size: 18px; cursor: pointer; }
      #ai4a11y-chart-panel table { border-collapse: collapse; width: 100%; margin-top: 4px; }
      #ai4a11y-chart-panel caption { text-align: left; font-weight: 600; margin-bottom: 6px; }
      #ai4a11y-chart-panel th, #ai4a11y-chart-panel td { border: 1px solid #3c4043; padding: 4px 8px; text-align: left; }
      #ai4a11y-chart-panel thead th { color: #8ab4f8; }
    `);
      this.live = document.createElement("div");
      this.live.id = "ai4a11y-chart-live";
      this.live.setAttribute("aria-live", "polite");
      this.live.setAttribute("aria-atomic", "true");
      this.live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      (document.body || document.documentElement).appendChild(this.live);
      this.charts = [];
      this.buttons = [];
      this.sweep();
      this._keyHandler = (e) => {
        if (e.altKey && e.code === "KeyT") {
          e.preventDefault();
          this.open(this.target());
        }
        if (e.key === "Escape") this.hide();
      };
      document.addEventListener("keydown", this._keyHandler, true);
      this._moveHandler = (e) => {
        this.lastHover = e.target;
      };
      document.addEventListener("mouseover", this._moveHandler, true);
      announce(this.charts.length ? `Explore a chart ready. ${this.charts.length} chart${this.charts.length === 1 ? "" : "s"} found. Tab to a View data table button, or press Alt plus T on a chart.` : "Explore a chart ready. No charts on this page yet.");
      this.unregisterSweep = registerSweep("explore-a-chart", () => {
        if (!this.enabled) return;
        this.sweep();
      }, { debounceMs: 600 });
    },
    // Find new chart candidates and button them, skipping charts already
    // tracked from a prior sweep. Safe to call repeatedly. Returns how many
    // new charts were buttoned.
    sweep() {
      let added = 0;
      for (const chart of this.findCharts()) {
        if (this.charts.includes(chart)) continue;
        if (this.charts.length >= MAX_CHARTS) break;
        this.charts.push(chart);
        this.attachButton(chart);
        added++;
      }
      return added;
    },
    // Chart candidates: anything that renders data visually but exposes no text.
    findCharts() {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      const push = (el) => {
        if (el && !seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      };
      document.querySelectorAll("canvas").forEach(push);
      document.querySelectorAll('svg[role="img"]').forEach(push);
      document.querySelectorAll("svg").forEach((s) => {
        if (s.querySelector("text")) push(s);
      });
      document.querySelectorAll("img").forEach((img) => {
        if (CHART_HINT.test(`${img.getAttribute("alt") || ""} ${img.getAttribute("src") || ""}`)) push(img);
      });
      document.querySelectorAll('[role="img"]').forEach((el) => {
        if (el.querySelector("canvas, svg, img")) push(el);
      });
      return out;
    },
    attachButton(chart) {
      const parent = chart.parentElement;
      if (!parent || parent.namespaceURI && parent.namespaceURI !== HTML_NS3) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai4a11y-chart-btn";
      btn.textContent = "View data table";
      const hint2 = this.contextText(chart);
      btn.setAttribute("aria-label", hint2 ? `View data table for chart: ${hint2}` : "View data table for this chart");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.open(chart);
      });
      chart.insertAdjacentElement("afterend", btn);
      this.buttons.push(btn);
      logFix3("chart-button", chart, "(none)", "View data table button");
    },
    target() {
      return this.chartFor(document.activeElement) || this.chartFor(this.lastHover);
    },
    // The tracked chart that el is (or is inside of), walking up the tree.
    chartFor(el) {
      while (el && el.nodeType === 1) {
        if (this.charts.includes(el)) return el;
        el = el.parentElement;
      }
      return null;
    },
    async open(chart) {
      if (!chart) {
        this.showMessage('No chart selected. Tab to a "View data table" button, or hover a chart and press Alt+T.');
        return;
      }
      const token = ++this._reqSeq;
      this.showMessage("Reading chart data\u2026");
      let data = null;
      try {
        const dataUrl = await this.capture(chart);
        data = dataUrl ? await extractChartData(dataUrl, this.contextText(chart)) : null;
      } catch (e) {
        console.warn("[AI4A11y] Explore a Chart: no table shown, provider error:", e);
        data = null;
      }
      if (token !== this._reqSeq || !this.enabled) return;
      if (data && Array.isArray(data.headers) && Array.isArray(data.rows)) {
        this.showTable(data);
      } else {
        this.showMessage("Couldn't read this chart's data. Check that your AI key is set in the extension settings.");
      }
    },
    // A data URL of the chart's pixels, whatever it is rendered with.
    async capture(el) {
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "canvas" && typeof el.toDataURL === "function") {
        try {
          return el.toDataURL();
        } catch {
          return null;
        }
      }
      if (tag === "svg") {
        try {
          const str = new XMLSerializer().serializeToString(el);
          return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(str)));
        } catch {
          return null;
        }
      }
      if (tag === "img") return imageToDataUrl(el);
      const inner = el.querySelector && el.querySelector("canvas, svg, img");
      return inner ? this.capture(inner) : null;
    },
    // Nearby text that anchors the extraction — the chart's label/alt/title plus
    // any <figcaption> — so the model knows what it is looking at.
    contextText(el) {
      const bits = [];
      const attr = (n) => el.getAttribute && el.getAttribute(n) || "";
      if (attr("aria-label")) bits.push(attr("aria-label"));
      if (attr("alt")) bits.push(attr("alt"));
      if (attr("title")) bits.push(attr("title"));
      const cap = el.closest && el.closest("figure")?.querySelector("figcaption");
      if (cap && cap.textContent.trim()) bits.push(cap.textContent.replace(/\s+/g, " ").trim());
      return bits.join(" \u2014 ").slice(0, 300);
    },
    ensurePanel() {
      if (this.panel) return;
      this.panel = document.createElement("div");
      this.panel.id = "ai4a11y-chart-panel";
      this.panel.setAttribute("role", "dialog");
      this.panel.setAttribute("aria-label", "Chart data table");
      const close = document.createElement("button");
      close.className = "ai4a11y-chart-close";
      close.setAttribute("aria-label", "Close chart data table");
      close.textContent = "\u2715";
      close.addEventListener("click", () => this.hide());
      const h = document.createElement("h2");
      h.textContent = "Chart data";
      const body = document.createElement("div");
      body.className = "ai4a11y-chart-body";
      this.panel.append(close, h, body);
      (document.body || document.documentElement).appendChild(this.panel);
    },
    showMessage(text) {
      this.ensurePanel();
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = text;
      this.panel.querySelector(".ai4a11y-chart-body").replaceChildren(p);
      this.panel.style.display = "block";
      if (this.live) this.live.textContent = text;
    },
    // Model output goes in via textContent ONLY — never innerHTML.
    showTable(data) {
      this.ensurePanel();
      const caption = typeof data.caption === "string" && data.caption ? data.caption : "Chart data";
      const table = document.createElement("table");
      const cap = document.createElement("caption");
      cap.textContent = caption;
      table.appendChild(cap);
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const h of data.headers) {
        const th = document.createElement("th");
        th.setAttribute("scope", "col");
        th.textContent = String(h);
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      const rows = data.rows.slice(0, MAX_ROWS);
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const tr = document.createElement("tr");
        row.forEach((cell, i) => {
          const c = document.createElement(i === 0 ? "th" : "td");
          if (i === 0) c.setAttribute("scope", "row");
          c.textContent = String(cell);
          tr.appendChild(c);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      this.panel.querySelector(".ai4a11y-chart-body").replaceChildren(table);
      this.panel.style.display = "block";
      if (this.live) this.live.textContent = `${caption}. Table with ${rows.length} rows and ${data.headers.length} columns.`;
    },
    hide() {
      if (this.panel) this.panel.style.display = "none";
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
      if (this._moveHandler) document.removeEventListener("mouseover", this._moveHandler, true);
      this._keyHandler = this._moveHandler = null;
      for (const btn of this.buttons) {
        try {
          btn.remove();
        } catch {
        }
      }
      this.buttons = [];
      this.charts = [];
      try {
        document.getElementById(this.styleId)?.remove();
      } catch {
      }
      this.panel?.remove();
      this.panel = null;
      this.live?.remove();
      this.live = null;
      this.lastHover = null;
      announce("Explore a chart off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yExploreAChart = ExploreAChart;

  // tools/adapters/spa-focus.js
  var logFix4 = globalThis.ai4a11yLogFix || (() => {
  });
  var REGION_ID = "ai4a11y-spa-focus-region";
  var SETTLE_DELAY_MS = 150;
  var SpaFocus = {
    regionId: REGION_ID,
    enabled: false,
    region: null,
    lastPath: null,
    // pathname+search last handled, so same-path pushes are ignored
    lastPage: null,
    // title + main heading last handled (see checkRoute)
    writeTimer: null,
    // pending write into the live region, cleared on disable
    settleTimer: null,
    // debounce timeout, cleared on disable
    popstateHandler: null,
    // stored ref so disable() can removeEventListener
    patchedHistory: null,
    // the history object we patched, restored on disable
    origPushState: null,
    origReplaceState: null,
    tabindexAdded: /* @__PURE__ */ new Set(),
    // elements we gave tabindex="-1", stripped on disable
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.lastPath = window.location.pathname + window.location.search;
      this.lastPage = this.pageKey();
      const region = document.createElement("div");
      region.id = REGION_ID;
      region.setAttribute("aria-live", "assertive");
      region.setAttribute("aria-atomic", "true");
      region.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      (document.body || document.documentElement).appendChild(region);
      this.region = region;
      const self = this;
      this.patchedHistory = window.history;
      this.origPushState = window.history.pushState;
      this.origReplaceState = window.history.replaceState;
      window.history.pushState = function(...args) {
        const result = self.origPushState.apply(this, args);
        self.scheduleCheck();
        return result;
      };
      window.history.replaceState = function(...args) {
        const result = self.origReplaceState.apply(this, args);
        self.scheduleCheck();
        return result;
      };
      this.popstateHandler = () => {
        if (!this.enabled) return;
        this.scheduleCheck();
      };
      window.addEventListener("popstate", this.popstateHandler);
      console.log("[AI4A11y] SPA Focus enabled");
      announce("Announcing page changes in this app");
    },
    scheduleCheck() {
      if (!this.enabled) return;
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        if (!this.enabled) return;
        this.checkRoute();
      }, SETTLE_DELAY_MS);
    },
    checkRoute() {
      const path = window.location.pathname + window.location.search;
      if (path === this.lastPath) return;
      const sameRoute = window.location.pathname === (this.lastPath || "").split("?")[0];
      this.lastPath = path;
      const page = this.pageKey();
      if (sameRoute && page === this.lastPage) return;
      this.lastPage = page;
      const target = document.querySelector('main, [role="main"], #main, h1');
      if (target) {
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          this.tabindexAdded.add(target);
          logFix4("spa-focus-tabindex", target, "(none)", "-1");
        }
        target.focus({ preventScroll: false });
      }
      const region = this.region;
      if (region) {
        const name = this.pageName(target);
        region.textContent = "";
        clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => {
          if (this.region === region) region.textContent = name;
        }, 50);
      }
    },
    // What the page is: its title and its top heading. Navigations change one.
    pageKey() {
      const h1 = document.querySelector('h1, [role="heading"][aria-level="1"]');
      return `${document.title}
${h1 ? h1.textContent.replace(/\s+/g, " ").trim() : ""}`;
    },
    // What to call the new page: its title if the app updates one, else the
    // main heading's text, else a generic fallback so something is always said.
    pageName(target) {
      const title = (document.title || "").replace(/\s+/g, " ").trim();
      if (title) return title;
      let heading = null;
      if (target) {
        heading = /^H[1-6]$/.test(target.tagName) ? target : target.querySelector('h1, h2, [role="heading"]');
      }
      heading = heading || document.querySelector("h1");
      const text = heading ? (heading.textContent || "").replace(/\s+/g, " ").trim() : "";
      return text || "New page";
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.settleTimer) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
      if (this.writeTimer) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      if (this.patchedHistory) {
        this.patchedHistory.pushState = this.origPushState;
        this.patchedHistory.replaceState = this.origReplaceState;
        this.patchedHistory = null;
      }
      this.origPushState = null;
      this.origReplaceState = null;
      if (this.popstateHandler) {
        window.removeEventListener("popstate", this.popstateHandler);
        this.popstateHandler = null;
      }
      for (const el of this.tabindexAdded) el.removeAttribute("tabindex");
      this.tabindexAdded.clear();
      try {
        (this.region || document.getElementById(REGION_ID))?.remove();
      } catch {
      }
      this.region = null;
      this.lastPath = null;
      this.lastPage = null;
      console.log("[AI4A11y] SPA Focus disabled");
      announce("Stopped announcing page changes");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11ySpaFocus = SpaFocus;

  // tools/adapters/skip-links.js
  var logFix5 = globalThis.ai4a11yLogFix || (() => {
  });
  var MAIN_SELECTOR = 'main, [role="main"], #main, #content, .content';
  var NAV_SELECTOR = 'nav, [role="navigation"]';
  var SkipLinks = {
    containerId: "ai4a11y-skip-links",
    styleId: "ai4a11y-skip-links-styles",
    enabled: false,
    container: null,
    styleHandle: null,
    addedIdTargets: [],
    // elements we assigned an id to — reverted on disable
    addedTabindexTargets: [],
    // elements we set tabindex="-1" on — reverted on disable
    // Give `el` an id to link to, inventing one only when the page did not
    // already provide it (and remembering the addition for disable()).
    ensureId(el, base) {
      if (el.id) return el.id;
      let id = base;
      for (let n = 2; document.getElementById(id); n++) id = `${base}-${n}`;
      el.id = id;
      this.addedIdTargets.push(el);
      logFix5("skip-link-id", el, "(none)", id);
      return id;
    },
    // A real <a href="#…"> so the link works even with no JS; the click handler
    // upgrades it to also move keyboard focus, because plain fragment
    // navigation scrolls the viewport but leaves focus behind on the link.
    buildLink(target, idBase, label) {
      const a = document.createElement("a");
      a.href = `#${this.ensureId(target, idBase)}`;
      a.textContent = label;
      a.addEventListener("click", (event) => {
        event.preventDefault();
        if (!target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
          this.addedTabindexTargets.push(target);
          logFix5("skip-link-tabindex", target, "(none)", "-1");
        }
        try {
          target.focus();
        } catch {
        }
        try {
          if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
        } catch {
        }
      });
      return a;
    },
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const main = document.querySelector(options.mainSelector || MAIN_SELECTOR);
      const nav = document.querySelector(options.navSelector || NAV_SELECTOR);
      if (main || nav) {
        this.styleHandle = injectStyle(this.styleId, `
        /* OUT OF FLOW. The container is the first child of <body> so the links
           are the first Tab stop \u2014 but first in tab order must not mean first in
           the box layout. In flow it takes a slot, and any positional layout on
           body shifts by one: grid-template-rows/areas, body > *:first-child,
           :nth-child(), a flex layout assuming a child count. (A real page laid
           out with "grid-template-rows: auto 1fr" put its header in the 1fr row
           and rendered it 878px tall.) Fixed + zero-size occupies no slot and
           keeps the DOM order, so tab order is unchanged. */
        #${this.containerId} {
          position: fixed;
          top: 0; left: 0;
          width: 0; height: 0;
          z-index: 2147483647;
        }
        #${this.containerId} a {
          position: absolute;
          top: 0; left: 0;
          width: 1px; height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
          z-index: 2147483647;
        }
        #${this.containerId} a:focus {
          width: auto; height: auto;
          margin: 8px;
          padding: 12px 20px;
          overflow: visible;
          clip: auto;
          clip-path: none;
          border-radius: 999px;
          border: 2px solid #1a5fb4;
          background: #ffffff;
          color: #1a5fb4;
          font-size: 16px;
          font-weight: 600;
          text-decoration: underline;
        }
      `);
        const container = document.createElement("div");
        container.id = this.containerId;
        if (main) container.appendChild(this.buildLink(main, "ai4a11y-main", "Skip to main content"));
        if (nav && nav !== main) container.appendChild(this.buildLink(nav, "ai4a11y-nav", "Skip to navigation"));
        const parent = document.body || document.documentElement;
        parent.insertBefore(container, parent.firstChild);
        this.container = container;
        logFix5("skip-links", container, "(none)", `${container.querySelectorAll("a").length} links injected`);
      }
      console.log("[AI4A11y] Skip Links enabled");
      announce(main || nav ? "Skip links added at the top of the page" : "No main content or navigation region found to skip to");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.container) {
        this.container.remove();
        this.container = null;
      }
      if (this.styleHandle) {
        this.styleHandle.remove();
        this.styleHandle = null;
      }
      for (const el of this.addedIdTargets) {
        try {
          el.removeAttribute("id");
        } catch {
        }
      }
      this.addedIdTargets = [];
      for (const el of this.addedTabindexTargets) {
        try {
          el.removeAttribute("tabindex");
        } catch {
        }
      }
      this.addedTabindexTargets = [];
      console.log("[AI4A11y] Skip Links disabled");
      announce("Skip links removed");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11ySkipLinks = SkipLinks;

  // tools/utils/dom.js
  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function getAccessibleName(el) {
    return getLabelledByText(el) || (el.getAttribute("aria-label") || "").trim() || getNativeName(el) || getNameFromContent(el) || (el.getAttribute("title") || "").trim() || getDefaultName(el);
  }
  function hasAccessibleName(el) {
    return !!getAccessibleName(el);
  }
  function getLabelledByText(el) {
    const attr = el.getAttribute("aria-labelledby");
    if (!attr) return "";
    return attr.split(/\s+/).map((id) => {
      const target = document.getElementById(id);
      return target ? nameOfReferenced(target) : "";
    }).filter(Boolean).join(" ");
  }
  function nameOfReferenced(el) {
    return (el.getAttribute("aria-label") || "").trim() || getNativeName(el) || getEmbeddedValue(el) || getNameFromContent(el) || (el.getAttribute("title") || "").trim() || getDefaultName(el);
  }
  function getNativeName(el) {
    const tag = el.localName;
    if (tag === "img" || tag === "area") return (el.getAttribute("alt") || "").trim();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "image") return (el.getAttribute("alt") || "").trim();
      if (type === "submit" || type === "reset" || type === "button") return (el.value || "").trim();
    }
    return "";
  }
  function getDefaultName(el) {
    if (el.localName !== "input") return "";
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "submit") return "Submit";
    if (type === "reset") return "Reset";
    return "";
  }
  var NO_EMBEDDED_VALUE_TYPES = ["submit", "reset", "button", "image", "hidden", "checkbox", "radio", "password"];
  function getEmbeddedValue(el) {
    const tag = el.localName;
    if (tag === "textarea") return (el.value || "").trim();
    if (tag === "select") return Array.from(el.selectedOptions || []).map((o) => o.textContent.trim()).join(" ").trim();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (!NO_EMBEDDED_VALUE_TYPES.includes(type)) return (el.value || "").trim();
    }
    return "";
  }
  var NO_NAME_FROM_CONTENT = /* @__PURE__ */ new Set(["input", "select", "textarea", "iframe"]);
  var NOT_RENDERED = /* @__PURE__ */ new Set(["style", "script", "template", "noscript"]);
  function getNameFromContent(el) {
    if (NO_NAME_FROM_CONTENT.has(el.localName)) return "";
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          parts.push(child.nodeValue);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.getAttribute("aria-hidden") === "true") continue;
        if (NOT_RENDERED.has(child.localName)) continue;
        const label = child.getAttribute("aria-label");
        if (label && label.trim()) {
          parts.push(label);
          continue;
        }
        if (child.localName === "img" || child.localName === "area") {
          parts.push(child.getAttribute("alt") || "");
          continue;
        }
        if (NO_NAME_FROM_CONTENT.has(child.localName)) {
          parts.push(getEmbeddedValue(child));
          continue;
        }
        walk(child);
      }
    };
    walk(el);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function looksLikeNavClass(el) {
    return Array.from(el.classList || []).some((c) => /nav(bar|igation)?([-_]|$)/i.test(c));
  }
  function markProcessed(el, status = "done") {
    el.dataset.ai4a11yProcessed = status;
  }
  function wasProcessed(el) {
    return !!el.dataset.ai4a11yProcessed;
  }

  // tools/adapters/math-a11y.js
  var logFix6 = globalThis.ai4a11yLogFix || (() => {
  });
  var MAX_ELEMENTS = 100;
  var MATH_HINT_RE = /math|equation|latex|tex|formula/i;
  var TEX_PARAM_RE = /^(tex|latex|formula|eq|chl)$/i;
  var INVISIBLE_OPS_RE = /[⁡-⁤]/g;
  var MAX_DEPTH = 20;
  var LEAF_TAGS = /* @__PURE__ */ new Set(["mi", "mn", "mo", "mtext", "ms"]);
  var SKIP_TAGS4 = /* @__PURE__ */ new Set(["annotation", "annotation-xml", "mphantom"]);
  function hasAccessibleName2(el) {
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return true;
    return !!getLabelledByText(el);
  }
  function serializeMath(el, depth = 0) {
    if (depth > MAX_DEPTH) return "";
    const name = (el.localName || "").toLowerCase();
    if (SKIP_TAGS4.has(name)) return "";
    if (LEAF_TAGS.has(name)) return (el.textContent || "").replace(INVISIBLE_OPS_RE, "").trim();
    const kids = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      const s = serializeMath(c, depth + 1);
      if (s) kids.push(s);
    }
    switch (name) {
      case "mfrac":
        return kids.join(" over ");
      case "msup":
        return kids.length === 2 ? `${kids[0]} to the power of ${kids[1]}` : kids.join(" ");
      case "msub":
        return kids.length === 2 ? `${kids[0]} sub ${kids[1]}` : kids.join(" ");
      case "msubsup":
        return kids.length === 3 ? `${kids[0]} sub ${kids[1]} to the power of ${kids[2]}` : kids.join(" ");
      case "msqrt":
        return `square root of ${kids.join(" ")}`;
      case "mroot":
        return kids.length === 2 ? `${kids[1]} root of ${kids[0]}` : `root of ${kids.join(" ")}`;
      default:
        if (kids.length) return kids.join(" ");
        return el.firstElementChild ? "" : (el.textContent || "").replace(INVISIBLE_OPS_RE, "").trim();
    }
  }
  function deriveLabel(math) {
    const alttext = math.getAttribute("alttext");
    if (alttext && alttext.trim()) return alttext.trim();
    const ann = math.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]'
    );
    if (ann && ann.textContent && ann.textContent.trim()) return "Math: " + ann.textContent.trim();
    const spoken = serializeMath(math).replace(/\s+/g, " ").trim();
    return spoken ? "Math: " + spoken : "Mathematical expression";
  }
  function safeDecode(s) {
    try {
      return decodeURIComponent(s.replace(/\+/g, " ")).trim() || null;
    } catch {
      return s.trim() || null;
    }
  }
  function texFromUrl(src) {
    let url;
    try {
      url = new URL(src, window.location.href);
    } catch {
      return null;
    }
    if (!MATH_HINT_RE.test(url.hostname + url.pathname)) return null;
    const query = url.search.slice(1);
    if (query) {
      for (const part of query.split("&")) {
        const eq = part.indexOf("=");
        if (eq > 0 && TEX_PARAM_RE.test(part.slice(0, eq))) return safeDecode(part.slice(eq + 1));
      }
      return safeDecode(query);
    }
    const seg = (url.pathname.split("/").pop() || "").replace(/\.(png|svg|gif|jpe?g)$/i, "");
    const decoded = seg ? safeDecode(seg) : null;
    return decoded && /[\\^_{}]/.test(decoded) ? decoded : null;
  }
  var MathA11y = {
    styleId: "ai4a11y-math-style",
    enabled: false,
    records: [],
    // { el, attrs: [{ name, old }] } — old === null means "was absent"
    styleHandle: null,
    // injectStyle handle for the focus outline
    cap: MAX_ELEMENTS,
    unregisterSweep: null,
    // Record the attribute's prior state, then write it — the unit of reversibility.
    setTracked(el, name, value, attrs) {
      const old = el.hasAttribute(name) ? el.getAttribute(name) : null;
      attrs.push({ name, old });
      el.setAttribute(name, value);
      logFix6("math-a11y", el, old === null ? "(none)" : old, value);
    },
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.cap = options.cap ?? MAX_ELEMENTS;
      this.sweep();
      this.styleHandle = injectStyle(
        this.styleId,
        '[role="math"]:focus { outline: 2px solid #1a5fb4; outline-offset: 2px; }'
      );
      console.log(`[AI4A11y] Math A11y enabled (${this.records.length} labeled)`);
      announce(this.records.length ? "Math labels on" : "Math labels: no unlabeled math found");
      this.unregisterSweep = registerSweep("math-a11y", () => {
        if (!this.enabled) return;
        this.sweep();
      }, { debounceMs: 600 });
    },
    // One pass over the document for unlabeled math/equation-image candidates.
    // Safe to call repeatedly — already-labeled elements are skipped by their
    // own gates (hasAccessibleName / non-empty alt), and `records` accumulates
    // across calls so the cap is enforced over the adapter's whole lifetime.
    sweep() {
      let mathCount = 0, imgCount = 0;
      for (const math of document.querySelectorAll("math")) {
        if (this.records.length >= this.cap) break;
        if (math.getAttribute("aria-hidden") === "true") continue;
        if (hasAccessibleName2(math)) continue;
        const attrs = [];
        this.setTracked(math, "aria-label", deriveLabel(math), attrs);
        if (!math.hasAttribute("role")) this.setTracked(math, "role", "math", attrs);
        this.records.push({ el: math, attrs });
        mathCount++;
      }
      for (const img of document.querySelectorAll("img")) {
        if (this.records.length >= this.cap) break;
        if (img.getAttribute("aria-hidden") === "true") continue;
        const alt = img.getAttribute("alt");
        if (alt && alt.trim()) continue;
        const src = img.getAttribute("src") || "";
        const address = /^data:/i.test(src) ? "" : src;
        if (!MATH_HINT_RE.test(`${img.className} ${alt || ""} ${address}`)) continue;
        const tex = texFromUrl(src);
        const attrs = [];
        this.setTracked(
          img,
          "alt",
          tex ? `Equation: ${tex}` : "Mathematical equation (no description available)",
          attrs
        );
        this.records.push({ el: img, attrs });
        imgCount++;
      }
      if (mathCount || imgCount) {
        console.log(`[AI4A11y] Math A11y: ${mathCount} MathML, ${imgCount} images labeled`);
      }
      return mathCount + imgCount;
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.unregisterSweep) {
        this.unregisterSweep();
        this.unregisterSweep = null;
      }
      for (const { el, attrs } of this.records) {
        for (const { name, old } of attrs) {
          try {
            if (old === null) el.removeAttribute(name);
            else el.setAttribute(name, old);
          } catch {
          }
        }
      }
      this.records = [];
      if (this.styleHandle) {
        this.styleHandle.remove();
        this.styleHandle = null;
      }
      console.log("[AI4A11y] Math A11y disabled");
      announce("Math labels off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yMathA11y = MathA11y;

  // tools/adapters/auto-transcriber.js
  var MESSAGE_MS = 4e3;
  function captionTracks(video) {
    const list = video.textTracks ? [...video.textTracks] : [];
    return list.filter((t) => t && (t.kind === "captions" || t.kind === "subtitles"));
  }
  var AutoTranscriber = {
    enabled: false,
    observer: null,
    videoStates: /* @__PURE__ */ new Map(),
    styleId: "ai4a11y-caption-helper-styles",
    _enableTimer: null,
    _pagehideHandler: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.injectStyles();
      this.setupVideoObserver();
      this.enableCaptionsOnAllVideos();
      this._enableTimer = setTimeout(() => {
        this._enableTimer = null;
        if (this.enabled) this.enableCaptionsOnAllVideos();
      }, 1e3);
      console.log("[AI4A11y] Auto Transcriber enabled");
      const n = this.videoStates.size;
      announce(n ? `Caption button added to ${n === 1 ? "the video" : n + " videos"}` : "Caption buttons on");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this._enableTimer) {
        clearTimeout(this._enableTimer);
        this._enableTimer = null;
      }
      if (this._pagehideHandler) {
        window.removeEventListener("pagehide", this._pagehideHandler);
        this._pagehideHandler = null;
      }
      this.observer?.disconnect();
      this.observer = null;
      for (const video of [...this.videoStates.keys()]) this.cleanupVideo(video);
      document.querySelectorAll(".ai4a11y-audio-btn, .ai4a11y-caption-box").forEach((el) => el.remove());
      document.getElementById(this.styleId)?.remove();
      document.querySelectorAll("video[data-ai4a11y-setup]").forEach((v) => {
        delete v.dataset.ai4a11ySetup;
      });
      this.videoStates.clear();
      console.log("[AI4A11y] Auto Transcriber disabled");
      announce("Caption buttons removed");
    },
    injectStyles() {
      if (document.getElementById(this.styleId)) return;
      const style = document.createElement("style");
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
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === "VIDEO") this.setupVideo(node);
              if (node.tagName === "IFRAME" && node.src?.includes("youtube")) {
                this.enableYouTubeCaptions(node);
              }
              node.querySelectorAll?.("video")?.forEach((v) => this.setupVideo(v));
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === "VIDEO") this.cleanupVideo(node);
              node.querySelectorAll?.("video")?.forEach((v) => this.cleanupVideo(v));
            }
          }
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
      this._pagehideHandler = () => this.disable();
      window.addEventListener("pagehide", this._pagehideHandler, { once: true });
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
      for (const { track, prevMode } of state.trackModes) {
        try {
          track.mode = prevMode;
        } catch {
        }
      }
      this.videoStates.delete(video);
      delete video.dataset.ai4a11ySetup;
    },
    enableCaptionsOnAllVideos() {
      document.querySelectorAll("video").forEach((v) => this.setupVideo(v));
      document.querySelectorAll('iframe[src*="youtube"]').forEach((f) => this.enableYouTubeCaptions(f));
      if (location.hostname.includes("youtube.com")) this.enableYouTubePageCaptions();
    },
    setupVideo(video) {
      if (this.videoStates.has(video)) return;
      const rect = video.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 75) return;
      const wrapper = video.parentElement;
      if (!wrapper) return;
      video.dataset.ai4a11ySetup = "true";
      let prevPosition = null;
      if (getComputedStyle(wrapper).position === "static") {
        prevPosition = wrapper.style.position;
        wrapper.style.position = "relative";
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai4a11y-audio-btn";
      btn.textContent = "CC";
      btn.setAttribute("aria-label", "Captions");
      const showing = captionTracks(video).some((t) => t.mode === "showing");
      btn.setAttribute("aria-pressed", showing ? "true" : "false");
      btn.title = showing ? "Hide captions" : "Show captions";
      btn.onclick = () => this.toggleTranscription(video, btn);
      wrapper.appendChild(btn);
      const captionBox = document.createElement("div");
      captionBox.className = "ai4a11y-caption-box";
      captionBox.style.display = "none";
      wrapper.appendChild(captionBox);
      this.videoStates.set(video, { btn, captionBox, wrapper, prevPosition, trackModes: [], isTranscribing: showing, messageTimer: null });
    },
    _setPressed(state, on) {
      state.isTranscribing = on;
      state.btn.setAttribute("aria-pressed", on ? "true" : "false");
      state.btn.title = on ? "Hide captions" : "Show captions";
    },
    async toggleTranscription(video, btn) {
      const state = this.videoStates.get(video);
      if (!state) return;
      clearTimeout(state.messageTimer);
      const tracks = captionTracks(video);
      if (state.isTranscribing || tracks.some((t) => t.mode === "showing")) {
        this._setPressed(state, false);
        state.captionBox.style.display = "none";
        for (const t of tracks) {
          if (t.mode !== "showing") continue;
          if (!state.trackModes.some((m) => m.track === t)) state.trackModes.push({ track: t, prevMode: t.mode });
          try {
            t.mode = "hidden";
          } catch {
          }
        }
        announce("Captions off");
        return;
      }
      this._setPressed(state, true);
      if (tracks.length) {
        const lang = String(typeof navigator !== "undefined" && navigator.language || "en").slice(0, 2).toLowerCase();
        const want = tracks.find((t) => (t.language || "").toLowerCase().startsWith(lang)) || tracks[0];
        if (!state.trackModes.some((m) => m.track === want)) state.trackModes.push({ track: want, prevMode: want.mode });
        try {
          want.mode = "showing";
        } catch {
        }
        announce("Captions on");
        return;
      }
      state.captionBox.style.display = "block";
      state.captionBox.textContent = "Getting captions\u2026";
      await this.transcribeVideo(video, state);
    },
    async transcribeVideo(video, state) {
      let text = null;
      try {
        const ytMatch = video.closest("[data-video-id]")?.dataset.videoId || location.hostname.includes("youtube.com") && window.location.href.match(/[?&]v=([^&]+)/)?.[1];
        if (ytMatch) text = await getYouTubeTranscript(ytMatch);
        if (!text) {
          const src = video.currentSrc || video.src;
          const result = src ? await transcribeVideo(src) : null;
          text = result && result.text ? result.text : null;
        }
      } catch (e) {
        console.warn("[AI4A11y] Transcription error:", e);
      }
      if (!this.enabled || !state.isTranscribing || this.videoStates.get(video) !== state) return;
      if (text) {
        state.captionBox.textContent = text;
        announce("Transcript shown on the video");
        return;
      }
      const msg = "No captions are available for this video";
      state.captionBox.textContent = msg;
      announce(msg);
      this._setPressed(state, false);
      state.messageTimer = setTimeout(() => {
        if (!state.isTranscribing) state.captionBox.style.display = "none";
      }, MESSAGE_MS);
    },
    enableYouTubeCaptions(iframe) {
      if (iframe.dataset.ai4a11yCaptionsEnabled) return;
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
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yAutoTranscriber = AutoTranscriber;

  // tools/adapters/show-captions.js
  var logFix7 = globalThis.ai4a11yLogFix || (() => {
  });
  function preferredLang() {
    const l = typeof navigator !== "undefined" && navigator.language || "en";
    return String(l).slice(0, 2).toLowerCase();
  }
  var PLAYERS = [
    {
      name: "youtube",
      button: () => document.querySelector(".ytp-subtitles-button"),
      isOn: (btn) => btn.getAttribute("aria-pressed") === "true"
    },
    {
      name: "vimeo",
      // Not the toolkit's own caption buttons (auto-transcriber's "Captions"
      // toggle): clicking that would pop up its "no captions" message.
      button: () => document.querySelector('.vp-captions-button, button[aria-label*="aptions" i]:not([class*="ai4a11y"])'),
      isOn: (btn) => btn.getAttribute("aria-pressed") === "true"
    }
  ];
  var DATA = "ai4a11yCaptions";
  var ShowCaptions = {
    enabled: false,
    _restore: [],
    // [{ track, prevMode }] for native tracks we switched on
    _clicked: null,
    // Set of "player|url" we've already turned on (once per URL)
    _unregister: null,
    // Enable the best caption/subtitle track on each <video> that has one, once.
    _enableNativeTracks() {
      const lang = preferredLang();
      let turnedOn = 0;
      for (const v of document.querySelectorAll("video")) {
        if (v.dataset[DATA]) continue;
        const list = v.textTracks ? [...v.textTracks] : [];
        const tracks = list.filter((t) => t && (t.kind === "captions" || t.kind === "subtitles"));
        if (!tracks.length) continue;
        const want = tracks.find((t) => (t.language || "").toLowerCase().startsWith(lang)) || tracks[0];
        this._restore.push({ track: want, prevMode: want.mode });
        if (want.mode !== "showing") turnedOn++;
        try {
          want.mode = "showing";
        } catch {
        }
        v.dataset[DATA] = "on";
        logFix7("showCaptions", v, "(off)", "showing");
      }
      return turnedOn;
    },
    // Turn on captions for players that own their CC UI — at most once per URL, so
    // the user turning them back off isn't overridden by the next mutation.
    _enablePlayerCaptions() {
      const url = typeof location !== "undefined" ? location.href : "";
      for (const p of PLAYERS) {
        let btn;
        try {
          btn = p.button();
        } catch {
          btn = null;
        }
        if (!btn) continue;
        const key = p.name + "|" + url;
        if (this._clicked.has(key)) continue;
        this._clicked.add(key);
        if (!p.isOn(btn)) {
          try {
            btn.click();
          } catch {
          }
          logFix7("showCaptions", btn, "(off)", "on");
        }
      }
    },
    _sweep() {
      if (!this.enabled) return 0;
      const n = this._enableNativeTracks();
      this._enablePlayerCaptions();
      return n;
    },
    // Say what happened, so switching it on is never silent: a video with no
    // caption track (the store's product video) can't be helped by this one.
    _report(n) {
      const videos = document.querySelectorAll("video");
      if (!videos.length) return;
      const withTracks = [...videos].filter((v) => v.dataset[DATA]).length;
      if (n) announce(`Captions turned on for ${n === 1 ? "the video" : n + " videos"}`);
      else if (withTracks) announce("Captions are on");
      else announce(videos.length === 1 ? "This video has no captions to turn on" : "These videos have no captions to turn on");
    },
    enable() {
      if (this.enabled) {
        this._sweep();
        return;
      }
      this.enabled = true;
      this._restore = [];
      this._clicked = /* @__PURE__ */ new Set();
      this._report(this._sweep());
      this._unregister = registerSweep("show-captions", () => this._sweep(), { debounceMs: 400 });
      console.log("[AI4A11y] Show Captions enabled");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this._unregister) {
        this._unregister();
        this._unregister = null;
      }
      for (const { track, prevMode } of this._restore) {
        try {
          track.mode = prevMode;
        } catch {
        }
      }
      this._restore = [];
      for (const v of document.querySelectorAll("video[data-ai4a11y-captions]")) delete v.dataset[DATA];
      this._clicked = null;
      console.log("[AI4A11y] Show Captions disabled");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yShowCaptions = ShowCaptions;

  // tools/adapters/fix-landmarks.js
  var logFix8 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat = globalThis.ai4a11yIncrementStat || (() => {
  });
  var LANDMARK_SELECTOR = 'header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';
  var SHELL_SELECTOR = 'header, footer, main, [role="banner"], [role="contentinfo"], [role="main"]';
  var MAIN_ID = /^(main|content|main-?content|primary)$/i;
  function ensureMainLandmark() {
    if (document.querySelector('main, [role="main"]')) return false;
    const isCandidate = (el) => {
      const tag = el.tagName.toLowerCase();
      if (["header", "footer", "nav", "aside", "script", "style", "noscript"].includes(tag)) return false;
      if (el.getAttribute("role")) return false;
      if ((el.textContent?.trim().length || 0) <= 100) return false;
      if (el.querySelector(SHELL_SELECTOR)) return false;
      return true;
    };
    let level = Array.from(document.body.children);
    let candidates = level.filter(isCandidate);
    if (candidates.length === 0) {
      const shell = level.find((el) => (el.textContent?.trim().length || 0) > 100 && el.querySelector(LANDMARK_SELECTOR));
      if (shell) candidates = Array.from(shell.children).filter(isCandidate);
    }
    if (candidates.length === 0) return false;
    const named = candidates.filter((el) => MAIN_ID.test(el.id || "") || el.classList && (el.classList.contains("main") || el.classList.contains("content")));
    const main = (named.length ? named : candidates).reduce((a, b) => (a.textContent?.length || 0) >= (b.textContent?.length || 0) ? a : b);
    main.setAttribute("role", "main");
    markProcessed(main, "done");
    incrementStat("wcag");
    logFix8("landmark", main, "(no main landmark)", 'role="main"');
    console.log('[AI4A11y] Added role="main" landmark');
    return true;
  }
  var HEADER_HINT = /\b(header|masthead|banner|topbar|top-bar)\b/i;
  var NOT_HEADER = /cookie|consent|gdpr|privacy|notice|alert|promo/i;
  var FOOTER_HINT = /\b(footer|site-?foot|page-?foot|colophon|copyright)\b/i;
  var COPYRIGHT_RE = /©|\(c\)\s*\d|copyright|all rights reserved/i;
  var hint = (re, el) => re.test(el.className || "") || re.test(el.id || "");
  function ensureBanner() {
    if (document.querySelector('header, [role="banner"]')) return false;
    const el = Array.from(document.querySelectorAll("div, section, td, aside")).filter((e) => !e.getAttribute("role") && hint(HEADER_HINT, e) && !hint(NOT_HEADER, e)).filter((e) => !e.querySelector('main, [role="main"]')).filter((e) => (e.textContent?.trim().length || 0) < 2e3)[0];
    if (!el) return false;
    el.setAttribute("role", "banner");
    incrementStat("wcag");
    logFix8("landmark", el, "(unmarked header)", 'role="banner"');
    return true;
  }
  function ensureContentinfo() {
    if (document.querySelector('footer, [role="contentinfo"]')) return false;
    const cands = Array.from(document.querySelectorAll("div, section, td, aside")).filter((e) => !e.getAttribute("role")).filter((e) => hint(FOOTER_HINT, e) || COPYRIGHT_RE.test((e.textContent || "").slice(-400))).filter((e) => !e.querySelector('main, [role="main"], nav, [role="navigation"], header, [role="banner"]')).filter((e) => (e.textContent?.trim().length || 0) < 1500);
    const el = cands[cands.length - 1];
    if (!el) return false;
    el.setAttribute("role", "contentinfo");
    incrementStat("wcag");
    logFix8("landmark", el, "(unmarked footer)", 'role="contentinfo"');
    return true;
  }
  function ensureStructuralLandmarks() {
    let fixed = 0;
    document.querySelectorAll('div[class*="nav" i]:not([role])').forEach((el) => {
      if (!looksLikeNavClass(el)) return;
      if (el.closest('nav, [role="navigation"]')) return;
      const links = el.querySelectorAll("a").length;
      const textLength = el.textContent?.trim().length || 1;
      if (links >= 3 && links * 15 / textLength > 0.5) {
        el.setAttribute("role", "navigation");
        incrementStat("wcag");
        logFix8("landmark", el, "(unmarked nav)", 'role="navigation"');
        fixed++;
      }
    });
    if (ensureBanner()) fixed++;
    if (ensureContentinfo()) fixed++;
    return fixed;
  }
  function fixLandmarks() {
    let count = 0;
    if (ensureMainLandmark()) count++;
    count += ensureStructuralLandmarks();
    return count;
  }
  var axeHandlers = {
    "landmark-one-main": () => ensureMainLandmark()
  };
  var FixLandmarks = {
    id: "fix-landmarks",
    enabled: false,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      try {
        fixLandmarks();
      } catch {
      }
    },
    disable() {
      this.enabled = false;
    },
    toggle() {
      this.enabled ? this.disable() : this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yFixLandmarks = FixLandmarks;

  // tools/adapters/generate-alt.js
  var logFix9 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat2 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var GENERIC_JUNK = /* @__PURE__ */ new Set(["image", "picture", "photo", "photograph", "graphic", "icon", "logo", "img"]);
  function isConfidentDescription(text) {
    if (typeof text !== "string") return false;
    const t = text.trim();
    if (t.length < 3 || t.length > 300) return false;
    if (GENERIC_JUNK.has(t.toLowerCase())) return false;
    for (const prefix of REFUSAL_PREFIXES) {
      if (t.startsWith(prefix)) return false;
    }
    for (const term of UNCERTAINTY_TERMS) {
      if (t.includes(term)) return false;
    }
    return true;
  }
  async function generateImageAlt(img) {
    if (img.dataset.ai4a11yProcessed) return null;
    markProcessed(img, "pending");
    try {
      const dataUrl = await imageToDataUrl(img);
      if (!dataUrl) {
        markProcessed(img, "failed");
        return null;
      }
      const result = await describeImage(dataUrl);
      if (isConfidentDescription(result)) {
        const altText = result.trim();
        img.setAttribute("alt", altText);
        markProcessed(img, "done");
        incrementStat2("images");
        logFix9("alt text", img, "(empty)", altText);
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
    if (svg.dataset.ai4a11yProcessed) return null;
    markProcessed(svg, "pending");
    try {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
      const result = await describeImage(dataUrl);
      if (isConfidentDescription(result)) {
        const description = result.trim();
        let title = svg.querySelector("title");
        if (!title) {
          title = document.createElementNS("http://www.w3.org/2000/svg", "title");
          svg.insertBefore(title, svg.firstChild);
        }
        title.textContent = description;
        svg.setAttribute("role", "img");
        markProcessed(svg, "done");
        incrementStat2("images");
        logFix9("svg description", svg, "(none)", description);
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
  var axeHandlers2 = {
    "image-alt": generateImageAlt,
    "svg-img-alt": generateSvgDescription
  };

  // tools/constants.js
  var DEPRECATED_ROLES = {
    directory: "list"
  };
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
  var logFix10 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat3 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var JUNK_NAME_RE = /^(q|s|utf8|token|id|csrf.*|_csrf.*|authenticity_token|__RequestVerificationToken)$/i;
  function isJunkName(name) {
    return !name || JUNK_NAME_RE.test(name.trim());
  }
  function isValidLabel(label) {
    if (!label || typeof label !== "string") return false;
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 60) return false;
    if (/\n/.test(trimmed)) return false;
    if (REFUSAL_RE.test(trimmed)) return false;
    return true;
  }
  async function generateLinkLabel(link) {
    if (link.dataset.ai4a11yProcessed) return null;
    if (!isVisible(link)) return null;
    if (hasAccessibleName(link)) return null;
    markProcessed(link, "pending");
    const href = link.href || "";
    const existingText = link.textContent?.trim() || "";
    const context = getContextForElement(link);
    let label;
    try {
      label = await inferLabel({
        elementType: "link",
        html: link.outerHTML?.substring(0, 500) || "",
        context: [existingText, href, context].filter(Boolean).join(" | ")
      });
    } catch (e) {
      console.warn("[AI4A11y] Link label inference failed:", e.message);
      markProcessed(link, "failed");
      return null;
    }
    if (isValidLabel(label)) {
      const trimmed = label.trim();
      link.setAttribute("aria-label", trimmed);
      markProcessed(link, "done");
      incrementStat3("labels");
      logFix10("link label", link, existingText || "(empty)", trimmed);
      console.log("[AI4A11y] Generated link label:", trimmed);
      return trimmed;
    }
    markProcessed(link, "failed");
    return null;
  }
  async function generateButtonLabel(button) {
    if (button.dataset.ai4a11yProcessed) return null;
    if (!isVisible(button)) return null;
    if (hasAccessibleName(button)) return null;
    markProcessed(button, "pending");
    const inferred = inferButtonLabel(button);
    if (inferred) {
      button.setAttribute("aria-label", inferred);
      markProcessed(button, "done");
      incrementStat3("labels");
      logFix10("button label", button, "(empty)", inferred);
      return inferred;
    }
    const context = getContextForElement(button);
    let label;
    try {
      label = await inferLabel({
        elementType: "button",
        html: button.outerHTML?.substring(0, 500) || "",
        context
      });
    } catch (e) {
      console.warn("[AI4A11y] Button label inference failed:", e.message);
      markProcessed(button, "failed");
      return null;
    }
    if (isValidLabel(label)) {
      const trimmed = label.trim();
      button.setAttribute("aria-label", trimmed);
      markProcessed(button, "done");
      incrementStat3("labels");
      logFix10("button label", button, "(empty)", trimmed);
      return trimmed;
    }
    markProcessed(button, "failed");
    return null;
  }
  async function generateIframeTitle(iframe) {
    if (iframe.dataset.ai4a11yProcessed) return null;
    if (!isVisible(iframe)) return null;
    if (hasAccessibleName(iframe)) return null;
    markProcessed(iframe, "pending");
    const src = iframe.src || "";
    for (const [pattern, title] of Object.entries(IFRAME_PATTERNS)) {
      if (src.includes(pattern)) {
        iframe.setAttribute("title", title);
        markProcessed(iframe, "done");
        incrementStat3("labels");
        logFix10("iframe title", iframe, "(empty)", title);
        return title;
      }
    }
    try {
      const url = new URL(src);
      const title = `Embedded content from ${url.hostname}`;
      iframe.setAttribute("title", title);
      markProcessed(iframe, "done");
      incrementStat3("labels");
      logFix10("iframe title", iframe, "(empty)", title);
      return title;
    } catch {
      const title = "Embedded content";
      iframe.setAttribute("title", title);
      markProcessed(iframe, "done");
      return title;
    }
  }
  async function generateFormLabel(input) {
    if (input.dataset.ai4a11yProcessed) return null;
    if (!isVisible(input)) return null;
    if (hasAccessibleName(input)) return null;
    markProcessed(input, "pending");
    if (input.placeholder && !isJunkName(input.placeholder)) {
      const label = input.placeholder.trim();
      input.setAttribute("aria-label", label);
      markProcessed(input, "done");
      incrementStat3("labels");
      logFix10("form label", input, "(empty)", label);
      return label;
    }
    if (input.name && !isJunkName(input.name)) {
      const label = input.name.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
      if (label) {
        input.setAttribute("aria-label", label);
        markProcessed(input, "done");
        incrementStat3("labels");
        logFix10("form label", input, "(empty)", label);
        return label;
      }
    }
    const nearbyText = getNearbyText(input);
    if (nearbyText && !isJunkName(nearbyText)) {
      input.setAttribute("aria-label", nearbyText);
      markProcessed(input, "done");
      incrementStat3("labels");
      logFix10("form label", input, "(empty)", nearbyText);
      return nearbyText;
    }
    markProcessed(input, "skipped");
    return null;
  }
  function inferButtonLabel(button) {
    const className = button.className?.toLowerCase() || "";
    const svgPaths = button.querySelector("svg path")?.getAttribute("d") || "";
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
    const parent = el.parentElement;
    if (!parent) return "";
    const clone = parent.cloneNode(true);
    clone.querySelectorAll("script, style").forEach((s) => s.remove());
    return clone.textContent?.trim().substring(0, 200) || "";
  }
  function getNearbyText(input) {
    const prev = input.previousElementSibling;
    const next = input.nextElementSibling;
    const parent = input.parentElement;
    if (prev?.textContent?.trim()) {
      return prev.textContent.trim().replace(/:$/, "");
    }
    if (next?.textContent?.trim()) {
      return next.textContent.trim().replace(/:$/, "");
    }
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((e) => e.remove());
      const text = clone.textContent?.trim();
      if (text && text.length < 50) return text.replace(/:$/, "");
    }
    return null;
  }
  var axeHandlers3 = {
    "link-name": generateLinkLabel,
    "button-name": generateButtonLabel,
    "frame-title": generateIframeTitle,
    "label": generateFormLabel,
    "select-name": generateFormLabel
  };

  // tools/adapters/generate-captions.js
  var logFix11 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat4 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function generateVideoCaptions(video) {
    if (video.dataset.ai4a11yCaptioned) return null;
    video.dataset.ai4a11yCaptioned = "pending";
    const src = video.src || video.querySelector("source")?.src;
    if (!src) {
      video.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
    try {
      const result = await transcribeVideo(src);
      if (result?.text) {
        const text = result.text;
        addCaptionTrack(video, text);
        video.dataset.ai4a11yCaptioned = "done";
        incrementStat4("captions");
        logFix11("captions", video, "(none)", "(generated)");
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
    if (audio.dataset.ai4a11yCaptioned) return null;
    audio.dataset.ai4a11yCaptioned = "pending";
    const src = audio.src || audio.querySelector("source")?.src;
    if (!src) {
      audio.dataset.ai4a11yCaptioned = "failed";
      return null;
    }
    try {
      const result = await transcribeAudio(src);
      if (result?.text) {
        const text = result.text;
        addTranscriptBlock(audio, text);
        audio.dataset.ai4a11yCaptioned = "done";
        incrementStat4("captions");
        logFix11("transcript", audio, "(none)", "(generated)");
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
    const container = document.createElement("details");
    container.className = "ai4a11y-transcript";
    const summary = document.createElement("summary");
    summary.textContent = "Transcript";
    container.appendChild(summary);
    const content = document.createElement("div");
    content.className = "ai4a11y-transcript-content";
    content.textContent = text;
    container.appendChild(content);
    audio.parentElement?.insertBefore(container, audio.nextSibling);
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
  var axeHandlers4 = {
    "video-caption": generateVideoCaptions,
    "audio-caption": generateAudioCaptions
  };

  // tools/adapters/simplify-text.js
  var MIN_SIMPLIFIED_RATIO = 0.3;
  var MAX_SIMPLIFIED_RATIO = 2;
  var MAX_SUMMARY_RATIO = 1;
  var MIN_SUMMARY_CHARS = 20;
  var logFix12 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat5 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var memories = /* @__PURE__ */ new WeakMap();
  var MEMORY_MAX2 = 200;
  function memoryFor() {
    const p = getAIProvider() || memoryFor;
    if (!memories.has(p)) memories.set(p, { done: /* @__PURE__ */ new Map(), asking: /* @__PURE__ */ new Map() });
    return memories.get(p);
  }
  function rewrite(text) {
    const m = memoryFor();
    if (m.done.has(text)) return Promise.resolve(m.done.get(text));
    if (!m.asking.has(text)) {
      m.asking.set(text, Promise.resolve().then(() => simplifyText(text)).finally(() => m.asking.delete(text)));
    }
    return m.asking.get(text);
  }
  function keep(text, simplified) {
    const m = memoryFor();
    if (m.done.size >= MEMORY_MAX2) m.done.delete(m.done.keys().next().value);
    m.done.set(text, simplified);
  }
  var STYLE_ID5 = "ai4a11y-simplify-styles";
  function addStyles() {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID5)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID5;
    style.textContent = ".ai4a11y-toggle-original{margin-left:.5em;font-size:.85em;cursor:pointer}.ai4a11y-toggle-original:focus-visible{outline:2px solid #1a5fb4;outline-offset:2px;box-shadow:0 0 0 2px #fff,0 0 0 4px #1a5fb4}";
    (document.head || document.documentElement).appendChild(style);
  }
  var rewritten = 0;
  var sayTimer = null;
  function tell() {
    rewritten++;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => {
      announce(`Rewrote ${rewritten} passage${rewritten === 1 ? "" : "s"} in plainer words. Each has a Show original button.`);
      rewritten = 0;
    }, 400);
  }
  var NOT_PROSE_SEL = 'style, script, noscript, template, [hidden], [aria-hidden="true"]';
  function proseText(element) {
    if (!element || typeof element.cloneNode !== "function") return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(NOT_PROSE_SEL).forEach((n) => n.remove());
    return clone.textContent?.trim() || "";
  }
  async function simplifyText2(element) {
    if (element.dataset.ai4a11ySimplified) return null;
    element.dataset.ai4a11ySimplified = "pending";
    if (element.tagName === "TABLE" || element.querySelector("table")) {
      element.dataset.ai4a11ySimplified = "skipped";
      return null;
    }
    const originalText = proseText(element);
    if (!originalText || originalText.length < 100 || originalText.length > 1e4) {
      element.dataset.ai4a11ySimplified = "skipped";
      return null;
    }
    try {
      const simplified = await rewrite(originalText);
      if (element.dataset.ai4a11ySimplified !== "pending") return null;
      const rejected = simplified == null ? null : rejectRewrite(simplified, originalText, { minRatio: MIN_SIMPLIFIED_RATIO, maxRatio: MAX_SIMPLIFIED_RATIO });
      if (rejected) {
        console.warn(`[AI4A11y] simplifyText: rejected model output (${rejected})`);
      }
      if (simplified && !rejected) {
        keep(originalText, simplified);
        addStyles();
        element.dataset.ai4a11yOriginal = originalText;
        element.classList.add("ai4a11y-simplified");
        const originalWrapper = document.createElement("span");
        originalWrapper.className = "ai4a11y-original-content";
        originalWrapper.style.display = "none";
        while (element.firstChild) {
          originalWrapper.appendChild(element.firstChild);
        }
        const textContainer = document.createElement("span");
        textContainer.className = "ai4a11y-text-content";
        textContainer.textContent = simplified;
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "ai4a11y-toggle-original";
        toggleBtn.textContent = "Show original";
        toggleBtn.onclick = () => {
          const showingOriginal = element.dataset.ai4a11yShowOriginal === "true";
          if (showingOriginal) {
            originalWrapper.style.display = "none";
            textContainer.style.display = "";
            toggleBtn.textContent = "Show original";
            element.dataset.ai4a11yShowOriginal = "false";
          } else {
            textContainer.style.display = "none";
            originalWrapper.style.display = "";
            toggleBtn.textContent = "Show simplified";
            element.dataset.ai4a11yShowOriginal = "true";
          }
        };
        element.appendChild(originalWrapper);
        element.appendChild(textContainer);
        element.appendChild(toggleBtn);
        element.dataset.ai4a11ySimplified = "done";
        incrementStat5("text");
        logFix12("simplify", element, "(complex)", "(simplified)");
        console.log("[AI4A11y] Simplified text");
        tell();
        return simplified;
      }
      element.dataset.ai4a11ySimplified = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to simplify:", e);
      if (element.dataset.ai4a11ySimplified === "pending") element.dataset.ai4a11ySimplified = "failed";
      return null;
    }
  }
  async function summarizeContent(element) {
    if (element.dataset.ai4a11ySummarize) return null;
    element.dataset.ai4a11ySummarize = "pending";
    if (element.tagName === "TABLE") {
      element.dataset.ai4a11ySummarize = "skipped";
      return null;
    }
    const text = proseText(element);
    if (!text || text.length < 500) {
      element.dataset.ai4a11ySummarize = "skipped";
      return null;
    }
    try {
      const excerpt = text.substring(0, 3e3);
      const summary = await summarizeText(excerpt);
      const rejected = summary == null ? null : startsWithRefusal(summary) ? "reads as a refusal" : rejectRewrite(summary, excerpt, { maxRatio: MAX_SUMMARY_RATIO, minChars: MIN_SUMMARY_CHARS });
      if (rejected) {
        console.warn(`[AI4A11y] summarizeContent: rejected model output (${rejected})`);
      }
      if (summary && !rejected) {
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
        incrementStat5("text");
        logFix12("summarize", element, "(long)", "(summarized)");
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

  // tools/adapters/fix-contrast.js
  var logFix13 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat6 = globalThis.ai4a11yIncrementStat || (() => {
  });
  function isLargeText(element) {
    const style = getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize) || 16;
    const fontWeight = parseInt(style.fontWeight, 10) || 400;
    const bold = fontWeight >= 700;
    return fontSize >= 24 || bold && fontSize >= 18.67;
  }
  function hasBackgroundImage(element) {
    const bgImg = getComputedStyle(element).backgroundImage;
    return !!bgImg && bgImg !== "none";
  }
  function isOpaque(color) {
    if (!color) return false;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return true;
    const m = color.match(/^rgba?\(\s*\d+,\s*\d+,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)$/);
    return !!m && (m[1] === void 0 || parseFloat(m[1]) >= 1);
  }
  function blackOrWhite(background) {
    const black = getContrastRatio("rgb(0, 0, 0)", background) ?? 0;
    const white = getContrastRatio("rgb(255, 255, 255)", background) ?? 0;
    return black >= white ? "#000000" : "#ffffff";
  }
  async function fixLowContrast(element, color, background) {
    if (wasProcessed(element)) return null;
    markProcessed(element, "pending");
    if (hasBackgroundImage(element)) {
      markProcessed(element, "done");
      return null;
    }
    if (!isOpaque(background)) {
      background = getEffectiveBackground(element);
    }
    const large = isLargeText(element);
    if (color && meetsContrastAA(color, background, large)) {
      markProcessed(element, "done");
      return null;
    }
    let fixedColor;
    const target = large ? 3 : 4.5;
    try {
      fixedColor = await fixContrast(color, background);
    } catch (e) {
      console.warn("[AI4A11y] Contrast fix failed, using fallback:", e);
      fixedColor = null;
    }
    const passes = (c) => (getContrastRatio(c, background) ?? 0) >= target;
    if (!fixedColor || !passes(fixedColor)) fixedColor = nearestAccessibleColor(color, background, { target });
    if (!fixedColor || !passes(fixedColor)) fixedColor = blackOrWhite(background);
    if (color) {
      element.dataset.ai4a11yOriginalColor = color;
    }
    element.style.color = fixedColor;
    element.classList.add("ai4a11y-contrast-fixed");
    markProcessed(element, "done");
    incrementStat6("wcag");
    logFix13("contrast", element, color, fixedColor);
    console.log("[AI4A11y] Fixed contrast:", color, "->", fixedColor);
    return fixedColor;
  }
  function fixIndistinguishableLink(link) {
    if (wasProcessed(link)) return;
    markProcessed(link, "done");
    link.style.textDecoration = "underline";
    incrementStat6("wcag");
    logFix13("link-underline", link, "(none)", "underline");
    console.log("[AI4A11y] Added underline to link");
  }
  var axeHandlers5 = {
    "color-contrast": fixLowContrast,
    "color-contrast-enhanced": fixLowContrast,
    "link-in-text-block": fixIndistinguishableLink
  };

  // tools/adapters/wcag-fixes.js
  var logFix14 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat7 = globalThis.ai4a11yIncrementStat || (() => {
  });
  function isValidBcp47(tag) {
    if (!tag || typeof tag !== "string") return false;
    const t = tag.trim();
    if (!t) return false;
    const parts = t.split("-");
    if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) return false;
    for (let i = 1; i < parts.length; i++) {
      if (!/^[a-zA-Z0-9]{1,8}$/.test(parts[i])) return false;
    }
    return true;
  }
  function normaliseLang(raw) {
    if (!raw) return null;
    const attempt = raw.replace(/_/g, "-");
    return isValidBcp47(attempt) ? attempt : null;
  }
  function fixInvalidLang(element) {
    const currentLang = element.getAttribute("lang");
    if (!currentLang) return;
    if (isValidBcp47(currentLang)) return;
    const fixed = normaliseLang(currentLang);
    if (!fixed) {
      console.warn("[AI4A11y] Could not normalise lang attribute:", currentLang);
      return;
    }
    element.setAttribute("lang", fixed);
    incrementStat7("wcag");
    logFix14("lang", element, currentLang, fixed);
    console.log("[AI4A11y] Normalised lang attribute:", currentLang, "->", fixed);
  }
  function fixMissingLang(_element) {
    console.info("[AI4A11y] fixMissingLang: no-op (no reliable language signal to guess from)");
  }
  function fixDuplicateId(element) {
    const originalId = element.id;
    const newId = `${originalId}_${randomSuffix()}`;
    element.id = newId;
    markProcessed(element, "done");
    incrementStat7("wcag");
    logFix14("duplicate-id", element, originalId, newId);
    console.log("[AI4A11y] Renamed duplicate ID:", originalId, "->", newId);
  }
  function fixHeadingOrder(element) {
    const match = element.tagName.match(/^H([1-6])$/);
    if (!match) return;
    const currentLevel = parseInt(match[1]);
    const allHeadings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const idx = allHeadings.indexOf(element);
    if (idx === -1 || idx === 0) return;
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
      incrementStat7("wcag");
      logFix14("heading-order", newHeading, `h${currentLevel}`, `h${newLevel}`);
      console.log(`[AI4A11y] Fixed heading: h${currentLevel} -> h${newLevel}`);
    }
  }
  function fixPositiveTabindex(element) {
    const oldVal = element.getAttribute("tabindex");
    element.setAttribute("tabindex", "0");
    markProcessed(element, "done");
    incrementStat7("wcag");
    logFix14("tabindex", element, oldVal, "0");
    console.log("[AI4A11y] Fixed positive tabindex");
  }
  function fixTargetBlank(element) {
    const rel = element.getAttribute("rel") || "";
    const parts = rel.split(/\s+/).filter(Boolean);
    if (!parts.includes("noopener")) parts.push("noopener");
    if (!parts.includes("noreferrer")) parts.push("noreferrer");
    element.setAttribute("rel", parts.join(" "));
    markProcessed(element, "done");
    incrementStat7("wcag");
    logFix14("target-blank", element, rel || "(empty)", parts.join(" "));
    console.log('[AI4A11y] Added rel="noopener noreferrer"');
  }
  function fixInvalidAriaAttr(element) {
    let fixed = false;
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.startsWith("aria-") && !VALID_ARIA_ATTRS.has(attr.name)) {
        element.removeAttribute(attr.name);
        fixed = true;
        console.log("[AI4A11y] Removed invalid ARIA attr:", attr.name);
      }
    }
    if (fixed) incrementStat7("wcag");
  }
  function fixInvalidAriaRole(element) {
    const role = element.getAttribute("role");
    if (role && !VALID_ARIA_ROLES.has(role)) {
      element.removeAttribute("role");
      incrementStat7("wcag");
      logFix14("aria-role", element, role, "(removed)");
      console.log("[AI4A11y] Removed invalid role:", role);
    }
  }
  function fixDeprecatedRole(element) {
    const role = element.getAttribute("role");
    if (role && DEPRECATED_ROLES[role]) {
      element.setAttribute("role", DEPRECATED_ROLES[role]);
      incrementStat7("wcag");
      logFix14("aria-role", element, role, DEPRECATED_ROLES[role]);
      console.log("[AI4A11y] Replaced deprecated role:", role);
    }
  }
  function fixMissingAriaAttrs(_element) {
    console.info("[AI4A11y] fixMissingAriaAttrs: no-op (backfilling ARIA state would lie to screen readers)");
  }
  function fixNestedInteractive(element) {
    const parent = element.closest("a, button");
    if (!parent || element === parent) return;
    if (element.tagName === "BUTTON") {
      const span = document.createElement("span");
      while (element.firstChild) {
        span.appendChild(element.firstChild);
      }
      span.className = element.className;
      element.replaceWith(span);
      incrementStat7("wcag");
      logFix14("nested-interactive", span, "button", "span");
      console.log("[AI4A11y] Replaced nested button with span");
    } else if (element.tagName === "A") {
      element.removeAttribute("href");
      element.setAttribute("role", "presentation");
      incrementStat7("wcag");
      logFix14("nested-interactive", element, "a[href]", "a[role=presentation]");
      console.log("[AI4A11y] Made nested link non-interactive");
    }
  }
  var TARGET_SIZE_PX = 44;
  function fixTargetSize(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width >= TARGET_SIZE_PX && rect.height >= TARGET_SIZE_PX) return;
    const needWidth = Math.max(0, (TARGET_SIZE_PX - rect.width) / 2);
    const needHeight = Math.max(0, (TARGET_SIZE_PX - rect.height) / 2);
    const display = getComputedStyle(element).display;
    element.style.boxSizing = "border-box";
    element.style.padding = `${needHeight}px ${needWidth}px`;
    element.style.minWidth = `${TARGET_SIZE_PX}px`;
    element.style.minHeight = `${TARGET_SIZE_PX}px`;
    if (display === "inline") {
      element.style.display = "inline-block";
    }
    incrementStat7("wcag");
    logFix14("target-size", element, `${Math.round(rect.width)}x${Math.round(rect.height)}`, `${TARGET_SIZE_PX}x${TARGET_SIZE_PX}`);
    console.log("[AI4A11y] Increased touch target size");
  }
  function fixViewportMeta(element) {
    const oldContent = element.getAttribute("content") || "";
    let content = oldContent;
    content = content.replace(/maximum-scale\s*=\s*[\d.]+/gi, "maximum-scale=5");
    content = content.replace(/user-scalable\s*=\s*(no|0)/gi, "user-scalable=yes");
    if (content === oldContent) return;
    element.setAttribute("content", content);
    incrementStat7("wcag");
    logFix14("viewport", element, oldContent, content);
    console.log("[AI4A11y] Fixed viewport meta");
  }
  function removeMetaRefresh(_element) {
    console.info("[AI4A11y] removeMetaRefresh: no-op (the refresh timer is already armed by document_idle; removing the tag cannot cancel it)");
  }
  function replaceObsoleteElement(element) {
    const tag = element.tagName.toLowerCase();
    const replacement = tag === "blink" ? "span" : "div";
    const newEl = document.createElement(replacement);
    while (element.firstChild) {
      newEl.appendChild(element.firstChild);
    }
    element.replaceWith(newEl);
    incrementStat7("wcag");
    logFix14("obsolete", newEl, `<${tag}>`, `<${replacement}>`);
    console.log(`[AI4A11y] Replaced <${tag}> with <${replacement}>`);
  }
  function randomSuffix() {
    return Math.random().toString(36).substring(2, 7);
  }
  var fixTiers = {
    "html-has-lang": "safe",
    "html-lang-valid": "safe",
    "valid-lang": "safe",
    "duplicate-id": "safe",
    "duplicate-id-aria": "safe",
    "duplicate-id-active": "safe",
    "heading-order": "risky",
    "tabindex": "safe",
    "aria-valid-attr": "risky",
    "aria-roles": "risky",
    "aria-allowed-role": "risky",
    "aria-deprecated-role": "safe",
    "aria-required-attr": "safe",
    "nested-interactive": "risky",
    "target-size": "risky",
    "meta-viewport": "safe",
    "meta-viewport-large": "safe",
    "meta-refresh": "safe",
    "blink": "safe",
    "marquee": "safe"
  };
  function isRiskyFix(ruleId) {
    return fixTiers[ruleId] === "risky";
  }
  function gate(ruleId, fix) {
    if (!isRiskyFix(ruleId)) return fix;
    return function gatedFix(element, settings2) {
      if (settings2?.wcagRiskyFixes === true) return fix(element);
      console.info(`[AI4A11y] Skipped risky fix ${ruleId} (wcagRiskyFixes is off)`);
      return false;
    };
  }
  var rawHandlers = {
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
  var axeHandlers6 = Object.fromEntries(
    Object.entries(rawHandlers).map(([ruleId, fix]) => [ruleId, gate(ruleId, fix)])
  );

  // tools/adapters/fix-links.js
  var logFix15 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat8 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var MAX_LINKS_PER_PAGE = 10;
  async function improveAmbiguousLink(link) {
    if (link.dataset.ai4a11yProcessed) return null;
    markProcessed(link, "pending");
    const text = getAccessibleName(link);
    const context = link.closest("p, li, td, article, section")?.textContent?.trim().substring(0, 200) || "";
    try {
      const answer = await improveLinkText(text, link.href, context);
      const rejected = answer == null ? null : rejectShortText(answer);
      const improved = rejected || answer == null ? null : cleanShortText(answer);
      if (rejected) {
        console.warn(`[AI4A11y] improveAmbiguousLink: rejected model output (${rejected})`);
      } else if (improved && improved.toLowerCase() !== text.toLowerCase()) {
        link.setAttribute("aria-label", improved);
        link.classList.add("ai4a11y-adapted");
        markProcessed(link, "done");
        incrementStat8("labels");
        logFix15("link text", link, text, improved);
        return improved;
      }
    } catch (e) {
      console.warn("[AI4A11y] improveAmbiguousLink failed:", e);
    }
    markProcessed(link, "failed");
    return null;
  }
  async function improveAmbiguousLinks(links) {
    const batch = Array.from(links).slice(0, MAX_LINKS_PER_PAGE);
    const results = [];
    for (const link of batch) {
      results.push(await improveAmbiguousLink(link));
    }
    return results.filter(Boolean);
  }

  // tools/adapters/fix-tables.js
  var logFix16 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat9 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var MAX_AI_TABLES_PER_PAGE = 10;
  var MAX_AI_COLUMNS = 12;
  async function fixTableHeaders(table) {
    if (table.dataset.ai4a11yProcessed) return false;
    if (table.querySelector("th")) return false;
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) return false;
    markProcessed(table, "pending");
    const firstRowCells = Array.from(rows[0].querySelectorAll("td"));
    if (firstRowCells.length === 0) {
      markProcessed(table, "skipped");
      return false;
    }
    const isDataLike = (t) => /^[\s$€£¥+\-]*[\d.,]+\s*%?$/.test(t) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(t) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(t);
    const dataLikeCount = firstRowCells.filter((c) => isDataLike(c.textContent?.trim() || "")).length;
    const looksLikeHeader = dataLikeCount <= firstRowCells.length / 2 && firstRowCells.every((cell, i) => {
      const text = cell.textContent?.trim() || "";
      if (!text || text.length > 40) return false;
      const below = rows.slice(1, 4).map((r) => r.querySelectorAll("td")[i]?.textContent?.trim());
      return !below.includes(text);
    });
    if (looksLikeHeader) {
      firstRowCells.forEach((cell) => {
        const th = document.createElement("th");
        th.setAttribute("scope", "col");
        while (cell.firstChild) th.appendChild(cell.firstChild);
        cell.replaceWith(th);
      });
      markProcessed(table, "done");
      incrementStat9("wcag");
      logFix16("table headers", table, "(no headers)", "first row \u2192 column headers");
      return true;
    }
    if (rows.length < 4) {
      markProcessed(table, "skipped");
      return false;
    }
    try {
      const columnCount = firstRowCells.length;
      const headers = [];
      for (let col = 0; col < columnCount; col++) {
        const samples = rows.slice(0, 5).map((r) => r.querySelectorAll("td")[col]?.textContent?.trim()).filter(Boolean);
        const answer = col < MAX_AI_COLUMNS && samples.length >= 2 ? await inferColumnHeader(samples) : null;
        const rejected = answer == null ? null : rejectShortText(answer);
        if (rejected) {
          console.warn(`[AI4A11y] fixTableHeaders: rejected model output for column ${col + 1} (${rejected})`);
        }
        const header = rejected || answer == null ? null : cleanShortText(answer);
        headers.push(header || `Column ${col + 1}`);
      }
      const thead = document.createElement("thead");
      thead.dataset.ai4a11yGenerated = "true";
      const headerRow = document.createElement("tr");
      for (const label of headers) {
        const th = document.createElement("th");
        th.setAttribute("scope", "col");
        th.textContent = label;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.prepend(thead);
      markProcessed(table, "done");
      incrementStat9("wcag");
      logFix16("table headers", table, "(no headers)", headers.join(", "));
      return true;
    } catch (e) {
      console.warn("[AI4A11y] fixTableHeaders failed:", e);
      markProcessed(table, "failed");
      return false;
    }
  }
  async function fixAllTables() {
    const candidates = Array.from(document.querySelectorAll("table")).filter((t) => !t.dataset.ai4a11yProcessed && !t.querySelector("th") && t.querySelectorAll("tr").length >= 2).filter((t) => !t.getAttribute("role") || t.getAttribute("role") === "table");
    const tables = candidates.slice(0, MAX_AI_TABLES_PER_PAGE);
    if (candidates.length > tables.length) {
      console.log(`[AI4A11y] fix-tables: fixing ${tables.length} of ${candidates.length} headerless tables this pass (cost cap)`);
    }
    const results = [];
    for (const table of tables) {
      results.push(await fixTableHeaders(table));
    }
    return results.filter(Boolean).length;
  }

  // tools/adapters/index.js
  var axeHandlers7 = {
    ...axeHandlers2,
    ...axeHandlers3,
    ...axeHandlers4,
    ...axeHandlers5,
    ...axeHandlers6,
    ...axeHandlers
  };
  function getAxeHandler(ruleId) {
    return axeHandlers7[ruleId] || null;
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
  var CONTENT_IMAGE_MIN_PX = 100;
  var CANVAS_MIN_PX = 50;
  function findImagesWithoutAlt() {
    return Array.from(document.querySelectorAll("img")).filter((img) => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;
      if (!img.hasAttribute("alt")) return true;
      return false;
    });
  }
  function findEmptyAltImages() {
    return Array.from(document.querySelectorAll('img[alt=""]')).filter((img) => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;
      if (isLikelyDecorative(img)) return false;
      const { width, height } = getImageSize(img);
      return width > CONTENT_IMAGE_MIN_PX && height > CONTENT_IMAGE_MIN_PX;
    });
  }
  function findCanvasElements() {
    return Array.from(document.querySelectorAll("canvas")).filter((canvas) => {
      if (wasProcessed(canvas)) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > CANVAS_MIN_PX && rect.height > CANVAS_MIN_PX;
    });
  }

  // tools/auditors/missing-captions.js
  var TRANSCRIPT_HINT = "transcript";
  function findVideosWithoutCaptions() {
    return Array.from(document.querySelectorAll("video")).filter((video) => {
      if (wasProcessed(video)) return false;
      if (!isVisible(video)) return false;
      const tracks = video.querySelectorAll('track[kind="captions"], track[kind="subtitles"]');
      if (tracks.length > 0) return false;
      if (video.textTracks?.length > 0) {
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
      if (wasProcessed(audio)) return false;
      if (!isVisible(audio)) return false;
      const parent = audio.parentElement;
      if (!parent) return true;
      const text = parent.textContent?.toLowerCase() || "";
      if (text.includes(TRANSCRIPT_HINT)) return false;
      if (audio.querySelector("track")) return false;
      return true;
    });
  }

  // tools/auditors/missing-labels.js
  var AMBIGUOUS_LINK_TEXTS = [
    "click here",
    "here",
    "read more",
    "more",
    "learn more",
    "continue",
    "link",
    "this",
    "this link"
  ];
  function findEmptyLinks() {
    return Array.from(document.querySelectorAll("a[href]")).filter((link) => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;
      return !hasAccessibleName(link);
    });
  }
  function findAmbiguousLinks() {
    return Array.from(document.querySelectorAll("a[href]")).filter((link) => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;
      const text = getAccessibleName(link).toLowerCase();
      return text && AMBIGUOUS_LINK_TEXTS.includes(text);
    });
  }
  function findEmptyButtons() {
    const buttons = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('[role="button"]')
    ];
    return buttons.filter((btn) => {
      if (wasProcessed(btn)) return false;
      if (!isVisible(btn)) return false;
      return !hasAccessibleName(btn);
    });
  }
  function findUnlabeledInputs() {
    const inputs = document.querySelectorAll("input, select, textarea");
    return Array.from(inputs).filter((input) => {
      if (wasProcessed(input)) return false;
      if (!isVisible(input)) return false;
      if (input.type === "hidden") return false;
      if (getAccessibleName(input)) return false;
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) return false;
      }
      if (input.closest("label")) return false;
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
      if (wasProcessed(el)) return;
      if (!isVisible(el)) return;
      const hasDirectText = Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );
      if (!hasDirectText) return;
      const style = getComputedStyle(el);
      const color = style.color;
      const background = getEffectiveBackground(el);
      const ratio = getContrastRatio(color, background);
      if (ratio === null) return;
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

  // tools/auditors/missing-landmarks.js
  function pageMissingMainLandmark() {
    return !document.querySelector('main, [role="main"]');
  }
  var SECTIONING = "article, aside, main, nav, section";
  function hasPageBanner() {
    if (document.querySelector('[role="banner"]')) return true;
    return Array.from(document.querySelectorAll("header")).some((h) => !h.closest(SECTIONING));
  }
  function hasPageContentinfo() {
    if (document.querySelector('[role="contentinfo"]')) return true;
    return Array.from(document.querySelectorAll("footer")).some((f) => !f.closest(SECTIONING));
  }
  var NAV_LIKE_MIN_LINKS = 3;
  function findUnmarkedNavigation() {
    return Array.from(document.querySelectorAll('div[class*="nav" i]:not([role])')).filter((el) => {
      if (!looksLikeNavClass(el)) return false;
      if (!isVisible(el)) return false;
      if (el.closest('nav, [role="navigation"]')) return false;
      return el.querySelectorAll("a").length >= NAV_LIKE_MIN_LINKS;
    });
  }
  function auditLandmarks() {
    return {
      hasMain: !pageMissingMainLandmark(),
      hasBanner: hasPageBanner(),
      hasContentinfo: hasPageContentinfo(),
      hasNavigation: !!document.querySelector('nav, [role="navigation"]'),
      unmarkedNavCandidates: findUnmarkedNavigation().length
    };
  }

  // tools/profiles/settings.json
  var settings_default = {
    $comment: "Single source of truth for ability profiles. Consumed by tools/profiles/settings.js (bundled into the extension + CLI tools) and read directly by cli/cli.py. Values are evidence-based \u2014 sources: W3C WCAG, W3C COGA, WebAIM Low Vision Survey, AASPIRE autism study, NNGroup UX research.",
    profiles: {
      blind: {
        name: "Blind",
        description: "Optimized for screen reader users: structure, labels, descriptions",
        tools: {
          autoWcagFix: true,
          autoFixLabels: true,
          autoDescribe: true,
          autoVideoDescribe: true,
          fixLandmarks: true,
          announceUpdates: true,
          describeOnDemand: true,
          languageTag: true,
          exploreChart: true,
          spaFocus: true,
          skipLinks: true,
          mathAccessible: true
        }
      },
      lowVision: {
        name: "Low Vision",
        description: "Larger text (150%), spacing, large cursor, enhanced focus, contrast fixes",
        tools: {
          autoWcagFix: true,
          fontScale: 150,
          lineHeight: 2,
          letterSpacing: 0.12,
          largeCursor: true,
          enhanceFocus: true,
          fixContrast: true,
          highlightLinks: true,
          unpinSticky: true,
          magnifier: true,
          reflowColumn: true,
          focusLocator: true,
          persistentHover: true,
          exploreChart: true
        }
      },
      colorBlind: {
        name: "Color Blindness",
        description: "Contrast fixes and image descriptions; pick your own filter type in Visual Assist",
        tools: {
          fixContrast: true,
          autoDescribe: true,
          enhanceFocus: true
        }
      },
      deaf: {
        name: "Deaf/HoH",
        description: "Auto captions for media, visual focus for non-audio navigation",
        tools: {
          showCaptions: true,
          liveCaptions: true,
          autoCaptions: true,
          enhanceFocus: true,
          autoDescribe: false,
          autoVideoDescribe: false,
          soundVisualizer: true
        }
      },
      motor: {
        name: "Motor",
        description: "Keyboard navigation, voice commands, large targets, proper labels",
        tools: {
          autoWcagFix: true,
          autoFixLabels: true,
          largeCursor: true,
          enhanceFocus: true,
          keyboardNav: true,
          voiceCommands: true,
          dismissOverlays: true,
          bigTargets: true,
          pageOutline: true,
          unpinSticky: true,
          stopAutoAdvance: true,
          focusLocator: true,
          persistentHover: true,
          confirmActions: true,
          skipLinks: true
        }
      },
      dyslexia: {
        name: "Dyslexia",
        description: "Letter spacing 0.12em (WCAG 1.4.12), double line height, focus mode",
        tools: {
          fontScale: 115,
          lineHeight: 2,
          letterSpacing: 0.12,
          focusMode: true,
          highlightLinks: true,
          bionicReading: true,
          readingRuler: true
        }
      },
      adhd: {
        name: "ADHD",
        description: "Reduced distractions, progress indicators, summaries for long content",
        tools: {
          autoSummarize: true,
          focusMode: true,
          hideDistractions: true,
          showProgress: true,
          motionReducer: true,
          dismissOverlays: true,
          bionicReading: true,
          readingRuler: true
        }
      },
      cognitive: {
        name: "Cognitive",
        description: "Simplified text (grade 6-8), summaries, clear progress",
        tools: {
          fontScale: 120,
          lineHeight: 1.8,
          autoSimplify: true,
          autoSummarize: true,
          dismissOverlays: true,
          focusMode: true,
          hideDistractions: true,
          showProgress: true,
          highlightLinks: true,
          defineWords: true,
          stopAutoAdvance: true,
          confirmActions: true,
          rememberSpot: true,
          expandAbbreviations: true
        }
      },
      olderAdult: {
        name: "Older Adult",
        description: "Larger text, spacing, captions for hearing loss, simplified content",
        tools: {
          fontScale: 130,
          lineHeight: 1.7,
          letterSpacing: 0.12,
          largeCursor: true,
          enhanceFocus: true,
          autoSimplify: true,
          autoCaptions: true,
          focusMode: true,
          hideDistractions: true,
          showProgress: true,
          bigTargets: true,
          highlightLinks: true,
          stopAutoAdvance: true,
          rememberSpot: true
        }
      },
      anxiety: {
        name: "Anxiety",
        description: "Calm interface, reduced motion, progress indicators reduce uncertainty",
        tools: {
          focusMode: true,
          hideDistractions: true,
          showProgress: true,
          motionReducer: true,
          lineHeight: 1.8,
          dismissOverlays: true,
          muteSounds: true
        }
      },
      sensory: {
        name: "Sensory Processing",
        description: "Overload prevention: no motion, no progress spinners, fewer distractions",
        tools: {
          motionReducer: true,
          focusMode: true,
          hideDistractions: true,
          showProgress: false,
          dismissOverlays: true,
          muteSounds: true,
          reduceBrightness: true
        }
      },
      photosensitive: {
        name: "Light Sensitive",
        description: "Dark mode and reduced motion (WCAG 2.3.3, migraine/seizure prevention)",
        tools: {
          darkMode: true,
          motionReducer: true,
          reduceBrightness: true,
          flashGuard: true
        }
      }
    },
    defaults: {
      enabled: true,
      autoDescribe: true,
      autoVideoDescribe: false,
      autoSimplify: false,
      autoWcagFix: true,
      autoSummarize: false,
      autoFixLabels: true,
      autoCaptions: false,
      fixContrast: true,
      darkMode: false,
      dyslexiaFont: false,
      largeCursor: false,
      enhanceFocus: false,
      readingGuide: false,
      motionReducer: false,
      dismissOverlays: false,
      bigTargets: false,
      readerMode: false,
      focusMode: false,
      hideDistractions: false,
      showProgress: true,
      keyboardNav: false,
      voiceCommands: false,
      fontScale: 100,
      lineHeight: 1.5,
      letterSpacing: 0,
      contrastMode: "none",
      colorFilter: "none",
      highlightLinks: false,
      pageOutline: false,
      bionicReading: false,
      unpinSticky: false,
      translatePage: false,
      translateTo: "English",
      muteSounds: false,
      defineWords: false,
      stopAutoAdvance: false,
      reduceBrightness: false,
      soundVisualizer: false,
      announceUpdates: false,
      magnifier: false,
      flashGuard: false,
      describeOnDemand: false,
      reflowColumn: false,
      focusLocator: false,
      persistentHover: false,
      readingRuler: false,
      confirmActions: false,
      rememberSpot: false,
      expandAbbreviations: false,
      languageTag: false,
      exploreChart: false,
      spaFocus: false,
      skipLinks: false,
      mathAccessible: false
    }
  };

  // tools/profiles/settings.js
  var profiles = settings_default.profiles;
  var defaults = settings_default.defaults;
  var settings = { ...defaults };
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
      translateText: async (text, targetLang) => {
        if (typeof window.ai4a11y_translateText === "function") {
          return await window.ai4a11y_translateText(text, targetLang);
        }
        return null;
      },
      defineWord: async (word, context) => {
        if (typeof window.ai4a11y_defineWord === "function") {
          return await window.ai4a11y_defineWord(word, context);
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
      extractChartData: async (imageData, context) => {
        if (typeof window.ai4a11y_extractChartData === "function") {
          return await window.ai4a11y_extractChartData(imageData, context);
        }
        return null;
      },
      improveLinkText: async (linkText, href, context) => {
        if (typeof window.ai4a11y_improveLinkText === "function") {
          return await window.ai4a11y_improveLinkText(linkText, href, context);
        }
        return null;
      },
      inferColumnHeader: async (sampleData) => {
        if (typeof window.ai4a11y_inferColumnHeader === "function") {
          return await window.ai4a11y_inferColumnHeader(sampleData);
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
    autoTranscriber: AutoTranscriber,
    dismissOverlays: DismissOverlays,
    bigTargets: BigTargets,
    highlightLinks: LinkHighlighter,
    pageOutline: PageOutline,
    bionicReading: BionicReading,
    unpinSticky: UnpinSticky,
    translatePage: TranslatePage,
    muteSounds: MuteSounds,
    defineWords: DefineWords,
    stopAutoAdvance: StopAutoAdvance,
    reduceBrightness: ReduceBrightness,
    soundVisualizer: SoundVisualizer,
    announceUpdates: LiveRegionAnnouncer,
    magnifier: Magnifier,
    flashGuard: FlashGuard,
    describeOnDemand: DescribeOnDemand,
    reflowColumn: ReflowColumn,
    focusLocator: FocusLocator,
    persistentHover: PersistentHover,
    readingRuler: ReadingRuler,
    confirmActions: ConfirmActions,
    rememberSpot: ReadingSpot,
    expandAbbreviations: AbbreviationExpand,
    languageTag: LanguageTag,
    exploreChart: ExploreAChart,
    spaFocus: SpaFocus,
    skipLinks: SkipLinks,
    mathAccessible: MathA11y,
    showCaptions: ShowCaptions,
    fixLandmarks: FixLandmarks
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
      "autocaptions": "autoTranscriber",
      "showcaptions": "showCaptions",
      "captions": "showCaptions",
      "fixlandmarks": "fixLandmarks",
      "landmarks": "fixLandmarks",
      "dismissoverlays": "dismissOverlays",
      "dismisspopups": "dismissOverlays",
      "bigtargets": "bigTargets",
      "biggertargets": "bigTargets",
      "highlightlinks": "highlightLinks",
      "linkhighlighter": "highlightLinks",
      "pageoutline": "pageOutline",
      "outline": "pageOutline",
      "bionicreading": "bionicReading",
      "bionic": "bionicReading",
      "unpinsticky": "unpinSticky",
      "unpin": "unpinSticky",
      "translatepage": "translatePage",
      "translate": "translatePage",
      "mutesounds": "muteSounds",
      "mute": "muteSounds",
      "definewords": "defineWords",
      "define": "defineWords",
      "stopautoadvance": "stopAutoAdvance",
      "stopauto": "stopAutoAdvance",
      "reducebrightness": "reduceBrightness",
      "dim": "reduceBrightness",
      "soundvisualizer": "soundVisualizer",
      "soundviz": "soundVisualizer",
      "announceupdates": "announceUpdates",
      "liveregion": "announceUpdates",
      "magnifier": "magnifier",
      "lens": "magnifier",
      "flashguard": "flashGuard",
      "flash": "flashGuard",
      "describeondemand": "describeOnDemand",
      "describe": "describeOnDemand",
      "reflowcolumn": "reflowColumn",
      "reflow": "reflowColumn",
      "focuslocator": "focusLocator",
      "focusring": "focusLocator",
      "persistenthover": "persistentHover",
      "hover": "persistentHover",
      "readingruler": "readingRuler",
      "ruler": "readingRuler",
      "confirmactions": "confirmActions",
      "confirm": "confirmActions",
      "rememberspot": "rememberSpot",
      "readingspot": "rememberSpot",
      "expandabbreviations": "expandAbbreviations",
      "abbreviations": "expandAbbreviations",
      "languagetag": "languageTag",
      "langtag": "languageTag",
      "explorechart": "exploreChart",
      "charttable": "exploreChart",
      "chart": "exploreChart",
      "spafocus": "spaFocus",
      "routefocus": "spaFocus",
      "skiplinks": "skipLinks",
      "skipnav": "skipLinks",
      "mathaccessible": "mathAccessible",
      "matha11y": "mathAccessible",
      "math": "mathAccessible"
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
    if (profileTools.fontScale) visualOpts.fontScale = profileTools.fontScale;
    if (profileTools.lineHeight) visualOpts.lineHeight = profileTools.lineHeight;
    if (profileTools.letterSpacing) visualOpts.letterSpacing = profileTools.letterSpacing;
    if (profileTools.largeCursor) visualOpts.largeCursor = true;
    if (profileTools.enhanceFocus) visualOpts.enhanceFocus = true;
    if (profileTools.dyslexiaFont) visualOpts.dyslexiaFont = true;
    if (profileTools.readingGuide) visualOpts.readingGuide = true;
    if (Object.keys(visualOpts).length > 0) {
      VisualAssist.enable(visualOpts);
    }
    if (profileTools.darkMode) DarkMode.enable();
    if (profileTools.motionReducer) MotionReducer.enable();
    if (profileTools.focusMode) FocusMode.enable();
    if (profileTools.readerMode) ReaderMode.enable();
    if (profileTools.dismissOverlays) DismissOverlays.enable();
    if (profileTools.bigTargets) BigTargets.enable();
    if (profileTools.highlightLinks) LinkHighlighter.enable();
    if (profileTools.pageOutline) PageOutline.enable();
    if (profileTools.bionicReading) BionicReading.enable();
    if (profileTools.unpinSticky) UnpinSticky.enable();
    if (profileTools.translatePage) TranslatePage.enable({ targetLang: profileTools.translateTo });
    if (profileTools.muteSounds) MuteSounds.enable();
    if (profileTools.defineWords) DefineWords.enable();
    if (profileTools.stopAutoAdvance) StopAutoAdvance.enable();
    if (profileTools.reduceBrightness) ReduceBrightness.enable();
    if (profileTools.soundVisualizer) SoundVisualizer.enable();
    if (profileTools.announceUpdates) LiveRegionAnnouncer.enable();
    if (profileTools.magnifier) Magnifier.enable();
    if (profileTools.flashGuard) FlashGuard.enable();
    if (profileTools.describeOnDemand) DescribeOnDemand.enable();
    if (profileTools.reflowColumn) ReflowColumn.enable();
    if (profileTools.focusLocator) FocusLocator.enable();
    if (profileTools.persistentHover) PersistentHover.enable();
    if (profileTools.readingRuler) ReadingRuler.enable();
    if (profileTools.confirmActions) ConfirmActions.enable();
    if (profileTools.rememberSpot) ReadingSpot.enable();
    if (profileTools.expandAbbreviations) AbbreviationExpand.enable();
    if (profileTools.languageTag) LanguageTag.enable();
    if (profileTools.exploreChart) ExploreAChart.enable();
    if (profileTools.spaFocus) SpaFocus.enable();
    if (profileTools.skipLinks) SkipLinks.enable();
    if (profileTools.mathAccessible) MathA11y.enable();
    if (profileTools.keyboardNav) KeyboardNavigator.enable();
    if (profileTools.voiceCommands) VoiceCommands.enable();
    const colorMode = [profileTools.colorFilter, profileTools.colorBlindMode].find((v) => v && v !== "none");
    if (colorMode) ColorBlindMode.enable(colorMode);
    if (profileTools.autoCaptions) AutoTranscriber.enable();
    if (profileTools.showCaptions) ShowCaptions.enable();
    if (profileTools.fixLandmarks) FixLandmarks.enable();
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
      autoTranscriber: "Auto-generate captions for media",
      showCaptions: "Switch on the captions media already carries (no AI)",
      fixLandmarks: "Add missing main, banner, and contentinfo landmarks",
      dismissOverlays: "Hide cookie banners, newsletter popups, and blocking modals",
      bigTargets: "Enlarge and space out small clickable controls (WCAG 2.5.8)",
      highlightLinks: "Underline and strengthen links and reveal where each one leads",
      pageOutline: "On-page heading navigator to jump between sections",
      bionicReading: "Bold the start of each word to guide the eye (dyslexia/ADHD aid)",
      unpinSticky: "Un-fix sticky headers/bars so they stop eating the viewport when zoomed",
      translatePage: "Translate the page text into another language (AI)",
      muteSounds: "Mute all audio and video and block autoplay sound",
      defineWords: "Show plain-language definitions of hard words on hover (AI)",
      stopAutoAdvance: "Pause auto-carousels, auto-refresh, and autoplay (WCAG 2.2.2)",
      reduceBrightness: "Dim and desaturate the page for a low-stimulation view",
      soundVisualizer: "Flash a visual indicator when the page plays sound (Deaf/HoH)",
      announceUpdates: "Announce dynamic content changes to screen readers (live region)",
      magnifier: "A lens that magnifies the text under the cursor",
      flashGuard: "Block autoplay and dim video/animation for seizure safety (WCAG 2.3.1)",
      describeOnDemand: "Alt+click or Alt+D to get an AI description of any element",
      reflowColumn: "Force page content into one readable column (WCAG 1.4.10)",
      focusLocator: "Show a strong always-visible indicator of keyboard focus",
      persistentHover: "Keep hover tooltips visible and dismissible (WCAG 1.4.13)",
      readingRuler: "A highlight band that follows your reading line",
      confirmActions: "Ask for confirmation before risky or final actions",
      rememberSpot: "Remember where you were reading and offer to jump back",
      expandAbbreviations: "Expand abbreviations and acronyms to their full form",
      languageTag: "Tag foreign-language text so screen readers pronounce it correctly",
      exploreChart: "Read a chart or graph as a navigable data table",
      spaFocus: "Announce and move focus on single-page-app navigations",
      skipLinks: "Add skip-to-content and skip-to-navigation links",
      mathAccessible: "Give math and equations an accessible name for screen readers"
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
      return results.map((item) => ({
        text: item.element?.textContent?.slice(0, 50),
        selector: getSelector(item.element),
        color: item.color,
        background: item.background,
        ratio: item.ratio?.toFixed(2),
        required: item.required
      }));
    },
    async runFullAudit() {
      const results = await runAxeAnalysis();
      return results;
    }
  };
  var aiFixes = {
    async describeImages() {
      const { noAlt, emptyAlt } = auditors.findMissingAlt();
      const results = [];
      for (const img of [...noAlt, ...emptyAlt]) {
        const el = document.querySelector(img.selector);
        if (el) {
          const alt = await generateImageAlt(el);
          if (alt) {
            results.push({ selector: img.selector, alt });
          }
        }
      }
      return results;
    },
    async simplifyText(selector) {
      const el = selector ? document.querySelector(selector) : document.body;
      if (!el) return null;
      return await simplifyText2(el);
    },
    async summarize(selector) {
      const el = selector ? document.querySelector(selector) : document.body;
      if (!el) return null;
      return await summarizeContent(el);
    },
    async improveLinks() {
      return await improveAmbiguousLinks(findAmbiguousLinks());
    },
    async fixTables() {
      return await fixAllTables();
    },
    async fixAxeViolation(ruleId, selector) {
      const handler = getAxeHandler(ruleId);
      if (!handler) return { error: `No handler for rule: ${ruleId}` };
      const el = document.querySelector(selector);
      if (!el) return { error: `Element not found: ${selector}` };
      const risky = isRiskyFix(ruleId);
      const applied = risky ? await handler(el, getActiveProfileSettings()) : await handler(el);
      if (risky && applied === false) {
        return { skipped: "risky", error: `Risky fix ${ruleId} is off (the active profile does not set wcagRiskyFixes)` };
      }
      return { success: true };
    }
  };
  var nonAiFixes = axeHandlers6;
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
    const results = {
      violations: [],
      fixed: { nonAi: 0, ai: 0 },
      skipped: { needsAi: [], noHandler: [], risky: [] }
    };
    const settings2 = getActiveProfileSettings();
    const violations = await runAxeAnalysis();
    results.violations = violations.map((v) => ({ id: v.id, count: v.nodes?.length || 0 }));
    for (const violation of violations) {
      const ruleId = violation.id;
      const nodes = violation.nodes || [];
      for (const node of nodes) {
        const selector = node.target?.[0];
        if (!selector) continue;
        const el = document.querySelector(selector);
        if (!el || el.dataset.ai4a11yProcessed) continue;
        if (nonAiFixes[ruleId]) {
          try {
            if (nonAiFixes[ruleId](el, settings2) === false) {
              results.skipped.risky.push(ruleId);
            } else {
              results.fixed.nonAi++;
            }
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
    if (settings2.autoSimplify) {
      const complexText = findComplexText();
      results.textProcessing = results.textProcessing || {};
      results.textProcessing.simplify = complexText.map((el) => ({
        selector: getSelector(el),
        textLength: proseText(el).length
      }));
    }
    if (settings2.autoSummarize) {
      const longContent = findLongContent();
      results.textProcessing = results.textProcessing || {};
      results.textProcessing.summarize = longContent.map((el) => ({
        selector: getSelector(el),
        textLength: proseText(el).length
      }));
    }
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
  var COMPLEX_TEXT_MIN_CHARS = 200;
  var COMPLEX_SENTENCE_MIN_WORDS = 15;
  function findComplexText() {
    return Array.from(document.querySelectorAll("p, li, td, div")).filter((el) => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.dataset.ai4a11ySimplified) return false;
      if (el.querySelector("p, div, article, section")) return false;
      if ((el.textContent?.length || 0) <= COMPLEX_TEXT_MIN_CHARS) return false;
      const text = proseText(el);
      return text.length > COMPLEX_TEXT_MIN_CHARS && text.split(/[.!?]/).some((s) => s.trim().split(/\s+/).length > COMPLEX_SENTENCE_MIN_WORDS);
    }).slice(0, 10);
  }
  function findLongContent() {
    return Array.from(document.querySelectorAll("p, article, section, .article-body, .content")).filter((el) => {
      if (el.dataset.ai4a11ySummarized) return false;
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.closest("[data-ai4a11y-summarized]")) return false;
      if ((el.textContent?.length || 0) <= 500) return false;
      const text = proseText(el);
      return text.length > 500;
    }).slice(0, 5);
  }
  function isProfileSettingEnabled(setting) {
    const state = window._ai4a11ySessionState || {};
    const profileName = state.activeProfile;
    if (!profileName) return false;
    const profile = getProfile(profileName);
    if (!profile) return false;
    return !!profile.tools?.[setting];
  }
  function getActiveProfileSettings() {
    const state = window._ai4a11ySessionState || {};
    const profileName = state.activeProfile;
    if (!profileName) return {};
    const profile = getProfile(profileName);
    return profile?.tools || {};
  }
  function getSelector(el) {
    if (!el || !el.tagName) return "unknown";
    const doc = el.ownerDocument || document;
    const esc = (s) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
    const addressesOnlyThis = (sel) => {
      try {
        const found = doc.querySelectorAll(sel);
        return found.length === 1 && found[0] === el;
      } catch {
        return false;
      }
    };
    if (el.id) {
      const byId = `#${esc(el.id)}`;
      if (addressesOnlyThis(byId)) return byId;
    }
    const tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      const classes = el.className.trim().split(/\s+/).filter((c) => c).slice(0, 2).map(esc).join(".");
      if (classes && addressesOnlyThis(`${tag}.${classes}`)) return `${tag}.${classes}`;
    }
    const step = (node) => {
      const name = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) return name;
      const twins = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      return twins.length === 1 ? name : `${name}:nth-of-type(${twins.indexOf(node) + 1})`;
    };
    const parts = [];
    for (let node = el; node && node.tagName; node = node.parentElement) {
      if (node !== el && node.id) {
        const rooted = `#${esc(node.id)} > ${parts.join(" > ")}`;
        if (addressesOnlyThis(rooted)) return rooted;
      }
      parts.unshift(step(node));
      const path = parts.join(" > ");
      if (addressesOnlyThis(path)) return path;
    }
    return parts.join(" > ");
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
      findAmbiguousLinks,
      auditLandmarks,
      runFullAudit: auditors.runFullAudit,
      // AI fixes
      aiFixes,
      describeImages: aiFixes.describeImages,
      simplifyText: aiFixes.simplifyText,
      summarize: aiFixes.summarize,
      improveLinks: aiFixes.improveLinks,
      fixTables: aiFixes.fixTables,
      fixLandmarks,
      fixAxeViolation: aiFixes.fixAxeViolation,
      // Full scan (like extension)
      runFullScan,
      nonAiFixes,
      aiRequiredRules: [...aiRequiredRules],
      // Text processing (cognitive profile)
      findComplexText,
      findLongContent,
      isProfileSettingEnabled,
      getActiveProfileSettings,
      setSessionState: (state) => {
        window._ai4a11ySessionState = state;
      },
      // Axe handlers
      axeHandlers: axeHandlers7,
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
