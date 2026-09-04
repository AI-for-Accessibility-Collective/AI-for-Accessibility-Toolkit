/**
 * Numeric rank of a strength label. A missing or unknown label ranks as
 * 'preference'.
 * @param {string|undefined} strength
 * @returns {number}
 */
export function rankOf(strength: string | undefined): number;
export const STRENGTH_RANK: Readonly<{
    hint: 0;
    preference: 1;
    floor: 2;
}>;
//# sourceMappingURL=strength.d.ts.map