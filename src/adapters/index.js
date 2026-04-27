// Import all adapter modules
import { axeHandlers as altHandlers } from './generate-alt.js';
import { axeHandlers as labelHandlers } from './generate-labels.js';
import { axeHandlers as contrastHandlers } from './fix-contrast.js';
import { axeHandlers as captionHandlers } from './generate-captions.js';
import { axeHandlers as wcagHandlers } from './wcag-fixes.js';

// Combined mapping of axe rule IDs to fix handlers
export const axeHandlers = {
  ...altHandlers,
  ...labelHandlers,
  ...contrastHandlers,
  ...captionHandlers,
  ...wcagHandlers
};

// Get handler for an axe rule ID
export function getHandler(ruleId) {
  return axeHandlers[ruleId] || null;
}

// Check if we have a handler for a rule
export function canFix(ruleId) {
  return ruleId in axeHandlers;
}

// Re-export individual adapters
export * from './generate-alt.js';
export * from './generate-labels.js';
export * from './fix-contrast.js';
export * from './generate-captions.js';
export * from './simplify-text.js';
export * from './wcag-fixes.js';
