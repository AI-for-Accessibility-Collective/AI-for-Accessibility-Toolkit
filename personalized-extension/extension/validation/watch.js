// Values the person asked to be watched.
//
// `watch` is the tenth interface type and the only one whose move is spread
// over time. The other nine ask a question about the page in front of you now.
// This one delegates ATTENTION: a value the decision depends on moves — a
// price, a seat count, an availability — and the person is either not ready to
// commit or has committed and can still re-contest it.
//
// The card's own example is Google Flights price tracking (exemplar/type-cards
// .md, `watch`): the expert judges the fares too expensive, declines to book,
// toggles the tracker, and keeps it on AFTER booking, because a drop inside a
// cancellable fare class means cancel and rebook. It is 7 of the 242 gold
// questions and appears in four of the six flights videos.
//
// Until now `watch-value` had no entry in the background action map, so
// pressing "Watch it for me" fell through to the label and reached the agent as
// "Watch it for me. Then tell me what changed." That is one re-read of the page
// you are already on, which is the one thing a watch is not.
//
// ── two decisions, written down because they are genuine ────────────────────
//
// **A watch outlives the run.** The flights case is explicit that it has to:
// the move that matters most is keeping the watch on after booking, and a
// registry that died with the run could not express it at all. So watches live
// in their own storage key, `Validation.stop()` does not touch them, and the
// navigation trigger fires for a live watch even when no task is running.
//
// What that costs is a standing commitment nobody re-consents to, so it is
// bounded rather than open: at most MAX_WATCHES live at once, each expiring
// after WATCH_HORIZON_MS, and both limits are reported rather than silent.
//
// **A watch costs nothing when nobody is looking.** There is no timer, no
// alarm, no background tab and no crawler here. A watch re-reads only when a
// page settles in the person's own browser, on the origin the value was read
// off, at most once per MIN_REREAD_MS, and only when the page text has changed
// since that watch last read it. So: nobody browsing costs zero; browsing
// somewhere else costs zero; coming back to the site costs at most one model
// call. A watch that fired model calls on a clock would be a bug, and one that
// fired them forever would be a bug nobody could see.
//
// The honest limit that follows, and the person is told it when they set one:
// this watches the pages they actually open. It cannot tell them about a drop
// on a page they never navigate to. The thing that can is the site's own
// tracker — "You'll get emails when prices change" — and pressing that is an
// action on the world that hands the site an email address. "Watch it for me /
// Decide now" does not consent to that, so this registry does not do it.

/** Where the watches live. Its own key, because they outlive the session. */
export const WATCH_KEY = 'aa.validation.watches';

/** Live at once. A cap that refuses is more honest than one that evicts. */
export const MAX_WATCHES = 8;

/** How long a watch stands before it expires and says so. */
export let WATCH_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

/** The floor between two reads of the same watch. */
export let MIN_REREAD_MS = 60_000;

/** How many moves one watch keeps. */
export const MOVES_KEPT = 20;

/** Test hook. Both intervals are wall-clock, so a test cannot wait them out. */
export function setWatchTiming({ minRereadMs, horizonMs } = {}) {
  if (Number.isFinite(minRereadMs)) MIN_REREAD_MS = minRereadMs;
  if (Number.isFinite(horizonMs)) WATCH_HORIZON_MS = horizonMs;
  return { minRereadMs: MIN_REREAD_MS, horizonMs: WATCH_HORIZON_MS };
}

// ── reading a value out of an answer ────────────────────────────────────────
//
// The card names the things a watch is for: a price, a seat count, an
// availability. Two of those three are numbers and one is not, so the
// comparison has to handle both and must never pretend a number is there.

// A currency-marked amount first, because "$1,234.56 round trip, 2 stops" has
// three numbers in it and only one of them is the fare.
const MONEY = /[$£€¥₩₹]\s?-?(?:\d{1,3}(?:[,  ]\d{3})+|\d+)(?:\.\d+)?|-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:usd|eur|gbp|jpy|dollars|euros|pounds)\b/i;
const PLAIN = /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;

/**
 * The number in a reading, or null when there isn't one.
 *
 * Null is a real answer here and not a failure: "Sold out" and "No seats left"
 * have no number, and the text comparison below is what covers them.
 */
export function valueIn(text) {
  const s = String(text ?? '');
  if (!s) return null;
  const m = MONEY.exec(s) || PLAIN.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Case, punctuation and spacing are not movement. */
export const normalise = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Has the watched value moved?
 *
 * Both readings come from the same call — `askPage` with the same frozen
 * question — so a difference between them is a difference on the page rather
 * than the model phrasing the same fact two ways. That is the whole reason the
 * question is frozen at set time.
 *
 * @param {{answer: string|null, quote: string|null}|null} before
 * @param {{answer: string|null, quote: string|null}|null} after
 */
export function compare(before, after) {
  if (!after || after.answer == null) {
    return { moved: false, why: 'this page does not say' };
  }
  if (!before || before.answer == null) {
    return { moved: false, why: 'nothing to compare against yet' };
  }
  const a = valueIn(before.answer) ?? valueIn(before.quote);
  const b = valueIn(after.answer) ?? valueIn(after.quote);
  if (a != null && b != null) {
    if (a === b) return { moved: false, why: 'the same number' };
    return {
      moved: true, on: 'the number',
      was: before.answer, now: after.answer,
      wasValue: a, nowValue: b,
      direction: b > a ? 'up' : 'down',
      delta: Math.round((b - a) * 100) / 100,
    };
  }
  // One of them has no number in it at all — "$487" becoming "Sold out" is a
  // move, and so is any change in what the page says when neither is a number.
  if (normalise(before.answer) === normalise(after.answer)) {
    return { moved: false, why: 'the same words' };
  }
  return { moved: true, on: 'what it says', was: before.answer, now: after.answer };
}

// ── the question a watch asks every page ────────────────────────────────────

/**
 * The one question this watch puts to each page it can read.
 *
 * Built once, at set time, and stored on the record. Two reasons it is frozen
 * rather than rebuilt:
 *
 *   * the baseline and every later reading have to come from the SAME question,
 *     or a difference in wording shows up as a difference in the value;
 *   * the task model's own question is often not one a page can answer —
 *     "Watch it instead of booking?" is a question about what to do, not about
 *     what the page says. The page's own words are the anchor instead, which is
 *     the quote the finding already rests on.
 *
 * `askPage` supplies the rest of the contract: an answer must carry a verbatim
 * quote from the page in front of it or it is thrown away, and a page that does
 * not say answers null. So a watch on a page that does not show the value reads
 * nothing and claims nothing.
 */
export function questionFor({ quote, widget, label } = {}) {
  const what = [label, widget].filter(Boolean).join(' — ');
  if (quote) {
    return `I am watching one value for the person. When they set the watch, the `
      + `page said this, exactly: "${quote}". What does THIS page say that same `
      + `value is now? Answer with the value itself and nothing else.`;
  }
  return `I am watching one value for the person: ${what || 'the value in question'}. `
    + `What does THIS page say it is now? Answer with the value itself and nothing else.`;
}

// ── identity and scope ──────────────────────────────────────────────────────

export function originOf(url) {
  try { return new URL(String(url)).origin; } catch { return null; }
}

/**
 * Cheap identity for a page read, so an unchanged page costs no model call.
 * Shared with the hand-over watcher in session.js, which asks the same question
 * of the same snapshots.
 */
export function hashText(s) {
  let h = 5381;
  const t = String(s || '');
  for (let i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return `${t.length}:${h}`;
}

/** Whether this watch should look at this page at all. */
export function shouldRead(w, { url, hash, now = Date.now() } = {}) {
  if (!w) return { read: false, why: 'no watch' };
  if (w.until && now > w.until) return { read: false, why: 'expired' };
  // Origin scope is the big one. A fare watched on one site is not answered by
  // another site's page, and reading every watch against every page the person
  // opens is how a standing watch turns into a standing bill.
  if (w.origin && originOf(url) !== w.origin) {
    return { read: false, why: 'a different site' };
  }
  if (w.lastReadAt && now - w.lastReadAt < MIN_REREAD_MS) {
    return { read: false, why: 'read too recently' };
  }
  if (w.seenHash && hash && w.seenHash === hash) {
    return { read: false, why: 'this page has not changed since I last read it' };
  }
  return { read: true };
}

// ── storage ─────────────────────────────────────────────────────────────────
//
// Serialised for the same reason publish() and the trace are: a read-then-write
// on one key, with two writers — a page settle and a press — that overlap.

let writing = Promise.resolve();
const serialise = (fn) => (writing = writing.then(fn, fn));

async function load() {
  try {
    const r = await chrome.storage.local.get(WATCH_KEY);
    const t = r[WATCH_KEY];
    return Array.isArray(t?.watches) ? t : { watches: [], seq: 0 };
  } catch {
    return { watches: [], seq: 0 };
  }
}

export async function all() {
  return (await load()).watches;
}

/** Everything still standing. Expiry is applied on read, never on a timer. */
export async function live(now = Date.now()) {
  return (await all()).filter((w) => !w.until || now <= w.until);
}

/** Anything at all to check, answered from one storage read. */
export async function any(now = Date.now()) {
  return (await live(now)).length > 0;
}

/**
 * Start watching. A second watch on the same node and question replaces the
 * first rather than stacking — pressing the button twice is one intention.
 */
export async function add(w) {
  return serialise(async () => {
    const t = await load();
    const now = Date.now();
    const standing = t.watches.filter((x) => !x.until || now <= x.until);
    const same = standing.find((x) => x.node === w.node && x.widget === w.widget);
    if (!same && standing.length >= MAX_WATCHES) {
      return { added: false, why: `already watching ${standing.length} things, `
        + `which is as many as I will keep track of at once` };
    }
    const seq = (t.seq || 0) + 1;
    const rec = {
      id: same?.id || `w${seq}`,
      node: w.node ?? null,
      label: w.label ?? null,
      widget: w.widget ?? null,
      cluster: w.cluster ?? 'watch',
      question: w.question,
      origin: w.origin ?? null,
      url: w.url ?? null,
      // What it said when the watch was set, and what it said last. Both are
      // kept: the person wants to know it moved since last time AND how far it
      // has come since they asked.
      baseline: w.baseline ?? null,
      last: w.baseline ?? null,
      moves: [],
      // Taking the baseline IS a read, of this page, at this moment. Recording
      // it as one is what stops the very next settle on the same page paying
      // for a second call to be told nothing has changed.
      reads: w.baseline ? 1 : 0,
      lastReadAt: w.baseline ? now : null,
      seenHash: w.seenHash ?? null,
      set: now,
      until: now + WATCH_HORIZON_MS,
      // Set during a run, and deliberately not ended by that run ending.
      setDuringTask: w.task ?? null,
    };
    const watches = standing.filter((x) => x.id !== rec.id).concat(rec);
    await chrome.storage.local.set({ [WATCH_KEY]: { watches, seq } });
    return { added: true, watch: rec, replaced: !!same };
  });
}

export async function update(id, patch) {
  return serialise(async () => {
    const t = await load();
    let hit = null;
    const watches = t.watches.map((w) => {
      if (w.id !== id) return w;
      hit = { ...w, ...patch };
      return hit;
    });
    if (!hit) return null;
    await chrome.storage.local.set({ [WATCH_KEY]: { watches, seq: t.seq || 0 } });
    return hit;
  });
}

/** Record a move on the watch, and take the new reading as the one to beat. */
export async function noteMove(id, move, reading) {
  const w = (await all()).find((x) => x.id === id);
  if (!w) return null;
  return update(id, {
    last: reading,
    moves: (w.moves || []).concat(move).slice(-MOVES_KEPT),
  });
}

export async function remove(id) {
  return serialise(async () => {
    const t = await load();
    const watches = t.watches.filter((w) => w.id !== id);
    const gone = watches.length !== t.watches.length;
    await chrome.storage.local.set({ [WATCH_KEY]: { watches, seq: t.seq || 0 } });
    return { stopped: gone };
  });
}

/** Everything, gone. Nothing in a task calls this — only an explicit clear. */
export async function clear() {
  return serialise(async () => {
    await chrome.storage.local.set({ [WATCH_KEY]: { watches: [], seq: 0 } });
    return { cleared: true };
  });
}

// ── what the person hears when it moves ─────────────────────────────────────

/** One plain sentence. The number first, because a listener may stop early. */
export function sayMove(w, move) {
  const what = w.label || w.widget || 'the value you asked me to watch';
  const head = move.on === 'the number'
    ? `${what} has gone ${move.direction}: it was ${move.was}, it is now ${move.now}.`
    : `${what} has changed: it said ${move.was}, it now says ${move.now}.`;
  const sinceSet = w.baseline && w.baseline.answer !== move.was
    ? ` When you asked me to watch it, it was ${w.baseline.answer}.`
    : '';
  return `${head}${sinceSet}`;
}
