/**
 * CLI Tools Bundle Entry Point
 *
 * This module bundles all adapters and profiles for injection into Playwright.
 * Unlike the extension (which uses Chrome messaging), this exposes tools
 * directly on window.ai4a11y for Playwright's page.evaluate() to call.
 */

// Import all adapters
import { VisualAssist } from '../tools/adapters/visual-assist.js';
import { DarkMode } from '../tools/adapters/dark-mode.js';
import { MotionReducer } from '../tools/adapters/motion-reducer.js';
import { FocusMode } from '../tools/adapters/focus-mode.js';
import { ReadAloud } from '../tools/adapters/read-aloud.js';
import { ReaderMode } from '../tools/adapters/reader-mode.js';
import { VoiceCommands } from '../tools/adapters/voice-commands.js';
import { KeyboardNavigator } from '../tools/adapters/keyboard-nav.js';
import { ColorBlindMode } from '../tools/adapters/color-blind.js';
import { AutoTranscriber } from '../tools/adapters/auto-transcriber.js';

// Import profiles
import {
  profiles,
  getProfile,
  applyProfile,
  applyProfiles,
  getEnabledAdapters,
  getAllProfiles
} from '../tools/profiles/settings.js';

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
  };
  return descriptions[name] || '';
}

// Expose on window for Playwright access
if (typeof window !== 'undefined') {
  window.ai4a11y = {
    tools,
    profiles,
    enableTool,
    disableTool,
    getToolStatus,
    applyProfile: applyProfileByName,
    listProfiles,
    listTools,
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
};
