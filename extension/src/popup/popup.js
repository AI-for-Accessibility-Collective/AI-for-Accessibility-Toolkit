/**
 * AI for Accessibility - Popup Controller
 * Flat UI with inline controls
 *
 * Bundled by extension/src/build.js → popup.bundle.js.
 * Profile presets come from the shared profiles module (tools/profiles/),
 * so the popup, content script, and CLI all read the same data.
 */

import { mergeProfileTools } from '../../../tools/profiles/settings.js';

// Safe element setters
function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = value;
}
function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

// Listen for live updates from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'fixAdded') {
    updateFixesPanel(message.stats, message.fixes);
  }
  if (message.type === 'statusUpdate') {
    updateStatus(message.status);
  }
  if (message.type === 'scanProgress') {
    updateScanProgress(message.progress, message.phase);
  }
});

// Storage keys whose UI control has a different element id
const KEY_TO_ELEMENT = { colorFilter: 'colorBlindMode' };

// Sync settings changes from other sources (e.g., content script)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    const el = document.getElementById(KEY_TO_ELEMENT[key] || key);
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

function updateScanProgress(progress, phase) {
  const scanBtn = document.getElementById('scanPage');
  if (scanBtn && progress < 100) {
    scanBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">sync</span> ${phase || 'Scanning'}...`;
    scanBtn.disabled = true;
  } else if (scanBtn) {
    scanBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">refresh</span> Rescan`;
    scanBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.sync.get([
    'enabled', 'autoWcagFix', 'autoDescribe', 'autoSimplify', 'autoSummarize', 'autoFixLabels', 'autoCaptions', 'autoVideoDescribe',
    'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands', 'motionReducer', 'focusMode',
    'hideDistractions', 'showProgress', 'colorFilter', 'colorBlindMode',
    'fontScale', 'lineHeight', 'letterSpacing', 'contrastMode',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'speechRate',
    'geminiKey', 'falKey'
  ]);

  // Cache DOM elements
  const fontScale = document.getElementById('fontScale');
  const fontScaleValue = document.getElementById('fontScaleValue');
  const lineHeight = document.getElementById('lineHeight');
  const lineHeightValue = document.getElementById('lineHeightValue');
  const letterSpacing = document.getElementById('letterSpacing');
  const letterSpacingValue = document.getElementById('letterSpacingValue');
  const focusMode = document.getElementById('focusMode');
  const focusOptions = document.getElementById('focusModeOptions');

  // Initialize main toggle
  const mainToggle = document.getElementById('mainToggle');
  mainToggle.checked = settings.enabled !== false;

  mainToggle.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ enabled: e.target.checked });
    sendToContent({ type: 'setEnabled', enabled: e.target.checked });
  });

  // AI feature toggles - load from storage
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
      el.checked = defaultVal ? settings[id] !== false : settings[id] === true;
      el.addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ [id]: e.target.checked });
        sendToContent({ type: 'settingsChanged', settings: { [id]: e.target.checked } });
      });
    }
  });

  // Simple tool toggles - load from storage and save on change
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
        if (e.target.checked) {
          sendToContent({ type: 'enableTool', tool: toolName });
        } else {
          sendToContent({ type: 'disableTool', tool: toolName });
        }
      });
    }
  });

  // Focus Mode with inline options - load from storage
  focusMode.checked = settings.focusMode === true;
  if (settings.focusMode) {
    focusOptions.classList.add('show');
  }
  ['hideDistractions', 'showProgress'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[id] === true;
  });

  focusMode.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ focusMode: e.target.checked });
    focusOptions.classList.toggle('show', e.target.checked);
    if (e.target.checked) {
      sendFocusModeUpdate();
    } else {
      sendToContent({ type: 'disableTool', tool: 'FocusMode' });
    }
  });

  // Focus mode sub-options - save to storage
  ['hideDistractions', 'showProgress'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
      if (focusMode.checked) {
        sendFocusModeUpdate();
      }
    });
  });

  function sendFocusModeUpdate() {
    sendToContent({
      type: 'enableTool',
      tool: 'FocusMode',
      options: {
        hideDistractions: document.getElementById('hideDistractions').checked,
        showProgress: document.getElementById('showProgress').checked
      }
    });
  }

  // Color filter - load from storage (canonical key: colorFilter;
  // colorBlindMode read as legacy fallback)
  const colorBlindEl = document.getElementById('colorBlindMode');
  const savedColorFilter = settings.colorFilter || settings.colorBlindMode;
  if (savedColorFilter) {
    colorBlindEl.value = savedColorFilter;
  }

  colorBlindEl.addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ colorFilter: e.target.value });
    if (e.target.value === 'none') {
      sendToContent({ type: 'disableTool', tool: 'ColorBlindMode' });
    } else {
      sendToContent({ type: 'enableTool', tool: 'ColorBlindMode', options: e.target.value });
    }
  });

  // Load Visual Assist settings from storage
  if (settings.fontScale !== undefined) {
    fontScale.value = settings.fontScale;
    fontScaleValue.textContent = settings.fontScale + '%';
  }
  if (settings.lineHeight !== undefined) {
    lineHeight.value = settings.lineHeight;
    lineHeightValue.textContent = parseFloat(settings.lineHeight).toFixed(1);
  }
  if (settings.letterSpacing !== undefined) {
    letterSpacing.value = settings.letterSpacing;
    letterSpacingValue.textContent = parseFloat(settings.letterSpacing).toFixed(2) + 'em';
  }
  if (settings.contrastMode) {
    document.getElementById('contrastMode').value = settings.contrastMode;
  }
  ['dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[id] === true;
  });
  if (settings.speechRate !== undefined) {
    document.getElementById('speechRate').value = settings.speechRate;
  }

  // Slider live updates
  fontScale.addEventListener('input', () => {
    fontScaleValue.textContent = fontScale.value + '%';
  });

  lineHeight.addEventListener('input', () => {
    lineHeightValue.textContent = parseFloat(lineHeight.value).toFixed(1);
  });

  letterSpacing.addEventListener('input', () => {
    letterSpacingValue.textContent = parseFloat(letterSpacing.value).toFixed(2) + 'em';
  });

  // Visual Assist controls - apply on any change and save to storage
  const visualAssistControls = [
    'contrastMode', 'fontScale', 'lineHeight', 'letterSpacing',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'
  ];

  visualAssistControls.forEach(id => {
    const el = document.getElementById(id);
    // Use 'input' for sliders (real-time), 'change' for selects/checkboxes
    const eventType = el?.type === 'range' ? 'input' : 'change';
    el?.addEventListener(eventType, async () => {
      // Save to storage
      if (el.type === 'checkbox') {
        await chrome.storage.sync.set({ [id]: el.checked });
      } else if (el.type === 'range') {
        await chrome.storage.sync.set({ [id]: parseFloat(el.value) });
      } else {
        await chrome.storage.sync.set({ [id]: el.value });
      }
      applyVisualAssist();
    });
  });

  // Speech rate persistence
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
                       options.fontScale !== 1 ||
                       options.lineHeight !== 1.5 ||
                       options.letterSpacing !== 0 ||
                       options.dyslexiaFont ||
                       options.largeCursor ||
                       options.enhanceFocus ||
                       options.readingGuide;

    if (hasChanges) {
      sendToContent({ type: 'enableTool', tool: 'VisualAssist', options });
    } else {
      sendToContent({ type: 'disableTool', tool: 'VisualAssist' });
    }
  }

  // Read Aloud - simple toggle based on button state
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

  // Multi-profile selection with checkboxes
  const profileCheckboxes = document.querySelectorAll('.profile-checkbox input');
  const profileCountEl = document.getElementById('profileCount');

  // Load saved profiles (with migration from old single-profile format)
  chrome.storage.sync.get(['selectedProfiles', 'selectedProfile'], async (result) => {
    let savedProfiles = result.selectedProfiles || [];

    // Migrate from old single-profile format
    if (savedProfiles.length === 0 && result.selectedProfile && result.selectedProfile !== 'none') {
      savedProfiles = [result.selectedProfile];
      await chrome.storage.sync.set({ selectedProfiles: savedProfiles });
      await chrome.storage.sync.remove('selectedProfile');
    }

    profileCheckboxes.forEach(cb => {
      cb.checked = savedProfiles.includes(cb.value);
    });
    updateProfileCount(savedProfiles.length);

    // Apply profiles on popup open (ensures consistency)
    if (savedProfiles.length > 0) {
      const merged = mergePresets(savedProfiles);
      applyPreset(merged);
    }
  });

  function updateProfileCount(count) {
    profileCountEl.textContent = count > 0 ? `${count} selected` : '';
  }

  function getSelectedProfiles() {
    return Array.from(profileCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
  }

  // Merging lives in the shared profiles module so the popup, content
  // script, and CLI can never disagree about what a profile enables.
  const mergePresets = mergeProfileTools;

  profileCheckboxes.forEach(cb => {
    cb.addEventListener('change', async () => {
      const selectedProfiles = getSelectedProfiles();
      await chrome.storage.sync.set({ selectedProfiles });
      updateProfileCount(selectedProfiles.length);

      if (selectedProfiles.length === 0) {
        await resetAll();
      } else {
        await resetAllUI(true);
        sendToContent({ type: 'revertAll' });
        const merged = mergePresets(selectedProfiles);
        applyPreset(merged);
      }
    });
  });

  async function resetAllUI(preserveProfile = false) {
    // Reset all toggles to off (including AI tools)
    const togglesOff = ['darkMode', 'readerMode', 'focusMode', 'keyboardNav', 'voiceCommands', 'motionReducer',
     'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'autoCaptions', 'autoVideoDescribe',
     'hideDistractions', 'autoSimplify', 'autoSummarize'];

    togglesOff.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });

    // These default to ON
    const togglesOn = ['showProgress', 'autoDescribe', 'autoWcagFix', 'autoFixLabels'];
    togglesOn.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });

    // Reset selects
    setValue('contrastMode', 'none');
    setValue('colorBlindMode', 'none');
    setValue('speechRate', '1');

    // Reset sliders
    if (fontScale) {
      fontScale.value = 100;
      fontScaleValue.textContent = '100%';
    }
    if (lineHeight) {
      lineHeight.value = 1.5;
      lineHeightValue.textContent = '1.5';
    }
    if (letterSpacing) {
      letterSpacing.value = 0;
      letterSpacingValue.textContent = '0.00em';
    }

    // Hide focus options
    if (focusOptions) focusOptions.classList.remove('show');

    // Reset profile checkboxes (unless preserving for profile switch)
    if (!preserveProfile) {
      profileCheckboxes.forEach(cb => cb.checked = false);
      updateProfileCount(0);
    }

    // Save all reset values to storage
    const storageReset = {};
    togglesOff.forEach(id => storageReset[id] = false);
    togglesOn.forEach(id => storageReset[id] = true);
    storageReset.contrastMode = 'none';
    storageReset.colorFilter = 'none';
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
    // Visual settings
    if (preset.fontScale) {
      fontScale.value = preset.fontScale;
      fontScaleValue.textContent = preset.fontScale + '%';
    }
    if (preset.lineHeight) {
      lineHeight.value = preset.lineHeight;
      lineHeightValue.textContent = preset.lineHeight.toFixed(1);
    }
    if (preset.letterSpacing) {
      letterSpacing.value = preset.letterSpacing;
      letterSpacingValue.textContent = preset.letterSpacing.toFixed(2) + 'em';
    }
    if (preset.contrastMode) setValue('contrastMode', preset.contrastMode);
    if (preset.dyslexiaFont) setChecked('dyslexiaFont', true);
    if (preset.largeCursor) setChecked('largeCursor', true);
    if (preset.enhanceFocus) setChecked('enhanceFocus', true);
    if (preset.readingGuide) setChecked('readingGuide', true);

    // Tool toggles
    if (preset.darkMode) {
      setChecked('darkMode', true);
      sendToContent({ type: 'enableTool', tool: 'DarkMode' });
    }
    if (preset.motionReducer) {
      setChecked('motionReducer', true);
      sendToContent({ type: 'enableTool', tool: 'MotionReducer' });
    }
    if (preset.readerMode) {
      setChecked('readerMode', true);
      sendToContent({ type: 'enableTool', tool: 'ReaderMode' });
    }
    if (preset.keyboardNav) {
      setChecked('keyboardNav', true);
      sendToContent({ type: 'enableTool', tool: 'KeyboardNavigator' });
    }
    if (preset.voiceCommands) {
      setChecked('voiceCommands', true);
      sendToContent({ type: 'enableTool', tool: 'VoiceCommands' });
    }
    if (preset.autoCaptions) {
      setChecked('autoCaptions', true);
      chrome.storage.sync.set({ autoCaptions: true });
      sendToContent({ type: 'enableTool', tool: 'AutoTranscriber' });
    }

    // Focus mode with sub-options
    if (preset.focusMode) {
      setChecked('focusMode', true);
      focusOptions.classList.add('show');
      if (preset.hideDistractions) setChecked('hideDistractions', true);
      setChecked('showProgress', preset.showProgress !== false);
      sendFocusModeUpdate();
    }

    // Color filter
    if (preset.colorFilter && preset.colorFilter !== 'none') {
      setValue('colorBlindMode', preset.colorFilter);
      chrome.storage.sync.set({ colorFilter: preset.colorFilter });
      sendToContent({ type: 'enableTool', tool: 'ColorBlindMode', options: preset.colorFilter });
    }

    // AI settings
    if (preset.autoWcagFix !== undefined) {
      document.getElementById('autoWcagFix').checked = preset.autoWcagFix;
      chrome.storage.sync.set({ autoWcagFix: preset.autoWcagFix });
      sendToContent({ type: 'settingsChanged', settings: { autoWcagFix: preset.autoWcagFix } });
    }
    if (preset.autoFixLabels !== undefined) {
      document.getElementById('autoFixLabels').checked = preset.autoFixLabels;
      chrome.storage.sync.set({ autoFixLabels: preset.autoFixLabels });
      sendToContent({ type: 'settingsChanged', settings: { autoFixLabels: preset.autoFixLabels } });
    }
    if (preset.autoDescribe !== undefined) {
      document.getElementById('autoDescribe').checked = preset.autoDescribe;
      chrome.storage.sync.set({ autoDescribe: preset.autoDescribe });
      sendToContent({ type: 'settingsChanged', settings: { autoDescribe: preset.autoDescribe } });
    }
    if (preset.autoVideoDescribe !== undefined) {
      document.getElementById('autoVideoDescribe').checked = preset.autoVideoDescribe;
      chrome.storage.sync.set({ autoVideoDescribe: preset.autoVideoDescribe });
      sendToContent({ type: 'settingsChanged', settings: { autoVideoDescribe: preset.autoVideoDescribe } });
    }
    if (preset.autoSimplify) {
      document.getElementById('autoSimplify').checked = true;
      chrome.storage.sync.set({ autoSimplify: true });
      sendToContent({ type: 'settingsChanged', settings: { autoSimplify: true } });
    }
    if (preset.autoSummarize) {
      document.getElementById('autoSummarize').checked = true;
      chrome.storage.sync.set({ autoSummarize: true });
      sendToContent({ type: 'settingsChanged', settings: { autoSummarize: true } });
    }
    if (preset.autoCaptions === false) {
      document.getElementById('autoCaptions').checked = false;
      chrome.storage.sync.set({ autoCaptions: false });
    }

    // Apply visual assist if any visual settings changed
    if (preset.fontScale || preset.lineHeight || preset.letterSpacing || preset.contrastMode ||
        preset.dyslexiaFont || preset.largeCursor || preset.enhanceFocus || preset.readingGuide) {
      // Save all visual settings to storage for persistence across pages
      const visualStorage = {
        fontScale: preset.fontScale || 100,
        lineHeight: preset.lineHeight || 1.5,
        letterSpacing: preset.letterSpacing || 0,
        contrastMode: preset.contrastMode || 'none',
        dyslexiaFont: preset.dyslexiaFont || false,
        largeCursor: preset.largeCursor || false,
        enhanceFocus: preset.enhanceFocus || false,
        readingGuide: preset.readingGuide || false
      };
      chrome.storage.sync.set(visualStorage);
      applyVisualAssist();
    }

    // Save tool toggle states for persistence
    const toolStorage = {};
    if (preset.darkMode !== undefined) toolStorage.darkMode = preset.darkMode;
    if (preset.motionReducer !== undefined) toolStorage.motionReducer = preset.motionReducer;
    if (preset.readerMode !== undefined) toolStorage.readerMode = preset.readerMode;
    if (preset.keyboardNav !== undefined) toolStorage.keyboardNav = preset.keyboardNav;
    if (preset.voiceCommands !== undefined) toolStorage.voiceCommands = preset.voiceCommands;
    if (preset.focusMode !== undefined) toolStorage.focusMode = preset.focusMode;
    if (preset.hideDistractions !== undefined) toolStorage.hideDistractions = preset.hideDistractions;
    if (preset.showProgress !== undefined) toolStorage.showProgress = preset.showProgress;
    if (Object.keys(toolStorage).length > 0) {
      chrome.storage.sync.set(toolStorage);
    }
  }

  // Reset all
  document.getElementById('resetAll').addEventListener('click', resetAll);

  async function resetAll() {
    await resetAllUI();
    sendToContent({ type: 'revertAll' });
  }

  // API Keys collapsible
  document.getElementById('apiKeysSection').addEventListener('click', (e) => {
    if (e.target.closest('.collapsible-header')) {
      document.getElementById('apiKeysSection').classList.toggle('open');
    }
  });

  // Load API keys
  document.getElementById('geminiKey').value = settings.geminiKey || '';
  document.getElementById('falKey').value = settings.falKey || '';

  document.getElementById('saveKeys').addEventListener('click', async () => {
    const geminiKey = document.getElementById('geminiKey').value.trim();
    const falKey = document.getElementById('falKey').value.trim();
    await chrome.storage.sync.set({ geminiKey, falKey });

    const btn = document.getElementById('saveKeys');
    btn.textContent = 'Saved!';
    btn.classList.add('success');
    setTimeout(() => {
      btn.textContent = 'Save Keys';
      btn.classList.remove('success');
    }, 1500);
  });

  // Scan page
  document.getElementById('scanPage').addEventListener('click', () => {
    sendToContent({ type: 'rescan' });
  });

  // Collapsible sections
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.section').classList.toggle('collapsed');
    });
  });

  // Query current states from content script
  queryToolStates();
  queryStats();
});

async function sendToContent(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://')) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (e) {}
}

async function queryToolStates() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://')) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'getToolStates' }).catch(() => null);
      if (response?.states) {
        updateUIFromStates(response.states);
      }
    }
  } catch (e) {}
}

function updateUIFromStates(states) {
  const toolMap = {
    DarkMode: 'darkMode',
    ReaderMode: 'readerMode',
    FocusMode: 'focusMode',
    KeyboardNavigator: 'keyboardNav',
    VoiceCommands: 'voiceCommands',
    MotionReducer: 'motionReducer',
    AutoTranscriber: 'autoCaptions'
  };

  for (const [toolName, elementId] of Object.entries(toolMap)) {
    if (states[toolName] !== undefined) {
      const el = document.getElementById(elementId);
      if (el) el.checked = states[toolName];

      // Show focus options if focus mode is on
      if (toolName === 'FocusMode' && states[toolName]) {
        document.getElementById('focusModeOptions')?.classList.add('show');
      }
    }
  }
}

async function queryStats() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !tab.url?.startsWith('chrome://')) {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'getStats' }).catch(() => null);
      if (response?.success) {
        updateFixesPanel(response.stats, response.fixes || []);
      }
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
  if (total === 0) {
    panel.style.display = 'none';
    return;
  }

  const parts = [];
  if (stats.wcag) parts.push(`${stats.wcag} WCAG`);
  if (stats.images) parts.push(`${stats.images} images`);
  if (stats.labels) parts.push(`${stats.labels} labels`);
  if (stats.text) parts.push(`${stats.text} text`);
  if (stats.captions) parts.push(`${stats.captions} captions`);

  summary.innerHTML = `<strong>${total} issues fixed</strong> <span>(${parts.join(', ')})</span>`;
  panel.style.display = 'block';

  // Build fix list
  if (!fixes || !Array.isArray(fixes)) fixes = [];
  list.innerHTML = fixes.map(fix => `
    <div class="fix-item">
      <span class="fix-type">${escapeHtml(fix.type)} · ${escapeHtml(fix.element)}</span>
      <span class="fix-old">${escapeHtml(fix.old)}</span>
      <span class="fix-new">${escapeHtml(fix.new)}</span>
    </div>
  `).join('');

  // Toggle expand
  const header = document.getElementById('fixesHeader');
  if (header) {
    const togglePanel = () => {
      panel.classList.toggle('expanded');
      const isExpanded = panel.classList.contains('expanded');
      body.style.display = isExpanded ? 'block' : 'none';
      header.setAttribute('aria-expanded', isExpanded);
    };
    header.onclick = togglePanel;
    header.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    };
    // Make it look and behave like a button
    header.style.cursor = 'pointer';
    header.setAttribute('tabindex', '0');
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', 'fixesBody');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
