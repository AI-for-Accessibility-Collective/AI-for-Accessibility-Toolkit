// AI for Accessibility Toolkit — Shared Tools
// Used by both Chrome extension and CLI

import {
  setAIProvider,
  getAIProvider,
  describeImage,
  describeVideo,
  simplifyText,
  summarizeText,
  generateLabels,
  generateCaptions,
  inferLabel,
  fixContrast,
  getYouTubeTranscript,
  transcribeVideo,
  transcribeAudio,
  announce,
} from './utils/ai.js';

import * as auditors from './auditors/index.js';
import * as adapters from './adapters/index.js';
import { axeHandlers, getAxeHandler } from './adapters/index.js';
import { profiles, getProfile, getEnabledAdapters } from './profiles/settings.js';

// Re-export AI provider
export {
  setAIProvider,
  getAIProvider,
  describeImage,
  describeVideo,
  simplifyText,
  summarizeText,
  generateLabels,
  generateCaptions,
  inferLabel,
  fixContrast,
  getYouTubeTranscript,
  transcribeVideo,
  transcribeAudio,
  announce,
};

// Re-export auditors and adapters
export { auditors, adapters, axeHandlers, getAxeHandler };

// Re-export profiles
export { profiles, getProfile, getEnabledAdapters };

// Re-export utils
export { markProcessed, wasProcessed, isVisible, getAccessibleName } from './utils/dom.js';
export { getLuminance, getContrastRatio, getEffectiveBackground } from './utils/color.js';
export { imageToDataUrl, captureVideoFrames } from './utils/image.js';

// Re-export constants
export * from './constants.js';

// Expose globally for CLI injection
if (typeof window !== 'undefined') {
  window.ai4a11y = {
    setAIProvider,
    auditors,
    adapters,
    axeHandlers,
    getAxeHandler,
    profiles,
    getProfile,
  };
}
