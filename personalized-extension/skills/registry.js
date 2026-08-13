// Re-export shim — the canonical registry moved into the toolkit so every
// host (extension, server, XR, mobile) shares one settings vocabulary.
// Canonical source: toolkit/registry/tools.js. Same pattern as the
// tools/-adapter shims (fadcd34).
export * from '../../toolkit/registry/tools.js';
