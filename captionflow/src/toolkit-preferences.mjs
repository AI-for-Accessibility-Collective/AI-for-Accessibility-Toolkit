import { rankOf } from '../../toolkit/index.js';
import { memoryKV } from '../../toolkit/platforms/node/kv.js';

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
// checked against the toolkit's real acting user, both before the first
// toolkit call and again immediately after each await whose result this
// adapter directly reads. If the toolkit cannot report an acting user at all,
// or the two disagree, the operation refuses instead of guessing.
//
// Reviewed boundary (2026-11-05, Nous-hosted review): this guard does NOT
// reach inside `librarian.setProfileField()`. That call's own
// read-modify-write (`Datastore.patch`: a separate `get`, then the caller's
// fn, then a separate `set`, each re-resolving the active partition at call
// time -- see toolkit/core/datastore.js) has its own internal switch window
// this adapter cannot see or close without changing toolkit core, which is
// out of scope here (team rule: toolkit fixes are separate PRs). So "mid-op
// switch" protection is real for the awaits THIS file controls (getProfile,
// getAbilityModel) but not for a switch landing entirely inside a single
// setProfileField call. This narrows, but does not eliminate, the risk the
// original review flagged. Not a consent boundary either way.
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

// Undo (2026-11-05, see TOOLKIT_PREFERENCES.md "Real undo"): a per-acting-user
// stack of this adapter's own prior captionflow-user textSize entries, kept
// outside the shared toolkit profile so it never leaks into the AbilityModel
// or another app's view of it. Stored via the same KV port shape the toolkit
// itself uses (`get/set(area, key)`, see toolkit/platforms/node/kv.js), under
// its own area so it can share one `fileKV(dir)` on disk with the Librarian
// without colliding. Bounded, not infinite, and explicitly one feature's
// worth of history -- not a general undo/redo framework.
//
// Key encoding: `JSON.stringify(actingUserId)` (not a template string with a
// fallback literal) so a real user id can never collide with the sentinel for
// `null` -- a user literally named e.g. "null" or "__default__" still gets
// `"null"`/`"__default__"` (quoted), distinct from the unquoted `null` key the
// default partition gets.
const UNDO_AREA = 'captionflow-undo';
const UNDO_HISTORY_LIMIT = 20;
const historyKey = (actingUserId) => `textSize:${JSON.stringify(actingUserId ?? null)}`;

async function readHistory(historyKV, actingUserId) {
  return (await historyKV.get(UNDO_AREA, historyKey(actingUserId))) ?? [];
}

async function pushHistory(historyKV, actingUserId, entry) {
  const stack = await readHistory(historyKV, actingUserId);
  stack.push(entry);
  await historyKV.set(UNDO_AREA, historyKey(actingUserId), stack.slice(-UNDO_HISTORY_LIMIT));
}

// Looks at the top of the stack without removing it. Removal is a separate,
// later step (`commitPop`) so a failure between the peek and the profile
// write (guard mismatch, a throw from the toolkit) leaves the stack
// untouched and the undo can simply be retried -- the entry is not
// permanently lost in a half-completed undo.
async function peekHistory(historyKV, actingUserId) {
  const stack = await readHistory(historyKV, actingUserId);
  if (stack.length === 0) return { found: false, entry: undefined };
  return { found: true, entry: stack[stack.length - 1] };
}

async function commitPop(historyKV, actingUserId) {
  const stack = await readHistory(historyKV, actingUserId);
  stack.pop();
  await historyKV.set(UNDO_AREA, historyKey(actingUserId), stack);
}

function ownTextSizeNeed(needs) {
  return needs.find(need => need?.dimension === 'textSize' && need.source === 'captionflow-user' && need.strength !== 'floor');
}

function withoutOwnTextSizeNeed(needs) {
  return needs.filter(need => !(need?.dimension === 'textSize' && need.source === 'captionflow-user' && need.strength !== 'floor'));
}

// Prototype for synthetic data in a trusted, single-user host only. This direct
// Librarian access does not enforce cross-app grants, and (beyond the
// acting-user guard above) concurrent profile edits from other callers can
// still be lost. See the notes in captionflow/TOOLKIT_PREFERENCES.md before
// integrating with real profiles.
//
// `actingUserId` (default `null`, the toolkit's default partition) is the
// user this provider instance is allowed to act for. Pass the host's current
// user id explicitly; never infer it.
//
// `historyKV` (default: a fresh, non-durable `memoryKV()`) backs the undo
// stack for `setTextSize`/`undoTextSize`. Pass a durable KV (e.g.
// `fileKV(dir)`, the same instance backing the Librarian is fine -- it uses
// its own area) for undo to survive a process restart.
export function createToolkitPreferenceProvider({ librarian, actingUserId = null, historyKV = memoryKV() } = {}) {
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
      const previousOwn = ownTextSizeNeed(needs);
      await librarian.setProfileField('fields.needs', [
        ...withoutOwnTextSizeNeed(needs), { dimension: 'textSize', value, unit: 'ratio', strength: 'preference', source: 'captionflow-user' },
      ]);
      // Record what this write replaced -- `null` means "no prior
      // captionflow-user choice existed", which undo must restore to
      // (removing the entry), not confuse with "restore to some default".
      // Pushed only after the write succeeds, so a failed write never
      // invents history for a change that didn't happen.
      await pushHistory(historyKV, actingUserId, previousOwn ? { value: previousOwn.value, unit: previousOwn.unit } : null);
    },
    // Reverses the most recent setTextSize from THIS provider's history, not
    // a generic "set textSize to whatever it was at profile load" snapshot.
    // Calling it with nothing to undo is a no-op that reports { undone: false }
    // rather than throwing, since "nothing to undo" is an expected state, not
    // an error. Repeated calls walk back through up to the last 20 choices.
    async undoTextSize() {
      assertActingUser(librarian, actingUserId);
      const { found, entry } = await peekHistory(historyKV, actingUserId);
      if (!found) return { undone: false, reason: 'no-history' };
      const profile = await librarian.getProfile();
      assertActingUser(librarian, actingUserId); // refuse to write if the user switched between read and write
      const needs = profile.fields?.needs ?? [];
      const base = withoutOwnTextSizeNeed(needs);
      const restored = entry
        ? [...base, { dimension: 'textSize', value: entry.value, unit: entry.unit ?? 'ratio', strength: 'preference', source: 'captionflow-user' }]
        : base; // there was no prior captionflow-user choice: undo removes the entry entirely
      await librarian.setProfileField('fields.needs', restored);
      // Only remove the entry from the stack once the write has actually
      // landed. If anything above throws first, the stack is untouched and
      // the same undo can be retried instead of silently vanishing.
      await commitPop(historyKV, actingUserId);
      return { undone: true, restoredTo: entry ?? null };
    },
  };
}
