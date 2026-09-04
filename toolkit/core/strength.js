// Requirement strength — shared so the core merge and the surface derivations
// rank floors/preferences/hints identically. floor (a hard need) > preference
// (a soft choice) > hint (a weak nudge). A missing/unknown strength reads as
// 'preference' so untagged data behaves exactly as it did before strength
// existed.
/** @type {Readonly<Record<string, number | undefined>> & { readonly hint: 0, readonly preference: 1, readonly floor: 2 }} */
export const STRENGTH_RANK = Object.freeze({ hint: 0, preference: 1, floor: 2 });

/**
 * Numeric rank of a strength label. A missing or unknown label ranks as
 * 'preference'.
 * @param {string|undefined} strength
 * @returns {number}
 */
export function rankOf(strength) {
  const r = STRENGTH_RANK[/** @type {string} */ (strength)];
  return r === undefined ? STRENGTH_RANK.preference : r;
}
