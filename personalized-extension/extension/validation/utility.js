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
  // The care-rate prior (v8 lab, EXPERIMENT - nothing live passes the option).
  // care_rate is mined from the video corpus: the fraction of observed
  // opportunities where real people actually performed this check
  // (labeling/behavioral-labels.json). Two readings of what that frequency is
  // evidence for, measured separately and shipped as neither:
  //   peCare    joins P(e)'s additive signal family (offPlan 0.2, ambiguity
  //             0.1): people check where errors happen or matter, so care is
  //             a measured per-question relevance prior. Additive and clamped
  //             like the other signals; 0.3 sits at the top of that family's
  //             range because care is a graded measured rate, not a binary
  //             flag. Deliberately NOT normalized by any corpus statistic
  //             (median, max) - that would smuggle dataset state into the
  //             equation - and never fitted to any label.
  //   vmonCare  the other reading: people check because knowing has value
  //             even when nothing is wrong, which is V_mon's meaning. At
  //             care 1 it doubles the shipped V_mon; bounded, monotone.
  peCare: 0.3,
  vmonCare: 0.08,
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

// ── the three-surface shadow score ──────────────────────────────────────────
//
// David's 2026-08-21 direction (STRONG-SCORE.md in the research repo): one
// strong utility function that decides, per finding, which SURFACE it gets -
// widget (pause the agent, capture the person's input), cognitive checkpoint
// (speak, nothing pauses), or the agent log (kept, shown at the end). No
// on-demand class: pull is a property of the log, not a route. routeSurface()
// below scores that three-way decision with the same terms as route(), plus
// the one term the four-route form is missing: I(r), the probability that
// surfacing on r leads to the error actually being AVERTED. A widget forces
// the resolution before the agent proceeds, so I(widget) = 1 by construction;
// a spoken checkpoint only averts if the person intervenes on what they
// heard; the log only averts what a remedy after the fact can still fix.
//
// SHADOW means: nothing live calls this. decide() still routes with route()
// and the locked stops; routeSurface() exists so the measurement instruments
// can score the three-way form against the surface labels and sweep its
// dominance properties before anything ships. That order is deliberate.
export const SURFACES = ['widget', 'checkpoint', 'log'];

export const SURFACE = {
  // I(r), the captured-resolution term: the probability the surfacing leads
  // to the error being averted GIVEN the person received it - A(r) already
  // prices receipt, so I must not re-price it. The one evidenced distinction
  // is capture versus offer: a widget does not let the run proceed until the
  // answer arrives, so I(widget) = 1 by construction. Whether a spoken offer
  // converts to intervention more often than a review offer is NOT evidenced
  // either way (the review attaches its remedy to the item; the recordings
  // cannot measure either rate, because the scripted presser acts only inside
  // holds), so checkpoint and log carry the SAME stated estimate rather than
  // an invented difference. An earlier draft set I(log) = 0.25 and the
  // Completion questions promptly routed to speech - the same
  // awareness-inflation pathology the vmon repricing fixed - which is what
  // an unevidenced spread between the offer surfaces buys. The study
  // observes both rates directly and replaces the estimate.
  I: { widget: 1, checkpoint: 0.5, log: 0.5 },
  // A(r) for the surfaces. A(widget) = 1 where A(now) measured 0.8: the 0.8
  // includes spoken findings that cleared before the next hold, which cannot
  // happen to a hold itself - a widget IS the hold, presented and waited on.
  // checkpoint carries the measured spoken value; log the shipped estimate.
  attention: { widget: 1, checkpoint: 0.8, log: 0.35 },
  // What each surface costs the person. checkpoint is the aside price; log is
  // the shipped kept price. The widget price is SPLIT (v6): see
  // intWidgetHold / intWidgetSentence below. (A surface config object that
  // instead carries intBase.widget and no split is scored with the v5 single
  // price - the measurement grid uses that to reproduce v5 exactly.)
  intBase: { checkpoint: 0.04, log: 0.01 },
  // The v6 widget price, split into what the pause IS and what it SAYS.
  // The interview's pause price was 0.12. Its two components are different
  // things: the HOLD is wall-clock time the run stands still, which costs
  // every person the same - nothing about it is spoken - so the persona
  // multiplier has no business touching it. The SENTENCE is the spoken
  // question itself, the same load as a checkpoint's sentence (0.04), and
  // that part a screen reader does pay 1.6x for. v5 scaled the whole 0.12 by
  // the persona, so 1.6 x 0.12 = 0.192 exceeded the entire benefit range and
  // the widget switched off for screen readers (widget recall 0.00) - the
  // same switch-not-multiplier defect shape as the 2a8bd38 fix. Split:
  // sentence = the checkpoint's spoken price, hold = the remainder.
  intWidgetHold: 0.08,
  intWidgetSentence: 0.04,
  // How strongly each signal says "this question asks for the person's
  // decision or input" - the sources inputNeedOf() reads, each in [0,1],
  // combined by max. Hand-set from the design record, not fitted:
  //   money 1        consent to commit is itself the input (decision 7's
  //                  gate class, as arithmetic)
  //   handOver 1     credentials, identity, only-the-person-knows - the agent
  //                  cannot proceed alone by definition of the cluster
  //   fromAsk 0.8    the question was added from the person's own ask, so the
  //                  person's preference is the answer
  //   options 0.8    the page itself offers choices (harvested, verified) -
  //                  a decision demonstrably exists on screen
  //   approve 0.6    a consent screen; consent is input, but decision 14
  //                  lets reversible defaults proceed, so below hand-over
  //   select/refine 0.5  a choice the agent can default and narrate
  //                  (decision 14); the behavioral mining showed people stop
  //                  at the consequential ones, so not 0
  inputNeed: { money: 1, handOver: 1, fromAsk: 0.8, options: 0.8,
               approve: 0.6, select: 0.5, refine: 0.5 },
  // Above this graded severity, an implicit decision exists no matter what
  // the question asks: continue or stop. A catastrophic finding always
  // carries that choice, so input-need ramps from 0 at this floor to 1 at
  // severity 1. Below it, nothing implicit. 0.75, because the rationale says
  // CATASTROPHIC and the floor has to sit where that lives in the coded
  // corpus: 58% of coded questions score above 0.5 (a line most of the
  // corpus clears describes the ordinary, not the catastrophic), while the
  // top bucket above 0.75 holds 14%. Set from the severity distribution of
  // the cost codes themselves, not from any label.
  needSeverityFloor: 0.75,
  // D per surface, same moment-sensitivity as DEFER, cell by cell:
  //   widget takes DEFER's now column - it is an interception at this moment,
  //     and an answer wanted at completion is worth as little captured early
  //     as spoken early (0.4 / 0.35).
  //   checkpoint takes the better of DEFER's two spoken columns - the surface
  //     decision is widget-vs-checkpoint-vs-log, and checkpoint's internal
  //     now-vs-next-pause timing stays with the existing spoken machinery,
  //     which picks the better moment; the surface is scored at that.
  //   log takes the better of DEFER's kept columns - the on-demand class
  //     dissolved into the log, and a question wanted on request keeps FULL
  //     value there (someone asks, the log answers), so its log cell is 1
  //     where DEFER priced the log route 0.7 against a separate on-demand
  //     route that no longer exists.
  defer: {
    'Now':        { widget: 1,    checkpoint: 1,   log: 0.3 },
    'After':      { widget: 1,    checkpoint: 1,   log: 0.6 },
    'Completion': { widget: 0.4,  checkpoint: 0.6, log: 1 },
    'On demand':  { widget: 0.35, checkpoint: 0.4, log: 1 },
  },
};

/**
 * A SURFACE config with the v8 lab's knobs applied. Every knob omitted leaves
 * its shipped value, so surfaceVariant({}) is the shipped config cell by cell
 * and routeSurface scores it bit-identically (the variant test proves this).
 * The knobs, each an explored design question rather than a tuning dial:
 *
 *   severityImpliedPause: false  turns the implicit continue-or-stop ramp off
 *       (the 36-question class where sheer error cost pauses with no named
 *       input need - the open design call). Implemented as floor 1: graded
 *       severity never exceeds 1, so the ramp cannot fire.
 *   approve: number  the consent cluster's input-need weight (shipped 0.6).
 *   select: number   the select AND refine weight together (shipped 0.5) -
 *       the two are one class in the design record ("a choice the agent can
 *       default and narrate"), so the lab moves them together.
 *
 * The care-rate prior is a routeSurface ctx option (carePrior), not a config
 * knob: it changes which terms read f.careRate, not the surface tables.
 */
export function surfaceVariant(opts = {}) {
  const s = { ...SURFACE, I: { ...SURFACE.I }, attention: { ...SURFACE.attention },
              intBase: { ...SURFACE.intBase }, inputNeed: { ...SURFACE.inputNeed } };
  if (opts.severityImpliedPause === false) s.needSeverityFloor = 1;
  if (Number.isFinite(opts.approve)) {
    s.inputNeed.approve = Math.max(0, Math.min(1, opts.approve));
  }
  if (Number.isFinite(opts.select)) {
    const v = Math.max(0, Math.min(1, opts.select));
    s.inputNeed.select = v;
    s.inputNeed.refine = v;
  }
  return s;
}

/**
 * The three-surface expected utility for one finding, and the best surface.
 *
 *   EU(r) = P(e) x P(uncover) x D(r) x I(r) x C_und + V_mon x A(r) - C_int(r)
 *
 * Same P(e), P(uncover), C_und and persona machinery as route() - the only
 * new physics is I(r) and the surface-shaped D, A and cost tables above.
 * History-free for the same reasons. Called by measurement only.
 *
 * @param {Object} f the finding (moment, moneyMoving, costDims, confidence,
 *                   verified ...)
 * @param {{model?: object, weights?: object, surface?: object,
 *          joiningPause?: boolean, signals?: object,
 *          carePrior?: 'pe'|'vmon'|null}} ctx
 *   carePrior — v8 lab experiment: blend the finding's mined care-rate
 *   (f.careRate, [0,1]) into P(e) or into V_mon. Absent or with no finite
 *   careRate on the finding, scoring is bit-identical to shipped v6.
 * @returns {{surface: string, eu: Object<string,number>}}
 */
export function routeSurface(f, ctx = {}) {
  const w = ctx.weights || WEIGHTS;
  const s = ctx.surface || SURFACE;
  const m = ctx.model || null;

  const conf = Number.isFinite(f.confidence)
    ? Math.max(0, Math.min(1, f.confidence)) : 0.8;
  const sig = ctx.signals || {};
  const care = Number.isFinite(f?.careRate)
    ? Math.max(0, Math.min(1, f.careRate)) : null;
  const pe = Math.min(1, w.peBase + w.peDoubt * (1 - conf)
    + (sig.offPlan ? w.peOffPlan : 0)
    + (sig.ambiguity ? w.peAmbiguity : 0)
    + (sig.traceAnomaly ? w.peAnomaly : 0)
    + (ctx.carePrior === 'pe' && care !== null ? w.peCare * care : 0));
  const vmon = ctx.carePrior === 'vmon' && care !== null
    ? w.vmon + w.vmonCare * care : w.vmon;
  const uncover = uncoverOf(f, w);
  const cund = cundOf(f, w);
  const defer = s.defer[f.moment] || s.defer['Now'];

  // v6: the widget's captured-resolution advantage exists only in proportion
  // to there being an input to capture. I(widget) = 1 is the value of forcing
  // a resolution; a finding with no decision in it has no resolution to
  // force, and a "widget" for it is a modal announcement whose aversion
  // probability is a checkpoint's. So the effective I(widget) interpolates
  // from I(checkpoint) at need 0 to I(widget) at need 1. (A surface config
  // without an inputNeed table is scored the v5 way: full I(widget) always.)
  const hasNeed = s.inputNeed != null;
  const need = hasNeed ? inputNeedOf(f, s, w) : 1;
  const iWidget = hasNeed
    ? s.I.checkpoint + (s.I.widget - s.I.checkpoint) * need
    : s.I.widget;

  // Both interrupting surfaces are spoken for the population the layer is
  // for, so the persona multiplies what is SPOKEN; the log costs the same for
  // everyone. v6 prices the widget as hold + sentence: only the sentence is
  // spoken, so only the sentence takes the persona.
  //
  // The hold is waived only where the wait is INTRINSIC: the agent cannot
  // proceed without the person (their credentials, their consent to commit)
  // AND there is a pending action to wait on (a during-run moment). Then the
  // run stalls with or without the layer, and the widget is structure on a
  // wait that was happening anyway. This is deliberately NARROWER than
  // input-need: a select has input-need (a decision exists) but the agent can
  // default it and narrate (decision 14), so pausing there is an added
  // interruption and pays the full hold. Conflating the two made every
  // needful select half-price and the score over-paused (measured: 302
  // checkpoint-labeled rows predicted widget before this split).
  let persona = 1;
  if (m?.vision?.descriptions) persona *= w.personaSpeech;
  if (m?.cognition?.summarize) persona *= w.personaSummarize;

  const duringRun = f.moment !== 'Completion' && f.moment !== 'On demand';
  const cluster = typeof f?.cluster === 'string' ? f.cluster : '';
  const intrinsicHold = hasNeed && duringRun
    && (f?.moneyMoving === true || cluster === 'hand over');
  const widgetCost = s.intWidgetHold != null
    ? s.intWidgetHold * (intrinsicHold ? 0 : 1) + s.intWidgetSentence * persona
    : s.intBase.widget * persona;                       // v5 single price
  const eu = {};
  for (const r of SURFACES) {
    let burden;
    if (r === 'widget') {
      burden = ctx.joiningPause ? widgetCost * MARGINAL_NOW_FACTOR : widgetCost;
    } else {
      burden = s.intBase[r] * (r === 'checkpoint' ? persona : 1);
    }
    const I = r === 'widget' ? iWidget : s.I[r];
    eu[r] = pe * uncover * defer[r] * I * cund
      + vmon * s.attention[r]
      - burden;
  }

  let best = SURFACES[0];
  for (const r of SURFACES) if (eu[r] > eu[best]) best = r;
  return { surface: best, eu };
}

/**
 * How strongly this finding asks for the person's decision or input, in
 * [0,1]. Reads only what the finding already carries at runtime - the
 * harvested options, the model's cluster, the fromAsk provenance flag, the
 * money flag - plus one implicit source: above the severity floor, a
 * continue-or-stop decision exists no matter what the question asks.
 * Combined by max, so adding evidence of need never lowers it; clamped;
 * monotone in severity and in every source.
 */
export function inputNeedOf(f, s = SURFACE, w = WEIGHTS) {
  const n = s.inputNeed;
  if (!n) return 1;
  let need = 0;
  if (f?.moneyMoving === true) need = Math.max(need, n.money);
  const cluster = typeof f?.cluster === 'string' ? f.cluster : '';
  if (cluster === 'hand over') need = Math.max(need, n.handOver);
  if (cluster === 'approve') need = Math.max(need, n.approve);
  if (cluster === 'select') need = Math.max(need, n.select);
  if (cluster === 'refine') need = Math.max(need, n.refine);
  if (f?.fromAsk === true) need = Math.max(need, n.fromAsk);
  if (Array.isArray(f?.options) && f.options.length > 0) {
    need = Math.max(need, n.options);
  }
  const sev = severityOf(f, w);
  if (sev !== null && sev > s.needSeverityFloor) {
    need = Math.max(need,
      (sev - s.needSeverityFloor) / (1 - s.needSeverityFloor));
  }
  return Math.max(0, Math.min(1, need));
}

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
  // The care-rate prior, same option and same two placements as
  // routeSurface() (see WEIGHTS.peCare / vmonCare). Experiment only: nothing
  // live passes carePrior, and without it this line adds exactly zero.
  const care = Number.isFinite(f?.careRate)
    ? Math.max(0, Math.min(1, f.careRate)) : null;
  const pe = Math.min(1, w.peBase + w.peDoubt * (1 - conf)
    + (sig.offPlan ? w.peOffPlan : 0)
    + (sig.ambiguity ? w.peAmbiguity : 0)
    + (sig.traceAnomaly ? w.peAnomaly : 0)
    + (ctx.carePrior === 'pe' && care !== null ? w.peCare * care : 0));
  const vmon = ctx.carePrior === 'vmon' && care !== null
    ? w.vmon + w.vmonCare * care : w.vmon;
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
      + vmon * w.attention[r]
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
