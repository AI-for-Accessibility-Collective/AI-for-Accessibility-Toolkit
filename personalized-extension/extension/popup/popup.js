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

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get([
    'enabled', 'autoWcagFix', 'autoDescribe', 'autoSimplify', 'autoSummarize',
    'autoFixLabels', 'autoCaptions', 'autoVideoDescribe',
    'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands', 'motionReducer', 'focusMode',
    'hideDistractions', 'showProgress', 'colorBlindMode',
    'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'speechRate',
    'geminiKey', 'selectedProfiles', 'onboardingComplete', 'nudgeDismissed'
  ]);

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
      if (el.type === 'checkbox') await chrome.storage.sync.set({ [id]: el.checked });
      else if (el.type === 'range') await chrome.storage.sync.set({ [id]: parseFloat(el.value) });
      else await chrome.storage.sync.set({ [id]: el.value });
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

  function showAISuggestions(result) {
    document.getElementById('aiSuggestionSummary').textContent = result.summary || 'Here are my suggestions:';
    const listEl = document.getElementById('aiSuggestionList');
    listEl.innerHTML = '';

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
      divider.textContent = 'These needs require a custom skill:';
      listEl.appendChild(divider);

      for (const skill of result.newSkills) {
        const item = document.createElement('div');
        item.className = 'ai-suggestion-item ai-new-skill';
        item.innerHTML = `<span class="setting-name">${escapeHtml(skill.name)}</span><span class="setting-reason">${escapeHtml(skill.description)}</span>`;
        listEl.appendChild(item);
      }

      const buildBtn = document.createElement('button');
      buildBtn.className = 'btn btn-primary btn-sm ai-build-skill-btn';
      buildBtn.style.marginTop = '6px';
      buildBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">build</span> Open Skill Builder';
      listEl.appendChild(buildBtn);
    }

    aiSuggestion.hidden = false;
  }

  document.getElementById('aiApplyBtn').addEventListener('click', () => {
    if (pendingAISuggestion?.settings) {
      applyPreset(pendingAISuggestion.settings);
      aiSuggestion.hidden = true;
      aiInput.value = '';
    }
  });

  document.getElementById('aiSaveProfileBtn').addEventListener('click', () => {
    if (pendingAISuggestion?.settings) {
      applyPreset(pendingAISuggestion.settings);
      aiSuggestion.hidden = true;
      aiInput.value = '';
      openSaveProfileModal();
    }
  });

  document.getElementById('aiDismissBtn').addEventListener('click', () => {
    aiSuggestion.hidden = true;
    pendingAISuggestion = null;
  });

  document.getElementById('aiSuggestionList').addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-build-skill-btn');
    if (!btn) return;
    const skills = pendingAISuggestion?.newSkills || [];
    if (pendingAISuggestion?.settings && Object.keys(pendingAISuggestion.settings).length > 0) {
      applyPreset(pendingAISuggestion.settings);
    }
    aiSuggestion.hidden = true;
    aiInput.value = '';
    chrome.runtime.sendMessage({ type: 'openSkillBuilder', pendingSkills: skills });
    window.close();
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
    }
  }

  loadAndRenderProfiles();

  // Load custom skills (with on/off toggles and delete buttons).
  renderCustomSkillsList();

  // Query states from content
  queryToolStates();
  queryStats();
});

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
  wrapper.title = enabled ? 'Disable skill' : 'Enable skill';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabled;
  input.setAttribute('aria-label',
    `${enabled ? 'Disable' : 'Enable'} skill: ${skill.name || skill.id}`);

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
      wrapper.title = input.checked ? 'Disable skill' : 'Enable skill';
      input.setAttribute('aria-label',
        `${input.checked ? 'Disable' : 'Enable'} skill: ${skill.name || skill.id}`);
    });
  });
  return wrapper;
}

function createCustomDeleteButton(skill) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skill-delete';
  btn.textContent = '✕';
  btn.title = 'Delete skill';
  btn.setAttribute('aria-label', `Delete skill: ${skill.name || skill.id}`);

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
      btn.setAttribute('aria-label', `Delete skill: ${skill.name || skill.id}`);
    }, 4000);
  });
  return btn;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
