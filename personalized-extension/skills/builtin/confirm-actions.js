// Re-export of the canonical adapter — one source of truth. This fork was
// identical to tools/adapters/confirm-actions.js except for its utils import depth,
// which the pext build's pext-utils-redirect plugin resolves to this
// extension's provider utils. Edit the canonical file, not this one.
export * from '../../../tools/adapters/confirm-actions.js';
