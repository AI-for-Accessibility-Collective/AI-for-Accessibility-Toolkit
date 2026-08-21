/**
 * The compound-alert rule: a bundle's cost is charged once.
 *
 * Nine questions riding one pause used to each pay the whole pause, which
 * wrongly demoted cheap additions to the log. Now a finding on a node that is
 * already pausing prices its now route at the marginal cost of one more
 * sentence. What is tested:
 *
 *   - a mid-tier finding that routes to the log alone routes to now when its
 *     node is already pausing
 *   - a finding on a DIFFERENT node gets no discount from someone else's pause
 *   - fatigue still applies to the marginal sentence
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

// A finding tuned to sit just under the pause bar: verified, wanted now, some
// fatigue, so alone it lands in the log.
const nearMiss = {
  widget: 'What does the room cost per night?', phase: 'Pick a room',
  moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
  contradicts: false, confirming: false, node: '2',
  say: 'What does the room cost per night? $175.',
};

{
  const alone = U.route(nearMiss, { spoken: 6 });
  const riding = U.route(nearMiss, { spoken: 6, joiningPause: true });
  ok(alone.route !== 'now', 'alone at fatigue the finding is not spoken now');
  ok(riding.route === 'now', 'on a pausing node it rides the pause and is spoken');
  ok(riding.eu.log === alone.eu.log && riding.eu.after === alone.eu.after,
    'only the now route is repriced - the others are untouched');
}

{
  const light = U.route(nearMiss, { spoken: 0, joiningPause: true });
  const heavy = U.route(nearMiss, { spoken: 60, joiningPause: true });
  ok(heavy.eu.now < light.eu.now,
    'fatigue still prices the marginal sentence - a bundle is not a free-for-all');
}

// ── end to end through a run ────────────────────────────────────────────────

{
  const run = RunMod.createRun({ item: 'a hotel room', budget: 180 });
  // Warm the fatigue: six spoken findings on another node first.
  const warm = Array.from({ length: 6 }, (_, i) => ({
    widget: `W${i}?`, phase: 'Search', say: `W${i}? Yes.`, from: 'q',
    answerable: true, confirming: false, contradicts: false, node: '1',
    moment: 'Now', moneyMoving: false, confidence: 0.9, verified: 'verified_exact',
  }));
  run.observeFindings(warm, 'Search');

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
