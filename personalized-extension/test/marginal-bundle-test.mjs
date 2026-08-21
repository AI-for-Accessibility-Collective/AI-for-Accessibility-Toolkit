/**
 * The compound-alert rule: a bundle's cost is charged once.
 *
 * Nine questions riding one pause used to each pay the whole pause, which
 * wrongly demoted cheap additions to the log. Now a finding on a node that is
 * already pausing prices its now route at the marginal cost of one more
 * sentence. What is tested:
 *
 *   - a mid-tier finding a screen-reader user would otherwise keep is spoken
 *     when its node is already pausing, because then it costs a sentence
 *     rather than an interruption
 *   - a finding on a DIFFERENT node gets no discount from someone else's pause
 *   - the persona still prices that sentence
 *   - locked stops are untouched (they never reach the EU model)
 *   - end to end through a run: a stop plus a near-miss on one node come out
 *     as one hold and one spoken aside, not a hold and a logged orphan
 *
 * Run: node test/marginal-bundle-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const U = await import('../extension/validation/utility.js');
const RunMod = await import('../extension/validation/run.js');

// A mid-tier finding: verified, wanted now, no money at stake. For a
// screen-reader user, speaking costs enough that this is kept rather than
// said - unless it can ride a pause that is happening anyway.
const nearMiss = {
  widget: 'What does the room cost per night?', phase: 'Pick a room',
  moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
  contradicts: false, confirming: false, node: '2',
  say: 'What does the room cost per night? $175.',
};

const BLV = { vision: { descriptions: true } };

{
  const alone = U.route(nearMiss, { model: BLV });
  const riding = U.route(nearMiss, { model: BLV, joiningPause: true });
  ok(alone.route !== 'now',
    'alone, a screen-reader user keeps this rather than hearing it');
  ok(riding.route === 'now', 'on a pausing node it rides the pause and is spoken');
  ok(riding.eu.log === alone.eu.log && riding.eu.after === alone.eu.after,
    'only the now route is repriced - the others are untouched');
}

{
  const sighted = U.route(nearMiss, { joiningPause: true });
  const blv = U.route(nearMiss, { model: BLV, joiningPause: true });
  ok(blv.eu.now < sighted.eu.now,
    'the persona still prices the marginal sentence - a bundle is not free');
}

// ── end to end through a run ────────────────────────────────────────────────

{
  const run = RunMod.createRun({ item: 'a hotel room', budget: 180 }, { model: BLV });

  // One page: a contradiction (locked stop) and the near-miss, both on node 2,
  // plus a bystander on node 3.
  const page = [
    { widget: 'Is this the right total?', phase: 'Pick a room',
      say: 'Is this the right total? $186, over your $180.', from: '$186',
      answerable: true, confirming: false, contradicts: true, node: '2',
      moment: 'Now', moneyMoving: false, confidence: 0.9, verified: 'verified_exact' },
    { ...nearMiss },
    { widget: 'How many photos?', phase: 'Pick a room',
      say: 'How many photos? Twelve.', from: '12', answerable: true,
      confirming: false, contradicts: false, node: '3',
      moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact' },
  ];
  const { findings } = run.observeFindings(page, 'Pick a room');
  const byWidget = Object.fromEntries(findings.map((f) => [f.finding.widget, f]));

  ok(byWidget['Is this the right total?'].level === 'stop',
    'the contradiction still stops - locked, never repriced');
  ok(byWidget['What does the room cost per night?'].level === 'aside',
    'the near-miss on the pausing node rides along as a spoken aside');
  ok(byWidget['How many photos?'].level === 'ambient',
    'a bystander on another node gets no discount from someone else\'s pause');
  ok(run.gate().allowed === false && run.gate().waitingOn.length === 1,
    'still exactly ONE hold - riding the pause never creates a second one');
}

console.log(`\n${pass}/${pass + fail} - a pause is paid for once, and what rides it pays `
  + 'for a sentence.');
if (fail) process.exit(1);
