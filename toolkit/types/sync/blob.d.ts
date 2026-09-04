/**
 * @typedef {import('../core/ability.js').ProfileRecord} ProfileRecord
 * @typedef {import('../core/ability.js').AbilityModel} AbilityModel
 */
/**
 * Build the portable blob from a stored profile + its AbilityModel view.
 * @param {ProfileRecord|null|undefined} profile
 * @param {AbilityModel|null|undefined} abilityModel
 * @param {number} now  Epoch milliseconds, becomes `exportedAt`.
 */
export function buildProfileBlob(profile: ProfileRecord | null | undefined, abilityModel: AbilityModel | null | undefined, now: number): {
    kind: string;
    v: number;
    exportedAt: number;
    abilityModel: import("../core/ability.js").AbilityModel | null;
    profile: {
        supportAreas: string[];
        freeText: string;
        fields: Record<string, unknown>;
        metaPreferences: {
            language: string;
        };
        updatedAt: number | null;
    };
};
/** True iff `blob` is a structurally valid profile blob this version reads.
 *  `exportedAt` MUST be a finite positive number — a NaN/Infinity timestamp
 *  would defeat the last-write-wins guard (all comparisons against NaN are
 *  false; Infinity freezes the device), so it is rejected here.
 *  @param {any} blob
 *  @returns {boolean} */
export function validateProfileBlob(blob: any): boolean;
export const BLOB_KIND: "aa-profile-blob";
export const BLOB_VERSION: 1;
export default buildProfileBlob;
export type ProfileRecord = import("../core/ability.js").ProfileRecord;
export type AbilityModel = import("../core/ability.js").AbilityModel;
//# sourceMappingURL=blob.d.ts.map