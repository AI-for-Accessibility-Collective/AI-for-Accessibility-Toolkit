/**
 * The three-surface shadow score (routeSurface).
 *
 * What is tested:
 *   - the shadow is a shadow: route() and decide() behave exactly as before,
 *     pinned by recomputing their arithmetic on a fixture battery
 *   - routeSurface is monotone toward widget in C_und and in P(e)
 *   - all three surfaces are reachable
 *   - I(widget) is exactly 1 and every I is in [0,1]
 *   - NaN confidence cannot poison the argmax
 *   - the persona multiplies both spoken surfaces and never the log
 *   - a widget joining an existing pause is priced at the marginal factor
 *
 * Run: node test/surface-test.mjs
 */

let pass = 0; let fail = 0;
const ok = (c, w) => {
  if (c) { pass += 1; console.log(`PASS ${w}`); } else { fail += 1; console.log(`FAIL ${w}`); }
};

const U = await import('../extension/validation/utility.js');
const P = await import('../extension/validation/policy.js');

const base = {
  widget: 'Is the total under the budget?', phase: 'Check out',
  moment: 'Now', moneyMoving: false, confidence: 0.8, verified: 'verified_exact',
  contradicts: false, confirming: false, say: 'Is the total under the budget? $172.',
};

// ── the shadow is a shadow ──────────────────────────────────────────────────
// route()'s arithmetic, recomputed here from the exported weights, must equal
// what route() returns on a battery of findings. If adding the surface form
// had changed the shipped scoring in any way, this pins it.
{
  const battery = [
    base,
    { ...base, moment: 'Completion' },
    { ...base, moment: 'On demand', verified: null },
    { ...base, confidence: 0.2 },
    { ...base, costDims: { money: 3, privacy: 2, thirdParty: 0, safety: 1, reversibility: 3, recovery: 2 } },
  ];
  let drift = 0;
  for (const f of battery) {
    for (const model of [null, { vision: { descriptions: true } }]) {
      const r = U.route(f, { model });
      const w = U.WEIGHTS;
      const conf = Number.isFinite(f.confidence) ? Math.max(0, Math.min(1, f.confidence)) : 0.8;
      const pe = Math.min(1, w.peBase + w.peDoubt * (1 - conf));
      const uncover = U.uncoverOf(f, w);
      const cund = U.cundOf(f, w);
      const defer = U.DEFER[f.moment] || U.DEFER.Now;
      const persona = model ? w.personaSpeech : 1;
      for (const rt of ['now', 'after', 'log', 'ondemand']) {
        const spoken = rt === 'now' || rt === 'after';
        const expect = pe * uncover * defer[rt] * cund
          + w.vmon * w.attention[rt]
          - w.intBase[rt] * (spoken ? persona : 1);
        if (Math.abs(expect - r.eu[rt]) > 1e-12) drift += 1;
      }
    }
  }
  ok(drift === 0, 'route() arithmetic is unchanged on the fixture battery, both personas');
  const d = P.decide({ ...base, moneyMoving: true }, { seen: new Set() });
  ok(d.level === 'stop', 'decide() still locks a money-moving stop before any score runs');
}

// ── monotone toward widget ──────────────────────────────────────────────────
{
  const low = U.routeSurface({ ...base,
    costDims: { money: 0, privacy: 0, thirdParty: 0, safety: 0, reversibility: 0, recovery: 0 } });
  const high = U.routeSurface({ ...base,
    costDims: { money: 3, privacy: 3, thirdParty: 3, safety: 3, reversibility: 3, recovery: 3 } });
  const gap = (r) => r.eu.widget - r.eu.checkpoint;
  ok(gap(high) > gap(low), 'raising C_und moves the score toward the widget');
  ok(high.surface === 'widget', 'an all-high cost coding at a Now moment wins the widget');

  const calm = U.routeSurface({ ...base, confidence: 1 });
  const doubted = U.routeSurface({ ...base, confidence: 0 });
  ok(gap(doubted) > gap(calm), 'raising P(e) through doubt moves the score toward the widget');
}

// ── all three surfaces reachable ────────────────────────────────────────────
{
  const w = U.routeSurface({ ...base, moneyMoving: true,
    costDims: { money: 3, privacy: 0, thirdParty: 0, safety: 0, reversibility: 3, recovery: 2 } });
  const c = U.routeSurface({ ...base,
    costDims: { money: 0, privacy: 0, thirdParty: 0, safety: 0, reversibility: 1, recovery: 1 } });
  const l = U.routeSurface({ ...base, moment: 'Completion' });
  ok(w.surface === 'widget' && c.surface === 'checkpoint' && l.surface === 'log',
    `all three surfaces reachable (${w.surface} / ${c.surface} / ${l.surface})`);
}

// ── I bounds ────────────────────────────────────────────────────────────────
{
  ok(U.SURFACE.I.widget === 1, 'I(widget) is exactly 1: a widget captures the resolution');
  ok(Object.values(U.SURFACE.I).every((v) => v >= 0 && v <= 1), 'every I is a probability');
  ok(U.SURFACE.I.widget > U.SURFACE.I.checkpoint
    && U.SURFACE.I.checkpoint === U.SURFACE.I.log,
    'I separates capture from offer and invents no spread between the offers');
}

// ── NaN cannot poison ───────────────────────────────────────────────────────
{
  const r = U.routeSurface({ ...base, confidence: NaN });
  ok(Object.values(r.eu).every(Number.isFinite), 'NaN confidence clamps, every EU finite');
}

// ── persona and pause pricing ───────────────────────────────────────────────
{
  const sighted = U.routeSurface(base);
  const sr = U.routeSurface(base, { model: { vision: { descriptions: true } } });
  ok(sr.eu.widget < sighted.eu.widget && sr.eu.checkpoint < sighted.eu.checkpoint,
    'the persona multiplies both spoken surfaces');
  ok(sr.eu.log === sighted.eu.log, 'the persona never touches the log');

  const riding = U.routeSurface(base, { joiningPause: true });
  const alone = U.routeSurface(base);
  ok(riding.eu.widget > alone.eu.widget,
    'a widget riding an existing pause pays the marginal cost');
  ok(riding.eu.checkpoint === alone.eu.checkpoint,
    'the marginal discount applies to the pausing surface only');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
