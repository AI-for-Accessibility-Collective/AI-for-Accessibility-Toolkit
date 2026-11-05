import { rankOf } from '../../toolkit/index.js';

function validateTextSize(value, unit) {
  if ((unit !== undefined && unit !== 'ratio') || typeof value !== 'number' ||
      !Number.isFinite(value) || value < 0.8 || value > 2.5) {
    throw new Error('textSize must be a ratio between 0.8 and 2.5');
  }
}

// Thrown by the acting-user guard below. Distinct from validation errors so a
// host can tell "wrong/missing user context" apart from "bad preference value".
export class ActingUserMismatchError extends Error {
  constructor(message, { expected, actual } = {}) {
    super(message);
    this.name = 'ActingUserMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

// Trust-boundary decision (2026-11-05, see TOOLKIT_PREFERENCES.md): CaptionFlow
// stays a trusted-host component (Option A) -- no per-request consent prompt --
// but every read or write through this adapter must declare which user it
// believes is active (`actingUserId`, caller-supplied) and that declaration is
// checked against the toolkit's real acting user both before the call and
// immediately after the one await in each operation. If the toolkit cannot
// report an acting user at all, or the two disagree, the operation refuses
// instead of guessing. This is not a consent boundary and does not replace
// one; it only stops a read or write from landing under the wrong partition
// when the host's user context is missing or has changed mid-operation.
function assertActingUser(librarian, expectedUserId) {
  if (typeof librarian.getActingUser !== 'function') {
    throw new ActingUserMismatchError(
      'toolkit-preferences: host toolkit has no getActingUser(); refusing to guess the active user',
      { expected: expectedUserId ?? null, actual: undefined },
    );
  }
  const actual = librarian.getActingUser()?.id ?? null;
  const expected = expectedUserId ?? null;
  if (actual !== expected) {
    throw new ActingUserMismatchError(
      `toolkit-preferences: acting-user mismatch (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}); refusing to read or write`,
      { expected, actual },
    );
  }
  return actual;
}

// Prototype for synthetic data in a trusted, single-user host only. This direct
// Librarian access does not enforce cross-app grants, and (beyond the
// acting-user guard below) concurrent profile edits from other callers can
// still be lost. See the notes in captionflow/TOOLKIT_PREFERENCES.md before
// integrating with real profiles.
//
// `actingUserId` (default `null`, the toolkit's default partition) is the
// user this provider instance is allowed to act for. Pass the host's current
// user id explicitly; never infer it.
export function createToolkitPreferenceProvider({ librarian, actingUserId = null } = {}) {
  if (!librarian) throw new Error('createToolkitPreferenceProvider: librarian is required');
  return {
    async getPreferences() {
      assertActingUser(librarian, actingUserId);
      const model = await librarian.getAbilityModel();
      assertActingUser(librarian, actingUserId); // refuse the result if the user switched mid-read
      let chosen;
      for (const need of model.needs) {
        if (need.dimension === 'textSize' && (!chosen || rankOf(need.strength) >= rankOf(chosen.strength))) chosen = need;
      }
      if (!chosen) return {};
      // The toolkit's neutral textSize is a multiplier; CaptionFlow accepts
      // 0.8–2.5. Refuse unsupported units or invalid values instead of guessing.
      validateTextSize(chosen.value, chosen.unit);
      return { fontScale: chosen.value };
    },
    // This is for an explicit user choice, not an inferred or AI change.
    async setTextSize({ value, unit } = {}) {
      validateTextSize(value, unit);
      assertActingUser(librarian, actingUserId);
      const profile = await librarian.getProfile();
      assertActingUser(librarian, actingUserId); // refuse to write if the user switched between read and write
      const needs = profile.fields?.needs ?? [];
      if (!Array.isArray(needs)) throw new Error('profile needs must be an array');
      const retained = needs.filter(need =>
        !(need?.dimension === 'textSize' && need.source === 'captionflow-user' && need.strength !== 'floor'));
      await librarian.setProfileField('fields.needs', [
        ...retained, { dimension: 'textSize', value, unit: 'ratio', strength: 'preference', source: 'captionflow-user' },
      ]);
    },
  };
}
