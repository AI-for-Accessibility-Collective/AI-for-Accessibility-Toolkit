/**
 * AI for Accessibility - Content Script
 *
 * Main entry point that orchestrates accessibility scanning and fixing.
 *
 * EXTENDING:
 * - Add new auditors in tools/auditors/ (see README)
 * - Add new adapters in tools/adapters/ (see README)
 */

// Import from shared tools
import { setAIProvider } from '../../tools/utils/ai.js';
import { profiles, loadSettings, getSettings, isEnabled, updateSettings, getProfile } from '../../tools/profiles/settings.js';
import { clearAllMarks, sleep } from '../../tools/utils/dom.js';
import { runAxeAnalysis, getElementFromNode } from '../../tools/auditors/wcag-issues.js';
import { findEmptyAltImages, findCanvasElements } from '../../tools/auditors/missing-alt.js';
import { findAmbiguousLinks } from '../../tools/auditors/missing-labels.js';
import {
  getAxeHandler,
  generateImageAlt,
  generateCanvasDescription,
  generateVideoDescription,
  simplifyText,
  summarizeContent,
  fixTargetBlank,
  fixPositiveTabindex,
  improveAmbiguousLinks,
  fixAllTables,
  fixLandmarks,
  VisualAssist,
  DarkMode,
  MotionReducer,
  FocusMode,
  ReadAloud,
  ReaderMode,
  VoiceCommands,
  KeyboardNavigator,
  ColorBlindMode,
  AutoTranscriber,
  DismissOverlays,
  BigTargets,
  LinkHighlighter,
  PageOutline,
  BionicReading,
  UnpinSticky,
  TranslatePage,
  MuteSounds,
} from '../../tools/adapters/index.js';

// Extension-specific imports
import { resetStats, getStats, getFixLog, logFix, incrementStat } from './stats.js';
import { sendMessage, notifyProgress, announce } from './utils/messaging.js';

// Set up Chrome AI provider (bridges to background.js Gemini API)
setAIProvider({
  describeImage: (imageData) => sendMessage({ type: 'describeImage', imageData }).then(r => r?.result),
  describeVideo: (frames, metadata) => sendMessage({ type: 'describeVideoFrames', frames, metadata }).then(r => r?.result),
  simplifyText: (text) => sendMessage({ type: 'simplifyText', text }).then(r => r?.result),
  summarizeText: (text) => sendMessage({ type: 'summarizeText', text }).then(r => r?.result),
  translateText: (text, targetLang) => sendMessage({ type: 'translateText', text, targetLang }).then(r => r?.result),
  defineWord: (word, context) => sendMessage({ type: 'defineWord', word, context }).then(r => r?.result),
  generateLabels: (ctx) => sendMessage({ type: 'inferLabel', ...ctx }).then(r => r?.result),
  inferLabel: (ctx) => sendMessage({ type: 'inferLabel', ...ctx }).then(r => r?.result),
  fixContrast: (fg, bg) => sendMessage({ type: 'fixContrast', foreground: fg, background: bg }).then(r => r?.result),
  getYouTubeTranscript: (videoId) => sendMessage({ type: 'getYouTubeTranscript', videoId }).then(r => r?.result),
  transcribeVideo: (url) => sendMessage({ type: 'transcribeVideo', audioUrl: url }).then(r => r?.result),
  transcribeAudio: (url) => sendMessage({ type: 'transcribeAudio', audioUrl: url }).then(r => r?.result),
  describeElement: (imageData, elementType, context) => sendMessage({ type: 'describeElement', imageData, elementType, context }).then(r => r?.result),
  improveLinkText: (linkText, href, context) => sendMessage({ type: 'improveLinkText', linkText, href, context }).then(r => r?.result),
  inferColumnHeader: (sampleData) => sendMessage({ type: 'inferColumnHeader', sampleData }).then(r => r?.result),
  announce: (msg) => announce(msg),
});

// Inject stats functions for adapters to use
globalThis.ai4a11yLogFix = logFix;
globalThis.ai4a11yIncrementStat = incrementStat;

// State
let isRunning = false;
let initPromise = null;

// Alias for getHandler (adapters use getAxeHandler)
const getHandler = getAxeHandler;

// Apply visual settings from profile/settings to features
function applyVisualSettings(settings) {
  // Visual Assist (font, spacing, cursor, focus, contrast)
  const visualOptions = {};
  if (settings.contrastMode !== undefined) visualOptions.contrastMode = settings.contrastMode || 'none';
  if (settings.fontScale !== undefined) visualOptions.fontScale = settings.fontScale;
  if (settings.lineHeight !== undefined) visualOptions.lineHeight = settings.lineHeight;
  if (settings.letterSpacing !== undefined) visualOptions.letterSpacing = settings.letterSpacing;
  if (settings.largeCursor) visualOptions.largeCursor = true;
  if (settings.enhanceFocus) visualOptions.enhanceFocus = true;
  if (settings.dyslexiaFont) visualOptions.dyslexiaFont = true;
  if (settings.readingGuide) visualOptions.readingGuide = true;

  const hasNonDefault =
    (visualOptions.contrastMode && visualOptions.contrastMode !== 'none') ||
    (visualOptions.fontScale && visualOptions.fontScale !== 100) ||
    (visualOptions.lineHeight && visualOptions.lineHeight !== 1.5) ||
    (visualOptions.letterSpacing && visualOptions.letterSpacing !== 0) ||
    visualOptions.largeCursor ||
    visualOptions.enhanceFocus ||
    visualOptions.dyslexiaFont ||
    visualOptions.readingGuide;

  if (hasNonDefault) {
    VisualAssist.enable(visualOptions);
    console.log('[AI4A11y] Applied visual settings:', visualOptions);
  }

  // Color filter (canonical key: colorFilter; colorBlindMode is legacy)
  const colorMode = settings.colorFilter || settings.colorBlindMode;
  if (colorMode && colorMode !== 'none') {
    ColorBlindMode.enable(colorMode);
    console.log('[AI4A11y] Applied color blind mode:', colorMode);
  }

  if (settings.darkMode) {
    DarkMode.enable();
    console.log('[AI4A11y] Dark mode enabled');
  }

  if (settings.motionReducer) {
    MotionReducer.enable();
    console.log('[AI4A11y] Motion reducer enabled');
  }

  if (settings.focusMode) {
    FocusMode.enable({
      hideDistractions: settings.hideDistractions,
      showProgress: settings.showProgress
    });
    console.log('[AI4A11y] Focus mode enabled');
  }

  if (settings.readerMode) ReaderMode.enable();
  if (settings.dismissOverlays) DismissOverlays.enable();
  if (settings.bigTargets) BigTargets.enable();
  if (settings.highlightLinks) LinkHighlighter.enable();
  if (settings.pageOutline) PageOutline.enable();
  if (settings.bionicReading) BionicReading.enable();
  if (settings.unpinSticky) UnpinSticky.enable();
  if (settings.translatePage) TranslatePage.enable({ targetLang: settings.translateTo });
  if (settings.muteSounds) MuteSounds.enable();
  if (settings.keyboardNav) KeyboardNavigator.enable();
  if (settings.voiceCommands) VoiceCommands.enable();
  if (settings.autoCaptions) {
    AutoTranscriber.enable();
    console.log('[AI4A11y] Auto transcriber enabled');
  }
}

// Initialize on page load
async function init() {
  if (initPromise) {
    console.log('[AI4A11y] Init already in progress');
    return initPromise;
  }
  if (isRunning) {
    console.log('[AI4A11y] Scan already running');
    return;
  }

  initPromise = doInit();
  return initPromise;
}

async function doInit() {
  // Load settings via Chrome storage
  const settings = await loadSettings(async () => {
    const response = await sendMessage({ type: 'getSettings' });
    return response?.result;
  });

  if (!settings.enabled) {
    console.log('[AI4A11y] Extension disabled');
    initPromise = null;
    return;
  }

  applyVisualSettings(settings);

  if (isRunning) {
    console.log('[AI4A11y] Scan already in progress');
    initPromise = null;
    return;
  }

  isRunning = true;
  initPromise = null;

  try {
    console.log('[AI4A11y] Starting scan...');
    notifyProgress('Analyzing', 10);

    if (isEnabled('autoWcagFix')) {
      const violations = await runAxeAnalysis();
      notifyProgress('Fixing', 30);
      await processViolations(violations);
    } else {
      console.log('[AI4A11y] Auto WCAG fix disabled — skipping axe scan');
    }
    notifyProgress('Images', 50);
    await runAdditionalScans();
    notifyProgress('Text', 80);
    await runTextProcessing();

    console.log('[AI4A11y] Done');
    notifyProgress('Done', 100);
  } finally {
    isRunning = false;
  }
}

// Process axe-core violations
async function processViolations(violations) {
  const settings = getSettings();
  const imageTasks = [];

  for (const violation of violations) {
    console.log(`[AI4A11y] Processing: ${violation.id} (${violation.nodes.length} elements)`);

    for (const node of violation.nodes) {
      const el = getElementFromNode(node);
      if (!el || el.dataset.ai4a11yProcessed) continue;

      if (isImageViolation(violation.id) && isEnabled('autoDescribe')) {
        const handler = getHandler(violation.id);
        if (handler) imageTasks.push(() => handler(el));
        continue;
      }

      try {
        await processViolation(violation, node, el, settings);
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
      await Promise.all(batch.map(fn => fn().catch(e => console.warn('[AI4A11y] Image task failed:', e))));
    }
  }
}

function isImageViolation(ruleId) {
  return ['image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'object-alt', 'area-alt'].includes(ruleId);
}

async function processViolation(violation, node, el, settings) {
  const handler = getHandler(violation.id);
  if (!handler) return;

  if (violation.id.startsWith('color-contrast') && !isEnabled('fixContrast')) return;
  if (violation.id.includes('label') && !isEnabled('autoFixLabels')) return;
  if (violation.id.includes('caption') && !isEnabled('autoCaptions')) return;

  if (violation.id.startsWith('color-contrast')) {
    const style = getComputedStyle(el);
    await handler(el, style.color, style.backgroundColor);
  } else {
    await handler(el);
  }
}

async function runAdditionalScans() {
  if (isEnabled('autoDescribe')) {
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

  if (isEnabled('autoVideoDescribe')) {
    const videos = Array.from(document.querySelectorAll('video'))
      .filter(v => !v.dataset.ai4a11yProcessed && !v.getAttribute('aria-label'));
    if (videos.length > 0) {
      console.log(`[AI4A11y] Describing ${videos.length} videos`);
      for (const video of videos) {
        await generateVideoDescription(video).catch(e => console.warn('[AI4A11y] Video description failed:', e));
      }
    }
  }

  if (isEnabled('autoFixLabels')) {
    const ambiguousLinks = findAmbiguousLinks();
    if (ambiguousLinks.length > 0) {
      console.log(`[AI4A11y] Improving ${ambiguousLinks.length} ambiguous links`);
      await improveAmbiguousLinks(ambiguousLinks);
    }
    await fixAllTables();
  }

  if (isEnabled('autoWcagFix')) {
    fixLandmarks();
  }

  // These two run regardless of the shared ai4a11yProcessed flag: an earlier
  // fixer (e.g. ambiguous-link labeling) may have marked the same element,
  // and these fix *different* attributes. Each has its own idempotency guard
  // (rel already has noopener / tabindex already normalized), so they're safe
  // to re-check every scan without the shared mutex.
  document.querySelectorAll('a[target="_blank"]').forEach(link => {
    if ((link.getAttribute('rel') || '').includes('noopener')) return;
    fixTargetBlank(link);
  });

  document.querySelectorAll('[tabindex]').forEach(el => {
    if (parseInt(el.getAttribute('tabindex')) > 0) fixPositiveTabindex(el);
  });
}

async function runTextProcessing() {
  if (isEnabled('autoSimplify')) {
    const complexText = findComplexText();
    if (complexText.length > 0) {
      console.log(`[AI4A11y] Simplifying ${complexText.length} text blocks`);
      for (const el of complexText) await simplifyText(el);
    }
  }

  if (isEnabled('autoSummarize')) {
    const longBlocks = findLongContent();
    if (longBlocks.length > 0) {
      console.log(`[AI4A11y] Summarizing ${longBlocks.length} long blocks`);
      for (const el of longBlocks) await summarizeContent(el);
    }
  }
}

function findComplexText() {
  return Array.from(document.querySelectorAll('p, li, td, div'))
    .filter(el => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.querySelector('p, div, article, section')) return false;
      return el.textContent.length > 300;
    });
}

function findLongContent() {
  return Array.from(document.querySelectorAll('p, article, section, .article-body'))
    .filter(el => {
      if (el.dataset.ai4a11ySummarize) return false;
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.closest('[data-ai4a11y-summarize]')) return false;
      return el.textContent?.trim().length > 500;
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

  document.querySelectorAll('.ai4a11y-simplified').forEach(el => {
    const originalWrapper = el.querySelector('.ai4a11y-original-content');
    if (originalWrapper) {
      el.querySelector('.ai4a11y-text-content')?.remove();
      el.querySelector('.ai4a11y-toggle-original')?.remove();
      while (originalWrapper.firstChild) {
        el.appendChild(originalWrapper.firstChild);
      }
      originalWrapper.remove();
    }
    delete el.dataset.ai4a11yOriginal;
    delete el.dataset.ai4a11ySimplified;
    delete el.dataset.ai4a11yShowOriginal;
    el.classList.remove('ai4a11y-simplified');
  });

  document.querySelectorAll('a.ai4a11y-adapted').forEach(link => {
    link.removeAttribute('aria-label');
    link.classList.remove('ai4a11y-adapted');
  });

  document.querySelectorAll('.ai4a11y-contrast-fixed').forEach(el => {
    if (el.dataset.ai4a11yOriginalColor) {
      el.style.color = el.dataset.ai4a11yOriginalColor;
      el.classList.remove('ai4a11y-contrast-fixed');
    }
  });

  announce('Reverted all AI adaptations');
}

function rescan() {
  clearAllMarks();
  resetStats();
  isRunning = false;
  init();
}

// Message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStats') {
    sendResponse({ success: true, stats: getStats(), fixes: getFixLog() });
    return true;
  }
  if (msg.type === 'rescan') {
    rescan();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'setEnabled') {
    updateSettings({ enabled: msg.enabled });
    if (!msg.enabled) revertAll();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'settingsChanged') {
    loadSettings(async () => {
      const r = await sendMessage({ type: 'getSettings' });
      return r?.result;
    }).then(() => { if (msg.rescan) rescan(); });
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'enableTool') {
    handleEnableTool(msg.tool, msg.options);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'disableTool') {
    handleDisableTool(msg.tool);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'speakPage') {
    ReadAloud.speakPage({ rate: msg.rate || 1 });
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'stopSpeech') {
    ReadAloud.stop();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'pauseSpeech') {
    ReadAloud.pause();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'resumeSpeech') {
    ReadAloud.resume();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'toggleSpeech') {
    ReadAloud.toggle();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'getSpeechState') {
    sendResponse({ success: true, speaking: ReadAloud.speaking || false, paused: ReadAloud.paused || false });
    return true;
  }
  if (msg.type === 'getToolStates') {
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
        MuteSounds: MuteSounds.enabled || false
      }
    });
    return true;
  }
  if (msg.type === 'revertAll') {
    revertAll();
    sendResponse({ success: true });
    return true;
  }
});

function handleEnableTool(tool, options = {}) {
  switch (tool) {
    case 'darkMode': case 'DarkMode': DarkMode.enable(); break;
    case 'motionReducer': case 'MotionReducer': MotionReducer.enable(); break;
    case 'colorFilter': case 'ColorBlindMode':
      ColorBlindMode.enable(typeof options === 'string' ? options : options.mode); break;
    case 'visualAssist': case 'VisualAssist': VisualAssist.enable(options); break;
    case 'largeCursor': VisualAssist.enable({ largeCursor: true }); break;
    case 'enhanceFocus': VisualAssist.enable({ enhanceFocus: true }); break;
    case 'dyslexiaFont': VisualAssist.enable({ dyslexiaFont: true }); break;
    case 'readingGuide': VisualAssist.enable({ readingGuide: true }); break;
    case 'focusMode': case 'FocusMode': FocusMode.enable(options); break;
    case 'readerMode': case 'ReaderMode': ReaderMode.enable(options); break;
    case 'keyboardNav': case 'KeyboardNavigator': KeyboardNavigator.enable(options); break;
    case 'voiceCommands': case 'VoiceCommands': VoiceCommands.enable(options); break;
    case 'autoCaptions': case 'AutoTranscriber': AutoTranscriber.enable(); break;
    default: console.log('[AI4A11y] Unknown tool:', tool);
  }
}

function handleDisableTool(tool) {
  switch (tool) {
    case 'darkMode': case 'DarkMode': DarkMode.disable(); break;
    case 'motionReducer': case 'MotionReducer': MotionReducer.disable(); break;
    case 'colorFilter': case 'ColorBlindMode': ColorBlindMode.disable(); break;
    case 'visualAssist': case 'VisualAssist': VisualAssist.disable(); break;
    case 'largeCursor': VisualAssist.enable({ ...VisualAssist.settings, largeCursor: false }); break;
    case 'enhanceFocus': VisualAssist.enable({ ...VisualAssist.settings, enhanceFocus: false }); break;
    case 'dyslexiaFont': VisualAssist.enable({ ...VisualAssist.settings, dyslexiaFont: false }); break;
    case 'readingGuide': VisualAssist.enable({ ...VisualAssist.settings, readingGuide: false }); break;
    case 'focusMode': case 'FocusMode': FocusMode.disable(); break;
    case 'readerMode': case 'ReaderMode': ReaderMode.disable(); break;
    case 'keyboardNav': case 'KeyboardNavigator': KeyboardNavigator.disable(); break;
    case 'voiceCommands': case 'VoiceCommands': VoiceCommands.disable(); break;
    case 'autoCaptions': case 'AutoTranscriber': AutoTranscriber.disable(); break;
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {
  init, rescan,
  VisualAssist, DarkMode, MotionReducer,
  FocusMode, ReadAloud, ReaderMode, VoiceCommands,
  KeyboardNavigator, ColorBlindMode, AutoTranscriber
};
