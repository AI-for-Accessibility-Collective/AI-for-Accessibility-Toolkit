// ARIA required attributes with sensible defaults
export const ARIA_REQUIRED_ATTRS = {
  checkbox: { 'aria-checked': 'false' },
  combobox: { 'aria-expanded': 'false' },
  heading: { 'aria-level': '2' },
  listbox: {},
  meter: { 'aria-valuenow': '0' },
  option: { 'aria-selected': 'false' },
  progressbar: {},
  radio: { 'aria-checked': 'false' },
  scrollbar: { 'aria-controls': '', 'aria-valuenow': '0' },
  separator: { 'aria-valuenow': '0' },
  slider: { 'aria-valuenow': '0' },
  spinbutton: {},
  switch: { 'aria-checked': 'false' },
  tab: { 'aria-selected': 'false' },
  tabpanel: {},
  tree: {},
  treeitem: {}
};

// Deprecated ARIA roles and their replacements
export const DEPRECATED_ROLES = {
  directory: 'list'
};

// Common BCP 47 language codes
export const VALID_LANGS = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
  'bn', 'pa', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'th', 'vi', 'id', 'ms',
  'tl', 'pl', 'uk', 'ro', 'el', 'cs', 'hu', 'sv', 'da', 'fi', 'no', 'he', 'tr'
]);

// Valid ARIA attributes
export const VALID_ARIA_ATTRS = new Set([
  'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-braillelabel',
  'aria-brailleroledescription', 'aria-busy', 'aria-checked', 'aria-colcount',
  'aria-colindex', 'aria-colindextext', 'aria-colspan', 'aria-controls',
  'aria-current', 'aria-describedby', 'aria-description', 'aria-details',
  'aria-disabled', 'aria-dropeffect', 'aria-errormessage', 'aria-expanded',
  'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
  'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live',
  'aria-modal', 'aria-multiline', 'aria-multiselectable', 'aria-orientation',
  'aria-owns', 'aria-placeholder', 'aria-posinset', 'aria-pressed', 'aria-readonly',
  'aria-relevant', 'aria-required', 'aria-roledescription', 'aria-rowcount',
  'aria-rowindex', 'aria-rowindextext', 'aria-rowspan', 'aria-selected',
  'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow',
  'aria-valuetext'
]);

// Valid ARIA roles
export const VALID_ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote',
  'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
  'command', 'comment', 'complementary', 'composite', 'contentinfo', 'definition',
  'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure',
  'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'input',
  'insertion', 'landmark', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
  'mark', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option', 'paragraph',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'range', 'region',
  'roletype', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
  'section', 'sectionhead', 'select', 'separator', 'slider', 'spinbutton',
  'status', 'strong', 'structure', 'subscript', 'superscript', 'switch', 'tab',
  'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar',
  'tooltip', 'tree', 'treegrid', 'treeitem', 'widget', 'window'
]);

// Iframe title patterns based on URL
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
