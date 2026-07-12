// Re-export build-time-generated ARIA tables so all consumers get a single
// source of truth driven by aria-query (no hand-rolled lists of roles/attrs).
// Run `npm run build` to regenerate utils/aria-tables.gen.js.
export { VALID_ARIA_ROLES, VALID_ARIA_ATTRS } from './aria-tables.gen.js';

// ARIA_REQUIRED_ATTRS: maps role → required attributes with safe placeholder
// defaults. State attributes (aria-checked, aria-expanded, aria-selected) are
// intentionally EXCLUDED — wcag-fixes must NOT guess widget state (would lie
// to screen readers). Only structural attributes with safe neutral values.
export const ARIA_REQUIRED_ATTRS = {
  heading:     { 'aria-level': '2' },
  meter:       { 'aria-valuenow': '0' },
  scrollbar:   { 'aria-controls': '', 'aria-valuenow': '0' },
  separator:   { 'aria-valuenow': '0' },
  slider:      { 'aria-valuenow': '0' },
};

export const DEPRECATED_ROLES = {
  directory: 'list'
};

// VALID_LANGS is no longer used for lang validation (the BCP-47 structural
// validator in wcag-fixes.js replaces it). Kept as a named export so any
// remaining import sites don't break; consumers should migrate to isValidBcp47.
export const VALID_LANGS = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
  'bn', 'pa', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'th', 'vi', 'id', 'ms',
  'tl', 'pl', 'uk', 'ro', 'el', 'cs', 'hu', 'sv', 'da', 'fi', 'no', 'he', 'tr'
]);

export const IFRAME_PATTERNS = {
  'youtube.com': 'YouTube video',
  'vimeo.com': 'Vimeo video',
  'maps.google': 'Google Maps',
  'google.com/maps': 'Google Maps',
  'twitter.com': 'Twitter embed',
  'x.com': 'Twitter embed',
  'facebook.com': 'Facebook embed',
  'instagram.com': 'Instagram embed',
  'spotify.com': 'Spotify player',
  'soundcloud.com': 'SoundCloud player',
  'codepen.io': 'CodePen demo',
  'jsfiddle.net': 'JSFiddle demo',
  'codesandbox.io': 'CodeSandbox',
  'calendly.com': 'Calendly scheduler',
  'typeform.com': 'Form',
  'stripe.com': 'Payment form',
  'recaptcha': 'CAPTCHA verification'
};
