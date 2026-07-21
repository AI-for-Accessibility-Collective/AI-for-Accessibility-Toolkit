import { setAIProvider, createChromeAIProvider } from '../../utils/ai.js';
import { DarkMode } from '../../skills/builtin/dark-mode.js';
import { FocusMode } from '../../skills/builtin/focus-mode.js';
import { VisualAssist } from '../../skills/builtin/visual-assist.js';
import { MotionReducer } from '../../skills/builtin/motion-reducer.js';
import { ReaderMode } from '../../skills/builtin/reader-mode.js';
import { DismissOverlays } from '../../skills/builtin/dismiss-overlays.js';
import { BigTargets } from '../../skills/builtin/big-targets.js';
import { LinkHighlighter } from '../../skills/builtin/link-highlighter.js';
import { PageOutline } from '../../skills/builtin/page-outline.js';
import { BionicReading } from '../../skills/builtin/bionic-reading.js';
import { UnpinSticky } from '../../skills/builtin/unpin-sticky.js';
import { TranslatePage } from '../../skills/builtin/translate-page.js';
import { MuteSounds } from '../../skills/builtin/mute-sounds.js';
import { DefineWords } from '../../skills/builtin/define-words.js';
import { StopAutoAdvance } from '../../skills/builtin/stop-auto-advance.js';
import { ReduceBrightness } from '../../skills/builtin/reduce-brightness.js';
import { SoundVisualizer } from '../../skills/builtin/sound-visualizer.js';
import { LiveRegionAnnouncer } from '../../skills/builtin/live-region-announcer.js';
import { Magnifier } from '../../skills/builtin/magnifier.js';
import { FlashGuard } from '../../skills/builtin/flash-guard.js';
import { DescribeOnDemand } from '../../skills/builtin/describe-on-demand.js';
import { ReflowColumn } from '../../skills/builtin/reflow-column.js';
import { FocusLocator } from '../../skills/builtin/focus-locator.js';
import { PersistentHover } from '../../skills/builtin/persistent-hover.js';
import { ColorFilter } from '../../skills/builtin/color-filter.js';
import { KeyboardNav } from '../../skills/builtin/keyboard-nav.js';
import { AutoAltText } from '../../skills/builtin/auto-alt-text.js';
import { SimplifyText } from '../../skills/builtin/simplify-text.js';
import { VoiceCommands } from '../../skills/builtin/voice-commands.js';
import { ReadAloud } from '../../skills/builtin/read-aloud.js';
import { GenerateLabels } from '../../skills/builtin/generate-labels.js';
import { GenerateCaptions } from '../../skills/builtin/generate-captions.js';
import { WcagFixes } from '../../skills/builtin/wcag-fixes.js';

setAIProvider(createChromeAIProvider());

const TOOL_MAP = {
  DarkMode,
  FocusMode,
  VisualAssist,
  MotionReducer,
  ReaderMode,
  DismissOverlays,
  BigTargets,
  LinkHighlighter,
  PageOutline,
  BionicReading,
  UnpinSticky,
  TranslatePage,
  MuteSounds,
  DefineWords,
  StopAutoAdvance,
  ReduceBrightness,
  SoundVisualizer,
  LiveRegionAnnouncer,
  Magnifier,
  FlashGuard,
  DescribeOnDemand,
  ReflowColumn,
  FocusLocator,
  PersistentHover,
  ColorBlindMode: ColorFilter,
  KeyboardNavigator: KeyboardNav,
  VoiceCommands,
  ReadAloud,
};

const AI_TOOL_MAP = {
  autoWcagFix: WcagFixes,
  autoFixLabels: GenerateLabels,
  autoDescribe: AutoAltText,
  autoVideoDescribe: AutoAltText,
  autoCaptions: GenerateCaptions,
  autoSimplify: SimplifyText,
  autoSummarize: SimplifyText,
};

let enabledTools = new Set();
let aiSettings = {};
let extensionEnabled = true;

const stats = { wcag: 0, images: 0, labels: 0, text: 0, captions: 0 };
const fixes = [];

function reportFix(type, element, oldVal, newVal) {
  if (type === 'wcag') stats.wcag++;
  else if (type === 'image') stats.images++;
  else if (type === 'label') stats.labels++;
  else if (type === 'text') stats.text++;
  else if (type === 'caption') stats.captions++;
  fixes.push({ type, element: element || '', old: oldVal || '', new: newVal || '' });
  chrome.runtime.sendMessage({ type: 'fixAdded', stats: { ...stats }, fixes: [...fixes] }).catch(() => {});
}

function enableTool(toolName, options) {
  const tool = TOOL_MAP[toolName];
  if (!tool) return;

  if (enabledTools.has(toolName) && tool.disable) {
    tool.disable();
  }

  try {
    if (options !== undefined) {
      tool.enable(options);
    } else {
      tool.enable();
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

async function applyAISettings(newSettings) {
  Object.assign(aiSettings, newSettings);

  if (newSettings.autoWcagFix !== undefined) {
    if (newSettings.autoWcagFix) {
      try { await WcagFixes.enable(); } catch (e) { console.warn('[AI4A11y] WcagFixes error:', e); }
    } else if (WcagFixes.disable) WcagFixes.disable();
  }

  if (newSettings.autoFixLabels !== undefined) {
    if (newSettings.autoFixLabels) {
      try { await GenerateLabels.enable(); } catch (e) { console.warn('[AI4A11y] GenerateLabels error:', e); }
    } else if (GenerateLabels.disable) GenerateLabels.disable();
  }

  if (newSettings.autoDescribe !== undefined) {
    if (newSettings.autoDescribe) {
      try { await AutoAltText.enable(); } catch (e) { console.warn('[AI4A11y] AutoAltText error:', e); }
    } else if (AutoAltText.disable) AutoAltText.disable();
  }

  if (newSettings.autoCaptions !== undefined) {
    if (newSettings.autoCaptions) {
      try { await GenerateCaptions.enable(); } catch (e) { console.warn('[AI4A11y] GenerateCaptions error:', e); }
    } else if (GenerateCaptions.disable) GenerateCaptions.disable();
  }

  if (newSettings.autoSimplify !== undefined) {
    if (newSettings.autoSimplify) {
      try { await SimplifyText.enable(); } catch (e) { console.warn('[AI4A11y] SimplifyText error:', e); }
    } else if (!aiSettings.autoSummarize && SimplifyText.disable) SimplifyText.disable();
  }

  if (newSettings.autoSummarize !== undefined) {
    if (newSettings.autoSummarize) {
      try { await SimplifyText.enable(); } catch (e) { console.warn('[AI4A11y] SimplifyText error:', e); }
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
  try {
    const settings = await chrome.storage.sync.get([
      'enabled', 'darkMode', 'readerMode', 'keyboardNav', 'voiceCommands',
      'motionReducer', 'focusMode', 'hideDistractions', 'showProgress',
      'colorBlindMode', 'fontScale', 'lineHeight', 'letterSpacing',
      'contrastMode', 'dyslexiaFont', 'largeCursor', 'enhanceFocus', 'readingGuide', 'dismissOverlays', 'bigTargets', 'highlightLinks', 'pageOutline', 'bionicReading', 'unpinSticky', 'translatePage', 'translateTo', 'muteSounds', 'defineWords', 'stopAutoAdvance', 'reduceBrightness', 'soundVisualizer', 'announceUpdates', 'magnifier', 'flashGuard', 'describeOnDemand', 'reflowColumn', 'focusLocator', 'persistentHover',
      'autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoVideoDescribe',
      'autoCaptions', 'autoSimplify', 'autoSummarize'
    ]);

    if (settings.enabled === false) {
      extensionEnabled = false;
      return;
    }

    if (settings.darkMode) enableTool('DarkMode');
    if (settings.motionReducer) enableTool('MotionReducer');
    if (settings.readerMode) enableTool('ReaderMode');
    if (settings.dismissOverlays) enableTool('DismissOverlays');
    if (settings.bigTargets) enableTool('BigTargets');
    if (settings.highlightLinks) enableTool('LinkHighlighter');
    if (settings.pageOutline) enableTool('PageOutline');
    if (settings.bionicReading) enableTool('BionicReading');
    if (settings.unpinSticky) enableTool('UnpinSticky');
    if (settings.translatePage) enableTool('TranslatePage', { targetLang: settings.translateTo });
    if (settings.muteSounds) enableTool('MuteSounds');
    if (settings.defineWords) enableTool('DefineWords');
    if (settings.stopAutoAdvance) enableTool('StopAutoAdvance');
    if (settings.reduceBrightness) enableTool('ReduceBrightness');
    if (settings.soundVisualizer) enableTool('SoundVisualizer');
    if (settings.announceUpdates) enableTool('LiveRegionAnnouncer');
    if (settings.magnifier) enableTool('Magnifier');
    if (settings.flashGuard) enableTool('FlashGuard');
    if (settings.describeOnDemand) enableTool('DescribeOnDemand');
    if (settings.reflowColumn) enableTool('ReflowColumn');
    if (settings.focusLocator) enableTool('FocusLocator');
    if (settings.persistentHover) enableTool('PersistentHover');
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
      autoWcagFix: settings.autoWcagFix !== false,
      autoFixLabels: settings.autoFixLabels !== false,
      autoDescribe: settings.autoDescribe !== false,
      autoVideoDescribe: settings.autoVideoDescribe === true,
      autoCaptions: settings.autoCaptions === true,
      autoSimplify: settings.autoSimplify === true,
      autoSummarize: settings.autoSummarize === true,
    };

    if (aiSettings.autoWcagFix) { try { await WcagFixes.enable(); } catch (e) {} }
    if (aiSettings.autoFixLabels) { try { await GenerateLabels.enable(); } catch (e) {} }
    if (aiSettings.autoDescribe) { try { await AutoAltText.enable(); } catch (e) {} }
    if (aiSettings.autoCaptions) { try { await GenerateCaptions.enable(); } catch (e) {} }
    if (aiSettings.autoSimplify || aiSettings.autoSummarize) { try { await SimplifyText.enable(); } catch (e) {} }

    console.log('[AI4A11y] Initialized from stored settings');
  } catch (e) {
    console.warn('[AI4A11y] Could not load stored settings:', e);
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
    applyAISettings(msg.settings || {});
    sendResponse({ success: true });
  } else if (msg.type === 'revertAll') {
    revertAll();
    sendResponse({ success: true });
  } else if (msg.type === 'rescan') {
    revertAll();
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
    sendResponse({ success: true, stats: { ...stats }, fixes: [...fixes] });
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
  } else if (msg.type === 'applySkill') {
    // Apply a skill's resolved settings to this page. The caller (Skills
    // manager) already got explicit user consent via its "Apply" button, so
    // this is a deliberate user action, not silent adaptation. The resolved
    // plan is just settings, so it flows through the same adapter path.
    if (msg.plan?.settings) {
      applyProfileSettings(msg.plan.settings);
    }
    sendResponse({ success: true });
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
    motionReducer: 'MotionReducer', dismissOverlays: 'DismissOverlays',
    bigTargets: 'BigTargets', highlightLinks: 'LinkHighlighter', pageOutline: 'PageOutline',
    bionicReading: 'BionicReading', unpinSticky: 'UnpinSticky', translatePage: 'TranslatePage',
    muteSounds: 'MuteSounds', defineWords: 'DefineWords', stopAutoAdvance: 'StopAutoAdvance',
    reduceBrightness: 'ReduceBrightness', soundVisualizer: 'SoundVisualizer', announceUpdates: 'LiveRegionAnnouncer', magnifier: 'Magnifier', flashGuard: 'FlashGuard', describeOnDemand: 'DescribeOnDemand', reflowColumn: 'ReflowColumn', focusLocator: 'FocusLocator', persistentHover: 'PersistentHover'
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
    enableTool('VisualAssist', va);
  }

  const aiKeys = { autoWcagFix: WcagFixes, autoFixLabels: GenerateLabels,
    autoDescribe: AutoAltText, autoCaptions: GenerateCaptions,
    autoSimplify: SimplifyText, autoSummarize: SimplifyText };
  for (const [key, mod] of Object.entries(aiKeys)) {
    if (settings[key] === true) { try { mod.enable(); } catch (e) {} }
  }

  console.log('[AI4A11y] Profile settings applied');
}

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
    // Master switch. When the user has turned the extension off, apply nothing —
    // not the stored baseline, not an auto-apply profile, not learned Librarian
    // preferences. initFromStorage() checks this too, but profile auto-apply and
    // the Librarian overlay below run outside it, so the check must live here to
    // honor the off state on a fresh navigation.
    const master = await chrome.storage.sync.get('enabled');
    if (master.enabled === false) return;

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
      applyProfileSettings(classifyResp.matchingProfile.settings);
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
      applyProfileSettings(overlay);
      chrome.runtime.sendMessage({ type: 'aaDemoTrace', diagram: 'personal', region: 'adapt', label: 'learned preferences applied' });
    }
  } catch (e) {
    console.warn('[AI4A11y] Init failed, falling back to global settings:', e);
    await initFromStorage();
  }
}

init();
