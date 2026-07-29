// Re-export of the canonical adapter — one source of truth. The pext build's
// pext-utils-redirect plugin resolves the canonical file's utils import to
// this extension's provider. Edit the canonical file, not this one.
export * from '../../../tools/adapters/agent-watch.js';
