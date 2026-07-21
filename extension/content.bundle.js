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
  async function describeVideo(frames, metadata = {}) {
    if (!(provider == null ? void 0 : provider.describeVideo)) {
      throw new Error("AI provider not set or missing describeVideo");
    }
    return provider.describeVideo(frames, metadata);
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
  async function improveLinkText(linkText, href, context) {
    if (!(provider == null ? void 0 : provider.improveLinkText)) {
      return null;
    }
    return provider.improveLinkText(linkText, href, context);
  }
  async function inferColumnHeader(sampleData) {
    if (!(provider == null ? void 0 : provider.inferColumnHeader)) {
      return null;
    }
    return provider.inferColumnHeader(sampleData);
  }
  async function translateText(text, targetLang) {
    if (!(provider == null ? void 0 : provider.translateText)) {
      return null;
    }
    return provider.translateText(text, targetLang);
  }
  async function defineWord(word, context) {
    if (!(provider == null ? void 0 : provider.defineWord)) {
      return null;
    }
    return provider.defineWord(word, context);
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
          keyboardNav: true,
          pageOutline: true,
          announceUpdates: true,
          describeOnDemand: true
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
          persistentHover: true
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
          confirmActions: true
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
          rememberSpot: true
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
        name: "Photosensitive",
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
      rememberSpot: false
    }
  };

  // tools/profiles/settings.js
  var profiles = settings_default.profiles;
  var defaults = settings_default.defaults;
  var settings = { ...defaults };
  async function loadSettings(storageGetter) {
    if (storageGetter) {
      const stored = await storageGetter();
      if (stored) {
        settings = { ...defaults, ...stored };
      }
    }
    return settings;
  }
  function getSettings() {
    return settings;
  }
  function updateSettings(newSettings) {
    settings = { ...settings, ...newSettings };
  }
  function isEnabled(feature) {
    return settings[feature] === true;
  }

  // tools/utils/dom.js
  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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
  function clearAllMarks() {
    document.querySelectorAll("[data-ai4a11y-processed]").forEach((el) => {
      delete el.dataset.ai4a11yProcessed;
    });
    document.querySelectorAll("[data-ai4a11y-described]").forEach((el) => {
      delete el.dataset.ai4a11yDescribed;
    });
    document.querySelectorAll("[data-ai4a11y-simplified]").forEach((el) => {
      delete el.dataset.ai4a11ySimplified;
    });
    document.querySelectorAll("[data-ai4a11y-summarize]").forEach((el) => {
      delete el.dataset.ai4a11ySummarize;
    });
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
  function getElementFromNode(node) {
    var _a;
    if (!((_a = node == null ? void 0 : node.target) == null ? void 0 : _a[0])) return null;
    try {
      return document.querySelector(node.target[0]);
    } catch (e) {
      console.warn("[AI4A11y] Invalid selector:", node.target[0]);
      return null;
    }
  }

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
  function captureVideoFrame(video) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    try {
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch (e) {
      console.warn("[AI4A11y] Canvas tainted (CORS), cannot capture frame:", e);
      return null;
    }
  }
  async function captureVideoFrames(video, numFrames = 6) {
    numFrames = Math.min(Math.max(1, Math.floor(numFrames) || 6), 30);
    const frames = [];
    const duration = video.duration || 0;
    if (!duration || duration < 1) {
      frames.push(captureVideoFrame(video));
      return frames;
    }
    const interval = duration / (numFrames + 1);
    const originalTime = video.currentTime;
    try {
      for (let i = 1; i <= numFrames; i++) {
        video.currentTime = interval * i;
        await new Promise((resolve) => {
          video.onseeked = resolve;
          setTimeout(resolve, 500);
        });
        frames.push(captureVideoFrame(video));
      }
    } finally {
      video.currentTime = originalTime;
    }
    return frames;
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

  // tools/auditors/missing-alt.js
  function findEmptyAltImages() {
    return Array.from(document.querySelectorAll('img[alt=""]')).filter((img) => {
      if (wasProcessed(img)) return false;
      if (!isVisible(img)) return false;
      if (isLikelyDecorative(img)) return false;
      const { width, height } = getImageSize(img);
      return width > 100 && height > 100;
    });
  }
  function findCanvasElements() {
    return Array.from(document.querySelectorAll("canvas")).filter((canvas) => {
      if (wasProcessed(canvas)) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });
  }

  // tools/auditors/missing-labels.js
  function findAmbiguousLinks() {
    const ambiguousTexts = [
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
    return Array.from(document.querySelectorAll("a[href]")).filter((link) => {
      var _a;
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;
      const text = (_a = link.textContent) == null ? void 0 : _a.trim().toLowerCase();
      return text && ambiguousTexts.includes(text);
    });
  }

  // tools/adapters/generate-alt.js
  var logFix = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat = globalThis.ai4a11yIncrementStat || (() => {
  });
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
  async function generateCanvasDescription(canvas) {
    if (canvas.dataset.ai4a11yProcessed) return null;
    markProcessed(canvas, "pending");
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const description = await describeImage(dataUrl);
      if (description) {
        canvas.setAttribute("aria-label", description);
        canvas.setAttribute("role", "img");
        markProcessed(canvas, "done");
        incrementStat("images");
        logFix("canvas description", canvas, "(none)", description);
        return description;
      }
      markProcessed(canvas, "failed");
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to describe canvas:", e);
      markProcessed(canvas, "failed");
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
  async function generateVideoDescription(video) {
    if (video.dataset.ai4a11yDescribed) return null;
    video.dataset.ai4a11yDescribed = "pending";
    try {
      const frames = await captureVideoFrames(video, 6);
      const description = await describeVideo(frames);
      if (description) {
        video.setAttribute("aria-label", description);
        video.dataset.ai4a11yDescribed = "done";
        incrementStat("images");
        logFix("video description", video, "(none)", description);
        return description;
      }
      video.dataset.ai4a11yDescribed = "failed";
      return null;
    } catch (e) {
      console.warn("[AI4A11y] Failed to describe video:", e);
      video.dataset.ai4a11yDescribed = "failed";
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
    var _a, _b;
    if (link.dataset.ai4a11yProcessed) return null;
    markProcessed(link, "pending");
    const href = link.href || "";
    const existingText = ((_a = link.textContent) == null ? void 0 : _a.trim()) || "";
    const context = getContextForElement(link);
    let label;
    try {
      label = await inferLabel({
        elementType: "link",
        html: ((_b = link.outerHTML) == null ? void 0 : _b.substring(0, 500)) || "",
        context: [existingText, href, context].filter(Boolean).join(" | ")
      });
    } catch (e) {
      console.warn("[AI4A11y] Link label inference failed:", e.message);
      markProcessed(link, "failed");
      return null;
    }
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
    if (button.dataset.ai4a11yProcessed) return null;
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
    let label;
    try {
      label = await inferLabel({
        elementType: "button",
        html: ((_a = button.outerHTML) == null ? void 0 : _a.substring(0, 500)) || "",
        context
      });
    } catch (e) {
      console.warn("[AI4A11y] Button label inference failed:", e.message);
      markProcessed(button, "failed");
      return null;
    }
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
    if (iframe.dataset.ai4a11yProcessed) return null;
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
    if (input.dataset.ai4a11yProcessed) return null;
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
    if (!parent) return "";
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
      if (text && text.length < 50) return text.replace(/:$/, "");
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
    if (video.dataset.ai4a11yCaptioned) return null;
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
        incrementStat3("captions");
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
    if (audio.dataset.ai4a11yCaptioned) return null;
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
        incrementStat3("captions");
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
    if (element.dataset.ai4a11ySimplified) return null;
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
        toggleBtn.className = "ai4a11y-toggle-original";
        toggleBtn.textContent = "Show original";
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.onclick = () => {
          const showingOriginal = element.dataset.ai4a11yShowOriginal === "true";
          if (showingOriginal) {
            originalWrapper.style.display = "none";
            textContainer.style.display = "";
            toggleBtn.textContent = "Show original";
            toggleBtn.setAttribute("aria-pressed", "false");
            element.dataset.ai4a11yShowOriginal = "false";
          } else {
            textContainer.style.display = "none";
            originalWrapper.style.display = "";
            toggleBtn.textContent = "Show simplified";
            toggleBtn.setAttribute("aria-pressed", "true");
            element.dataset.ai4a11yShowOriginal = "true";
          }
        };
        element.appendChild(originalWrapper);
        element.appendChild(textContainer);
        element.appendChild(toggleBtn);
        element.dataset.ai4a11ySimplified = "done";
        incrementStat4("text");
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
    if (element.dataset.ai4a11ySummarize) return null;
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
        incrementStat4("text");
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
    if (!rgb) return null;
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

  // tools/adapters/fix-contrast.js
  var logFix5 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat5 = globalThis.ai4a11yIncrementStat || (() => {
  });
  async function fixLowContrast(element, color, background) {
    if (element.dataset.ai4a11yProcessed) return null;
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
    if (link.dataset.ai4a11yProcessed) return;
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
    if (!currentLang) return;
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
    if (!parts.includes("noopener")) parts.push("noopener");
    if (!parts.includes("noreferrer")) parts.push("noreferrer");
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
    if (!parent || element === parent) return;
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
    if (rect.width >= 44 && rect.height >= 44) return;
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
    if (meta == null ? void 0 : meta.content) return meta.content.split("-")[0];
    const patterns = {
      "/es/": "es",
      "/fr/": "fr",
      "/de/": "de",
      "/zh/": "zh",
      "/ja/": "ja",
      "/ko/": "ko"
    };
    for (const [pattern, lang] of Object.entries(patterns)) {
      if (location.href.includes(pattern)) return lang;
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

  // tools/adapters/fix-links.js
  var logFix7 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat7 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var MAX_LINKS_PER_PAGE = 10;
  async function improveAmbiguousLink(link) {
    var _a, _b, _c;
    if (link.dataset.ai4a11yProcessed) return null;
    markProcessed(link, "pending");
    const text = ((_a = link.textContent) == null ? void 0 : _a.trim()) || "";
    const context = ((_c = (_b = link.closest("p, li, td, article, section")) == null ? void 0 : _b.textContent) == null ? void 0 : _c.trim().substring(0, 200)) || "";
    try {
      const improved = await improveLinkText(text, link.href, context);
      if (improved && improved.toLowerCase() !== text.toLowerCase()) {
        link.setAttribute("aria-label", improved);
        link.classList.add("ai4a11y-adapted");
        markProcessed(link, "done");
        incrementStat7("labels");
        logFix7("link text", link, text, improved);
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
  var logFix8 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat8 = globalThis.ai4a11yIncrementStat || (() => {
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
    const dataLikeCount = firstRowCells.filter((c) => {
      var _a;
      return isDataLike(((_a = c.textContent) == null ? void 0 : _a.trim()) || "");
    }).length;
    const looksLikeHeader = dataLikeCount <= firstRowCells.length / 2 && firstRowCells.every((cell, i) => {
      var _a;
      const text = ((_a = cell.textContent) == null ? void 0 : _a.trim()) || "";
      if (!text || text.length > 40) return false;
      const below = rows.slice(1, 4).map((r) => {
        var _a2, _b;
        return (_b = (_a2 = r.querySelectorAll("td")[i]) == null ? void 0 : _a2.textContent) == null ? void 0 : _b.trim();
      });
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
      incrementStat8("wcag");
      logFix8("table headers", table, "(no headers)", "first row \u2192 column headers");
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
        const samples = rows.slice(0, 5).map((r) => {
          var _a, _b;
          return (_b = (_a = r.querySelectorAll("td")[col]) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim();
        }).filter(Boolean);
        const header = col < MAX_AI_COLUMNS && samples.length >= 2 ? await inferColumnHeader(samples) : null;
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
      incrementStat8("wcag");
      logFix8("table headers", table, "(no headers)", headers.join(", "));
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

  // tools/adapters/fix-landmarks.js
  var logFix9 = globalThis.ai4a11yLogFix || (() => {
  });
  var incrementStat9 = globalThis.ai4a11yIncrementStat || (() => {
  });
  var LANDMARK_SELECTOR = 'header, footer, nav, aside, main, [role="banner"], [role="contentinfo"], [role="navigation"], [role="complementary"], [role="main"]';
  function ensureMainLandmark() {
    if (document.querySelector('main, [role="main"]')) return false;
    const isCandidate = (el) => {
      var _a;
      const tag = el.tagName.toLowerCase();
      if (["header", "footer", "nav", "aside", "script", "style", "noscript"].includes(tag)) return false;
      if (el.getAttribute("role")) return false;
      if ((((_a = el.textContent) == null ? void 0 : _a.trim().length) || 0) <= 100) return false;
      if (el.querySelector(LANDMARK_SELECTOR)) return false;
      return true;
    };
    let level = Array.from(document.body.children);
    let candidates = level.filter(isCandidate);
    if (candidates.length === 0) {
      const shell = level.find((el) => {
        var _a;
        return (((_a = el.textContent) == null ? void 0 : _a.trim().length) || 0) > 100 && el.querySelector(LANDMARK_SELECTOR);
      });
      if (shell) candidates = Array.from(shell.children).filter(isCandidate);
    }
    if (candidates.length === 0) return false;
    const main = candidates.reduce((a, b) => {
      var _a, _b;
      return (((_a = a.textContent) == null ? void 0 : _a.length) || 0) >= (((_b = b.textContent) == null ? void 0 : _b.length) || 0) ? a : b;
    });
    main.setAttribute("role", "main");
    markProcessed(main, "done");
    incrementStat9("wcag");
    logFix9("landmark", main, "(no main landmark)", 'role="main"');
    console.log('[AI4A11y] Added role="main" landmark');
    return true;
  }
  function ensureStructuralLandmarks() {
    let fixed = 0;
    document.querySelectorAll('div[class*="nav" i]:not([role])').forEach((el) => {
      var _a;
      if (!looksLikeNavClass(el)) return;
      if (el.closest('nav, [role="navigation"]')) return;
      const links = el.querySelectorAll("a").length;
      const textLength = ((_a = el.textContent) == null ? void 0 : _a.trim().length) || 1;
      if (links >= 3 && links * 15 / textLength > 0.5) {
        el.setAttribute("role", "navigation");
        incrementStat9("wcag");
        logFix9("landmark", el, "(unmarked nav)", 'role="navigation"');
        fixed++;
      }
    });
    return fixed;
  }
  function fixLandmarks() {
    let count = 0;
    if (ensureMainLandmark()) count++;
    count += ensureStructuralLandmarks();
    return count;
  }
  var axeHandlers6 = {
    "landmark-one-main": () => ensureMainLandmark()
  };

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
      if (this.enabled) this.disable();
      else this.enable();
    },
    // Reading guide element and handler
    readingGuideEl: null,
    readingGuideHandler: null,
    enableReadingGuide() {
      if (this.readingGuideEl) return;
      this.readingGuideEl = document.createElement("div");
      this.readingGuideEl.className = "ai4a11y-reading-guide";
      document.body.appendChild(this.readingGuideEl);
      this.readingGuideRafPending = false;
      this.lastMouseY = 0;
      this.readingGuideHandler = (e) => {
        this.lastMouseY = e.clientY;
        if (this.readingGuideRafPending) return;
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
      if (document.getElementById(this.styleId)) return;
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
    gifOriginals: null,
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
      this.gifOriginals = /* @__PURE__ */ new Map();
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
      if (s.pauseVideos) this.pauseAllVideos();
      if (s.stopGifs) this.stopGifs();
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
      var _a, _b;
      if (!this.enabled) return;
      this.enabled = false;
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      document.querySelectorAll("[data-ai4a11y-gif-src]").forEach((canvas) => {
        var _a2;
        const original = (_a2 = this.gifOriginals) == null ? void 0 : _a2.get(canvas);
        if (original) {
          canvas.replaceWith(original);
        } else {
          const img = document.createElement("img");
          img.src = canvas.dataset.ai4a11yGifSrc;
          img.setAttribute("alt", canvas.getAttribute("aria-label") || "");
          img.className = canvas.className;
          canvas.replaceWith(img);
        }
      });
      (_b = this.gifOriginals) == null ? void 0 : _b.clear();
      document.querySelectorAll('[style*="animation-play-state"]').forEach((el) => {
        el.style.animationPlayState = "";
      });
      document.querySelectorAll('video[data-ai4a11y-was-playing="true"]').forEach((video) => {
        video.play().catch(() => {
        });
        delete video.dataset.ai4a11yWasPlaying;
      });
      console.log("[AI4A11y] Motion Reducer disabled");
      announce("Motion restored");
    },
    pauseAllVideos() {
      document.querySelectorAll("video").forEach((video) => {
        if (!video.paused) {
          video.pause();
          video.dataset.ai4a11yWasPlaying = "true";
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
        if (img.dataset.ai4a11yGifStopped) return;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 100;
        canvas.height = img.naturalHeight || img.height || 100;
        canvas.className = img.className;
        canvas.setAttribute("aria-label", img.alt || "");
        canvas.setAttribute("role", "img");
        canvas.dataset.ai4a11yGifSrc = img.src;
        const ctx = canvas.getContext("2d");
        const tempImg = new Image();
        tempImg.onload = () => {
          var _a;
          ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
          (_a = this.gifOriginals) == null ? void 0 : _a.set(canvas, img);
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
  if (typeof window !== "undefined") window.__ai4a11yMotionReducer = MotionReducer;

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
      if (typeof speechSynthesis !== "undefined") speechSynthesis.speak(this.utterance);
      console.log("[AI4A11y] Read Aloud started");
      announce("Reading started");
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
      if (this.enabled) return;
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
        if (e.key === "Escape") this.disable();
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
  if (typeof window !== "undefined") window.__ai4a11yReaderMode = ReaderMode;

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
        if (idx < links.length - 1) links[idx + 1].focus();
        else if (links.length > 0) links[0].focus();
      },
      "previous link": () => {
        const links = Array.from(document.querySelectorAll("a[href]"));
        const current = document.activeElement;
        const idx = links.indexOf(current);
        if (idx > 0) links[idx - 1].focus();
        else if (links.length > 0) links[links.length - 1].focus();
      },
      "next button": () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
        const current = document.activeElement;
        const idx = buttons.indexOf(current);
        if (idx < buttons.length - 1) buttons[idx + 1].focus();
        else if (buttons.length > 0) buttons[0].focus();
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
      if (this.enabled) return;
      if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
        announce("Voice recognition not supported in this browser");
        return;
      }
      this.settings = { ...this.settings, ...options };
      this._fatal = false;
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
        if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
          this._fatal = true;
          announce("Voice commands unavailable \u2014 microphone blocked or missing");
        }
      };
      this.recognition.onend = () => {
        if (this.enabled && !this._fatal) {
          try {
            this.recognition.start();
          } catch {
          }
        }
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
      if (this.feedbackElement) return;
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
      if (!this.feedbackElement) return;
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
        if (elText.includes(text.toLowerCase())) return el;
      }
      return null;
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
      if (this.enabled) return;
      this.settings = { ...this.settings, ...options };
      this.enabled = true;
      this.injectStyles();
      if (this.settings.showSkipLinks) this.createSkipLinks();
      if (this.settings.showTabSequence) this.showTabSequence();
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
        if (el.id === "ai4a11y-main-content") el.removeAttribute("id");
        if (el.id === "ai4a11y-nav") el.removeAttribute("id");
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
      if (this.skipLinkElement) return;
      const container = document.createElement("div");
      container.id = "ai4a11y-skip-links";
      const main = document.querySelector('main, [role="main"], #main, #content, article');
      if (main) {
        if (!main.id) main.id = "ai4a11y-main-content";
        if (main.id === "ai4a11y-main-content" && !this.modifiedElements.includes(main)) this.modifiedElements.push(main);
        const skipToMain = document.createElement("a");
        skipToMain.href = "#" + main.id;
        skipToMain.className = "ai4a11y-skip-link";
        skipToMain.textContent = "Skip to main content";
        skipToMain.addEventListener("click", (e) => {
          e.preventDefault();
          main.setAttribute("tabindex", "-1");
          if (!this.modifiedElements.includes(main)) this.modifiedElements.push(main);
          main.focus();
          main.scrollIntoView({ behavior: "smooth" });
        });
        container.appendChild(skipToMain);
      }
      const nav = document.querySelector('nav, [role="navigation"]');
      if (nav) {
        if (!nav.id) nav.id = "ai4a11y-nav";
        if (nav.id === "ai4a11y-nav" && !this.modifiedElements.includes(nav)) this.modifiedElements.push(nav);
        const skipToNav = document.createElement("a");
        skipToNav.href = "#" + nav.id;
        skipToNav.className = "ai4a11y-skip-link";
        skipToNav.textContent = "Skip to navigation";
        skipToNav.style.left = "200px";
        skipToNav.addEventListener("click", (e) => {
          e.preventDefault();
          nav.setAttribute("tabindex", "-1");
          if (!this.modifiedElements.includes(nav)) this.modifiedElements.push(nav);
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
        const focusTracked = (el) => {
          if (!el) return;
          el.setAttribute("tabindex", "-1");
          if (!this.modifiedElements.includes(el)) this.modifiedElements.push(el);
          el.focus();
          return el;
        };
        if (e.altKey && e.key === "1") {
          e.preventDefault();
          focusTracked(document.querySelector('main, [role="main"], #main, #content'));
        }
        if (e.altKey && e.key === "2") {
          e.preventDefault();
          focusTracked(document.querySelector('nav, [role="navigation"]'));
        }
        if (e.altKey && e.key === "h") {
          e.preventDefault();
          const h = focusTracked(document.querySelector("h1, h2, h3"));
          if (h) h.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (e.altKey && e.key === "f") {
          e.preventDefault();
          if (this.tabSequenceOverlay) this.hideTabSequence();
          else this.showTabSequence();
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
  window.__ai4a11yColorBlindMode = ColorBlindMode;

  // tools/adapters/auto-transcriber.js
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
      announce("Auto Transcriber enabled");
    },
    disable() {
      var _a, _b;
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
      (_a = this.observer) == null ? void 0 : _a.disconnect();
      this.observer = null;
      document.querySelectorAll(".ai4a11y-audio-btn, .ai4a11y-caption-box").forEach((el) => el.remove());
      (_b = document.getElementById(this.styleId)) == null ? void 0 : _b.remove();
      document.querySelectorAll("video[data-ai4a11y-setup]").forEach((v) => {
        delete v.dataset.ai4a11ySetup;
      });
      this.videoStates.clear();
      console.log("[AI4A11y] Auto Transcriber disabled");
      announce("Auto Transcriber disabled");
    },
    injectStyles() {
      if (document.getElementById(this.styleId)) return;
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
              if (node.tagName === "VIDEO") this.setupVideo(node);
              if (node.tagName === "IFRAME" && ((_a = node.src) == null ? void 0 : _a.includes("youtube"))) {
                this.enableYouTubeCaptions(node);
              }
              (_c = (_b = node.querySelectorAll) == null ? void 0 : _b.call(node, "video")) == null ? void 0 : _c.forEach((v) => this.setupVideo(v));
            }
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === "VIDEO") this.cleanupVideo(node);
              (_e = (_d = node.querySelectorAll) == null ? void 0 : _d.call(node, "video")) == null ? void 0 : _e.forEach((v) => this.cleanupVideo(v));
            }
          }
        }
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
      this._pagehideHandler = () => this.disable();
      window.addEventListener("pagehide", this._pagehideHandler, { once: true });
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
      if (location.hostname.includes("youtube.com")) this.enableYouTubePageCaptions();
    },
    setupVideo(video) {
      if (video.dataset.ai4a11ySetup) return;
      video.dataset.ai4a11ySetup = "true";
      const rect = video.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 75) return;
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
      if (!state) return;
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
  window.__ai4a11yAutoTranscriber = AutoTranscriber;

  // tools/adapters/dismiss-overlays.js
  var OVERLAY_NAME_RE = /(cookie|consent|gdpr|ccpa|newsletter|subscribe|sign[-_]?up|paywall|interstitial|pop[-_]?up|lightbox|backdrop|promo[-_]?(bar|banner)|notification[-_]?bar)/i;
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
      var _a, _b;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      if (this.hidden) {
        for (const el of this.hidden) (_b = el.classList) == null ? void 0 : _b.remove(this.hiddenClass);
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
  var TARGET_SELECTORS = ["a", "button", "input", '[role="button"]', "[onclick]"];
  var BigTargets = {
    styleId: "ai4a11y-big-targets-styles",
    bodyClass: "ai4a11y-big-targets",
    enabled: false,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const minSize = options.minSize || 44;
      const gap = options.gap || 6;
      const scope = (suffix = "") => TARGET_SELECTORS.map((s) => `body.${this.bodyClass} ${s}${suffix}`).join(",\n");
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
${scope()} {
  min-width: ${minSize}px !important;
  min-height: ${minSize}px !important;
  padding: 8px 12px !important;
  margin: ${gap}px !important;
  box-sizing: border-box !important;
}
/* min-width/height are ignored on inline boxes, and bare links are inline. */
body.${this.bodyClass} a { display: inline-block !important; }
${scope(":focus")} {
  outline: 3px solid #1a73e8 !important;
  outline-offset: 2px !important;
}`;
      (document.head || document.documentElement).appendChild(style);
      try {
        if (document.body) document.body.classList.add(this.bodyClass);
      } catch {
      }
      console.log("[AI4A11y] Bigger Click Targets enabled");
      announce("Click targets enlarged");
    },
    disable() {
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      try {
        (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
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
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yBigTargets = BigTargets;

  // tools/adapters/link-highlighter.js
  var LinkHighlighter = {
    styleId: "ai4a11y-link-highlighter-styles",
    bodyClass: "ai4a11y-highlight-links",
    dataAttr: "data-ai4a11y-linkhl",
    enabled: false,
    titled: null,
    // Set of links WE titled (for exact restore)
    observer: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.titled = /* @__PURE__ */ new Set();
      const color = options && options.color || "#0b57d0";
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
      .${this.bodyClass} a[href] {
        text-decoration: underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 2px !important;
        font-weight: 600 !important;
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
      for (const a of links) if (this.reveal(a)) n++;
      return n;
    },
    // An added node may itself be a link, or contain links.
    consider(node) {
      if (!node || node.nodeType !== 1) return;
      try {
        if (node.matches && node.matches("a[href]")) this.reveal(node);
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
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
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
      console.log("[AI4A11y] Link Highlighter disabled");
      announce("Link highlighting off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yLinkHighlighter = LinkHighlighter;

  // tools/adapters/page-outline.js
  var PageOutline = {
    containerId: "ai4a11y-page-outline",
    enabled: false,
    addedIds: null,
    // Set of headings we gave a generated id (for exact restore)
    addedTabindex: null,
    // Set of headings we gave tabindex="-1" (for exact restore)
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.addedIds = /* @__PURE__ */ new Set();
      this.addedTabindex = /* @__PURE__ */ new Set();
      const selector = options.selector || "h1, h2, h3";
      let headings = [];
      try {
        headings = [...document.querySelectorAll(selector)].filter((h) => h.textContent.trim());
      } catch {
      }
      const nav = document.createElement("nav");
      nav.id = this.containerId;
      nav.setAttribute("role", "navigation");
      nav.setAttribute("aria-label", "Page outline");
      nav.style.cssText = "position: fixed; top: 12px; right: 12px; max-width: 320px; max-height: 70vh; overflow: auto; z-index: 2147483646; background: #fff; color: #111; border: 2px solid #333; border-radius: 8px; padding: 10px 14px; font: 14px/1.6 system-ui, sans-serif;";
      if (headings.length === 0) {
        const note = document.createElement("p");
        note.textContent = "No headings on this page";
        nav.appendChild(note);
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
          const level = Number(heading.tagName[1]) || 1;
          item.style.paddingLeft = `${(level - 1) * 16}px`;
          const link = document.createElement("a");
          link.href = `#${heading.id}`;
          link.textContent = heading.textContent.trim();
          link.addEventListener("click", () => this.jumpTo(heading));
          item.appendChild(link);
          list.appendChild(item);
        }
        nav.appendChild(list);
      }
      try {
        (document.body || document.documentElement).appendChild(nav);
      } catch {
      }
      console.log(`[AI4A11y] Page Outline enabled (${headings.length} headings)`);
      announce(headings.length ? `Page outline ready: ${headings.length} heading${headings.length === 1 ? "" : "s"}` : "Page outline: no headings found");
    },
    // Move both the viewport and keyboard/screen-reader focus to the heading.
    // Headings aren't focusable by default, so add tabindex="-1" — tracked so
    // disable() removes it again.
    jumpTo(heading) {
      var _a;
      try {
        if (!heading.hasAttribute("tabindex")) {
          heading.setAttribute("tabindex", "-1");
          (_a = this.addedTabindex) == null ? void 0 : _a.add(heading);
        }
        if (typeof heading.scrollIntoView === "function") heading.scrollIntoView();
        heading.focus();
      } catch {
      }
    },
    disable() {
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      (_a = document.getElementById(this.containerId)) == null ? void 0 : _a.remove();
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
      var _a;
      try {
        (_a = doc.getElementById(id)) == null ? void 0 : _a.remove();
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
    return doc.querySelector('main, article, [role="main"], .content, #content') || doc.body || null;
  }

  // tools/adapters/bionic-reading.js
  var MAX_TEXT_NODES = 2e3;
  var BionicReading = {
    markerClass: "ai4a11y-bionic",
    enabled: false,
    handle: null,
    // transformTextNodes handle (owns the exact-restore)
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const ratio = typeof options.boldRatio === "number" && options.boldRatio > 0 && options.boldRatio <= 1 ? options.boldRatio : 0.4;
      const root = mainRoot();
      if (!root) {
        announce("Bionic reading: no readable text found");
        return;
      }
      this.handle = transformTextNodes(root, (text) => this.buildSpan(text, ratio), {
        skipClass: this.markerClass,
        cap: MAX_TEXT_NODES
      });
      const count = this.handle.records.length;
      if (this.handle.capped) console.log(`[AI4A11y] Bionic Reading: capped at ${MAX_TEXT_NODES} text nodes`);
      console.log(`[AI4A11y] Bionic Reading enabled (${count} text blocks)`);
      announce(count ? "Bionic reading on" : "Bionic reading: no readable text found");
    },
    // Rebuild one text node's content as a marker <span>, bolding each word's
    // prefix. Whitespace runs are preserved verbatim.
    buildSpan(text, ratio) {
      const span = document.createElement("span");
      span.className = this.markerClass;
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/\s/.test(part)) span.appendChild(document.createTextNode(part));
        else this.boldWord(span, part, ratio);
      }
      return span;
    },
    // One word: <b>prefix</b> + plain text node for the rest.
    boldWord(span, word, ratio) {
      const prefixLen = Math.min(word.length, Math.ceil(word.length * ratio));
      const b = document.createElement("b");
      b.textContent = word.slice(0, prefixLen);
      span.appendChild(b);
      if (prefixLen < word.length) span.appendChild(document.createTextNode(word.slice(prefixLen)));
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
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
      if (el.id === this.styleId) return false;
      if (el.classList && el.classList.contains(this.unpinnedClass)) return false;
      let pos = "";
      try {
        pos = (getComputedStyle(el).position || "").toLowerCase();
      } catch {
        return false;
      }
      if (pos !== "fixed" && pos !== "sticky") return false;
      el.classList.add(this.unpinnedClass);
      this.unpinned.add(el);
      return true;
    },
    disable() {
      var _a, _b;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      if (this.unpinned) {
        for (const el of this.unpinned) (_b = el.classList) == null ? void 0 : _b.remove(this.unpinnedClass);
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

  // tools/adapters/translate-page.js
  var BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, caption, dd, dt, th, td, summary";
  var SKIP_ANCESTOR = 'script, style, code, pre, textarea, [contenteditable="true"]';
  var MAX_BLOCKS = 80;
  var BATCH = 4;
  var TranslatePage = {
    enabled: false,
    translated: null,
    // Set of { el, originalNodes: Node[] }
    targetLang: "English",
    async enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.translated = /* @__PURE__ */ new Set();
      this.targetLang = options.targetLang || options.lang || "English";
      const root = document.querySelector('main, article, [role="main"]') || document.body;
      if (!root) {
        announce("Nothing to translate");
        return;
      }
      let blocks;
      try {
        blocks = [...root.querySelectorAll(BLOCK_SEL)].filter((el) => el.textContent.trim().length > 1 && !el.closest(SKIP_ANCESTOR) && !el.querySelector(BLOCK_SEL));
      } catch {
        blocks = [];
      }
      const targets = blocks.slice(0, MAX_BLOCKS);
      if (blocks.length > targets.length) {
        console.log(`[AI4A11y] Translate: translating ${targets.length} of ${blocks.length} blocks (cost cap)`);
      }
      announce(`Translating to ${this.targetLang}\u2026`);
      let done = 0;
      for (let i = 0; i < targets.length && this.enabled; i += BATCH) {
        await Promise.all(targets.slice(i, i + BATCH).map(async (el) => {
          const original = el.textContent;
          let out;
          try {
            out = await translateText(original, this.targetLang);
          } catch {
            return;
          }
          if (!out || !this.enabled || !el.isConnected) return;
          const originalNodes = [...el.childNodes];
          el.textContent = out;
          this.translated.add({ el, originalNodes });
          done++;
        }));
      }
      console.log(`[AI4A11y] Translate Page: ${done} blocks \u2192 ${this.targetLang}`);
      announce(done ? `Translated ${done} passages to ${this.targetLang}` : "Translation unavailable");
    },
    disable() {
      if (!this.enabled) return;
      this.enabled = false;
      if (this.translated) {
        for (const { el, originalNodes } of this.translated) {
          try {
            if (!el.isConnected) continue;
            el.textContent = "";
            for (const node of originalNodes) el.appendChild(node);
          } catch {
          }
        }
        this.translated.clear();
        this.translated = null;
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
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "INPUT", "A", "BUTTON"]);
  var MAX_WORDS = 500;
  var STYLE_ID = "ai4a11y-define-styles";
  var TOOLTIP_ID = "ai4a11y-define-tooltip";
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
    // Map lowercased word -> definition (null cached too, so a dead provider isn't re-asked)
    showHandler: null,
    hideHandler: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.wrapped = /* @__PURE__ */ new Set();
      this.definitions = /* @__PURE__ */ new Map();
      const minLength = typeof options.minLength === "number" && options.minLength > 0 ? options.minLength : 8;
      let root = null;
      try {
        root = document.querySelector('main, article, [role="main"]') || document.body;
      } catch {
      }
      if (!root) {
        console.log("[AI4A11y] Define Words: no content root found");
        announce("Define words: no readable text found");
        return;
      }
      const textNodes = [];
      try {
        this.collect(root, textNodes);
      } catch {
      }
      let count = 0;
      for (const textNode of textNodes) {
        if (count >= MAX_WORDS) break;
        try {
          const parent = textNode.parentNode;
          if (!parent) continue;
          const built = this.buildWrapper(textNode.nodeValue, minLength, MAX_WORDS - count);
          if (!built) continue;
          parent.replaceChild(built.wrap, textNode);
          this.wrapped.add({ span: built.wrap, originalNode: textNode });
          count += built.wrappedCount;
        } catch {
        }
      }
      if (count >= MAX_WORDS) console.log(`[AI4A11y] Define Words: capped at ${MAX_WORDS} words`);
      this.injectStyles();
      this.showHandler = (e) => this.handleShow(e);
      this.hideHandler = (e) => this.handleHide(e);
      document.addEventListener("mouseover", this.showHandler);
      document.addEventListener("focusin", this.showHandler);
      document.addEventListener("mouseout", this.hideHandler);
      document.addEventListener("focusout", this.hideHandler);
      console.log(`[AI4A11y] Define Words enabled (${count} words)`);
      announce(count ? "Word definitions on: hover or focus an underlined word" : "Define words: no long words found");
    },
    // Depth-first text-node collection under root, skipping SKIP_TAGS subtrees
    // and wrappers we already built.
    collect(el, out) {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          if (/\S/.test(node.nodeValue)) out.push(node);
        } else if (node.nodeType === 1 && !SKIP_TAGS.has(node.tagName) && !(node.classList && node.classList.contains(this.wrapperClass))) {
          this.collect(node, out);
        }
      }
    },
    // Rebuild one text node as a wrapper <span>: qualifying words (alphabetic,
    // long enough, within budget) become interactive spans; everything else —
    // short words, punctuation, whitespace — is re-emitted verbatim as text.
    // Returns null when nothing qualified, so the caller leaves the node alone.
    buildWrapper(text, minLength, budget) {
      const wrap = document.createElement("span");
      wrap.className = this.wrapperClass;
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
      span.setAttribute("tabindex", "0");
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", `Define ${word}`);
      span.textContent = word;
      return span;
    },
    injectStyles() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
        .${this.markerClass} {
          text-decoration: underline dotted;
          text-underline-offset: 2px;
          cursor: help;
        }
        .${this.markerClass}:focus {
          outline: 2px solid #4A90D9;
          outline-offset: 1px;
        }
        #${TOOLTIP_ID} {
          position: absolute;
          z-index: 2147483647;
          max-width: 320px;
          padding: 8px 10px;
          background: #1c1c1e;
          color: #ffffff;
          font: 14px/1.4 system-ui, sans-serif;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          pointer-events: none;
        }`;
        (document.head || document.documentElement).appendChild(style);
      } catch {
      }
    },
    handleShow(event) {
      try {
        const target = event.target;
        const span = target && target.closest ? target.closest(`.${this.markerClass}`) : null;
        if (span) this.showDefinition(span).catch(() => {
        });
      } catch {
      }
    },
    handleHide(event) {
      try {
        const target = event.target;
        if (target && target.closest && target.closest(`.${this.markerClass}`)) this.hideTooltip();
      } catch {
      }
    },
    async showDefinition(span) {
      if (!this.enabled || !this.definitions) return;
      const word = (span.textContent || "").trim();
      if (!word) return;
      const key = word.toLowerCase();
      let def;
      if (this.definitions.has(key)) {
        def = this.definitions.get(key);
      } else {
        let def2;
        try {
          def2 = await defineWord(word, this.sentenceContext(span));
        } catch {
          def2 = null;
        }
        if (!this.enabled || !this.definitions) return;
        this.definitions.set(key, def2 || null);
        def = def2;
      }
      if (!def) return;
      this.showTooltip(span, def);
    },
    // The surrounding sentence(s) for the AI prompt: the enclosing text block's
    // content, whitespace-collapsed and truncated to a bounded prompt size.
    sentenceContext(span) {
      try {
        const block = span.closest(CONTEXT_SEL) || span.parentNode;
        return ((block == null ? void 0 : block.textContent) || "").replace(/\s+/g, " ").trim().slice(0, CONTEXT_CHARS);
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
        const rect = span.getBoundingClientRect();
        tip.style.left = `${Math.max(0, rect.left + (window.scrollX || 0))}px`;
        tip.style.top = `${rect.bottom + (window.scrollY || 0) + 6}px`;
        tip.style.display = "block";
      } catch {
      }
    },
    hideTooltip() {
      try {
        const tip = document.getElementById(TOOLTIP_ID);
        if (tip) tip.style.display = "none";
      } catch {
      }
    },
    disable() {
      var _a, _b, _c;
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
      try {
        (_a = document.getElementById(TOOLTIP_ID)) == null ? void 0 : _a.remove();
      } catch {
      }
      try {
        (_b = document.getElementById(STYLE_ID)) == null ? void 0 : _b.remove();
      } catch {
      }
      if (this.wrapped) {
        for (const { span, originalNode } of this.wrapped) {
          try {
            (_c = span.parentNode) == null ? void 0 : _c.replaceChild(originalNode, span);
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
  var StopAutoAdvance = {
    styleId: "ai4a11y-stop-autoadvance-styles",
    enabled: false,
    removedMetas: null,
    // Array of { node, parent, nextSibling } for exact restore
    pausedMedia: null,
    // Set of media elements we paused (resume exactly these)
    stoppedMarquees: null,
    // Set of <marquee> elements we stopped
    observer: null,
    enable() {
      if (this.enabled) return;
      this.enabled = true;
      this.removedMetas = [];
      this.pausedMedia = /* @__PURE__ */ new Set();
      this.stoppedMarquees = /* @__PURE__ */ new Set();
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
      style.textContent = `${CAROUSEL_SELECTOR}, ${descendants} { animation-play-state: paused !important; }`;
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
        if (typeof el.pause === "function") el.pause();
        this.pausedMedia.add(el);
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
      if (el.querySelectorAll) this.sweep(el);
    },
    disable() {
      var _a, _b, _c;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      try {
        (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
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
            if (typeof el.play === "function") (_c = (_b = el.play()) == null ? void 0 : _b.catch) == null ? void 0 : _c.call(_b, () => {
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
  var ReduceBrightness = {
    styleId: "ai4a11y-reduce-brightness-styles",
    htmlClass: "ai4a11y-dimmed",
    overlayId: "ai4a11y-dim-overlay",
    enabled: false,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const bright = options.brightness ?? 0.8;
      const sat = options.saturation ?? 0.85;
      const dimLevel = options.dim ?? 0.15;
      try {
        document.documentElement.classList.add(this.htmlClass);
      } catch {
      }
      const style = document.createElement("style");
      style.id = this.styleId;
      style.textContent = `
html.${this.htmlClass} { filter: brightness(${bright}) saturate(${sat}) !important; }`;
      (document.head || document.documentElement).appendChild(style);
      const overlay = document.createElement("div");
      overlay.id = this.overlayId;
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = `rgba(0, 0, 0, ${dimLevel})`;
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483646";
      (document.body || document.documentElement).appendChild(overlay);
      console.log("[AI4A11y] Reduce Brightness enabled");
      announce("Screen dimmed");
    },
    disable() {
      var _a, _b, _c;
      if (!this.enabled) return;
      this.enabled = false;
      try {
        (_a = document.documentElement) == null ? void 0 : _a.classList.remove(this.htmlClass);
      } catch {
      }
      try {
        (_b = document.getElementById(this.styleId)) == null ? void 0 : _b.remove();
      } catch {
      }
      try {
        (_c = document.getElementById(this.overlayId)) == null ? void 0 : _c.remove();
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
  var SoundVisualizer = {
    enabled: false,
    indicator: null,
    playHandler: null,
    volumeHandler: null,
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
      indicator.style.cssText = "position: fixed; top: 16px; right: 16px; z-index: 2147483647;padding: 10px 16px; border-radius: 8px;background: rgba(0, 0, 0, 0.85); color: #fff;font: 600 15px/1.2 system-ui, sans-serif;pointer-events: none; display: none;";
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
      document.addEventListener("play", this.playHandler, true);
      document.addEventListener("volumechange", this.volumeHandler, true);
      console.log("[AI4A11y] Sound Visualizer enabled");
      announce("Sound indicator on \u2014 a visual cue will flash when the page plays sound");
    },
    // Show the indicator, restarting the auto-hide window on every new cue.
    flash() {
      if (!this.indicator) return;
      this.indicator.textContent = "\u{1F50A} Sound playing";
      this.indicator.style.display = "block";
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (this.indicator) this.indicator.style.display = "none";
      }, this.flashMs);
    },
    disable() {
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      try {
        if (this.playHandler) document.removeEventListener("play", this.playHandler, true);
        if (this.volumeHandler) document.removeEventListener("volumechange", this.volumeHandler, true);
      } catch {
      }
      this.playHandler = this.volumeHandler = null;
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      (_a = this.indicator) == null ? void 0 : _a.remove();
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
  var REGION_ID = "ai4a11y-live-region";
  var MAX_ANNOUNCE_CHARS = 200;
  var LiveRegionAnnouncer = {
    regionId: REGION_ID,
    enabled: false,
    region: null,
    observer: null,
    debounceMs: 300,
    debounceTimer: null,
    pending: "",
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      this.debounceMs = options.debounceMs ?? 300;
      this.pending = "";
      const region = document.createElement("div");
      region.id = REGION_ID;
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "false");
      region.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      (document.body || document.documentElement).appendChild(region);
      this.region = region;
      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver((mutations) => {
          if (!this.enabled) return;
          this.onMutations(mutations);
        });
        const target = document.querySelector('main, [role="main"]') || document.body;
        if (target) this.observer.observe(target, { childList: true, subtree: true, characterData: false });
      }
      console.log("[AI4A11y] Live-Region Announcer enabled");
      announce("Announcing page updates");
    },
    onMutations(mutations) {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const text = this.summarize(node);
          if (!text) continue;
          if (this.isUrgent(node)) this.speak(text);
          else {
            this.pending = text;
            this.schedule();
          }
        }
      }
    },
    // Short spoken summary of an inserted element, or '' if it isn't worth
    // announcing (our own region, scripts/styles, near-empty nodes).
    summarize(el) {
      if (!el || el.nodeType !== 1) return "";
      if (this.region && (this.region.contains(el) || el.contains && el.contains(this.region))) return "";
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") return "";
      let text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 3) return "";
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
      this.pending = "";
      if (this.region) this.region.textContent = text;
    },
    schedule() {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        if (!this.enabled || !this.region || !this.pending) return;
        this.region.textContent = this.pending;
        this.pending = "";
      }, this.debounceMs);
    },
    disable() {
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.pending = "";
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      try {
        (_a = this.region || document.getElementById(REGION_ID)) == null ? void 0 : _a.remove();
      } catch {
      }
      this.region = null;
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
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) {
          this.hide();
          return;
        }
        lens.textContent = text.length > 180 ? `${text.slice(0, 180)}\u2026` : text;
        lens.style.display = "block";
        this.position(e.clientX, e.clientY);
      } catch {
      }
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
      var _a;
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
      (_a = document.getElementById(this.lensId)) == null ? void 0 : _a.remove();
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
    // Set of { video, hadAutoplay, wasPlaying } for exact restore
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
          wasPlaying: !video.paused
        });
        video.pause();
        video.removeAttribute("autoplay");
        video.autoplay = false;
      } catch (e) {
      }
    },
    disable() {
      var _a;
      if (!this.enabled) return;
      this.enabled = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      if (this.tracked) {
        for (const { video, hadAutoplay, wasPlaying } of this.tracked) {
          try {
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

  // tools/adapters/describe-on-demand.js
  var DescribeOnDemand = {
    styleId: "ai4a11y-describe-styles",
    enabled: false,
    panel: null,
    live: null,
    lastHover: null,
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
    `);
      this.live = document.createElement("div");
      this.live.id = "ai4a11y-describe-live";
      this.live.setAttribute("aria-live", "polite");
      this.live.setAttribute("aria-atomic", "true");
      this.live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;";
      (document.body || document.documentElement).appendChild(this.live);
      this._keyHandler = (e) => {
        if (e.altKey && (e.key === "d" || e.key === "D")) {
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
      this.show("Describing\u2026");
      let desc = null;
      try {
        if (el.tagName === "IMG" && (el.currentSrc || el.src)) {
          desc = await describeImage(el.currentSrc || el.src);
        } else if (el.tagName === "CANVAS" && typeof el.toDataURL === "function") {
          try {
            desc = await describeImage(el.toDataURL());
          } catch {
            desc = null;
          }
        } else {
          const label = el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title")) || "";
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (text.length > 60) desc = await summarizeText(text);
          else desc = label || text || `A ${el.tagName.toLowerCase()} with no readable content.`;
        }
      } catch {
        desc = null;
      }
      this.show(desc || "No description is available for that element.");
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
      if (this.live) this.live.textContent = text;
    },
    hide() {
      if (this.panel) this.panel.style.display = "none";
    },
    disable() {
      var _a, _b, _c;
      if (!this.enabled) return;
      this.enabled = false;
      if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler, true);
      if (this._clickHandler) document.removeEventListener("click", this._clickHandler, true);
      if (this._moveHandler) document.removeEventListener("mouseover", this._moveHandler, true);
      this._keyHandler = this._clickHandler = this._moveHandler = null;
      try {
        (_a = document.getElementById(this.styleId)) == null ? void 0 : _a.remove();
      } catch {
      }
      (_b = this.panel) == null ? void 0 : _b.remove();
      this.panel = null;
      (_c = this.live) == null ? void 0 : _c.remove();
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
    enabled: false,
    style: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const width = options.width || 720;
      const scope = `html.${this.rootClass}`;
      this.style = injectStyle(this.styleId, `
${scope} body {
  max-width: ${width}px !important;
  margin: 0 auto !important;
}
/* Floats and CSS multi-column are what put content side by side. */
${scope} * {
  float: none !important;
  column-count: 1 !important;
}
/* Linearize the common layout containers so rows stack into one column. */
${scope} [style*="display: flex"],
${scope} [style*="display:flex"],
${scope} [style*="display: grid"],
${scope} [style*="display:grid"],
${scope} main,
${scope} section,
${scope} article {
  display: block !important;
  max-width: 100% !important;
}
/* Media and tables must shrink to the column, never widen it. */
${scope} img,
${scope} video,
${scope} table {
  max-width: 100% !important;
  height: auto !important;
}`);
      try {
        document.documentElement.classList.add(this.rootClass);
      } catch {
      }
      console.log("[AI4A11y] Reflow enabled");
      announce("Page reflowed into a single column");
    },
    disable() {
      var _a, _b;
      if (!this.enabled) return;
      this.enabled = false;
      try {
        document.documentElement.classList.remove(this.rootClass);
      } catch {
      }
      try {
        (_a = this.style) == null ? void 0 : _a.remove();
      } catch {
      }
      try {
        (_b = document.getElementById(this.styleId)) == null ? void 0 : _b.remove();
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
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const color = options && options.color || "#ffbf00";
      this.styleHandle = injectStyle(this.styleId, `
      *:focus, *:focus-visible {
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
        const el = event.target;
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
      this.scrollHandler = () => this.position();
      this.resizeHandler = () => this.position();
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
        this.ring.style.top = `${rect.top}px`;
        this.ring.style.left = `${rect.left}px`;
        this.ring.style.width = `${rect.width}px`;
        this.ring.style.height = `${rect.height}px`;
        this.ring.style.display = "block";
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
    onMouseOver: null,
    // stored listener refs (for exact removal)
    onKeyDown: null,
    enable(options = {}) {
      if (this.enabled) return;
      this.enabled = true;
      const background = options && options.background || "#1c1c1e";
      const color = options && options.color || "#ffffff";
      this.style = injectStyle(this.styleId, `
      #${this.tipId} {
        position: absolute;
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
        const el = target.closest ? target.closest("[title]") : null;
        if (!el) return;
        const text = (el.getAttribute("title") || "").trim();
        if (!text || el === this.current) return;
        this.show(el, text);
      };
      document.addEventListener("mouseover", this.onMouseOver, true);
      this.onKeyDown = (e) => {
        if (!this.enabled) return;
        if (e.key === "Escape") this.hide();
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
      const x = (rect ? rect.left : 0) + (window.scrollX || 0);
      const y = (rect ? rect.bottom : 0) + (window.scrollY || 0) + 6;
      this.tip.style.left = `${Math.max(0, x)}px`;
      this.tip.style.top = `${Math.max(0, y)}px`;
      this.tip.hidden = false;
    },
    hide() {
      if (this.tip) this.tip.hidden = true;
      this.current = null;
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
      var _a, _b, _c;
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
      (_a = this.band) == null ? void 0 : _a.remove();
      this.band = null;
      (_b = this.shadeTop) == null ? void 0 : _b.remove();
      this.shadeTop = null;
      (_c = this.shadeBottom) == null ? void 0 : _c.remove();
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
  var DESTRUCTIVE_RE = /\b(delete|remove|submit|buy|pay|confirm|send|publish|unsubscribe|deactivate|close account)\b/i;
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
        this.clearArmed();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      this.clearArmed();
      el.setAttribute(this.armedAttr, "true");
      this.armed.add(el);
      this.showPrompt(el);
      this.promptTimer = setTimeout(() => this.clearArmed(), this.windowMs);
    },
    looksDestructive(el) {
      const name = (el.getAttribute && el.getAttribute("aria-label") || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!name || name.length > 40) return false;
      return DESTRUCTIVE_RE.test(name);
    },
    showPrompt(el) {
      const prompt = document.createElement("span");
      prompt.id = this.promptId;
      prompt.setAttribute("role", "status");
      prompt.textContent = "Click again to confirm";
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
      var _a;
      if (this.promptTimer) {
        clearTimeout(this.promptTimer);
        this.promptTimer = null;
      }
      if (this.prompt) {
        this.prompt.remove();
        this.prompt = null;
      }
      if (this.armed) {
        for (const el of this.armed) (_a = el.removeAttribute) == null ? void 0 : _a.call(el, this.armedAttr);
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
          window.scrollTo(0, savedY);
          this.restorePending = false;
          btn.remove();
        });
        (document.body || document.documentElement).appendChild(btn);
      }
      this.scrollHandler = () => {
        if (!this.enabled) return;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null;
          if (!this.enabled) return;
          const y = window.scrollY;
          if (this.restorePending && this.savedY != null && y <= this.savedY) return;
          this.restorePending = false;
          this.saveSpot(y);
        }, SAVE_DELAY_MS);
      };
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
      console.log("[AI4A11y] Save Reading Spot enabled");
      announce(savedY !== null && savedY > 0 ? "Found your last reading spot \u2014 a jump-back button was added" : "Saving your reading spot as you scroll");
    },
    disable() {
      var _a;
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
      (_a = document.getElementById(this.buttonId)) == null ? void 0 : _a.remove();
      console.log("[AI4A11y] Save Reading Spot disabled");
      announce("Reading spot saving turned off");
    },
    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }
  };
  if (typeof window !== "undefined") window.__ai4a11yReadingSpot = ReadingSpot;

  // tools/adapters/index.js
  var axeHandlers7 = {
    ...axeHandlers,
    ...axeHandlers2,
    ...axeHandlers3,
    ...axeHandlers4,
    ...axeHandlers5,
    ...axeHandlers6
  };
  function getAxeHandler(ruleId) {
    return axeHandlers7[ruleId] || null;
  }

  // extension/src/stats.js
  var MAX_LOG_SIZE = 500;
  var stats = {
    wcag: 0,
    images: 0,
    labels: 0,
    text: 0,
    captions: 0
  };
  var fixLog = [];
  function logFix10(type, element, oldValue, newValue) {
    var _a;
    const selector = ((_a = element == null ? void 0 : element.tagName) == null ? void 0 : _a.toLowerCase()) || "element";
    const id = (element == null ? void 0 : element.id) ? `#${element.id}` : "";
    const cls = (element == null ? void 0 : element.className) && typeof element.className === "string" ? "." + element.className.split(" ")[0] : "";
    fixLog.push({
      type,
      element: selector + id + cls,
      old: oldValue || "(empty)",
      new: newValue || "",
      timestamp: Date.now()
    });
    if (fixLog.length > MAX_LOG_SIZE) {
      fixLog.splice(0, fixLog.length - MAX_LOG_SIZE);
    }
    try {
      chrome.runtime.sendMessage({ type: "fixAdded", stats, fixes: fixLog });
    } catch (e) {
    }
  }
  function incrementStat10(type) {
    if (type in stats) {
      stats[type]++;
    }
  }
  function getStats() {
    return { ...stats };
  }
  function getFixLog() {
    return [...fixLog];
  }
  function resetStats() {
    stats.wcag = 0;
    stats.images = 0;
    stats.labels = 0;
    stats.text = 0;
    stats.captions = 0;
    fixLog.length = 0;
  }

  // extension/src/utils/messaging.js
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[AI4A11y] sendMessage error:", chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }
  function notifyProgress(phase, progress = 0) {
    try {
      const result = chrome.runtime.sendMessage({
        type: "scanProgress",
        phase,
        progress
      });
      if (result && typeof result.catch === "function") {
        result.catch(() => {
        });
      }
    } catch (e) {
    }
  }
  function announce2(text, priority = "polite") {
    let announcer = document.getElementById("ai4a11y-announcer");
    if (!announcer) {
      announcer = document.createElement("div");
      announcer.id = "ai4a11y-announcer";
      announcer.setAttribute("role", "status");
      announcer.setAttribute("aria-live", priority);
      announcer.setAttribute("aria-atomic", "true");
      announcer.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(announcer);
    }
    announcer.textContent = "";
    setTimeout(() => {
      announcer.textContent = text;
    }, 100);
  }

  // extension/src/content.js
  setAIProvider({
    describeImage: (imageData) => sendMessage({ type: "describeImage", imageData }).then((r) => r == null ? void 0 : r.result),
    describeVideo: (frames, metadata) => sendMessage({ type: "describeVideoFrames", frames, metadata }).then((r) => r == null ? void 0 : r.result),
    simplifyText: (text) => sendMessage({ type: "simplifyText", text }).then((r) => r == null ? void 0 : r.result),
    summarizeText: (text) => sendMessage({ type: "summarizeText", text }).then((r) => r == null ? void 0 : r.result),
    translateText: (text, targetLang) => sendMessage({ type: "translateText", text, targetLang }).then((r) => r == null ? void 0 : r.result),
    defineWord: (word, context) => sendMessage({ type: "defineWord", word, context }).then((r) => r == null ? void 0 : r.result),
    generateLabels: (ctx) => sendMessage({ type: "inferLabel", ...ctx }).then((r) => r == null ? void 0 : r.result),
    inferLabel: (ctx) => sendMessage({ type: "inferLabel", ...ctx }).then((r) => r == null ? void 0 : r.result),
    fixContrast: (fg, bg) => sendMessage({ type: "fixContrast", foreground: fg, background: bg }).then((r) => r == null ? void 0 : r.result),
    getYouTubeTranscript: (videoId) => sendMessage({ type: "getYouTubeTranscript", videoId }).then((r) => r == null ? void 0 : r.result),
    transcribeVideo: (url) => sendMessage({ type: "transcribeVideo", audioUrl: url }).then((r) => r == null ? void 0 : r.result),
    transcribeAudio: (url) => sendMessage({ type: "transcribeAudio", audioUrl: url }).then((r) => r == null ? void 0 : r.result),
    describeElement: (imageData, elementType, context) => sendMessage({ type: "describeElement", imageData, elementType, context }).then((r) => r == null ? void 0 : r.result),
    improveLinkText: (linkText, href, context) => sendMessage({ type: "improveLinkText", linkText, href, context }).then((r) => r == null ? void 0 : r.result),
    inferColumnHeader: (sampleData) => sendMessage({ type: "inferColumnHeader", sampleData }).then((r) => r == null ? void 0 : r.result),
    announce: (msg) => announce2(msg)
  });
  globalThis.ai4a11yLogFix = logFix10;
  globalThis.ai4a11yIncrementStat = incrementStat10;
  var isRunning = false;
  var initPromise = null;
  var getHandler = getAxeHandler;
  function applyVisualSettings(settings2) {
    const visualOptions = {};
    if (settings2.contrastMode !== void 0) visualOptions.contrastMode = settings2.contrastMode || "none";
    if (settings2.fontScale !== void 0) visualOptions.fontScale = settings2.fontScale;
    if (settings2.lineHeight !== void 0) visualOptions.lineHeight = settings2.lineHeight;
    if (settings2.letterSpacing !== void 0) visualOptions.letterSpacing = settings2.letterSpacing;
    if (settings2.largeCursor) visualOptions.largeCursor = true;
    if (settings2.enhanceFocus) visualOptions.enhanceFocus = true;
    if (settings2.dyslexiaFont) visualOptions.dyslexiaFont = true;
    if (settings2.readingGuide) visualOptions.readingGuide = true;
    const hasNonDefault = visualOptions.contrastMode && visualOptions.contrastMode !== "none" || visualOptions.fontScale && visualOptions.fontScale !== 100 || visualOptions.lineHeight && visualOptions.lineHeight !== 1.5 || visualOptions.letterSpacing && visualOptions.letterSpacing !== 0 || visualOptions.largeCursor || visualOptions.enhanceFocus || visualOptions.dyslexiaFont || visualOptions.readingGuide;
    if (hasNonDefault) {
      VisualAssist.enable(visualOptions);
      console.log("[AI4A11y] Applied visual settings:", visualOptions);
    }
    const colorMode = settings2.colorFilter || settings2.colorBlindMode;
    if (colorMode && colorMode !== "none") {
      ColorBlindMode.enable(colorMode);
      console.log("[AI4A11y] Applied color blind mode:", colorMode);
    }
    if (settings2.darkMode) {
      DarkMode.enable();
      console.log("[AI4A11y] Dark mode enabled");
    }
    if (settings2.motionReducer) {
      MotionReducer.enable();
      console.log("[AI4A11y] Motion reducer enabled");
    }
    if (settings2.focusMode) {
      FocusMode.enable({
        hideDistractions: settings2.hideDistractions,
        showProgress: settings2.showProgress
      });
      console.log("[AI4A11y] Focus mode enabled");
    }
    if (settings2.readerMode) ReaderMode.enable();
    if (settings2.dismissOverlays) DismissOverlays.enable();
    if (settings2.bigTargets) BigTargets.enable();
    if (settings2.highlightLinks) LinkHighlighter.enable();
    if (settings2.pageOutline) PageOutline.enable();
    if (settings2.bionicReading) BionicReading.enable();
    if (settings2.unpinSticky) UnpinSticky.enable();
    if (settings2.translatePage) TranslatePage.enable({ targetLang: settings2.translateTo });
    if (settings2.muteSounds) MuteSounds.enable();
    if (settings2.defineWords) DefineWords.enable();
    if (settings2.stopAutoAdvance) StopAutoAdvance.enable();
    if (settings2.reduceBrightness) ReduceBrightness.enable();
    if (settings2.soundVisualizer) SoundVisualizer.enable();
    if (settings2.announceUpdates) LiveRegionAnnouncer.enable();
    if (settings2.magnifier) Magnifier.enable();
    if (settings2.flashGuard) FlashGuard.enable();
    if (settings2.describeOnDemand) DescribeOnDemand.enable();
    if (settings2.reflowColumn) ReflowColumn.enable();
    if (settings2.focusLocator) FocusLocator.enable();
    if (settings2.persistentHover) PersistentHover.enable();
    if (settings2.readingRuler) ReadingRuler.enable();
    if (settings2.confirmActions) ConfirmActions.enable();
    if (settings2.rememberSpot) ReadingSpot.enable();
    if (settings2.keyboardNav) KeyboardNavigator.enable();
    if (settings2.voiceCommands) VoiceCommands.enable();
    if (settings2.autoCaptions) {
      AutoTranscriber.enable();
      console.log("[AI4A11y] Auto transcriber enabled");
    }
  }
  async function init() {
    if (initPromise) {
      console.log("[AI4A11y] Init already in progress");
      return initPromise;
    }
    if (isRunning) {
      console.log("[AI4A11y] Scan already running");
      return;
    }
    initPromise = doInit();
    return initPromise;
  }
  async function doInit() {
    const settings2 = await loadSettings(async () => {
      const response = await sendMessage({ type: "getSettings" });
      return response == null ? void 0 : response.result;
    });
    if (!settings2.enabled) {
      console.log("[AI4A11y] Extension disabled");
      initPromise = null;
      return;
    }
    applyVisualSettings(settings2);
    if (isRunning) {
      console.log("[AI4A11y] Scan already in progress");
      initPromise = null;
      return;
    }
    isRunning = true;
    initPromise = null;
    try {
      console.log("[AI4A11y] Starting scan...");
      notifyProgress("Analyzing", 10);
      if (isEnabled("autoWcagFix")) {
        const violations = await runAxeAnalysis();
        notifyProgress("Fixing", 30);
        await processViolations(violations);
      } else {
        console.log("[AI4A11y] Auto WCAG fix disabled \u2014 skipping axe scan");
      }
      notifyProgress("Images", 50);
      await runAdditionalScans();
      notifyProgress("Text", 80);
      await runTextProcessing();
      console.log("[AI4A11y] Done");
      notifyProgress("Done", 100);
    } finally {
      isRunning = false;
    }
  }
  async function processViolations(violations) {
    const settings2 = getSettings();
    const imageTasks = [];
    for (const violation of violations) {
      console.log(`[AI4A11y] Processing: ${violation.id} (${violation.nodes.length} elements)`);
      for (const node of violation.nodes) {
        const el = getElementFromNode(node);
        if (!el || el.dataset.ai4a11yProcessed) continue;
        if (isImageViolation(violation.id) && isEnabled("autoDescribe")) {
          const handler = getHandler(violation.id);
          if (handler) imageTasks.push(() => handler(el));
          continue;
        }
        try {
          await processViolation(violation, node, el, settings2);
        } catch (e) {
          console.warn(`[AI4A11y] Failed to fix ${violation.id}:`, e);
        }
      }
    }
    if (imageTasks.length > 0) {
      console.log(`[AI4A11y] Processing ${imageTasks.length} images...`);
      const BATCH_SIZE = 5;
      for (let i = 0; i < imageTasks.length; i += BATCH_SIZE) {
        const batch = imageTasks.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((fn) => fn().catch((e) => console.warn("[AI4A11y] Image task failed:", e))));
      }
    }
  }
  function isImageViolation(ruleId) {
    return ["image-alt", "input-image-alt", "role-img-alt", "svg-img-alt", "object-alt", "area-alt"].includes(ruleId);
  }
  async function processViolation(violation, node, el, settings2) {
    const handler = getHandler(violation.id);
    if (!handler) return;
    if (violation.id.startsWith("color-contrast") && !isEnabled("fixContrast")) return;
    if (violation.id.includes("label") && !isEnabled("autoFixLabels")) return;
    if (violation.id.includes("caption") && !isEnabled("autoCaptions")) return;
    if (violation.id.startsWith("color-contrast")) {
      const style = getComputedStyle(el);
      await handler(el, style.color, style.backgroundColor);
    } else {
      await handler(el);
    }
  }
  async function runAdditionalScans() {
    if (isEnabled("autoDescribe")) {
      const emptyAltImages = findEmptyAltImages();
      if (emptyAltImages.length > 0) {
        console.log(`[AI4A11y] Found ${emptyAltImages.length} empty-alt images`);
        for (const img of emptyAltImages) await generateImageAlt(img);
      }
      const canvases = findCanvasElements();
      if (canvases.length > 0) {
        console.log(`[AI4A11y] Found ${canvases.length} canvas elements`);
        for (const canvas of canvases) await generateCanvasDescription(canvas);
      }
    }
    if (isEnabled("autoVideoDescribe")) {
      const videos = Array.from(document.querySelectorAll("video")).filter((v) => !v.dataset.ai4a11yProcessed && !v.getAttribute("aria-label"));
      if (videos.length > 0) {
        console.log(`[AI4A11y] Describing ${videos.length} videos`);
        for (const video of videos) {
          await generateVideoDescription(video).catch((e) => console.warn("[AI4A11y] Video description failed:", e));
        }
      }
    }
    if (isEnabled("autoFixLabels")) {
      const ambiguousLinks = findAmbiguousLinks();
      if (ambiguousLinks.length > 0) {
        console.log(`[AI4A11y] Improving ${ambiguousLinks.length} ambiguous links`);
        await improveAmbiguousLinks(ambiguousLinks);
      }
      await fixAllTables();
    }
    if (isEnabled("autoWcagFix")) {
      fixLandmarks();
    }
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      if ((link.getAttribute("rel") || "").includes("noopener")) return;
      fixTargetBlank(link);
    });
    document.querySelectorAll("[tabindex]").forEach((el) => {
      if (parseInt(el.getAttribute("tabindex")) > 0) fixPositiveTabindex(el);
    });
  }
  async function runTextProcessing() {
    if (isEnabled("autoSimplify")) {
      const complexText = findComplexText();
      if (complexText.length > 0) {
        console.log(`[AI4A11y] Simplifying ${complexText.length} text blocks`);
        for (const el of complexText) await simplifyText2(el);
      }
    }
    if (isEnabled("autoSummarize")) {
      const longBlocks = findLongContent();
      if (longBlocks.length > 0) {
        console.log(`[AI4A11y] Summarizing ${longBlocks.length} long blocks`);
        for (const el of longBlocks) await summarizeContent(el);
      }
    }
  }
  function findComplexText() {
    return Array.from(document.querySelectorAll("p, li, td, div")).filter((el) => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.querySelector("p, div, article, section")) return false;
      return el.textContent.length > 300;
    });
  }
  function findLongContent() {
    return Array.from(document.querySelectorAll("p, article, section, .article-body")).filter((el) => {
      var _a;
      if (el.dataset.ai4a11ySummarize) return false;
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.closest("[data-ai4a11y-summarize]")) return false;
      return ((_a = el.textContent) == null ? void 0 : _a.trim().length) > 500;
    });
  }
  function revertAll() {
    VisualAssist.disable();
    MotionReducer.disable();
    ColorBlindMode.disable();
    FocusMode.disable();
    ReadAloud.stop();
    DarkMode.disable();
    ReaderMode.disable();
    VoiceCommands.disable();
    KeyboardNavigator.disable();
    AutoTranscriber.disable();
    DismissOverlays.disable();
    BigTargets.disable();
    LinkHighlighter.disable();
    PageOutline.disable();
    BionicReading.disable();
    UnpinSticky.disable();
    TranslatePage.disable();
    MuteSounds.disable();
    DefineWords.disable();
    StopAutoAdvance.disable();
    ReduceBrightness.disable();
    SoundVisualizer.disable();
    LiveRegionAnnouncer.disable();
    Magnifier.disable();
    FlashGuard.disable();
    DescribeOnDemand.disable();
    ReflowColumn.disable();
    FocusLocator.disable();
    PersistentHover.disable();
    ReadingRuler.disable();
    ConfirmActions.disable();
    ReadingSpot.disable();
    document.querySelectorAll(".ai4a11y-simplified").forEach((el) => {
      var _a, _b;
      const originalWrapper = el.querySelector(".ai4a11y-original-content");
      if (originalWrapper) {
        (_a = el.querySelector(".ai4a11y-text-content")) == null ? void 0 : _a.remove();
        (_b = el.querySelector(".ai4a11y-toggle-original")) == null ? void 0 : _b.remove();
        while (originalWrapper.firstChild) {
          el.appendChild(originalWrapper.firstChild);
        }
        originalWrapper.remove();
      }
      delete el.dataset.ai4a11yOriginal;
      delete el.dataset.ai4a11ySimplified;
      delete el.dataset.ai4a11yShowOriginal;
      el.classList.remove("ai4a11y-simplified");
    });
    document.querySelectorAll("a.ai4a11y-adapted").forEach((link) => {
      link.removeAttribute("aria-label");
      link.classList.remove("ai4a11y-adapted");
    });
    document.querySelectorAll(".ai4a11y-contrast-fixed").forEach((el) => {
      if (el.dataset.ai4a11yOriginalColor) {
        el.style.color = el.dataset.ai4a11yOriginalColor;
        el.classList.remove("ai4a11y-contrast-fixed");
      }
    });
    announce2("Reverted all AI adaptations");
  }
  function rescan() {
    clearAllMarks();
    resetStats();
    isRunning = false;
    init();
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "getStats") {
      sendResponse({ success: true, stats: getStats(), fixes: getFixLog() });
      return true;
    }
    if (msg.type === "rescan") {
      rescan();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "setEnabled") {
      updateSettings({ enabled: msg.enabled });
      if (!msg.enabled) revertAll();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "settingsChanged") {
      loadSettings(async () => {
        const r = await sendMessage({ type: "getSettings" });
        return r == null ? void 0 : r.result;
      }).then(() => {
        if (msg.rescan) rescan();
      });
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "enableTool") {
      handleEnableTool(msg.tool, msg.options);
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "disableTool") {
      handleDisableTool(msg.tool);
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "speakPage") {
      ReadAloud.speakPage({ rate: msg.rate || 1 });
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "stopSpeech") {
      ReadAloud.stop();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "pauseSpeech") {
      ReadAloud.pause();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "resumeSpeech") {
      ReadAloud.resume();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "toggleSpeech") {
      ReadAloud.toggle();
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === "getSpeechState") {
      sendResponse({ success: true, speaking: ReadAloud.speaking || false, paused: ReadAloud.paused || false });
      return true;
    }
    if (msg.type === "getToolStates") {
      sendResponse({
        success: true,
        states: {
          VisualAssist: VisualAssist.enabled || false,
          MotionReducer: MotionReducer.enabled || false,
          ColorBlindMode: ColorBlindMode.enabled || false,
          FocusMode: FocusMode.enabled || false,
          ReadAloud: ReadAloud.speaking || false,
          DarkMode: DarkMode.enabled || false,
          ReaderMode: ReaderMode.enabled || false,
          VoiceCommands: VoiceCommands.enabled || false,
          KeyboardNavigator: KeyboardNavigator.enabled || false,
          AutoTranscriber: AutoTranscriber.enabled || false,
          DismissOverlays: DismissOverlays.enabled || false,
          BigTargets: BigTargets.enabled || false,
          LinkHighlighter: LinkHighlighter.enabled || false,
          PageOutline: PageOutline.enabled || false,
          BionicReading: BionicReading.enabled || false,
          UnpinSticky: UnpinSticky.enabled || false,
          TranslatePage: TranslatePage.enabled || false,
          MuteSounds: MuteSounds.enabled || false,
          DefineWords: DefineWords.enabled || false,
          StopAutoAdvance: StopAutoAdvance.enabled || false,
          ReduceBrightness: ReduceBrightness.enabled || false,
          SoundVisualizer: SoundVisualizer.enabled || false,
          LiveRegionAnnouncer: LiveRegionAnnouncer.enabled || false,
          Magnifier: Magnifier.enabled || false,
          FlashGuard: FlashGuard.enabled || false,
          DescribeOnDemand: DescribeOnDemand.enabled || false,
          ReflowColumn: ReflowColumn.enabled || false,
          FocusLocator: FocusLocator.enabled || false,
          PersistentHover: PersistentHover.enabled || false,
          ReadingRuler: ReadingRuler.enabled || false,
          ConfirmActions: ConfirmActions.enabled || false,
          ReadingSpot: ReadingSpot.enabled || false
        }
      });
      return true;
    }
    if (msg.type === "revertAll") {
      revertAll();
      sendResponse({ success: true });
      return true;
    }
  });
  function handleEnableTool(tool, options = {}) {
    switch (tool) {
      case "darkMode":
      case "DarkMode":
        DarkMode.enable();
        break;
      case "motionReducer":
      case "MotionReducer":
        MotionReducer.enable();
        break;
      case "colorFilter":
      case "ColorBlindMode":
        ColorBlindMode.enable(typeof options === "string" ? options : options.mode);
        break;
      case "visualAssist":
      case "VisualAssist":
        VisualAssist.enable(options);
        break;
      case "largeCursor":
        VisualAssist.enable({ largeCursor: true });
        break;
      case "enhanceFocus":
        VisualAssist.enable({ enhanceFocus: true });
        break;
      case "dyslexiaFont":
        VisualAssist.enable({ dyslexiaFont: true });
        break;
      case "readingGuide":
        VisualAssist.enable({ readingGuide: true });
        break;
      case "focusMode":
      case "FocusMode":
        FocusMode.enable(options);
        break;
      case "readerMode":
      case "ReaderMode":
        ReaderMode.enable(options);
        break;
      case "keyboardNav":
      case "KeyboardNavigator":
        KeyboardNavigator.enable(options);
        break;
      case "voiceCommands":
      case "VoiceCommands":
        VoiceCommands.enable(options);
        break;
      case "autoCaptions":
      case "AutoTranscriber":
        AutoTranscriber.enable();
        break;
      default:
        console.log("[AI4A11y] Unknown tool:", tool);
    }
  }
  function handleDisableTool(tool) {
    switch (tool) {
      case "darkMode":
      case "DarkMode":
        DarkMode.disable();
        break;
      case "motionReducer":
      case "MotionReducer":
        MotionReducer.disable();
        break;
      case "colorFilter":
      case "ColorBlindMode":
        ColorBlindMode.disable();
        break;
      case "visualAssist":
      case "VisualAssist":
        VisualAssist.disable();
        break;
      case "largeCursor":
        VisualAssist.enable({ ...VisualAssist.settings, largeCursor: false });
        break;
      case "enhanceFocus":
        VisualAssist.enable({ ...VisualAssist.settings, enhanceFocus: false });
        break;
      case "dyslexiaFont":
        VisualAssist.enable({ ...VisualAssist.settings, dyslexiaFont: false });
        break;
      case "readingGuide":
        VisualAssist.enable({ ...VisualAssist.settings, readingGuide: false });
        break;
      case "focusMode":
      case "FocusMode":
        FocusMode.disable();
        break;
      case "readerMode":
      case "ReaderMode":
        ReaderMode.disable();
        break;
      case "keyboardNav":
      case "KeyboardNavigator":
        KeyboardNavigator.disable();
        break;
      case "voiceCommands":
      case "VoiceCommands":
        VoiceCommands.disable();
        break;
      case "autoCaptions":
      case "AutoTranscriber":
        AutoTranscriber.disable();
        break;
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=content.bundle.js.map
