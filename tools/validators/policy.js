// The policy — how hard to insist.
//
// A validation layer has three questions to answer: what to verify, how to
// render it, and how hard to insist. The first is answered by which validator
// triggers, the second by the persona's rendering. This file answers the third,
// and it decides whether the experience feels careful or exhausting.
//
// Two constraints shape any answer:
//
//   * Most things that go wrong during a purchase go wrong before the final
//     commit step, so a layer that only speaks up at the end arrives too late
//     to help with them.
//   * Speech is expensive. A screen-reader user pays real minutes for a long
//     readback, so a wall of asides is worse than saying nothing. Coverage
//     should be total; insistence should be rationed.
//
// The person's own tolerance is stored and roams across their devices, in
// mine.profile.metaPreferences.interactionStyle.

/** @typedef {'ambient'|'aside'|'stop'} Insistence */

/**
 * Everything the policy may look at. Assembled by the checker; the policy
 * itself is pure, so it can be tested without a browser.
 *
 * @typedef {Object} PolicyInput
 * @property {Object}  finding            The finding under consideration.
 * @property {boolean} finding.reversible Can this still be undone right now?
 * @property {boolean} violatesContract   Does the observation contradict what
 *                                        the person actually asked for?
 * @property {Object}  validator
 * @property {string}  validator.infoType state | constraint | magnitude |
 *                                        provenance | freshness | consequence
 * @property {Insistence} [validator.floor] Never quieter than this.
 * @property {'S'|'B'|'SA'|'BA'} persona  A screen-reader user delegating to an
 *                                        agent has no page to glance at; a
 *                                        sighted user can simply look.
 * @property {string}  phase              Which step of the task this is.
 * @property {'quiet'|'balanced'|'thorough'} interactionStyle
 *                                        The person's stored tolerance for
 *                                        being interrupted.
 * @property {boolean} alreadySaid        Has this same finding been raised and
 *                                        answered earlier in this run?
 */

/**
 * Decide how hard to insist on one finding.
 *
 * TODO: choose the escalation rule. The mechanical parts are done — repeats are
 * suppressed above, and clampToFloor() below means a validator that sets a
 * floor (the final commit gate) can never be demoted, whatever this returns.
 * What's left is the rule itself, and the options genuinely differ:
 *
 *   by reversibility  Stop only when continuing makes something harder to
 *                     undo. Quietest. But a wrong product variant is
 *                     technically reversible and still worth stopping for.
 *
 *   by consequence    Stop when money or the stated goal is at risk, whether
 *                     or not it is reversible. Catches the variant case, at the
 *                     cost of stopping early, when nothing is at stake yet.
 *
 *   by persona        A delegating screen-reader user gets a stop where a
 *                     sighted one gets an aside, because only one of them can
 *                     check by looking. Honest about the asymmetry; means two
 *                     people running the same task get different experiences.
 *
 * interactionStyle should shift the result a notch either way rather than
 * being a fourth rule — see shift().
 *
 * @param {PolicyInput} input
 * @returns {Insistence}
 */
export function decideInsistence(input) {
  const { validator, alreadySaid } = input;

  // Answered once, don't raise it again — repetition is the fastest way to
  // make this exhausting.
  if (alreadySaid) return 'ambient';

  // ---- escalation rule goes here ------------------------------------------
  const level = 'aside';   // placeholder: everything speaks once, nothing blocks
  // -------------------------------------------------------------------------

  return clampToFloor(level, validator.floor);
}

const ORDER = { ambient: 0, aside: 1, stop: 2 };

/** A validator may set a floor it can never be quieter than. */
export function clampToFloor(level, floor) {
  if (!floor) return level;
  return ORDER[level] >= ORDER[floor] ? level : floor;
}

/** Shift one notch up or down, for interactionStyle. */
export function shift(level, by) {
  const names = ['ambient', 'aside', 'stop'];
  return names[Math.max(0, Math.min(2, ORDER[level] + by))];
}
