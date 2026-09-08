// Requirement strength — shared so the core merge and the surface derivations
// rank floors/preferences/hints identically. floor (a hard need) > preference
// (a soft choice) > hint (a weak nudge). A missing/unknown strength reads as
// 'preference' so untagged data behaves exactly as it did before strength
// existed.
export const STRENGTH_RANK = Object.freeze({ hint: 0, preference: 1, floor: 2 });

/**
 * Numeric rank of a strength label. A missing or unknown label ranks as
 * 'preference'.
 * @param {string|undefined} strength
 * @returns {number}
 */
export function rankOf(strength) {
  // The cast lets the checker index the frozen literal by any label, which is
  // what the unknown-label fallback below is for.
  const r = /** @type {Readonly<Record<string, number | undefined>>} */ (STRENGTH_RANK)[/** @type {string} */ (strength)];
  return r === undefined ? STRENGTH_RANK.preference : r;
}
