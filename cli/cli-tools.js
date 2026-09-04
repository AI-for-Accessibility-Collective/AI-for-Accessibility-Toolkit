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
import { PersistentHover } from '../tools/adapters/persistent-hover.js';
import { ReadingRuler } from '../tools/adapters/reading-ruler.js';
import { ConfirmActions } from '../tools/adapters/confirm-actions.js';
import { ReadingSpot } from '../tools/adapters/reading-spot.js';
import { AbbreviationExpand } from '../tools/adapters/abbreviation-expand.js';
import { LanguageTag } from '../tools/adapters/language-tag.js';
import { ExploreAChart } from '../tools/adapters/explore-a-chart.js';
import { SpaFocus } from '../tools/adapters/spa-focus.js';
import { SkipLinks } from '../tools/adapters/skip-links.js';
import { MathA11y } from '../tools/adapters/math-a11y.js';
import { AutoTranscriber } from '../tools/adapters/auto-transcriber.js';
import { ShowCaptions } from '../tools/adapters/show-captions.js';
import { FixLandmarks } from '../tools/adapters/fix-landmarks.js';

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

// Import non-AI WCAG fixes. The three named fixes drive the page sweeps in
// runFullScan; the axe-driven dispatch goes through the adapter's own
// axeHandlers map so the wcagRiskyFixes gate applies here as well, and
// isRiskyFix says which rule ids that gate covers.
import {
  axeHandlers as wcagAxeHandlers,
  isRiskyFix,
  fixDuplicateId,
  fixPositiveTabindex,
  fixTargetBlank
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
    extractChartData: async (imageData, context) => {
      if (typeof window.ai4a11y_extractChartData === 'function') {
        return await window.ai4a11y_extractChartData(imageData, context);
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
  persistentHover: PersistentHover,
  readingRuler: ReadingRuler,
  confirmActions: ConfirmActions,
  rememberSpot: ReadingSpot,
  expandAbbreviations: AbbreviationExpand,
  languageTag: LanguageTag,
  exploreChart: ExploreAChart,
  spaFocus: SpaFocus,
  skipLinks: SkipLinks,
  mathAccessible: MathA11y,
  showCaptions: ShowCaptions,
  fixLandmarks: FixLandmarks,
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
    'showcaptions': 'showCaptions',
    'captions': 'showCaptions',
    'fixlandmarks': 'fixLandmarks',
    'landmarks': 'fixLandmarks',
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
    'persistenthover': 'persistentHover',
    'hover': 'persistentHover',
    'readingruler': 'readingRuler',
    'ruler': 'readingRuler',
    'confirmactions': 'confirmActions',
    'confirm': 'confirmActions',
    'rememberspot': 'rememberSpot',
    'readingspot': 'rememberSpot',
    'expandabbreviations': 'expandAbbreviations',
    'abbreviations': 'expandAbbreviations',
    'languagetag': 'languageTag',
    'langtag': 'languageTag',
    'explorechart': 'exploreChart',
    'charttable': 'exploreChart',
    'chart': 'exploreChart',
    'spafocus': 'spaFocus',
    'routefocus': 'spaFocus',
    'skiplinks': 'skipLinks',
    'skipnav': 'skipLinks',
    'mathaccessible': 'mathAccessible',
    'matha11y': 'mathAccessible',
    'math': 'mathAccessible',
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

  // Apply profile settings via adapters.
  // FLAG(review): this is the CLI's own copy of the key-to-adapter mapping.
  // The catalog's copy is adaptersForTools in tools/profiles/settings.js; the
  // two are kept in step by hand, and the parity test checks only the
  // catalog's.
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
  if (profileTools.persistentHover) PersistentHover.enable();
  if (profileTools.readingRuler) ReadingRuler.enable();
  if (profileTools.confirmActions) ConfirmActions.enable();
  if (profileTools.rememberSpot) ReadingSpot.enable();
  if (profileTools.expandAbbreviations) AbbreviationExpand.enable();
  if (profileTools.languageTag) LanguageTag.enable();
  if (profileTools.exploreChart) ExploreAChart.enable();
  if (profileTools.spaFocus) SpaFocus.enable();
  if (profileTools.skipLinks) SkipLinks.enable();
  if (profileTools.mathAccessible) MathA11y.enable();
  if (profileTools.keyboardNav) KeyboardNavigator.enable();
  if (profileTools.voiceCommands) VoiceCommands.enable();
  // Profiles say colorFilter, the registry says colorBlindMode; read both,
  // the same way the extension's content script and adaptersForTools do, and
  // do not let 'none' under one name hide a filter set under the other.
  const colorMode = [profileTools.colorFilter, profileTools.colorBlindMode].find((v) => v && v !== 'none');
  if (colorMode) ColorBlindMode.enable(colorMode);
  if (profileTools.autoCaptions) AutoTranscriber.enable();
  if (profileTools.showCaptions) ShowCaptions.enable();
  if (profileTools.fixLandmarks) FixLandmarks.enable();

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
    showCaptions: 'Switch on the captions media already carries (no AI)',
    fixLandmarks: 'Add missing main, banner, and contentinfo landmarks',
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
    persistentHover: 'Keep hover tooltips visible and dismissible (WCAG 1.4.13)',
    readingRuler: 'A highlight band that follows your reading line',
    confirmActions: 'Ask for confirmation before risky or final actions',
    rememberSpot: 'Remember where you were reading and offer to jump back',
    expandAbbreviations: 'Expand abbreviations and acronyms to their full form',
    languageTag: 'Tag foreign-language text so screen readers pronounce it correctly',
    exploreChart: 'Read a chart or graph as a navigable data table',
    spaFocus: 'Announce and move focus on single-page-app navigations',
    skipLinks: 'Add skip-to-content and skip-to-navigation links',
    mathAccessible: 'Give math and equations an accessible name for screen readers',
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
    // Only the wcag-fixes handlers read a settings object from their second
    // parameter. The other adapters in the merged map use that slot for
    // something else (fixLowContrast takes a color there), and several of
    // them return false to mean "nothing to do" rather than "held back", so
    // the settings argument and the false check are both scoped to the
    // rules the gate actually covers.
    const risky = isRiskyFix(ruleId);
    const applied = risky
      ? await handler(el, getActiveProfileSettings())
      : await handler(el);
    if (risky && applied === false) {
      return { skipped: 'risky', error: `Risky fix ${ruleId} is off (the active profile does not set wcagRiskyFixes)` };
    }
    return { success: true };
  }
};

// Non-AI fix handlers (pure DOM manipulation). This is the adapter's own
// map, not a copy: a risky entry (heading re-tag, ARIA strip, nested control
// unwrap, target size) runs only when the active profile sets
// wcagRiskyFixes, and returns false when it skipped.
const nonAiFixes = wcagAxeHandlers;

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
    skipped: { needsAi: [], noHandler: [], risky: [] }
  };

  // The active profile's tools. Read once: the risky-fix gate consults it for
  // every violation, and the text passes below read it too.
  const settings = getActiveProfileSettings();

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
          if (nonAiFixes[ruleId](el, settings) === false) {
            results.skipped.risky.push(ruleId);
          } else {
            results.fixed.nonAi++;
          }
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

// Text processing for cognitive profiles.
//
// What "complex" means here: the block is longer than COMPLEX_TEXT_MIN_CHARS
// and at least one sentence has more than COMPLEX_SENTENCE_MIN_WORDS words.
// No syllable count, no readability formula, and no WCAG criterion behind
// either number (3.1.5 Reading Level is about lower secondary education
// level, which this does not measure). Heuristic, English-leaning (sentences
// split on . ! ?), best-effort. The simplify-text adapter uses a different
// definition (100 to 10,000 characters), the browser validation harness in
// tools/test/validate-entry.js carries a copy of this function, and the
// extension has a third cutoff; one shared definition is issue #35.
const COMPLEX_TEXT_MIN_CHARS = 200;
const COMPLEX_SENTENCE_MIN_WORDS = 15;
function findComplexText() {
  return Array.from(document.querySelectorAll('p, li, td, div'))
    .filter(el => {
      if (el.dataset.ai4a11yProcessed) return false;
      if (el.dataset.ai4a11ySimplified) return false;
      if (el.querySelector('p, div, article, section')) return false;
      const text = el.textContent?.trim() || '';
      // Complex = a long block with at least one long sentence (see the constants above)
      return text.length > COMPLEX_TEXT_MIN_CHARS &&
        text.split(/[.!?]/).some(s => s.trim().split(/\s+/).length > COMPLEX_SENTENCE_MIN_WORDS);
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

// Helper to get CSS selector for element.
//
// Every selector this returns is handed back to document.querySelector by the
// commands that apply a fix, so it has to address one element and no other. A
// short form is used when it already does; otherwise the element gets a
// structural path built from :nth-of-type steps. Returning a bare tag name for
// a classless element made all of them share a selector, so a run over ten
// images rewrote the first image ten times, each pass overwriting the last.
function getSelector(el) {
  if (!el || !el.tagName) return 'unknown';
  const doc = el.ownerDocument || document;
  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s);
  const addressesOnlyThis = (sel) => {
    try {
      const found = doc.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;  // an id or class that is not a valid selector
    }
  };

  if (el.id) {
    const byId = `#${esc(el.id)}`;
    if (addressesOnlyThis(byId)) return byId;
  }

  const tag = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c).slice(0, 2).map(esc).join('.');
    if (classes && addressesOnlyThis(`${tag}.${classes}`)) return `${tag}.${classes}`;
  }

  // Walk up, adding one step per level, until the path is unambiguous. Stops at
  // an ancestor with a usable id so the result stays as short as it can be.
  const step = (node) => {
    const name = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) return name;
    const twins = Array.from(parent.children).filter(c => c.tagName === node.tagName);
    return twins.length === 1 ? name : `${name}:nth-of-type(${twins.indexOf(node) + 1})`;
  };

  const parts = [];
  for (let node = el; node && node.tagName; node = node.parentElement) {
    if (node !== el && node.id) {
      const rooted = `#${esc(node.id)} > ${parts.join(' > ')}`;
      if (addressesOnlyThis(rooted)) return rooted;
    }
    parts.unshift(step(node));
    const path = parts.join(' > ');
    if (addressesOnlyThis(path)) return path;
  }
  return parts.join(' > ');
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
