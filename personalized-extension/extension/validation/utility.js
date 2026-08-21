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
// runs and never reach it: those are the hard gate, and no amount of fatigue
// or preference is allowed to soften them. This file routes everything else,
// which under the old ladder was one undifferentiated "aside". The terms it
// can compute today are the ones the finding already carries; the ones it
// cannot (page ambiguity, reversibility classes, listening seconds) are named
// in the design doc and arrive with the generator work.
//
// The weights are hand-set to reproduce the worked examples from the design
// interview (the seat question pauses, the order number goes to the log, a
// contradiction survives any fatigue) and are the thing the replay tuning and
// the human-label study replace. They are exported so a test can hold them
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
  // P(uncover): a verified quote is close to certain evidence; anything else
  // is weaker.
  uncoverVerified: 0.95,
  uncoverOther: 0.6,
  // C_und: what an undetected error costs. One bit today (moneyMoving), so two
  // levels. The six-dimension coding replaces this.
  cundMoney: 0.9,
  cundOther: 0.35,
  // V_mon and A(r): the value of simply knowing, discounted by how likely the
  // route is to actually reach the person.
  vmon: 0.15,
  attention: { now: 1, after: 0.8, log: 0.35, ondemand: 0.2 },
  // C_int(r): the burden of each route, before fatigue and persona. Set so a
  // verified wanted-now finding is spoken at the start of a quiet run and
  // migrates to the log after roughly four spoken things.
  intBase: { now: 0.12, after: 0.08, log: 0.01, ondemand: 0 },
  // Each thing already spoken this run makes the next spoken thing cost more.
  // Linear for v1; the curve shape is an open question in the design doc.
  fatiguePerSaid: { now: 0.01, after: 0.012, log: 0, ondemand: 0 },
  // A screen reader pays in listening time for everything spoken; someone who
  // asked for summaries pays in attention. Multipliers on the spoken routes.
  personaSpeech: 1.6,
  personaSummarize: 1.3,
};

// How much of the answer's value survives each route, read off the question's
// own moment. The moment is the human (or generator) label for when this
// answer is still worth having, so it is the v1 stand-in for the reversibility
// classes the design doc specifies.
const DEFER = {
  'Now':        { now: 1, after: 0.5, log: 0.3, ondemand: 0.3 },
  'After':      { now: 1, after: 1, log: 0.6, ondemand: 0.5 },
  'Completion': { now: 1, after: 0.9, log: 1, ondemand: 0.8 },
  'On demand':  { now: 1, after: 0.9, log: 0.9, ondemand: 1 },
};
const DEFER_DEFAULT = DEFER['Now'];

// The marginal cost of joining a pause that is happening anyway. Horvitz's
// compound-alert rule (attention-sensitive alerting, eq 8): a bundle's value
// adds per item, its cost is charged once. Charging every question the full
// pause cost double-counts the interruption and wrongly demotes cheap
// additions - the ninth question on a pausing node costs a sentence of
// listening, not a second interruption. A quarter of the base is that
// sentence; fatigue still applies, because sentences are what fatigue counts.
export const MARGINAL_NOW_FACTOR = 0.25;

/**
 * The expected utility of each route for one finding, and the best route.
 *
 * @param {Object} f the finding (moment, moneyMoving, confidence, verified …)
 * @param {{spoken?: number, model?: object, weights?: object,
 *          joiningPause?: boolean}} ctx
 *   spoken — how many things this run has already said out loud (fatigue)
 *   model  — the person's AbilityModel, if the Librarian had one
 *   joiningPause — this finding's node is already pausing, so the now route
 *   is priced at the marginal cost of riding the existing pause
 * @returns {{route: string, eu: Object<string,number>, why: string}}
 */
export function route(f, ctx = {}) {
  const w = ctx.weights || WEIGHTS;
  const spoken = ctx.spoken || 0;
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
  const uncover = f.verified ? w.uncoverVerified : w.uncoverOther;
  const cund = f.moneyMoving === true ? w.cundMoney : w.cundOther;
  const defer = DEFER[f.moment] || DEFER_DEFAULT;

  // The spoken routes cost more for someone whose only channel is speech, and
  // for someone who asked for less. This scales the burden of being told; it
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
    const burden = (base + w.fatiguePerSaid[r] * spoken)
      * (spokenRoute ? persona : 1);
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
