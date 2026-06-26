// Requirement strength — shared so the core merge and the surface derivations
// rank floors/preferences/hints identically. floor (a hard need) > preference
// (a soft choice) > hint (a weak nudge). A missing/unknown strength reads as
// 'preference' so untagged data behaves exactly as it did before strength
// existed.
export const STRENGTH_RANK = Object.freeze({ hint: 0, preference: 1, floor: 2 });

export function rankOf(strength) {
  const r = STRENGTH_RANK[strength];
  return r === undefined ? STRENGTH_RANK.preference : r;
}
