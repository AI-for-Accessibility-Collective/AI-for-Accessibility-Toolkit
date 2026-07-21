// Content fix adapters (AI-powered)
export * from './generate-alt.js';
export * from './generate-labels.js';
export * from './generate-captions.js';
export * from './simplify-text.js';
export * from './fix-contrast.js';
export * from './wcag-fixes.js';
export * from './fix-links.js';
export * from './fix-tables.js';
export * from './fix-landmarks.js';

// Visual preference adapters
export { VisualAssist } from './visual-assist.js';
export { DarkMode } from './dark-mode.js';
export { MotionReducer } from './motion-reducer.js';
export { FocusMode } from './focus-mode.js';
export { ReadAloud } from './read-aloud.js';
export { ReaderMode } from './reader-mode.js';
export { VoiceCommands } from './voice-commands.js';
export { KeyboardNavigator } from './keyboard-nav.js';
export { ColorBlindMode } from './color-blind.js';
export { AutoTranscriber } from './auto-transcriber.js';
export { DismissOverlays } from './dismiss-overlays.js';
export { BigTargets } from './big-targets.js';

// Collect all axe handlers from adapters
import { axeHandlers as altHandlers } from './generate-alt.js';
import { axeHandlers as labelHandlers } from './generate-labels.js';
import { axeHandlers as captionHandlers } from './generate-captions.js';
import { axeHandlers as contrastHandlers } from './fix-contrast.js';
import { axeHandlers as wcagHandlers } from './wcag-fixes.js';
import { axeHandlers as landmarkHandlers } from './fix-landmarks.js';

export const axeHandlers = {
  ...altHandlers,
  ...labelHandlers,
  ...captionHandlers,
  ...contrastHandlers,
  ...wcagHandlers,
  ...landmarkHandlers,
};

// Run adapter by axe rule ID
export function getAxeHandler(ruleId) {
  return axeHandlers[ruleId] || null;
}
