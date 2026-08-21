// The verification utility model, v1.
//
// For each finding this computes an expected utility for each surfacing route
// and takes the best:
//
//   EU(r|q,t) = P(e)·P(uncover)·D(r|q)·C_und + V_mon·A(r) − C_int(r, person, t)
//
//   routes: now (spoken promptly) · after (spoken, nothing paused) ·
//           log (in the panel for the completion review) · ondemand (answered
//           only when asked)
//
// What this file decides and what it does not. The locked stops — a
// contradiction, a money-moving step — are decided in policy.js BEFORE this
// runs and never reach it: those are the hard gate, and no preference is
// allowed to soften them. This file routes everything else,
// which under the old ladder was one undifferentiated "aside". The terms it
// can compute today are the ones the finding already carries; the ones it
// cannot (page ambiguity, reversibility classes, listening seconds) are named
// in the design doc and arrive with the generator work.
//
// The weights are hand-set to reproduce the worked examples from the design
// interview (the seat question pauses, the order number goes to the log) and
// are the thing the replay tuning and the human-label study replace. They are exported so a test can hold them
// still and the tuning can move them.

export const ROUTES = ['now', 'after', 'log', 'ondemand'];

export const WEIGHTS = {
  // P(e): how likely something is wrong here. Base rate plus a push when the
  // model itself was unsure of its own reading.
  peBase: 0.15,
  peDoubt: 0.2,          // scaled by (1 − confidence)
  // Live danger signals, from the same page read (decision 9). Each raises
  // suspicion for every finding on the page it fired on: a page whose plan
  // position is unknown, a page showing several values for one fact, a trace
  // that has been retrying or backtracking.
  peOffPlan: 0.2,
  peAmbiguity: 0.1,
  peAnomaly: 0.1,
  // P(uncover): graded evidence quality, from signals the reader already
  // produces. See uncoverOf() for the levels and what each one means.
  uncoverVerified: 0.95,     // endpoint: byte-exact page words
  uncoverNormalized: 0.9,    // verified after punctuation canonicalization
  uncoverOther: 0.6,         // endpoint: no page-backed words at all
  // C_und: what an undetected error costs. Two forms. A question that carries
  // the six-dimension coding (costDims) gets a graded value from cundOf();
  // one that does not falls back to the moneyMoving bit and these two levels,
  // byte-identical to the pre-coding behavior.
  cundMoney: 0.9,
  cundOther: 0.35,
  // The graded scale. Severity in [0,1] maps to cundFloor..cundFloor+cundSpan,
  // anchored so the corpus lands in the same band as the two-level fallback:
  // an all-zeros coding sits below cundOther, an all-high coding just above
  // cundMoney. Severity blends worst-dimension with the mean (cundMaxBlend
  // toward the max) because an error that is catastrophic on one axis is not
  // averaged away by being harmless on five others.
  cundFloor: 0.15,
  cundSpan: 0.8,
  cundMaxBlend: 0.7,
  // V_mon and A(r): the value of simply knowing, discounted by how likely the
  // route is to actually reach the person.
  // 0.08, down from 0.15: vmon multiplies A(r), and A's spread between the
  // spoken and kept routes (0.8 against 0.35) made awareness-by-speech worth
  // more than most findings' whole error term, so completion-wanted answers
  // kept winning a spoken route. awareness is a tiebreaker, not a driver.
  vmon: 0.08,
  // A(now) is 0.8, not 1: measured on the recordings, even a scripted presser
  // that never skips anything reached about 0.7 on the spoken routes, because
  // a finding surfaced while the agent runs can clear before the next hold.
  // A(log) stays an estimate; the instrument that measured the others cannot
  // see the log route, and the paper says so.
  attention: { now: 0.8, after: 0.7, log: 0.35, ondemand: 0.2 },
  // C_int(r): what each route costs the person, before the persona multiplier.
  // Listening time is the unit: a spoken line costs seconds of a serial
  // channel, a panel row costs nothing until it is asked for.
  //
  // Lowered from 0.12 / 0.08 after the measurement pass: at 0.12 the
  // screen-reader multiplier (1.6x) made the now route cost 0.192 against a
  // benefit side that tops out near 0.21, so the EU model chose a spoken
  // route zero times in 1,227 questions for the population the layer is for.
  // A cost a persona can push past the whole benefit range is a switch, not
  // a multiplier. At 0.04 the multiplied cost (0.064) stays inside the range,
  // and agreement with the human moment labels goes from 20.8 to the high
  // eighties for the screen-reader persona.
  intBase: { now: 0.04, after: 0.02, log: 0.01, ondemand: 0 },
  // A screen reader pays in listening time for everything spoken; someone who
  // asked for summaries pays in attention. Multipliers on the spoken routes.
  personaSpeech: 1.6,
  personaSummarize: 1.3,
};

// How much of the answer's value survives each route, read off the question's
// own moment. The moment is the human (or generator) label for when this
// answer is still worth having, so it is the v1 stand-in for the reversibility
// classes the design doc specifies.
// D(now) is below 1 for the kept moments on purpose. D is what fraction of
// the answer's value each route preserves, and an answer wanted at
// completion is worth LESS spoken early, not more: a receipt read before the
// order exists verifies nothing yet. Without this, D(now) = 1 everywhere let
// the now route dominate whenever costs were low, and most
// completion-labeled questions were spoken mid-run even for sighted users.
// On demand's log entry drops to 0.7 so the on-demand route is actually
// reachable: at 0.9 the log route's higher attention constant beat it for
// every question in the corpus, and a four-route model shipped with three.
export const DEFER = {
  'Now':        { now: 1, after: 0.5, log: 0.3, ondemand: 0.3 },
  'After':      { now: 1, after: 1, log: 0.6, ondemand: 0.5 },
  'Completion': { now: 0.4, after: 0.6, log: 1, ondemand: 0.8 },
  'On demand':  { now: 0.35, after: 0.4, log: 0.7, ondemand: 1 },
};
const DEFER_DEFAULT = DEFER['Now'];

// The marginal cost of joining a pause that is happening anyway. Horvitz's
// compound-alert rule (attention-sensitive alerting, eq 8): a bundle's value
// adds per item, its cost is charged once. Charging every question the full
// pause cost double-counts the interruption and wrongly demotes cheap
// additions - the ninth question on a pausing node costs a sentence of
// listening, not a second interruption. A quarter of the base is that
// sentence.
export const MARGINAL_NOW_FACTOR = 0.25;

// The six cost dimensions, in the design doc's three groups. Each is coded
// 0-3 on the question at generation time (0 none .. 3 high):
//   economic     money       — money magnitude at stake if this goes wrong
//   exposure     privacy     — privacy or identity exposure
//                thirdParty  — messages or money reaching a real person in
//                              the user's name
//                safety      — safety or legal consequence
//   undoability  reversibility — how hard the consequence is to reverse
//                recovery      — effort to notice and redo (task-redo folded in)
export const COST_DIMS = ['money', 'privacy', 'thirdParty', 'safety',
                          'reversibility', 'recovery'];

/**
 * C_und for one finding: graded when the question carries the six-dimension
 * coding, the two-level moneyMoving fallback when it does not.
 *
 * Combination rule (hand-set; the human-label study fits the real exchange
 * rates per design decision 8, and nothing here was tuned against the
 * worth-it labels): each dimension normalizes to [0,1]; severity is
 * cundMaxBlend x the worst dimension + the rest x the mean; the scalar is
 * cundFloor + cundSpan x severity. Monotone in every dimension. A costDims
 * object with no finite entries falls back, so a malformed coding degrades
 * to the old behavior instead of poisoning the score.
 */
export function cundOf(f, w = WEIGHTS) {
  const sev = severityOf(f, w);
  if (sev !== null) return w.cundFloor + w.cundSpan * sev;
  return f?.moneyMoving === true ? w.cundMoney : w.cundOther;
}

/**
 * P(uncover) for one finding: how likely this evidence reveals an error,
 * graded from signals the reader already produces. No new calls, no new
 * fields: the verify status and the quote are already on every finding.
 *
 * The levels, and what each means as evidence quality:
 *
 *   0.95  verified_exact — the page's own words, byte for byte.
 *         Near-certain the page really asserts this.
 *   0.90  verified_normalized — the same words after the deterministic
 *         canonicalization steps (whitespace, invisible characters, quote
 *         marks, a rendered ellipsis). Still the page's words, but the
 *         match survived character deletion, which is marginally weaker
 *         than a byte-identical span.
 *   0.60  unverified — the claim has no page-backed words. Only the legacy
 *         corpus path produces these; the reasoner discards unverified
 *         answers before they become findings, and policy keeps the
 *         blind-commit rule (an unverified claim can never lock a stop)
 *         regardless of this number.
 *
 * Two signals were considered and deliberately excluded, so the next reader
 * does not re-add them:
 *
 *   confidence — already moves P(e) through the doubt term; using the same
 *   report on both factors of the product double-counts it.
 *
 *   quote length or specificity — the read prompt itself demands "the
 *   SHORTEST span that proves the answer", so a short quote is what
 *   compliance looks like, not weak evidence: "Hello, sign in" fully proves
 *   the session is signed out. A discount for short digit-free quotes was
 *   built, measured on the labeled stops (benefit AUROC 0.617 to 0.602),
 *   and removed on that principle; the measurement is recorded in
 *   MEASUREMENT.md, and the labels were read, never fitted to.
 *
 * A legacy boolean `verified: true` grades as exact, so the corpus path and
 * the synthetic measurement findings behave exactly as before.
 */
export function uncoverOf(f, w = WEIGHTS) {
  const v = f?.verified;
  // Any truthy verify value graded as exact except the one explicitly
  // normalized form: byte-identical to the old `verified ? a : b` on every
  // value the old code ever saw, and a strict refinement on normalized.
  if (!v) return w.uncoverOther;
  return v === 'verified_normalized' ? w.uncoverNormalized : w.uncoverVerified;
}

/**
 * The graded severity of an undetected error, in [0,1], or null when the
 * question carries no usable cost coding. cundOf() maps it onto the C_und
 * scale; the measurement instruments read it directly.
 */
export function severityOf(f, w = WEIGHTS) {
  const d = f?.costDims;
  if (!d || typeof d !== 'object') return null;
  let max = 0; let sum = 0; let n = 0;
  for (const k of COST_DIMS) {
    const v = Number(d[k]);
    if (!Number.isFinite(v)) continue;
    const x = Math.max(0, Math.min(3, v)) / 3;
    if (x > max) max = x;
    sum += x; n += 1;
  }
  if (n === 0) return null;
  return w.cundMaxBlend * max + (1 - w.cundMaxBlend) * (sum / n);
}

/**
 * The expected utility of each route for one finding, and the best route.
 *
 * The routing depends on the question, the page and the person, and on
 * nothing that happened earlier in the run. There is no model of the person
 * tiring here: a claim about how attention decays over a session needs
 * evidence a single session cannot produce, so the layer does not make one.
 *
 * @param {Object} f the finding (moment, moneyMoving, confidence, verified …)
 * @param {{model?: object, weights?: object, joiningPause?: boolean,
 *          signals?: object}} ctx
 *   model  — the person's AbilityModel, if the Librarian had one
 *   joiningPause — this finding's node is already pausing, so the now route
 *   is priced at the marginal cost of riding the existing pause
 * @returns {{route: string, eu: Object<string,number>, why: string}}
 */
export function route(f, ctx = {}) {
  const w = ctx.weights || WEIGHTS;
  const m = ctx.model || null;

  // Clamped, because the confidence is a model-reported number and a model
  // can report anything. NaN passes a typeof check ("number") and `??` does
  // not catch it, so an unclamped NaN here turned every route's score NaN
  // and the argmax into the first route. Found by the stress suite.
  const conf = Number.isFinite(f.confidence)
    ? Math.max(0, Math.min(1, f.confidence)) : 0.8;
  const sig = ctx.signals || {};
  const pe = Math.min(1, w.peBase + w.peDoubt * (1 - conf)
    + (sig.offPlan ? w.peOffPlan : 0)
    + (sig.ambiguity ? w.peAmbiguity : 0)
    + (sig.traceAnomaly ? w.peAnomaly : 0));
  const uncover = uncoverOf(f, w);
  const cund = cundOf(f, w);
  const defer = DEFER[f.moment] || DEFER_DEFAULT;

  // The spoken routes cost more for someone whose only channel is speech, and
  // for someone who asked for less. This scales what being told costs; it
  // never touches the benefit side, which is why a locked stop is decided
  // before this file is reached.
  let persona = 1;
  if (m?.vision?.descriptions) persona *= w.personaSpeech;
  if (m?.cognition?.summarize) persona *= w.personaSummarize;

  const eu = {};
  for (const r of ROUTES) {
    const spokenRoute = r === 'now' || r === 'after';
    const base = r === 'now' && ctx.joiningPause
      ? w.intBase.now * MARGINAL_NOW_FACTOR : w.intBase[r];
    const burden = base * (spokenRoute ? persona : 1);
    eu[r] = pe * uncover * defer[r] * cund
      + w.vmon * w.attention[r]
      - burden;
  }

  let best = ROUTES[0];
  for (const r of ROUTES) if (eu[r] > eu[best]) best = r;

  const why = {
    now: 'worth saying at the moment',
    after: 'worth saying, nothing needs pausing',
    log: 'kept for the completion review',
    ondemand: 'kept for when you ask',
  }[best];

  return { route: best, eu, why };
}
