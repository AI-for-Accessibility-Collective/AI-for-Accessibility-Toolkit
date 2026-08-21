#!/usr/bin/env node
// The measurement program for the verification utility model.
//
// replay-eu.mjs asks whether the router is stable under its own weights. This
// asks whether the router is RIGHT, against the two kinds of ground truth the
// project actually has: the human moment labels on 242 gold questions plus the
// three pipeline banks, and a hand label over the findings four recorded runs
// surfaced. Five sub-commands, each runnable on its own:
//
//   agreement   route agreement against the human moment labels, per corpus
//               per persona, with a 4x4 confusion matrix, a flip analysis and
//               a weight-fit sweep.
//   label       build the precision labeling instrument: one row per surfaced
//               finding in the recordings, written to tools/stop-labels.json.
//   precision   per-route precision from those labels.
//   attention   A(r) measured as acknowledgment rate per route, from the
//               recordings, next to the shipped constants.
//   auroc       rank quality of EU(now) as a predictor of worth-it.
//
// Usage:  node tools/measure.mjs <agreement|label|precision|attention|auroc>
//                                [--dir <recordings>] [--golds <gold-v2 dir>]
//                                [--json]
//
// Everything here is read-only except `label`, which writes (and merges into)
// tools/stop-labels.json.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { decide } from '../extension/validation/policy.js';
import { route, cundOf, DEFER, WEIGHTS, MARGINAL_NOW_FACTOR } from '../extension/validation/utility.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const args = process.argv.slice(2);
const CMD = args[0];
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DIR = argOf('--dir') || join(homedir(), 'Downloads', 'validation-recordings');
const GOLDS = argOf('--golds')
  || '/Users/chuanenl/Stanford/Summer Project Ideation /Verification Affordances/taskmodel/gold-v2';
const BANKS = join(REPO, 'extension', 'validation', 'htas');
const LABELS = join(HERE, 'stop-labels.json');
const AS_JSON = args.includes('--json');

// The four moment classes, in the glossary's order. These are both the human
// label space and, through ROUTE_CLASS below, the prediction space.
const MOMENTS = ['Now', 'After', 'Completion', 'On demand'];

// A route is a claim about when the answer is wanted, so it maps onto the
// moment glossary: pause now / speak now = Now, speak without pausing = After,
// keep for the completion review = Completion, answer only when asked = On
// demand. A locked stop carries no route (policy.js decides it before the EU
// model runs) and is a pause, so it predicts Now.
const ROUTE_CLASS = { now: 'Now', after: 'After', log: 'Completion', ondemand: 'On demand' };

// The two personas the router distinguishes. `insistenceShift` returns 0 for
// both, so the only difference that reaches a route is utility.js's
// personaSpeech multiplier on the spoken routes: for a screen reader, being
// told costs 1.6x.
const PERSONAS = {
  sighted: null,
  'screen reader': { vision: { descriptions: true } },
};

// ── the ladder, replicated so a sweep can move the weights ──────────────────

// decide() takes no weights, so a weight sweep needs this: policy.js's ladder,
// same order, forwarding candidate weights into route(). Mirrored from
// policy.js — confirming, dedupe guard, contradiction stop, moneyMoving stop,
// irreversible-phase stop, EU route, plain aside. The insistence shift and the
// answerable downgrade are omitted because no corpus question carries `style`
// or `answerable`, and because neither persona produces a nonzero shift; the
// fidelity check below asserts the replica equals decide() at the shipped
// weights on every question of every corpus, which is what licenses using it
// for the other cells.
const IRREVERSIBLE_AFTER = new Set(['Add to cart', 'Checkout', 'Review order']);
const ROUTE_LEVEL = { now: 'aside', after: 'aside', log: 'ambient', ondemand: 'ambient' };

function replicaDecide(f, state, weights) {
  const seen = state.seen || new Set();
  const key = `${f.widget}|${f.phase}`;
  if (f.confirming) return { level: 'ambient', kind: 'confirming' };
  if (seen.has(key) && !(f.contradicts && !seen.has(`${key}|${f.say}`))) {
    return { level: 'ambient', kind: 'dedupe' };
  }
  if (f.contradicts) return { level: 'stop', kind: 'locked', why: 'contradicts' };
  if (f.moneyMoving === true) return { level: 'stop', kind: 'locked', why: 'moneyMoving' };
  if (IRREVERSIBLE_AFTER.has(f.phase)) return { level: 'stop', kind: 'locked', why: 'phase' };
  if (f.moment != null) {
    const r = route(f, { model: state.model, signals: state.signals || null,
                         joiningPause: state.joiningPause === true, weights });
    return { level: ROUTE_LEVEL[r.route], kind: 'eu', route: r.route, eu: r.eu };
  }
  return { level: 'aside', kind: 'ladder' };
}

// What class the ladder's outcome predicts. A locked stop and a plain ladder
// aside have no route: the stop is a pause (Now) and the bare aside is a spoken
// line that pauses nothing (After).
function predictedClass(d) {
  if (d.route) return ROUTE_CLASS[d.route];
  if (d.level === 'stop') return 'Now';
  return 'After';
}

// ── corpora ─────────────────────────────────────────────────────────────────

function* walk(node) {
  if (!node) return;
  yield node;
  for (const c of node.children || []) yield* walk(c);
}

// One question, flattened out of a task model, carrying the node's top-level
// ancestor as its phase — which is what the live layer puts on a finding, and
// what the irreversible-phase rule reads.
function flatten(tree, corpus) {
  const rows = [];
  const visit = (node, phase) => {
    for (const q of node.questions || []) {
      rows.push({
        corpus,
        node: node.id ?? null,
        phase,
        question: q.question,
        moment: q.moment ?? null,
        moneyMoving: q.moneyMoving,
        costDims: q.costDims ?? null,
        cluster: q.cluster ?? null,
      });
    }
    for (const c of node.children || []) visit(c, phase ?? c.label ?? null);
  };
  // The root's children are the phases; below them, the phase is inherited.
  for (const c of tree.children || []) visit(c, c.label ?? null);
  for (const q of tree.questions || []) {
    rows.push({ corpus, node: tree.id ?? null, phase: null, question: q.question,
                moment: q.moment ?? null, moneyMoving: q.moneyMoving, cluster: q.cluster ?? null });
  }
  return rows;
}

function loadCorpora() {
  const out = [];
  if (existsSync(GOLDS)) {
    for (const f of readdirSync(GOLDS).sort()) {
      if (!f.endsWith('-gold.json')) continue;
      const d = JSON.parse(readFileSync(join(GOLDS, f), 'utf8'));
      out.push({ name: `gold:${f.replace('-gold.json', '')}`, kind: 'gold',
                 rows: flatten(d.tree, f.replace('-gold.json', '')) });
    }
  }
  for (const f of ['doctor.json', 'hotel.json', 'privacy.json']) {
    const p = join(BANKS, f);
    if (!existsSync(p)) continue;
    const d = JSON.parse(readFileSync(p, 'utf8'));
    out.push({ name: `bank:${f.replace('.json', '')}`, kind: 'bank',
               rows: flatten(d.tree, f.replace('.json', '')) });
  }
  return out;
}

// The canonical finding: a verified quote, the model's own confidence at 0.8,
// and the question's own moment and moneyMoving. Everything else is held
// still, so the only things that can move a route are the question's labels,
// the persona, and the weights.
function canonical(q) {
  return {
    widget: q.question,
    say: q.question,
    phase: q.phase,
    node: q.node,
    moment: q.moment,
    moneyMoving: q.moneyMoving,
    costDims: q.costDims ?? null,
    confidence: 0.8,
    verified: 'verified_exact',
    contradicts: false,
    confirming: false,
  };
}

// ── recordings ──────────────────────────────────────────────────────────────

// Adapted from replay-eu.mjs's loader. A finding event carries its raw finding
// under .raw in every recording made since the publish-shape fix; the oldest
// (cart) has some fields only at the event level, so read .raw when it is an
// object and fall back to the event. This one also keeps the run's typed query,
// the person events, the hold events, and which page read each finding came
// from — the read grouping is what run.js's apply() uses to decide whether a
// finding is joining a pause that is already happening.
function loadRun(dir, name) {
  const file = join(dir, name, 'steps.jsonl');
  if (!existsSync(file)) return null;
  const findings = [];
  const people = [];
  const holds = [];
  let query = null;
  let readIdx = -1;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.kind === 'typed') { query = String(e.summary || '').replace(/^"|"$/g, ''); continue; }
    if (e.kind === 'read') { readIdx += 1; continue; }
    if (e.kind === 'HOLD') {
      holds.push({ t: e.t, waitingOn: e.waitingOn || [], say: e.say || '' });
      continue;
    }
    if (e.kind === 'person') { people.push({ t: e.t, summary: String(e.summary || '') }); continue; }
    if (e.kind !== 'finding') continue;
    const raw = (e.raw && typeof e.raw === 'object') ? e.raw : e;
    findings.push({
      widget: raw.widget ?? e.widget,
      phase: raw.phase ?? e.phase,
      say: raw.say ?? e.say,
      quote: raw.from ?? e.quote ?? null,
      node: raw.node ?? null,
      moment: raw.moment ?? e.moment ?? null,
      moneyMoving: raw.moneyMoving ?? e.moneyMoving,
      contradicts: raw.contradicts ?? e.contradicts,
      confidence: raw.confidence ?? e.confidence,
      verified: raw.verified ?? e.verified,
      confirming: raw.confirming ?? e.confirming,
      quiet: raw.quiet ?? e.quiet,
      cluster: raw.cluster ?? null,
      readIdx,
      t: e.t,
      recordedLevel: raw.level ?? null,
      recordedRoute: raw.route ?? null,
    });
  }
  return findings.length ? { name, query, findings, people, holds } : null;
}

function loadRuns(dir) {
  const runs = [];
  for (const name of readdirSync(dir).sort()) {
    if (!statSync(join(dir, name)).isDirectory()) continue;
    const run = loadRun(dir, name);
    if (run) runs.push(run);
  }
  return runs;
}

// Which bytes these numbers came from. The recordings directory is a live
// working area — test/record-validation.js overwrites a run's steps.jsonl in
// place every time that scenario is re-recorded, and one such re-run happened
// during this measurement, cutting a nine-finding hotel run down to four. So
// every artifact this program writes pins the exact file it read.
function provenance(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'steps.jsonl');
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const findings = bytes.toString('utf8').split('\n')
      .filter((l) => l.trim()).filter((l) => {
        try { return JSON.parse(l).kind === 'finding'; } catch { return false; }
      }).length;
    out.push({
      run: name,
      bytes: bytes.length,
      modified: statSync(file).mtime.toISOString(),
      sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      findings,
    });
  }
  return out;
}

// Replay one run through the shipped router, mirroring run.js apply(): the
// page's own findings are considered together, a node with a locked finding on
// it is pausing, and every other finding on that node rides the pause at the
// marginal cost. `seen` accumulates across the run exactly as it does live.
function replayRun(run, { model = null } = {}) {
  const seen = new Set();
  const byRead = new Map();
  for (const f of run.findings) {
    if (!byRead.has(f.readIdx)) byRead.set(f.readIdx, []);
    byRead.get(f.readIdx).push(f);
  }
  const out = [];
  for (const [, batch] of [...byRead.entries()].sort((a, b) => a[0] - b[0])) {
    const pausing = new Set(batch
      .filter((f) => f.contradicts === true || f.moneyMoving === true)
      .map((f) => f.node).filter((n) => n != null));
    for (const f of batch) {
      const joiningPause = f.node != null && pausing.has(f.node);
      const d = decide(f, { seen, model, joiningPause });
      let level = d.level;
      if (f.quiet && level === 'aside' && !d.route) level = 'ambient';
      seen.add(`${f.widget}|${f.phase}`);
      seen.add(`${f.widget}|${f.phase}|${f.say}`);
      out.push({ f, level, route: d.route ?? null, eu: d.eu ?? null,
                 joiningPause, why: d.why });
    }
  }
  return out;
}

// ── small numerics ──────────────────────────────────────────────────────────

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '—');

// AUROC by the rank form of the Mann-Whitney statistic, with ties averaged.
// Returns null when one class is empty.
function auroc(scores, labels) {
  const pos = labels.filter(Boolean).length;
  const neg = labels.length - pos;
  if (!pos || !neg) return null;
  const idx = scores.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k][1]] = avg;
    i = j + 1;
  }
  let sum = 0;
  labels.forEach((l, k) => { if (l) sum += rank[k]; });
  return (sum - pos * (pos + 1) / 2) / (pos * neg);
}

// ── agreement ───────────────────────────────────────────────────────────────

function cmdAgreement() {
  const corpora = loadCorpora();
  if (!corpora.length) { console.error('no corpora found'); process.exit(1); }

  console.log('# route agreement against the human moment labels\n');
  console.log('corpora loaded:');
  let totalQ = 0, totalLabelled = 0;
  for (const c of corpora) {
    const labelled = c.rows.filter((r) => r.moment != null).length;
    totalQ += c.rows.length; totalLabelled += labelled;
    console.log(`  ${c.name}: ${c.rows.length} questions, ${labelled} carry a moment label`);
  }
  console.log(`  total: ${totalQ} questions, ${totalLabelled} labelled `
    + `(${totalQ - totalLabelled} unlabelled, excluded from every number below)\n`);

  console.log('CIRCULARITY: the moment label is an INPUT to the router. utility.js reads it');
  console.log('as D(r|q), the fraction of the answer\'s value that survives each route. So a');
  console.log('high agreement number is partly true by construction and is not evidence that');
  console.log('the model is right. The informative cells are the disagreements: where a locked');
  console.log('stop, moneyMoving, the persona or a weight moves a route away from the moment');
  console.log('its own D was built from. Those are counted separately below.\n');

  // Fidelity: the replica must equal decide() at the shipped weights, on every
  // question of every corpus, under both personas.
  let fidelity = 0, checked = 0;
  for (const c of corpora) {
    for (const q of c.rows) {
      for (const [, model] of Object.entries(PERSONAS)) {
        const f = canonical(q);
        const a = decide(f, { seen: new Set(), model });
        const b = replicaDecide(f, { seen: new Set(), model }, WEIGHTS);
        checked += 1;
        if (a.level !== b.level || (a.route ?? null) !== (b.route ?? null)) fidelity += 1;
      }
    }
  }
  if (fidelity) {
    console.error(`replica does not match decide() on ${fidelity}/${checked} question-personas`);
    process.exit(1);
  }
  console.log(`replica matches decide() on all ${checked} question x persona pairs `
    + 'at the shipped weights\n');

  const results = {};
  for (const persona of Object.keys(PERSONAS)) {
    const model = PERSONAS[persona];
    console.log(`\n## persona: ${persona}\n`);
    let pooledHit = 0, pooledN = 0;
    const pooledCm = {};
    for (const a of MOMENTS) { pooledCm[a] = {}; for (const b of MOMENTS) pooledCm[a][b] = 0; }

    for (const c of corpora) {
      const cm = {};
      for (const a of MOMENTS) { cm[a] = {}; for (const b of MOMENTS) cm[a][b] = 0; }
      let hit = 0, n = 0;
      for (const q of c.rows) {
        if (q.moment == null) continue;
        const d = decide(canonical(q), { seen: new Set(), model });
        const pred = predictedClass(d);
        cm[q.moment][pred] += 1;
        pooledCm[q.moment][pred] += 1;
        n += 1;
        if (pred === q.moment) { hit += 1; pooledHit += 1; }
      }
      pooledN += n;
      console.log(`### ${c.name} — agreement ${hit}/${n} = ${pct(hit, n)}\n`);
      printMatrix(cm);
      results[`${persona}|${c.name}`] = { hit, n, cm };
    }
    console.log(`### pooled — agreement ${pooledHit}/${pooledN} = ${pct(pooledHit, pooledN)}\n`);
    printMatrix(pooledCm);
    results[`${persona}|pooled`] = { hit: pooledHit, n: pooledN, cm: pooledCm };
  }

  // ── the flips: every place something other than the moment decided ────────
  console.log('\n## flip analysis — where something other than the moment decided the route\n');

  const flips = { locked: 0, lockedNonNow: 0, lockedByMoment: {}, phaseStop: 0,
                  persona: 0, personaDetail: {}, euDisagree: 0, euDetail: {},
                  bundle: 0, bundleDetail: {} };
  for (const c of corpora) {
    for (const q of c.rows) {
      if (q.moment == null) continue;
      const f = canonical(q);
      const sighted = decide(f, { seen: new Set(), model: PERSONAS.sighted });
      const sr = decide(f, { seen: new Set(), model: PERSONAS['screen reader'] });
      const bundled = decide(f, { seen: new Set(), model: PERSONAS['screen reader'],
                                  joiningPause: true });
      // 1. locked stops: moneyMoving overrides the moment entirely.
      if (q.moneyMoving === true) {
        flips.locked += 1;
        if (q.moment !== 'Now') {
          flips.lockedNonNow += 1;
          flips.lockedByMoment[q.moment] = (flips.lockedByMoment[q.moment] || 0) + 1;
        }
      } else if (IRREVERSIBLE_AFTER.has(q.phase)) {
        flips.phaseStop += 1;
      } else {
        // 2. the persona alone moving the route.
        if (sighted.route !== sr.route) {
          flips.persona += 1;
          const k = `${sighted.route} -> ${sr.route}`;
          flips.personaDetail[k] = (flips.personaDetail[k] || 0) + 1;
        }
        // 3. the EU model disagreeing with the moment it was handed.
        const pred = predictedClass(sr);
        if (pred !== q.moment) {
          flips.euDisagree += 1;
          const k = `${q.moment} -> ${pred}`;
          flips.euDetail[k] = (flips.euDetail[k] || 0) + 1;
        }
        // 4. node bundling: the marginal-cost discount for riding a pause that
        //    is happening anyway.
        if (bundled.route !== sr.route) {
          flips.bundle += 1;
          const k = `${sr.route} -> ${bundled.route}`;
          flips.bundleDetail[k] = (flips.bundleDetail[k] || 0) + 1;
        }
      }
    }
  }
  console.log(`locked by moneyMoving (route never computed): ${flips.locked}`);
  console.log(`  ...of which the human label was NOT "Now": ${flips.lockedNonNow} `
    + `${JSON.stringify(flips.lockedByMoment)}`);
  console.log(`  these are the hard gate overruling the moment label, by design.`);
  console.log(`locked by an irreversible phase name: ${flips.phaseStop}`);
  console.log(`\npersona flipped the route (sighted vs screen reader), `
    + `non-locked questions: ${flips.persona} ${JSON.stringify(flips.personaDetail)}`);
  console.log(`\nEU disagreed with the moment it was handed `
    + `(screen reader, non-locked): ${flips.euDisagree} ${JSON.stringify(flips.euDetail)}`);
  console.log(`\nnode bundling flipped the route (screen reader, joiningPause on): `
    + `${flips.bundle} ${JSON.stringify(flips.bundleDetail)}`);

  // ── weight-fit sweep ─────────────────────────────────────────────────────
  console.log('\n## weight-fit sweep\n');
  console.log('intBase.now x intBase.after x vmon, agreement pooled over every labelled');
  console.log('question in every corpus, scored separately for each persona. Locked stops are');
  console.log('inside the denominator and no weight can move them, which puts a floor under');
  console.log('every cell.\n');

  const GRID_NOW = [0.04, 0.08, 0.12, 0.18, 0.26, 0.36];
  const GRID_AFTER = [0.02, 0.05, 0.08, 0.12, 0.18, 0.26];
  const GRID_VMON = [0.0, 0.05, 0.15, 0.3, 0.5];
  const cells = [];
  const all = corpora.flatMap((c) => c.rows).filter((q) => q.moment != null);
  for (const inow of GRID_NOW) {
    for (const iafter of GRID_AFTER) {
      for (const vmon of GRID_VMON) {
        const w = JSON.parse(JSON.stringify(WEIGHTS));
        w.intBase.now = inow; w.intBase.after = iafter; w.vmon = vmon;
        const cell = { inow, iafter, vmon, n: all.length, hit: {} };
        for (const persona of Object.keys(PERSONAS)) {
          let hit = 0;
          for (const q of all) {
            const d = replicaDecide(canonical(q),
              { seen: new Set(), model: PERSONAS[persona] }, w);
            if (predictedClass(d) === q.moment) hit += 1;
          }
          cell.hit[persona] = hit;
        }
        // The cell that serves both personas: neither number can be bought by
        // wrecking the other.
        cell.worst = Math.min(...Object.values(cell.hit));
        cells.push(cell);
      }
    }
  }
  const isShipped = (c) => c.inow === WEIGHTS.intBase.now
    && c.iafter === WEIGHTS.intBase.after && c.vmon === WEIGHTS.vmon;
  const shipped = cells.find(isShipped);

  const table = (title, key) => {
    const sorted = [...cells].sort((a, b) => key(b) - key(a));
    console.log(`### ranked by ${title}\n`);
    console.log('| rank | intBase.now | intBase.after | vmon | sighted | screen reader |');
    console.log('|---|---|---|---|---|---|');
    const row = (c, rank) => console.log(`| ${rank}${isShipped(c) ? ' (SHIPPED)' : ''} `
      + `| ${c.inow} | ${c.iafter} | ${c.vmon} | ${pct(c.hit.sighted, c.n)} `
      + `| ${pct(c.hit['screen reader'], c.n)} |`);
    sorted.slice(0, 6).forEach((c, i) => row(c, i + 1));
    if (shipped && !sorted.slice(0, 6).includes(shipped)) {
      row(shipped, sorted.indexOf(shipped) + 1);
    }
    const worstCell = sorted[sorted.length - 1];
    const ties = sorted.filter((c) => key(c) === key(sorted[0])).length;
    console.log(`\nbest ${pct(key(sorted[0]), sorted[0].n)}, worst `
      + `${pct(key(worstCell), worstCell.n)} `
      + `(${worstCell.inow}/${worstCell.iafter}/${worstCell.vmon}), over ${cells.length} cells. `
      + `${ties} cell${ties === 1 ? '' : 's'} reach${ties === 1 ? 'es' : ''} the best score.\n`);
  };

  table('sighted agreement', (c) => c.hit.sighted);
  table('screen-reader agreement', (c) => c.hit['screen reader']);
  table('the worse of the two personas', (c) => c.worst);

  // Which routes a weight set can actually choose. A route that never wins the
  // argmax on 1,227 questions is not a route, it is dead code, and the
  // four-route claim depends on all four being reachable.
  console.log('## route reachability\n');
  console.log('How often each route wins the argmax across all 1,227 labelled questions.');
  console.log('A locked stop is counted separately because the EU model never runs on it.\n');
  const best = [...cells].sort((a, b) => b.worst - a.worst)[0];
  console.log('| weights | persona | locked stop | now | after | log | ondemand |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [label, w] of [['shipped (0.12/0.08/0.15)', WEIGHTS],
                            [`best joint (${best.inow}/${best.iafter}/${best.vmon})`, null]]) {
    const weights = w || (() => {
      const x = JSON.parse(JSON.stringify(WEIGHTS));
      x.intBase.now = best.inow; x.intBase.after = best.iafter; x.vmon = best.vmon;
      return x;
    })();
    for (const persona of Object.keys(PERSONAS)) {
      const count = { locked: 0, now: 0, after: 0, log: 0, ondemand: 0 };
      for (const q of all) {
        const d = replicaDecide(canonical(q), { seen: new Set(), model: PERSONAS[persona] },
          weights);
        if (d.route) count[d.route] += 1; else count.locked += 1;
      }
      console.log(`| ${label} | ${persona} | ${count.locked} | ${count.now} | ${count.after} `
        + `| ${count.log} | ${count.ondemand} |`);
    }
  }
  console.log('');

  if (AS_JSON) console.log('\n' + JSON.stringify({ results, flips, cells }, null, 2));
}

function printMatrix(cm) {
  const head = MOMENTS.map((m) => m.padStart(10)).join(' |');
  console.log(`| label \\ predicted |${head} |  row n |`);
  console.log(`|---|${MOMENTS.map(() => '---').join('|')}|---|`);
  for (const a of MOMENTS) {
    const rowN = MOMENTS.reduce((s, b) => s + cm[a][b], 0);
    const cells = MOMENTS.map((b) => {
      const v = cm[a][b];
      return (a === b ? `**${v}**` : `${v}`).padStart(10);
    }).join(' |');
    console.log(`| ${a.padEnd(16)} |${cells} | ${String(rowN).padStart(6)} |`);
  }
  console.log('');
}

// ── label ───────────────────────────────────────────────────────────────────

function cmdLabel() {
  const runs = loadRuns(DIR);
  if (!runs.length) { console.error(`no runs with findings under ${DIR}`); process.exit(1); }

  // Merge, never clobber. A verdict is hand work; re-running the extractor
  // after a recording is added must not erase it.
  let prior = { rows: [] };
  if (existsSync(LABELS)) {
    try { prior = JSON.parse(readFileSync(LABELS, 'utf8')); } catch { prior = { rows: [] }; }
  }
  // Keyed by run, widget, say AND how many times that triple has been seen in
  // the run, because the same finding really can be surfaced twice with
  // identical text: the multiway run asks "Are the region and currency
  // correct?" on two different pages and gets the same answer both times.
  // Without the occurrence counter both rows collapse onto one key and the
  // second one's verdict silently overwrites the first one's.
  const seenKey = new Map();
  const rowKey = (run, widget, say) => {
    const base = `${run}|${widget}|${say}`;
    const n = (seenKey.get(base) || 0) + 1;
    seenKey.set(base, n);
    return `${base}|#${n}`;
  };
  const priorBy = new Map();
  {
    const counter = new Map();
    for (const r of prior.rows || []) {
      const base = `${r.run}|${r.widget}|${r.say}`;
      const n = (counter.get(base) || 0) + 1;
      counter.set(base, n);
      priorBy.set(`${base}|#${n}`, r);
    }
  }

  const rows = [];
  for (const run of runs) {
    // Both personas, because the persona multiplier decides whether an
    // EU-routed finding is spoken at all: under `sighted` these findings are
    // asides, under `screen reader` the same findings are kept. Labelling only
    // one persona's surfaced set would leave the spoken routes with almost
    // nothing in them. A row is in when EITHER persona would put it in front of
    // the person, and it carries what each persona did.
    const sighted = replayRun(run, { model: PERSONAS.sighted });
    const sr = replayRun(run, { model: PERSONAS['screen reader'] });
    sighted.forEach((a, i) => {
      const b = sr[i];
      const surfaced = (d) => d.level === 'stop' || d.level === 'aside';
      if (!surfaced(a) && !surfaced(b)) return;
      const was = priorBy.get(rowKey(run.name, a.f.widget, a.f.say));
      rows.push({
        run: run.name,
        widget: a.f.widget,
        say: a.f.say,
        quote: a.f.quote,
        verdict: was ? was.verdict : null,
        note: was ? was.note : '',
        // Context, so the row can be re-judged without going back to the jsonl.
        query: run.query,
        levelSighted: a.level,
        routeSighted: a.route,
        levelScreenReader: b.level,
        routeScreenReader: b.route,
        why: a.why,
        recordedLevel: a.f.recordedLevel,
        phase: a.f.phase,
        node: a.f.node,
        moment: a.f.moment,
        moneyMoving: a.f.moneyMoving ?? null,
        contradicts: a.f.contradicts ?? null,
        verified: a.f.verified,
        confidence: a.f.confidence ?? null,
        joiningPause: a.joiningPause,
        euNow: a.eu ? a.eu.now : null,
      });
    });
  }

  const out = {
    provisional: true,
    note: 'Verdicts in this file are PROVISIONAL, written by an agent reading each finding '
      + 'against its quote and the run\'s typed query. David re-labels before anything here '
      + 'is published. A second labeler is required for the human-human ceiling the design '
      + 'doc asks for (decision 18); this file is one labeler.',
    generated: new Date().toISOString(),
    source: DIR,
    sourceFiles: provenance(DIR),
    router: 'shipped decide() in extension/validation/policy.js, both personas',
    verdicts: {
      'worth-it': 'surfacing this was the right call — it names a real conflict with the ask, '
        + 'or a real decision the person had to make',
      'not-worth-it': 'the page was correct and the finding said so, or the finding is '
        + 'noise the person gains nothing from being told at that moment',
      unclear: 'genuinely ambiguous — a reasonable labeler could go either way',
    },
    rows,
  };
  writeFileSync(LABELS, JSON.stringify(out, null, 2) + '\n');
  const filled = rows.filter((r) => r.verdict).length;
  console.log(`wrote ${rows.length} rows to ${LABELS} (${filled} already carry a verdict)`);
  const byRun = {};
  for (const r of rows) byRun[r.run] = (byRun[r.run] || 0) + 1;
  console.log('per run: ' + Object.entries(byRun).map(([k, v]) => `${k}=${v}`).join('  '));
  for (const p of ['Sighted', 'ScreenReader']) {
    const byLevel = {};
    for (const r of rows) {
      const k = r[`level${p}`] === 'stop' ? 'stop'
        : `${r[`level${p}`]}/${r[`route${p}`] ?? 'ladder'}`;
      byLevel[k] = (byLevel[k] || 0) + 1;
    }
    console.log(`per outcome (${p}): `
      + Object.entries(byLevel).map(([k, v]) => `${k}=${v}`).join('  '));
  }
  console.log('source files: ' + provenance(DIR)
    .filter((p) => p.findings).map((p) => `${p.run}@${p.sha256}(${p.findings})`).join(' '));
}

function readLabels() {
  if (!existsSync(LABELS)) {
    console.error(`no labels at ${LABELS} — run: node tools/measure.mjs label`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(LABELS, 'utf8'));
}

// ── precision ───────────────────────────────────────────────────────────────

function cmdPrecision() {
  const L = readLabels();
  const rows = L.rows.filter((r) => r.verdict);
  console.log('# per-route precision\n');
  if (L.provisional) {
    console.log('**PROVISIONAL LABELS.** ' + L.note + '\n');
  }
  console.log(`${rows.length} of ${L.rows.length} surfaced findings carry a verdict.\n`);

  // Precision is a property of what was PUT IN FRONT of the person, so a
  // finding only enters a route's denominator under the persona that actually
  // surfaces it. That is why each persona gets its own table: under
  // `screen reader` almost nothing reaches a spoken route at all.
  const groups = (r, p) => (r[`level${p}`] === 'stop' ? 'stop (locked)'
    : r[`level${p}`] === 'aside' ? `aside (route ${r[`route${p}`] ?? 'ladder'})`
    : `kept (route ${r[`route${p}`] ?? 'ladder'}) — not surfaced`);

  const show = (title, subset, p) => {
    const g = {};
    for (const r of subset) {
      const k = groups(r, p);
      g[k] = g[k] || { worth: 0, not: 0, unclear: 0 };
      if (r.verdict === 'worth-it') g[k].worth += 1;
      else if (r.verdict === 'not-worth-it') g[k].not += 1;
      else g[k].unclear += 1;
    }
    console.log(`## ${title}\n`);
    console.log('| outcome | worth-it | not-worth-it | unclear | precision (unclear excluded) |');
    console.log('|---|---|---|---|---|');
    for (const k of Object.keys(g).sort()) {
      const v = g[k];
      const d = v.worth + v.not;
      console.log(`| ${k} | ${v.worth} | ${v.not} | ${v.unclear} | `
        + `${d ? `${v.worth}/${d} = ${pct(v.worth, d)}` : '—'} |`);
    }
    const w = subset.filter((r) => r.verdict === 'worth-it').length;
    const n = subset.filter((r) => r.verdict === 'not-worth-it').length;
    console.log(`| ALL | ${w} | ${n} | ${subset.length - w - n} | `
      + `${w + n ? `${w}/${w + n} = ${pct(w, w + n)}` : '—'} |\n`);
  };

  const runs = [...new Set(rows.map((r) => r.run))].sort();
  for (const [label, p] of [['sighted', 'Sighted'], ['screen reader', 'ScreenReader']]) {
    console.log(`# persona: ${label}\n`);
    for (const run of runs) show(`run: ${run}`, rows.filter((r) => r.run === run), p);
    show('pooled across all runs', rows, p);
  }

  console.log(`These are counts, not rates with confidence intervals: n = ${rows.length} `
    + 'labelled findings across ' + runs.length + ' runs, well under 50. Every number above '
    + 'should be read as "how many", and the percentages are printed only so the columns '
    + 'can be compared to each other.');
}

// ── attention ───────────────────────────────────────────────────────────────

// Which finding a person event refers to. The recorder writes the panel row's
// text, sliced to 70 characters, after a "--"; that text starts with the
// finding's say. The gate press names no finding, so it is attributed to the
// finding the most recent HOLD was waiting on.
function attributeAck(run, decisions) {
  const acked = new Set();
  const events = [];
  const sorted = [...run.people].sort((a, b) => String(a.t).localeCompare(String(b.t)));
  for (const p of sorted) {
    const m = p.summary.match(/^read it and pressed "Got it" -- (.*)$/);
    if (m) {
      const prefix = m[1].trim();
      const hit = decisions.find((d) =>
        (d.f.say && d.f.say.startsWith(prefix.slice(0, 40)))
        || (d.f.widget && d.f.widget.startsWith(prefix.slice(0, 40))));
      events.push({ kind: 'got-it', prefix, matched: !!hit });
      if (hit) acked.add(hit);
      continue;
    }
    const g = p.summary.match(/^pressed "(.+)" on the thing it was waiting for$/);
    if (g) {
      // The most recent hold at or before this press.
      const hold = [...run.holds].filter((h) => String(h.t) <= String(p.t)).pop();
      const name = hold?.waitingOn?.[0];
      const hit = name ? decisions.find((d) => d.f.widget === name) : null;
      events.push({ kind: 'gate', label: g[1], matched: !!hit });
      if (hit) acked.add(hit);
    }
  }
  return { acked, events };
}

function cmdAttention() {
  const runs = loadRuns(DIR);
  console.log('# A(r) measured: acknowledgment rate per route\n');
  console.log('**READ THIS BEFORE THE NUMBERS.** These runs were driven by');
  console.log('test/record-validation.js, not by a person. Its rule is fixed: whenever the');
  console.log('agent is held, press "Got it" on every listed finding, then press the first');
  console.log('safe button on the gate. It never presses anything while the agent is running,');
  console.log('and it never skips anything while it is held. So what is measured below is not');
  console.log('human attention. It is whether a finding was on screen during a hold window —');
  console.log('a property of the layer\'s own hold structure. Treat it as an upper bound on');
  console.log('A(r) for the spoken routes and as no evidence at all about the kept routes.\n');

  const shippedA = WEIGHTS.attention;
  // Two groupings, because they answer different questions. `recorded` is what
  // the live build actually put on screen at record time, which is the only
  // thing a press could possibly have been a response to. `replay` is where the
  // shipped router sends the same finding today, which is what a v1 A(r)
  // constant would be indexed by.
  const tallies = { recorded: {}, sighted: {}, 'screen reader': {} };
  const bump = (which, k, field) => {
    tallies[which][k] = tallies[which][k] || { surfaced: 0, acked: 0 };
    tallies[which][k][field] += 1;
  };
  let unmatched = 0, totalEvents = 0;

  for (const run of runs) {
    const decisions = replayRun(run, { model: PERSONAS['screen reader'] });
    const sighted = replayRun(run, { model: PERSONAS.sighted });
    const { acked, events } = attributeAck(run, decisions);
    totalEvents += events.length;
    unmatched += events.filter((e) => !e.matched).length;
    decisions.forEach((d, i) => {
      const was = acked.has(d);
      const rec = d.f.recordedLevel
        ? `${d.f.recordedLevel}${d.f.recordedRoute ? ` (route ${d.f.recordedRoute})` : ''}`
        : 'not recorded';
      bump('recorded', rec, 'surfaced');
      if (was) bump('recorded', rec, 'acked');
      const key = (x) => (x.level === 'stop' ? 'stop (locked, no route)'
        : x.route ? x.route : `${x.level} (ladder, no route)`);
      bump('screen reader', key(d), 'surfaced');
      if (was) bump('screen reader', key(d), 'acked');
      bump('sighted', key(sighted[i]), 'surfaced');
      if (was) bump('sighted', key(sighted[i]), 'acked');
    });
    console.log(`${run.name}: ${decisions.length} findings, ${run.holds.length} holds, `
      + `${events.length} person actions, ${acked.size} distinct findings acknowledged`);
  }
  console.log('');

  const table = (title, which, shippedFor) => {
    console.log(`## ${title}\n`);
    console.log('| outcome | shipped A(r) | surfaced | acknowledged | measured rate |');
    console.log('|---|---|---|---|---|');
    for (const k of Object.keys(tallies[which]).sort()) {
      const v = tallies[which][k];
      console.log(`| ${k} | ${shippedFor(k)} | ${v.surfaced} | ${v.acked} | `
        + `${pct(v.acked, v.surfaced)} |`);
    }
    console.log('');
  };
  const shippedFor = (k) => {
    if (k.startsWith('stop')) return `${shippedA.now} (a stop is a now)`;
    const m = k.match(/route (\w+)/);
    const r = m ? m[1] : k.split(' ')[0];
    return shippedA[r] ?? '—';
  };
  table('grouped by what the live build recorded at the time', 'recorded', shippedFor);
  table('grouped by where the shipped router sends it today, sighted persona',
    'sighted', shippedFor);
  table('grouped by where the shipped router sends it today, screen-reader persona',
    'screen reader', shippedFor);

  console.log(`${totalEvents} person actions in total, ${unmatched} could not be matched `
    + 'back to a finding (the recorder writes a 70-character slice of the panel row, so a '
    + 'row whose text was rewritten between the press and the log does not match).');
  console.log('\nThe kept routes (log, ondemand) have no acknowledgment path in these');
  console.log('recordings at all: the recorder only ever presses inside a hold, and a kept');
  console.log('finding does not hold. A measured A(log) of 0 here means "the instrument');
  console.log('cannot see it", not "nobody reads the log".');
  console.log('\nsource files: ' + provenance(DIR)
    .filter((p) => p.findings).map((p) => `${p.run}@${p.sha256}(${p.findings})`).join(' '));
}

// ── auroc ───────────────────────────────────────────────────────────────────

function cmdAuroc() {
  const L = readLabels();
  const runs = loadRuns(DIR);
  // Same occurrence-counted key as the label file, for the same reason: two
  // surfacings of one finding with identical text are two rows, not one.
  const byKey = new Map();
  {
    const counter = new Map();
    for (const run of runs) {
      const sighted = replayRun(run, { model: PERSONAS.sighted });
      const sr = replayRun(run, { model: PERSONAS['screen reader'] });
      sighted.forEach((a, i) => {
        const b = sr[i];
        const surfaced = (d) => d.level === 'stop' || d.level === 'aside';
        if (!surfaced(a) && !surfaced(b)) return;
        const base = `${run.name}|${a.f.widget}|${a.f.say}`;
        const n = (counter.get(base) || 0) + 1;
        counter.set(base, n);
        byKey.set(`${base}|#${n}`, b);
      });
    }
  }

  console.log('# AUROC of the EU as a predictor of worth-it\n');
  if (L.provisional) console.log('**PROVISIONAL LABELS.** ' + L.note + '\n');

  // The recordings predate the cost coding, so their findings carry no
  // costDims. The runtime would carry them (flattenModel copies them off the
  // model), so the measurement joins each recorded finding back to its coded
  // question by text. Findings the join misses (adapted rewrites, noticed
  // findings, corpus-path runs) fall back to the moneyMoving bit, exactly as
  // the runtime would for an uncoded question.
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const dimsByQuestion = new Map();
  for (const c of loadCorpora()) {
    for (const q of c.rows) {
      if (q.costDims) dimsByQuestion.set(norm(q.question), q.costDims);
    }
  }
  // Most labeled stops have no bank question to join (the cart run is the
  // corpus path, multiway used a generated model), so tools/stop-costdims.json
  // carries the codes the runtime coding stage would have attached: the same
  // coder, run blind over question text + task only, never the verdict
  // (tools/code_stop_dims.py).
  let sidecar = {};
  try {
    sidecar = JSON.parse(
      readFileSync(join(HERE, 'stop-costdims.json'), 'utf8')).codes || {};
  } catch { /* absent sidecar just means more fallback rows */ }
  let joined = 0;

  const rows = [];
  const counter = new Map();
  for (const r of L.rows) {
    const base = `${r.run}|${r.widget}|${r.say}`;
    const n = (counter.get(base) || 0) + 1;
    counter.set(base, n);
    if (r.verdict !== 'worth-it' && r.verdict !== 'not-worth-it') continue;
    const d = byKey.get(`${base}|#${n}`);
    if (!d) continue;
    // Every surfaced finding gets an EU, including the locked stops, which
    // policy.js decides before the EU model runs. For a ranking question that
    // is the right move: the question is whether the number ORDERS the
    // findings, not whether the router consulted it.
    const dims = dimsByQuestion.get(norm(d.f.widget))
      || sidecar[`${r.run}|${d.f.widget}`] || null;
    if (dims) joined += 1;
    const f = dims ? { ...d.f, costDims: dims } : d.f;
    const scored = route(f, { model: PERSONAS['screen reader'],
                              joiningPause: d.joiningPause });
    // The benefit half on its own: P(e) x P(uncover) x C_und, with D(now) = 1
    // deliberately, so the ranking asks what the finding is worth rather than
    // when it was wanted. The drift assert against route()'s EU uses the REAL
    // defer row - the old assert assumed D(now) = 1 there too, which stopped
    // being true when the kept moments got D(now) < 1.
    const conf = Number.isFinite(f.confidence)
      ? Math.max(0, Math.min(1, f.confidence)) : 0.8;
    const pe = Math.min(1, WEIGHTS.peBase + WEIGHTS.peDoubt * (1 - conf));
    const uncover = f.verified ? WEIGHTS.uncoverVerified : WEIGHTS.uncoverOther;
    const cund = cundOf(f, WEIGHTS);
    const benefit = pe * uncover * cund;
    const persona = WEIGHTS.personaSpeech;
    const intNow = d.joiningPause
      ? WEIGHTS.intBase.now * MARGINAL_NOW_FACTOR : WEIGHTS.intBase.now;
    const deferNow = (DEFER[f.moment] || DEFER.Now).now;
    const expect = benefit * deferNow
      + WEIGHTS.vmon * WEIGHTS.attention.now - intNow * persona;
    if (Math.abs(expect - scored.eu.now) > 1e-9) {
      console.error(`EU recomputation drifted on ${r.run}|${r.widget}: `
        + `${expect} vs ${scored.eu.now}`);
      process.exit(1);
    }
    rows.push({ ...r, euNow: scored.eu.now, benefit, label: r.verdict === 'worth-it' });
  }

  const pos = rows.filter((r) => r.label).length;
  console.log(`${rows.length} labelled findings enter the ranking `
    + `(${pos} worth-it, ${rows.length - pos} not-worth-it). `
    + `${L.rows.filter((r) => r.verdict === 'unclear').length} unclear rows are excluded. `
    + `${joined} carried a joined six-dimension cost coding; the rest fall back to the `
    + 'moneyMoving bit (adapted rewrites, noticed findings, corpus-path runs).\n');

  const aEu = auroc(rows.map((r) => r.euNow), rows.map((r) => r.label));
  const aBen = auroc(rows.map((r) => r.benefit), rows.map((r) => r.label));
  console.log('| predictor | AUROC | n |');
  console.log('|---|---|---|');
  console.log(`| EU(now) | ${aEu === null ? '—' : aEu.toFixed(3)} | ${rows.length} |`);
  console.log(`| P(e) x P(uncover) x C_und alone | ${aBen === null ? '—' : aBen.toFixed(3)} `
    + `| ${rows.length} |`);
  console.log('');

  // How many distinct values the predictor actually takes. With one boolean in
  // C_und and a confidence that is nearly always 1 or 0.9, the score is close
  // to categorical, and an AUROC over three ties is a weak statement.
  const distinctEu = new Set(rows.map((r) => r.euNow.toFixed(9))).size;
  const distinctBen = new Set(rows.map((r) => r.benefit.toFixed(9))).size;
  console.log(`EU(now) takes ${distinctEu} distinct values over those ${rows.length} findings; `
    + `the benefit term takes ${distinctBen}. C_und is now graded from the six-dimension `
    + 'coding where a code joins (before the coding both predictors were near-categorical: '
    + '2 and 4 distinct values, benefit AUROC 0.443). P(uncover) is still one boolean and '
    + 'P(e) still moves only with reported confidence, so those remain tied groups.\n');

  if (distinctEu <= 8) {
    console.log('| EU(now) | worth-it | not-worth-it |');
    console.log('|---|---|---|');
    const g = {};
    for (const r of rows) {
      const k = r.euNow.toFixed(4);
      g[k] = g[k] || { w: 0, n: 0 };
      if (r.label) g[k].w += 1; else g[k].n += 1;
    }
    for (const k of Object.keys(g).sort((a, b) => Number(b) - Number(a))) {
      console.log(`| ${k} | ${g[k].w} | ${g[k].n} |`);
    }
    console.log('');
  }
  console.log(`n = ${rows.length}. No claim of significance is made or available at this size; `
    + 'this is a direction to check against the study labels, not a result.');

  if (AS_JSON) console.log('\n' + JSON.stringify(rows, null, 2));
}

// ── dispatch ────────────────────────────────────────────────────────────────

const COMMANDS = { agreement: cmdAgreement, label: cmdLabel, precision: cmdPrecision,
                   attention: cmdAttention, auroc: cmdAuroc };
if (!COMMANDS[CMD]) {
  console.error('usage: node tools/measure.mjs <agreement|label|precision|attention|auroc> '
    + '[--dir <recordings>] [--golds <gold-v2 dir>] [--json]');
  process.exit(1);
}
COMMANDS[CMD]();
