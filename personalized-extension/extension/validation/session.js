// The validation session, in the service worker.
//
// One run per task, owned here so it survives the side panel closing and so
// both channels — speech and the panel — read the same state rather than each
// keeping their own copy.
//
// Bundled into `dist/validation.js` and loaded by background.js alongside the
// harness, which is why it hangs itself on globalThis rather than exporting.
//
// It does three things the pieces below it cannot do alone:
//
//   * reads the live page through the harness, not through the agent's account
//     of the page. That separation is the whole argument, so it must not be
//     possible to configure it away.
//   * holds the agent at a gate. A stop that the agent can step over is
//     narration; the corpus is explicit that noticing and continuing is worse
//     than not noticing.
//   * publishes to chrome.storage so the panel and the voice engine see the
//     same findings at the same time.

import { createRun, setExtractorNames } from './run.js';
import { contractFromAsk, gaps, describe, toQuery } from './ask.js';
import { setParadigmMap, setCountZones } from '../../../tools/auditors/contract-mismatch.js';
import { setControls } from './render.js';
import * as Reasoner from './reasoner.js';

const KEY = 'aa.validation';

// Which phase a URL belongs to. The agent does not announce its phase, and
// asking it to would mean trusting its account of where it is.
function phaseOf(url) {
  const u = String(url || '');
  // A login wall is not a step of the task. It carries a `return_to` pointing
  // at wherever you were headed, so matching on the raw URL classified the
  // sign-in page as Review order and then reported that it could not read any
  // of the fifteen things a review page has. Nothing here is checkable.
  if (/\/ap\/signin|\/ap\/mfa|forgotpassword/.test(u)) return null;
  if (/\/s\?|\/s\/|field-keywords|\/b\?node/.test(u)) return 'Search';
  if (/\/dp\/|\/gp\/product/.test(u)) return 'Check item';
  if (/\/cart\/|add-to-cart|\/gp\/cart/.test(u)) return 'Add to cart';
  if (/\/checkout\/|\/gp\/buy\/.*address|shipoptionselect/.test(u)) return 'Checkout';
  if (/\/gp\/buy\/spc|\/checkout\/p\//.test(u)) return 'Review order';
  if (/thankyou|order-confirm|\/gp\/buy\/thankyou/.test(u)) return 'Confirm';
  return null;
}

// Steps that commit something. The gate is checked before these, and only
// these — stopping the agent from scrolling would be theatre.
const COMMITTING = /add[- ]?to[- ]?cart|proceed to checkout|place your order|buy now|finish the task|dialog|\bjs\b/i;

// Actions that change the world rather than look at it.
//
// The distinction is the difference between a paced run and a deadlocked one:
// scroll, wait, screenshot and read leave the page as they found it, so
// holding them buys nothing and costs the agent its eyes.
const CHANGES_SOMETHING = /click|type|press|submit|select|check|navigate|open|close|switch|go[_ ]?(back|forward)|refresh|upload|drag|add|remove|place|buy|checkout|finish the task|fill|dialog|\bjs\b/i;

let run = null;
let contract = null;
let runOpts = {};

// The task model, when one has been loaded.
//
// With no model this stays null and everything below behaves exactly as it did
// before it existed: `phaseOf` classifies the URL, the extractors read the
// page, and the hand-written Amazon checks fire. With a model loaded, the
// reasoner reads the same snapshot against the model's questions instead. The
// two paths do not mix, and the switch is the presence of a file.
let flatModel = null;
let modelSource = null;

// What the person has actually dealt with.
//
// This used to live only in the overlay, which meant the session had no idea
// what had been seen — so the agent could not wait for it even in principle.
// The corpus records this as its own gap: "eyes that work, at a speed they
// can't use". Five separate breakdowns say the same thing about the same
// persona, and the cause is that nothing connected being unread to being
// allowed to continue.
const acknowledged = new Set();
// Offers waved past with "Just this once" - not stored, because a later task
// can deserve the same offer again; within this task it stops nagging.
const declinedOffers = new Set();

/** What identifies one finding. Must match the overlay's key exactly. */
const fkey = (f) => `${f.widget}|${f.phase}|${f.say}`;

// Findings live in storage, not in a module variable.
//
// An MV3 service worker is torn down after about thirty seconds of idle and
// restarted on the next event, and everything held in module scope is lost
// with it. A worker that restarts mid-task would come back with an empty
// accumulator and the next publish would write that empty array over the real
// findings — the panel goes blank and nothing in the logs says why. Reading
// storage before appending survives the restart.
/** Union by what the finding actually says, at the phase it says it. */
function mergeFindings(prev, next) {
  const key = (f) => `${f.widget}|${f.phase}|${f.say}`;
  const have = new Set(prev.map(key));
  return prev.concat(next.filter((f) => !have.has(key(f))));
}

// `run` and `contract` live in module scope, and the comment above about the
// worker being torn down applies to them too: a restart mid-task nulls them,
// and allow() answering "no run, go ahead" would switch the whole layer off
// silently. Everything needed to rebuild is already published on every write -
// so read it back. The rebuilt run loses its in-memory waiting list, but the
// unread-findings check reads storage, so unacknowledged stops still hold.
async function rehydrate() {
  if (run) return true;
  const prev = await stored();
  if (!prev.contract) return false;
  contract = prev.contract;
  runOpts = prev.opts || {};
  run = createRun(contract, runOpts);
  for (const k of prev.acknowledged || []) acknowledged.add(k);
  return true;
}

async function stored() {
  const r = await chrome.storage.local.get(KEY);
  return r[KEY] || {};
}

// ── the Rulebook ────────────────────────────────────────────────────────────
//
// Stored in chrome.storage.sync, not local, because a standing rule is the one
// part of this that should follow the person between devices — that is what
// makes it standing rather than a setting on one machine.
//
// It starts EMPTY apart from a single default that is never asked about. The
// alternative is an eleven-question interrogation before the first search, and
// the corpus is clear that none of those questions can be answered before the
// page raises them: there is no view about sponsored results until a page is
// full of them.
const RULES_KEY = 'aa.rulebook';

// In force before anyone is asked anything. Injected with the rest of the
// analysis — the corpus marks which rules are defaults by their behaviour, and
// a protection typed in here is a protection that can drift out of the
// analysis that justifies it. Empty until loaded, and an empty rulebook is
// honest: it says nothing is standing rather than implying something is.
let DEFAULT_RULES = [];

function setDefaults(list) {
  DEFAULT_RULES = Array.isArray(list) ? list : [];
}

async function rules() {
  try {
    const r = await chrome.storage.sync.get(RULES_KEY);
    const saved = r[RULES_KEY];
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_RULES.slice();
    // Saved copies predate the blocks field; the pattern always comes from
    // the analysis, never from what a task stored.
    const byId = Object.fromEntries(DEFAULT_RULES.map((d) => [d.id, d]));
    return saved.map((x) => (byId[x.id]?.blocks && !x.blocks)
      ? { ...x, blocks: byId[x.id].blocks } : x);
  } catch {
    return DEFAULT_RULES.slice();   // sync unavailable is not a reason to lose the default
  }
}

async function saveRules(list) {
  try {
    await chrome.storage.sync.set({ [RULES_KEY]: list });
  } catch (e) {
    console.warn('rulebook did not save:', e);
  }
}

// What the run has earned the right to offer.
//
// Injected, never written here — the standing rules are the corpus's own `fix`
// lines, each anchored to the breakdown that earned it, and a rule typed into
// this file is a rule that drifts from the analysis. With none injected,
// nothing is offered, which is the honest default: a layer that invents
// standing rules is worse than one that offers none.
let PROMOTABLE = [];

/** @param {Array<{id,widget,because,ask,text}>} list from the analysis */
function setPromotable(list) {
  PROMOTABLE = Array.isArray(list) ? list : [];
}

/**
 * The first rule this run has earned and the person does not already have.
 *
 * Matched on the widget that produced the finding, not on the words of it —
 * the widget IS the anchor in the corpus, so this cannot offer a rule for a
 * moment that did not happen.
 */
function offerFrom(findings, have) {
  const ids = new Set(have.map((r) => r.id));
  const fired = new Set(findings.map((f) => f.widget));
  for (const p of PROMOTABLE) {
    if (ids.has(p.id)) continue;      // already in force — never offered twice
    if (declinedOffers.has(p.id)) continue;   // waved past this task
    if (fired.has(p.widget)) return p;
  }
  return null;
}

// ── the hold clock ──────────────────────────────────────────────────────────
//
// A hold lasts until it is answered, and until now that meant forever. If the
// person walked away, the agent kept looping against `maxSteps` and the run
// ended as "reached max steps (50)" — which names the symptom and hides the
// cause. Nothing in the record said that a question had gone unanswered.
//
// Two intervals, and neither of them releases anything. An unanswered question
// is not consent, so the clock can only ever say the finding again and then end
// the run honestly; the gate stays shut the whole time and stays shut after.
export let HOLD_REMIND_MS = 45_000;
export let HOLD_STOP_MS = 240_000;

/** What the run says when it ends because nobody answered. */
export const WAITING_ON_YOU = 'Waiting on you. Nothing was answered, so I stopped rather than carrying on.';

/** Test hook. The two intervals are wall-clock, so a test cannot wait them out. */
function setHoldTimeouts({ remindMs, stopMs } = {}) {
  if (Number.isFinite(remindMs)) HOLD_REMIND_MS = remindMs;
  if (Number.isFinite(stopMs)) HOLD_STOP_MS = stopMs;
  return { remindMs: HOLD_REMIND_MS, stopMs: HOLD_STOP_MS };
}

/**
 * What is owed to a hold that has been waiting. Pure, so what it decides can be
 * checked without a clock.
 *
 * @param {{on: string, since: number, reminded?: number, stopped?: number}} hold
 * @returns {{next: 'nothing'|'remind'|'stop', waitedMs: number}}
 */
export function holdClock(hold, now = Date.now(), o = {}) {
  const remindMs = o.remindMs ?? HOLD_REMIND_MS;
  const stopMs = o.stopMs ?? HOLD_STOP_MS;
  if (!hold || !hold.since) return { next: 'nothing', waitedMs: 0 };
  const waitedMs = Math.max(0, now - hold.since);
  if (waitedMs >= stopMs) return { next: hold.stopped ? 'nothing' : 'stop', waitedMs };
  if (waitedMs >= remindMs && !hold.reminded) return { next: 'remind', waitedMs };
  return { next: 'nothing', waitedMs };
}

/**
 * One tick of the clock, taken from the agent's own polling.
 *
 * `allow()` is called before every action, so a held agent asks this question
 * roughly once a step. That is the tick — no timer, which matters because a
 * service worker is torn down after about thirty seconds of idle and a
 * setTimeout would go with it.
 */
async function tickHold() {
  const prev = await stored();
  const h = prev.hold;
  const { next, waitedMs } = holdClock(h);
  if (next === 'nothing') return { next, waitedMs };
  const secs = Math.max(1, Math.round(waitedMs / 1000));
  if (next === 'remind') {
    // Said again, once. Not louder and not different — the same finding, in
    // case it was missed rather than ignored.
    chrome.runtime.sendMessage({
      type: 'validationSpeak', phase: 'gate',
      lines: [{ say: `Still waiting on you after ${secs} seconds. ${h.say || ''}`.trim(),
                level: 'stop', live: 'assertive', widget: 'gate' }],
    }).catch(() => {});
    await publish({ hold: { ...h, reminded: Date.now() } });
    return { next, waitedMs };
  }
  // Long enough that nobody is coming. End the run saying so — and leave the
  // gate exactly as it was, because the question is still unanswered.
  try { globalThis.BrowserAgent?.stop?.(WAITING_ON_YOU); } catch { /* no agent loaded */ }
  await publish({
    hold: { ...h, stopped: Date.now() },
    endedBecause: { reason: WAITING_ON_YOU, waitedMs, waitingOn: h.on, at: Date.now() },
  });
  return { next, waitedMs };
}

// Writes to storage are serialised through this. Two observes can overlap --
// the navigation trigger and an explicit call race on the same page -- and
// each is a read-then-write on one key. Interleaved, the second read happens
// before the first write, so one set of findings is written over the other and
// the count can collapse rather than merge.
let writing = Promise.resolve();
const serialise = (fn) => (writing = writing.then(fn, fn));

async function publish(extra = {}) {
  return serialise(() => _publish(extra));
}

async function _publish(extra = {}) {
  const prev = await stored();
  // A worker restart nulls `run` while callers can still publish. Writing
  // module defaults over the stored session then erases exactly what
  // rehydrate() needs - the acknowledged list, the plan, a held gate. When
  // the run is gone, the stored values stand in.
  const s = run ? run.summary()
    : { steps: prev.steps || [], said: prev.said || [],
        spokenWords: prev.spokenWords || 0, waiting: prev.waiting || 0 };
  // A rehydrated run has empty bookkeeping; the stored record is the truth.
  if (run && !(s.steps || []).length && (prev.steps || []).length) {
    s.steps = prev.steps; s.said = prev.said || [];
    s.spokenWords = prev.spokenWords || 0;
  }
  let gate = run ? run.gate() : (prev.gate || { allowed: true });
  // The unread-findings hold was invisible: allow() enforced it but nothing
  // published it, so no surface had anything to answer and a side-panel-only
  // user deadlocked the agent. Derived from stored state, it also survives
  // worker restarts.
  if (gate.allowed !== false) {
    const merged0 = extra.findings || mergeFindings(prev.findings || [], extra.append || []);
    const ack = new Set([...(prev.acknowledged || []), ...acknowledged]);
    const unread = merged0.filter((f) => f.level !== 'ambient' && !f.confirming)
      .filter((f) => !ack.has(fkey(f)));
    if (unread.length) {
      gate = { allowed: false, waitingOn: unread.map((f) => f.widget),
        unread: unread.length,
        say: unread.length === 1 ? `Waiting for you: ${unread[0].say}`
          : `Waiting for you. ${unread.length} things you haven't seen, `
            + `starting with: ${unread[0].say}` };
    }
  }
  const book = await rules();

  // A check that never ran because nobody said the size is not a check that
  // passed. It belongs in the plan, marked skipped, next to what did happen —
  // an unflagged absence is the failure the whole layer exists to surface, and
  // the plan is the last place that should reproduce it.
  const blanks = contract ? gaps(contract) : [];
  // Stored steps already carry their blanks; re-adding them would double
  // every skipped line after a restart.
  const steps = run ? (s.steps || []).concat(blanks.map((g) => ({
    state: 'skipped',
    what: `didn't check ${g.unchecked[0]}`,
    detail: `you haven't told me: ${g.field}`,
  }))) : (s.steps || []);
  // Keep whatever was already recorded unless this call replaces it.
  // Appending must not re-add what is already recorded. A page can be read
  // more than once -- the navigation trigger and an explicit call both fire
  // on the same page -- and without this the panel shows every finding
  // twice, which reads as two separate problems.
  const merged = extra.findings || mergeFindings(prev.findings || [], extra.append || []);

  // When this hold started, and on what. Kept across publishes so the clock
  // measures the wait rather than the time since the last unrelated write, and
  // restarted when the thing being waited on changes — answering one question
  // and being asked another is not four minutes of silence.
  const effGate = extra.gate !== undefined ? extra.gate : gate;
  const heldOn = effGate && effGate.allowed === false
    ? String((effGate.waitingOn || [])[0] || effGate.rule || 'the gate')
    : null;
  let hold = prev.hold || null;
  if (!heldOn) hold = null;
  else if (!hold || hold.on !== heldOn) {
    hold = { on: heldOn, since: Date.now(), say: effGate.say || null,
             reminded: null, stopped: null };
  } else {
    hold = { ...hold, say: effGate.say || hold.say };
  }

  await chrome.storage.local.set({
    [KEY]: {
      findings: merged,
      hold,
      // A probe result stays up until something replaces or clears it - it
      // must survive the unrelated publishes that happen constantly.
      probe: extra.probe !== undefined ? extra.probe : prev.probe || null,
      ruleCatches: extra.ruleCatches !== undefined ? extra.ruleCatches
        : prev.ruleCatches || [],
      unspecified: extra.unspecified !== undefined ? extra.unspecified
        : prev.unspecified || [],
      phase: extra.phase !== undefined ? extra.phase : prev.phase ?? null,
      invalidated: extra.invalidated !== undefined ? extra.invalidated
        : prev.invalidated || [],
      contract: contract || prev.contract || null,
      // Union, never replacement: a publish arriving before rehydrate has
      // run must not shrink the stored list back to whatever this worker
      // instance happens to have seen.
      acknowledged: [...new Set([...(prev.acknowledged || []), ...acknowledged])],
      opts: run ? runOpts : (prev.opts || runOpts),
      ...s, steps, gate, rules: book,
      // Offered against everything on record: computing it against only this
      // call's appends meant any quiet page withdrew a standing offer.
      offer: run ? offerFrom(merged, book) : (prev.offer || null),
      updated: Date.now(),
      ...(({ append, ...rest }) => rest)(extra),
    },
  });
}

// ── the task-model path ─────────────────────────────────────────────────────
//
// One structured model call per page settle, against the whole question list.
// Everything after the call is the same machinery the extractor path uses: the
// same run, the same insistence levels, the same gate, the same two surfaces.
// Only where the findings came from is different.
async function observeByModel(snap, opts = {}) {
  const result = await Reasoner.readPage(flatModel, snap.text, {
    ask: contract ? describe(contract) : null,
    ...(opts.reasoner || {}),
  });

  if (!result.ok) {
    // A call that failed must not read as a page that checked out clean —
    // that is the exact failure the layer exists to prevent. Same wording the
    // extractor path uses when a check throws.
    await publish({
      append: [{ widget: 'Checking failed', level: 'aside',
        say: `I could not finish checking this page. ${String(result.meta.error || '').slice(0, 80)}`,
        from: snap.url || 'this page', confirming: false, phase: null }],
      phase: null, reasoner: result.meta });
    return { phase: null, findings: 0, error: result.meta.error };
  }

  const phase = opts.phase || Reasoner.phaseFor(result, flatModel);
  const findings = Reasoner.toFindings(result, phase);

  if (!findings.length) {
    // Nothing this page could answer and nothing worth raising. Recorded
    // rather than silent: what the reasoner asked and what it discarded is
    // still the record of a page having been read.
    await publish({ phase: phase || null, reasoner: result.meta });
    return { phase, findings: 0, url: snap.url, reasoner: result.meta };
  }

  // Answered counts as read; an answer thrown away for an unverifiable quote
  // counts as something on this page the layer could not read. That is what
  // the plan's "couldn't read" line is for, and it is the honest number —
  // a question this page simply does not answer is not a failure to read.
  const read = result.meta.answered + result.meta.noticedKept;
  const of = read + result.meta.discarded + result.meta.noticedDiscarded;

  let rendered;
  try {
    ({ findings: rendered } = run.observeFindings(findings, phase, { read, of }));
  } catch (e) {
    await publish({ append: [{ widget: 'Checking failed', level: 'aside',
      say: `I could not finish checking this page. ${String(e.message || e).slice(0, 80)}`,
      from: snap.url || 'this page', confirming: false, phase }], phase,
      reasoner: result.meta });
    return { phase, findings: 0, error: String(e.message || e) };
  }

  const speak = rendered
    .filter((f) => f.spoken?.speak)
    .map((f) => ({ say: f.spoken.speak, level: f.level, live: f.spoken.live,
                   widget: f.finding.widget }));

  const marks = rendered
    .filter((f) => f.visual && f.level !== 'ambient')
    .map((f) => ({ ...f.visual, level: f.level, widget: f.finding.widget }));

  await publish({ append: rendered.map((f) => ({
    widget: f.finding.widget, level: f.level, say: f.finding.say,
    from: f.finding.from, confirming: !!f.finding.confirming,
    paradigm: f.finding.paradigm || null, shape: f.finding.shape || null,
    checkedAgainst: f.finding.checkedAgainst || null,
    control: f.visual?.control || null, phase,
    // What the reasoner knows and the extractors do not: which node of the
    // task model this belongs to, and how the quote was verified. Carried so
    // the trace can be keyed to nodes rather than step indices.
    node: f.finding.node || null, cluster: f.finding.cluster || null,
    moment: f.finding.moment || null, verified: f.finding.verified || null,
    source: f.finding.source || 'reasoner',
  })), phase, reasoner: result.meta });

  if (speak.length) {
    chrome.runtime.sendMessage({ type: 'validationSpeak', lines: speak, phase })
      .catch(() => {});
  }
  return { phase, findings: rendered.length, speak, marks, url: snap.url,
           reasoner: result.meta };
}

const Validation = {
  /**
   * Begin a task. `c` is what the person asked for — either a contract object
   * or the sentence they said, which is parsed into one.
   *
   * Accepting a raw string matters: the caller with the person's words is the
   * agent's start route, and requiring it to build a contract first would put
   * the parsing decision somewhere that does not know what the checks need.
   */
  async start(c, opts = {}) {
    contract = typeof c === 'string' ? contractFromAsk(c) : c;
    // The person's AbilityModel decides how hard a finding presses, through
    // insistenceShift() in policy.js. That hook has always existed and has
    // never been fed: run.js called decide() without a model, so a profile
    // changed how a finding was worded and never whether it interrupted you.
    // The Librarian owns the model and roams it across devices, so it is read
    // here rather than kept as a second setting private to this layer.
    // A stop caused by a contradiction cannot be softened by it - see the
    // comment on the lock in policy.js.
    try {
      const m = await globalThis.Librarian?.getAbilityModel?.();
      if (m) opts = { ...opts, model: m };
    } catch { /* no Librarian, or it has nothing yet: insistence stays neutral */ }
    runOpts = opts;
    run = createRun(contract, opts);
    acknowledged.clear();
    declinedOffers.clear();
    // Checking is not a setting to remember to switch on. A layer that has to
    // be enabled separately is off exactly when it matters, because nobody
    // predicts the run that will go wrong. Starting a task turns on the
    // surface that reports on it.
    try { await chrome.storage.sync.set({ agentWatch: true }); } catch { /* not fatal */ }
    await publish({ findings: [], probe: null, unspecified: gaps(contract) });
    return { started: true, contract, unspecified: gaps(contract) };
  },

  /**
   * What the person did not say, and what stays unchecked because of it.
   * The panel turns these into questions; nothing is guessed to fill them.
   */
  unspecified: () => (contract ? gaps(contract) : []),

  async stop() {
    run = null;
    // The contract goes too. Leaving it set kept the surface showing a task
    // that had ended — findings gone, the ask still on screen — so there was
    // no way back to starting a new one without reloading. Ending a task has
    // to actually end it.
    contract = null;
    acknowledged.clear();
    await publish({ findings: [], contract: null, probe: null, steps: [], gate: { allowed: true } });
  },

  isRunning: () => !!run,

  /**
   * Like isRunning, but willing to rebuild after a worker restart. The
   * steering path must use THIS one: the sync check reads the module
   * variable, which a restart nulls while the stored session lives on.
   */
  async ensureRunning() {
    return !!run || rehydrate();
  },

  /**
   * Read the page the agent is on and check it.
   *
   * The snapshot comes from the harness's own accessibility read, which is the
   * same tree a screen reader walks — so nothing can be reported that the
   * person could not have reached themselves.
   */
  async observe(tabId, opts = {}) {
    if (!run && !(await rehydrate())) return { skipped: 'no validation run in progress' };
    const H = globalThis.BrowserHarness;
    if (!H?.axSnapshot) return { error: 'harness has no accessibility read' };

    const snap = await H.axSnapshot(tabId);

    // A task model is loaded: the reasoner reads this snapshot against its
    // questions. No URL regex, no extractors — the page decides what it can
    // answer. With no model loaded this is skipped entirely and the Amazon
    // path below runs unchanged.
    if (flatModel) return observeByModel(snap, opts);

    const phase = opts.phase || phaseOf(snap.url);
    if (!phase) {
      // Record that this page has nothing to check, rather than leaving the
      // last page's phase in place. Otherwise the surface keeps presenting a
      // sign-in wall as though it were the review page it was headed for.
      await publish({ phase: null });
      return { skipped: `nothing to check on ${snap.url || 'this page'}` };
    }

    // Named `rendered`, not `findings`: destructuring into `findings` would
    // shadow the module-level accumulator this function is meant to append to.
    let rendered;
    try {
      ({ findings: rendered } = run.observe(snap.text, phase));
    } catch (e) {
      // A crash inside a check must not read as checked-and-fine - that is
      // the exact failure the layer exists to prevent.
      await publish({ append: [{ widget: 'Checking failed', level: 'aside',
        say: `I could not finish checking this page. ${String(e.message || e).slice(0, 80)}`,
        from: snap.url || 'this page', confirming: false, phase }], phase });
      return { phase, findings: 0, error: String(e.message || e) };
    }

    // Only what is meant to be heard. Ambient findings stay reachable on
    // request rather than being announced.
    const speak = rendered
      .filter((f) => f.spoken?.speak)
      .map((f) => ({ say: f.spoken.speak, level: f.level, live: f.spoken.live,
                     widget: f.finding.widget }));

    const marks = rendered
      .filter((f) => f.visual && f.level !== 'ambient')
      .map((f) => ({ ...f.visual, level: f.level, widget: f.finding.widget }));

    // Accumulate across pages. A finding from Search is still true at Review
    // order, and dropping it would make the panel a view of the current page
    // rather than of the task.
    // Appending has to happen inside the serialised write, for the same reason
    // -- reading the previous list outside it reintroduces the race.
    // paradigm + shape travel with the finding. They are what let the overlay
    // draw a gauge rather than another grey card, and dropping them here would
    // silently flatten every finding back into a sentence.
    await publish({ append: rendered.map((f) => ({
      widget: f.finding.widget, level: f.level, say: f.finding.say,
      from: f.finding.from, confirming: !!f.finding.confirming,
      paradigm: f.finding.paradigm || null, shape: f.finding.shape || null,
      checkedAgainst: f.finding.checkedAgainst || null,
      control: f.visual?.control || null, phase,
    })), phase });

    // The voice engine listens for this; the panel reads storage.
    if (speak.length) {
      chrome.runtime.sendMessage({ type: 'validationSpeak', lines: speak, phase })
        .catch(() => {});   // nothing listening is fine — storage still has it
    }
    return { phase, findings: rendered.length, speak, marks, url: snap.url };
  },

  /**
   * May the agent take this step? Called by the harness agent before acting.
   * A held gate is not advice — the action does not happen.
   */
  async allow(actionDescription, ctx = {}) {
    if (!run && !(await rehydrate())) return { allowed: true };

    // The clock ticks here, before the early return below, because a held
    // agent still scrolls and a hold nobody answers has to end the run whether
    // or not the action in hand was one the gate would have stopped.
    await tickHold();

    // Anything the person has not dealt with holds the agent — but only from
    // CHANGING anything, never from looking.
    //
    // Holding every action deadlocked it. Scrolling and waiting are how the
    // agent perceives the page, so blocking those stopped it producing the
    // very findings the person was being asked to read: it scrolled, was
    // blocked, retried, was blocked, for the rest of the run. The observed log
    // is a column of "scroll — action blocked" with nothing else happening.
    //
    // Perceiving is free. Acting waits. That keeps the pace with the person —
    // nothing changes under them while they have unread work — without
    // stopping the agent from being able to see.
    //
    // Ambient findings never hold either: they are the ones deliberately not
    // announced, so waiting on them would be waiting for someone to
    // acknowledge something we chose not to say.
    if (!CHANGES_SOMETHING.test(String(actionDescription || ''))) {
      return { allowed: true };
    }

    const prev = await stored();
    const unread = (prev.findings || [])
      .filter((f) => f.level !== 'ambient' && !f.confirming)
      .filter((f) => !acknowledged.has(fkey(f)));

    if (unread.length) {
      const first = unread[0];
      return {
        allowed: false,
        waitingOn: unread.map((f) => f.widget),
        unread: unread.length,
        say: unread.length === 1
          ? `Waiting for you: ${first.say}`
          : `Waiting for you. ${unread.length} things I found that you haven't seen yet, `
            + `starting with: ${first.say}`,
      };
    }

    // The rulebook is not a display. An active rule with a pattern is a
    // hard stop, whatever else is or is not waiting - and each catch is
    // recorded, so "what it has caught" stops being fiction.
    const book = await rules();
    for (const r of book) {
      if (r.on === false || !r.blocks) continue;
      let hit = false;
      try { hit = new RegExp(r.blocks, 'i').test(String(actionDescription || '')); }
      catch { /* a bad pattern must never break the gate open */ }
      if (hit) {
        const prev2 = await stored();
        await publish({ ruleCatches: (prev2.ruleCatches || []).concat({
          rule: r.id, action: String(actionDescription || '').slice(0, 120),
          at: Date.now() }) });
        return { allowed: false, rule: r.id,
          say: `A standing rule stops this: ${r.text}.` };
      }
    }

    if (!COMMITTING.test(String(actionDescription || ''))) return { allowed: true };
    const g = run.gate();
    if (!g.allowed) {
      chrome.runtime.sendMessage({
        type: 'validationSpeak', phase: 'gate',
        lines: [{ say: g.say, level: 'stop', live: 'assertive', widget: 'gate' }],
      }).catch(() => {});
      await publish();
    }
    return g;
  },

  /** Resolve a stop so the agent can continue. */
  async answer(widget, response) {
    if (!run && !(await rehydrate())) return { resolved: false };
    const r = run.answer(widget, response);
    // Answering a widget's question deals with that widget's findings too.
    // Without this the same widget kept holding the agent through the
    // unread-findings check after its question was already answered - the
    // overlay's Got-it happened to paper over it, the side panel had no way
    // out at all.
    const prev = await stored();
    for (const f of prev.findings || []) {
      if (f.widget === widget) acknowledged.add(fkey(f));
    }
    await publish();
    return r;
  },

  /**
   * Accept or decline an offered rule.
   *
   * Accepting writes it to the profile, where it roams and is never offered
   * again. Declining is not stored as a "no" — the same moment can come up in
   * a later task and deserve asking again, because a person who said "just
   * this once" has not said "never".
   */
  async promote(offer, always) {
    if (!offer) return { saved: false };
    if (!run) await rehydrate();
    if (!always) {
      declinedOffers.add(offer.id);
      await publish();
      return { saved: false, why: 'just this once' };
    }
    const book = await rules();
    if (book.some((r) => r.id === offer.id)) return { saved: false, why: 'already in force' };
    book.push({ id: offer.id, text: offer.text, on: true });
    await saveRules(book);
    await publish();
    return { saved: true, rules: book.length };
  },

  /** Switch a standing rule off or back on. */
  async toggleRule(id) {
    if (!run) await rehydrate();
    const book = await rules();
    const r = book.find((x) => x.id === id);
    if (!r) return { changed: false };
    // The Buy Now default can be switched off, but only deliberately and only
    // here — nothing in a task may do it, or the protection is worth nothing.
    r.on = r.on === false;
    await saveRules(book);
    await publish();
    return { changed: true, on: r.on };
  },

  /**
   * Change one field of the ask, mid-run.
   *
   * Editing is not free, and saying so is the point. Anything already checked
   * against the old value stops being checked — without that, a run
   * manufactures the breakdown the corpus records at Search, where after a
   * re-sort every position you were told is wrong while the old verifications
   * still read as passed.
   *
   * The invalidated findings are dropped rather than re-labelled: a finding
   * about "size 5" is not a finding about "size 6", and keeping it greyed out
   * would leave a claim on screen that is no longer being made.
   */
  async editAsk(field, value) {
    if (!contract || !field) return { changed: false };
    const key = { buying: 'item', 'must have': 'mustHaves', size: 'size',
                  budget: 'budget', 'how many': 'quantity',
                  'needed by': 'deadline' }[field] || field;
    const before = contract[key];
    if (String(before) === String(value)) return { changed: false };

    contract = { ...contract,
      [key]: key === 'mustHaves' ? String(value).split(/,\s*/).filter(Boolean)
           : key === 'quantity' ? (parseInt(value, 10) || 1)
           : value };

    // Everything checked against the old answer is no longer checked.
    const prev = await stored();
    const stale = (prev.findings || []).filter((f) => f.checkedAgainst === key);
    const kept = (prev.findings || []).filter((f) => f.checkedAgainst !== key);

    run = createRun(contract, runOpts);
    await publish({
      findings: kept,
      unspecified: gaps(contract),
      invalidated: stale.map((f) => f.say),
    });
    return { changed: true, field: key, was: before, now: value,
             invalidated: stale.length };
  },

  /**
   * The person has dealt with a finding — acted on it or waved it past.
   *
   * Both count. Waving something past is a real answer: it is how someone says
   * "understood, carry on" without the layer treating silence as agreement,
   * and without it the agent would wait forever on anything with no control.
   */
  async acknowledge(key) {
    if (!key) return { unread: 0 };
    if (!run) await rehydrate();
    acknowledged.add(key);
    await publish();
    const prev = await stored();
    const left = (prev.findings || [])
      .filter((f) => f.level !== 'ambient' && !f.confirming)
      .filter((f) => !acknowledged.has(fkey(f))).length;
    return { unread: left };
  },

  /** Write extra fields into the published state (the probe card, mainly). */
  async annotate(extra) {
    if (!run) await rehydrate();
    await publish(extra || {});
    return { ok: true };
  },

  /** Findings that were never announced, for when someone asks. */
  onRequest: () => (run ? run.onRequest() : []),

  /** Extractors that could not read something. Never spoken. */
  gaps: () => (run ? run.gaps() : []),

  summary: () => (run ? run.summary() : null),
  phaseOf,

  // The hold clock. Exposed so a surface can show how long it has been waiting,
  // and so a test can shorten the two intervals rather than sleeping them out.
  holdClock,
  setHoldTimeouts,
  tickHold,
};

globalThis.Validation = Validation;

// Exposed separately so the agent's start route can parse a sentence into a
// contract before a run exists.
globalThis.ValidationAsk = { contractFromAsk, gaps, describe, toQuery };

// The analysis, injected by the host that has it. The toolkit ships the
// mechanism; the corpus stays in the research repository.
// The task model, injected by the host that has one, exactly like the corpus
// above and for the same reason: the extension ships the mechanism, and the
// model is research content that lives in the research repository.
//
// Loading one switches `observe()` from the Amazon extractors to the reasoner.
// Loading nothing leaves the shipped demo exactly as it was, which is why this
// is a separate entry point rather than a field on the corpus.
globalThis.ValidationTaskModel = {
  load(model, source = null) {
    if (!model) { flatModel = null; modelSource = null; return { loaded: false }; }
    flatModel = Reasoner.flattenModel(model);
    modelSource = source;
    return {
      loaded: true, source,
      task: flatModel.task.slice(0, 80),
      nodes: flatModel.nodeIds.length,
      questions: flatModel.questions.length,
      phases: flatModel.phases.length,
    };
  },
  /** Back to the extractor path. Loading is reversible at runtime. */
  unload() { flatModel = null; modelSource = null; return { loaded: false }; },
  loaded: () => !!flatModel,
  describe: () => (flatModel
    ? { source: modelSource, task: flatModel.task,
        nodes: flatModel.nodeIds.length, questions: flatModel.questions.length }
    : null),
};

// The reasoner's model caller, injected by the host — same shape as
// BrowserAgent.setGeminiCaller, so there is one provider and one key store.
globalThis.ValidationReasoner = Reasoner;

globalThis.ValidationCorpus = {
  load(corpus) {
    setPromotable(corpus?.promotable || []);
    setDefaults(corpus?.defaults || []);
    setParadigmMap(corpus?.widgets || {});
    setCountZones(corpus?.countZones);
    setControls(corpus?.widgets || {});
    setExtractorNames(corpus?.extractorNames || {});
    const handed = Object.values(corpus?.widgets || {}).filter((w) => w.control).length;
    return { promotable: PROMOTABLE.length,
             defaults: DEFAULT_RULES.length,
             controls: handed,
             widgets: Object.keys(corpus?.widgets || {}).length,
             zones: (corpus?.countZones || []).length };
  },
};

export default Validation;
