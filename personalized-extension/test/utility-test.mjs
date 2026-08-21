/**
 * The verification utility model, v1.
 *
 * What is tested is the behavior the design interview locked, using its own
 * worked examples:
 *
 *   - a wanted-now finding is spoken
 *   - the routing is history free: the same finding on the same page routes
 *     the same way whether it is the run's first surfaced item or its
 *     fortieth. the layer models the question, the page and the person, and
 *     makes no claim about the person changing over a session
 *   - the locked stops never reach the utility model at all - a contradiction
 *     or a money-moving step holds whatever else is true, because decide()
 *     settles those before routing
 *   - a completion-moment finding goes to the log
 *   - the screen-reader persona pays more for the spoken routes, because a
 *     spoken line costs seconds of a serial channel
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

// A verified, wanted-now, not-money finding - the mid-tier case, the one the
// routing has to actually decide rather than lock.
const midTier = {
  widget: 'What does delivery cost?', phase: 'Check out',
  moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
  contradicts: false, confirming: false, say: 'What does delivery cost? $4.99.',
};

// ── the routes themselves ───────────────────────────────────────────────────

{
  const r = U.route(midTier, {});
  ok(r.route === 'now', 'a wanted-now finding is spoken');
  ok(U.ROUTES.every((x) => typeof r.eu[x] === 'number'),
    'every route has a score, not just the winner');
}

{
  // Nothing about the rest of the run enters the routing. Passing history in
  // any shape must not move a single score.
  const bare = U.route(midTier, {});
  const withHistory = U.route(midTier, { spoken: 40, spent: 40, said: 40 });
  ok(JSON.stringify(bare.eu) === JSON.stringify(withHistory.eu),
    'the routing is history free - nothing about earlier in the run moves a score');
  ok(bare.route === 'now', 'and a wanted-now verified finding is spoken');
}

{
  const r = U.route({ ...midTier, moment: 'Completion' }, {});
  ok(r.route === 'log', 'a completion-moment finding goes to the log');
}

{
  const r = U.route({ ...midTier, moment: 'On demand' }, {});
  ok(r.route === 'log' || r.route === 'ondemand',
    'an on-demand finding is kept, not spoken');
}

{
  const sighted = U.route(midTier, {});
  const blv = U.route(midTier, { model: { vision: { descriptions: true } } });
  ok(blv.eu.now < sighted.eu.now,
    'the screen-reader persona pays more for the spoken routes');
  ok(blv.eu.log === sighted.eu.log,
    'and the same as everyone else for the kept ones');
}

// ── decide() and the hard gate ──────────────────────────────────────────────

{
  const d = P.decide(midTier, {});
  ok(d.level === 'aside' && d.route === 'now',
    'decide() folds the now route onto an aside - only locked stops hold');
  ok(d.eu && typeof d.eu.log === 'number', 'and carries the scores out');
}

{
  const d = P.decide({ ...midTier, moment: 'Completion' }, {});
  ok(d.level === 'ambient' && d.route === 'log',
    'a log-routed finding is ambient: in the panel, not spoken');
}

{
  // The hard gate, for a screen-reader user who asked for summaries. Nothing
  // here may soften it.
  const d = P.decide(
    { ...midTier, contradicts: true, say: 'It books LAX, you asked for San Diego.' },
    { model: { vision: { descriptions: true }, cognition: { summarize: true } } });
  ok(d.level === 'stop' && !d.route,
    'a contradiction never reaches the utility model and always holds');
}

{
  const d = P.decide({ ...midTier, moneyMoving: true }, {});
  ok(d.level === 'stop' && !d.route,
    'a money-moving step never reaches the utility model either');
}

{
  // The extractor path has no moment, and keeps the old ladder.
  const d = P.decide({ widget: 'x', phase: 'Search', say: 'y' }, {});
  ok(d.level === 'aside' && !d.route,
    'a finding with no moment keeps the old ladder and gets no route');
}

// ── reroute, never delete ───────────────────────────────────────────────────

{
  // Every finding gets one of the four routes, whatever its fields say. A
  // finding is moved between routes, never dropped off them.
  let all = true;
  for (const moment of ['Now', 'After', 'Completion', 'On demand', 'nonsense']) {
    for (const money of [true, false]) {
      const r = U.route({ ...midTier, moment, moneyMoving: money }, {});
      if (!U.ROUTES.includes(r.route)) all = false;
    }
  }
  ok(all, 'every finding has a route - moved between them, never lost');
}

console.log(`\n${pass}/${pass + fail} - the utility model routes, the locked stops hold, `
  + 'and every finding lands on one of the four routes.');
if (fail) process.exit(1);
