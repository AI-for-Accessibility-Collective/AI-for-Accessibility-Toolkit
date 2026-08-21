/**
 * The verification utility model, v1.
 *
 * What is tested is the behavior the design interview locked, using its own
 * worked examples:
 *
 *   - a wanted-now finding is spoken at the start of a quiet run
 *   - fatigue reroutes rather than deletes: as the run says more, the same
 *     finding migrates toward the log, and nothing is ever dropped
 *   - the locked stops never reach the utility model at all - a contradiction
 *     or a money-moving step holds however tired the run is, because decide()
 *     settles those before routing
 *   - a completion-moment finding goes to the log even at zero fatigue
 *   - the screen-reader persona pays more for the spoken routes, so the same
 *     finding is kept rather than spoken for that person sooner
 *   - every route's score is on the record, so a surface can order by them
 *
 * Run: node test/utility-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const U = await import('../extension/validation/utility.js');
const P = await import('../extension/validation/policy.js');

// A verified, wanted-now, not-money finding - the mid-tier case the whole
// migration story is about.
const midTier = {
  widget: 'What does delivery cost?', phase: 'Check out',
  moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
  contradicts: false, confirming: false, say: 'What does delivery cost? $4.99.',
};

// ── the routes themselves ───────────────────────────────────────────────────

{
  const r = U.route(midTier, { spoken: 0 });
  ok(r.route === 'now', 'a wanted-now finding is spoken at the start of a quiet run');
  ok(U.ROUTES.every((x) => typeof r.eu[x] === 'number'),
    'every route has a score, not just the winner');
}

{
  const quiet = U.route(midTier, { spoken: 0 });
  const tired = U.route(midTier, { spoken: 8 });
  ok(quiet.route === 'now' && tired.route === 'log',
    'fatigue migrates the same finding from spoken to the log');
  ok(tired.eu.log === quiet.eu.log,
    'fatigue raises the cost of speaking and never touches the kept routes');
}

{
  const r = U.route({ ...midTier, moment: 'Completion' }, { spoken: 0 });
  ok(r.route === 'log', 'a completion-moment finding goes to the log even on a quiet run');
}

{
  const r = U.route({ ...midTier, moment: 'On demand' }, { spoken: 6 });
  ok(r.route === 'log' || r.route === 'ondemand',
    'an on-demand finding is kept, not spoken');
}

{
  const sighted = U.route(midTier, { spoken: 2 });
  const blv = U.route(midTier, { spoken: 2, model: { vision: { descriptions: true } } });
  ok(blv.eu.now < sighted.eu.now,
    'the screen-reader persona pays more for the spoken routes');
  ok(blv.eu.log === sighted.eu.log,
    'and the same as everyone else for the kept ones');
}

// ── decide() and the hard gate ──────────────────────────────────────────────

{
  const d = P.decide(midTier, { spoken: 0 });
  ok(d.level === 'aside' && d.route === 'now',
    'decide() folds the now route onto an aside - only locked stops hold');
  ok(d.eu && typeof d.eu.log === 'number', 'and carries the scores out');
}

{
  const d = P.decide({ ...midTier, moment: 'Completion' }, { spoken: 0 });
  ok(d.level === 'ambient' && d.route === 'log',
    'a log-routed finding is ambient: in the panel, not spoken');
}

{
  // The hard gate: a contradiction at brutal fatigue, for a screen-reader
  // user who asked for summaries. Nothing here may soften it.
  const d = P.decide(
    { ...midTier, contradicts: true, say: 'It books LAX, you asked for San Diego.' },
    { spoken: 50, model: { vision: { descriptions: true }, cognition: { summarize: true } } });
  ok(d.level === 'stop' && !d.route,
    'a contradiction never reaches the utility model and holds at any fatigue');
}

{
  const d = P.decide({ ...midTier, moneyMoving: true }, { spoken: 50 });
  ok(d.level === 'stop' && !d.route,
    'a money-moving step never reaches the utility model either');
}

{
  // The extractor path has no moment, and keeps the old ladder.
  const d = P.decide({ widget: 'x', phase: 'Search', say: 'y' }, { spoken: 0 });
  ok(d.level === 'aside' && !d.route,
    'a finding with no moment keeps the old ladder and gets no route');
}

// ── reroute, never delete ───────────────────────────────────────────────────

{
  // At any fatigue, the best route always exists and is one of the four -
  // there is no fatigue level at which a finding falls off the list entirely.
  for (const spoken of [0, 5, 20, 100]) {
    const r = U.route(midTier, { spoken });
    if (!U.ROUTES.includes(r.route)) {
      ok(false, `at spoken=${spoken} the finding fell off the routes`);
    }
  }
  ok(true, 'at every fatigue level the finding still has a route - moved, never lost');
}

console.log(`\n${pass}/${pass + fail} - the utility model routes, the locked stops hold, `
  + 'and fatigue moves things without losing them.');
if (fail) process.exit(1);
