/**
 * Settings & Profiles — logic layer.
 *
 * Profile DATA lives in settings.json (single source of truth, also read
 * directly by cli/cli.py). This module adds merge/apply logic on top.
 *
 * EXTENDING PROFILES:
 * 1. Add a new profile to settings.json
 * 2. Map the tools/settings for that profile
 * 3. It appears in the popup and `ai4a11y list profiles` automatically
 */

import profileData from './settings.json' with { type: 'json' };

export const profiles = profileData.profiles;
export const defaults = profileData.defaults;

// Current settings (mutable)
let settings = { ...defaults };

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

/**
 * Merge the tool settings of multiple profiles into one settings object.
 * Booleans: OR (any profile enabling a feature wins, except explicit false
 * only yields when no other profile set true). Numbers: MAX. Color filter:
 * last non-none wins. Shared by the popup presets and applyProfiles so the
 * extension UI and the profiles module can never disagree.
 */
export function mergeProfileTools(profileIds) {
  const numericKeys = ['fontScale', 'lineHeight', 'letterSpacing'];
  const merged = {};

  for (const profileId of profileIds) {
    const profile = profiles[profileId];
    if (!profile?.tools) continue;

    for (const [key, value] of Object.entries(profile.tools)) {
      if (numericKeys.includes(key) && typeof value === 'number') {
        merged[key] = Math.max(merged[key] || 0, value);
      } else if ((key === 'colorFilter' || key === 'contrastMode') && value !== 'none') {
        merged[key] = value;
      } else {
        merged[key] = merged[key] || value;
      }
    }
  }
  return merged;
}

// Apply a single profile
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

// Apply multiple profiles (merges all their tools)
export function applyProfiles(profileIds) {
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    settings = { ...defaults };
    return false;
  }

  settings = { ...defaults, ...mergeProfileTools(profileIds) };
  const names = profileIds.map(id => profiles[id]?.name).filter(Boolean);
  console.log(`[AI4A11y] Applied profiles: ${names.join(', ')}`);
  return true;
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
  if (tools.enhanceFocus) enabled.push('visual-assist');
  if (tools.readingGuide) enabled.push('visual-assist');
  if (tools.fontScale && tools.fontScale !== 100) enabled.push('visual-assist');
  if (tools.motionReducer) enabled.push('motion-reducer');
  if (tools.dismissOverlays) enabled.push('dismiss-overlays');
  if (tools.bigTargets) enabled.push('big-targets');
  if (tools.highlightLinks) enabled.push('link-highlighter');
  if (tools.pageOutline) enabled.push('page-outline');
  if (tools.bionicReading) enabled.push('bionic-reading');
  if (tools.unpinSticky) enabled.push('unpin-sticky');
  if (tools.translatePage) enabled.push('translate-page');
  if (tools.muteSounds) enabled.push('mute-sounds');
  if (tools.defineWords) enabled.push('define-words');
  if (tools.stopAutoAdvance) enabled.push('stop-auto-advance');
  if (tools.reduceBrightness) enabled.push('reduce-brightness');
  if (tools.soundVisualizer) enabled.push('sound-visualizer');
  if (tools.announceUpdates) enabled.push('live-region-announcer');
  if (tools.magnifier) enabled.push('magnifier');
  if (tools.flashGuard) enabled.push('flash-guard');
  if (tools.describeOnDemand) enabled.push('describe-on-demand');
  if (tools.readerMode) enabled.push('reader-mode');
  if (tools.focusMode) enabled.push('focus-mode');
  if (tools.keyboardNav) enabled.push('keyboard-nav');
  if (tools.voiceCommands) enabled.push('voice-commands');
  if (tools.colorFilter && tools.colorFilter !== 'none') enabled.push('color-blind');

  return [...new Set(enabled)]; // Remove duplicates
}

// Export settings object for direct access
export { settings };
