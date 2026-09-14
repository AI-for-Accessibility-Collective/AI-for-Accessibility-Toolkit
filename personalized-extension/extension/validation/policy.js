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

import { route as euRoute } from './utility.js';

/** ambient — silent unless it conflicts · aside — one line, agent continues
 *  stop — blocks, waits for an answer */
export const LEVELS = ['ambient', 'aside', 'stop'];

// The utility model's four routes, folded onto the three levels the rest of
// the layer speaks. Spoken routes are asides — only the locked stops above
// ever hold the agent — and the two kept routes are ambient, differing in
// whether the completion review leads with them.
const ROUTE_LEVEL = { now: 'aside', after: 'aside', log: 'ambient', ondemand: 'ambient' };

const ORDER = { ambient: 0, aside: 1, stop: 2 };

// Phases after which something becomes materially harder to undo. Adding to a
// cart is reversible; what is IN the cart at checkout is what gets bought, and
// after the order is placed the only remedy is a cancellation window.
const IRREVERSIBLE_AFTER = new Set(['Add to cart', 'Checkout', 'Review order']);

// ── the task model's own loudness ───────────────────────────────────────────
//
// An audited task model carries `speak` on every question: how loud that
// question is allowed to be, judged once per question with the whole model in
// view. Five values, three surfaces:
//
//   gate      the interactive widget. Holds the run until the person answers.
//   always    a cognitive checkpoint, spoken every time the page answers it.
//   on-event  a checkpoint only when the page shows that situation.
//   if-wrong  a checkpoint only when the page disagrees with what was asked.
//   never     the agent log. Not spoken; the end report carries it.
//
// (`DROP` is a sixth value meaning "not modelled". flattenModel removes those
// questions before anything is asked, so no finding ever carries it.)
//
// When a finding carries one of these it decides the level outright - before
// the locked stops and instead of the utility model. Measured on the shipped
// corpus (82 models, 15,338 questions), 1,490 of the 1,747 money-moving
// questions were audited BELOW gate, so a money lock that outranked speak
// would hold the run on every one of them and the audit would count for
// nothing. The contradiction lock yields for the same reason: `if-wrong` is
// defined as "speak when the page disagrees" and its surface is a checkpoint,
// so if the lock outranked it every if-wrong that fired would become a hold.
// A contradiction on a `never` question is therefore kept, not spoken - the
// audit chose silence for that question, and silence is the default here.
// The persona notch does not move an audited value either way: quieter would
// silence what the model said to say, louder would turn a checkpoint into a
// hold, and only `gate` holds.
//
// A finding with no speak value - the corpus path, a generated model, a
// question the layer wrote for itself off a page - takes the moment path in
// decide() exactly as it always has.
export const SPEAK = ['gate', 'always', 'on-event', 'if-wrong', 'never'];

/** The normalised speak value, or null for anything that is not one. */
export function speakOf(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : null;
  return s && SPEAK.includes(s) ? s : null;
}

/** Which surface each level is, in the names the design uses. */
export const SURFACE_OF_LEVEL = { stop: 'widget', aside: 'checkpoint', ambient: 'log' };

/**
 * The level an audited speak value gives a finding, and whether its trigger
 * fired. The two conditional triggers read what the reasoner's read put on
 * the finding, and nothing else:
 *
 *   on-event fires when the read ESTABLISHED that the situation is on the
 *     page: the finding rests on a verified quote (every finding does) AND
 *     the reasoner listed the question's own node, or a step under it, among
 *     the subtasks this page is serving (`onPage`, derived from
 *     `alignedNodes` in toFindings). An answer quoted off a page the reasoner
 *     did not place at that step is a question answered in passing, not that
 *     situation, and it stays silent with the reason written on it.
 *   if-wrong fires when the read DISAGREES: the reasoner set `contradictsAsk`
 *     on the answer (`contradicts` on the finding), the one field where it
 *     says the page's value departs from what the person asked for. When the
 *     page agrees, or the question is not about something the person
 *     specified, it stays silent.
 *
 * Both default to silence. A trigger the read cannot decide did not fire.
 *
 * @returns {{level: string, why: string, speak: string, surface: string,
 *            fired: boolean}}
 */
export function decideBySpeak(f, speak) {
  const at = (level, why, fired) =>
    ({ level, why, speak, surface: SURFACE_OF_LEVEL[level], fired });
  switch (speak) {
    case 'gate':
      return at('stop', 'the model gates here: held until you answer', true);
    case 'always':
      return at('aside', 'the model says this every time', true);
    case 'on-event':
      return f?.onPage === true
        ? at('aside', 'the model says this when the page shows it, and this page does', true)
        : at('ambient', 'the model says this only when the page shows it, and this page '
             + 'is not at that step; kept for the report', false);
    case 'if-wrong':
      return f?.contradicts === true
        ? at('aside', 'the model says this when the page disagrees with what you asked, '
             + 'and it does', true)
        : at('ambient', 'the model says this only when the page disagrees with what you '
             + 'asked; it agrees, so kept for the report', false);
    default:
      return at('ambient', 'the model keeps this for the report', false);
  }
}

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

  // A contradiction escapes the repetition guard. The key is question + phase
  // and does not include the answer, so a page read twice — which is normal,
  // the navigation trigger fires and an explicit observe follows — could
  // answer "LAX" the first time and "San Diego" the second, and the second
  // was silenced as already raised. A value that changed is the whole reason
  // to look twice.
  // A contradiction escapes the guard only when the ANSWER changed. The key is
  // question + phase, so letting every contradiction through meant the same
  // wrong destination re-fired on each page and became a separate hold: a live
  // three-page run ended with ten stops, three of them the same question. A
  // value that CHANGED is the reason to look twice; a value that is still
  // wrong is the same finding.
  if (seen.has(key) && !(f.contradicts && !seen.has(`${key}|${f.say}`))) {
    return { level: 'ambient', why: 'already raised at this step' };
  }

  // The same EVIDENCE already raised at this step, under different wording.
  // The reasoner supplies a fresh question string every time it re-notices a
  // fact, so the widget-keyed guard above never fires on the reworded form -
  // a recorded run surfaced one page failure six times, twice as stops. The
  // quote is the finding's identity: same quote, same phase, same fact. One
  // contradiction per evidence still gets its stop (the first wording took
  // it); everything after is kept, not spoken.
  if (state.evidenceKey && f.from
      && seen.has(`q|${f.phase}|${state.evidenceKey(f.from)}`)) {
    return { level: 'ambient', why: 'the same evidence was already raised here' };
  }

  // An audited model has already said how loud this question is. That
  // decision replaces everything below - the locked stops, the utility route
  // and the persona notch; the note above decideBySpeak says why each one.
  const speak = speakOf(f.speak);
  if (speak) return decideBySpeak(f, speak);

  let level, why;
  if (f.contradicts) {
    level = 'stop';
    why = 'contradicts something you said';
  } else if (f.moneyMoving === true) {
    // The general form of the rule below. A task model marks the questions
    // whose step is hard to undo — 62 of the 242 gold questions across four
    // domains carry it — so the model says which moments are irreversible
    // instead of this file naming three Amazon phases. Checked first, so a
    // model that carries the field never falls through to the phase names.
    level = 'stop';
    why = 'continuing from here is hard to undo';
  } else if (IRREVERSIBLE_AFTER.has(f.phase)) {
    // The Amazon corpus path, which has no task model and therefore no
    // moneyMoving field. Kept so the shipped demo behaves exactly as before.
    level = 'stop';
    why = 'continuing from here is hard to undo';
  } else if (f.moment != null) {
    // A task-model finding that is not a locked stop is routed by the utility
    // model: expected value of each route against what that route costs the
    // person, with the persona on the cost side. The old rule was one undifferentiated
    // aside; this is the graded form of the same call, and the locked stops
    // above are deliberately decided before it so nothing here can soften
    // them.
    const r = euRoute(f, { model: state.model,
                           signals: state.signals || null,
                           joiningPause: state.joiningPause === true });
    return { level: ROUTE_LEVEL[r.route], why: r.why, route: r.route, eu: r.eu };
  } else {
    level = 'aside';
    why = 'worth knowing, nothing is committed yet';
  }

  // A notch quieter or louder, never past the ends.
  //
  // The notch comes from the person's AbilityModel, which the Librarian
  // already owns and which already roams across their devices — not from a
  // setting private to this layer. Someone who told the toolkit once that they
  // want summaries should not have to tell this surface again, and a
  // preference that lives in two places disagrees with itself eventually.
  //
  // It cannot soften a stop that exists because something contradicts what the
  // person said. Asking for less is a request for less chatter, not less
  // safety, and letting a preference disable the gate would mean the setting
  // most people pick is the one that removes the protection. Asides and
  // ambients move freely; the contradiction gate does not.
  const shift = insistenceShift(state);
  // Locked covers every reason a finding became a stop, not only contradiction.
  // It used to be `contradicts` alone, so a money-moving stop — the general
  // form of the irreversibility rule, and this file's own headline — could be
  // softened to an aside by one preference, and an aside never enters the
  // waiting list. "Asking for less is a request for less chatter, not less
  // safety" has to apply to both reasons or it applies to neither.
  const locked = level === 'stop';
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
  // ...unless the stop is one of the locked kinds. This sat after the lock and
  // had no exception, so `{contradicts: true, answerable: false}` came out as
  // an aside — the lock stopped a preference softening it and this softened it
  // anyway. Nothing emits that pair today, but `answerable` is exactly the
  // field that moves onto the model next, the way `contradicts` just did.
  if (level === 'stop' && f.answerable === false && !locked) {
    return { level: 'aside', why: `${why}, but there is nothing to decide here` };
  }
  return { level, why };
}

/**
 * How much to soften or sharpen, read from the person's AbilityModel.
 *
 * Two fields in the model bear on this and they are not the same request:
 *
 *   cognition.summarize   wants less — fewer things, said shorter. One notch
 *                         quieter, so asides become ambient and stay
 *                         available on request rather than spoken.
 *   vision.descriptions   is someone whose only channel is what gets said.
 *                         An aside they never hear is not a quieter aside, it
 *                         is nothing, so nothing is softened for them.
 *
 * `state.style` is still honoured when a caller passes it, because tests and
 * the CLI host have no Librarian to read from.
 *
 * @param {{model?: object, style?: 'quiet'|'balanced'|'thorough'}} state
 * @returns {-1|0|1}
 */
export function insistenceShift(state = {}) {
  if (state.style) return { quiet: -1, thorough: +1 }[state.style] || 0;
  const m = state.model;
  if (!m) return 0;
  if (m.vision?.descriptions) return 0;
  if (m.cognition?.summarize) return -1;
  return 0;
}

/** Highest level among findings — what the run as a whole should do. */
export function highest(levels) {
  return levels.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'ambient');
}
