// Nothing imports this file.
//
// It re-exported the whole layer for a consumer that never arrived, and it went
// stale: it exported `checkPage` and `CHECKS` from ./checks.js, which is now a
// four-line re-export of the auditor. background.js loads the esbuild bundle
// built from session.js, and every other consumer imports the module it needs
// directly.
//
// Kept as a marker rather than deleted, so the next person who looks for an
// entry point finds this note instead of writing one that also nothing uses.
// If you want a public surface for this layer, session.js is it.
export {};
