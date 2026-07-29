// The shortlist: many products, gathered deeply, spoken briefly.
//
// Digging into one product and digging into eight are different problems. With
// one, the failure is omission — nobody opened the photos. With eight, the
// failure is compression: the agent looked at 300 things and said one sentence,
// and the discarding is invisible. Breadth makes the reporting problem worse in
// exact proportion to how much it helps the decision.
//
// Nothing here is guessed. The separator, the next move, and every number
// spoken are computed from the gathered set, so the agent reports where the
// variance actually is rather than reciting what it happened to collect.
//
//   node prototype/shortlist.mjs

// --------------------------------------------------------------- dimensions
//
// `kind` decides how a dimension is spoken and whether it can rank.
//   number   comparable and orderable — price, rating
//   flag     present or absent — free returns
//   text     neither — material
// `label` names the dimension. `shared` is how it reads when every candidate
// has it ("all have a back strap"), `some` how it reads for a subset ("3 run
// small"). Flags need both because "all a back strap" is not English.
// `decides` marks a dimension people actually choose on — a material nobody
// asked about should not outrank a price that spans four times over.
const DIMENSIONS = [
  { id: 'price',       label: 'price',   kind: 'number', unit: '$', decides: 1 },
  { id: 'rating',      label: 'rating',  kind: 'number', unit: ' stars', decides: 1 },
  { id: 'ratingCount', label: 'how many reviews are behind that', kind: 'number', decides: 0.6 },
  { id: 'backStrap',   label: 'a back strap', kind: 'flag', decides: 1,
    shared: 'have a back strap', some: 'have a back strap' },
  { id: 'flat',        label: 'flat', kind: 'flag', decides: 1,
    shared: 'are flat', some: 'are flat' },
  { id: 'runsSmall',   label: 'sizing', kind: 'flag', decides: 1,
    shared: 'run small', some: 'have reviews saying they run small' },
  { id: 'freeReturns', label: 'returns', kind: 'flag', decides: 0.5,
    shared: 'have free returns', some: 'have free returns' },
  { id: 'material',    label: 'what they are made of', kind: 'text', decides: 0.3 },
];

const DIM = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d]));

// ------------------------------------------------------------------ the set
//
// A candidate carries values AND, per value, how it was established. `depth`
// records what was actually read, because a comparison that looks symmetric
// while resting on unequal evidence is itself a false claim — the format
// implies parity that the gathering did not have.
export function Shortlist({ considered = 0, dropped = [] } = {}) {
  const items = [];

  return {
    add(item) { items.push(item); return this; },
    get items() { return items.filter((i) => !i.removed); },
    get all() { return items; },

    /** What was rejected before the shortlist, and why. */
    discards() {
      const by = {};
      for (const d of dropped) by[d.why] = (by[d.why] || 0) + d.n;
      return { considered, dropped: dropped.reduce((a, d) => a + d.n, 0), by };
    },

    /**
     * Split the dimensions into what every candidate shares and what they
     * differ on. Only the spread can change a decision: a dimension where all
     * eight agree costs eight cells to say and settles nothing.
     */
    separate() {
      const live = this.items;
      const same = [], spread = [], unknown = [];
      for (const d of DIMENSIONS) {
        const vals = live.map((i) => i.values[d.id]);
        const known = vals.filter((v) => v !== undefined && v !== null);
        if (!known.length) { unknown.push({ dim: d, missing: live.length }); continue; }
        if (known.length < live.length) {
          unknown.push({ dim: d, missing: live.length - known.length });
        }
        const distinct = new Set(known.map((v) => JSON.stringify(v)));
        if (distinct.size === 1) same.push({ dim: d, value: known[0] });
        else spread.push({ dim: d, values: known, range: rangeOf(d, known) });
      }
      return { same, spread, unknown };
    },

    /** Per-candidate evidence, so uneven digging is visible. */
    depthLedger() {
      return this.items.map((i) => ({
        name: i.name,
        read: i.depth || {},
        thin: Object.values(i.depth || {}).every((n) => !n),
      }));
    },

    /** How far apart the reads are in time. Prices move; a set gathered over */
    /** minutes is a comparison across time presented as a snapshot.          */
    freshness() {
      const ts = this.items.map((i) => i.readAtSec).filter((t) => typeof t === 'number');
      if (ts.length < 2) return null;
      return { oldestSec: Math.max(...ts), newestSec: Math.min(...ts),
               spreadSec: Math.max(...ts) - Math.min(...ts) };
    },

    remove(pred, why) {
      let n = 0;
      for (const i of items) if (!i.removed && pred(i)) { i.removed = why; n++; }
      return n;
    },
  };
}

function rangeOf(d, vals) {
  if (d.kind === 'number') {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return { lo, hi, span: hi - lo };
  }
  const yes = vals.filter(Boolean).length;
  return { yes, no: vals.length - yes };
}

// ------------------------------------------------------------------- speech
const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
const fmtVal = (d, v) => (d.unit === '$' ? money(v)
  : d.kind === 'number' ? `${v}${d.unit || ''}` : String(v));

/**
 * The separator, spoken. Invariants collapse to one clause; only the spread is
 * enumerated. This is the glance translated, applied to a set rather than a page.
 */
export function sayShortlist(sl) {
  const live = sl.items;
  const { same, spread, unknown } = sl.separate();

  // Nothing, or one thing, is not a set. "0 of them. They all..." is not
  // something a person would say, and with one candidate there is no "all".
  if (!live.length) return ['Nothing matched.'];
  if (live.length === 1) return [sayOne(sl, live[0])];

  const L = [];
  L.push(`${live.length} of them.`);

  const shared = same.filter((s) => s.dim.kind !== 'text' && s.value !== false);
  if (shared.length) {
    L.push(`They all ${listOf(shared.map((s) => s.dim.kind === 'flag' ? s.dim.shared
      : `${s.dim.label} ${fmtVal(s.dim, s.value)}`))}.`);
  }

  // Only the two most decisive differences are spoken. Four clauses of spread
  // is a list nobody can hold, and the tail is reachable by asking -- the same
  // push/pull rule the rest of the system runs on.
  const real = spread.filter((s) => s.dim.kind !== 'text')
                     .sort((a, b) => weight(b) - weight(a));
  const TOP = 2;
  if (real.length) {
    const bits = real.slice(0, TOP).map((s) => (s.dim.kind === 'number'
      ? `${s.dim.label}, ${fmtVal(s.dim, s.range.lo)} to ${fmtVal(s.dim, s.range.hi)}`
      : `${s.range.yes} ${s.dim.some}`));
    const rest = real.length - TOP;
    L.push(`Where they really differ: ${listOf(bits)}.` +
           (rest > 0 ? ` ${rest === 1 ? "There's one other difference" : `There are ${rest} more`}` +
                       ` — say "what else" if you want them.` : ''));
  }

  const gaps = unknown.filter((u) => u.missing)
                      .sort((a, b) => (b.dim.decides || 0) - (a.dim.decides || 0));
  if (gaps.length) {
    // Only the two most decisive gaps are named. A list of five things nobody
    // checked is itself the wall of words this is meant to replace.
    const top = gaps.slice(0, 2);
    const rest = gaps.length - top.length;
    L.push(`I haven't checked ${listOf(top.map((g) =>
      `${g.dim.label} for ${g.missing === live.length ? 'any of them' : g.missing}`))}.` +
      (rest > 0 ? ` ${rest === 1 ? "There's one more thing" : `There are ${rest} more things`}` +
                  ` I haven't looked at.` : ''));
  }
  return L;
}

/**
 * The shortlist as one string. Prefer sayShortlist() where the speech can
 * pause between sentences -- a screen reader reads a long run without a break,
 * and a person cannot ask a question in the middle of one.
 */
export function sayShortlistJoined(sl) {
  const r = sayShortlist(sl);
  return Array.isArray(r) ? r.join(' ') : r;
}

/**
 * One candidate. There is nothing to compare, so the useful thing is the
 * product itself and what has not been checked about it.
 */
function sayOne(sl, item) {
  const known = DIMENSIONS.filter((d) => item.values[d.id] !== undefined
                                      && item.values[d.id] !== null);
  const facts = known.filter((d) => d.kind !== 'flag' || item.values[d.id])
    .slice(0, 3)
    .map((d) => (d.kind === 'flag' ? d.shared.replace(/^(have|are|run) /, '')
                                   : `${d.label} ${fmtVal(d, item.values[d.id])}`));
  const missing = DIMENSIONS.filter((d) => item.values[d.id] === undefined
                                        || item.values[d.id] === null);
  let out = `Just one left: ${item.name}`;
  if (facts.length) out += `, ${listOf(facts)}`;
  out += '.';
  if (missing.length) {
    // listOf already joins with "and", so a tail cannot be appended with
    // another "and" -- it becomes a separate clause instead.
    const named = listOf(missing.slice(0, 2).map((d) => d.label));
    const rest = missing.length - 2;
    out += ` I haven't checked ${named}.` +
           (rest > 0 ? ` There are ${rest} more I haven't looked at.` : '');
  }
  return out;
}

/** The discard pile — what never reached the shortlist, and why. */
export function sayDiscards(sl) {
  const d = sl.discards();
  if (!d.dropped) return null;
  const reasons = Object.entries(d.by).map(([why, n]) => `${n} ${why}`);
  return `I looked at ${d.considered} and dropped ${d.dropped}: ${listOf(reasons)}.`;
}

/** Uneven digging, said plainly rather than implied by a symmetrical table. */
export function sayDepth(sl) {
  const led = sl.depthLedger();
  const thin = led.filter((l) => l.thin);
  const deep = led.filter((l) => !l.thin);
  if (!thin.length) return null;
  // Nothing read anywhere is a different statement from uneven reading, and
  // it is the more alarming one: the whole comparison rests on tile text.
  if (!deep.length) {
    return `I haven't opened any of them yet — this is all from the search page.`;
  }
  const most = deep.sort((a, b) => sum(b.read) - sum(a.read))[0];
  return `Not evenly checked: I read ${describeRead(most.read)} for ${most.name}, ` +
         `and nothing yet for ${thin.length === 1 ? thin[0].name : `${thin.length} of them`}.`;
}

const sum = (o) => Object.values(o).reduce((a, b) => a + (b || 0), 0);
const describeRead = (r) => listOf(Object.entries(r).filter(([, n]) => n)
  .map(([k, n]) => `${n} ${k}`));

/** Time spread across the set, when it is wide enough to matter. */
export function sayFreshness(sl, thresholdSec = 120) {
  const f = sl.freshness();
  if (!f || f.spreadSec < thresholdSec) return null;
  return `These were read over about ${Math.round(f.spreadSec / 60)} minutes. ` +
         `Prices move, so I'll recheck before anything goes in the cart.`;
}

// -------------------------------------------------------------- what's next
//
// "What would you like to do?" is a blank box, and a blank box is the hardest
// thing to face on a linear channel. Instead: find the dimension with the most
// spread among surviving candidates that has NOT been investigated, and offer
// to investigate it — with its cost stated, because a check whose price is
// unknown is a check that gets skipped.
export function nextMove(sl, { readSecPerItem = 30 } = {}) {
  const live = sl.items;
  const { spread, unknown } = sl.separate();

  // Nothing left to separate them by.
  if (!spread.length && !unknown.length) {
    return { kind: 'settled',
             say: `Nothing left separates these ${live.length}. Say a number and I'll open it.` };
  }

  // A dimension nobody has evidence for beats one that is merely wide.
  // A gap is worth filling in proportion to how much that dimension decides
  // and how many candidates it is missing for -- not merely how many.
  //
  // A dimension every known candidate already agrees on is excluded: checking
  // it cannot separate anything, so offering to spend a minute on it wastes
  // the person's time and their patience for being asked.
  const sameIds = new Set(sl.separate().same.map((x) => x.dim.id));
  const gap = unknown.filter((u) => u.missing && !sameIds.has(u.dim.id))
    .map((u) => ({ ...u, score: (u.dim.decides ?? 0.5) * (u.missing / live.length) }))
    .sort((a, b) => b.score - a.score)[0];
  const widestNow = spread.length
    ? spread.slice().sort((a, b) => weight(b) - weight(a))[0] : null;
  // Only chase a gap when it beats what is already visibly separating them.
  if (gap && (!widestNow || gap.score >= weight(widestNow))) {
    const secs = gap.missing * readSecPerItem;
    return {
      kind: 'deepen', dim: gap.dim.id, missing: gap.missing, seconds: secs,
      say: `The thing most likely to decide this is ${gap.dim.label}, and I haven't ` +
           `checked it for ${gap.missing}. That's about ${estimate(secs)}. Want me to?`,
    };
  }

  // Otherwise: the widest live dimension, offered as a narrowing. An empty
  // spread reaches here when every dimension is unknown but none scored above
  // the gap threshold, so it has to be handled rather than indexed into.
  const widest = spread.slice().sort((a, b) => weight(b) - weight(a))[0];
  if (!widest) {
    return { kind: 'settled',
             say: live.length
               ? `I have nothing else to separate these ${live.length}.`
               : `Nothing matched. Want me to loosen something and look again?` };
  }
  if (widest.dim.kind === 'flag') {
    return { kind: 'narrow', dim: widest.dim.id,
             say: `${widest.range.yes} of the ${live.length} ${widest.dim.some}. ` +
                  `Want me to drop those?` };
  }
  return {
    kind: 'narrow', dim: widest.dim.id,
    say: `The widest gap is ${widest.dim.label}: ${fmtVal(widest.dim, widest.range.lo)} ` +
         `to ${fmtVal(widest.dim, widest.range.hi)}. Want me to cut anything above a number?`,
  };
}

// A flag that splits the set near-evenly separates more than a numeric range
// whose values are all bunched together.
// How much a dimension could still change the choice. Spread alone is not
// enough: a fourfold price range matters, a material nobody asked about does
// not, so spread is scaled by how much people decide on that dimension.
function weight(s) {
  const d = s.dim.decides ?? 0.5;
  if (s.dim.kind === 'flag') {
    const n = s.range.yes + s.range.no;
    return d * (1 - Math.abs(s.range.yes - s.range.no) / n);
  }
  const mid = (s.range.lo + s.range.hi) / 2 || 1;
  return d * Math.min(1, s.range.span / mid);
}

const estimate = (s) => (s < 90 ? `${Math.round(s / 15) * 15} seconds`
  : `${Math.round(s / 60)} minutes`);

function listOf(a) {
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

// -------------------------------------------------------------- worked example
// The worked set, exported so the flow document and the CLI demo show the same
// gathering rather than each carrying its own copy.
// The worked example that exercised this lives with the analysis, in the
// research repository. Only the mechanism belongs here.

function demo() {
  const sl = workedShortlist();

  const show = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n`);

  show('WHAT THE AGENT SAYS AFTER GATHERING');
  for (const line of [sayDiscards(sl), ...sayShortlist(sl), sayDepth(sl), sayFreshness(sl)]) {
    if (line) console.log(`  ${line}`);
  }
  const words = [sayDiscards(sl), sayShortlistJoined(sl), sayDepth(sl), sayFreshness(sl)]
    .filter(Boolean).join(' ').split(/\s+/).length;
  console.log(`\n  [${words} words, about ${Math.round(words / 180 * 60)} seconds]`);
  console.log(`  [a product-by-product readback of the same 8 x 8 would be about 213 seconds]`);

  show('WHAT IT OFFERS NEXT — computed, not a blank box');
  const m1 = nextMove(sl);
  console.log(`  agent : ${m1.say}`);
  console.log('  person: yes\n');
  // The person narrows on the dimension instead of naming products.
  const n = sl.remove((i) => i.values.runsSmall, 'runs small');
  console.log(`  person: actually, drop the ones that run small`);
  console.log(`  agent : Dropped ${n}. ${sl.items.length} left.\n`);
  console.log(`  agent : ${sayShortlistJoined(sl)}`);

  show('AND AGAIN, ON THE SMALLER SET');
  console.log(`  agent : ${nextMove(sl).say}`);
}

import { fileURLToPath } from 'url';
import path from 'path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) demo();
