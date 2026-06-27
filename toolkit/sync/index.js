// toolkit/sync — the cross-app sharing + accessible-consent layer (Phase 3).
//
// Increment 1 ships the GRANT model only (read = a visible grant, routed
// through the existing proposal/consent machinery; no transport yet). The
// cross-app insight WRITE path, the acting-user partition, the Consent-port
// present/capture surface, and the local-shared-store / export-import
// transports land in later increments (see docs/toolkit-refactor-plan.md
// Phase 3). This barrel is the stable import surface for the toolkit entry.
export {
  GRANT_SCOPES,
  validateScopes,
  normalizeGrant,
  isActive,
  filterAbilityModelByScopes,
} from './grants.js';
