// What each profile field is called in the editor, in plain words, with a
// short caption saying what it is for. The profile keeps the toolkit's key
// (metaPreferences.language); the editor shows the name. A key not listed
// here is shown by its key path.

const STORED = 'The toolkit keeps it but does not act on it; an adapter can read it by name.';

export const FIELDS = {
  supportAreas: { name: 'Support areas', caption: 'The broad areas the person wants support with.' },
  freeText: { name: 'In their own words', caption: 'How the person describes their abilities and what gets in their way. Never shared with other apps.' },
  'fields.needs': { name: 'Needs', caption: 'What pages should do for the person. The toolkit turns these into settings, and adapters follow them.' },
  'fields.wordsSummary': { name: 'Summary', caption: 'One sentence on what pages will do, from the last reading of their words.' },
  'fields.readingLevel': { name: 'Reading level', caption: 'Plain, easy read, or a school grade from 1 to 12. Text the toolkit’s AI writes follows it.' },
  'fields.visionKind': { name: 'Kind of vision support', caption: `Blind, low vision, or color blindness. ${STORED}` },
  'fields.colorVision': { name: 'Kinds of color blindness', caption: STORED },
  'fields.nonColorIndicators': { name: 'Show meaning without color', caption: STORED },
  'fields.transcripts': { name: 'Transcripts', caption: STORED },
  'fields.largeTargets': { name: 'Larger buttons and links', caption: STORED },
  'fields.consistentNavigation': { name: 'Consistent navigation', caption: STORED },
  'metaPreferences.language': { name: 'Language', caption: 'Plain language: text the toolkit’s AI writes uses plain words.' },
  'metaPreferences.sharing': { name: 'Sharing', caption: 'Who apps may share the profile with. An app allowed a wider circle gets nothing.' },
  'metaPreferences.consentBoundary': { name: 'Consent boundary', caption: 'Which of the toolkit’s memory the person agrees to it using. Stored; the toolkit does not act on it yet.' },
  'metaPreferences.maxProposalsPerWeek': { name: 'Suggestions a week', caption: 'At most this many profile changes the toolkit suggests in a week.' },
  memoryPaused: { name: 'Memory paused', caption: 'When on, the toolkit stops learning from what the person does.' },
  sharingPaused: { name: 'Sharing paused', caption: 'When on, no other app can read the profile.' },
};

/** The names a choice's values show as. */
export const CHOICES = {
  'metaPreferences.language': { standard: 'Standard', plain: 'Plain language' },
  'metaPreferences.sharing': { personal: 'Only the person', friends: 'Family, friends and carers', anyone: 'Anyone' },
  'metaPreferences.consentBoundary': { 'profile-only': 'Profile only', 'all-tiers': 'All of its memory' },
  'fields.visionKind': { blind: 'Blind', lowVision: 'Low vision', colorBlind: 'Color blindness' },
};

/** {name, caption} for a key path; a key not listed is named by its path. */
export function fieldInfo(key) {
  return FIELDS[key] || { name: key, caption: 'A custom field. The toolkit keeps it; an adapter can read it by name.' };
}

// A need's own properties.
export const NEED_FIELDS = {
  dimension: { name: 'Need', caption: 'What pages should do.' },
  value: { name: 'Value', caption: 'How much, or on and off.' },
  strength: { name: 'Level', caption: 'When two needs set the same thing, the higher level wins: must have, then preferred, then nice to have.' },
  unit: { name: 'Unit', caption: 'What the number measures.' },
  source: { name: 'Source', caption: 'Where the need came from: a person, their words, or a preset.' },
};
