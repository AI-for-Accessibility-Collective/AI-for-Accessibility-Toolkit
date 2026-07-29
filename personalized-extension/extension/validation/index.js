// The validation layer, inside the extension.
//
// Re-export of the canonical layer in tools/validators — one source of truth,
// the same convention the adapters use. Edit the canonical files, not these.
//
// What this adds over the raw reader: the pieces that only make sense with a
// person on the other end — how hard to insist on a finding, and how the same
// finding renders for someone who can see the page against someone who cannot.

export { read, EXTRACTORS, tiles } from '../../../tools/validators/reader.js';
export { parseAria } from '../../../tools/validators/aria-parse.js';
export { checkPage, CHECKS } from './checks.js';
export { decide, LEVELS } from './policy.js';
export { renderSpoken, renderVisual, render } from './render.js';
export { createRun } from './run.js';
