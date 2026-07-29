// How hard to insist.
//
// A validation layer answers three questions: what to verify, how to render it,
// and how hard to press. The first is answered by which check fires and the
// second by the person's channel. This file answers the third, and it decides
// whether the experience feels careful or exhausting.
//
// ── the rule ────────────────────────────────────────────────────────────────
//
// Reversibility is the spine, with one exception.
//
//   Stop when continuing makes something harder to undo. Everywhere else,
//   speak once and carry on. EXCEPT: a finding that contradicts something the
//   person explicitly stated always stops, reversible or not.
//
// The exception exists because of the case that motivates the whole layer. A
// wrong size variant is technically reversible — the item can be returned —
// and it is still the single most valuable thing to stop for, because by the
// time it is discovered the cost is a return, a re-order, and a child with no
// sandals. Reversible does not mean cheap.
//
// Two rules that are not judgment calls:
//
//   * Something already raised and answered drops to ambient. Repetition is
//     the fastest way to make a layer like this into background noise, and
//     background noise is indistinguishable from silence.
//   * Nothing exceeds `stop` at a step the person cannot act on. A gate the
//     person cannot answer is not a checkpoint, it is a dead end.
//
// interactionStyle shifts everything one notch either way. It lives on the
// profile and roams between devices, so how much someone wants interrupting is
// remembered rather than re-decided.

/** ambient — silent unless it conflicts · aside — one line, agent continues
 *  stop — blocks, waits for an answer */
export const LEVELS = ['ambient', 'aside', 'stop'];

const ORDER = { ambient: 0, aside: 1, stop: 2 };

// Phases after which something becomes materially harder to undo. Adding to a
// cart is reversible; what is IN the cart at checkout is what gets bought, and
// after the order is placed the only remedy is a cancellation window.
const IRREVERSIBLE_AFTER = new Set(['Add to cart', 'Checkout', 'Review order']);

/**
 * @typedef {Object} Finding
 * @property {string} widget          which check produced it
 * @property {string} phase           where in the task it fired
 * @property {boolean} [contradicts]  does it conflict with something stated?
 * @property {boolean} [answerable]   can the person act on it here?
 * @property {boolean} [confirming]   is it a check that PASSED?
 */

/**
 * How hard to press on one finding.
 *
 * @param {Finding} f
 * @param {{seen?: Set<string>, style?: 'quiet'|'balanced'|'thorough'}} state
 * @returns {{level: string, why: string}}
 */
export function decide(f, state = {}) {
  const seen = state.seen || new Set();
  const key = `${f.widget}|${f.phase}`;

  // A confirmation is never more than ambient. "Checked and fine" is worth
  // being able to ask for; it is not worth interrupting anyone with.
  if (f.confirming) return { level: 'ambient', why: 'a check that passed' };

  if (seen.has(key)) {
    return { level: 'ambient', why: 'already raised at this step' };
  }

  let level, why;
  if (f.contradicts) {
    level = 'stop';
    why = 'contradicts something you said';
  } else if (IRREVERSIBLE_AFTER.has(f.phase)) {
    level = 'stop';
    why = 'continuing from here is hard to undo';
  } else {
    level = 'aside';
    why = 'worth knowing, nothing is committed yet';
  }

  // interactionStyle: a notch quieter or louder, never past the ends.
  //
  // It cannot soften a stop that exists because something contradicts what the
  // person said. Choosing "quiet" is a request for less chatter, not for less
  // safety, and letting a preference disable the gate would mean the setting
  // most people pick is the one that removes the protection. Asides and
  // ambients move freely; the contradiction gate does not.
  const shift = { quiet: -1, thorough: +1 }[state.style] || 0;
  const locked = level === 'stop' && f.contradicts;
  if (shift && !locked) {
    const moved = LEVELS[Math.max(0, Math.min(2, ORDER[level] + shift))];
    if (moved !== level) {
      level = moved;
      why += shift < 0 ? ', softened because you asked for less'
                       : ', raised because you asked for more';
    }
  }

  // A stop the person cannot answer is a dead end. Drop it to an aside so they
  // hear it and keep moving, rather than being blocked with no way through.
  if (level === 'stop' && f.answerable === false) {
    return { level: 'aside', why: `${why}, but there is nothing to decide here` };
  }
  return { level, why };
}

/** Highest level among findings — what the run as a whole should do. */
export function highest(levels) {
  return levels.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'ambient');
}
