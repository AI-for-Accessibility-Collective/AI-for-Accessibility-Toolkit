/**
 * Settings & Profiles Configuration
 *
 * EXTENDING PROFILES:
 * 1. Add a new profile to `profiles` object
 * 2. Map the tools/settings for that profile
 * 3. The profile will appear in the popup dropdown
 */

// Default settings for all tools
const defaults = {
  enabled: true,
  // AI tools
  autoDescribe: true,
  autoVideoDescribe: false,
  autoSimplify: false,
  autoWcagFix: true,
  autoSummarize: false,
  autoFixLabels: true,
  autoCaptions: false,
  fixContrast: true,
  // Visual tools
  darkMode: false,
  dyslexiaFont: false,
  largeCursor: false,
  enhanceFocus: false,
  readingGuide: false,
  motionReducer: false,
  // Reading tools
  readerMode: false,
  focusMode: false,
  // Navigation tools
  keyboardNav: false,
  voiceCommands: false,
  // Display settings
  fontScale: 100,
  lineHeight: 1.5,
  letterSpacing: 0,
  colorFilter: 'none'
};

// Current settings (mutable)
let settings = { ...defaults };

/**
 * Accessibility Profiles
 *
 * Each profile maps to a set of tools that help users with specific needs.
 * Add new profiles here - they'll be available in the popup.
 */
export const profiles = {
  // Vision impairments
  lowVision: {
    name: 'Low Vision',
    description: 'Larger text, enhanced focus indicators',
    tools: {
      fontScale: 150,
      lineHeight: 2.0,
      largeCursor: true,
      enhanceFocus: true,
      fixContrast: true
    }
  },

  blind: {
    name: 'Blind',
    description: 'Optimized for screen reader users',
    tools: {
      autoDescribe: true,
      autoVideoDescribe: true,
      autoFixLabels: true,
      autoWcagFix: true,
      keyboardNav: true
    }
  },

  colorBlind: {
    name: 'Color Blindness',
    description: 'Color filters and enhanced contrast',
    tools: {
      fixContrast: true,
      colorFilter: 'deuteranopia'
    }
  },

  // Reading/cognitive
  dyslexia: {
    name: 'Dyslexia',
    description: 'Dyslexia-friendly font and spacing',
    tools: {
      dyslexiaFont: true,
      fontScale: 115,
      lineHeight: 2.0,
      letterSpacing: 0.12,
      focusMode: true
    }
  },

  adhd: {
    name: 'ADHD',
    description: 'Reduced distractions, focus mode',
    tools: {
      focusMode: true,
      motionReducer: true,
      readerMode: true
    }
  },

  cognitive: {
    name: 'Cognitive',
    description: 'Simplified text, summaries',
    tools: {
      autoSimplify: true,
      autoSummarize: true,
      fontScale: 120,
      lineHeight: 1.8,
      focusMode: true
    }
  },

  // Motor
  motor: {
    name: 'Motor',
    description: 'Keyboard navigation, large targets',
    tools: {
      largeCursor: true,
      enhanceFocus: true,
      keyboardNav: true
    }
  },

  // Sensory
  photosensitive: {
    name: 'Photosensitive',
    description: 'Dark mode, reduced motion',
    tools: {
      darkMode: true,
      motionReducer: true
    }
  },

  deaf: {
    name: 'Deaf/HoH',
    description: 'Auto captions for media',
    tools: {
      autoCaptions: true,
      autoVideoDescribe: true,
      enhanceFocus: true
    }
  },

  // Mental health
  anxiety: {
    name: 'Anxiety',
    description: 'Calm interface, reduced motion',
    tools: {
      focusMode: true,
      motionReducer: true,
      readerMode: true,
      lineHeight: 1.8
    }
  },

  // Older adults
  elderly: {
    name: 'Elderly',
    description: 'Larger text, simplified content',
    tools: {
      fontScale: 150,
      lineHeight: 1.8,
      enhanceFocus: true,
      autoSimplify: true,
      autoSummarize: true
    }
  },

  // Sensory processing
  sensory: {
    name: 'Sensory Processing',
    description: 'Reduced stimulation, calm interface',
    tools: {
      motionReducer: true,
      darkMode: true,
      focusMode: true
    }
  }
};

// Load settings from storage (extension overrides this)
export async function loadSettings(storageGetter) {
  if (storageGetter) {
    const stored = await storageGetter();
    if (stored) {
      settings = { ...defaults, ...stored };
    }
  }
  return settings;
}

// Get current settings
export function getSettings() {
  return settings;
}

// Update settings
export function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
}

// Apply a profile
export function applyProfile(profileId) {
  const profile = profiles[profileId];
  if (profile?.tools) {
    // Reset to defaults first, then apply profile tools
    settings = { ...defaults, ...profile.tools };
    console.log(`[AI4A11y] Applied profile: ${profile.name}`);
    return true;
  }
  return false;
}

// Get profile by ID
export function getProfile(profileId) {
  return profiles[profileId];
}

// Get all profiles (for UI)
export function getAllProfiles() {
  return Object.entries(profiles).map(([id, profile]) => ({
    id,
    name: profile.name,
    description: profile.description
  }));
}

// Check if a feature is enabled
export function isEnabled(feature) {
  return settings[feature] === true;
}

// Get a setting value
export function getSetting(key) {
  return settings[key];
}

// Get list of enabled adapters for a profile
export function getEnabledAdapters(profileId) {
  const profile = profiles[profileId];
  if (!profile?.tools) return [];

  const enabled = [];
  const tools = profile.tools;

  // Map tool settings to adapter names
  if (tools.autoDescribe) enabled.push('generate-alt');
  if (tools.autoVideoDescribe) enabled.push('generate-alt'); // video descriptions
  if (tools.autoSimplify) enabled.push('simplify-text');
  if (tools.autoSummarize) enabled.push('simplify-text'); // summarization
  if (tools.autoWcagFix) enabled.push('wcag-fixes');
  if (tools.autoFixLabels) enabled.push('generate-labels');
  if (tools.autoCaptions) enabled.push('generate-captions');
  if (tools.fixContrast) enabled.push('fix-contrast');
  if (tools.darkMode) enabled.push('dark-mode');
  if (tools.dyslexiaFont) enabled.push('visual-assist');
  if (tools.largeCursor) enabled.push('visual-assist');
  if (tools.enhanceFocus) enabled.push('focus-mode');
  if (tools.readingGuide) enabled.push('visual-assist');
  if (tools.motionReducer) enabled.push('motion-reducer');
  if (tools.readerMode) enabled.push('reader-mode');
  if (tools.focusMode) enabled.push('focus-mode');
  if (tools.keyboardNav) enabled.push('keyboard-nav');
  if (tools.voiceCommands) enabled.push('voice-commands');
  if (tools.colorFilter && tools.colorFilter !== 'none') enabled.push('color-blind');

  return [...new Set(enabled)]; // Remove duplicates
}

// Export settings object for direct access
export { settings, defaults };
