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

  // v6: doubt moves toward the widget only where an input-need exists - with
  // nothing to capture, widget and checkpoint share a benefit core and doubt
  // raises both equally. Options on the finding are the runtime need signal.
  const calm = U.routeSurface({ ...base, options: ['aisle', 'window'], confidence: 1 });
  const doubted = U.routeSurface({ ...base, options: ['aisle', 'window'], confidence: 0 });
  ok(gap(doubted) > gap(calm), 'raising P(e) through doubt moves the score toward the widget');
}

// ── v6: the input-need term ─────────────────────────────────────────────────
{
  const n = (f) => U.inputNeedOf(f);
  ok(n({}) === 0 && n({ moneyMoving: true }) === 1 && n({ cluster: 'hand over' }) === 1,
    'input-need: nothing 0, money and hand-over 1');
  ok(n({ cluster: 'select' }) === 0.5 && n({ cluster: 'approve' }) === 0.6
    && n({ fromAsk: true }) === 0.8 && n({ options: ['a'] }) === 0.8,
    'input-need: graded sources at their documented levels');
  ok(n({ cluster: 'select', moneyMoving: true }) === 1,
    'input-need combines by max, never lowers');
  const sevHigh = { costDims: { money: 3, privacy: 3, thirdParty: 3, safety: 3, reversibility: 3, recovery: 3 } };
  ok(n(sevHigh) === 1, 'catastrophic severity implies the continue-or-stop decision');
  ok(n({ costDims: { money: 1, privacy: 0, thirdParty: 0, safety: 0, reversibility: 0, recovery: 0 } }) === 0,
    'mild severity implies nothing below the floor');
  const vals = [n({}), n({ cluster: 'select' }), n({ fromAsk: true }), n({ moneyMoving: true })];
  ok(vals.every((v, i) => i === 0 || v >= vals[i - 1]) && vals.every((v) => v >= 0 && v <= 1),
    'input-need is ordered and clamped to [0,1]');
}

// ── v6: the split widget price ──────────────────────────────────────────────
{
  // At need 1 the hold is free (the run was stalling regardless) and only the
  // sentence is charged - and only the sentence takes the persona.
  const s = U.SURFACE;
  const needy = { ...base, moneyMoving: true };
  const sighted = U.routeSurface(needy);
  const sr = U.routeSurface(needy, { model: { vision: { descriptions: true } } });
  const gap = sighted.eu.widget - sr.eu.widget;
  const expected = s.intWidgetSentence * (U.WEIGHTS.personaSpeech - 1);
  ok(Math.abs(gap - expected) < 1e-12,
    'at full input-need the persona touches only the sentence component');
  // At need 0 the full hold is charged: the layer alone chose to stop the run.
  const idle = U.routeSurface(base);
  const idleSr = U.routeSurface(base, { model: { vision: { descriptions: true } } });
  ok(Math.abs((idle.eu.widget - idleSr.eu.widget) - expected) < 1e-12
    && idle.eu.widget < sighted.eu.widget,
    'at zero input-need the hold is charged in full, persona-flat');
}

// ── the v5 form is still reproducible through a legacy config ───────────────
{
  const V5 = {
    I: { widget: 1, checkpoint: 0.5, log: 0.5 },
    attention: { widget: 1, checkpoint: 0.8, log: 0.35 },
    intBase: { widget: 0.12, checkpoint: 0.04, log: 0.01 },
    defer: U.SURFACE.defer,
  };
  const f = { ...base, moneyMoving: true };
  const model = { vision: { descriptions: true } };
  const r = U.routeSurface(f, { model, surface: V5 });
  const w = U.WEIGHTS;
  const pe = Math.min(1, w.peBase + w.peDoubt * 0.2);
  const core = pe * U.uncoverOf(f, w) * U.cundOf(f, w);
  const expectWidget = core * V5.defer.Now.widget * 1
    + w.vmon * V5.attention.widget - V5.intBase.widget * w.personaSpeech;
  ok(Math.abs(r.eu.widget - expectWidget) < 1e-12,
    'a legacy surface config reproduces the v5 arithmetic exactly');
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
