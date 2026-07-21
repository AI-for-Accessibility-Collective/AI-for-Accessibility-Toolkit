(() => {
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
          pageOutline: true
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
          highlightLinks: true
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
          autoVideoDescribe: false
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
          pageOutline: true
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
          highlightLinks: true
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
          dismissOverlays: true
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
          highlightLinks: true
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
          highlightLinks: true
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
          dismissOverlays: true
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
          dismissOverlays: true
        }
      },
      photosensitive: {
        name: "Photosensitive",
        description: "Dark mode and reduced motion (WCAG 2.3.3, migraine/seizure prevention)",
        tools: {
          darkMode: true,
          motionReducer: true
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
      pageOutline: false
    }
  };

  // tools/profiles/settings.js
  var profiles = settings_default.profiles;
  var defaults = settings_default.defaults;
  var settings = { ...defaults };
  function mergeProfileTools(profileIds) {
    const numericKeys = ["fontScale", "lineHeight", "letterSpacing"];
    const merged = {};
    for (const profileId of profileIds) {
      const profile = profiles[profileId];
      if (!(profile == null ? void 0 : profile.tools)) continue;
      for (const [key, value] of Object.entries(profile.tools)) {
        if (numericKeys.includes(key) && typeof value === "number") {
          merged[key] = Math.max(merged[key] || 0, value);
        } else if ((key === "colorFilter" || key === "contrastMode") && value !== "none") {
          merged[key] = value;
        } else {
          merged[key] = merged[key] || value;
        }
      }
    }
    return merged;
  }

  // extension/src/popup/popup.js
  function setChecked(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = value;
  }
  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "fixAdded") {
      updateFixesPanel(message.stats, message.fixes);
    }
    if (message.type === "statusUpdate") {
      updateStatus(message.status);
    }
    if (message.type === "scanProgress") {
      updateScanProgress(message.progress, message.phase);
    }
  });
  var KEY_TO_ELEMENT = { colorFilter: "colorBlindMode" };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      const el = document.getElementById(KEY_TO_ELEMENT[key] || key);
      if (el) {
        if (el.type === "checkbox") el.checked = newValue;
        else if (el.type === "range" || el.tagName === "SELECT") el.value = newValue;
      }
    }
  });
  function updateStatus(status) {
    const dot = document.querySelector(".status-dot");
    const text = document.querySelector(".status span:last-child");
    if (dot) dot.classList.toggle("off", !status.active);
    if (text) text.textContent = status.text || (status.active ? "Active" : "Inactive");
  }
  function updateScanProgress(progress, phase) {
    const scanBtn = document.getElementById("scanPage");
    if (scanBtn && progress < 100) {
      scanBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">sync</span> ${phase || "Scanning"}...`;
      scanBtn.disabled = true;
    } else if (scanBtn) {
      scanBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">refresh</span> Rescan`;
      scanBtn.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", async () => {
    const settings2 = await chrome.storage.sync.get([
      "enabled",
      "autoWcagFix",
      "autoDescribe",
      "autoSimplify",
      "autoSummarize",
      "autoFixLabels",
      "autoCaptions",
      "autoVideoDescribe",
      "darkMode",
      "readerMode",
      "keyboardNav",
      "voiceCommands",
      "motionReducer",
      "focusMode",
      "hideDistractions",
      "showProgress",
      "colorFilter",
      "colorBlindMode",
      "fontScale",
      "lineHeight",
      "letterSpacing",
      "contrastMode",
      "dyslexiaFont",
      "largeCursor",
      "enhanceFocus",
      "readingGuide",
      "speechRate",
      "geminiKey",
      "falKey"
    ]);
    const fontScale = document.getElementById("fontScale");
    const fontScaleValue = document.getElementById("fontScaleValue");
    const lineHeight = document.getElementById("lineHeight");
    const lineHeightValue = document.getElementById("lineHeightValue");
    const letterSpacing = document.getElementById("letterSpacing");
    const letterSpacingValue = document.getElementById("letterSpacingValue");
    const focusMode = document.getElementById("focusMode");
    const focusOptions = document.getElementById("focusModeOptions");
    const mainToggle = document.getElementById("mainToggle");
    mainToggle.checked = settings2.enabled !== false;
    mainToggle.addEventListener("change", async (e) => {
      await chrome.storage.sync.set({ enabled: e.target.checked });
      sendToContent({ type: "setEnabled", enabled: e.target.checked });
    });
    const aiDefaults = {
      autoWcagFix: true,
      autoDescribe: true,
      autoSimplify: false,
      autoSummarize: false,
      autoFixLabels: true,
      autoVideoDescribe: false,
      autoCaptions: false
    };
    Object.entries(aiDefaults).forEach(([id, defaultVal]) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = defaultVal ? settings2[id] !== false : settings2[id] === true;
        el.addEventListener("change", async (e) => {
          await chrome.storage.sync.set({ [id]: e.target.checked });
          sendToContent({ type: "settingsChanged", settings: { [id]: e.target.checked } });
        });
      }
    });
    const simpleTools = {
      darkMode: "DarkMode",
      readerMode: "ReaderMode",
      keyboardNav: "KeyboardNavigator",
      voiceCommands: "VoiceCommands",
      motionReducer: "MotionReducer"
    };
    Object.entries(simpleTools).forEach(([id, toolName]) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = settings2[id] === true;
        el.addEventListener("change", async (e) => {
          await chrome.storage.sync.set({ [id]: e.target.checked });
          if (e.target.checked) {
            sendToContent({ type: "enableTool", tool: toolName });
          } else {
            sendToContent({ type: "disableTool", tool: toolName });
          }
        });
      }
    });
    focusMode.checked = settings2.focusMode === true;
    if (settings2.focusMode) {
      focusOptions.classList.add("show");
    }
    ["hideDistractions", "showProgress"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = settings2[id] === true;
    });
    focusMode.addEventListener("change", async (e) => {
      await chrome.storage.sync.set({ focusMode: e.target.checked });
      focusOptions.classList.toggle("show", e.target.checked);
      if (e.target.checked) {
        sendFocusModeUpdate();
      } else {
        sendToContent({ type: "disableTool", tool: "FocusMode" });
      }
    });
    ["hideDistractions", "showProgress"].forEach((id) => {
      var _a;
      (_a = document.getElementById(id)) == null ? void 0 : _a.addEventListener("change", async (e) => {
        await chrome.storage.sync.set({ [id]: e.target.checked });
        if (focusMode.checked) {
          sendFocusModeUpdate();
        }
      });
    });
    function sendFocusModeUpdate() {
      sendToContent({
        type: "enableTool",
        tool: "FocusMode",
        options: {
          hideDistractions: document.getElementById("hideDistractions").checked,
          showProgress: document.getElementById("showProgress").checked
        }
      });
    }
    const colorBlindEl = document.getElementById("colorBlindMode");
    const savedColorFilter = settings2.colorFilter || settings2.colorBlindMode;
    if (savedColorFilter) {
      colorBlindEl.value = savedColorFilter;
    }
    colorBlindEl.addEventListener("change", async (e) => {
      await chrome.storage.sync.set({ colorFilter: e.target.value });
      if (e.target.value === "none") {
        sendToContent({ type: "disableTool", tool: "ColorBlindMode" });
      } else {
        sendToContent({ type: "enableTool", tool: "ColorBlindMode", options: e.target.value });
      }
    });
    if (settings2.fontScale !== void 0) {
      fontScale.value = settings2.fontScale;
      fontScaleValue.textContent = settings2.fontScale + "%";
    }
    if (settings2.lineHeight !== void 0) {
      lineHeight.value = settings2.lineHeight;
      lineHeightValue.textContent = parseFloat(settings2.lineHeight).toFixed(1);
    }
    if (settings2.letterSpacing !== void 0) {
      letterSpacing.value = settings2.letterSpacing;
      letterSpacingValue.textContent = parseFloat(settings2.letterSpacing).toFixed(2) + "em";
    }
    if (settings2.contrastMode) {
      document.getElementById("contrastMode").value = settings2.contrastMode;
    }
    ["dyslexiaFont", "largeCursor", "enhanceFocus", "readingGuide"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = settings2[id] === true;
    });
    if (settings2.speechRate !== void 0) {
      document.getElementById("speechRate").value = settings2.speechRate;
    }
    fontScale.addEventListener("input", () => {
      fontScaleValue.textContent = fontScale.value + "%";
    });
    lineHeight.addEventListener("input", () => {
      lineHeightValue.textContent = parseFloat(lineHeight.value).toFixed(1);
    });
    letterSpacing.addEventListener("input", () => {
      letterSpacingValue.textContent = parseFloat(letterSpacing.value).toFixed(2) + "em";
    });
    const visualAssistControls = [
      "contrastMode",
      "fontScale",
      "lineHeight",
      "letterSpacing",
      "dyslexiaFont",
      "largeCursor",
      "enhanceFocus",
      "readingGuide"
    ];
    visualAssistControls.forEach((id) => {
      const el = document.getElementById(id);
      const eventType = (el == null ? void 0 : el.type) === "range" ? "input" : "change";
      el == null ? void 0 : el.addEventListener(eventType, async () => {
        if (el.type === "checkbox") {
          await chrome.storage.sync.set({ [id]: el.checked });
        } else if (el.type === "range") {
          await chrome.storage.sync.set({ [id]: parseFloat(el.value) });
        } else {
          await chrome.storage.sync.set({ [id]: el.value });
        }
        applyVisualAssist();
      });
    });
    document.getElementById("speechRate").addEventListener("change", async (e) => {
      await chrome.storage.sync.set({ speechRate: parseFloat(e.target.value) });
    });
    function applyVisualAssist() {
      const options = {
        contrastMode: document.getElementById("contrastMode").value,
        fontScale: parseFloat(fontScale.value) / 100,
        lineHeight: parseFloat(lineHeight.value),
        letterSpacing: parseFloat(letterSpacing.value),
        dyslexiaFont: document.getElementById("dyslexiaFont").checked,
        largeCursor: document.getElementById("largeCursor").checked,
        enhanceFocus: document.getElementById("enhanceFocus").checked,
        readingGuide: document.getElementById("readingGuide").checked
      };
      const hasChanges = options.contrastMode !== "none" || options.fontScale !== 1 || options.lineHeight !== 1.5 || options.letterSpacing !== 0 || options.dyslexiaFont || options.largeCursor || options.enhanceFocus || options.readingGuide;
      if (hasChanges) {
        sendToContent({ type: "enableTool", tool: "VisualAssist", options });
      } else {
        sendToContent({ type: "disableTool", tool: "VisualAssist" });
      }
    }
    const readBtn = document.getElementById("readAloudBtn");
    let isReading = false;
    readBtn.addEventListener("click", () => {
      if (isReading) {
        sendToContent({ type: "stopSpeech" });
        readBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">play_arrow</span> Read';
        isReading = false;
      } else {
        const rate = parseFloat(document.getElementById("speechRate").value);
        sendToContent({ type: "speakPage", rate });
        readBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">stop</span> Stop';
        isReading = true;
      }
    });
    const profileCheckboxes = document.querySelectorAll(".profile-checkbox input");
    const profileCountEl = document.getElementById("profileCount");
    chrome.storage.sync.get(["selectedProfiles", "selectedProfile"], async (result) => {
      let savedProfiles = result.selectedProfiles || [];
      if (savedProfiles.length === 0 && result.selectedProfile && result.selectedProfile !== "none") {
        savedProfiles = [result.selectedProfile];
        await chrome.storage.sync.set({ selectedProfiles: savedProfiles });
        await chrome.storage.sync.remove("selectedProfile");
      }
      profileCheckboxes.forEach((cb) => {
        cb.checked = savedProfiles.includes(cb.value);
      });
      updateProfileCount(savedProfiles.length);
      if (savedProfiles.length > 0) {
        const merged = mergePresets(savedProfiles);
        applyPreset(merged);
      }
    });
    function updateProfileCount(count) {
      profileCountEl.textContent = count > 0 ? `${count} selected` : "";
    }
    function getSelectedProfiles() {
      return Array.from(profileCheckboxes).filter((cb) => cb.checked).map((cb) => cb.value);
    }
    const mergePresets = mergeProfileTools;
    profileCheckboxes.forEach((cb) => {
      cb.addEventListener("change", async () => {
        const selectedProfiles = getSelectedProfiles();
        await chrome.storage.sync.set({ selectedProfiles });
        updateProfileCount(selectedProfiles.length);
        if (selectedProfiles.length === 0) {
          await resetAll();
        } else {
          await resetAllUI(true);
          sendToContent({ type: "revertAll" });
          const merged = mergePresets(selectedProfiles);
          applyPreset(merged);
        }
      });
    });
    async function resetAllUI(preserveProfile = false) {
      const togglesOff = [
        "darkMode",
        "readerMode",
        "focusMode",
        "keyboardNav",
        "voiceCommands",
        "motionReducer",
        "dyslexiaFont",
        "largeCursor",
        "enhanceFocus",
        "readingGuide",
        "autoCaptions",
        "autoVideoDescribe",
        "hideDistractions",
        "autoSimplify",
        "autoSummarize"
      ];
      togglesOff.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
      });
      const togglesOn = ["showProgress", "autoDescribe", "autoWcagFix", "autoFixLabels"];
      togglesOn.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = true;
      });
      setValue("contrastMode", "none");
      setValue("colorBlindMode", "none");
      setValue("speechRate", "1");
      if (fontScale) {
        fontScale.value = 100;
        fontScaleValue.textContent = "100%";
      }
      if (lineHeight) {
        lineHeight.value = 1.5;
        lineHeightValue.textContent = "1.5";
      }
      if (letterSpacing) {
        letterSpacing.value = 0;
        letterSpacingValue.textContent = "0.00em";
      }
      if (focusOptions) focusOptions.classList.remove("show");
      if (!preserveProfile) {
        profileCheckboxes.forEach((cb) => cb.checked = false);
        updateProfileCount(0);
      }
      const storageReset = {};
      togglesOff.forEach((id) => storageReset[id] = false);
      togglesOn.forEach((id) => storageReset[id] = true);
      storageReset.contrastMode = "none";
      storageReset.colorFilter = "none";
      storageReset.speechRate = 1;
      storageReset.fontScale = 100;
      storageReset.lineHeight = 1.5;
      storageReset.letterSpacing = 0;
      if (!preserveProfile) {
        storageReset.selectedProfiles = [];
      }
      await chrome.storage.sync.set(storageReset);
    }
    function applyPreset(preset) {
      if (preset.fontScale) {
        fontScale.value = preset.fontScale;
        fontScaleValue.textContent = preset.fontScale + "%";
      }
      if (preset.lineHeight) {
        lineHeight.value = preset.lineHeight;
        lineHeightValue.textContent = preset.lineHeight.toFixed(1);
      }
      if (preset.letterSpacing) {
        letterSpacing.value = preset.letterSpacing;
        letterSpacingValue.textContent = preset.letterSpacing.toFixed(2) + "em";
      }
      if (preset.contrastMode) setValue("contrastMode", preset.contrastMode);
      if (preset.dyslexiaFont) setChecked("dyslexiaFont", true);
      if (preset.largeCursor) setChecked("largeCursor", true);
      if (preset.enhanceFocus) setChecked("enhanceFocus", true);
      if (preset.readingGuide) setChecked("readingGuide", true);
      if (preset.darkMode) {
        setChecked("darkMode", true);
        sendToContent({ type: "enableTool", tool: "DarkMode" });
      }
      if (preset.motionReducer) {
        setChecked("motionReducer", true);
        sendToContent({ type: "enableTool", tool: "MotionReducer" });
      }
      if (preset.readerMode) {
        setChecked("readerMode", true);
        sendToContent({ type: "enableTool", tool: "ReaderMode" });
      }
      if (preset.keyboardNav) {
        setChecked("keyboardNav", true);
        sendToContent({ type: "enableTool", tool: "KeyboardNavigator" });
      }
      if (preset.voiceCommands) {
        setChecked("voiceCommands", true);
        sendToContent({ type: "enableTool", tool: "VoiceCommands" });
      }
      if (preset.autoCaptions) {
        setChecked("autoCaptions", true);
        chrome.storage.sync.set({ autoCaptions: true });
        sendToContent({ type: "enableTool", tool: "AutoTranscriber" });
      }
      if (preset.focusMode) {
        setChecked("focusMode", true);
        focusOptions.classList.add("show");
        if (preset.hideDistractions) setChecked("hideDistractions", true);
        setChecked("showProgress", preset.showProgress !== false);
        sendFocusModeUpdate();
      }
      if (preset.colorFilter && preset.colorFilter !== "none") {
        setValue("colorBlindMode", preset.colorFilter);
        chrome.storage.sync.set({ colorFilter: preset.colorFilter });
        sendToContent({ type: "enableTool", tool: "ColorBlindMode", options: preset.colorFilter });
      }
      if (preset.autoWcagFix !== void 0) {
        document.getElementById("autoWcagFix").checked = preset.autoWcagFix;
        chrome.storage.sync.set({ autoWcagFix: preset.autoWcagFix });
        sendToContent({ type: "settingsChanged", settings: { autoWcagFix: preset.autoWcagFix } });
      }
      if (preset.autoFixLabels !== void 0) {
        document.getElementById("autoFixLabels").checked = preset.autoFixLabels;
        chrome.storage.sync.set({ autoFixLabels: preset.autoFixLabels });
        sendToContent({ type: "settingsChanged", settings: { autoFixLabels: preset.autoFixLabels } });
      }
      if (preset.autoDescribe !== void 0) {
        document.getElementById("autoDescribe").checked = preset.autoDescribe;
        chrome.storage.sync.set({ autoDescribe: preset.autoDescribe });
        sendToContent({ type: "settingsChanged", settings: { autoDescribe: preset.autoDescribe } });
      }
      if (preset.autoVideoDescribe !== void 0) {
        document.getElementById("autoVideoDescribe").checked = preset.autoVideoDescribe;
        chrome.storage.sync.set({ autoVideoDescribe: preset.autoVideoDescribe });
        sendToContent({ type: "settingsChanged", settings: { autoVideoDescribe: preset.autoVideoDescribe } });
      }
      if (preset.autoSimplify) {
        document.getElementById("autoSimplify").checked = true;
        chrome.storage.sync.set({ autoSimplify: true });
        sendToContent({ type: "settingsChanged", settings: { autoSimplify: true } });
      }
      if (preset.autoSummarize) {
        document.getElementById("autoSummarize").checked = true;
        chrome.storage.sync.set({ autoSummarize: true });
        sendToContent({ type: "settingsChanged", settings: { autoSummarize: true } });
      }
      if (preset.autoCaptions === false) {
        document.getElementById("autoCaptions").checked = false;
        chrome.storage.sync.set({ autoCaptions: false });
      }
      if (preset.fontScale || preset.lineHeight || preset.letterSpacing || preset.contrastMode || preset.dyslexiaFont || preset.largeCursor || preset.enhanceFocus || preset.readingGuide) {
        const visualStorage = {
          fontScale: preset.fontScale || 100,
          lineHeight: preset.lineHeight || 1.5,
          letterSpacing: preset.letterSpacing || 0,
          contrastMode: preset.contrastMode || "none",
          dyslexiaFont: preset.dyslexiaFont || false,
          largeCursor: preset.largeCursor || false,
          enhanceFocus: preset.enhanceFocus || false,
          readingGuide: preset.readingGuide || false
        };
        chrome.storage.sync.set(visualStorage);
        applyVisualAssist();
      }
      const toolStorage = {};
      if (preset.darkMode !== void 0) toolStorage.darkMode = preset.darkMode;
      if (preset.motionReducer !== void 0) toolStorage.motionReducer = preset.motionReducer;
      if (preset.readerMode !== void 0) toolStorage.readerMode = preset.readerMode;
      if (preset.keyboardNav !== void 0) toolStorage.keyboardNav = preset.keyboardNav;
      if (preset.voiceCommands !== void 0) toolStorage.voiceCommands = preset.voiceCommands;
      if (preset.focusMode !== void 0) toolStorage.focusMode = preset.focusMode;
      if (preset.hideDistractions !== void 0) toolStorage.hideDistractions = preset.hideDistractions;
      if (preset.showProgress !== void 0) toolStorage.showProgress = preset.showProgress;
      if (Object.keys(toolStorage).length > 0) {
        chrome.storage.sync.set(toolStorage);
      }
    }
    document.getElementById("resetAll").addEventListener("click", resetAll);
    async function resetAll() {
      await resetAllUI();
      sendToContent({ type: "revertAll" });
    }
    document.getElementById("apiKeysSection").addEventListener("click", (e) => {
      if (e.target.closest(".collapsible-header")) {
        document.getElementById("apiKeysSection").classList.toggle("open");
      }
    });
    document.getElementById("geminiKey").value = settings2.geminiKey || "";
    document.getElementById("falKey").value = settings2.falKey || "";
    document.getElementById("saveKeys").addEventListener("click", async () => {
      const geminiKey = document.getElementById("geminiKey").value.trim();
      const falKey = document.getElementById("falKey").value.trim();
      await chrome.storage.sync.set({ geminiKey, falKey });
      const btn = document.getElementById("saveKeys");
      btn.textContent = "Saved!";
      btn.classList.add("success");
      setTimeout(() => {
        btn.textContent = "Save Keys";
        btn.classList.remove("success");
      }, 1500);
    });
    document.getElementById("scanPage").addEventListener("click", () => {
      sendToContent({ type: "rescan" });
    });
    document.querySelectorAll(".section-header").forEach((header) => {
      header.addEventListener("click", () => {
        header.closest(".section").classList.toggle("collapsed");
      });
    });
    queryToolStates();
    queryStats();
  });
  async function sendToContent(message) {
    var _a, _b;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if ((tab == null ? void 0 : tab.id) && !((_a = tab.url) == null ? void 0 : _a.startsWith("chrome://")) && !((_b = tab.url) == null ? void 0 : _b.startsWith("chrome-extension://"))) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
        });
      }
    } catch (e) {
    }
  }
  async function queryToolStates() {
    var _a;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if ((tab == null ? void 0 : tab.id) && !((_a = tab.url) == null ? void 0 : _a.startsWith("chrome://"))) {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "getToolStates" }).catch(() => null);
        if (response == null ? void 0 : response.states) {
          updateUIFromStates(response.states);
        }
      }
    } catch (e) {
    }
  }
  function updateUIFromStates(states) {
    var _a;
    const toolMap = {
      DarkMode: "darkMode",
      ReaderMode: "readerMode",
      FocusMode: "focusMode",
      KeyboardNavigator: "keyboardNav",
      VoiceCommands: "voiceCommands",
      MotionReducer: "motionReducer",
      AutoTranscriber: "autoCaptions"
    };
    for (const [toolName, elementId] of Object.entries(toolMap)) {
      if (states[toolName] !== void 0) {
        const el = document.getElementById(elementId);
        if (el) el.checked = states[toolName];
        if (toolName === "FocusMode" && states[toolName]) {
          (_a = document.getElementById("focusModeOptions")) == null ? void 0 : _a.classList.add("show");
        }
      }
    }
  }
  async function queryStats() {
    var _a;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if ((tab == null ? void 0 : tab.id) && !((_a = tab.url) == null ? void 0 : _a.startsWith("chrome://"))) {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "getStats" }).catch(() => null);
        if (response == null ? void 0 : response.success) {
          updateFixesPanel(response.stats, response.fixes || []);
        }
      }
    } catch (e) {
    }
  }
  function updateFixesPanel(stats, fixes) {
    const panel = document.getElementById("fixesPanel");
    if (!panel || !stats) return;
    const summary = panel.querySelector(".fixes-summary");
    const body = panel.querySelector(".fixes-body");
    const list = panel.querySelector(".fixes-list");
    if (!summary || !body || !list) return;
    const total = (stats.wcag || 0) + (stats.images || 0) + (stats.labels || 0) + (stats.text || 0) + (stats.captions || 0);
    if (total === 0) {
      panel.style.display = "none";
      return;
    }
    const parts = [];
    if (stats.wcag) parts.push(`${stats.wcag} WCAG`);
    if (stats.images) parts.push(`${stats.images} images`);
    if (stats.labels) parts.push(`${stats.labels} labels`);
    if (stats.text) parts.push(`${stats.text} text`);
    if (stats.captions) parts.push(`${stats.captions} captions`);
    summary.innerHTML = `<strong>${total} issues fixed</strong> <span>(${parts.join(", ")})</span>`;
    panel.style.display = "block";
    if (!fixes || !Array.isArray(fixes)) fixes = [];
    list.innerHTML = fixes.map((fix) => `
    <div class="fix-item">
      <span class="fix-type">${escapeHtml(fix.type)} \xB7 ${escapeHtml(fix.element)}</span>
      <span class="fix-old">${escapeHtml(fix.old)}</span>
      <span class="fix-new">${escapeHtml(fix.new)}</span>
    </div>
  `).join("");
    const header = document.getElementById("fixesHeader");
    if (header) {
      const togglePanel = () => {
        panel.classList.toggle("expanded");
        const isExpanded = panel.classList.contains("expanded");
        body.style.display = isExpanded ? "block" : "none";
        header.setAttribute("aria-expanded", isExpanded);
      };
      header.onclick = togglePanel;
      header.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          togglePanel();
        }
      };
      header.style.cursor = "pointer";
      header.setAttribute("tabindex", "0");
      header.setAttribute("role", "button");
      header.setAttribute("aria-expanded", "false");
      header.setAttribute("aria-controls", "fixesBody");
    }
  }
  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
