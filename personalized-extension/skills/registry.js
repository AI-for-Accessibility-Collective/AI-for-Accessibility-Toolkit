// Canonical built-in tools registry — the single source of truth for the
// "global Tools db" tier of the toolkit datastore.
//
// Consumed two ways:
//   1. Directly as ESM by node-side code (utils/recommender.js, tests).
//   2. Generated into extension/lib/tools-registry.js (a classic script
//      assigning globalThis.AA_TOOLS) by build.js, for extension pages and
//      the background service worker, which cannot load ES modules.
//
// Do NOT redefine tool entries elsewhere (the old inline copy in
// onboarding.js and its SKILL_TO_SETTINGS map are retired). Edit here, then
// `npm run build`.
//
// Per-entry fields:
//   settings   — chrome.storage.sync keys this tool sets when enabled
//                (was onboarding's SKILL_TO_SETTINGS).
//   emoji      — onboarding card icon. `icon` is the Material Symbols name
//                used by the popup.
//   quickStart — shown on the onboarding quick-start grid. AI
//                recommendations may still suggest non-quickStart tools.

export const skillRegistry = [
  {
    id: 'dark-mode',
    name: 'Dark Mode',
    description: 'Inverts page colors to a dark theme using DarkReader or CSS fallback, with configurable brightness, contrast, sepia, and grayscale.',
    supportAreas: ['vision', 'sensory'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'dark_mode',
    emoji: '\u{1F319}',
    quickStart: true,
    settings: { darkMode: true },
  },
  {
    id: 'focus-mode',
    name: 'Focus Mode',
    description: 'Dims distracting elements like ads and popups, optionally dims non-main content, highlights the paragraph you are reading, and shows a scroll progress bar.',
    supportAreas: ['cognitive', 'reading', 'sensory'],
    siteRelevance: ['news', 'education', 'social'],
    requiresAI: false,
    icon: 'center_focus_strong',
    emoji: '\u{1F3AF}',
    quickStart: true,
    settings: { focusMode: true, hideDistractions: true, showProgress: true },
  },
  {
    id: 'visual-assist',
    name: 'Visual Assist',
    description: 'Adjustable font size, line height, letter spacing, large cursor, reading guide, enhanced focus indicators, dyslexia font, and high-contrast modes.',
    supportAreas: ['vision', 'reading'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'visibility',
    emoji: '\u{1F441}️',
    quickStart: true,
    settings: { fontScale: 130, lineHeight: 1.8, enhanceFocus: true, readingGuide: true },
  },
  {
    id: 'motion-reducer',
    name: 'Reduce Motion',
    description: 'Stops animations, GIFs, auto-playing videos (including YouTube/Vimeo iframes), and parallax scrolling to reduce visual stimulation.',
    supportAreas: ['sensory', 'cognitive', 'vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'motion_photos_pause',
    emoji: '⏸️',
    quickStart: true,
    settings: { motionReducer: true },
  },
  {
    id: 'reader-mode',
    name: 'Reader Mode',
    description: 'Extracts the main article content and displays it in a clean, distraction-free overlay with XSS sanitization and byline extraction.',
    supportAreas: ['cognitive', 'reading', 'sensory'],
    siteRelevance: ['news', 'education'],
    requiresAI: false,
    icon: 'article',
    emoji: '\u{1F4C4}',
    quickStart: true,
    settings: { readerMode: true },
  },
  {
    id: 'dismiss-overlays',
    name: 'Dismiss Popups',
    description: 'Hides cookie/consent banners, newsletter modals, sticky promo bars, and blocking interstitials, restores locked scrolling, and keeps watching for popups injected after load.',
    supportAreas: ['cognitive', 'sensory', 'motor', 'vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'block',
    emoji: '\u{1F6AB}',
    quickStart: true,
    settings: { dismissOverlays: true },
  },
  {
    id: 'big-targets',
    name: 'Bigger Click Targets',
    description: 'Enlarges and spaces out small links, buttons, and inputs to a comfortable 44px click/touch size (WCAG 2.5.8) so they are easy to hit with a shaky hand, a single finger, or eye-gaze input.',
    supportAreas: ['motor', 'vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'ads_click',
    emoji: '\u{1F446}',
    quickStart: true,
    settings: { bigTargets: true },
  },
  {
    id: 'keyboard-nav',
    name: 'Keyboard Navigation',
    description: 'Adds skip links (main content and navigation), enhanced focus indicators, tab sequence overlay, and keyboard shortcuts (Alt+1/2/H/F).',
    supportAreas: ['motor', 'vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'keyboard',
    emoji: '⌨️',
    quickStart: true,
    settings: { keyboardNav: true },
  },
  {
    id: 'auto-alt-text',
    name: 'Auto Alt Text',
    description: 'Generates descriptive alt text for images, SVGs, canvas elements, and video frames using AI vision.',
    supportAreas: ['vision'],
    siteRelevance: ['all'],
    requiresAI: true,
    icon: 'image',
    emoji: '\u{1F5BC}️',
    quickStart: true,
    settings: { autoDescribe: true },
  },
  {
    id: 'fix-contrast',
    name: 'Fix Contrast',
    description: 'Detects text with poor color contrast and fixes it using AI color suggestions or black/white fallback to meet WCAG AA.',
    supportAreas: ['vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'contrast',
    emoji: '\u{1F3A8}',
    quickStart: true,
    settings: { autoWcagFix: true },
  },
  {
    id: 'simplify-text',
    name: 'Simplify Text',
    description: 'Rewrites complex text to a simpler reading level with a toggle to show the original, and adds summaries to long content.',
    supportAreas: ['cognitive', 'reading'],
    siteRelevance: ['news', 'education'],
    requiresAI: true,
    icon: 'edit_note',
    emoji: '✏️',
    quickStart: true,
    settings: { autoSimplify: true },
  },
  {
    id: 'voice-commands',
    name: 'Voice Commands',
    description: 'Hands-free browsing with voice commands, visual feedback HUD, interim results, and an expandable command set.',
    supportAreas: ['motor'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'mic',
    emoji: '\u{1F399}️',
    quickStart: true,
    settings: { voiceCommands: true },
  },
  {
    id: 'auto-captions',
    name: 'Auto Captions',
    description: 'Live caption overlay for videos with CC toggle button, YouTube caption auto-enable, and MutationObserver for dynamically added media.',
    supportAreas: ['hearing'],
    siteRelevance: ['video', 'social', 'education'],
    requiresAI: false,
    icon: 'closed_caption',
    emoji: '\u{1F4AC}',
    quickStart: true,
    settings: { autoCaptions: true },
  },
  {
    id: 'color-filter',
    name: 'Color Blind Filter',
    description: 'Applies SVG color correction filters for protanopia, deuteranopia, or tritanopia color vision deficiencies.',
    supportAreas: ['vision'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'palette',
    emoji: '\u{1F3A8}',
    quickStart: true,
    settings: { colorBlindMode: 'protanopia' },
  },
  {
    id: 'large-cursor',
    name: 'Large Cursor',
    description: 'Replaces the mouse cursor with a larger, more visible one.',
    supportAreas: ['vision', 'motor'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'mouse',
    emoji: '\u{1F5B1}️',
    quickStart: true,
    settings: { largeCursor: true },
  },
  {
    id: 'dyslexia-font',
    name: 'Dyslexia Font',
    description: 'Applies OpenDyslexic font with wider spacing for dyslexic readers.',
    supportAreas: ['reading', 'cognitive'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'text_fields',
    emoji: '\u{1F524}',
    quickStart: true,
    settings: { dyslexiaFont: true, letterSpacing: 0.12, lineHeight: 2.0 },
  },
  {
    id: 'read-aloud',
    name: 'Read Aloud',
    description: 'Text-to-speech with word boundary tracking, voice selection, rate/pitch controls, and presets (slow, normal, fast).',
    supportAreas: ['vision', 'reading', 'cognitive'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'volume_up',
    emoji: '\u{1F50A}',
    quickStart: false,
    settings: {},
  },
  {
    id: 'generate-labels',
    name: 'Generate Labels',
    description: 'AI-powered label generation for unlabeled links, buttons, iframes, and form inputs using context inference and pattern matching.',
    supportAreas: ['vision', 'motor'],
    siteRelevance: ['all'],
    requiresAI: true,
    icon: 'label',
    emoji: '\u{1F3F7}️',
    quickStart: false,
    settings: { autoFixLabels: true },
  },
  {
    id: 'generate-captions',
    name: 'Generate Captions',
    description: 'AI-powered caption generation for videos (WebVTT tracks) and audio elements (expandable transcripts).',
    supportAreas: ['hearing'],
    siteRelevance: ['video', 'education'],
    requiresAI: true,
    icon: 'subtitles',
    emoji: '\u{1F4AC}',
    quickStart: false,
    settings: { autoCaptions: true },
  },
  {
    id: 'wcag-fixes',
    name: 'WCAG Auto-Fix',
    description: 'Automatic fixes for common WCAG violations: lang attributes, duplicate IDs, heading order, tabindex, ARIA validation, touch targets, and more.',
    supportAreas: ['vision', 'motor', 'cognitive'],
    siteRelevance: ['all'],
    requiresAI: false,
    icon: 'verified',
    emoji: '✅',
    quickStart: false,
    settings: { autoWcagFix: true },
  },
];

// Typed vocabulary for every chrome.storage.sync setting the tools control.
// Single source for prompts that let the LLM set values directly (e.g. the
// popup's "what support do you need?" interpretNeeds call) — this replaces
// the hand-maintained list that used to live inline in background.js.
export const settingsMeta = {
  darkMode:        { type: 'boolean', description: 'Dark theme' },
  fontScale:       { type: 'number', range: [50, 200], description: 'Font size percentage' },
  lineHeight:      { type: 'number', range: [1.0, 3.0], description: 'Line spacing' },
  letterSpacing:   { type: 'number', range: [0, 0.5], description: 'Letter spacing in em' },
  dyslexiaFont:    { type: 'boolean', description: 'OpenDyslexic font' },
  largeCursor:     { type: 'boolean', description: 'Larger mouse cursor' },
  enhanceFocus:    { type: 'boolean', description: 'Stronger focus indicators' },
  readingGuide:    { type: 'boolean', description: 'Horizontal reading guide' },
  focusMode:       { type: 'boolean', description: 'Highlight current paragraph' },
  hideDistractions:{ type: 'boolean', description: 'Dim ads and popups' },
  showProgress:    { type: 'boolean', description: 'Scroll progress bar' },
  motionReducer:   { type: 'boolean', description: 'Stop animations' },
  readerMode:      { type: 'boolean', description: 'Clean reading view' },
  dismissOverlays: { type: 'boolean', description: 'Hide cookie banners, newsletter popups, and blocking modals' },
  bigTargets:      { type: 'boolean', description: 'Enlarge and space out small clickable controls' },
  keyboardNav:     { type: 'boolean', description: 'Enhanced keyboard navigation' },
  voiceCommands:   { type: 'boolean', description: 'Voice-controlled browsing' },
  contrastMode:    { type: 'enum', options: ['none', 'light', 'yellow-black'], description: 'Contrast level' },
  colorBlindMode:  { type: 'enum', options: ['none', 'protanopia', 'deuteranopia', 'tritanopia'], description: 'Color filter' },
  speechRate:      { type: 'number', range: [0.5, 2.0], description: 'Text-to-speech rate' },
  autoWcagFix:     { type: 'boolean', description: 'Auto-fix accessibility issues' },
  autoDescribe:    { type: 'boolean', description: 'AI image descriptions' },
  autoFixLabels:   { type: 'boolean', description: 'AI-generated form labels' },
  autoCaptions:    { type: 'boolean', description: 'Auto captions on video' },
  autoSimplify:    { type: 'boolean', description: 'Simplify complex text' },
  autoSummarize:   { type: 'boolean', description: 'Add summaries to long content' },
  autoVideoDescribe:{ type: 'boolean', description: 'AI video descriptions' },
};

export function getSkillById(id) {
  return skillRegistry.find(s => s.id === id);
}

export function getSkillsByArea(area) {
  return skillRegistry.filter(s => s.supportAreas.includes(area));
}

export function getRegistryForPrompt() {
  return skillRegistry.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    supportAreas: s.supportAreas,
    siteRelevance: s.siteRelevance,
  }));
}
