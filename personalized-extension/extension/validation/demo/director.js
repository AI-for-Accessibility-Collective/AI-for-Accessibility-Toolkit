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
let lastFacts = null;    // worker-lifetime; an answer re-advances on these
// One mutation at a time. Facts arrive on a debounce and answers on clicks,
// and two interleaved onFacts calls would both read the same idx and fire
// the same beat twice. Every entry point queues behind the last.
let chain = Promise.resolve();
const serial = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

const fresh = () => ({ armed: false, idx: 0, fired: [], answers: {}, budget: null,
  done: false, startedAt: Date.now() });

// An abandoned demo must not leave its holds in the still-running session -
// they surfaced as "waiting on demo:collision" in the middle of the NEXT,
// perfectly ordinary task.
async function releaseDemoHolds() {
  try {
    const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'];
    for (const w of st?.gate?.waitingOn || []) {
      if (String(w).startsWith(HOLD_PREFIX)) {
        await globalThis.Validation?.answer?.(w, 'Demo ended - cleared its hold.');
      }
    }
  } catch { /* the arm-time sweep is the second chance */ }
}

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
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth'];
const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
const listWords = (xs) => (xs.length <= 1 ? xs.join('')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const shortName = (n) => String(n || '').split(/\s+/).slice(0, 3).join(' ')
  .replace(/[,-]$/, '');
const milesOf = (c) => { const m = miles(c); return Number.isFinite(m) ? m : null; };

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

// ── what each beat reads off the live page ─────────────────────────────────
// The storyline is the spec: every beat plays, in order, when the run
// reaches its page (David, 2026-08-24: "follow my storyline exactly,
// adapted with values based on the page"). There are no relation guards -
// a value the page will not give up falls back to the rehearsal number and
// the miss is recorded on the beat. `bind` captures a role at fire time so
// trailing logs name the card their beat fired on.
const LOGIC = {
  winnow: {
    slots: (f) => ({ count: f.resultCount != null ? String(f.resultCount) : null,
      hotels: f.hotelFacet != null ? String(f.hotelFacet) : null }),
  },
  ad: {
    bind: (f) => {
      const ads = (f.cards || [])
        .map((c, i) => ({ ...c, ordinal: ORDINALS[i] || `number ${i + 1}` }))
        .filter((c) => c.isAd);
      return { ads, ad: ads[0] || null };
    },
    sayLive: (f, s) => {
      const ads = s.roles?.ads;
      if (!ads) return null;
      if (ads.length === 0) return 'No ads mixed into these results.';
      if (ads.length === 1) {
        return `The ${ads[0].ordinal} result is an ad, so I'm skipping it.`;
      }
      return `${COUNTS[ads.length] || ads.length} of these are ads - the `
        + `${listWords(ads.map((a) => a.ordinal))} results. I'm skipping them.`;
    },
  },
  'ad-log': {
    sayLive: (f, s) => {
      const ads = s.roles?.ads;
      if (!ads) return null;
      if (ads.length === 0) return 'No ads in these results';
      const named = ads.slice(0, 3)
        .map((a) => `${a.name}${a.price != null ? ` ${fmtRound(a.price)}` : ''}`);
      return `Skipped ${ads.length} ad${ads.length === 1 ? '' : 's'} (${named.join(', ')})`;
    },
  },
  collision: {
    // The flagship catch: booking badges a listing "Recommended for your
    // group" whose second bed is a sofa. Bind THAT card when the live page
    // has one (closest first); fall back to the plain closest card.
    bind: (f) => {
      const traps = (f.cards || []).filter((c) => !c.isAd
        && /sofa bed/i.test(c.units || '')
        && /recommended for your group/i.test(c.units || ''))
        .sort((a, b) => miles(a) - miles(b));
      const c = traps[0] || closest(f);
      return c ? { closest: { ...c } } : {};
    },
    slots: (f, s) => ({ closestPrice: fmtRound(s.roles?.closest?.price) }),
    sayLive: (f, s) => {
      const c = s.roles?.closest;
      if (!c || c.price == null) return null;
      const price = fmtRound(c.price);
      if (/sofa bed/i.test(c.units || '')) {
        return `Booking marks the closest one '**recommended for your group**', `
          + `at **${price}**. But it counts a **pull-out couch** as the third `
          + `bed. **Emma would sleep on the couch**. What's your budget? `
          + `I'll find real beds for everyone.`;
      }
      if (oneKing(c)) {
        return `The closest one only has **one king bed** for the three of `
          + `you, at **${price}**. **Emma would have no bed**. What's your `
          + `budget? I'll find real beds for everyone.`;
      }
      return `The closest one starts at **${price}**. Before I pick anything: `
        + `what's your budget? I'll only look at real beds for all three of you.`;
    },
  },
  'collision-log': {
    slots: (f, s) => ({ closestName: s.roles?.closest?.name || null }),
    sayLive: (f, s) => {
      const c = s.roles?.closest;
      if (!c) return null;
      if (/sofa bed/i.test(c.units || '')) return `Ruled out ${c.name} - it counts a couch as a bed`;
      if (oneKing(c)) return `Ruled out ${c.name} - only 1 king bed`;
      return `Checked ${c.name} first - waiting on the budget`;
    },
  },
  freeway: {
    sayLive: (f, s) => {
      const trap = (f.cards || []).find((c) => /palo alto/i.test(c.name || '')
        && !/east palo alto/i.test(c.name || '')
        && /east palo alto/i.test(c.address || ''));
      if (trap) {
        return `${shortName(trap.name)} says Palo Alto, but it's actually `
          + 'across the freeway, in East Palo Alto.';
      }
      return '';
    },
  },
  compare: {
    // The Zen is ALWAYS the first option - everything after this beat (the
    // rooms, the checkout, the gate) is the Zen's story. Its price adapts
    // to the live card when the page shows one.
    bind: (f, s) => {
      const cards = (f.cards || []).filter((c) => !c.isAd && c.price != null);
      const zen = cards.find((c) => /zen/i.test(c.name || ''));
      const u = s.budget != null
        ? underBudget(f, s.budget).sort((a, b) => miles(a) - miles(b)) : [];
      const near = zen || u[0] || null;
      const far = u.filter((c) => c !== near)
        .sort((a, b) => miles(b) - miles(a))[0] || null;
      const out = {};
      if (near) out.near = { ...near };
      if (far) out.far = { ...far };
      return out;
    },
    sayLive: (f, s) => (s.budget != null
      ? `Two good hotels under ${s.budget}. Which one?` : null),
    optionsLive: (f, s) => {
      const { near, far } = s.roles || {};
      const line = (c, primary) => {
        const bits = [`${shortName(c.name)}, **${fmtRound(c.price)}**`];
        const m = milesOf(c);
        if (m != null) bits.push(m <= 3 ? `**${m} miles from campus**` : `a **${m} mile drive**`);
        if (c.rating != null) bits.push(`rated ${c.rating}`);
        if (/2 (full|queen|double) beds/i.test(c.units || '')) bits.push('two real beds');
        return { label: bits.join('. '), primary };
      };
      const zenStatic = { label: 'The Zen, **$638**. Close to campus, '
        + '**two real beds**, great reviews, free breakfast', primary: true };
      const first = (near && /zen/i.test(near.name || '')) ? line(near, true) : zenStatic;
      const second = far ? line(far, false)
        : { label: 'Radisson Sunnyvale, **$590**. A **25 minute drive** away' };
      return [first, second, { label: 'Raise the budget instead' }];
    },
  },
  room: {
    slots: (f) => { const r = familyRooms(f).sort((a, b) => (a.price ?? 9e9) - (b.price ?? 9e9));
      return { room1Price: fmtRound(r[0]?.price), room2Price: fmtRound(r[1]?.price) }; },
  },
  'true-price': {
    slots: (f, s) => ({ totalRounded: fmtRound(f.total),
      overBudget: s.budget != null && f.total != null ? fmtRound(f.total - s.budget) : null }),
    optionsLive: (f, s) => {
      const { near, far } = s.roles || {};
      if (!far || f.total == null || !near?.price) return null;
      const est = Math.round(far.price * (f.total / near.price));
      const ceiling = Math.ceil(f.total / 10) * 10 + 10;
      return [
        { label: `Go up to $${ceiling.toLocaleString('en-US')}`, primary: true },
        { label: `${shortName(far.name)}, about **$${est.toLocaleString('en-US')}** all-in. The cheaper one, farther away` },
        { label: `Keep looking under $${s.budget}` },
      ];
    },
  },
  cancellation: {
    slots: (f) => ({ cancelDate: f.freeCancelBefore ? spokenDate(f.freeCancelBefore) : null,
      penaltyRounded: fmtRound(f.penalty) }),
  },
  gate: {
    slots: (f) => ({ total: fmt(f.total),
      cancelDate: f.freeCancelBefore ? spokenDate(f.freeCancelBefore) : null }),
  },
};

// When a beat's turn comes: its page section has arrived, or the run is
// already PAST it (catch-up - a beat is never skipped, so a run that got
// ahead pays the story back widget by widget, each pausing the agent).
const RANK = { unknown: -1, home: 0, results: 1, property: 2, checkout: 3 };
const SECTION = { home: 0, results: 1, property: 2, checkout: 3, form: 3, review: 3 };
function ready(beat, f) {
  const pr = RANK[f?.page] ?? -1;
  if (beat.id === 'contract') return true;
  // Not on text alone: a profile that remembers the last search pre-fills
  // the box at page load, and the widget fired before anyone typed. The
  // autocomplete must actually be open (visible suggestions).
  if (beat.id === 'stanfords') {
    return (f?.page === 'home' && !!f.destQuery
      && (f.destOptions || []).length >= 2) || pr > 0;
  }
  // The gate's own `when` is "the next press commits money" - which first
  // becomes possible once the form is filled. Firing it on page arrival
  // held the agent from details-answer straight into the gate with ZERO
  // runtime between, so the form never got typed.
  if (beat.id === 'gate') return pr >= 3 && !!f?.formFilled;
  return pr >= (SECTION[beat.page] ?? 0);
}

/** Fill {tokens} from live slots, falling back to the beat's rehearsal
 *  values. Returns the filled beat plus which tokens fell back. */
function fill(beat, facts) {
  const composed = LOGIC[beat.id]?.sayLive?.(facts, S);
  const liveOptions = LOGIC[beat.id]?.optionsLive?.(facts, S) || null;
  const live = LOGIC[beat.id]?.slots?.(facts, S) || {};
  const missed = [];
  const sub = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => {
    if (live[k] != null) return live[k];
    missed.push(k);
    return beat.fallbacks?.[k] ?? `{${k}}`;
  });
  // What on the page this beat is ABOUT, for the client's spotlight.
  const SPOTS = {
    ad: () => S.roles?.ad?.name,
    'ad-log': () => S.roles?.ad?.name,
    collision: () => S.roles?.closest?.name,
    'collision-log': () => S.roles?.closest?.name,
    compare: () => 'The Zen',
    winnow: () => 'properties found',
    'true-price': () => 'Total',
    cancellation: () => 'Free cancellation',
    gate: () => 'Total',
  };
  if (composed === '') return null;
  return {
    id: beat.id, kind: beat.kind, page: beat.page,
    say: composed || sub(beat.say),
    options: liveOptions || beat.options?.map((o) => ({ ...o, label: sub(o.label) })),
    missed: [...new Set(missed)],
    spot: SPOTS[beat.id]?.() || null,
    at: Date.now(),
  };
}

async function fire(beat, facts, { forced = false } = {}) {
  const bound = LOGIC[beat.id]?.bind?.(facts, S);
  if (bound) S.roles = { ...(S.roles || {}), ...bound };
  const filled = fill(beat, facts);
  if (!filled) {                                  // nothing true to say today
    (S.skipped ||= []).push(beat.id);
    S.idx += 1;
    return;
  }
  if (forced) filled.forced = true;
  S.fired.push(filled);
  S.idx += 1;
  if (beat.kind === 'widget') {
    // Hold the real gate AND park the loop. The hold is what makes exec.js
    // refuse a commit already in flight; the pause is what stops the model
    // burning turns against a closed gate (the recorded 24-step spin).
    try {
      const h = await globalThis.Validation?.demoHold?.(HOLD_PREFIX + beat.id,
        filled.say.replace(/\*\*/g, ''));
      // No validation run means the gate was never real - only the pause
      // stands. Recorded on the beat so the state says so out loud.
      if (!h || h.held === false) filled.heldFailed = true;
    } catch { filled.heldFailed = true; }
    try { globalThis.BrowserAgent?.pause?.(); } catch { /* hold alone then */ }
  }
  await save();
}

/** Fire every beat whose turn has come on these facts; stop at a widget.
 *  A fired widget she has not answered blocks everything after it - the
 *  agent is paused, and the story does not talk over its own question. */
async function advance(facts) {
  const pending = [...S.fired].reverse().find((f) => f.kind === 'widget');
  if (pending && !S.answers[pending.id]) return 0;
  let fired = 0;
  while (S.idx < BEATS.length) {
    const b = BEATS[S.idx];
    if (b.post) break;                       // past the gate: never live
    if (!ready(b, facts)) break;             // its page has not arrived yet
    await fire(b, facts);
    fired += 1;
    if (b.kind === 'widget') break;          // wait for her answer
  }
  return fired;
}

const Director = {
  /** Pure check, no side effects: would this task arm the demo? The start
   *  route asks before deciding whether the validation session needs a
   *  clean restart. */
  wouldArm(task) {
    const t = String(task || '');
    return SCENARIO_RE.test(t) && TASK_RE.test(t);
  },

  /** Called with the task sentence when the agent starts. */
  async maybeArm(task) { return serial(async () => {
    await load();
    const t = String(task || '');
    if (!(SCENARIO_RE.test(t) && TASK_RE.test(t))) {
      // A non-matching task DISARMS: without this, the demo from a previous
      // run stayed armed into the next ordinary task - overlay rendering,
      // organic speech muted, agent-watch suppressed, all on a normal run.
      if (S.armed) { S = fresh(); await save(); await releaseDemoHolds(); }
      return { armed: false };
    }
    S = { ...fresh(), armed: true, task: t };
    await save();
    // A hard stop under the final press, independent of every demo
    // mechanism: a rulebook rule with a blocks pattern refuses the action
    // at the exec gate even with nothing else waiting (review finding: on
    // a model-free take the demo hold was the ONLY structural barrier).
    try {
      const RULE = { id: 'demo-final-press',
        text: 'Never press the final booking or payment button yourself',
        blocks: 'complete booking|confirm and pay|confirm booking|book now|finish booking',
        on: true };
      const book = (await chrome.storage.sync.get('aa.rulebook'))['aa.rulebook'] || [];
      if (!book.some((r) => r.id === RULE.id)) {
        await chrome.storage.sync.set({ 'aa.rulebook': [...book, RULE] });
      }
    } catch { /* the demo hold still gates */ }
    // A previous take's widget hold can survive into this run - the
    // validation session outlives the agent, so a wedged demo left
    // demo:stanfords in waiting and the NEW run's first navigate was
    // refused at the gate before any page had even loaded. A fresh arm
    // owes the run a clean slate.
    try {
      const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'];
      for (const w of st?.gate?.waitingOn || []) {
        if (String(w).startsWith(HOLD_PREFIX)) {
          await globalThis.Validation?.answer?.(w, 'New demo run - cleared a stale hold.');
        }
      }
    } catch { /* the onFacts sweep below also self-heals this */ }
    return { armed: true };
  }); },

  async disarm() { return serial(async () => {
    await load();
    S = fresh();
    await save();
  }); },

  /** Page facts from the content script. Fires every beat whose turn has
   *  come and whose relation holds; stops at a widget until it is answered. */
  async onFacts(facts, tabId) { return serial(async () => {
    await load();
    if (!S.armed || S.done || !facts) return { armed: S.armed };
    if (tabId != null) S.tabId = tabId;   // the tab the run lives in
    // An organic stop with no surface to answer it would park the run
    // forever - the demo's surfaces only speak the story. Release what the
    // generic layer is holding on, and file that it happened - EXCEPT where
    // money can move. On a checkout page nothing is ever waved past, and a
    // hold whose name smells of committing is never waved past anywhere:
    // the review's concrete path was the story stalling short of the gate
    // while this loop stripped every protection the agent had left.
    try {
      const st = (await chrome.storage.local.get('aa.validation'))['aa.validation'];
      for (const w of st?.gate?.waitingOn || []) {
        if (String(w).startsWith(HOLD_PREFIX)) {
          // Our own hold - legitimate only while its widget is up and
          // unanswered in THIS run. Anything else is a leftover from an
          // earlier take (worker restarts keep the session's waiting list
          // alive across runs) and would park the agent forever.
          const id = String(w).slice(HOLD_PREFIX.length);
          const current = S.fired.some((f) => f.id === id && f.kind === 'widget')
            && !S.answers[id] && !S.done;
          if (!current) {
            await globalThis.Validation?.answer?.(w, 'Cleared a stale hold from an earlier run.');
          }
          continue;
        }
        // Whole commit PHRASES, not fragments: on booking.com every other
        // string contains "book", so a fragment match left ordinary holds
        // standing and the gate then refused even a date click.
        if (facts.page === 'checkout'
            || /\b(?:place (?:your |the )?order|buy now|book (?:it|now)|complete (?:the )?booking|finish booking|reserve now|pay now|payment|checkout|confirm (?:and pay|booking|purchase))\b/i.test(String(w))) {
          if (!S.fired.some((f) => f.id === `standing:${w}`)) {
            S.fired.push({ id: `standing:${w}`, kind: 'log', at: Date.now(),
              say: `Left a hold standing (${String(w).slice(0, 40)}) - never waved past near a commit` });
          }
          continue;
        }
        await globalThis.Validation?.answer?.(w, 'Continue.');
        S.fired.push({ id: `released:${w}`, kind: 'log', at: Date.now(),
          say: `Waved past a generic hold (${String(w).slice(0, 40)}) - the story speaks for this run` });
      }
    } catch { /* never let the release path stall the story */ }
    lastFacts = facts;
    // The occupancy stepper is the one control the agent cannot drive (its
    // "+" never enumerates). When the agent's own search lands without the
    // child, fix the guest count into the URL once - a single reload right
    // after the agent's own press, not a teleport.
    if (facts.page === 'results' && S.answers.stanfords && !S.familyFixed
        && S.tabId != null && /searchresults/.test(facts.url || '')
        && !/group_children=1/.test(facts.url || '')) {
      S.familyFixed = true;
      try {
        const u = new URL(facts.url);
        u.searchParams.set('checkin', '2026-09-15');
        u.searchParams.set('checkout', '2026-09-17');
        u.searchParams.set('group_adults', '2');
        u.searchParams.set('group_children', '1');
        u.searchParams.set('age', '8');
        u.searchParams.set('no_rooms', '1');
        u.searchParams.set('nflt', 'fc=2');
        await chrome.tabs.update(S.tabId, { url: u.href });
        globalThis.BrowserAgent?.interject?.(
          'The search now includes the guests (2 adults, 1 child aged 8) and '
          + 'the dates. Continue from these results.');
        // This page is about to reload; anything spoken now dies mid-line.
        await save();
        return { armed: true, fired: 0, fixed: true };
      } catch { /* the story continues on whatever results are up */ }
    }
    // A one-line trace of what each push actually read. When a beat refuses
    // to fire on stage, this is the difference between a diagnosis and a
    // guess about what the page said.
    (S.reads ||= []).push({ at: Date.now(), page: facts.page,
      resultCount: facts.resultCount ?? null, hotelFacet: facts.hotelFacet ?? null,
      cards: facts.cards?.length ?? null, ads: facts.adCount ?? null,
      rooms: facts.rooms?.length ?? null, total: facts.total ?? null,
      cancel: facts.freeCancelBefore ?? null, form: facts.hasForm ?? null,
      err: facts.readError ?? null });
    if (S.reads.length > 60) S.reads.splice(0, S.reads.length - 60);
    // The layer reads a page before the agent acts on it. A fresh section
    // (home -> results -> property -> checkout) pauses the agent until the
    // section's beats have spoken - the recorded run had the agent clicking
    // a motel in the two seconds between its own Search press and the
    // collision widget arriving. One pause per section, released as soon as
    // the beats fire unless a widget is holding.
    const rank = RANK[facts.page] ?? -1;
    const newSection = rank > (S.lastRank ?? -1);
    if (newSection) {
      S.lastRank = rank;
      try { globalThis.BrowserAgent?.pause?.(); } catch { /* beats still fire */ }
      if (rank === 1) {
        // Once, as the results land: the map view swallows the page.
        try {
          globalThis.BrowserAgent?.interject?.(
            'These results already have the free-cancellation filter and '
            + 'price sorting applied - do not touch filters or sorting. Work '
            + 'in the results LIST only; never click the map, "Show on map", '
            + 'or any map thumbnail. Do not open any hotel until Susan has '
            + 'answered.');
        } catch { /* the client also closes the map if it opens */ }
      }
      if (rank === 3) {
        // Once, as checkout arrives: the agent cannot fill a form with an
        // identity nobody gave it. Fictional details (555 number), and the
        // run stops at the gate before anything submits.
        try {
          globalThis.BrowserAgent?.interject?.(
            'Fill the booking form with these details: first name Susan, '
            + 'last name Miller, email susan.miller.family@gmail.com, phone '
            + '+1 650 555 0135, country United States. Decline marketing '
            + 'emails, taxi, and car rental offers. Do NOT press the final '
            + 'booking or payment button.');
        } catch { /* the gate still holds the final press */ }
      }
    }
    const fired = await advance(facts);
    if (newSection) {
      const pend = [...S.fired].reverse().find((f) => f.kind === 'widget');
      if (!(pend && !S.answers[pend.id])) {
        try { globalThis.BrowserAgent?.resume?.(); } catch { /* recoverable */ }
      }
    }
    await save();
    return { armed: true, fired, idx: S.idx };
  }); },

  /** Her answer, from the overlay. Releases the hold, steers the agent. */
  async onAnswer(id, response) { return serial(async () => {
    await load();
    if (!S.armed) return { ok: false };
    if (!S.fired.some((f) => f.id === id)) return { ok: false, why: 'not fired' };
    if (S.answers[id]) return { ok: false, why: 'already answered' };
    S.answers[id] = { response, at: Date.now() };

    // Answers that carry state the later guards read.
    if (id === 'collision') {
      const m = String(response).match(/\$?\s?([\d,]{3,6})/);
      if (m) S.budget = Number(m[1].replace(/,/g, ''));
    }
    if (id === 'true-price' && /750/.test(String(response))) S.budget = 750;

    // The storyline's own agent-reply pattern ("Done. Booking the Zen
    // double.") fills the silence after each answer while the agent works -
    // the recorded runs had long dead air exactly there.
    const AFTERS = {
      stanfords: () => 'OK. Setting September 15 to 17 and searching.',
      collision: (r) => (/700/.test(r) ? 'Under 700. Looking at what fits.'
        : 'Got it. Looking at what fits.'),
      compare: (r) => (/zen/i.test(r) ? 'The Zen it is. Opening its page.' : 'Got it.'),
      room: () => 'Two full beds. Reserving that room.',
      'true-price': (r) => (/750/.test(r) ? 'Done. Booking the Zen double.' : 'Got it.'),
      details: () => "Set. They can still say no to the bag hold - it's a request.",
    };
    const afterLine = AFTERS[id]?.(String(response));
    if (afterLine) {
      S.fired.push({ id: `${id}-done`, kind: 'checkpoint', say: afterLine, at: Date.now() });
    }

    if (id === 'gate') {
      // The gate's hold is NEVER released - a click already parked at the
      // exec gate would fire the moment it opened, and the stop must land
      // before anything else moves. On "Book it" the demo ends by design:
      // nothing is paid, and the record says so. On any other answer the
      // hold and the pause both stand - the agent does not walk a checkout
      // page on a half-answered gate.
      try { globalThis.BrowserAgent?.stop?.('demo ends at the gate'); } catch { /* best-effort */ }
      if (/book it/i.test(String(response))) {
        S.done = true;
        S.fired.push({ id: 'demo-end', kind: 'log', at: Date.now(),
          say: 'Stopped at the gate - nothing was paid' });
      } else {
        S.done = true;
        S.fired.push({ id: 'gate-change', kind: 'checkpoint', at: Date.now(),
          say: 'Stopped at the gate. Nothing was booked, and nothing was paid.' });
      }
      await save();
      return { ok: true, done: S.done };
    }

    try { await globalThis.Validation?.answer?.(HOLD_PREFIX + id, response); }
    catch { /* the resume below still frees the loop */ }

    // The agent does the on-page work itself - typing, clicking, scrolling
    // is what a demo audience watches. Deterministic tab-jumps made the run
    // read as fake (David: "not much activity on the page itself"), and the
    // recorded runs show the agent follows a JUST-IN-TIME directive at the
    // answer moment even though it ignored the arm-time playbook. The one
    // thing it truly cannot drive is the occupancy stepper; onFacts fixes
    // the guest count into the results URL once, quietly.
    const NEXT = {
      stanfords: 'Do this now: click that suggestion in the autocomplete, '
        + 'then IMMEDIATELY submit the search by navigating to '
        + `${SCENARIO.searchUrl} - the dates (September 15 to 17) and the `
        + 'guests (2 adults, 1 child aged 8) are already set in it. Skip '
        + 'the calendar entirely and never open the occupancy dropdown.',
      room: 'Do this now: in the rooms table, set quantity 1 for the room '
        + 'with two full beds and press its Reserve button. Skip reviews, '
        + 'photos, and everything else on this page.',
      details: 'Do this now, in order: (1) fill the guest form - first name '
        + 'Susan, last name Miller, email susan.miller.family@gmail.com, '
        + "phone 650 555 0135, country United States, select I'm the main "
        + 'guest. (2) Set the estimated arrival time dropdown to 6:00 PM - '
        + '7:00 PM. (3) In the special requests box type: "Could you hold '
        + 'our bags in the morning before check-in? And some help finding '
        + 'our room at check-in would be appreciated." (4) Decline every '
        + 'other offer. Stop when all three are done.',
      compare: /zen/i.test(String(response))
        ? 'Do this now: in the results list, click the hotel named '
          + '"The Zen Hotel Palo Alto" to open its page. It may be far down '
          + 'the list. If two scrolls do not reveal it, navigate directly to '
          + `${SCENARIO.propertyUrl} instead.`
        : null,
    };
    try {
      const next = NEXT[id];
      globalThis.BrowserAgent?.interject?.(
        `Susan answered: "${response}". `
        + (next || 'Act on her answer and continue the task.'));
    } catch { /* the answer is already in the validation record */ }
    try { globalThis.BrowserAgent?.resume?.(); } catch { /* paused-state is recoverable from the popup */ }
    if (lastFacts) await advance(lastFacts);
    await save();
    return { ok: true };
  }); },

  /** Stage lever: play the next beat on its rehearsal fallbacks, relation or
   *  no relation. For live recovery only; the miss list marks it. */
  async force() { return serial(async () => {
    await load();
    if (!S.armed || S.idx >= BEATS.length) return { ok: false };
    // Forcing past an OPEN widget would strand its hold forever (the sweep
    // treats a fired-unanswered widget as legitimate). Answer it first.
    const pend = [...S.fired].reverse().find((f) => f.kind === 'widget');
    if (pend && !S.answers[pend.id]) return { ok: false, why: 'answer the open widget first' };
    const b = BEATS[S.idx];
    await fire(b, lastFacts || {}, { forced: true });
    await save();
    return { ok: true, id: b.id };
  }); },

  /** The run ended under the demo (stop button, agent finished). A done
   *  demo keeps its state - the end report reads from it - but an
   *  abandoned one disarms, or the overlay, the muted speech, and the
   *  page extraction would follow David around his ordinary browsing. */
  async abandon() { return serial(async () => {
    await load();
    if (S.armed && !S.done) {
      S = fresh();
      await save();
      await releaseDemoHolds();
      return { disarmed: true };
    }
    return { disarmed: false };
  }); },

  async state() { await load(); return { ...S }; },
  SCENARIO,
  _test: { LOGIC, fill: (b, f, s) => { S = s || fresh(); return fill(b, f); } },
};

globalThis.DemoDirector = Director;
export { Director };
