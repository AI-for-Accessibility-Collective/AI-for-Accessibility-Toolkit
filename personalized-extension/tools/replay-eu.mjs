#!/usr/bin/env node
// Replay-tuning harness for the verification utility model.
//
// Decision 17 in the design doc: replay the recorded runs through the EU model
// under candidate weights, assert the known moments route correctly, and keep
// interruption counts low. This is that replay, and it doubles as the standing
// regression suite for the router.
//
// What it does:
//   1. Reads every ~/Downloads/validation-recordings/*/steps.jsonl and pulls
//      the `finding` events' raw finding objects, in run order.
//   2. Replays each run's findings through the SHIPPED router — decide() in
//      policy.js, which applies the locked-stop ladder before the EU argmax —
//      tracking a running spoken count exactly the way run.js does: the count
//      of prior non-ambient outcomes, computed before each decision.
//   3. Sweeps a grid over intBase.now × fatiguePerSaid.now. decide() does not
//      take weights, so the sweep uses a line-for-line replica of its ladder
//      (replicaDecide below) that forwards weights into route(); at the
//      shipped weights the replica is asserted equal to decide() on every
//      finding of every run, which is what licenses using it for the other
//      cells.
//   4. Per cell per run: spoken count (asides — the now/after routes plus the
//      ladder's plain asides), kept count (log/ondemand), stops (locked, and
//      asserted invariant across cells), and the fatigue level at which the
//      first finding migrated to a kept route that would have been spoken at
//      fatigue zero.
//   5. Asserts in every cell: contradictions and moneyMoving always stop
//      (modulo the shipped unchanged-repeat dedupe, counted and reported);
//      every finding gets a route (nothing dropped); EU(now) falls
//      monotonically with the spoken count.
//
// Usage:  node tools/replay-eu.mjs [--dir <recordings dir>] [--json]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decide } from '../extension/validation/policy.js';
import { route, WEIGHTS } from '../extension/validation/utility.js';

const args = process.argv.slice(2);
const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DIR = argOf('--dir') || join(homedir(), 'Downloads', 'validation-recordings');
const AS_JSON = args.includes('--json');

// The sweep grid. The shipped v1 values (0.12, 0.01) are one of the cells, so
// the shipped router is compared on the same footing as every candidate.
const INT_NOW = [0.08, 0.12, 0.16, 0.22];
const FAT_NOW = [0.005, 0.01, 0.02, 0.04];

// ── loading ─────────────────────────────────────────────────────────────────

// A finding event carries its raw finding under .raw in every recording made
// since the publish-shape fix; the oldest (cart) has some fields only at the
// event level. Read .raw when it is an object and fall back to the event, so
// both shapes work.
function loadRun(dir, name) {
  const file = join(dir, name, 'steps.jsonl');
  if (!existsSync(file)) return null;
  const findings = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.kind !== 'finding') continue;
    const raw = (e.raw && typeof e.raw === 'object') ? e.raw : e;
    findings.push({
      widget: raw.widget ?? e.widget,
      phase: raw.phase ?? e.phase,
      say: raw.say ?? e.say,
      moment: raw.moment ?? e.moment ?? null,
      moneyMoving: raw.moneyMoving ?? e.moneyMoving,
      contradicts: raw.contradicts ?? e.contradicts,
      confidence: raw.confidence ?? e.confidence,
      verified: raw.verified ?? e.verified,
      confirming: raw.confirming ?? e.confirming,
      quiet: raw.quiet ?? e.quiet,
      // What the live build decided at record time, for the cross-check.
      recordedLevel: raw.level ?? null,
      recordedRoute: raw.route ?? null,
      recordedEu: raw.eu ?? null,
    });
  }
  return findings.length ? { name, findings } : null;
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

// ── the replica of decide()'s ladder, taking weights ────────────────────────

// policy.js decides the locked stops before the EU model runs and decide()
// does not accept weights, so the sweep needs this: the same ladder, same
// order, forwarding candidate weights into route(). Mirrored from policy.js
// (confirming → dedupe guard → contradiction stop → moneyMoving stop →
// irreversible-phase stop → EU route → plain aside). The insistence shift and
// the answerable-downgrade are omitted because the replay carries no
// AbilityModel, no style, and no answerable field — under those conditions
// decide() takes none of those branches, which the fidelity assertion below
// verifies on every finding.
const IRREVERSIBLE_AFTER = new Set(['Add to cart', 'Checkout', 'Review order']);
const ROUTE_LEVEL = { now: 'aside', after: 'aside', log: 'ambient', ondemand: 'ambient' };

function replicaDecide(f, state, weights) {
  const seen = state.seen;
  const key = `${f.widget}|${f.phase}`;
  if (f.confirming) return { level: 'ambient', kind: 'confirming' };
  if (seen.has(key) && !(f.contradicts && !seen.has(`${key}|${f.say}`))) {
    return { level: 'ambient', kind: 'dedupe' };
  }
  if (f.contradicts) return { level: 'stop', kind: 'locked' };
  if (f.moneyMoving === true) return { level: 'stop', kind: 'locked' };
  if (IRREVERSIBLE_AFTER.has(f.phase)) return { level: 'stop', kind: 'locked' };
  if (f.moment != null) {
    const r = route(f, { spoken: state.spoken, weights });
    return { level: ROUTE_LEVEL[r.route], kind: 'eu', route: r.route, eu: r.eu };
  }
  return { level: 'aside', kind: 'ladder' };
}

// ── one replay of one run ───────────────────────────────────────────────────

// Bookkeeping mirrored from run.js apply(): spoken is the count of prior
// non-ambient outcomes, computed before each decision; both seen keys are
// added after it; the quiet flag downgrades only a ladder aside. One honest
// difference from a live run: run.js also counts the person's answers to
// holds (level 'answer') into the fatigue tally, and this replay sees only
// the finding stream, so a live run with answered holds fatigues slightly
// faster than the same findings replayed here.
function replay(findings, { weights = null, shipped = false } = {}) {
  const seen = new Set();
  let spoken = 0;
  const out = [];
  for (const f of findings) {
    const state = { seen, spoken };
    const d = shipped ? decide(f, state) : replicaDecide(f, state, weights);
    let level = d.level;
    if (f.quiet && level === 'aside' && !d.route) level = 'ambient';
    seen.add(`${f.widget}|${f.phase}`);
    seen.add(`${f.widget}|${f.phase}|${f.say}`);
    // Where a spoken-at-rest finding would have gone with no fatigue: the
    // migration detector compares this against the fatigued route.
    const restRoute = (d.kind === 'eu' || (shipped && d.route))
      ? route(f, { spoken: 0, weights: weights ?? undefined }).route : null;
    out.push({ f, level, route: d.route ?? null, eu: d.eu ?? null,
               kind: d.kind ?? (d.route ? 'eu' : null), spokenAt: spoken, restRoute });
    if (level !== 'ambient') spoken += 1;
  }
  return out;
}

function metrics(decisions) {
  const m = { spoken: 0, kept: 0, stops: 0, ambientOther: 0,
              firstMigrationFatigue: null, stopIdx: [] };
  decisions.forEach((d, i) => {
    if (d.level === 'stop') { m.stops += 1; m.stopIdx.push(i); }
    else if (d.level === 'aside') m.spoken += 1;
    else if (d.route === 'log' || d.route === 'ondemand') m.kept += 1;
    else m.ambientOther += 1;
    const migrated = (d.route === 'log' || d.route === 'ondemand')
      && (d.restRoute === 'now' || d.restRoute === 'after');
    if (migrated && m.firstMigrationFatigue === null) m.firstMigrationFatigue = d.spokenAt;
  });
  return m;
}

// ── invariants, checked in every cell ───────────────────────────────────────

function checkInvariants(run, decisions, weights, maxFatigue) {
  const errs = [];
  let dedupedLocked = 0;
  decisions.forEach((d, i) => {
    const locked = d.f.contradicts === true || d.f.moneyMoving === true;
    // 1. Contradictions and moneyMoving always stop. The one shipped carve-out
    //    is the repetition guard: the same question at the same phase with an
    //    unchanged answer dedupes to ambient by design. Counted, never fatal.
    if (locked && d.level !== 'stop') {
      if (d.kind === 'dedupe') dedupedLocked += 1;
      else errs.push(`${run.name}[${i}]: locked finding routed ${d.level}`);
    }
    // 2. Nothing is dropped: every finding has a level, every EU decision a
    //    route with all four EUs present.
    if (!d.level) errs.push(`${run.name}[${i}]: no level`);
    if (d.kind === 'eu') {
      if (!d.route) errs.push(`${run.name}[${i}]: EU decision with no route`);
      for (const r of ['now', 'after', 'log', 'ondemand']) {
        if (!Number.isFinite(d.eu?.[r])) errs.push(`${run.name}[${i}]: eu.${r} not finite`);
      }
    }
    // 3. EU(now) falls monotonically with the spoken count.
    if (d.kind === 'eu') {
      let prev = Infinity;
      for (let s = 0; s <= maxFatigue + 2; s++) {
        const now = route(d.f, { spoken: s, weights: weights ?? undefined }).eu.now;
        if (now > prev + 1e-12) errs.push(`${run.name}[${i}]: eu.now rose at spoken=${s}`);
        prev = now;
      }
    }
  });
  return { errs, dedupedLocked };
}

// ── main ────────────────────────────────────────────────────────────────────

const runs = loadRuns(DIR);
if (!runs.length) { console.error(`no runs with findings under ${DIR}`); process.exit(1); }

console.log(`replaying ${runs.length} recorded runs from ${DIR}`);
for (const r of runs) {
  const n = r.findings.length;
  const withMoment = r.findings.filter((f) => f.moment != null).length;
  const locked = r.findings.filter((f) => f.contradicts === true || f.moneyMoving === true).length;
  console.log(`  ${r.name}: ${n} findings (${withMoment} with a moment, ${locked} locked-class)`);
}

// Fidelity: at the shipped weights the replica must match decide() on every
// finding, level and route both. This is what makes the sweep's other cells
// meaningful as statements about the shipped router.
let fidelityErrs = 0;
for (const r of runs) {
  const viaDecide = replay(r.findings, { shipped: true });
  const viaReplica = replay(r.findings, { weights: WEIGHTS });
  viaDecide.forEach((a, i) => {
    const b = viaReplica[i];
    if (a.level !== b.level || (a.route ?? null) !== (b.route ?? null)) {
      fidelityErrs += 1;
      console.error(`FIDELITY ${r.name}[${i}]: decide()=${a.level}/${a.route} replica=${b.level}/${b.route}`);
    }
  });
}
if (fidelityErrs) { console.error(`replica does not match decide(): ${fidelityErrs} findings`); process.exit(1); }
console.log('replica matches decide() on every finding at the shipped weights');

// Cross-check against what the live build recorded, where the recording
// carries it. Informational: the recorded routes came from the build and the
// fatigue state at record time, so drift here is a fact about the recording,
// not a failure of the replay.
{
  let have = 0, agree = 0;
  for (const r of runs) {
    const d = replay(r.findings, { shipped: true });
    r.findings.forEach((f, i) => {
      if (!f.recordedRoute) return;
      have += 1;
      if (f.recordedRoute === d[i].route) agree += 1;
    });
  }
  if (have) console.log(`recorded-route cross-check: ${agree}/${have} agree with the shipped replay`);
}

// The sweep.
const cells = [];
let baselineStops = null;
for (const intNow of INT_NOW) {
  for (const fatNow of FAT_NOW) {
    const weights = JSON.parse(JSON.stringify(WEIGHTS));
    weights.intBase.now = intNow;
    weights.fatiguePerSaid.now = fatNow;
    const cell = { intNow, fatNow, runs: {}, errs: [], dedupedLocked: 0 };
    for (const r of runs) {
      const decisions = replay(r.findings, { weights });
      const m = metrics(decisions);
      const maxFatigue = decisions.length ? decisions[decisions.length - 1].spokenAt + 1 : 0;
      const inv = checkInvariants(r, decisions, weights, maxFatigue);
      cell.errs.push(...inv.errs);
      cell.dedupedLocked += inv.dedupedLocked;
      cell.runs[r.name] = m;
    }
    // Stops are locked before the EU model runs, so no cell may move them.
    const stops = runs.map((r) => `${r.name}:${cell.runs[r.name].stopIdx.join('.')}`).join('|');
    if (baselineStops === null) baselineStops = stops;
    else if (stops !== baselineStops) cell.errs.push(`stops moved: ${stops} vs ${baselineStops}`);
    cells.push(cell);
  }
}

const failed = cells.filter((c) => c.errs.length);
for (const c of failed) {
  console.error(`\nINVARIANT FAILURES at intBase.now=${c.intNow} fatiguePerSaid.now=${c.fatNow}:`);
  for (const e of c.errs) console.error(`  ${e}`);
}

// The table: one row per cell, spoken/kept per run, stops once (invariant).
const names = runs.map((r) => r.name);
console.log(`\nstops per run, locked before the EU model, identical in every cell: `
  + names.map((n) => `${n}=${cells[0].runs[n].stops}`).join('  '));
console.log('\n| intBase.now | fatiguePerSaid.now | '
  + names.map((n) => `${n} spoken/kept`).join(' | ')
  + ' | first migration at fatigue |');
console.log(`|---|---|${names.map(() => '---').join('|')}|---|`);
for (const c of cells) {
  const mig = names.map((n) => c.runs[n].firstMigrationFatigue)
    .filter((x) => x !== null);
  const migStr = names.map((n) => {
    const v = c.runs[n].firstMigrationFatigue;
    return `${n[0]}:${v === null ? '—' : v}`;
  }).join(' ');
  const shipped = c.intNow === WEIGHTS.intBase.now && c.fatNow === WEIGHTS.fatiguePerSaid.now;
  console.log(`| ${c.intNow}${shipped ? ' (v1)' : ''} | ${c.fatNow} | `
    + names.map((n) => `${c.runs[n].spoken}/${c.runs[n].kept}`).join(' | ')
    + ` | ${migStr} |`);
}

if (AS_JSON) console.log('\n' + JSON.stringify({ runs: names, cells }, null, 2));

if (failed.length) { console.error(`\n${failed.length} cells failed invariants`); process.exit(1); }
console.log('\nall invariants hold in all cells');
