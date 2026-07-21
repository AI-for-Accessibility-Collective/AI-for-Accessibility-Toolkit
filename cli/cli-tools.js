/**
 * CLI Tools Bundle Entry Point
 *
 * This module bundles all adapters and profiles for injection into Playwright.
 * Unlike the extension (which uses Chrome messaging), this exposes tools
 * directly on window.ai4a11y for Playwright's page.evaluate() to call.
 *
 * AI-powered adapters use window.ai4a11y_* callbacks injected by Python.
 */

// Import AI provider system
import { setAIProvider } from '../tools/utils/ai.js';

// Import visual adapters
import { VisualAssist } from '../tools/adapters/visual-assist.js';
import { DarkMode } from '../tools/adapters/dark-mode.js';
import { MotionReducer } from '../tools/adapters/motion-reducer.js';
import { FocusMode } from '../tools/adapters/focus-mode.js';
import { ReadAloud } from '../tools/adapters/read-aloud.js';
import { ReaderMode } from '../tools/adapters/reader-mode.js';
import { VoiceCommands } from '../tools/adapters/voice-commands.js';
import { KeyboardNavigator } from '../tools/adapters/keyboard-nav.js';
import { ColorBlindMode } from '../tools/adapters/color-blind.js';
import { DismissOverlays } from '../tools/adapters/dismiss-overlays.js';
import { BigTargets } from '../tools/adapters/big-targets.js';
import { LinkHighlighter } from '../tools/adapters/link-highlighter.js';
import { PageOutline } from '../tools/adapters/page-outline.js';
import { BionicReading } from '../tools/adapters/bionic-reading.js';
import { UnpinSticky } from '../tools/adapters/unpin-sticky.js';
import { TranslatePage } from '../tools/adapters/translate-page.js';
import { MuteSounds } from '../tools/adapters/mute-sounds.js';
import { DefineWords } from '../tools/adapters/define-words.js';
import { StopAutoAdvance } from '../tools/adapters/stop-auto-advance.js';
import { ReduceBrightness } from '../tools/adapters/reduce-brightness.js';
import { SoundVisualizer } from '../tools/adapters/sound-visualizer.js';
import { LiveRegionAnnouncer } from '../tools/adapters/live-region-announcer.js';
import { Magnifier } from '../tools/adapters/magnifier.js';
import { FlashGuard } from '../tools/adapters/flash-guard.js';
import { DescribeOnDemand } from '../tools/adapters/describe-on-demand.js';
import { ReflowColumn } from '../tools/adapters/reflow-column.js';
import { FocusLocator } from '../tools/adapters/focus-locator.js';
import { AutoTranscriber } from '../tools/adapters/auto-transcriber.js';

// Import AI-powered adapters
import {
  generateImageAlt,
  generateCanvasDescription,
  improveAmbiguousLinks,
  fixAllTables,
  fixLandmarks,
  getAxeHandler,
  axeHandlers
} from '../tools/adapters/index.js';
import { simplifyText, summarizeContent } from '../tools/adapters/simplify-text.js';

// Import non-AI WCAG fixes
import {
  fixInvalidLang,
  fixMissingLang,
  fixDuplicateId,
  fixHeadingOrder,
  fixPositiveTabindex,
  fixTargetBlank,
  fixInvalidAriaAttr,
  fixInvalidAriaRole,
  fixDeprecatedRole,
  fixMissingAriaAttrs,
  fixNestedInteractive,
  fixTargetSize,
  fixViewportMeta,
  removeMetaRefresh,
  replaceObsoleteElement
} from '../tools/adapters/wcag-fixes.js';

// Import auditors
import { runAxeAnalysis, getElementFromNode } from '../tools/auditors/wcag-issues.js';
import { findEmptyAltImages, findCanvasElements, findImagesWithoutAlt } from '../tools/auditors/missing-alt.js';
import { findVideosWithoutCaptions, findAudioWithoutTranscripts } from '../tools/auditors/missing-captions.js';
import { findEmptyLinks, findEmptyButtons, findUnlabeledInputs, findAmbiguousLinks } from '../tools/auditors/missing-labels.js';
import { findLowContrastText } from '../tools/auditors/poor-contrast.js';
import { auditLandmarks } from '../tools/auditors/missing-landmarks.js';

// Import profiles
import {
  profiles,
  getProfile,
  applyProfile,
  applyProfiles,
  getEnabledAdapters,
  getAllProfiles
} from '../tools/profiles/settings.js';

// Set up AI provider that bridges to Python callbacks
// Python will inject window.ai4a11y_describeImage, etc. via exposeFunction
function setupAIProvider() {
  setAIProvider({
    describeImage: async (imageData) => {
      if (typeof window.ai4a11y_describeImage === 'function') {
        return await window.ai4a11y_describeImage(imageData);
      }
      console.warn('[AI4A11y] AI provider not available - run with AI enabled');
      return null;
    },
    simplifyText: async (text) => {
      if (typeof window.ai4a11y_simplifyText === 'function') {
        return await window.ai4a11y_simplifyText(text);
      }
      return null;
    },
    summarizeText: async (text) => {
      if (typeof window.ai4a11y_summarizeText === 'function') {
        return await window.ai4a11y_summarizeText(text);
      }
      return null;
    },
    translateText: async (text, targetLang) => {
      if (typeof window.ai4a11y_translateText === 'function') {
        return await window.ai4a11y_translateText(text, targetLang);
      }
      return null;
    },
    defineWord: async (word, context) => {
      if (typeof window.ai4a11y_defineWord === 'function') {
        return await window.ai4a11y_defineWord(word, context);
      }
      return null;
    },
    generateLabels: async (ctx) => {
      if (typeof window.ai4a11y_generateLabels === 'function') {
        return await window.ai4a11y_generateLabels(ctx);
      }
      return null;
    },
    inferLabel: async (ctx) => {
      if (typeof window.ai4a11y_generateLabels === 'function') {
        return await window.ai4a11y_generateLabels(ctx);
      }
      return null;
    },
    fixContrast: async (fg, bg) => {
      if (typeof window.ai4a11y_fixContrast === 'function') {
        return await window.ai4a11y_fixContrast(fg, bg);
      }
      return null;
    },
    describeElement: async (imageData, elementType, context) => {
      if (typeof window.ai4a11y_describeElement === 'function') {
        return await window.ai4a11y_describeElement(imageData, elementType, context);
      }
      return null;
    },
    improveLinkText: async (linkText, href, context) => {
      if (typeof window.ai4a11y_improveLinkText === 'function') {
        return await window.ai4a11y_improveLinkText(linkText, href, context);
      }
      return null;
    },
    inferColumnHeader: async (sampleData) => {
      if (typeof window.ai4a11y_inferColumnHeader === 'function') {
        return await window.ai4a11y_inferColumnHeader(sampleData);
      }
      return null;
    },
    announce: (msg) => console.log(`[Announce] ${msg}`),
  });
}

// Tool registry for enable/disable
const tools = {
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
};

// Normalize tool name (handles case variations)
function normalizeTool(name) {
  const lower = name.toLowerCase().replace(/[-_]/g, '');
  const map = {
    'visualassist': 'visualAssist',
    'darkmode': 'darkMode',
    'motionreducer': 'motionReducer',
    'focusmode': 'focusMode',
    'readaloud': 'readAloud',
    'readermode': 'readerMode',
    'voicecommands': 'voiceCommands',
    'keyboardnav': 'keyboardNav',
    'keyboardnavigator': 'keyboardNav',
    'colorblindmode': 'colorBlindMode',
    'colorblind': 'colorBlindMode',
    'colorfilter': 'colorBlindMode',
    'autotranscriber': 'autoTranscriber',
    'autocaptions': 'autoTranscriber',
    'dismissoverlays': 'dismissOverlays',
    'dismisspopups': 'dismissOverlays',
    'bigtargets': 'bigTargets',
    'biggertargets': 'bigTargets',
    'highlightlinks': 'highlightLinks',
    'linkhighlighter': 'highlightLinks',
    'pageoutline': 'pageOutline',
    'outline': 'pageOutline',
    'bionicreading': 'bionicReading',
    'bionic': 'bionicReading',
    'unpinsticky': 'unpinSticky',
    'unpin': 'unpinSticky',
    'translatepage': 'translatePage',
    'translate': 'translatePage',
    'mutesounds': 'muteSounds',
    'mute': 'muteSounds',
    'definewords': 'defineWords',
    'define': 'defineWords',
    'stopautoadvance': 'stopAutoAdvance',
    'stopauto': 'stopAutoAdvance',
    'reducebrightness': 'reduceBrightness',
    'dim': 'reduceBrightness',
    'soundvisualizer': 'soundVisualizer',
    'soundviz': 'soundVisualizer',
    'announceupdates': 'announceUpdates',
    'liveregion': 'announceUpdates',
    'magnifier': 'magnifier',
    'lens': 'magnifier',
    'flashguard': 'flashGuard',
    'flash': 'flashGuard',
    'describeondemand': 'describeOnDemand',
    'describe': 'describeOnDemand',
    'reflowcolumn': 'reflowColumn',
    'reflow': 'reflowColumn',
    'focuslocator': 'focusLocator',
    'focusring': 'focusLocator',
  };
  return map[lower] || name;
}

// Enable a tool by name
function enableTool(name, options = {}) {
  const normalized = normalizeTool(name);
  const tool = tools[normalized];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  try {
    if (typeof tool.enable === 'function') {
      tool.enable(options);
    } else if (typeof tool === 'object' && tool.enable) {
      tool.enable(options);
    }
    return { success: true, tool: normalized };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Disable a tool by name
function disableTool(name) {
  const normalized = normalizeTool(name);
  const tool = tools[normalized];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }
  try {
    if (typeof tool.disable === 'function') {
      tool.disable();
    } else if (typeof tool === 'object' && tool.disable) {
      tool.disable();
    }
    return { success: true, tool: normalized };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Get status of all tools
function getToolStatus() {
  const status = {};
  for (const [name, tool] of Object.entries(tools)) {
    status[name] = tool.enabled || false;
  }
  return status;
}

// Apply a profile by name
function applyProfileByName(profileId) {
  const profile = getProfile(profileId);
  if (!profile) {
    return { success: false, error: `Unknown profile: ${profileId}` };
  }

  // First disable all tools
  for (const tool of Object.values(tools)) {
    if (tool.disable) {
      try { tool.disable(); } catch (e) {}
    }
  }

  // Apply profile settings via adapters
  const profileTools = profile.tools || {};

  // Visual settings
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

  // Other tools
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
  if (profileTools.keyboardNav) KeyboardNavigator.enable();
  if (profileTools.colorFilter && profileTools.colorFilter !== 'none') {
    ColorBlindMode.enable(profileTools.colorFilter);
  }
  if (profileTools.autoCaptions) AutoTranscriber.enable();

  return {
    success: true,
    profile: profileId,
    name: profile.name,
    enabled: getToolStatus()
  };
}

// List all available profiles
function listProfiles() {
  return getAllProfiles();
}

// List all available tools
function listTools() {
  return Object.keys(tools).map(name => ({
    name,
    enabled: tools[name].enabled || false,
    description: getToolDescription(name)
  }));
}

function getToolDescription(name) {
  const descriptions = {
    visualAssist: 'Font scaling, spacing, cursor, focus enhancement',
    darkMode: 'Dark color scheme',
    motionReducer: 'Reduce animations and motion',
    focusMode: 'Hide distractions, show reading progress',
    readAloud: 'Text-to-speech for page content',
    readerMode: 'Clean reading view (article extraction)',
    voiceCommands: 'Voice-controlled navigation',
    keyboardNav: 'Enhanced keyboard navigation',
    colorBlindMode: 'Color vision deficiency filters',
    autoTranscriber: 'Auto-generate captions for media',
    dismissOverlays: 'Hide cookie banners, newsletter popups, and blocking modals',
    bigTargets: 'Enlarge and space out small clickable controls (WCAG 2.5.8)',
    highlightLinks: 'Underline and strengthen links and reveal where each one leads',
    pageOutline: 'On-page heading navigator to jump between sections',
    bionicReading: 'Bold the start of each word to guide the eye (dyslexia/ADHD aid)',
    unpinSticky: 'Un-fix sticky headers/bars so they stop eating the viewport when zoomed',
    translatePage: 'Translate the page text into another language (AI)',
    muteSounds: 'Mute all audio and video and block autoplay sound',
    defineWords: 'Show plain-language definitions of hard words on hover (AI)',
    stopAutoAdvance: 'Pause auto-carousels, auto-refresh, and autoplay (WCAG 2.2.2)',
    reduceBrightness: 'Dim and desaturate the page for a low-stimulation view',
    soundVisualizer: 'Flash a visual indicator when the page plays sound (Deaf/HoH)',
    announceUpdates: 'Announce dynamic content changes to screen readers (live region)',
    magnifier: 'A lens that magnifies the text under the cursor',
    flashGuard: 'Block autoplay and dim video/animation for seizure safety (WCAG 2.3.1)',
    describeOnDemand: 'Alt+click or Alt+D to get an AI description of any element',
    reflowColumn: 'Force page content into one readable column (WCAG 1.4.10)',
    focusLocator: 'Show a strong always-visible indicator of keyboard focus',
  };
  return descriptions[name] || '';
}

// Auditor functions - find accessibility issues
const auditors = {
  findMissingAlt() {
    const noAlt = findImagesWithoutAlt();
    const emptyAlt = findEmptyAltImages();
    const canvases = findCanvasElements();
    return {
      noAlt: noAlt.map(el => ({
        tagName: el.tagName,
        src: el.src || el.currentSrc,
        selector: getSelector(el)
      })),
      emptyAlt: emptyAlt.map(el => ({
        tagName: el.tagName,
        src: el.src || el.currentSrc,
        selector: getSelector(el)
      })),
      canvases: canvases.map(el => ({
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
      links: links.map(el => ({
        href: el.href,
        selector: getSelector(el)
      })),
      buttons: buttons.map(el => ({
        selector: getSelector(el)
      })),
      inputs: inputs.map(el => ({
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
      videos: videos.map(el => ({
        src: el.src || el.currentSrc,
        selector: getSelector(el)
      })),
      audio: audio.map(el => ({
        src: el.src || el.currentSrc,
        selector: getSelector(el)
      })),
      total: videos.length + audio.length
    };
  },

  findPoorContrast() {
    const results = findLowContrastText();
    return results.map(item => ({
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

// AI-powered fix functions
const aiFixes = {
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
    // Adapter operates on elements (rewrites in place, keeps original)
    const el = selector ? document.querySelector(selector) : document.body;
    if (!el) return null;
    return await simplifyText(el);
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
    await handler(el);
    return { success: true };
  }
};

// Non-AI fix handlers (pure DOM manipulation)
const nonAiFixes = {
  'html-has-lang': fixMissingLang,
  'html-lang-valid': fixInvalidLang,
  'valid-lang': fixInvalidLang,
  'duplicate-id': fixDuplicateId,
  'duplicate-id-aria': fixDuplicateId,
  'duplicate-id-active': fixDuplicateId,
  'heading-order': fixHeadingOrder,
  'tabindex': fixPositiveTabindex,
  'aria-valid-attr': fixInvalidAriaAttr,
  'aria-roles': fixInvalidAriaRole,
  'aria-allowed-role': fixInvalidAriaRole,
  'aria-deprecated-role': fixDeprecatedRole,
  'aria-required-attr': fixMissingAriaAttrs,
  'nested-interactive': fixNestedInteractive,
  'target-size': fixTargetSize,
  'meta-viewport': fixViewportMeta,
  'meta-viewport-large': fixViewportMeta,
  'meta-refresh': removeMetaRefresh,
  'blink': replaceObsoleteElement,
  'marquee': replaceObsoleteElement
};

// AI-requiring fixes (need Claude callback)
const aiRequiredRules = new Set([
  'image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'object-alt', 'area-alt',
  'link-name', 'button-name', 'input-button-name',
  'color-contrast', 'color-contrast-enhanced'
]);

// Run full accessibility scan and fix (like extension does)
async function runFullScan() {
  const results = {
    violations: [],
    fixed: { nonAi: 0, ai: 0 },
    skipped: { needsAi: [], noHandler: [] }
  };

  // Run axe analysis
  const violations = await runAxeAnalysis();
  results.violations = violations.map(v => ({ id: v.id, count: v.nodes?.length || 0 }));

  // Process each violation
  for (const violation of violations) {
    const ruleId = violation.id;
    const nodes = violation.nodes || [];

    for (const node of nodes) {
      const selector = node.target?.[0];
      if (!selector) continue;

      const el = document.querySelector(selector);
      if (!el || el.dataset.ai4a11yProcessed) continue;

      // Check if we have a non-AI handler
      if (nonAiFixes[ruleId]) {
        try {
          nonAiFixes[ruleId](el);
          results.fixed.nonAi++;
        } catch (e) {
          console.warn(`[AI4A11y] Failed to fix ${ruleId}:`, e);
        }
        continue;
      }

      // Check if this needs AI (skip for now, return to Python)
      if (aiRequiredRules.has(ruleId)) {
        results.skipped.needsAi.push({ ruleId, selector });
        continue;
      }

      // No handler available
      results.skipped.noHandler.push(ruleId);
    }
  }

  // Run additional non-AI fixes
  fixTargetBlankLinks();
  fixPositiveTabindexElements();
  fixDuplicateIds();

  // Check for text processing needs (cognitive profile features)
  const settings = getActiveProfileSettings();
  if (settings.autoSimplify) {
    const complexText = findComplexText();
    results.textProcessing = results.textProcessing || {};
    results.textProcessing.simplify = complexText.map(el => ({
      selector: getSelector(el),
      textLength: el.textContent?.length || 0
    }));
  }
  if (settings.autoSummarize) {
    const longContent = findLongContent();
    results.textProcessing = results.textProcessing || {};
    results.textProcessing.summarize = longContent.map(el => ({
      selector: getSelector(el),
      textLength: el.textContent?.length || 0
    }));
  }

  return results;
}

// Helper functions for additional scans
function fixTargetBlankLinks() {
  document.querySelectorAll('a[target="_blank"]:not([rel*="noopener"])').forEach(link => {
    if (!link.dataset.ai4a11yProcessed) {
      fixTargetBlank(link);
    }
  });
}

function fixPositiveTabindexElements() {
  document.querySelectorAll('[tabindex]').forEach(el => {
    const val = parseInt(el.getAttribute('tabindex'));
    if (val > 0 && !el.dataset.ai4a11yProcessed) {
      fixPositiveTabindex(el);
    }
  });
}

function fixDuplicateIds() {
  const seen = new Set();
  document.querySelectorAll('[id]').forEach(el => {
    if (seen.has(el.id) && !el.dataset.ai4a11yProcessed) {
      fixDuplicateId(el);
    }
    seen.add(el.id);
  });
}

// Text processing for cognitive profiles
function findComplexText() {
  return Array.from(document.querySelectorAll('p, li, td, div'))
    .filter(el => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.dataset.ai4a11ySimplified) return false;
      if (el.querySelector('p, div, article, section')) return false;
      const text = el.textContent?.trim() || '';
      // Complex = long sentences or many syllables
      return text.length > 200 && text.split(/[.!?]/).some(s => s.trim().split(/\s+/).length > 15);
    })
    .slice(0, 10); // Limit to avoid overwhelming AI
}

function findLongContent() {
  return Array.from(document.querySelectorAll('p, article, section, .article-body, .content'))
    .filter(el => {
      if (el.dataset.ai4a11ySummarized) return false;
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.closest('[data-ai4a11y-summarized]')) return false;
      const text = el.textContent?.trim() || '';
      return text.length > 500;
    })
    .slice(0, 5); // Limit to avoid overwhelming AI
}

// Check if a profile setting is enabled
function isProfileSettingEnabled(setting) {
  const state = window._ai4a11ySessionState || {};
  const profileName = state.activeProfile;
  if (!profileName) return false;

  const profile = getProfile(profileName);
  if (!profile) return false;

  return !!profile.tools?.[setting];
}

// Get all active profile settings
function getActiveProfileSettings() {
  const state = window._ai4a11ySessionState || {};
  const profileName = state.activeProfile;
  if (!profileName) return {};

  const profile = getProfile(profileName);
  return profile?.tools || {};
}

// Helper to get CSS selector for element
function getSelector(el) {
  if (!el || !el.tagName) return 'unknown';
  const tag = el.tagName.toLowerCase();
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c).slice(0, 2).join('.');
    if (classes) return `${tag}.${classes}`;
  }
  return tag;
}

// Expose on window for Playwright access
if (typeof window !== 'undefined') {
  // Set up AI provider
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
    setSessionState: (state) => { window._ai4a11ySessionState = state; },

    // Axe handlers
    axeHandlers,
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
    AutoTranscriber,
  };
}

export {
  tools,
  enableTool,
  disableTool,
  getToolStatus,
  applyProfileByName as applyProfile,
  listProfiles,
  listTools,
  auditors,
  aiFixes,
};
