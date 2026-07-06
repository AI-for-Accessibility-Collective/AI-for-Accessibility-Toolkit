function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = value;
}
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'fixAdded') updateFixesPanel(message.stats, message.fixes);
  if (message.type === 'statusUpdate') updateStatus(message.status);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    const el = document.getElementById(key);
    if (el) {
      if (el.type === 'checkbox') el.checked = newValue;
      else if (el.type === 'range' || el.tagName === 'SELECT') el.value = newValue;
    }
  }
});

function updateStatus(status) {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status span:last-child');
  if (dot) dot.classList.toggle('off', !status.active);
  if (text) text.textContent = status.text || (status.active ? 'Active' : 'Inactive');
}

// Build the save-profile modal's site-type checkboxes from the shared
// taxonomy (lib/taxonomy.js) so the vocabulary can't drift from the
// classifier's. Categories marked noMemoryDefault still appear — they gate
// the Librarian's observation logging (Phase 1), not profile auto-apply.
function renderSiteTypeGrid() {
  const grid = document.querySelector('.site-type-grid');
  if (!grid || !globalThis.AA_TAXONOMY) return;
  grid.textContent = '';
  for (const cat of AA_TAXONOMY.categories) {
    const label = document.createElement('label');
    label.className = 'site-type-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cat.id;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + cat.label));
    grid.appendChild(label);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  renderSiteTypeGrid();
  const settings = await chrome.storage.sync.get([
    'enabled', 'autoWcagFix', 'autoDescribe', 'autoSimplify', 'autoSummarize',
    'autoFixLabels', 'autoCaptions', 'autoVideoDescribe',
    'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands', 'motionReducer', 'focusMode',
    'hideDistractions', 'showProgress', 'colorBlindMode',
    'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'speechRate',
    'geminiKey', 'selectedProfiles', 'onboardingComplete', 'nudgeDismissed'
  ]);

  // Overlay the Librarian's effective preferences for the CURRENT tab so the
  // controls reflect what's actually applied on this page — e.g. a "150% on
  // news sites" scoped preference — instead of only the global baseline. The
  // values share the popup's units (fontScale %, lineHeight multiplier, …).
  // `scopedKeys` tracks which controls are showing a site-scoped value so a
  // later change writes it back to the right scope, not the global baseline.
  const currentTabUrl = await (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return /^https?:/.test(tab?.url || '') ? tab.url : null;
    } catch { return null; }
  })();
  // effProvenance: setting key -> scope its shown value came from. A change to
  // a key whose value is site-scoped is written back to that scope.
  let effProvenance = {};
  if (currentTabUrl) {
    const eff = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'librarianEffectivePreferences', url: currentTabUrl, contexts: [] },
          (r) => { void chrome.runtime.lastError; resolve(r || null); });
      } catch { resolve(null); }
    });
    if (eff?.settings) {
      Object.assign(settings, eff.settings);
      effProvenance = eff.provenance || {};
    }
  }
  // Persist a settings change to the scope its current value belongs to: if the
  // value is site-scoped (category:/origin:), update that Librarian record;
  // otherwise write the global baseline. Keeps "150% on news sites" from being
  // overwritten globally when the user nudges the slider on a news page.
  async function persistSetting(key, value) {
    const scope = effProvenance[key];
    if (scope && (scope.startsWith('category:') || scope.startsWith('origin:'))) {
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: 'librarianRecordScopedSettings', scope, settings: { [key]: value } },
            () => { void chrome.runtime.lastError; resolve(); });
        } catch { resolve(); }
      });
    } else {
      await chrome.storage.sync.set({ [key]: value });
    }
  }

  // Show setup nudge if onboarding hasn't been completed
  const nudge = document.getElementById('setupNudge');
  if (!settings.onboardingComplete && !settings.nudgeDismissed) {
    nudge.hidden = false;
    document.getElementById('nudgeSetupBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'openOnboarding' });
      window.close();
    });
    document.getElementById('nudgeDismiss').addEventListener('click', async () => {
      nudge.hidden = true;
      await chrome.storage.sync.set({ nudgeDismissed: true });
    });
  }

  const fontScale = document.getElementById('fontScale');
  const fontScaleValue = document.getElementById('fontScaleValue');
  const lineHeight = document.getElementById('lineHeight');
  const lineHeightValue = document.getElementById('lineHeightValue');
  const letterSpacing = document.getElementById('letterSpacing');
  const letterSpacingValue = document.getElementById('letterSpacingValue');
  const focusModeEl = document.getElementById('focusMode');
  const focusOptions = document.getElementById('focusModeOptions');

  // Main toggle
  const mainToggle = document.getElementById('mainToggle');
  mainToggle.checked = settings.enabled !== false;
  mainToggle.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ enabled: e.target.checked });
    sendToContent({ type: 'setEnabled', enabled: e.target.checked });
  });

  // AI feature toggles
  const aiDefaults = {
    autoWcagFix: true, autoDescribe: true, autoSimplify: false,
    autoSummarize: false, autoFixLabels: true, autoVideoDescribe: false, autoCaptions: false
  };

  Object.entries(aiDefaults).forEach(([id, defaultVal]) => {
    const el = document.getElementById(id);
    if (el) {
      el.checked = defaultVal ? settings[id] !== false : settings[id] === true;
      el.addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ [id]: e.target.checked });
        sendToContent({ type: 'settingsChanged', settings: { [id]: e.target.checked } });
      });
    }
  });

  // Simple tool toggles
  const simpleTools = {
    darkMode: 'DarkMode',
    readerMode: 'ReaderMode',
    keyboardNav: 'KeyboardNavigator',
    voiceCommands: 'VoiceCommands',
    motionReducer: 'MotionReducer'
  };

  Object.entries(simpleTools).forEach(([id, toolName]) => {
    const el = document.getElementById(id);
    if (el) {
      el.checked = settings[id] === true;
      el.addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ [id]: e.target.checked });
        if (e.target.checked) sendToContent({ type: 'enableTool', tool: toolName });
        else sendToContent({ type: 'disableTool', tool: toolName });
      });
    }
  });

  // Focus Mode with sub-options
  focusModeEl.checked = settings.focusMode === true;
  if (settings.focusMode) focusOptions.classList.add('show');
  ['hideDistractions', 'showProgress'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[id] === true;
  });

  focusModeEl.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ focusMode: e.target.checked });
    focusOptions.classList.toggle('show', e.target.checked);
    if (e.target.checked) sendFocusModeUpdate();
    else sendToContent({ type: 'disableTool', tool: 'FocusMode' });
  });

  ['hideDistractions', 'showProgress'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
      if (focusModeEl.checked) sendFocusModeUpdate();
    });
  });

  function sendFocusModeUpdate() {
    sendToContent({
      type: 'enableTool', tool: 'FocusMode',
      options: {
        hideDistractions: document.getElementById('hideDistractions').checked,
        showProgress: document.getElementById('showProgress').checked
      }
    });
  }

  // Color blind mode
  const colorBlindEl = document.getElementById('colorBlindMode');
  if (settings.colorBlindMode) colorBlindEl.value = settings.colorBlindMode;
  colorBlindEl.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ colorBlindMode: e.target.value });
    if (e.target.value === 'none') sendToContent({ type: 'disableTool', tool: 'ColorBlindMode' });
    else sendToContent({ type: 'enableTool', tool: 'ColorBlindMode', options: e.target.value });
  });

  // Load Visual Assist settings from storage
  if (settings.fontScale !== undefined) { fontScale.value = settings.fontScale; fontScaleValue.textContent = settings.fontScale + '%'; }
  if (settings.lineHeight !== undefined) { lineHeight.value = settings.lineHeight; lineHeightValue.textContent = parseFloat(settings.lineHeight).toFixed(1); }
  if (settings.letterSpacing !== undefined) { letterSpacing.value = settings.letterSpacing; letterSpacingValue.textContent = parseFloat(settings.letterSpacing).toFixed(2) + 'em'; }
  if (settings.contrastMode) document.getElementById('contrastMode').value = settings.contrastMode;
  ['dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[id] === true;
  });
  if (settings.speechRate !== undefined) document.getElementById('speechRate').value = settings.speechRate;

  // Slider live updates
  fontScale.addEventListener('input', () => { fontScaleValue.textContent = fontScale.value + '%'; });
  lineHeight.addEventListener('input', () => { lineHeightValue.textContent = parseFloat(lineHeight.value).toFixed(1); });
  letterSpacing.addEventListener('input', () => { letterSpacingValue.textContent = parseFloat(letterSpacing.value).toFixed(2) + 'em'; });

  // Visual Assist controls — apply on any change
  const visualAssistControls = [
    'contrastMode', 'fontScale', 'lineHeight', 'letterSpacing',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'
  ];

  visualAssistControls.forEach(id => {
    const el = document.getElementById(id);
    const eventType = el?.type === 'range' ? 'input' : 'change';
    el?.addEventListener(eventType, async () => {
      const value = el.type === 'checkbox' ? el.checked
        : el.type === 'range' ? parseFloat(el.value) : el.value;
      await persistSetting(id, value);
      applyVisualAssist();
    });
  });

  document.getElementById('speechRate').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ speechRate: parseFloat(e.target.value) });
  });

  function applyVisualAssist() {
    const options = {
      contrastMode: document.getElementById('contrastMode').value,
      fontScale: parseFloat(fontScale.value) / 100,
      lineHeight: parseFloat(lineHeight.value),
      letterSpacing: parseFloat(letterSpacing.value),
      dyslexiaFont: document.getElementById('dyslexiaFont').checked,
      largeCursor: document.getElementById('largeCursor').checked,
      enhanceFocus: document.getElementById('enhanceFocus').checked,
      readingGuide: document.getElementById('readingGuide').checked
    };

    const hasChanges = options.contrastMode !== 'none' ||
      options.fontScale !== 1 || options.lineHeight !== 1.5 ||
      options.letterSpacing !== 0 || options.dyslexiaFont ||
      options.largeCursor || options.enhanceFocus || options.readingGuide;

    if (hasChanges) sendToContent({ type: 'enableTool', tool: 'VisualAssist', options });
    else sendToContent({ type: 'disableTool', tool: 'VisualAssist' });
  }

  // Read Aloud
  const readBtn = document.getElementById('readAloudBtn');
  let isReading = false;
  readBtn.addEventListener('click', () => {
    if (isReading) {
      sendToContent({ type: 'stopSpeech' });
      readBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">play_arrow</span> Read';
      isReading = false;
    } else {
      const rate = parseFloat(document.getElementById('speechRate').value);
      sendToContent({ type: 'speakPage', rate });
      readBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">stop</span> Stop';
      isReading = true;
    }
  });

  // --- Access Needs (functional, not diagnosis-based) ---
  const presets = {
    screenReader: {
      autoWcagFix: true, autoFixLabels: true, autoDescribe: true,
      autoVideoDescribe: true, keyboardNav: true
    },
    biggerText: {
      fontScale: 150, lineHeight: 2.0, letterSpacing: 0.12,
      largeCursor: true, enhanceFocus: true, autoWcagFix: true
    },
    colorAdjust: {
      autoDescribe: true, enhanceFocus: true
    },
    captions: {
      autoCaptions: true, enhanceFocus: true
    },
    altInput: {
      autoWcagFix: true, autoFixLabels: true, largeCursor: true,
      enhanceFocus: true, keyboardNav: true, voiceCommands: true
    },
    simplerContent: {
      autoSimplify: true, autoSummarize: true, fontScale: 120,
      lineHeight: 1.8, focusMode: true, hideDistractions: true, showProgress: true
    },
    fewerDistractions: {
      focusMode: true, hideDistractions: true, showProgress: true,
      motionReducer: true, autoSummarize: true
    },
    lessMotion: {
      motionReducer: true, focusMode: true, hideDistractions: true
    },
    dimmerDisplay: {
      darkMode: true, motionReducer: true
    },
    readingHelp: {
      fontScale: 115, lineHeight: 2.0, letterSpacing: 0.12, focusMode: true
    }
  };

  const profileCheckboxes = document.querySelectorAll('#profilesSection .profile-checkbox input');
  const profileCountEl = document.getElementById('profileCount');

  let savedProfiles = settings.selectedProfiles || [];
  profileCheckboxes.forEach(cb => { cb.checked = savedProfiles.includes(cb.value); });
  updateProfileCount(savedProfiles.length);
  if (savedProfiles.length > 0) applyPreset(mergePresets(savedProfiles));

  function updateProfileCount(count) {
    profileCountEl.textContent = count > 0 ? `${count} selected` : '';
  }

  function getSelectedProfiles() {
    return Array.from(profileCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
  }

  function mergePresets(profileIds) {
    const numericKeys = ['fontScale', 'lineHeight', 'letterSpacing'];
    const merged = {};
    for (const id of profileIds) {
      const preset = presets[id];
      if (!preset) continue;
      for (const [key, value] of Object.entries(preset)) {
        if (numericKeys.includes(key) && typeof value === 'number') merged[key] = Math.max(merged[key] || 0, value);
        else if ((key === 'colorFilter' || key === 'colorBlindMode') && value !== 'none') merged[key] = value;
        else merged[key] = merged[key] || value;
      }
    }
    return merged;
  }

  profileCheckboxes.forEach(cb => {
    cb.addEventListener('change', async () => {
      const selectedProfiles = getSelectedProfiles();
      await chrome.storage.sync.set({ selectedProfiles });
      updateProfileCount(selectedProfiles.length);
      if (selectedProfiles.length === 0) await resetAll();
      else {
        await resetAllUI(true);
        sendToContent({ type: 'revertAll' });
        applyPreset(mergePresets(selectedProfiles));
      }
    });
  });

  async function resetAllUI(preserveProfile = false) {
    const togglesOff = ['darkMode', 'readerMode', 'focusMode', 'keyboardNav', 'voiceCommands', 'motionReducer',
      'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'autoCaptions', 'autoVideoDescribe',
      'hideDistractions', 'autoSimplify', 'autoSummarize'];
    togglesOff.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });

    const togglesOn = ['showProgress', 'autoDescribe', 'autoWcagFix', 'autoFixLabels'];
    togglesOn.forEach(id => { const el = document.getElementById(id); if (el) el.checked = true; });

    setValue('contrastMode', 'none');
    setValue('colorBlindMode', 'none');
    setValue('speechRate', '1');

    if (fontScale) { fontScale.value = 100; fontScaleValue.textContent = '100%'; }
    if (lineHeight) { lineHeight.value = 1.5; lineHeightValue.textContent = '1.5'; }
    if (letterSpacing) { letterSpacing.value = 0; letterSpacingValue.textContent = '0.00em'; }

    if (focusOptions) focusOptions.classList.remove('show');

    if (!preserveProfile) {
      profileCheckboxes.forEach(cb => cb.checked = false);
      updateProfileCount(0);
    }

    const storageReset = {};
    togglesOff.forEach(id => storageReset[id] = false);
    togglesOn.forEach(id => storageReset[id] = true);
    storageReset.contrastMode = 'none';
    storageReset.colorBlindMode = 'none';
    storageReset.speechRate = 1;
    storageReset.fontScale = 100;
    storageReset.lineHeight = 1.5;
    storageReset.letterSpacing = 0;
    if (!preserveProfile) storageReset.selectedProfiles = [];
    await chrome.storage.sync.set(storageReset);
  }

  function applyPreset(preset) {
    const has = (k) => preset[k] !== undefined;
    const num = (v) => typeof v === 'number' ? v : parseFloat(v) || 0;

    // Numeric display settings
    if (has('fontScale')) {
      const v = num(preset.fontScale);
      fontScale.value = v; fontScaleValue.textContent = v + '%';
    }
    if (has('lineHeight')) {
      const v = num(preset.lineHeight);
      lineHeight.value = v; lineHeightValue.textContent = v.toFixed(1);
    }
    if (has('letterSpacing')) {
      const v = num(preset.letterSpacing);
      letterSpacing.value = v; letterSpacingValue.textContent = v.toFixed(2) + 'em';
    }
    if (has('contrastMode')) setValue('contrastMode', preset.contrastMode);

    // Boolean display toggles
    ['dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'].forEach(key => {
      if (has(key)) setChecked(key, !!preset[key]);
    });

    // Tool toggles — enable OR disable based on the actual value
    const toolMap = {
      darkMode: 'DarkMode', motionReducer: 'MotionReducer', readerMode: 'ReaderMode',
      keyboardNav: 'KeyboardNavigator', voiceCommands: 'VoiceCommands'
    };
    for (const [key, toolName] of Object.entries(toolMap)) {
      if (!has(key)) continue;
      setChecked(key, !!preset[key]);
      if (preset[key]) sendToContent({ type: 'enableTool', tool: toolName });
      else sendToContent({ type: 'disableTool', tool: toolName });
    }

    // Focus Mode (with sub-options)
    if (has('focusMode')) {
      setChecked('focusMode', !!preset.focusMode);
      if (preset.focusMode) {
        focusOptions.classList.add('show');
        if (has('hideDistractions')) setChecked('hideDistractions', !!preset.hideDistractions);
        setChecked('showProgress', preset.showProgress !== false);
        sendFocusModeUpdate();
      } else {
        focusOptions.classList.remove('show');
        sendToContent({ type: 'disableTool', tool: 'FocusMode' });
      }
    }

    // Color blind mode
    if (has('colorBlindMode')) {
      setValue('colorBlindMode', preset.colorBlindMode);
      chrome.storage.sync.set({ colorBlindMode: preset.colorBlindMode });
      if (preset.colorBlindMode && preset.colorBlindMode !== 'none') {
        sendToContent({ type: 'enableTool', tool: 'ColorBlindMode', options: preset.colorBlindMode });
      } else {
        sendToContent({ type: 'disableTool', tool: 'ColorBlindMode' });
      }
    }

    // AI settings (including autoCaptions)
    ['autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoVideoDescribe', 'autoSimplify', 'autoSummarize', 'autoCaptions'].forEach(key => {
      if (has(key)) {
        setChecked(key, !!preset[key]);
        chrome.storage.sync.set({ [key]: !!preset[key] });
        sendToContent({ type: 'settingsChanged', settings: { [key]: !!preset[key] } });
      }
    });

    // Persist visual assist settings and apply
    const vaKeys = ['fontScale', 'lineHeight', 'letterSpacing', 'contrastMode',
      'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'];
    if (vaKeys.some(k => has(k))) {
      const visualStorage = {
        fontScale: has('fontScale') ? num(preset.fontScale) : 100,
        lineHeight: has('lineHeight') ? num(preset.lineHeight) : 1.5,
        letterSpacing: has('letterSpacing') ? num(preset.letterSpacing) : 0,
        contrastMode: preset.contrastMode || 'none',
        dyslexiaFont: !!preset.dyslexiaFont, largeCursor: !!preset.largeCursor,
        enhanceFocus: !!preset.enhanceFocus, readingGuide: !!preset.readingGuide
      };
      chrome.storage.sync.set(visualStorage);
      applyVisualAssist();
    }

    // Persist tool toggles
    const toolStorage = {};
    ['darkMode', 'motionReducer', 'readerMode', 'keyboardNav', 'voiceCommands',
     'focusMode', 'hideDistractions', 'showProgress'].forEach(key => {
      if (has(key)) toolStorage[key] = !!preset[key];
    });
    if (Object.keys(toolStorage).length > 0) chrome.storage.sync.set(toolStorage);
  }

  // Reset all
  document.getElementById('resetAll').addEventListener('click', resetAll);
  async function resetAll() {
    await resetAllUI();
    sendToContent({ type: 'revertAll' });
  }

  // API Keys
  document.getElementById('apiKeysSection').addEventListener('click', (e) => {
    if (e.target.closest('.collapsible-header'))
      document.getElementById('apiKeysSection').classList.toggle('open');
  });
  const storedGeminiKey = settings.geminiKey || '';
  document.getElementById('geminiKey').value = storedGeminiKey;
  // If key exists under old name but not new, migrate it
  if (storedGeminiKey && !settings.geminiApiKey) {
    chrome.runtime.sendMessage({ type: 'saveApiKey', apiKey: storedGeminiKey });
  }
  document.getElementById('saveKeys').addEventListener('click', async () => {
    const geminiKey = document.getElementById('geminiKey').value.trim();
    await chrome.storage.sync.set({ geminiKey });
    chrome.runtime.sendMessage({ type: 'saveApiKey', apiKey: geminiKey });
    const btn = document.getElementById('saveKeys');
    btn.textContent = 'Saved!';
    btn.classList.add('success');
    setTimeout(() => { btn.textContent = 'Save'; btn.classList.remove('success'); }, 1500);
  });

  // Scan page
  document.getElementById('scanPage').addEventListener('click', () => {
    sendToContent({ type: 'rescan' });
  });

  // Onboarding / Skill Builder
  document.getElementById('onboardBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'openOnboarding' });
    window.close();
  });
  document.getElementById('builderBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'openSkillBuilder' });
    window.close();
  });

  // Collapsible sections
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.section');
      section.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', !section.classList.contains('collapsed'));
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
    });
  });

  // --- AI Support Input ---
  const aiInput = document.getElementById('aiSupportInput');
  const aiBtn = document.getElementById('aiSupportBtn');
  const aiSuggestion = document.getElementById('aiSuggestion');
  const aiLoading = document.getElementById('aiLoading');
  let pendingAISuggestion = null;

  function showAIError(msg) {
    document.getElementById('aiSuggestionSummary').textContent = msg;
    document.getElementById('aiSuggestionList').innerHTML = '';
    aiSuggestion.hidden = false;
  }

  function finishAILoading() {
    aiLoading.hidden = true;
    aiBtn.disabled = false;
  }

  function sendMessageSafe(msg, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
      chrome.runtime.sendMessage(msg, (resp) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });
  }

  async function submitSupportQuery(text) {
    if (!text.trim()) return;
    aiSuggestion.hidden = true;
    aiLoading.hidden = false;
    aiBtn.disabled = true;

    let resp;
    try {
      resp = await sendMessageSafe({ type: 'interpretNeeds', text: text.trim() });
    } catch (e) {
      finishAILoading();
      showAIError('Connection error: ' + (e.message || 'Try again.'));
      return;
    }

    finishAILoading();

    if (!resp || resp.error) {
      showAIError(resp?.error || 'Could not get suggestions. Check your API key.');
      return;
    }

    if (!resp.result) {
      showAIError('No response from AI. Check your API key and try again.');
      return;
    }

    try {
      const jsonMatch = resp.result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        pendingAISuggestion = JSON.parse(jsonMatch[0]);
        showAISuggestions(pendingAISuggestion);
      } else {
        showAIError('AI returned an unexpected format. Try rephrasing.');
      }
    } catch (e) {
      showAIError('Could not parse AI response. Try rephrasing.');
    }
  }

  function scopeChipLabel(scope) {
    if (!scope || scope === 'general') return 'Everywhere';
    if (scope.startsWith('category:')) return 'On ' + scope.slice(9) + ' sites';
    if (scope.startsWith('origin:')) return 'On ' + scope.slice(7);
    if (scope.startsWith('context:')) return 'For ' + scope.slice(8) + ' content';
    return scope;
  }

  function showAISuggestions(result) {
    document.getElementById('aiSuggestionSummary').textContent = result.summary || 'Here are my suggestions:';
    const listEl = document.getElementById('aiSuggestionList');
    listEl.innerHTML = '';

    // Show where these will apply, so scoping is visible before the user acts.
    const scopeRow = document.createElement('div');
    scopeRow.className = 'ai-suggestion-scope';
    scopeRow.textContent = 'Applies: ' + scopeChipLabel(result.scope);
    listEl.appendChild(scopeRow);

    // Reflect "apply AND build" in the primary button when a skill is needed.
    const applyBtn = document.getElementById('aiApplyBtn');
    if (applyBtn) {
      const hasSettings = result.settings && Object.keys(result.settings).length > 0;
      const hasSkills = result.newSkills?.length > 0;
      applyBtn.textContent = hasSkills
        ? (hasSettings ? 'Apply & build adapter' : 'Build adapter')
        : 'Apply suggestions';
    }

    const settingLabels = {
      darkMode: 'Dark Mode', fontScale: 'Font Size', lineHeight: 'Line Height',
      letterSpacing: 'Letter Spacing', dyslexiaFont: 'Dyslexia Font', largeCursor: 'Large Cursor',
      enhanceFocus: 'Enhanced Focus', readingGuide: 'Reading Guide', focusMode: 'Focus Mode',
      hideDistractions: 'Dim Distractions', showProgress: 'Progress Bar', motionReducer: 'Reduce Motion',
      readerMode: 'Reader Mode', keyboardNav: 'Keyboard Nav', voiceCommands: 'Voice Commands',
      contrastMode: 'Contrast', colorBlindMode: 'Color Filter', autoWcagFix: 'WCAG Auto-Fix',
      autoDescribe: 'Image Alt Text', autoFixLabels: 'Generate Labels', autoCaptions: 'Captions',
      autoSimplify: 'Simplify Text', autoSummarize: 'Summarize Text', autoVideoDescribe: 'Video Descriptions'
    };

    if (result.settings) {
      for (const [key, value] of Object.entries(result.settings)) {
        const item = document.createElement('div');
        item.className = 'ai-suggestion-item';
        const label = settingLabels[key] || key;
        const displayVal = typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : String(value);
        const reason = result.reasons?.[key] || '';
        item.innerHTML = `<span class="setting-name">${escapeHtml(label)}: ${displayVal}</span><span class="setting-reason">${escapeHtml(reason)}</span>`;
        listEl.appendChild(item);
      }
    }

    if (result.newSkills?.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'ai-suggestion-divider';
      divider.textContent = 'These needs require a custom adapter:';
      listEl.appendChild(divider);

      for (const skill of result.newSkills) {
        const item = document.createElement('div');
        item.className = 'ai-suggestion-item ai-new-skill';
        item.innerHTML = `<span class="setting-name">${escapeHtml(skill.name)}</span><span class="setting-reason">${escapeHtml(skill.description)}</span>`;
        listEl.appendChild(item);
      }
      // The primary "Apply & build adapter" button drives the build; no separate
      // inline button (it was an either/or that lost the scoped settings).
    }

    aiSuggestion.hidden = false;
  }

  // Apply the suggestion's built-in settings. A scoped request
  // ("...on news sites") is stored as a scoped Librarian preference (applies
  // only where it should) and pushed live to the current tab; an unscoped
  // request writes the global baseline as before.
  async function applySuggestionSettings(suggestion) {
    if (!suggestion?.settings || !Object.keys(suggestion.settings).length) return;
    const scope = suggestion.scope;
    if (scope && scope !== 'general') {
      await sendMessageSafe({
        type: 'librarianRecordScopedSettings', scope, settings: suggestion.settings,
      });
      await sendToContent({ type: 'applyProfile', settings: suggestion.settings });
    } else {
      applyPreset(suggestion.settings);
    }
  }

  // Open the skill builder for the suggestion's custom skills, carrying the
  // scope so the built skill is gated to the same sites as the settings.
  function openBuilderForSuggestion(suggestion) {
    const skills = suggestion?.newSkills || [];
    chrome.runtime.sendMessage({
      type: 'openSkillBuilder', pendingSkills: skills, scope: suggestion?.scope || 'general',
    });
    window.close();
  }

  document.getElementById('aiApplyBtn').addEventListener('click', async () => {
    const sug = pendingAISuggestion;
    if (!sug) return;
    await applySuggestionSettings(sug);
    aiInput.value = '';
    // Apply AND build: when the request also needs a custom skill, proceed
    // into the builder instead of forcing an either/or choice.
    if (sug.newSkills?.length > 0) {
      openBuilderForSuggestion(sug);
      return;
    }
    aiSuggestion.hidden = true;
  });

  document.getElementById('aiSaveProfileBtn').addEventListener('click', async () => {
    if (pendingAISuggestion?.settings) {
      await applySuggestionSettings(pendingAISuggestion);
      aiSuggestion.hidden = true;
      aiInput.value = '';
      openSaveProfileModal();
    }
  });

  document.getElementById('aiDismissBtn').addEventListener('click', () => {
    aiSuggestion.hidden = true;
    pendingAISuggestion = null;
  });

  aiBtn.addEventListener('click', () => submitSupportQuery(aiInput.value));
  aiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSupportQuery(aiInput.value);
  });

  // --- Custom Profiles ---
  const ALL_SETTING_KEYS = [
    'darkMode', 'readerMode', 'focusMode', 'keyboardNav', 'voiceCommands', 'motionReducer',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide',
    'hideDistractions', 'showProgress',
    'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode', 'colorBlindMode', 'speechRate',
    'autoWcagFix', 'autoDescribe', 'autoFixLabels', 'autoCaptions',
    'autoVideoDescribe', 'autoSimplify', 'autoSummarize'
  ];

  function captureCurrentSettings() {
    const s = {};
    for (const id of ALL_SETTING_KEYS) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.type === 'checkbox') s[id] = el.checked;
      else if (el.type === 'range') s[id] = parseFloat(el.value);
      else s[id] = el.value;
    }
    return s;
  }

  let modalReturnFocus = null;
  const modalOverlay = document.getElementById('saveProfileModal');
  const modalDialog = modalOverlay.querySelector('.modal');

  function openSaveProfileModal() {
    modalReturnFocus = document.activeElement;
    document.getElementById('profileNameInput').value = '';
    document.querySelectorAll('.site-type-grid input').forEach(cb => cb.checked = false);
    modalOverlay.classList.add('open');
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.getElementById('profileNameInput').focus();
  }

  function closeSaveProfileModal() {
    modalOverlay.classList.remove('open');
    modalOverlay.setAttribute('aria-hidden', 'true');
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') {
      modalReturnFocus.focus();
    }
    modalReturnFocus = null;
  }

  function trapFocusInModal(e) {
    if (e.key !== 'Tab') return;
    const focusable = modalDialog.querySelectorAll(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  document.getElementById('saveProfileBtn').addEventListener('click', openSaveProfileModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeSaveProfileModal);

  document.getElementById('modalSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) { document.getElementById('profileNameInput').focus(); return; }

    const saveBtn = document.getElementById('modalSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const siteTypes = Array.from(document.querySelectorAll('.site-type-grid input:checked')).map(cb => cb.value);
    const profile = {
      id: 'profile-' + Date.now(),
      name,
      siteTypes,
      autoApply: siteTypes.length > 0,
      settings: captureCurrentSettings()
    };

    try {
      await chrome.runtime.sendMessage({ type: 'saveCustomProfile', profile });
      closeSaveProfileModal();
      await loadAndRenderProfiles();
    } catch (e) {
      console.warn('Save profile error:', e);
      const nameInput = document.getElementById('profileNameInput');
      nameInput.setCustomValidity('Save failed. Try again.');
      nameInput.reportValidity();
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeSaveProfileModal();
  });

  modalOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSaveProfileModal();
    trapFocusInModal(e);
  });

  async function loadAndRenderProfiles() {
    let profiles = [];
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getCustomProfiles' });
      profiles = resp?.profiles || [];
    } catch (e) {
      console.warn('Failed to load profiles:', e);
    }

    const section = document.getElementById('myProfilesSection');
    const list = document.getElementById('myProfilesList');
    const countEl = document.getElementById('myProfilesCount');

    if (profiles.length === 0) { section.hidden = true; return; }

    section.hidden = false;
    countEl.textContent = String(profiles.length);
    list.innerHTML = '';

    for (const p of profiles) {
      const row = document.createElement('div');
      row.className = 'profile-item';

      const nameSpan = document.createElement('div');
      nameSpan.style.cssText = 'flex:1;min-width:0';
      nameSpan.innerHTML = `<div class="profile-item-name">${escapeHtml(p.name)}</div>` +
        (p.siteTypes?.length ? `<div class="profile-item-sites">${p.siteTypes.join(', ')}</div>` : '');

      const applyBtn = document.createElement('button');
      applyBtn.className = 'profile-item-btn apply';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', async () => {
        await resetAllUI(true);
        sendToContent({ type: 'revertAll' });
        applyPreset(p.settings);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'profile-item-btn delete';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        try {
          await chrome.runtime.sendMessage({ type: 'deleteCustomProfile', id: p.id });
        } catch (e) {
          console.warn('Delete profile error:', e);
        }
        await loadAndRenderProfiles();
      });

      row.appendChild(nameSpan);
      row.appendChild(applyBtn);
      row.appendChild(delBtn);
      list.appendChild(row);

      const actions = p.actions || [];
      if (actions.length > 0) {
        const actionList = document.createElement('div');
        actionList.className = 'profile-action-list';
        for (const action of actions) {
          const item = document.createElement('div');
          item.className = 'profile-action-item';

          const icon = document.createElement('span');
          icon.textContent = '\u25B6';
          icon.style.cssText = 'font-size:8px;color:var(--blue);flex-shrink:0';

          const name = document.createElement('span');
          name.className = 'action-name';
          name.textContent = action.name || action.prompt;
          name.title = action.prompt;

          const delActionBtn = document.createElement('button');
          delActionBtn.className = 'action-delete';
          delActionBtn.textContent = '\u2715';
          delActionBtn.title = 'Remove action';
          delActionBtn.setAttribute('aria-label', 'Remove action: ' + (action.name || action.prompt));
          delActionBtn.addEventListener('click', async () => {
            try {
              await chrome.runtime.sendMessage({
                type: 'removeActionFromProfile',
                profileId: p.id,
                actionId: action.id,
              });
              await loadAndRenderProfiles();
            } catch (e) {
              console.warn('Remove action failed:', e);
            }
          });

          item.appendChild(icon);
          item.appendChild(name);
          item.appendChild(delActionBtn);
          actionList.appendChild(item);
        }
        list.appendChild(actionList);
      }
    }
  }

  loadAndRenderProfiles();

  // Load custom skills (with on/off toggles and delete buttons).
  renderCustomSkillsList();

  // Query states from content
  queryToolStates();
  queryStats();

  // ============================================================
  // Browser Agent panel
  // ============================================================
  // Lives in chrome.storage.local.bhAgent and is updated by the service-
  // worker agent loop in extension/browser-harness/agent.js. The popup is
  // pure UI: render-from-storage on open, subscribe to onChanged for live
  // updates, send messages to start/stop/clear.
  setupAgentPanel();

  // What the Librarian knows: pending proposals (consent gate), learned
  // memories grouped by where they apply, and standing "don't suggest"
  // instructions. All plain language; raw records stay in storage.
  setupMemoryPanel();

  // Cross-app sharing: grants panel, sharing switch, acting-user selector.
  setupSharingPanel();
});

function sendMessageP(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp);
    });
  });
}

function setupMemoryPanel() {
  const proposalList = document.getElementById('proposalList');
  const proposalBanner = document.getElementById('proposalBanner');
  const memoryList = document.getElementById('memoryList');
  const badge = document.getElementById('memoryBadge');
  const pauseToggle = document.getElementById('memoryPauseToggle');
  if (!proposalList || !memoryList) return;

  pauseToggle?.addEventListener('change', async () => {
    await sendMessageP({ type: 'librarianSetPause', paused: !pauseToggle.checked });
  });

  function scopeLabel(scope) {
    if (scope === 'general') return 'Everywhere';
    if (scope.startsWith('category:')) return 'On ' + scope.slice(9) + ' sites';
    if (scope.startsWith('origin:')) return 'On ' + scope.slice(7);
    if (scope.startsWith('context:')) return 'For ' + scope.slice(8) + ' content';
    if (scope.startsWith('tool:')) return 'Tool: ' + scope.slice(5);
    return scope;
  }

  async function respond(id, response) {
    await sendMessageP({ type: 'librarianRespondToProposal', id, response });
    await render();
  }

  async function render() {
    const [profResp, propResp, memResp] = await Promise.all([
      sendMessageP({ type: 'librarianGetProfile' }),
      sendMessageP({ type: 'librarianListProposals' }),
      sendMessageP({ type: 'librarianListMemories', filter: { status: 'active' } }),
    ]);

    if (pauseToggle && profResp?.profile) {
      pauseToggle.checked = !profResp.profile.memoryPaused;
    }

    // --- Proposals: the consent gate ---
    // Rendered into the top-of-popup banner so a pending suggestion ("Is
    // this a reusable task?") is the first thing seen, not buried under the
    // settings sections. The in-section list is kept empty to avoid dupes.
    const proposals = propResp?.proposals || [];
    if (badge) {
      badge.hidden = proposals.length === 0;
      badge.textContent = String(proposals.length);
    }
    const buildCard = (p) => {
      const card = document.createElement('div');
      card.className = 'proposal-card';
      const title = document.createElement('div');
      title.className = 'proposal-title';
      title.textContent = 'Suggestion: ' + (p.aspectLabel || p.aspect);
      const why = document.createElement('div');
      why.className = 'proposal-rationale';
      why.textContent = p.rationale || '';
      const actions = document.createElement('div');
      actions.className = 'proposal-actions';
      const mk = (label, response, cls) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm ' + cls;
        b.textContent = label;
        b.addEventListener('click', () => respond(p.id, response));
        return b;
      };
      actions.appendChild(mk('Yes, apply', 'accept', 'btn-primary'));
      actions.appendChild(mk('Not now', 'declineOnce', 'btn-secondary'));
      actions.appendChild(mk("Don't suggest this", 'suppress', 'btn-secondary'));
      card.appendChild(title);
      card.appendChild(why);
      card.appendChild(actions);
      return card;
    };
    const target = proposalBanner || proposalList;
    target.textContent = '';
    if (proposalList !== target) proposalList.textContent = '';
    for (const p of proposals) target.appendChild(buildCard(p));
    if (proposalBanner) proposalBanner.hidden = proposals.length === 0;

    // --- Memories grouped by scope, plus suppressions ---
    memoryList.textContent = '';
    const memories = memResp?.memories || [];
    const suppressions = (memResp?.suppressions || []).filter(s => s.mode === 'permanent');
    if (!memories.length && !suppressions.length && !proposals.length) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = 'Nothing learned yet. As you browse and use the agent, useful preferences will appear here for your review.';
      memoryList.appendChild(empty);
      return;
    }
    const groups = new Map();
    for (const m of memories) {
      const label = scopeLabel(m.scope);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(m);
    }
    const renderItem = (parent, id, text, title) => {
      const row = document.createElement('div');
      row.className = 'memory-item';
      const span = document.createElement('span');
      span.className = 'memory-text';
      span.textContent = text;
      if (title) span.title = title;
      const del = document.createElement('button');
      del.className = 'memory-delete';
      del.textContent = '✕';
      del.title = 'Forget this';
      del.setAttribute('aria-label', 'Forget: ' + text);
      del.addEventListener('click', async () => {
        await sendMessageP({ type: 'librarianDeleteMemory', id });
        await render();
      });
      row.appendChild(span);
      row.appendChild(del);
      parent.appendChild(row);
    };
    for (const [label, items] of groups) {
      const h = document.createElement('div');
      h.className = 'memory-group-title';
      h.textContent = label;
      memoryList.appendChild(h);
      for (const m of items) {
        renderItem(memoryList, m.id, m.text,
          `Learned ${new Date(m.firstSeenAt).toLocaleDateString()} · seen ${m.occurrenceCount}×`);
      }
    }
    if (suppressions.length) {
      const h = document.createElement('div');
      h.className = 'memory-group-title';
      h.textContent = "Things you've told me not to suggest";
      memoryList.appendChild(h);
      for (const s of suppressions) {
        renderItem(memoryList, s.id,
          s.text || s.aspect,
          'Since ' + new Date(s.createdAt).toLocaleDateString() + ' — delete to allow suggestions again');
      }
    }
  }

  render();
}

// Cross-app sharing panel (Phase 3): the "what each app can see" grants list
// (revoke = one tap = local delete), the global sharing switch, and the
// acting-user selector. Grant-request / insight proposals themselves render
// through the SAME proposal cards as everything else (setupMemoryPanel) — the
// consent surface the user already knows.
function setupSharingPanel() {
  const section = document.getElementById('sharingSection');
  const grantList = document.getElementById('grantList');
  const sharingToggle = document.getElementById('sharingToggle');
  const actingInput = document.getElementById('actingUserInput');
  const actingSwitch = document.getElementById('actingUserSwitch');
  const actingStatus = document.getElementById('actingUserStatus');
  if (!section || !grantList) return;

  section.addEventListener('click', (e) => {
    if (e.target.closest('.collapsible-header')) section.classList.toggle('open');
  });

  sharingToggle?.addEventListener('change', async () => {
    await sendMessageP({ type: 'librarianSetSharingPaused', paused: !sharingToggle.checked });
  });

  async function render() {
    const [grantsResp, profResp, actingResp] = await Promise.all([
      sendMessageP({ type: 'librarianListGrants' }),
      sendMessageP({ type: 'librarianGetProfile' }),
      sendMessageP({ type: 'librarianGetActingUser' }),
    ]);
    if (sharingToggle && profResp?.profile) {
      sharingToggle.checked = !profResp.profile.sharingPaused;
    }
    if (actingStatus) {
      const id = actingResp?.actingUser?.id;
      actingStatus.textContent = id
        ? `Using this as: ${id}${actingResp.actingUser.helperMode ? ' (helper setup)' : ''}`
        : 'Using this as: default';
    }
    grantList.textContent = '';
    const grants = grantsResp?.grants || [];
    if (!grants.length) {
      const empty = document.createElement('div');
      empty.className = 'memory-empty';
      empty.textContent = 'No apps can see your profile. When an app asks, you will get a suggestion card to approve first.';
      grantList.appendChild(empty);
      return;
    }
    for (const g of grants) {
      const row = document.createElement('div');
      row.className = 'memory-item';
      const span = document.createElement('span');
      span.className = 'memory-text';
      span.textContent = `${g.appLabel || g.appId} can read: ${g.scopes.join(', ')}`;
      span.title = 'Since ' + new Date(g.grantedAt).toLocaleDateString();
      const del = document.createElement('button');
      del.className = 'memory-delete';
      del.textContent = '✕';
      del.title = 'Stop sharing with this app';
      del.setAttribute('aria-label', 'Stop sharing with ' + (g.appLabel || g.appId));
      del.addEventListener('click', async () => {
        await sendMessageP({ type: 'librarianRevokeGrant', appId: g.appId });
        await render();
      });
      row.appendChild(span);
      row.appendChild(del);
      grantList.appendChild(row);
    }
  }

  actingSwitch?.addEventListener('click', async () => {
    const raw = (actingInput?.value || '').trim();
    const resp = await sendMessageP({ type: 'librarianSetActingUser', id: raw || null });
    if (resp && resp.ok === false) {
      if (actingStatus) actingStatus.textContent = 'Names can only use letters, numbers, - and _ (max 32).';
      return;
    }
    // The whole popup reflects the new person's data — simplest honest
    // refresh is a reload (matches how profile switches re-render elsewhere).
    location.reload();
  });

  // Export/import the portable profile blob (user-mediated transport, §6b).
  const blobStatus = document.getElementById('blobStatus');
  const exportBtn = document.getElementById('exportProfileBtn');
  const importBtn = document.getElementById('importProfileBtn');
  const importFile = document.getElementById('importProfileFile');
  exportBtn?.addEventListener('click', async () => {
    const resp = await sendMessageP({ type: 'librarianExportProfileBlob' });
    if (!resp?.blob) { if (blobStatus) blobStatus.textContent = 'Could not export.'; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(resp.blob, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'accessibility-profile.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    if (blobStatus) blobStatus.textContent = 'Profile exported. Move the file to your other device or app.';
  });
  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      // The file is either a profile blob (another device/app → here) or an
      // insight OUTBOX (a consumer app like ArtInsight → here). Each insight in
      // an outbox still becomes a consent card via importInsight.
      if (parsed && parsed.kind === 'aa-insight-outbox') {
        const resp = await sendMessageP({ type: 'librarianImportInsightOutbox', outbox: parsed });
        const drafted = (resp?.results || []).filter(r => r.ok).length;
        if (blobStatus) {
          blobStatus.textContent = resp?.ok
            ? (drafted ? `${drafted} suggestion${drafted === 1 ? '' : 's'} added for your review.`
                       : 'No new suggestions to review (or that app is not allowed to share).')
            : 'That file is not a valid suggestions file.';
        }
        if (drafted) await new Promise(r => setTimeout(r, 200)); // let the badge update
      } else {
        const resp = await sendMessageP({ type: 'librarianImportProfileBlob', blob: parsed });
        if (blobStatus) {
          blobStatus.textContent = resp?.ok
            ? (resp.merged ? 'Profile imported.' : 'Your profile is already up to date.')
            : 'That file is not a valid accessibility profile.';
        }
        if (resp?.merged) location.reload();
      }
    } catch {
      if (blobStatus) blobStatus.textContent = 'That file could not be read.';
    } finally {
      importFile.value = '';
    }
  });

  render();
}

function setupAgentPanel() {
  const taskInput = document.getElementById('agentTaskInput');
  const runBtn = document.getElementById('agentRunBtn');
  const stopBtn = document.getElementById('agentStopBtn');
  const clearBtn = document.getElementById('agentClearBtn');
  const voiceBtn = document.getElementById('voicePanelBtn');
  const statusEl = document.getElementById('agentStatus');
  const logEl = document.getElementById('agentLog');
  if (!taskInput || !runBtn) return;

  // Voice panel: opens chrome's side panel and closes the popup. The
  // panel hosts the Gemini Live conversation; agent control still goes
  // through this popup. sidePanel.open requires a user gesture.
  if (voiceBtn) {
    voiceBtn.addEventListener('click', async () => {
      try {
        const win = await chrome.windows.getCurrent();
        if (chrome.sidePanel && chrome.sidePanel.open) {
          await chrome.sidePanel.open({ windowId: win.id });
        }
        window.close();
      } catch (e) {
        console.warn('Open voice panel failed:', e);
      }
    });
  }

  const saveToProfileBtn = document.getElementById('agentSaveToProfileBtn');
  const saveForm = document.getElementById('agentSaveForm');
  const actionNameInput = document.getElementById('agentActionName');
  const profileSelect = document.getElementById('agentProfileSelect');
  const saveCancelBtn = document.getElementById('agentSaveCancelBtn');
  const saveConfirmBtn = document.getElementById('agentSaveConfirmBtn');

  let lastDoneTask = null;

  function renderAgent(state) {
    const s = state || { status: 'idle', log: [] };
    statusEl.textContent = s.status || 'idle';
    statusEl.dataset.status = s.status || 'idle';

    const running = s.status === 'running';
    runBtn.hidden = running;
    stopBtn.hidden = !running;
    runBtn.disabled = running;
    taskInput.disabled = running;

    if (s.task && !taskInput.value) taskInput.value = s.task;

    if (s.status === 'done' && s.task) {
      lastDoneTask = s.task;
      saveToProfileBtn.hidden = false;
    } else if (s.status === 'running' || s.status === 'idle') {
      saveToProfileBtn.hidden = true;
      saveForm.hidden = true;
    }

    const log = s.log || [];
    if (!log.length) {
      logEl.innerHTML = '<div class="agent-log-empty">No runs yet. Type a task and press Run.</div>';
      return;
    }
    const wasAtBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
    logEl.innerHTML = '';
    for (const entry of log) {
      const row = document.createElement('div');
      row.className = 'agent-entry';
      row.dataset.kind = entry.kind || 'info';
      const tag = document.createElement('span');
      tag.className = 'agent-entry-tag';
      tag.textContent = entry.step != null ? `#${entry.step}` : (entry.kind || 'info');
      const text = document.createElement('span');
      text.className = 'agent-entry-text';
      text.textContent = entry.text || '';
      if (entry.action) {
        const small = document.createElement('small');
        small.textContent = entry.action;
        text.appendChild(small);
      }
      row.appendChild(tag);
      row.appendChild(text);
      logEl.appendChild(row);
    }
    if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  saveToProfileBtn.addEventListener('click', async () => {
    actionNameInput.value = lastDoneTask || '';
    profileSelect.innerHTML = '';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getCustomProfiles' });
      const profiles = resp?.profiles || [];
      for (const p of profiles) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.siteTypes?.length ? ' (' + p.siteTypes.join(', ') + ')' : '');
        profileSelect.appendChild(opt);
      }
      if (!profiles.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No profiles — create one first';
        opt.disabled = true;
        profileSelect.appendChild(opt);
      }
    } catch (e) {
      console.warn('Failed to load profiles:', e);
    }
    saveForm.hidden = false;
    actionNameInput.focus();
  });

  saveCancelBtn.addEventListener('click', () => {
    saveForm.hidden = true;
  });

  saveConfirmBtn.addEventListener('click', async () => {
    const profileId = profileSelect.value;
    const name = actionNameInput.value.trim();
    if (!profileId || !name) { actionNameInput.focus(); return; }

    saveConfirmBtn.disabled = true;
    saveConfirmBtn.textContent = 'Saving...';
    try {
      const action = {
        id: 'action-' + Date.now(),
        name,
        prompt: lastDoneTask,
        savedAt: Date.now(),
      };
      await chrome.runtime.sendMessage({ type: 'saveActionToProfile', profileId, action });
      saveForm.hidden = true;
      saveToProfileBtn.hidden = true;
      if (typeof loadAndRenderProfiles === 'function') loadAndRenderProfiles();
    } catch (e) {
      console.warn('Save action failed:', e);
    } finally {
      saveConfirmBtn.disabled = false;
      saveConfirmBtn.textContent = 'Save Action';
    }
  });

  // Initial render from persisted state.
  chrome.storage.local.get('bhAgent', (data) => renderAgent(data.bhAgent));

  // Live updates while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.bhAgent) return;
    renderAgent(changes.bhAgent.newValue);
  });

  function startRun() {
    const task = taskInput.value.trim();
    if (!task) {
      taskInput.focus();
      return;
    }
    const tabMode = document.getElementById('agentTabMode')?.value || 'auto';
    chrome.runtime.sendMessage({ type: 'bhAgentStart', task, tabMode }, (resp) => {
      if (chrome.runtime.lastError || (resp && resp.error)) {
        const err = (resp && resp.error) || chrome.runtime.lastError?.message || 'failed to start';
        // Surface the failure in the log even though the loop never wrote to storage.
        chrome.storage.local.get('bhAgent', (cur) => {
          const state = cur.bhAgent || { task, status: 'idle', log: [] };
          state.status = 'error';
          state.error = err;
          state.log = (state.log || []).concat({ t: Date.now(), kind: 'error', text: err });
          chrome.storage.local.set({ bhAgent: state });
        });
      }
    });
  }

  runBtn.addEventListener('click', startRun);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      startRun();
    }
  });
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'bhAgentStop' }, () => {});
  });
  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'bhAgentClear' }, () => {
      renderAgent(null);
    });
  });
}

async function sendToContent(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://'))
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  } catch (e) {}
}

async function queryToolStates() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://')) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'getToolStates' }).catch(() => null);
      if (response?.states) {
        const toolMap = { DarkMode: 'darkMode', ReaderMode: 'readerMode', FocusMode: 'focusMode',
          KeyboardNavigator: 'keyboardNav', VoiceCommands: 'voiceCommands', MotionReducer: 'motionReducer' };
        for (const [toolName, elementId] of Object.entries(toolMap)) {
          if (response.states[toolName] !== undefined) {
            const el = document.getElementById(elementId);
            if (el) el.checked = response.states[toolName];
            if (toolName === 'FocusMode' && response.states[toolName])
              document.getElementById('focusModeOptions')?.classList.add('show');
          }
        }
      }
    }
  } catch (e) {}
}

async function queryStats() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://')) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'getStats' }).catch(() => null);
      if (response?.success) updateFixesPanel(response.stats, response.fixes || []);
    }
  } catch (e) {}
}

function updateFixesPanel(stats, fixes) {
  const panel = document.getElementById('fixesPanel');
  if (!panel || !stats) return;

  const summary = panel.querySelector('.fixes-summary');
  const body = panel.querySelector('.fixes-body');
  const list = panel.querySelector('.fixes-list');
  if (!summary || !body || !list) return;

  const total = (stats.wcag || 0) + (stats.images || 0) + (stats.labels || 0) + (stats.text || 0) + (stats.captions || 0);
  if (total === 0) { panel.style.display = 'none'; return; }

  const parts = [];
  if (stats.wcag) parts.push(`${stats.wcag} WCAG`);
  if (stats.images) parts.push(`${stats.images} images`);
  if (stats.labels) parts.push(`${stats.labels} labels`);
  if (stats.text) parts.push(`${stats.text} text`);
  if (stats.captions) parts.push(`${stats.captions} captions`);

  summary.innerHTML = `<strong>${total} issues fixed</strong> <span>(${parts.join(', ')})</span>`;
  panel.style.display = 'block';

  if (!fixes || !Array.isArray(fixes)) fixes = [];
  list.innerHTML = fixes.map(fix => `
    <div class="fix-item">
      <span class="fix-type">${escapeHtml(fix.type)} · ${escapeHtml(fix.element)}</span>
      <span class="fix-old">${escapeHtml(fix.old)}</span>
      <span class="fix-new">${escapeHtml(fix.new)}</span>
    </div>
  `).join('');

  const header = document.getElementById('fixesHeader');
  if (header && !header._bound) {
    header._bound = true;
    const togglePanel = () => {
      panel.classList.toggle('expanded');
      const isExpanded = panel.classList.contains('expanded');
      body.style.display = isExpanded ? 'block' : 'none';
      header.setAttribute('aria-expanded', isExpanded);
    };
    header.addEventListener('click', togglePanel);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
    });
  }
}

// ----- Custom skills panel ------------------------------------------------
// Renders the Custom Skills section with a per-skill enable toggle and an
// inline two-click delete button. Custom skills are user-authored JS blobs
// registered by the background as user scripts; toggling here saves the
// skill back with `enabled: false/true` and the background's storage
// listener (un)registers the user script accordingly.
function renderCustomSkillsList() {
  chrome.runtime.sendMessage({ type: 'getActiveSkills' }, (resp) => {
    const customSkills = (resp && resp.customSkills) || [];
    const customSection = document.getElementById('customSection');
    const customList = document.getElementById('customList');
    const customCountEl = document.getElementById('customCount');
    if (!customSection || !customList) return;

    if (customSkills.length === 0) {
      customSection.hidden = true;
      return;
    }

    customSection.hidden = false;
    if (customCountEl) customCountEl.textContent = String(customSkills.length);
    customList.innerHTML = '';
    for (const skill of customSkills) {
      customList.appendChild(createCustomSkillRow(skill));
    }
  });
}

function createCustomSkillRow(skill) {
  const row = document.createElement('div');
  row.className = 'tool';

  const icon = document.createElement('span');
  icon.className = 'tool-icon';
  icon.style.fontSize = '14px';
  icon.textContent = '✨';

  const name = document.createElement('span');
  name.className = 'tool-name';
  name.textContent = skill.name || skill.id;

  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(createCustomToggle(skill));
  row.appendChild(createCustomDeleteButton(skill));
  return row;
}

function createCustomToggle(skill) {
  const enabled = skill.enabled !== false;
  const wrapper = document.createElement('label');
  wrapper.className = 'switch small';
  wrapper.title = enabled ? 'Disable adapter' : 'Enable adapter';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabled;
  input.setAttribute('aria-label',
    `${enabled ? 'Disable' : 'Enable'} adapter: ${skill.name || skill.id}`);

  const track = document.createElement('span');
  track.className = 'switch-track';

  wrapper.appendChild(input);
  wrapper.appendChild(track);

  input.addEventListener('change', () => {
    const updated = {
      ...skill,
      enabled: input.checked,
      updatedAt: new Date().toISOString(),
    };
    chrome.runtime.sendMessage({ type: 'saveCustomSkill', skill: updated }, () => {
      wrapper.title = input.checked ? 'Disable adapter' : 'Enable adapter';
      input.setAttribute('aria-label',
        `${input.checked ? 'Disable' : 'Enable'} adapter: ${skill.name || skill.id}`);
    });
  });
  return wrapper;
}

function createCustomDeleteButton(skill) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skill-delete';
  btn.textContent = '✕';
  btn.title = 'Delete adapter';
  btn.setAttribute('aria-label', `Delete adapter: ${skill.name || skill.id}`);

  let confirmTimer = null;
  btn.addEventListener('click', () => {
    if (btn.dataset.confirming === '1') {
      clearTimeout(confirmTimer);
      btn.disabled = true;
      btn.textContent = '…';
      chrome.runtime.sendMessage(
        { type: 'deleteCustomSkill', skillId: skill.id },
        () => renderCustomSkillsList()
      );
      return;
    }
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm?';
    btn.setAttribute('aria-label', `Confirm delete: ${skill.name || skill.id}`);
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      btn.dataset.confirming = '';
      btn.textContent = '✕';
      btn.setAttribute('aria-label', `Delete adapter: ${skill.name || skill.id}`);
    }, 4000);
  });
  return btn;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
