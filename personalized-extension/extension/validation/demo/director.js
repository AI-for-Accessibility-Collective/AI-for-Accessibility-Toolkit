// The demo director: fires the engineered storyline against the live page.
//
// The real agent (browser-harness run.js) does the task; this module only
// decides WHEN each beat of the story speaks, holds the agent at the widgets,
// and hands answers back. Three rules keep it honest:
//
//   * a beat fires only when its relation holds on the live page. The lines
//     read their numbers off the page facts; a fact that could not be read
//     falls back to the rehearsal value and the miss is recorded on the beat.
//   * the widgets hold the REAL gate: a demo hold enters the validation run's
//     waiting list (so exec.js refuses commits) and the agent loop is paused
//     outright until she answers.
//   * the demo ends at the gate. Answering "Book it" stops the run - nothing
//     is ever paid in a demo - and the drawer says so in as many words.
//
// Beats fire in story order, never out of it. A beat whose relation refuses
// to hold stalls the story rather than being skipped silently; `force()` is
// the stage lever that plays the next beat on its fallbacks.

import { BEATS, SCENARIO } from './booking-beats.js';

const KEY = 'aa.demo';
const HOLD_PREFIX = 'demo:';

// The scenario in the person's own words: a stay near Stanford. Matching the
// task sentence rather than a switch means arming is one less thing to do on
// stage - and mismatches just leave the layer in its ordinary mode.
const SCENARIO_RE = /stanford/i;
const TASK_RE = /\b(hotel|room|stay|night|book)/i;

let S = null;            // { armed, idx, fired, answers, budget, done, startedAt }
let loading = null;

const fresh = () => ({ armed: false, idx: 0, fired: [], answers: {}, budget: null,
  done: false, startedAt: Date.now() });

async function load() {
  if (S) return S;
  if (!loading) {
    loading = chrome.storage.local.get(KEY).then((r) => { S = r[KEY] || fresh(); return S; });
  }
  return loading;
}
const save = () => chrome.storage.local.set({ [KEY]: S });

// ── formatting: numbers as a person says them ───────────────────────────────
const fmt = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtRound = (n) => (n == null ? null : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
const MONTHS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May',
  Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October',
  Nov: 'November', Dec: 'December' };
const spokenDate = (s) => String(s || '').replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b\.?/,
  (m) => MONTHS[m.slice(0, 3)]);
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

const miles = (c) => {
  const m = String(c?.distance || '').match(/([\d.]+)\s*(mi|km)/i);
  return m ? Number(m[1]) * (/km/i.test(m[2]) ? 0.621 : 1) : Infinity;
};
const closest = (f) => (f.cards || []).filter((c) => !c.isAd)
  .reduce((a, c) => (miles(c) < miles(a) ? c : a), null) || null;
const oneKing = (c) => /\b1 king bed\b/i.test(c?.units || '')
  && !/\b2 [a-z]+ beds\b/i.test(c?.units || '');
const underBudget = (f, budget) => (f.cards || [])
  .filter((c) => !c.isAd && c.price != null && c.price <= budget);
const familyRooms = (f) => (f.rooms || [])
  .filter((r) => r.beds.some((b) => /^2\s/i.test(b)));

// ── when each beat may fire, and what its line reads off the page ──────────
// Keyed by beat id. guard: does the relation hold on these facts? slots: the
// live values for the line's {tokens} - null falls back to the rehearsal
// value, and the miss lands in fired[i].missed.
const LOGIC = {
  contract: { guard: () => true },
  stanfords: { guard: (f) => f.page === 'home' && (f.destOptions || []).length > 1 },
  winnow: {
    guard: (f) => f.page === 'results' && f.resultCount > 0,
    slots: (f) => ({ count: String(f.resultCount ?? ''), hotels: f.hotelFacet != null ? String(f.hotelFacet) : null }),
  },
  sort: { guard: (f) => f.page === 'results' },
  ad: {
    guard: (f) => (f.cards || []).some((c) => c.isAd),
    // The role is bound the moment this beat fires; the trailing log reads
    // the binding, so a later card shuffle cannot rename the ad it filed.
    bind: (f) => { const i = (f.cards || []).findIndex((c) => c.isAd);
      return { ad: { ...((f.cards || [])[i] || {}), ordinal: ORDINALS[i] || null } }; },
    slots: (f, s) => ({ adOrdinal: s.roles?.ad?.ordinal || null }),
  },
  'ad-log': {
    guard: () => true,
    slots: (f, s) => ({ adName: s.roles?.ad?.name || null,
      adPrice: fmtRound(s.roles?.ad?.price) }),
  },
  collision: {
    guard: (f, s) => f.page === 'results' && s.budget == null && oneKing(closest(f)),
    bind: (f) => ({ closest: { ...closest(f) } }),
    slots: (f, s) => ({ closestPrice: fmtRound(s.roles?.closest?.price) }),
  },
  'collision-log': {
    guard: () => true,
    slots: (f, s) => ({ closestName: s.roles?.closest?.name || null }),
  },
  freeway: {
    guard: (f) => (f.cards || []).some((c) => /palo alto/i.test(c.name || '')
      && !/east palo alto/i.test(c.name || '')
      && /east palo alto/i.test(c.address || '')),
  },
  compare: {
    guard: (f, s) => f.page === 'results' && s.budget != null && underBudget(f, s.budget).length >= 2,
    slots: (f, s) => { const u = underBudget(f, s.budget).sort((a, b) => miles(a) - miles(b));
      return { zenPrice: fmtRound(u[0]?.price), radPrice: fmtRound(u[u.length - 1]?.price) }; },
  },
  room: {
    guard: (f) => f.page === 'property' && familyRooms(f).length >= 2,
    slots: (f) => { const r = familyRooms(f).sort((a, b) => (a.price ?? 9e9) - (b.price ?? 9e9));
      return { room1Price: fmtRound(r[0]?.price), room2Price: fmtRound(r[1]?.price) }; },
  },
  'true-price': {
    guard: (f, s) => f.page === 'checkout' && f.total != null && s.budget != null && f.total > s.budget,
    slots: (f, s) => ({ totalRounded: fmtRound(f.total),
      overBudget: fmtRound(f.total - s.budget) }),
  },
  cancellation: {
    guard: (f) => f.page === 'checkout' && !!f.freeCancelBefore,
    slots: (f) => ({ cancelDate: spokenDate(f.freeCancelBefore), penaltyRounded: fmtRound(f.penalty) }),
  },
  details: { guard: (f) => f.page === 'checkout' && (f.hasArrival || f.hasSpecialRequests) },
  form: { guard: (f) => f.page === 'checkout' && f.hasForm },
  'form-log-1': { guard: () => true },
  'form-log-2': { guard: () => true },
  'form-log-3': { guard: () => true },
  gate: {
    guard: (f) => f.page === 'checkout' && f.total != null,
    slots: (f) => ({ total: fmt(f.total),
      cancelDate: f.freeCancelBefore ? spokenDate(f.freeCancelBefore) : null }),
  },
};

/** Fill {tokens} from live slots, falling back to the beat's rehearsal
 *  values. Returns the filled beat plus which tokens fell back. */
function fill(beat, facts) {
  const live = LOGIC[beat.id]?.slots?.(facts, S) || {};
  const missed = [];
  const sub = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => {
    if (live[k] != null) return live[k];
    missed.push(k);
    return beat.fallbacks?.[k] ?? `{${k}}`;
  });
  return {
    id: beat.id, kind: beat.kind, page: beat.page,
    say: sub(beat.say),
    options: beat.options?.map((o) => ({ ...o, label: sub(o.label) })),
    missed: [...new Set(missed)],
    at: Date.now(),
  };
}

async function fire(beat, facts) {
  const bound = LOGIC[beat.id]?.bind?.(facts, S);
  if (bound) S.roles = { ...(S.roles || {}), ...bound };
  const filled = fill(beat, facts);
  S.fired.push(filled);
  S.idx += 1;
  if (beat.kind === 'widget') {
    // Hold the real gate AND park the loop. The hold is what makes exec.js
    // refuse a commit already in flight; the pause is what stops the model
    // burning turns against a closed gate (the recorded 24-step spin).
    try {
      await globalThis.Validation?.demoHold?.(HOLD_PREFIX + beat.id,
        filled.say.replace(/\*\*/g, ''));
    } catch { /* the pause below still holds the loop */ }
    try { globalThis.BrowserAgent?.pause?.(); } catch { /* hold alone then */ }
  }
  await save();
}

const Director = {
  /** Called with the task sentence when the agent starts. */
  async maybeArm(task) {
    await load();
    const t = String(task || '');
    if (!(SCENARIO_RE.test(t) && TASK_RE.test(t))) return { armed: false };
    S = { ...fresh(), armed: true, task: t };
    await save();
    return { armed: true };
  },

  async disarm() {
    await load();
    S = fresh();
    await save();
  },

  /** Page facts from the content script. Fires every beat whose turn has
   *  come and whose relation holds; stops at a widget until it is answered. */
  async onFacts(facts) {
    await load();
    if (!S.armed || S.done || !facts) return { armed: S.armed };
    // An organic stop with no surface to answer it would park the run
    // forever - the demo's surfaces only speak the story. Release anything
    // the generic layer is holding on, and file that it happened.
    try {
      const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'];
      for (const w of st?.gate?.waitingOn || []) {
        if (!String(w).startsWith(HOLD_PREFIX)) {
          await globalThis.Validation?.answer?.(w, 'Continue.');
          S.fired.push({ id: `released:${w}`, kind: 'log', at: Date.now(),
            say: `Waved past a generic hold (${String(w).slice(0, 40)}) - the story speaks for this run` });
        }
      }
    } catch { /* never let the release path stall the story */ }
    // A fired widget she has not answered blocks everything after it - the
    // agent is paused, and the story does not talk over its own question.
    const pending = [...S.fired].reverse().find((f) => f.kind === 'widget');
    if (pending && !S.answers[pending.id]) return { armed: true, waiting: pending.id };
    let fired = 0;
    while (S.idx < BEATS.length) {
      const b = BEATS[S.idx];
      if (b.post) break;                       // past the gate: never live
      const g = LOGIC[b.id]?.guard;
      if (!g || !g(facts, S)) {
        // Story order is strict for the spine. An optional beat whose
        // relation does not hold right now is skipped only when the next
        // required beat is ready on these same facts - so a missing ad or
        // freeway trap cannot stall the run, and cannot fire out of place.
        if (b.optional) {
          let j = S.idx + 1;
          while (j < BEATS.length && BEATS[j].optional) j += 1;
          const ng = j < BEATS.length && !BEATS[j].post && LOGIC[BEATS[j].id]?.guard;
          if (ng && ng(facts, S)) {
            (S.skipped ||= []).push(b.id);
            S.idx += 1;
            continue;
          }
        }
        break;
      }
      await fire(b, facts);
      fired += 1;
      if (b.kind === 'widget') break;          // wait for her answer
    }
    await save();
    return { armed: true, fired, idx: S.idx };
  },

  /** Her answer, from the overlay. Releases the hold, steers the agent. */
  async onAnswer(id, response) {
    await load();
    if (!S.armed) return { ok: false };
    if (!S.fired.some((f) => f.id === id)) return { ok: false, why: 'not fired' };
    S.answers[id] = { response, at: Date.now() };

    // Answers that carry state the later guards read.
    if (id === 'collision') {
      const m = String(response).match(/\$?\s?([\d,]{3,6})/);
      if (m) S.budget = Number(m[1].replace(/,/g, ''));
    }
    if (id === 'true-price' && /750/.test(String(response))) S.budget = 750;

    try { await globalThis.Validation?.answer?.(HOLD_PREFIX + id, response); }
    catch { /* the resume below still frees the loop */ }

    if (id === 'gate' && /book it/i.test(String(response))) {
      // The demo ends here, by design. Nothing is paid, and the record says
      // so rather than leaving the ending implicit.
      S.done = true;
      S.fired.push({ id: 'demo-end', kind: 'log', at: Date.now(),
        say: 'Stopped at the gate - nothing was paid' });
      await save();
      try { globalThis.BrowserAgent?.stop?.('demo ends at the gate'); } catch { /* stopping is best-effort */ }
      return { ok: true, done: true };
    }

    try {
      globalThis.BrowserAgent?.interject?.(
        `Susan answered: "${response}". Act on her answer and continue the task.`);
    } catch { /* the answer is already in the validation record */ }
    try { globalThis.BrowserAgent?.resume?.(); } catch { /* paused-state is recoverable from the popup */ }
    await save();
    return { ok: true };
  },

  /** Stage lever: play the next beat on its rehearsal fallbacks, relation or
   *  no relation. For live recovery only; the miss list marks it. */
  async force() {
    await load();
    if (!S.armed || S.idx >= BEATS.length) return { ok: false };
    const b = BEATS[S.idx];
    await fire(b, {});
    return { ok: true, id: b.id };
  },

  async state() { await load(); return { ...S }; },
  SCENARIO,
  _test: { LOGIC, fill: (b, f, s) => { S = s || fresh(); return fill(b, f); } },
};

globalThis.DemoDirector = Director;
export { Director };
