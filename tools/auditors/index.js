// Re-export all auditors for easy importing
export * from './missing-alt.js';
export * from './missing-labels.js';
export * from './missing-captions.js';
export * from './missing-landmarks.js';
export * from './poor-contrast.js';
export * from './wcag-issues.js';

// Task-integrity auditor. Unlike the WCAG auditors above, this one needs a
// contract — what the person said they wanted — because "is this still yours?"
// is not answerable from the page alone.
export * from './contract-mismatch.js';
