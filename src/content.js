/**
 * AI for Accessibility - Content Script
 *
 * Main entry point that orchestrates accessibility scanning and fixing.
 *
 * EXTENDING:
 * - Add new analyzers in src/analyzers/ (see README)
 * - Add new adapters in src/adapters/ (see README)
 */

import { loadSettings, getSettings, isEnabled, updateSettings } from './settings.js';
import { resetStats, getStats, getFixLog } from './stats.js';
import { sendMessage, notifyProgress, announce } from './utils/messaging.js';
import { clearAllMarks, sleep } from './utils/dom.js';
import { runAxeAnalysis, getElementFromNode } from './analyzers/wcag-issues.js';
import {
  findEmptyAltImages,
  findCanvasElements
} from './analyzers/missing-alt.js';
import {
  getHandler,
  generateImageAlt,
  generateCanvasDescription,
  simplifyText,
  summarizeContent
} from './adapters/index.js';
import { VisualAssist } from './features/visual-assist.js';
import { DarkMode } from './features/dark-mode.js';
import { MotionReducer } from './features/motion-reducer.js';
import { FocusMode } from './features/focus-mode.js';
import { ReadAloud } from './features/read-aloud.js';
import { ReaderMode } from './features/reader-mode.js';
import { VoiceCommands } from './features/voice-commands.js';
import { KeyboardNavigator } from './features/keyboard-nav.js';
import { ColorBlindMode } from './features/color-blind.js';
import { AutoTranscriber } from './features/auto-transcriber.js';

// State
let isRunning = false;
let initPending = false;

// Apply visual settings from profile/settings to features
function applyVisualSettings(settings) {
  // Visual Assist (font, spacing, cursor, focus, contrast)
  // Always include numeric settings to ensure previous values are reset
  const visualOptions = {};
  if (settings.contrastMode !== undefined) visualOptions.contrastMode = settings.contrastMode || 'none';
  if (settings.fontScale !== undefined) visualOptions.fontScale = settings.fontScale;
  if (settings.lineHeight !== undefined) visualOptions.lineHeight = settings.lineHeight;
  if (settings.letterSpacing !== undefined) visualOptions.letterSpacing = settings.letterSpacing;
  if (settings.largeCursor) visualOptions.largeCursor = true;
  if (settings.enhanceFocus) visualOptions.enhanceFocus = true;
  if (settings.dyslexiaFont) visualOptions.dyslexiaFont = true;
  if (settings.readingGuide) visualOptions.readingGuide = true;

  // Check if any non-default values
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

  // Color blind filter (storage uses colorBlindMode)
  const colorMode = settings.colorBlindMode || settings.colorFilter;
  if (colorMode && colorMode !== 'none') {
    ColorBlindMode.enable(colorMode);
    console.log('[AI4A11y] Applied color blind mode:', colorMode);
  }

  // Dark mode
  if (settings.darkMode) {
    DarkMode.enable();
    console.log('[AI4A11y] Dark mode enabled');
  }

  // Motion reducer
  if (settings.motionReducer) {
    MotionReducer.enable();
    console.log('[AI4A11y] Motion reducer enabled');
  }

  // Focus mode with options
  if (settings.focusMode) {
    FocusMode.enable({
      hideDistractions: settings.hideDistractions,
      showProgress: settings.showProgress
    });
    console.log('[AI4A11y] Focus mode enabled');
  }

  // Reader mode
  if (settings.readerMode) {
    ReaderMode.enable();
  }

  // Keyboard navigation
  if (settings.keyboardNav) {
    KeyboardNavigator.enable();
  }

  // Voice commands
  if (settings.voiceCommands) {
    VoiceCommands.enable();
  }

  // Auto captions
  if (settings.autoCaptions) {
    AutoTranscriber.enable();
    console.log('[AI4A11y] Auto transcriber enabled');
  }
}

// Initialize on page load
async function init() {
  // Prevent concurrent init calls (race condition guard)
  if (isRunning || initPending) {
    console.log('[AI4A11y] Scan already in progress or pending');
    return;
  }
  initPending = true;

  const settings = await loadSettings();

  if (!settings.enabled) {
    console.log('[AI4A11y] Extension disabled');
    initPending = false;
    return;
  }

  // Apply visual/feature settings from profile
  applyVisualSettings(settings);

  if (isRunning) {
    console.log('[AI4A11y] Scan already in progress');
    initPending = false;
    return;
  }

  isRunning = true;
  initPending = false;

  try {
    console.log('[AI4A11y] Starting scan...');
    notifyProgress('Analyzing', 10);

    if (!isEnabled('autoWcagFix')) {
      console.log('[AI4A11y] Auto WCAG fix disabled');
      isRunning = false;
      return;
    }

    // Run axe-core analysis
    const violations = await runAxeAnalysis();
    notifyProgress('Fixing', 30);

    // Process violations
    await processViolations(violations);
    notifyProgress('Images', 50);

    // Additional scans beyond axe-core
    await runAdditionalScans();
    notifyProgress('Text', 80);

    // Text processing
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

      // Image-related violations - queue for parallel processing
      if (isImageViolation(violation.id) && isEnabled('autoDescribe')) {
        const handler = getHandler(violation.id);
        if (handler) {
          imageTasks.push(() => handler(el));
        }
        continue;
      }

      // All other violations - process immediately
      try {
        await processViolation(violation, node, el, settings);
      } catch (e) {
        console.warn(`[AI4A11y] Failed to fix ${violation.id}:`, e);
      }
    }
  }

  // Process images in parallel batches
  if (imageTasks.length > 0) {
    console.log(`[AI4A11y] Processing ${imageTasks.length} images...`);
    const BATCH_SIZE = 5;
    for (let i = 0; i < imageTasks.length; i += BATCH_SIZE) {
      const batch = imageTasks.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(fn => fn().catch(e => console.warn('[AI4A11y] Image task failed:', e))));
    }
  }
}

// Check if violation is image-related
function isImageViolation(ruleId) {
  return ['image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'object-alt', 'area-alt'].includes(ruleId);
}

// Process a single violation
async function processViolation(violation, node, el, settings) {
  const handler = getHandler(violation.id);

  if (handler) {
    // Check if feature is enabled for this type
    if (violation.id === 'color-contrast' && !isEnabled('fixContrast')) return;
    if (violation.id.includes('label') && !isEnabled('autoFixLabels')) return;
    if (violation.id.includes('caption') && !isEnabled('autoCaptions')) return;

    // Some handlers need extra context
    if (violation.id === 'color-contrast') {
      const style = getComputedStyle(el);
      await handler(el, style.color, style.backgroundColor);
    } else {
      await handler(el);
    }
  }
}

// Run additional scans beyond axe-core
async function runAdditionalScans() {
  const settings = getSettings();

  // Images with empty alt that might need descriptions
  if (isEnabled('autoDescribe')) {
    const emptyAltImages = findEmptyAltImages();
    if (emptyAltImages.length > 0) {
      console.log(`[AI4A11y] Found ${emptyAltImages.length} empty-alt images`);
      for (const img of emptyAltImages) {
        await generateImageAlt(img);
      }
    }

    // Canvas elements
    const canvases = findCanvasElements();
    if (canvases.length > 0) {
      console.log(`[AI4A11y] Found ${canvases.length} canvas elements`);
      for (const canvas of canvases) {
        await generateCanvasDescription(canvas);
      }
    }
  }

  // Fix target="_blank" links
  fixTargetBlankLinks();

  // Fix positive tabindex
  fixPositiveTabindexElements();

  // Fix duplicate IDs
  fixDuplicateIds();
}

// Run text processing (simplify, summarize)
async function runTextProcessing() {
  // Simplify complex text
  if (isEnabled('autoSimplify')) {
    const complexText = findComplexText();
    if (complexText.length > 0) {
      console.log(`[AI4A11y] Simplifying ${complexText.length} text blocks`);
      for (const el of complexText) {
        await simplifyText(el);
      }
    }
  }

  // Summarize long content
  if (isEnabled('autoSummarize')) {
    const longBlocks = findLongContent();
    if (longBlocks.length > 0) {
      console.log(`[AI4A11y] Summarizing ${longBlocks.length} long blocks`);
      for (const el of longBlocks) {
        await summarizeContent(el);
      }
    }
  }
}

// Find text that needs simplification
function findComplexText() {
  return Array.from(document.querySelectorAll('p, li, td, div'))
    .filter(el => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.querySelector('p, div, article, section')) return false;
      return el.textContent.length > 300;
    });
}

// Find long content that needs summarization
function findLongContent() {
  return Array.from(document.querySelectorAll('p, article, section, .article-body'))
    .filter(el => {
      if (el.dataset.ai4a11ySummarize) return false;
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.closest('[data-ai4a11y-summarize]')) return false;
      return el.textContent?.trim().length > 500;
    });
}

// Proactive fix: target="_blank" without rel
function fixTargetBlankLinks() {
  document.querySelectorAll('a[target="_blank"]').forEach(link => {
    if (link.dataset.ai4a11yProcessed) return;
    const rel = link.getAttribute('rel') || '';
    if (rel.includes('noopener')) return;

    const parts = rel.split(/\s+/).filter(Boolean);
    if (!parts.includes('noopener')) parts.push('noopener');
    if (!parts.includes('noreferrer')) parts.push('noreferrer');
    link.setAttribute('rel', parts.join(' '));
    link.dataset.ai4a11yProcessed = 'true';
  });
}

// Proactive fix: positive tabindex
function fixPositiveTabindexElements() {
  document.querySelectorAll('[tabindex]').forEach(el => {
    if (el.dataset.ai4a11yProcessed) return;
    const val = parseInt(el.getAttribute('tabindex'));
    if (val > 0) {
      el.setAttribute('tabindex', '0');
      el.dataset.ai4a11yProcessed = 'true';
    }
  });
}

// Proactive fix: duplicate IDs
function fixDuplicateIds() {
  const seen = new Map();
  document.querySelectorAll('[id]').forEach(el => {
    if (el.dataset.ai4a11yProcessed) return;
    const id = el.id;
    if (!id) return;

    if (seen.has(id)) {
      const newId = `${id}_${Math.random().toString(36).substring(2, 7)}`;
      el.id = newId;
      el.dataset.ai4a11yProcessed = 'true';
    } else {
      seen.set(id, el);
    }
  });
}

// Revert all changes
function revertAll() {
  // Disable all tools
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

  // Revert simplified text
  document.querySelectorAll('.ai4a11y-simplified, .ai4a11y-original').forEach(el => {
    if (el.dataset.ai4a11yOriginal) {
      el.querySelector('.ai4a11y-toggle-original')?.remove();
      el.textContent = el.dataset.ai4a11yOriginal;
      el.classList.remove('ai4a11y-simplified', 'ai4a11y-original');
    }
  });

  // Revert adapted links
  document.querySelectorAll('a.ai4a11y-adapted').forEach(link => {
    if (link.dataset.ai4a11yOriginal) {
      link.textContent = link.dataset.ai4a11yOriginal;
      link.classList.remove('ai4a11y-adapted');
    }
  });

  // Revert contrast fixes
  document.querySelectorAll('.ai4a11y-contrast-fixed').forEach(el => {
    if (el.dataset.ai4a11yOriginalColor) {
      el.style.color = el.dataset.ai4a11yOriginalColor;
      el.classList.remove('ai4a11y-contrast-fixed');
    }
  });

  announce('Reverted all AI adaptations');
}

// Handle rescan
function rescan() {
  clearAllMarks();
  resetStats();
  isRunning = false;
  init();
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStats') {
    sendResponse({
      success: true,
      stats: getStats(),
      fixes: getFixLog()
    });
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
    loadSettings().then(() => {
      if (msg.rescan) rescan();
    });
    sendResponse({ success: true });
    return true;
  }

  // Visual feature toggles
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

  // Read Aloud controls
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
    sendResponse({
      success: true,
      speaking: ReadAloud.speaking || false,
      paused: ReadAloud.paused || false
    });
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
        AutoTranscriber: AutoTranscriber.enabled || false
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

// Handle enabling visual tools
function handleEnableTool(tool, options = {}) {
  switch (tool) {
    case 'darkMode':
    case 'DarkMode':
      DarkMode.enable();
      break;
    case 'motionReducer':
    case 'MotionReducer':
      MotionReducer.enable();
      break;
    case 'colorFilter':
    case 'ColorBlindMode':
      ColorBlindMode.enable(typeof options === 'string' ? options : options.mode);
      break;
    case 'visualAssist':
    case 'VisualAssist':
      VisualAssist.enable(options);
      break;
    case 'largeCursor':
      VisualAssist.enable({ largeCursor: true });
      break;
    case 'enhanceFocus':
      VisualAssist.enable({ enhanceFocus: true });
      break;
    case 'dyslexiaFont':
      VisualAssist.enable({ dyslexiaFont: true });
      break;
    case 'readingGuide':
      VisualAssist.enable({ readingGuide: true });
      break;
    case 'focusMode':
    case 'FocusMode':
      FocusMode.enable(options);
      break;
    case 'readerMode':
    case 'ReaderMode':
      ReaderMode.enable(options);
      break;
    case 'keyboardNav':
    case 'KeyboardNavigator':
      KeyboardNavigator.enable(options);
      break;
    case 'voiceCommands':
    case 'VoiceCommands':
      VoiceCommands.enable(options);
      break;
    case 'autoCaptions':
    case 'AutoTranscriber':
      AutoTranscriber.enable();
      break;
    default:
      console.log('[AI4A11y] Unknown tool:', tool);
  }
}

// Handle disabling visual tools
function handleDisableTool(tool) {
  switch (tool) {
    case 'darkMode':
    case 'DarkMode':
      DarkMode.disable();
      break;
    case 'motionReducer':
    case 'MotionReducer':
      MotionReducer.disable();
      break;
    case 'colorFilter':
    case 'ColorBlindMode':
      ColorBlindMode.disable();
      break;
    case 'visualAssist':
    case 'VisualAssist':
      VisualAssist.disable();
      break;
    case 'largeCursor':
      VisualAssist.enable({ ...VisualAssist.settings, largeCursor: false });
      break;
    case 'enhanceFocus':
      VisualAssist.enable({ ...VisualAssist.settings, enhanceFocus: false });
      break;
    case 'dyslexiaFont':
      VisualAssist.enable({ ...VisualAssist.settings, dyslexiaFont: false });
      break;
    case 'readingGuide':
      VisualAssist.enable({ ...VisualAssist.settings, readingGuide: false });
      break;
    case 'focusMode':
    case 'FocusMode':
      FocusMode.disable();
      break;
    case 'readerMode':
    case 'ReaderMode':
      ReaderMode.disable();
      break;
    case 'keyboardNav':
    case 'KeyboardNavigator':
      KeyboardNavigator.disable();
      break;
    case 'voiceCommands':
    case 'VoiceCommands':
      VoiceCommands.disable();
      break;
    case 'autoCaptions':
    case 'AutoTranscriber':
      AutoTranscriber.disable();
      break;
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for testing
export {
  init, rescan,
  VisualAssist, DarkMode, MotionReducer,
  FocusMode, ReadAloud, ReaderMode, VoiceCommands,
  KeyboardNavigator, ColorBlindMode, AutoTranscriber
};
