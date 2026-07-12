import { setAIProvider, createChromeAIProvider, setAnnounceSuppressed, isAIConfigured, announce } from '../../utils/ai.js';
import { clearMarks } from '../../utils/dom.js';
import { scrollBy, scrollToTop, scrollToBottom, goBack, goForward, clickByText, focusNextLink, focusPrevLink, focusNextButton, typeText, readPage, stopReading } from '../../skills/builtin/page-actions.js';
import { watchSystemPrefs } from '../../utils/system-prefs.js';
import { DarkMode } from '../../skills/builtin/dark-mode.js';
import { FocusMode } from '../../skills/builtin/focus-mode.js';
import { VisualAssist } from '../../skills/builtin/visual-assist.js';
import { MotionReducer } from '../../skills/builtin/motion-reducer.js';
import { ReaderMode } from '../../skills/builtin/reader-mode.js';
import { ColorFilter } from '../../skills/builtin/color-filter.js';
import { KeyboardNav } from '../../skills/builtin/keyboard-nav.js';
import { AutoAltText } from '../../skills/builtin/auto-alt-text.js';
import { FixContrast } from '../../skills/builtin/fix-contrast.js';
import { SimplifyText } from '../../skills/builtin/simplify-text.js';
import { Captions } from '../../skills/builtin/captions.js';
import { VoiceCommands } from '../../skills/builtin/voice-commands.js';
import { ReadAloud } from '../../skills/builtin/read-aloud.js';
import { GenerateLabels } from '../../skills/builtin/generate-labels.js';
import { WcagFixes, axeHandlers as wcagAxeHandlers, RISKY_AXE_RULES } from '../../skills/builtin/wcag-fixes.js';
import { axeHandlers as contrastAxeHandlers } from '../../skills/builtin/fix-contrast.js';
import { axeHandlers as altTextAxeHandlers } from '../../skills/builtin/auto-alt-text.js';
import { axeHandlers as labelsAxeHandlers } from '../../skills/builtin/generate-labels.js';
import { axeHandlers as captionsAxeHandlers } from '../../skills/builtin/captions.js';

setAIProvider(createChromeAIProvider());

const TOOL_MAP = {
  DarkMode,
  FocusMode,
  VisualAssist,
  MotionReducer,
  ReaderMode,
  ColorBlindMode: ColorFilter,
  KeyboardNavigator: KeyboardNav,
  VoiceCommands,
  ReadAloud,
};

const AI_TOOL_MAP = {
  fixContrast: FixContrast,
  autoWcagFix: WcagFixes,
  autoFixLabels: GenerateLabels,
  autoDescribe: AutoAltText,
  autoCaptions: Captions,
  autoSimplify: SimplifyText,
  autoSummarize: SimplifyText,
};

let enabledTools = new Set();
let aiSettings = {};
let extensionEnabled = true;

// OS-signal auto-activation state.
// _osAutoMotion: MotionReducer auto-enabled by OS signal (Wave 1b).
// _osAutoDark: DarkMode auto-enabled by OS prefers-color-scheme:dark (Phase 3).
// Neither is written to storage — auto-activation never overrides explicit choice.
let _osAutoMotion = false;
let _osAutoDark = false;

// AI-configured cache: checked once per page load via the background aiStatus
// probe so we avoid per-element round-trips when no API key is set.
// null = not yet checked; true/false = cached result.
let _aiConfigured = null;

const stats = { wcag: 0, images: 0, labels: 0, text: 0, captions: 0 };
const fixes = [];

// ---------------------------------------------------------------------------
// Combined axe handler map (all builtin modules)
// ---------------------------------------------------------------------------
// Merged at init so __ai4a11yAxeDispatch can route any axe violation.id to the
// right fixer. Module-level maps are static; override order: wcag < contrast <
// alt-text < labels < captions (later wins if rule IDs overlap — none do).
const _combinedAxeHandlers = Object.assign(
  {},
  wcagAxeHandlers,
  contrastAxeHandlers,
  altTextAxeHandlers,
  labelsAxeHandlers,
  captionsAxeHandlers  // video-caption, audio-caption handlers from captions.js
);

// reportFix signature: (type, selector, oldVal, newVal, inverseDescriptor?)
// inverseDescriptor: { selector, attr, prior } | { selector, style } | null
function reportFix(type, elementOrSelector, oldVal, newVal, inverseDescriptor) {
  if (type === 'wcag') stats.wcag++;
  else if (type === 'image') stats.images++;
  else if (type === 'label') stats.labels++;
  else if (type === 'text') stats.text++;
  else if (type === 'caption') stats.captions++;
  const entry = {
    type,
    element: (typeof elementOrSelector === 'string' ? elementOrSelector : '') || '',
    old: oldVal || '',
    new: newVal || '',
    _descriptor: inverseDescriptor || null,
  };
  fixes.push(entry);
  // Send a serializable copy (omit _descriptor from the panel message — popup
  // will receive it separately via the fixIndex).
  chrome.runtime.sendMessage({
    type: 'fixAdded',
    stats: { ...stats },
    fixes: fixes.map((f, i) => ({
      type: f.type, element: f.element, old: f.old, new: f.new,
      fixIndex: i,
      revertable: !!(f._descriptor),
    }))
  }).catch(() => {});
}

// Assign the audit-trail hooks before any builtin module runs its enable().
// Builtins now use call-time lookups so this assignment is always in time.
globalThis.ai4a11yLogFix = reportFix;
globalThis.ai4a11yIncrementStat = (type) => {
  if (type === 'wcag') stats.wcag++;
  else if (type === 'image') stats.images++;
  else if (type === 'label') stats.labels++;
  else if (type === 'text') stats.text++;
  else if (type === 'caption') stats.captions++;
};

// ---------------------------------------------------------------------------
// Axe bridge dispatch global
// ---------------------------------------------------------------------------
// Published so the SW-injected axe runner can call it after `axe.run()`.
// Per-node dedup via namespaced marks ('wcag') prevents double-fixing.
// Risky-tier rules are gated on the wcagRiskyFixes session flag.
let _axeRiskyEnabled = false;

// Populated once by initFromStorage / applyAISettings — lets __ai4a11yAxeDispatch
// apply the risky gate consistently for the lifetime of this content script.
// Exposed on the global so the axe runner (injected after init) reads it.
window.__ai4a11yAxeDispatch = async function(violations) {
  if (!Array.isArray(violations)) return;
  for (const violation of violations) {
    const handler = _combinedAxeHandlers[violation.id];
    if (!handler) continue;
    // Gate risky-tier rules
    if (RISKY_AXE_RULES.has(violation.id) && !_axeRiskyEnabled) continue;
    for (const node of (violation.nodes || [])) {
      // node.target is an array of CSS selectors (axe format)
      for (const sel of (node.target || [])) {
        try {
          const el = document.querySelector(sel);
          if (!el) continue;
          await handler(el);
        } catch (e) {
          console.warn('[AI4A11y] axe handler error for', violation.id, e);
        }
      }
    }
  }
};

function enableTool(toolName, options) {
  const tool = TOOL_MAP[toolName];
  if (!tool) return;

  if (enabledTools.has(toolName) && tool.disable) {
    tool.disable();
  }

  try {
    let result;
    if (options !== undefined) {
      result = tool.enable(options);
    } else {
      result = tool.enable();
    }
    // If enable() explicitly returns false the tool failed to start — do NOT
    // phantom-add it to enabledTools (e.g. reader-mode extraction failure).
    if (result === false) {
      return { ok: false, reason: 'enable-failed' };
    }
    enabledTools.add(toolName);
    console.log(`[AI4A11y] Enabled ${toolName}`);
  } catch (e) {
    console.warn(`[AI4A11y] Failed to enable ${toolName}:`, e);
  }
  // Note: user-authored "custom skills" are NOT applied from this content
  // script. They are registered as user scripts by background.js
  // (syncCustomUserScripts) and executed by Chrome's user-scripts runtime in
  // a CSP-permissive world, so they work on pages that disallow unsafe-eval.
}

function disableTool(toolName) {
  const tool = TOOL_MAP[toolName];
  if (!tool) return;
  try {
    if (tool.disable) tool.disable();
    enabledTools.delete(toolName);
    console.log(`[AI4A11y] Disabled ${toolName}`);
  } catch (e) {
    console.warn(`[AI4A11y] Failed to disable ${toolName}:`, e);
  }
}

function revertAll() {
  for (const toolName of enabledTools) {
    const tool = TOOL_MAP[toolName];
    if (tool?.disable) {
      try { tool.disable(); } catch (e) {}
    }
  }
  enabledTools.clear();

  for (const key of Object.keys(AI_TOOL_MAP)) {
    const tool = AI_TOOL_MAP[key];
    if (tool?.disable) {
      try { tool.disable(); } catch (e) {}
    }
  }

  stats.wcag = 0; stats.images = 0; stats.labels = 0; stats.text = 0; stats.captions = 0;
  fixes.length = 0;
  console.log('[AI4A11y] All tools reverted');
}

// Returns the cached AI-configured status (checking once per page load).
// Resolves to true if a Gemini API key is set, false otherwise.
async function checkAIConfigured() {
  if (_aiConfigured !== null) return _aiConfigured;
  _aiConfigured = await isAIConfigured().catch(() => false);
  return _aiConfigured;
}

// AI-gated enable: checks key before enabling an AI-powered adapter.
// fromSettingsChange=true means the user just toggled it on via the popup —
// announce a helpful message rather than silently skipping.
async function enableAITool(key, enableFn, _disableFn, fromSettingsChange = false) {
  const configured = await checkAIConfigured();
  if (!configured) {
    if (fromSettingsChange) {
      // Announce once so the user knows why nothing happened.
      announce('This feature needs a Gemini API key — add one in settings.');
    } else {
      console.info(`[AI4A11y] Skipping ${key}: no Gemini API key configured.`);
    }
    return;
  }
  try { await enableFn(); } catch (e) { console.warn(`[AI4A11y] ${key} error:`, e); }
}

async function applyAISettings(newSettings, fromSettingsChange = false) {
  Object.assign(aiSettings, newSettings);

  if (newSettings.fixContrast !== undefined) {
    if (newSettings.fixContrast) {
      await enableAITool('fixContrast', () => FixContrast.enable(), () => FixContrast.disable?.(), fromSettingsChange);
    } else if (FixContrast.disable) FixContrast.disable();
  }

  // autoWcagFix is a non-AI structural sweep — no API key required, not gated.
  if (newSettings.autoWcagFix !== undefined || newSettings.wcagRiskyFixes !== undefined) {
    const wcagOn = newSettings.autoWcagFix !== undefined ? newSettings.autoWcagFix : aiSettings.autoWcagFix;
    if (wcagOn) {
      if (newSettings.wcagRiskyFixes !== undefined) _axeRiskyEnabled = !!newSettings.wcagRiskyFixes;
      try { await WcagFixes.enable({ wcagRiskyFixes: _axeRiskyEnabled }); } catch (e) { console.warn('[AI4A11y] WcagFixes error:', e); }
    } else if (newSettings.autoWcagFix === false && WcagFixes.disable) {
      WcagFixes.disable();
    }
  }

  if (newSettings.autoFixLabels !== undefined) {
    if (newSettings.autoFixLabels) {
      await enableAITool('autoFixLabels', () => GenerateLabels.enable(), () => GenerateLabels.disable?.(), fromSettingsChange);
    } else if (GenerateLabels.disable) GenerateLabels.disable();
  }

  if (newSettings.autoDescribe !== undefined) {
    if (newSettings.autoDescribe) {
      await enableAITool('autoDescribe', () => AutoAltText.enable(), () => AutoAltText.disable?.(), fromSettingsChange);
    } else if (AutoAltText.disable) AutoAltText.disable();
  }

  if (newSettings.autoCaptions !== undefined) {
    if (newSettings.autoCaptions) {
      // Special case: Captions enables in youtubeOnly mode even without a key.
      const configured = await checkAIConfigured();
      try { await Captions.enable({ youtubeOnly: !configured }); } catch (e) {
        console.warn('[AI4A11y] autoCaptions error:', e);
      }
    } else if (Captions.disable) Captions.disable();
  }

  if (newSettings.autoSimplify !== undefined) {
    if (newSettings.autoSimplify) {
      await enableAITool('autoSimplify', () => SimplifyText.enable(), () => SimplifyText.disable?.(), fromSettingsChange);
    } else if (!aiSettings.autoSummarize && SimplifyText.disable) SimplifyText.disable();
  }

  if (newSettings.autoSummarize !== undefined) {
    if (newSettings.autoSummarize) {
      await enableAITool('autoSummarize', () => SimplifyText.enable(), () => SimplifyText.disable?.(), fromSettingsChange);
    } else if (!aiSettings.autoSimplify && SimplifyText.disable) SimplifyText.disable();
  }
}

function getToolStates() {
  const states = {};
  for (const toolName of Object.keys(TOOL_MAP)) {
    states[toolName] = enabledTools.has(toolName);
  }
  return states;
}

async function initFromStorage() {
  setAnnounceSuppressed(true);
  try {
    const settings = await chrome.storage.sync.get([
      'enabled', 'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands',
      'motionReducer', 'focusMode', 'hideDistractions', 'showProgress',
      'colorBlindMode', 'fontScale', 'lineHeight', 'letterSpacing',
      'contrastMode', 'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide',
      'fixContrast', 'autoWcagFix', 'wcagRiskyFixes', 'autoFixLabels', 'autoDescribe',
      'autoCaptions', 'autoSimplify', 'autoSummarize'
    ]);

    if (settings.enabled === false) {
      extensionEnabled = false;
      return;
    }

    if (settings.darkMode) enableTool('DarkMode');
    if (settings.motionReducer) enableTool('MotionReducer');
    if (settings.readerMode) enableTool('ReaderMode');
    if (settings.keyboardNav) enableTool('KeyboardNavigator');
    if (settings.voiceCommands) enableTool('VoiceCommands');

    if (settings.focusMode) {
      enableTool('FocusMode', {
        hideDistractions: settings.hideDistractions || false,
        showProgress: settings.showProgress !== false
      });
    }

    if (settings.colorBlindMode && settings.colorBlindMode !== 'none') {
      enableTool('ColorBlindMode', settings.colorBlindMode);
    }

    const va = {
      contrastMode: settings.contrastMode || 'none',
      fontScale: (settings.fontScale || 100) / 100,
      lineHeight: settings.lineHeight || 1.5,
      letterSpacing: settings.letterSpacing || 0,
      dyslexiaFont: settings.dyslexiaFont || false,
      largeCursor: settings.largeCursor || false,
      enhanceFocus: settings.enhanceFocus || false,
      readingGuide: settings.readingGuide || false
    };

    const hasVA = va.contrastMode !== 'none' || va.fontScale !== 1 ||
      va.lineHeight !== 1.5 || va.letterSpacing !== 0 ||
      va.dyslexiaFont || va.largeCursor || va.enhanceFocus || va.readingGuide;

    if (hasVA) enableTool('VisualAssist', va);

    aiSettings = {
      fixContrast: settings.fixContrast === true,
      autoWcagFix: settings.autoWcagFix === true,
      autoFixLabels: settings.autoFixLabels === true,
      autoDescribe: settings.autoDescribe === true,
      autoCaptions: settings.autoCaptions === true,
      autoSimplify: settings.autoSimplify === true,
      autoSummarize: settings.autoSummarize === true,
    };

    // AI sweeps: check key once before enabling any of them (cached per page load).
    // Special case: autoCaptions enables even without a key (youtubeOnly mode) —
    // YouTube CC auto-enable works key-free. The Captions adapter transcribes
    // fetchable media only when the provider is configured.
    if (aiSettings.autoCaptions) {
      const configured = await checkAIConfigured();
      try { await Captions.enable({ youtubeOnly: !configured }); } catch (e) {}
    }
    if (aiSettings.fixContrast || aiSettings.autoFixLabels || aiSettings.autoDescribe ||
        aiSettings.autoSimplify || aiSettings.autoSummarize) {
      const configured = await checkAIConfigured();
      if (!configured) {
        console.info('[AI4A11y] AI sweeps requested but no Gemini API key configured — skipping.');
      } else {
        if (aiSettings.fixContrast) { try { await FixContrast.enable(); } catch (e) {} }
        if (aiSettings.autoFixLabels) { try { await GenerateLabels.enable(); } catch (e) {} }
        if (aiSettings.autoDescribe) { try { await AutoAltText.enable(); } catch (e) {} }
        if (aiSettings.autoSimplify || aiSettings.autoSummarize) { try { await SimplifyText.enable(); } catch (e) {} }
      }
    }
    // autoWcagFix is non-AI (structural), always runs regardless of key.
    // wcagRiskyFixes is additive — only active when autoWcagFix is also on.
    if (aiSettings.autoWcagFix) {
      _axeRiskyEnabled = settings.wcagRiskyFixes === true;
      try { await WcagFixes.enable({ wcagRiskyFixes: _axeRiskyEnabled }); } catch (e) {}
    }

    console.log('[AI4A11y] Initialized from stored settings');
  } catch (e) {
    console.warn('[AI4A11y] Could not load stored settings:', e);
  } finally {
    setAnnounceSuppressed(false);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'enableTool') {
    enableTool(msg.tool, msg.options);
    sendResponse({ success: true });
  } else if (msg.type === 'disableTool') {
    disableTool(msg.tool);
    sendResponse({ success: true });
  } else if (msg.type === 'settingsChanged') {
    applyAISettings(msg.settings || {}, true /* fromSettingsChange */);
    sendResponse({ success: true });
  } else if (msg.type === 'revertAll') {
    revertAll();
    sendResponse({ success: true });
  } else if (msg.type === 'rescan') {
    revertAll();
    clearMarks(); // clear all namespaced processed-marks so elements are re-visited
    init();
    sendResponse({ success: true });
  } else if (msg.type === 'setEnabled') {
    extensionEnabled = msg.enabled;
    if (!msg.enabled) revertAll();
    else init();
    sendResponse({ success: true });
  } else if (msg.type === 'getToolStates') {
    sendResponse({ states: getToolStates() });
  } else if (msg.type === 'getStats') {
    sendResponse({
      success: true,
      stats: { ...stats },
      fixes: fixes.map((f, i) => ({
        type: f.type, element: f.element, old: f.old, new: f.new,
        fixIndex: i,
        revertable: !!(f._descriptor),
      }))
    });
  } else if (msg.type === 'speakPage') {
    ReadAloud.speakPage({ rate: msg.rate || 1 });
    enabledTools.add('ReadAloud');
    sendResponse({ success: true });
  } else if (msg.type === 'stopSpeech') {
    ReadAloud.stop();
    enabledTools.delete('ReadAloud');
    sendResponse({ success: true });
  } else if (msg.type === 'applyProfile') {
    if (msg.settings) {
      applyProfileSettings(msg.settings);
    }
    sendResponse({ success: true });
  } else if (msg.type === 'revertFix') {
    // Apply the inverse descriptor stored at fix time.
    // msg.fixIndex — index into the fixes array (from popup's fixIndex field).
    const fixIndex = msg.fixIndex;
    if (typeof fixIndex !== 'number' || !fixes[fixIndex]) {
      sendResponse({ success: false, reason: 'fix not found' }); return;
    }
    const entry = fixes[fixIndex];
    const desc = entry._descriptor;
    if (!desc || !desc.selector) { sendResponse({ success: false, reason: 'not revertable' }); return; }
    try {
      const el = document.querySelector(desc.selector);
      if (!el) { sendResponse({ success: false, reason: 'element not found' }); return; }
      if (desc.attr !== undefined) {
        if (desc.prior === null || desc.prior === undefined) {
          el.removeAttribute(desc.attr);
        } else {
          el.setAttribute(desc.attr, desc.prior);
        }
      } else if (desc.style) {
        // Style restore (target-size)
        for (const [prop, val] of Object.entries(desc.style)) {
          el.style[prop] = val || '';
        }
      }
      // Remove this fix from the local array and notify popup.
      fixes.splice(fixIndex, 1);
      chrome.runtime.sendMessage({
        type: 'fixAdded',
        stats: { ...stats },
        fixes: fixes.map((f, i) => ({
          type: f.type, element: f.element, old: f.old, new: f.new,
          fixIndex: i, revertable: !!(f._descriptor),
        }))
      }).catch(() => {});
      sendResponse({ success: true });
    } catch (e) {
      sendResponse({ success: false, reason: e.message });
    }
  } else if (msg.type === 'pageCommand') {
    const { action, target, text } = msg;
    let result;
    switch (action) {
      case 'scroll_down':       result = scrollBy('down'); break;
      case 'scroll_up':         result = scrollBy('up'); break;
      case 'page_down':         result = scrollBy('page_down'); break;
      case 'page_up':           result = scrollBy('page_up'); break;
      case 'top':               result = scrollToTop(); break;
      case 'bottom':            result = scrollToBottom(); break;
      case 'back':              result = goBack(); break;
      case 'forward':           result = goForward(); break;
      case 'click':             result = clickByText(target || ''); break;
      case 'focus_next_link':   result = focusNextLink(); break;
      case 'focus_prev_link':   result = focusPrevLink(); break;
      case 'focus_next_button': result = focusNextButton(); break;
      case 'type':              result = typeText(text || ''); break;
      default:                  result = { ok: false, detail: `unknown action: ${action}` };
    }
    sendResponse(result);
  }
  // No `return true` here: every matched branch above calls sendResponse
  // synchronously, and an unconditional `return true` would tell Chrome to
  // keep the channel open for messages this listener doesn't handle (e.g.
  // gemini, getActiveSkills) — which causes the "port closed before a
  // response was received" warning when the unrelated handler in background
  // sends its response and the channel finally tears down.
});

function applyProfileSettings(settings) {
  const toolMapping = {
    darkMode: 'DarkMode', readerMode: 'ReaderMode',
    keyboardNav: 'KeyboardNavigator', voiceCommands: 'VoiceCommands',
    motionReducer: 'MotionReducer'
  };

  for (const [key, toolName] of Object.entries(toolMapping)) {
    if (settings[key] === true) enableTool(toolName);
    else if (settings[key] === false) disableTool(toolName);
  }

  if (settings.focusMode) {
    enableTool('FocusMode', {
      hideDistractions: settings.hideDistractions || false,
      showProgress: settings.showProgress !== false
    });
  } else if (settings.focusMode === false) {
    disableTool('FocusMode');
  }

  if (settings.colorBlindMode && settings.colorBlindMode !== 'none') {
    enableTool('ColorBlindMode', settings.colorBlindMode);
  } else if (settings.colorBlindMode === 'none') {
    disableTool('ColorBlindMode');
  }

  const vaKeys = ['contrastMode', 'fontScale', 'lineHeight', 'letterSpacing',
    'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'];
  if (vaKeys.some(k => settings[k] !== undefined)) {
    // Merge the stored baseline first so a profile that sets only some keys
    // (e.g. just fontScale) does not wipe the user's other stored VA settings
    // (e.g. dyslexiaFont). Mirrors the Librarian overlay path (~line 572-578).
    chrome.storage.sync.get(vaKeys, (baseline) => {
      const va = {
        contrastMode: settings.contrastMode !== undefined ? settings.contrastMode : (baseline.contrastMode || 'none'),
        fontScale: settings.fontScale !== undefined ? settings.fontScale / 100 : ((baseline.fontScale || 100) / 100),
        lineHeight: settings.lineHeight !== undefined ? settings.lineHeight : (baseline.lineHeight || 1.5),
        letterSpacing: settings.letterSpacing !== undefined ? settings.letterSpacing : (baseline.letterSpacing || 0),
        dyslexiaFont: settings.dyslexiaFont !== undefined ? settings.dyslexiaFont : (baseline.dyslexiaFont || false),
        largeCursor: settings.largeCursor !== undefined ? settings.largeCursor : (baseline.largeCursor || false),
        enhanceFocus: settings.enhanceFocus !== undefined ? settings.enhanceFocus : (baseline.enhanceFocus || false),
        readingGuide: settings.readingGuide !== undefined ? settings.readingGuide : (baseline.readingGuide || false),
      };
      enableTool('VisualAssist', va);
    });
  }

  const aiKeys = { fixContrast: FixContrast, autoWcagFix: WcagFixes, autoFixLabels: GenerateLabels,
    autoDescribe: AutoAltText, autoCaptions: Captions,
    autoSimplify: SimplifyText, autoSummarize: SimplifyText };
  for (const [key, mod] of Object.entries(aiKeys)) {
    if (settings[key] === true) { try { mod.enable(); } catch (e) {} }
  }

  console.log('[AI4A11y] Profile settings applied');
}

// Cross-tab settings propagation: when another tab (or the popup) writes to
// chrome.storage.sync, apply the change here too so stale state doesn't persist
// until reload. Announcements are suppressed for these storage-driven applies
// (they are not user-initiated in this tab). A shallow diff against current
// state avoids double-applying a change the popup just sent us directly.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  const simpleToolKeys = {
    darkMode: 'DarkMode', readerMode: 'ReaderMode',
    keyboardNav: 'KeyboardNavigator', voiceCommands: 'VoiceCommands',
    motionReducer: 'MotionReducer'
  };
  const aiSettingKeys = new Set([
    'fixContrast', 'autoWcagFix', 'wcagRiskyFixes', 'autoFixLabels', 'autoDescribe',
    'autoCaptions', 'autoSimplify', 'autoSummarize'
  ]);

  setAnnounceSuppressed(true);
  try {
    const aiUpdates = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      // Simple on/off tools
      if (key in simpleToolKeys) {
        const toolName = simpleToolKeys[key];
        const currentlyEnabled = enabledTools.has(toolName);
        if (newValue === true && !currentlyEnabled) enableTool(toolName);
        else if (newValue === false && currentlyEnabled) disableTool(toolName);
      }
      // AI/fixContrast settings
      if (aiSettingKeys.has(key)) {
        const currentVal = aiSettings[key];
        if (newValue !== currentVal) aiUpdates[key] = newValue;
      }
    }
    if (Object.keys(aiUpdates).length > 0) {
      applyAISettings(aiUpdates);
    }
  } finally {
    setAnnounceSuppressed(false);
  }
});

function sendMessageAsync(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp);
    });
  });
}

// Content contexts present on this page — the scope dimension orthogonal to
// site category (a news article with an embedded player gets `context:video`
// preferences even though the SITE isn't a video site). Vocabulary lives in
// lib/taxonomy.js; detection is deliberately cheap and conservative.
function detectPageContexts() {
  const contexts = [];
  try {
    if (document.querySelector('video, audio, iframe[src*="youtube.com"], iframe[src*="vimeo.com"], iframe[src*="player"]')) {
      contexts.push('video');
    }
    const forms = document.querySelectorAll('form input, form select, form textarea');
    if (forms.length >= 3) contexts.push('form');
    const text = document.body ? (document.body.innerText || '') : '';
    if (text.length > 8000) contexts.push('document');
  } catch (_) {}
  return contexts;
}

async function init() {
  try {
    // Wire OS-signal auto-respect BEFORE the Librarian overlay so the Librarian
    // can override an OS-auto-enabled setting.  Only reducedMotion is consumed
    // in Wave 1b; the other four signals are read but not acted on yet:
    //   dark:                Wave 2a — suggest dark-mode (0/2 demand)
    //   moreContrast:        Wave 2a — suggest/enable fix-contrast / visual-assist
    //   forcedColors:        Wave 2a — same as moreContrast
    //   reducedTransparency: Wave 2a — no adapter yet
    watchSystemPrefs(async (prefs) => {
      if (!extensionEnabled) return;
      // Check whether the user has explicit settings for each signal we act on.
      const stored = await chrome.storage.sync.get(['motionReducer', 'darkMode']).catch(() => ({}));

      // --- reducedMotion → MotionReducer ---
      const motionExplicit = 'motionReducer' in stored;
      if (prefs.reducedMotion && !motionExplicit) {
        // OS says reduce motion, user has no explicit setting: auto-enable.
        if (!enabledTools.has('MotionReducer')) {
          setAnnounceSuppressed(true);
          try { enableTool('MotionReducer'); } finally { setAnnounceSuppressed(false); }
          _osAutoMotion = true;
        }
      } else if (!prefs.reducedMotion && _osAutoMotion) {
        // OS signal cleared and we auto-enabled it: reverse it.
        disableTool('MotionReducer');
        _osAutoMotion = false;
      } else if (prefs.reducedMotion && motionExplicit) {
        // OS says reduce but user has an explicit choice — their choice wins.
        _osAutoMotion = false;
      }

      // --- prefers-color-scheme:dark → DarkMode (Phase 3) ---
      // Auto-enable only when the OS is dark AND the user has never explicitly
      // set darkMode. Announce-suppressed (session-only, no storage write).
      const darkExplicit = 'darkMode' in stored;
      if (prefs.dark && !darkExplicit) {
        if (!enabledTools.has('DarkMode')) {
          setAnnounceSuppressed(true);
          try { enableTool('DarkMode'); } finally { setAnnounceSuppressed(false); }
          _osAutoDark = true;
        }
      } else if (!prefs.dark && _osAutoDark) {
        // OS switched back to light: undo the auto-enabled dark mode.
        disableTool('DarkMode');
        _osAutoDark = false;
      } else if (prefs.dark && darkExplicit) {
        // User has an explicit preference — their choice wins.
        _osAutoDark = false;
      }
    });

    const profilesResp = await sendMessageAsync({ type: 'getCustomProfiles' });
    const profiles = profilesResp?.profiles || [];
    const autoApplyProfiles = profiles.filter(p => p.autoApply && p.siteTypes?.length > 0);
    const contexts = detectPageContexts();

    // Always classify the page (the background caches the result) so scoped
    // Librarian preferences resolve even when the user has no auto-apply
    // profile — otherwise a "150% on news sites" pref never applies on a site
    // that nothing else triggered classification for.
    const meta = document.querySelector('meta[name="description"]');
    const classifyResp = await sendMessageAsync({
      type: 'classifySite',
      hostname: location.hostname,
      title: document.title,
      metaDescription: meta?.content || ''
    });

    let appliedProfile = false;
    if (autoApplyProfiles.length > 0 && classifyResp?.matchingProfile?.settings) {
      console.log(`[AI4A11y] Auto-applying profile "${classifyResp.matchingProfile.name}" for ${classifyResp.siteType} site`);
      setAnnounceSuppressed(true);
      try { applyProfileSettings(classifyResp.matchingProfile.settings); } finally { setAnnounceSuppressed(false); }
      appliedProfile = true;
      chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'personal', region: 'adapt', label: 'profile auto-applied' });
      if (classifyResp.matchingProfile.actions?.length > 0) {
        chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'skill', region: 'librarian_retrieves', label: 'retrieve saved skill' });
        chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'skill', region: 'autoenable', label: 'auto-replay' });
        chrome.runtime.sendMessage({
          type: 'runProfileActions',
          actions: classifyResp.matchingProfile.actions,
          sourceUrl: location.href,
        });
      }
    }
    if (!appliedProfile) {
      await initFromStorage();
    }

    // Librarian layer: learned preferences for this page's scope chain
    // (general → context → category → origin). Applied on top of the
    // baseline so the most specific memory wins. The merge already folds
    // in the matching custom profile, so when a profile applied above this
    // mostly adds origin-level and context-level refinements.
    const prefs = await sendMessageAsync({
      type: 'librarianEffectivePreferences',
      url: location.href,
      contexts,
    });
    if (prefs?.settings && Object.keys(prefs.settings).length > 0) {
      console.log('[AI4A11y] Applying Librarian preferences:', Object.keys(prefs.settings).join(', '));
      // Overlay on the stored baseline: applyProfileSettings treats the
      // visual-assist group as a whole (missing keys reset to defaults), so
      // a partial prefs object like {dyslexiaFont:false} must not wipe the
      // user's other stored visual settings.
      const VA_KEYS = ['contrastMode', 'fontScale', 'lineHeight', 'letterSpacing',
        'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide'];
      let overlay = prefs.settings;
      if (VA_KEYS.some(k => overlay[k] !== undefined)) {
        const baseline = await chrome.storage.sync.get(VA_KEYS);
        overlay = { ...baseline, ...overlay };
      }
      setAnnounceSuppressed(true);
      try { applyProfileSettings(overlay); } finally { setAnnounceSuppressed(false); }
      chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'personal', region: 'adapt', label: 'learned preferences applied' });
    }
    // Honest cannot-satisfy: if the web SurfaceAdapter flagged needs it can't
    // render (e.g. a cross-app dimension with no web mapping), surface it
    // rather than failing silently. Never fires for web-native settings.
    if (prefs?.surface?.unmet?.length) {
      const keys = prefs.surface.unmet.map(u => u.key);
      console.warn('[AI4A11y] surface cannot satisfy:', keys);
      chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'personal', region: 'adapt', label: 'cannot-satisfy: ' + keys.join(',') });
    }
  } catch (e) {
    console.warn('[AI4A11y] Init failed, falling back to global settings:', e);
    await initFromStorage();
  }
}

init();
