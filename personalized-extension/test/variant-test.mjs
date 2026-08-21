// The v8 lab's contract: the knobs are experiments, and experiments must not
// be able to change shipped behavior by existing. Defaults are bit-identical
// to v6, every knob moves its target monotonically in its intended direction,
// and the care prior is inert unless BOTH the option is passed and the
// finding carries a finite care rate.
import * as U from '../extension/validation/utility.js';

let pass = 0; let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass += 1; console.log(`PASS ${msg}`); }
  else { fail += 1; console.log(`FAIL ${msg}`); }
};
const euEq = (a, b) => U.SURFACES.every((r) => a.eu[r] === b.eu[r]);

// A battery spanning the knobs' inputs: clusters, money, severity, options.
const battery = [
  { moment: 'Now', cluster: 'approve', confidence: 0.9 },
  { moment: 'Now', cluster: 'select', confidence: 0.8 },
  { moment: 'Now', cluster: 'refine', confidence: 0.7 },
  { moment: 'Now', cluster: 'hand over', confidence: 1 },
  { moment: 'Now', moneyMoving: true, confidence: 0.6 },
  { moment: 'Completion', cluster: 'receipts', confidence: 0.9 },
  { moment: 'On demand', cluster: 'facts', confidence: 0.8 },
  { moment: 'Now', cluster: 'facts',
    costDims: { money: 3, privacy: 3, safety: 3, thirdParty: 3,
                reversibility: 3, recovery: 3 } },
  { moment: 'Now', cluster: 'facts',
    costDims: { money: 0, privacy: 1, safety: 0, thirdParty: 0,
                reversibility: 1, recovery: 0 } },
  { moment: 'After', options: ['a', 'b'], confidence: 0.85 },
];

// ── defaults are bit-identical to shipped v6 ───────────────────────────────
{
  const variant = U.surfaceVariant({});
  const all = battery.every((f) =>
    euEq(U.routeSurface(f), U.routeSurface(f, { surface: variant })));
  ok(all, 'surfaceVariant({}) scores bit-identically to the shipped config');

  const withCareRate = battery.every((f) =>
    euEq(U.routeSurface(f), U.routeSurface({ ...f, careRate: 0.9 })));
  ok(withCareRate, 'a careRate on the finding is inert without the carePrior option');

  const withOptionOnly = battery.every((f) =>
    euEq(U.routeSurface(f), U.routeSurface(f, { carePrior: 'pe' })));
  ok(withOptionOnly, 'the carePrior option is inert without a careRate on the finding');
}

// ── knob monotonicity, each in its intended direction ──────────────────────
{
  const approveRow = { moment: 'Now', cluster: 'approve', confidence: 0.9 };
  const [lo, mid, hi] = [0.3, 0.6, 0.8].map((approve) =>
    U.routeSurface(approveRow, { surface: U.surfaceVariant({ approve }) }).eu.widget);
  ok(lo <= mid && mid <= hi, 'raising the approve weight never lowers widget EU');

  const selectRow = { moment: 'Now', cluster: 'select', confidence: 0.9 };
  const [slo, smid, shi] = [0.3, 0.5, 0.7].map((select) =>
    U.routeSurface(selectRow, { surface: U.surfaceVariant({ select }) }).eu.widget);
  ok(slo <= smid && smid <= shi, 'raising the select weight never lowers widget EU');

  const refineRow = { moment: 'Now', cluster: 'refine', confidence: 0.9 };
  const rlo = U.routeSurface(refineRow, { surface: U.surfaceVariant({ select: 0.3 }) }).eu.widget;
  const rhi = U.routeSurface(refineRow, { surface: U.surfaceVariant({ select: 0.7 }) }).eu.widget;
  ok(rlo <= rhi, 'the select knob moves refine with it, one class as documented');

  const severe = { moment: 'Now', cluster: 'facts',
    costDims: { money: 3, privacy: 3, safety: 3, thirdParty: 3,
                reversibility: 3, recovery: 3 } };
  const on = U.routeSurface(severe).eu.widget;
  const off = U.routeSurface(severe,
    { surface: U.surfaceVariant({ severityImpliedPause: false }) }).eu.widget;
  ok(off < on, 'turning the severity-implied pause off lowers widget EU for a severe finding');

  const mild = { moment: 'Now', cluster: 'facts',
    costDims: { money: 0, privacy: 1, safety: 0, thirdParty: 0,
                reversibility: 1, recovery: 0 } };
  const mildOn = U.routeSurface(mild).eu.widget;
  const mildOff = U.routeSurface(mild,
    { surface: U.surfaceVariant({ severityImpliedPause: false }) }).eu.widget;
  ok(mildOn === mildOff, 'below the floor the severity knob changes nothing');
}

// ── the care prior: placement, direction, bounds ───────────────────────────
{
  const f = { moment: 'Now', cluster: 'facts', confidence: 0.9 };
  const base = U.routeSurface(f);
  const pe = U.routeSurface({ ...f, careRate: 1 }, { carePrior: 'pe' });
  ok(U.SURFACES.every((r) => pe.eu[r] >= base.eu[r]),
    'care in P(e) raises every surface, none more than the benefit allows');
  const peLow = U.routeSurface({ ...f, careRate: 0.1 }, { carePrior: 'pe' });
  ok(peLow.eu.widget <= pe.eu.widget && peLow.eu.widget >= base.eu.widget,
    'care in P(e) is monotone in the care rate');

  const vm = U.routeSurface({ ...f, careRate: 1 }, { carePrior: 'vmon' });
  const dW = vm.eu.widget - base.eu.widget;
  const dL = vm.eu.log - base.eu.log;
  ok(dW > 0 && dL > 0, 'care in V_mon raises awareness value on every surface');

  const nan = U.routeSurface({ ...f, careRate: NaN }, { carePrior: 'pe' });
  ok(euEq(nan, base), 'a NaN care rate is ignored, not propagated');
  const big = U.routeSurface({ ...f, careRate: 7 }, { carePrior: 'pe' });
  const one = U.routeSurface({ ...f, careRate: 1 }, { carePrior: 'pe' });
  ok(euEq(big, one), 'the care rate clamps to [0,1]');
}

// ── the four-route form carries the same experiment the same way ───────────
{
  const f = { moment: 'Now', confidence: 0.9 };
  const base = U.route(f);
  const inert = U.route({ ...f, careRate: 0.8 });
  ok(U.ROUTES.every((r) => base.eu[r] === inert.eu[r]),
    'route() ignores careRate without the option, shipped path untouched');
  const pe = U.route({ ...f, careRate: 0.8 }, { carePrior: 'pe' });
  ok(U.ROUTES.every((r) => pe.eu[r] >= base.eu[r]),
    'route() with care in P(e) raises every route');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
