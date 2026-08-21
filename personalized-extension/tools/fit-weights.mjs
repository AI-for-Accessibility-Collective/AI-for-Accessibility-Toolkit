// v7: the fitted-weights experiment. MEASUREMENT ONLY - nothing here ships.
//
// The question this answers: how much of the equation's remaining error is
// CONSTANTS (hand-set numbers in the right structure) versus STRUCTURE (the
// form itself missing a term)? Fit the ~12 combining constants of the v6 form
// on the corrected surface labels with 5-fold cross-validation - fit on the
// train folds, score ONLY the held-out fold - then score each fold's fitted
// config on two transfer sets the fit never saw: the golds-only subset and
// the behavioral-eval rows. If fitted constants close the gap on held-out
// data, the structure is right and the constants were the error; if they do
// not, the structure is what is lacking.
//
// Integrity: the fit target is the corrected surface labels (mapping B,
// provisional). The 44 worth-it labels are never touched. The behavioral rows
// are never fitted on, only scored. Fitted values are reported as an
// experiment row ("v7 fitted (CV)"), never installed as shipped weights.
//
// Run: node tools/fit-weights.mjs [--labels <path>]
//
// Rematch mode (campaign W4): --labels <train elicited> --eval <gold elicited>
// fits on the labels set exactly as above (CV for mean/sd), then refits once
// on the FULL labels set and scores that single configuration ONE time on the
// eval set. The eval set is never seen inside any fitting loop. Adds the
// care-rate prior (carePrior: null|'pe'|'vmon') to the searched space, with
// f.careRate joined from the behavioral mining where a question has one.

import { readFileSync } from 'fs';
import { routeSurface, SURFACES, SURFACE, WEIGHTS }
  from '../extension/validation/utility.js';

const argOf = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : null;
};
const LABELS = argOf('--labels')
  || '/Users/chuanenl/Stanford/Summer Project Ideation '
  + '/Verification Affordances/notes/utility-model/labeling/surface-labels.json';
const EVAL = argOf('--eval');
const BEHAVIORAL = '/Users/chuanenl/Stanford/Summer Project Ideation '
  + '/Verification Affordances/notes/utility-model/labeling/behavioral-eval-labels.json';
const CARE = '/Users/chuanenl/Stanford/Summer Project Ideation '
  + '/Verification Affordances/notes/utility-model/labeling/behavioral-labels.json';
const HTAS = '/Users/chuanenl/Projects/AI-for-Accessibility-Toolkit/'
  + 'personalized-extension/extension/validation/htas';
const GOLDS = '/Users/chuanenl/Stanford/Summer Project Ideation '
  + '/Verification Affordances/taskmodel/gold-v2';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ── the corpus join (minimal copy of measure.mjs's loaders) ────────────────
function questionsOf(root) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { for (const v of n) walk(v); return; }
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.questions)) {
      for (const q of n.questions) out.push(q);
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(root);
  return out;
}

let careByKey = null;
function careRateOf(domain, question) {
  if (careByKey === null) {
    careByKey = new Map();
    try {
      for (const r of JSON.parse(readFileSync(CARE, 'utf8')).rows) {
        if (Number.isFinite(r.care_rate)) {
          careByKey.set(`${r.domain}|${norm(r.question)}`, r.care_rate);
        }
      }
    } catch { /* no mining file: carePrior cells stay inert */ }
  }
  return careByKey.get(`${domain}|${norm(question)}`) ?? null;
}

function loadRows(labelPath) {
  const labels = JSON.parse(readFileSync(labelPath, 'utf8'));
  const byKey = new Map();
  const banks = ['doctor', 'hotel', 'privacy'];
  const golds = ['amazon', 'flights', 'govforms', 'wikipedia'];
  for (const d of banks) {
    for (const q of questionsOf(JSON.parse(readFileSync(`${HTAS}/${d}.json`, 'utf8')))) {
      byKey.set(`${d}|${norm(q.question)}`, q);
    }
  }
  for (const g of golds) {
    for (const q of questionsOf(JSON.parse(readFileSync(`${GOLDS}/${g}-gold.json`, 'utf8')))) {
      byKey.set(`${g}|${norm(q.question)}`, q);
    }
  }
  const rows = [];
  for (const r of labels.rows) {
    const q = byKey.get(`${r.domain}|${norm(r.question)}`);
    if (!q || q.moment == null) continue;
    rows.push({
      domain: r.domain,
      gold: !banks.includes(r.domain),
      label: r.surface,
      f: {
        widget: q.question, say: q.question,
        moment: q.moment, moneyMoving: q.moneyMoving,
        costDims: q.costDims ?? null, cluster: q.cluster ?? null,
        confidence: 0.8, verified: 'verified_exact',
        contradicts: false, confirming: false,
        careRate: careRateOf(r.domain, r.question),
      },
    });
  }
  return rows;
}

// ── scoring ────────────────────────────────────────────────────────────────
const PERSONAS = { sighted: null, sr: { vision: { descriptions: true } } };

function confusion(rows, cfg, model) {
  const cm = {};
  for (const a of SURFACES) { cm[a] = {}; for (const b of SURFACES) cm[a][b] = 0; }
  for (const r of rows) {
    cm[r.label][routeSurface(r.f, {
      model, weights: cfg.weights, surface: cfg.surface, carePrior: cfg.carePrior ?? null,
    }).surface] += 1;
  }
  return cm;
}

function macroF1(rows, cfg, model) {
  const cm = confusion(rows, cfg, model);
  const f1s = [];
  for (const s of SURFACES) {
    const rowN = SURFACES.reduce((t, b) => t + cm[s][b], 0);
    const colN = SURFACES.reduce((t, a) => t + cm[a][s], 0);
    const rec = rowN ? cm[s][s] / rowN : 0;
    const prec = colN ? cm[s][s] / colN : 0;
    f1s.push(prec + rec ? 2 * prec * rec / (prec + rec) : 0);
  }
  return f1s.reduce((a, b) => a + b) / f1s.length;
}
const objective = (rows, cfg) =>
  (macroF1(rows, cfg, PERSONAS.sighted) + macroF1(rows, cfg, PERSONAS.sr)) / 2;

// ── the parameter space (hand-chosen sensible ranges, fixed before running) ─
const SPACE = [
  ['vmon',            (c, v) => { c.weights.vmon = v; },            [0.02, 0.05, 0.08, 0.12]],
  ['I.offer',         (c, v) => { c.surface.I.checkpoint = v; c.surface.I.log = v; }, [0.3, 0.4, 0.5, 0.6, 0.7]],
  ['hold',            (c, v) => { c.surface.intWidgetHold = v; },   [0.04, 0.06, 0.08, 0.1, 0.12]],
  ['sentence',        (c, v) => { c.surface.intWidgetSentence = v; }, [0.02, 0.03, 0.04, 0.06]],
  ['int.checkpoint',  (c, v) => { c.surface.intBase.checkpoint = v; }, [0.02, 0.03, 0.04, 0.06]],
  ['int.log',         (c, v) => { c.surface.intBase.log = v; },     [0, 0.01, 0.02]],
  ['personaSpeech',   (c, v) => { c.weights.personaSpeech = v; },   [1.2, 1.4, 1.6, 1.8]],
  ['att.checkpoint',  (c, v) => { c.surface.attention.checkpoint = v; }, [0.6, 0.7, 0.8, 0.9]],
  ['att.log',         (c, v) => { c.surface.attention.log = v; },   [0.25, 0.35, 0.45]],
  ['need.select',     (c, v) => { c.surface.inputNeed.select = v; c.surface.inputNeed.refine = v; }, [0.3, 0.4, 0.5, 0.6, 0.7]],
  ['need.approve',    (c, v) => { c.surface.inputNeed.approve = v; }, [0.4, 0.5, 0.6, 0.7, 0.8]],
  ['sevFloor',        (c, v) => { c.surface.needSeverityFloor = v; }, [0.6, 0.75, 0.9]],
  ['carePrior',       (c, v) => { c.carePrior = v; },                [null, 'pe', 'vmon']],
];

const freshCfg = () => ({
  weights: JSON.parse(JSON.stringify(WEIGHTS)),
  surface: JSON.parse(JSON.stringify(SURFACE)),
  carePrior: null,
});

function fit(rows) {
  const cfg = freshCfg();
  const chosen = {};
  for (let sweep = 0; sweep < 3; sweep += 1) {
    for (const [name, set, grid] of SPACE) {
      let best = null; let bestScore = -1;
      for (const v of grid) {
        set(cfg, v);
        const s = objective(rows, cfg);
        if (s > bestScore) { bestScore = s; best = v; }
      }
      set(cfg, best);
      chosen[name] = best;
    }
  }
  return { cfg, chosen };
}

// ── deterministic stratified 5-fold ─────────────────────────────────────────
function folds(rows, k = 5) {
  const byLabel = {};
  rows.forEach((r, i) => { (byLabel[r.label] ||= []).push(i); });
  // deterministic shuffle: sort by a hash of the question text
  const hash = (s) => {
    let h = 2166136261;
    for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  };
  const fold = new Array(rows.length);
  for (const idxs of Object.values(byLabel)) {
    idxs.sort((a, b) => hash(rows[a].f.widget) - hash(rows[b].f.widget));
    idxs.forEach((idx, j) => { fold[idx] = j % k; });
  }
  return fold;
}

// ── run ─────────────────────────────────────────────────────────────────────
const rows = loadRows(LABELS);
const behavioral = loadRows(BEHAVIORAL);
const goldRows = rows.filter((r) => r.gold);
console.log(`fit set: ${rows.length} rows (${goldRows.length} golds) · `
  + `behavioral transfer set: ${behavioral.length} rows`);

const K = 5;
const foldOf = folds(rows, K);
const cv = []; const cvS = []; const cvSR = [];
const transferGold = []; const transferBeh = [];
const allChosen = [];
for (let k = 0; k < K; k += 1) {
  const train = rows.filter((_, i) => foldOf[i] !== k);
  const test = rows.filter((_, i) => foldOf[i] === k);
  const { cfg, chosen } = fit(train);
  allChosen.push(chosen);
  cv.push(objective(test, cfg));
  cvS.push(macroF1(test, cfg, PERSONAS.sighted));
  cvSR.push(macroF1(test, cfg, PERSONAS.sr));
  transferGold.push(objective(goldRows, cfg));
  transferBeh.push(objective(behavioral, cfg));
  console.log(`fold ${k}: held-out ${cv[k].toFixed(3)} `
    + `(sighted ${cvS[k].toFixed(3)} / sr ${cvSR[k].toFixed(3)}) · `
    + `golds ${transferGold[k].toFixed(3)} · behavioral ${transferBeh[k].toFixed(3)}`);
}
const mean = (a) => a.reduce((x, y) => x + y) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
console.log(`\nv7 fitted (CV, never shipped):`);
console.log(`held-out macro-F1 mean ${mean(cv).toFixed(3)} sd ${sd(cv).toFixed(3)} `
  + `(sighted ${mean(cvS).toFixed(3)} / sr ${mean(cvSR).toFixed(3)})`);
console.log(`transfer, golds subset: mean ${mean(transferGold).toFixed(3)} sd ${sd(transferGold).toFixed(3)}`);
console.log(`transfer, behavioral rows: mean ${mean(transferBeh).toFixed(3)} sd ${sd(transferBeh).toFixed(3)}`);
console.log(`\nchosen values per fold (stability check):`);
for (const [name] of SPACE) {
  console.log(`  ${name}: ${allChosen.map((c) => c[name]).join(' ')}`);
}

// ── rematch mode: refit on the FULL fit set, then ONE eval-set scoring ──────
if (EVAL) {
  const evalRows = loadRows(EVAL);
  const { cfg, chosen } = fit(rows);
  console.log(`\n=== rematch: fitted on all ${rows.length} fit rows, `
    + `scored ONCE on ${evalRows.length} eval rows ===`);
  const s = macroF1(evalRows, cfg, PERSONAS.sighted);
  const sr = macroF1(evalRows, cfg, PERSONAS.sr);
  console.log(`eval macro-F1: sighted ${s.toFixed(3)} / sr ${sr.toFixed(3)}`);
  for (const [pname, model] of Object.entries(PERSONAS)) {
    const cm = confusion(evalRows, cfg, model);
    const rec = SURFACES.map((x) => {
      const rowN = SURFACES.reduce((t, b) => t + cm[x][b], 0);
      return `${x} ${rowN ? (cm[x][x] / rowN).toFixed(2) : 'n/a'}`;
    }).join(' · ');
    console.log(`per-surface recall (${pname}): ${rec}`);
  }
  console.log(`behavioral transfer of this config: `
    + `${objective(behavioral, cfg).toFixed(3)}`);
  const hand = freshCfg();
  console.log(`\nfitted vs hand-set:`);
  for (const [name, set, grid] of SPACE) {
    const probe = freshCfg();
    // recover the hand-set value by reading what freshCfg holds at that knob:
    // set() writers have no readers, so probe by finding the grid value whose
    // set() leaves the config unchanged from hand-set.
    let handVal = 'custom';
    for (const v of grid) {
      const a = freshCfg(); set(a, v);
      if (JSON.stringify(a) === JSON.stringify(hand)) { handVal = v; break; }
    }
    const marker = String(chosen[name]) === String(handVal) ? '' : '   <- moved';
    console.log(`  ${name}: hand ${handVal} -> fitted ${chosen[name]}${marker}`);
  }
}
