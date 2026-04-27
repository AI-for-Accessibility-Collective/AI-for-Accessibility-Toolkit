import { sendMessage } from './utils/messaging.js';

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

// Load settings from storage
export async function loadSettings() {
  const response = await sendMessage({ type: 'getSettings' });
  if (response?.success && response.result) {
    settings = { ...defaults, ...response.result };
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

// Export settings object for direct access
export { settings, defaults };
