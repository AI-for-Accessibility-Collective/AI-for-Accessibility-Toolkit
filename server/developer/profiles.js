// Developer test presets adapted from W3C WAI Stories of Web Users.
// These settings are our illustrative mappings, not profiles supplied by W3C.
export const SOURCE = 'https://www.w3.org/WAI/people-use-web/user-stories/';
const stories = [
  ['limited arm mobility', ['motor'], 'Support keyboard operation and easy navigation.',
    { keyboardAccess: true, skipLinks: true, labelControls: true }, {}],
  ['autism', ['cognitive', 'sensory'], 'Keep layouts predictable and remove distracting motion.',
    { reduceMotion: true, simplify: true, pageStructure: true }, {}],
  ['blindness', ['vision'], 'Provide image descriptions, control labels, and screen-reader structure.',
    { describeImages: true, labelControls: true, repairLandmarks: true, announceUpdates: true, spaAnnounce: true, skipLinks: true, keyboardAccess: true }, { visionKind: 'blind' }],
  ['color blindness', ['vision'], 'Use text and symbols alongside colors to communicate meaning.',
    { labelControls: true }, { visionKind: 'colorBlind', colorVision: ['deuteranopia', 'protanopia'], nonColorIndicators: true }],
  ['Down syndrome', ['cognitive', 'reading'], 'Use familiar words, explain abbreviations, and simplify instructions.',
    { simplify: true, pageStructure: true }, { readingLevel: 'plain' }],
  ['deafness', ['hearing'], 'Make spoken information available as captions and transcripts.',
    { captions: true }, { transcripts: true }],
  ['deafblindness', ['vision', 'hearing'], 'Combine magnified text with readable captions and transcripts.',
    { textSize: 2, lineSpacing: 1.6, captions: true, labelControls: true }, { visionKind: 'lowVision', transcripts: true }],
  ['ADHD and dyslexia', ['reading', 'cognitive'], 'Reduce distractions and support comfortable reading.',
    { reduceMotion: true, simplify: true, dyslexiaFont: true, lineSpacing: 1.6 }, { readingLevel: 'plain' }],
  ['low vision, tremor, and memory support', ['vision', 'motor', 'cognitive'], 'Offer larger text, easy controls, and consistent navigation.',
    { textSize: 1.5, lineSpacing: 1.5, keyboardAccess: true, labelControls: true, pageStructure: true }, { visionKind: 'lowVision', largeTargets: true, consistentNavigation: true }],
];
const slugs = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const BUILTIN_PROFILES = stories.map(([description, supportAreas, freeText, needs, fields], index) => ({
  id: `wai-${index + 1}`,
  name: `Profile ${index + 1}`,
  description,
  source: `${SOURCE}story-${slugs[index]}/`,
  profile: {
    supportAreas, freeText,
    fields: { ...fields, needs: Object.entries(needs).map(([dimension, value]) => ({
      dimension, value, strength: 'preference', source: 'developer-wai-preset',
    })) },
    metaPreferences: { language: fields.readingLevel === 'plain' ? 'plain' : 'standard', consentBoundary: 'profile-only' },
  },
}));
