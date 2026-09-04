/**
 * @typedef {Object} Grant
 * The durable, user-approved record that one app may read a scoped slice.
 * @property {string|null} id
 * @property {string} appId
 * @property {string} appLabel
 * @property {string[]} scopes        Only whitelisted GRANT_SCOPES survive normalization.
 * @property {string} audience        One of AUDIENCES.
 * @property {number} grantedAt       Epoch milliseconds, 0 when unknown.
 */
/** True iff `scopes` is a non-empty array of whitelisted scopes. Unknown or
 *  empty → false (default-deny: requestGrant rejects rather than over-granting).
 *  @param {unknown} scopes
 *  @returns {boolean} */
export function validateScopes(scopes: unknown): boolean;
/** Canonicalize a grant record. Drops any non-whitelisted scope defensively
 *  (validateScopes gates creation, but a stored grant is trusted loosely).
 *  @param {any} raw
 *  @returns {Grant} */
export function normalizeGrant(raw: any): Grant;
/** True iff `audience` is covered by the profile's current `sharing` level.
 *  Fail CLOSED on unrecognized values: an unknown/missing sharing level
 *  counts as 'personal' (the narrowest ceiling), and an unknown audience
 *  never passes — a corrupted field must narrow access, never widen it.
 *
 *  Pure by design (no I/O), so it composes wherever both operands are in
 *  scope: core/librarian.js's exportAbilityModel calls it directly — the
 *  portable enforcement point every host gets for free — and
 *  background.js's grant routes are now thin pass-throughs to the Librarian
 *  rather than re-implementing the check.
 *  @param {string} audience  The grant holder's audience tier.
 *  @param {string} sharing   The profile's current sharing level. Pass the
 *    stored value as is: an unknown label (or '' for a missing one) reads as
 *    'personal' below.
 *  @returns {boolean} */
export function audienceAllowed(audience: string, sharing: string): boolean;
/**
 * @typedef {Object} ShareAuditEntry
 * @property {number} ts
 * @property {string} appId
 * @property {'grant-created'|'grant-revoked'|'export'|'export-blocked'|'insight-import'} action
 * @property {string[]} [scopes]
 * @property {string} [audience]
 * @property {string} [result]
 */
/**
 * @typedef {Object} AuditStore
 * The two datastore-facade methods the audit trail uses (core/datastore.js
 * `mine`-tier `get` and `patch`).
 * @property {(name: string) => Promise<any>} get
 * @property {(name: string, fn: (current: any) => any) => Promise<any>} patch
 */
/**
 * Append one entry (stamping `ts`), capped to the most recent AUDIT_MAX.
 * @param {() => AuditStore} datastore  Lazy getter for the datastore facade.
 * @param {Omit<ShareAuditEntry, 'ts'>} entry
 */
export function recordShareAudit(datastore: () => AuditStore, entry: Omit<ShareAuditEntry, "ts">): Promise<void>;
/** The full audit trail, oldest first (as stored).
 *  @param {() => AuditStore} datastore  Lazy getter for the datastore facade.
 *  @returns {Promise<ShareAuditEntry[]>} */
export function getShareAudit(datastore: () => AuditStore): Promise<ShareAuditEntry[]>;
/** A grant is active iff it has an appId and at least one valid scope. Revoke
 *  is a DELETE, so there is no revoked/expired state to check — a stored grant
 *  that still exists is active.
 *  @param {Partial<Grant>|null|undefined} grant
 *  @returns {boolean} */
export function isActive(grant: Partial<Grant> | null | undefined): boolean;
/** Project an AbilityModel down to ONLY the fields the granted scopes unlock.
 *  READ-ONLY; always includes `schemaVersion` so a consumer can version-check.
 *  Unknown scopes are ignored. Never emits freeText / confidence or any
 *  SurfaceProfile value.
 *  @param {Partial<AbilityModel>|null|undefined} abilityModel
 *  @param {string[]|null|undefined} scopes
 *  @returns {Partial<AbilityModel> & { schemaVersion: number }} */
export function filterAbilityModelByScopes(abilityModel: Partial<AbilityModel> | null | undefined, scopes: string[] | null | undefined): Partial<AbilityModel> & {
    schemaVersion: number;
};
export const GRANT_SCOPES: string[];
export const AUDIENCES: string[];
/**
 * The durable, user-approved record that one app may read a scoped slice.
 */
export type Grant = {
    id: string | null;
    appId: string;
    appLabel: string;
    /**
     * Only whitelisted GRANT_SCOPES survive normalization.
     */
    scopes: string[];
    /**
     * One of AUDIENCES.
     */
    audience: string;
    /**
     * Epoch milliseconds, 0 when unknown.
     */
    grantedAt: number;
};
export type ShareAuditEntry = {
    ts: number;
    appId: string;
    action: "grant-created" | "grant-revoked" | "export" | "export-blocked" | "insight-import";
    scopes?: string[] | undefined;
    audience?: string | undefined;
    result?: string | undefined;
};
/**
 * The two datastore-facade methods the audit trail uses (core/datastore.js
 * `mine`-tier `get` and `patch`).
 */
export type AuditStore = {
    get: (name: string) => Promise<any>;
    patch: (name: string, fn: (current: any) => any) => Promise<any>;
};
export type AbilityModel = import("../core/ability.js").AbilityModel;
//# sourceMappingURL=grants.d.ts.map