/**
 * Numeric rank of a strength label. A missing or unknown label ranks as
 * 'preference'.
 * @param {string|undefined} strength
 * @returns {number}
 */
export function rankOf(strength: string | undefined): number;
/** @type {Readonly<Record<string, number | undefined>> & { readonly hint: 0, readonly preference: 1, readonly floor: 2 }} */
export const STRENGTH_RANK: Readonly<Record<string, number | undefined>> & {
    readonly hint: 0;
    readonly preference: 1;
    readonly floor: 2;
};
//# sourceMappingURL=strength.d.ts.map