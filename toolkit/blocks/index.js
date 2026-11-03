// The toolkit's building blocks for adapters: one implementation of what
// adapters kept writing for themselves (undo, styles, watching the page,
// reading it, highlighting, announcing, tooltips, panels, focus and keys,
// text changes, AI text and vision, speech, media), each with a config a
// builder sets and invariants nobody can configure away. See catalog.js and
// docs/design/building-blocks.md.
//
//   const toolkit = createBlocks({ win: window, adapter: 'plain-words', personal, ai, capture });
//   const s = toolkit.session();   ...   s.end();
//
// The browser runtime hands these to every adapter as enable()'s second
// argument (runtime.js is the bundle it injects); a host embedding adapters
// itself calls createBlocks with its own `ai` transport.

export { createBlocks, setPersonal, setShortcut } from './create.js';
export { SHORTCUT_FIELD, SHORTCUT_DEFAULT, parseCombo, comboOf, checkCombo, normalCombo, comboLabel, shortcutFromProfile, shortcutKeysFromProfile } from './shortcut.js';
export { Ended } from './session.js';
export { BLOCK_NAMES, BLOCKS_VERSION } from './names.js';
export { CATALOG, EXAMPLE } from './catalog.js';
export { personalFromProfile, PERSONAL_KEYS, SETTABLE_KEYS, personalFromSettings, explicitFromMemories, personalForSite, siteOf } from './personal.js';
export { buildPrompt, cleanOptions, PROMPT_FIELDS, TASKS, PROMPT_VERSION, NO_ANSWER } from './ai/prompts.js';
export { parseColor, contrast } from './color.js';
