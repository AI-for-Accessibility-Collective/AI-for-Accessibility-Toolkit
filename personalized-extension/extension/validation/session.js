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
import * as Trace from './trace.js';
import * as Watch from './watch.js';
import * as Probe from './probe.js';
import * as Generate from './generate.js';

const KEY = 'aa.validation';
// A task model written from the person's query, and the name that marks one.
// Kept apart from the session blob because it is written once per run and read
// on every restart, while the blob is rewritten on every agent action.
const MODEL_KEY = 'aa.validation.model';
// Per-page-read counts. Capped like the others: storage is 10 MB and this blob
// is rewritten on every agent action.
const KEEP_READS = 200;
export const GENERATED = 'generated';

/** How many of the person's own questions the record keeps. */
const ASKED_LIMIT = 50;

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

// The structural form of the same question, for callers that say WHICH tool
// is running rather than only describing it. The regex above classifies a
// sentence the model wrote about itself, and a miss fails OPEN - a vaguely
// worded action was never held. The harness's action vocabulary is a closed
// set, so when the tool name is on hand the classification is a lookup, and
// a tool this list has never heard of counts as changing the world until
// someone says otherwise - unknown fails CLOSED.
const LOOKS_ONLY = new Set(['scroll', 'wait', 'wait_for_element',
  'wait_for_network_idle', 'read_skill', 'dropdown_options', 'screenshot',
  'extract', 'read']);

function changesSomething(actionDescription, ctx) {
  const kind = typeof ctx?.action === 'string' ? ctx.action : ctx?.action?.action;
  if (kind) return !LOOKS_ONLY.has(String(kind));
  return CHANGES_SOMETHING.test(String(actionDescription || ''));
}

// Is this action commit-class? Two triggers, either suffices. The words on
// the control ("place your order") - which come off the PAGE via the target
// description, so they are more than the agent's account - and the position:
// a world-changing action while the run sits at a node the task model marks
// money-moving is a commit whatever the button happens to say, which is what
// catches the wording the regex never heard.
function commitClass(actionDescription, ctx) {
  if (COMMITTING.test(String(actionDescription || ''))) return true;
  if (!flatModel || currentNode == null) return false;
  if (!changesSomething(actionDescription, ctx)) return false;
  const here = String(currentNode);
  return (flatModel.questions || []).some(
    (q) => q.moneyMoving === true && String(q.node) === here);
}

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
let srcModel = null;
let modelSource = null;
// A cap on questions the layer wrote for itself off the pages it saw. Without
// one a long run keeps adding to what every later page read has to ask.
const MAX_DISCOVERED = 20;
let discovered = 0;

/**
 * What is known about the task, for callers that behave differently on a task
 * that buys something than on one that reads something.
 *
 * `commits` is undefined while there is no model — not knowing is not the same
 * as knowing it does not.
 */
function aboutTask() {
  if (!flatModel) return {};
  return { commits: (flatModel.questions || []).some((q) => q.moneyMoving === true) };
}

// Where in the task model the run currently is, as the reasoner last read it
// off the page rather than as the agent reports it. The trace files an action
// under this, which is what makes a lookup by node possible at all — an action
// on its own does not know which decision it belongs to.
let currentNode = null;
let currentNodeLabel = null;
let currentPhase = null;

// Who is acting on the page. Two things acting on one page with no shared
// record of which one is acting is how the failure in the code comments
// happened: in a recorded run the agent spent ten steps trying to dismiss its
// own supervisor overlay, and pressed the person's "Got it" button.
let holder = 'agent';
let handOverNode = null;
let handOverAt = null;

/** The node's own name, for a lookup that has to be spoken. */
const labelFor = (id) => (id != null && flatModel?.labels?.[id]) || null;

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


// What to say first when several things are waiting.
//
// The list was in the order the findings arrived, so the sentence led with
// whatever the page happened to answer first — on a live run, "Is this a direct
// flight?" while three contradictions sat behind it, and at ten unread it
// degraded to a bare count that named nothing at all. A person who has
// delegated the task hears one sentence; it has to be the one that matters.
function leadWith(unread) {
  return unread.find((f) => f.level === 'stop' && f.contradicts)
      || unread.find((f) => f.level === 'stop')
      || unread[0];
}

/** What identifies one finding. Must match the overlay's key exactly. */
const fkey = (f) => `${f.widget}|${f.phase}|${f.say}`;

// The read the gate may need to wait for, and what the last read said about
// where the run is. Both feed one rule - nothing commits blind: a committing
// action waits for the in-flight read of its own page (decision 22, at most
// once per task, bounded), and a committing action on a page that matches no
// step of the task is held outright (the out-of-distribution half of the hard
// gate: an irreversible step on unfamiliar territory always asks).
let readInFlight = null;
let lastOffPlan = false;
// The narration channel's own state: which phase was last announced as a
// checkpoint, and whether the plan review has been spoken for this task.
// Plan review, checkpoints, and the wrap-up are ONE channel - the review is
// checkpoint zero, the boundaries are the middle, the wrap-up is the end -
// and all of it goes through calmSpeech so it never talks over a stop.
let lastCheckpointPhase = null;
let planReviewSpoken = false;
// Bounded well under the read timeout: with streaming, the rows that can stop
// a commit arrive in the first seconds, so waiting out a whole slow read buys
// little and feels broken. If the read is still going at the cap, the gate
// proceeds on what is known.
const COMMIT_WAIT_MS = 20_000;

// One interruption per burst, not one per stop.
//
// A live hotel run opened with four distinct holds inside twenty seconds -
// four assertive announcements in a row, each cutting into the last. Two
// rules fix it without hiding anything. Stops raised by ONE page read are
// spoken as one sentence: the first in full, the rest named. And after any
// assertive announcement, further assertive lines inside the cooldown go out
// politely with an "Also:" - they still hold the agent and still reach the
// panel; what changes is only that they stop cutting the person off.
let lastAssertiveAt = 0;
let ASSERTIVE_COOLDOWN_MS = 20_000;

function calmSpeech(lines) {
  let out = lines;
  const stops = lines.filter((l) => l.level === 'stop');
  if (stops.length > 1) {
    const rest = lines.filter((l) => l.level !== 'stop');
    const more = stops.length - 1;
    const names = stops.slice(1, 3).map((l) => l.widget).join('; ');
    const tail = stops.length > 3 ? `; and ${stops.length - 3} more` : '';
    out = [{
      say: `${stops[0].say} And ${more} more need${more === 1 ? 's' : ''} you: ${names}${tail}.`,
      level: 'stop', live: stops[0].live, widget: stops[0].widget,
    }, ...rest];
  }
  const now = Date.now();
  return out.map((l) => {
    if (l.live !== 'assertive') return l;
    if (now - lastAssertiveAt < ASSERTIVE_COOLDOWN_MS) {
      return { ...l, live: 'polite', say: `Also: ${l.say}` };
    }
    lastAssertiveAt = now;
    return l;
  });
}

// Findings live in storage, not in a module variable.
//
// An MV3 service worker is torn down after about thirty seconds of idle and
// restarted on the next event, and everything held in module scope is lost
// with it. A worker that restarts mid-task would come back with an empty
// accumulator and the next publish would write that empty array over the real
// findings — the panel goes blank and nothing in the logs says why. Reading
// storage before appending survives the restart.
/** Union by what the finding actually says, at the phase it says it. */
/** How much of each unbounded list survives a publish. */
const KEEP_FINDINGS = 300;
const KEEP_RULE_CATCHES = 100;

function mergeFindings(prev, next) {
  const key = (f) => `${f.widget}|${f.phase}|${f.say}`;
  const have = new Set(prev.map(key));
  return prev.concat(next.filter((f) => !have.has(key(f)))).slice(-KEEP_FINDINGS);
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
  // The holds the dead worker was carrying. Without this the rebuilt run has
  // an empty waiting list and run.gate() opens for the rest of the task.
  // `prev.holds` is the list; `prev.waiting` is a count the surfaces read,
  // and feeding the count here was why holds never survived a restart.
  run.restoreWaiting?.(prev.holds);
  for (const k of prev.acknowledged || []) acknowledged.add(k);
  // The task model dies with the worker and is only reloaded by a top-level
  // fetch in background.js, which resolves AFTER the queued event that woke
  // the worker. So one settle ran with flatModel null, fell into the Amazon
  // path, and `phaseOf` returned null on a flights page — that page was never
  // checked and nothing recorded that it wasn't. Reload it here instead.
  if (!flatModel && prev.modelSource) {
    try {
      if (prev.modelSource === GENERATED) {
        // A model written from the person's query has no URL to refetch, so it
        // is kept in storage. Losing it to a worker restart would silently drop
        // the run back to checking nothing, which is the failure this whole
        // reload exists to prevent.
        const saved = (await chrome.storage.local.get(MODEL_KEY))[MODEL_KEY];
        if (saved) globalThis.ValidationTaskModel?.load(saved, GENERATED);
      } else {
        const r = await fetch(chrome.runtime.getURL(prev.modelSource));
        if (r.ok) globalThis.ValidationTaskModel?.load(await r.json(), prev.modelSource);
      }
    } catch { /* absent is a supported state: the Amazon path runs */ }
  }
  // Where the run was and who was driving. Both are published on every write
  // for exactly this: a worker restart during a hand over must not come back
  // believing the agent has the wheel, which is how two things end up acting
  // on one page.
  currentNode = prev.node ?? null;
  currentNodeLabel = prev.nodeLabel ?? null;
  currentPhase = prev.phase ?? null;
  holder = prev.holder === 'person' ? 'person' : 'agent';
  handOverNode = prev.handOverNode ?? null;
  handOverAt = prev.handOverAt ?? null;
  handOverTab = prev.handOverTab ?? null;
  // The watch died with the worker. Coming back mid-hand-over without it would
  // leave the agent held and nothing reading the page, so the person would be
  // driving unobserved and handing back would report that nothing changed.
  if (holder === 'person' && !watchTimer) startWatching(handOverTab);
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
  // Not while the person is driving. The clock exists to catch someone who
  // walked away, and someone doing the step themselves is the opposite of
  // that — ending their run four minutes in and calling it "nobody answered"
  // would be the layer misreading the one case it can see most clearly.
  if (holder === 'person') return { next: 'nothing', waitedMs: 0 };
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
        spokenWords: prev.spokenWords || 0, waiting: prev.waiting || 0,
        holds: prev.holds || [] };
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
    // Only a stop holds. An aside is by definition "one line, agent continues"
    // - policy.js's own words - but this filter read every non-ambient finding
    // as a hold, so an unread aside paused the agent without ever being spoken
    // as a pause. Holding and saying are different decisions: a stop does
    // both, an aside only says.
    const unread = merged0.filter((f) => f.level === 'stop' && !f.confirming)
      .filter((f) => !ack.has(fkey(f)));
    if (unread.length) {
      gate = { allowed: false, waitingOn: unread.map((f) => f.widget),
        unread: unread.length,
        // Which one the gate block is showing. The surfaces exclude it from
        // their own list so a question does not appear twice with two button
        // rows -- but they were excluding everything the gate waits on, which
        // is every unread finding. So the person saw one finding, read "And 2
        // more you haven't seen", and had no way to see them. Naming the lead
        // makes the exclusion cover the one that is genuinely duplicated.
        leading: leadWith(unread).widget,
        say: unread.length === 1
          ? `Waiting for you: ${leadWith(unread).say}`
          : `Waiting for you: ${leadWith(unread).say} `
            + `And ${unread.length - 1} more you haven't seen.` };
    }
  }
  // The decisions this run has passed through, in order, so a surface can
  // offer them to go back to. Carried forward rather than recomputed, because
  // deriving it would mean reading the trace on every publish, and every agent
  // action publishes.
  const decisions = (prev.decisions || []).slice();
  if (currentNode != null
      && decisions[decisions.length - 1]?.nodeId !== String(currentNode)) {
    decisions.push({ nodeId: String(currentNode),
                     label: currentNodeLabel || null,
                     phase: currentPhase || null,
                     at: Date.now() });
  }

  const book = await rules();

  // A check that never ran because nobody said the size is not a check that
  // passed. It belongs in the plan, marked skipped, next to what did happen —
  // an unflagged absence is the failure the whole layer exists to surface, and
  // the plan is the last place that should reproduce it.
  const blanks = contract ? gaps(contract, aboutTask()) : [];
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
      // Where the run is and who is driving. Written on every publish so both
      // survive a worker restart, and so a surface can say which of the two is
      // acting rather than guessing.
      node: currentNode, nodeLabel: currentNodeLabel,
      holder, handOverNode, handOverAt, handOverTab, modelSource,
      // Both surfaces read this to name the part the person took. It was never
      // written, so they announced a raw node id ("paused at 4.3").
      handOverNodeLabel: labelFor(handOverNode),
      // A probe result stays up until something replaces or clears it - it
      // must survive the unrelated publishes that happen constantly.
      probe: extra.probe !== undefined ? extra.probe : prev.probe || null,
      // Capped. chrome.storage.local is 10 MB with no unlimitedStorage in the
      // manifest, this blob is rewritten on every agent action, and both these
      // lists grew for the life of the profile. When the quota does blow, the
      // failure is silent and total: the set rejects inside _publish, observe()
      // throws before publishing, and the layer stops checking pages while the
      // panel keeps showing the last state it managed to write.
      ruleCatches: (extra.ruleCatches !== undefined ? extra.ruleCatches
        : prev.ruleCatches || []).slice(-KEEP_RULE_CATCHES),
      unspecified: extra.unspecified !== undefined ? extra.unspecified
        : prev.unspecified || [],
      phase: extra.phase !== undefined ? extra.phase : prev.phase ?? null,
      invalidated: extra.invalidated !== undefined ? extra.invalidated
        : prev.invalidated || [],
      contract: contract || prev.contract || null,
      // Union, never replacement: a publish arriving before rehydrate has
      // run must not shrink the stored list back to whatever this worker
      // instance happens to have seen.
      // Union by default, so a publish arriving before rehydrate cannot shrink
      // the list. An explicit array replaces it, which is how start() and
      // stop() clear it: the stored list is keyed by widget|phase|say, which
      // is stable across runs, so carrying it forward pre-acknowledged the
      // same finding in a later task and the gate opened without the person
      // ever seeing it.
      acknowledged: Array.isArray(extra.acknowledged) ? extra.acknowledged
        : [...new Set([...(prev.acknowledged || []), ...acknowledged])],
      opts: run ? runOpts : (prev.opts || runOpts),
      // Kept for the same reason as `acknowledged`: what was looked at is part
      // of the record, and a surface that cannot list the decisions cannot
      // offer to go back to one.
      decisions: decisions.slice(-60),
      // What each page read actually cost and yielded. `publish()` was already
      // being handed this on every read and dropped it on the floor, so there
      // was no way to tell a page that answered nothing from a model that
      // returned nothing from answers that were all discarded for having no
      // quote. Those are three different problems with the same appearance, and
      // the counting already existed.
      reads: (extra.reasoner
        ? (prev.reads || []).concat({
            at: Date.now(),
            phase: extra.phase ?? currentPhase ?? null,
            asked: extra.reasoner.asked ?? null,
            answered: extra.reasoner.answered ?? null,
            discarded: extra.reasoner.discarded ?? null,
            unmatched: extra.reasoner.unmatched ?? null,
            noticed: extra.reasoner.noticedKept ?? null,
            ms: extra.reasoner.ms ?? null,
            truncated: extra.reasoner.guard?.truncated ?? null,
            // How many rows went out mid-stream, so a recording shows whether
            // streaming actually engaged rather than silently falling back.
            early: extra.reasoner.earlyIds?.length ?? 0,
          })
        : (prev.reads || [])).slice(-KEEP_READS),
      lookedBack: extra.lookedBack !== undefined ? extra.lookedBack
        : prev.lookedBack || null,
      // Milestones survive unrelated publishes, like `probe` does. Every
      // agent action publishes, so without the carry-forward the plan review
      // and the wrap-up were erased from storage within a step of being
      // written - the panel and the recorder mostly never saw them.
      planReview: extra.planReview !== undefined ? extra.planReview
        : prev.planReview || null,
      wrapUp: extra.wrapUp !== undefined ? extra.wrapUp
        : prev.wrapUp || null,
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
  // Everything the layer already knows, handed to the reasoner so it can judge
  // which questions are live rather than reading each page cold. The agent's
  // own log says what it just DID; it is never used as evidence about what the
  // page SAYS, which is the separation the whole design rests on.
  let agentDoing = [];
  try {
    const a = (await chrome.storage.local.get('bhAgent')).bhAgent || {};
    agentDoing = (a.log || []).filter((e) => e.kind === 'action' || e.kind === 'info')
      .slice(-5).map((e) => e.text || `${e.action || ''} ${e.detail || ''}`.trim())
      .filter(Boolean);
  } catch { /* no agent running: the person is browsing and we still check */ }
  const prevState = await stored();
  const alreadyAnswered = (prevState.findings || [])
    .filter((f) => f.source === 'reasoner' && f.say)
    .slice(-12).map((f) => ({ question: f.widget, answer: String(f.say).slice(0, 120) }));

  // Stop-class answers surface the moment the model writes them, mid-stream,
  // instead of at the end of a 20-second reply. Only a contradiction or a
  // money-moving answer comes through here, already quote-verified, and a
  // stop-level finding in storage is what holds the agent - so the gate arms
  // seconds into the read. The row is excluded from the final apply below so
  // it is not raised twice.
  const earlySurfaced = new Set();
  const onRow = async (row) => {
    try {
      const phase = currentPhase || null;
      const early = Reasoner.toFindings(
        { answers: [row], alignedNodes: [], noticed: [] }, phase);
      if (!early.length) return;
      const f = early[0];
      earlySurfaced.add(f.widget);
      await publish({ append: [{
        widget: f.widget, level: 'stop', say: f.say, from: f.from,
        confirming: false, paradigm: f.paradigm || null, shape: f.shape || null,
        checkedAgainst: null, control: f.control || null, phase,
        node: f.node || null, cluster: f.cluster || null,
        moment: f.moment || null, verified: f.verified || null,
        contradicts: f.contradicts === true, moneyMoving: f.moneyMoving === true,
        confidence: f.confidence ?? null, aligned: false,
        why: f.why ?? null, whatTheAgentLoses: f.whatTheAgentLoses ?? null,
        route: null, eu: null, source: 'reasoner',
      }], phase });
      chrome.runtime.sendMessage({ type: 'validationSpeak', phase,
        lines: calmSpeech([{ say: f.say, level: 'stop', live: 'assertive', widget: f.widget }]) })
        .catch(() => {});
      await Trace.record({ nodeId: f.node ?? currentNode,
        label: labelFor(f.node ?? currentNode), phase, holder,
        action: 'stopped mid-read', findings: [{ widget: f.widget, node: f.node, level: 'stop' }] });
    } catch { /* an early surface must never break the read itself */ }
  };

  const result = await Reasoner.readPage(flatModel, snap.text, {
    ask: contract ? describe(contract) : null,
    url: snap.url || null,
    agentDoing,
    alreadyAnswered,
    onRow,
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
  // Where the run is, in one bit: a page that aligns to nothing while a model
  // is loaded is off the plan, and the gate holds any commit there. Cleared
  // the moment an aligned page is read.
  lastOffPlan = !phase && !(result.alignedNodes || []).length;
  // The page's own danger signs, feeding P(e) for everything found on it.
  const signals = {
    offPlan: lastOffPlan,
    ambiguity: (result.ambiguity || []).length,
    traceAnomaly: !!(result.traceAnomaly
      && ((result.traceAnomaly.retries ?? 0) > 1 || result.traceAnomaly.backtrack === true)),
  };
  // Anything already surfaced mid-stream is not raised a second time. It is
  // in storage at the phase the run was in when it fired; the say and the
  // quote are identical, so nothing is lost by the exclusion.
  const findings = Reasoner.toFindings(result, phase)
    .filter((f) => !earlySurfaced.has(f.widget));

  // Where the run is, read off the page. The first node the page is serving,
  // falling back to the first node a finding belongs to — a page that answered
  // something about the size is at the size whether or not the model listed it
  // among the nodes it thought it was serving.
  const nodes = (result.alignedNodes || []).slice();
  currentNode = nodes[0] || findings.find((f) => f.node)?.node || currentNode;
  currentNodeLabel = labelFor(currentNode);
  currentPhase = phase || null;

  // Every read goes on the record, whether or not it produced anything. A page
  // that answered nothing is still a moment the run passed through, and a
  // trace with holes in it is one you cannot trust to go back through.
  const traceRead = (rows) => Trace.record({
    nodeId: currentNode, nodes, label: currentNodeLabel, phase,
    action: 'read the page', url: snap.url || null, holder, findings: rows,
  });

  if (!findings.length) {
    // Nothing this page could answer and nothing worth raising. Recorded
    // rather than silent: what the reasoner asked and what it discarded is
    // still the record of a page having been read.
    await traceRead([]);
    await publish({ phase: phase || null, reasoner: result.meta });
    return { phase, findings: 0, url: snap.url, reasoner: result.meta };
  }

  // What the page revealed that no question asked for becomes a question.
  //
  // The open pass has always found these and always dropped them: it produced a
  // finding for this page and nothing carried it forward, so a pre-ticked
  // insurance box noticed on the add-ons page was not looked for again at
  // checkout or on the confirmation - which is exactly where an unnoticed
  // pre-tick survives to. Measured offline first: on a recorded flights run,
  // twelve questions written this way raised coverage against held-out gold by
  // 5.1 points with one spurious.
  await adopt(result.noticed, phase);

  // Answered counts as read; an answer thrown away for an unverifiable quote
  // counts as something on this page the layer could not read. That is what
  // the plan's "couldn't read" line is for, and it is the honest number —
  // a question this page simply does not answer is not a failure to read.
  const read = result.meta.answered + result.meta.noticedKept;
  const of = read + result.meta.discarded + result.meta.noticedDiscarded;

  let rendered;
  try {
    ({ findings: rendered } = run.observeFindings(findings, phase, { read, of, signals }));
  } catch (e) {
    await publish({ append: [{ widget: 'Checking failed', level: 'aside',
      say: `I could not finish checking this page. ${String(e.message || e).slice(0, 80)}`,
      from: snap.url || 'this page', confirming: false, phase }], phase,
      reasoner: result.meta });
    return { phase, findings: 0, error: String(e.message || e) };
  }

  // The cognitive checkpoint: one short polite line when the run crosses a
  // phase boundary, and only then (decision 16). It rides in front of this
  // read's findings so "now: compare properties" frames what follows, and it
  // goes through the same calmSpeech as everything else so it never talks
  // over a stop.
  const checkpoint = [];
  if (phase && phase !== lastCheckpointPhase) {
    checkpoint.push({
      say: lastCheckpointPhase
        ? `${lastCheckpointPhase} done. Now: ${phase}.`
        : `Starting: ${phase}.`,
      level: 'checkpoint', live: 'polite', widget: 'checkpoint',
    });
    lastCheckpointPhase = phase;
  }

  const speak = [...checkpoint, ...calmSpeech(rendered
    .filter((f) => f.spoken?.speak)
    .map((f) => ({ say: f.spoken.speak, level: f.level, live: f.spoken.live,
                   widget: f.finding.widget })))];

  const marks = rendered
    .filter((f) => f.visual && f.level !== 'ambient')
    .map((f) => ({ ...f.visual, level: f.level, widget: f.finding.widget }));

  // With the levels on, because whether a finding stopped the run is part of
  // what happened at that node.
  await traceRead(rendered.map((f) => ({
    widget: f.finding.widget, node: f.finding.node || null, level: f.level })));

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
    // These four were dropped here, which made leadWith()'s contradiction
    // clause dead against stored findings and left nothing downstream of
    // storage able to weigh a finding - the utility model reads stored
    // findings, so it needs the fields the decision was made from.
    contradicts: f.finding.contradicts === true,
    moneyMoving: f.finding.moneyMoving === true,
    confidence: f.finding.confidence ?? null,
    aligned: f.finding.aligned === true,
    why: f.finding.why ?? null,
    whatTheAgentLoses: f.finding.whatTheAgentLoses ?? null,
    // The utility model's verdict, when it routed this finding: which of the
    // four routes won and the per-route scores it won on. The completion
    // review orders by these.
    route: f.finding.route ?? null,
    eu: f.finding.eu ?? null,
    source: f.finding.source || 'reasoner',
  })), phase, reasoner: result.meta });

  if (speak.length) {
    chrome.runtime.sendMessage({ type: 'validationSpeak', lines: speak, phase })
      .catch(() => {});
  }
  return { phase, findings: rendered.length, speak, marks, url: snap.url,
           reasoner: result.meta };
}

// ── hand over ───────────────────────────────────────────────────────────────
//
// The mode with no implementation until now, and the gold says it matters:
// hand over is 39 of the 242 gold questions, second only to facts at 84. Those
// are the moments where the person does not want a better explanation, they
// want to do that part themselves.
//
// Handing over is more than stopping, because the agent has to come back to a
// state it did not create. Four things have to be true and each one is a
// separate mechanism below:
//
//   1. It is scoped by a task model node, not by a stretch of time. "Let me
//      pick the size myself" hands over the node that selects a variant.
//   2. The agent stops ACTING and something keeps PERCEIVING. It has to know
//      what the person did, and the only honest way to know is to look at the
//      page rather than ask. So the agent's loop is held — it burns no steps
//      and touches nothing — and the layer's own reasoner keeps reading the
//      page on each settle while the person drives.
//   3. Handing back re-perceives, and what changed is stated from the TRACE
//      rather than from the agent's memory. The agent was not there; its
//      memory of this stretch is of a page it never saw.
//   4. The gate stays live throughout. Findings publish exactly as before —
//      this is the case where the layer is checking the person rather than the
//      agent, and the same machinery works unchanged.

/** How often the layer looks at the page while the person is driving. */
export let HANDOVER_WATCH_MS = 4_000;

let watchTimer = null;
let watchTab = null;
let lastSeen = null;
let handOverTab = null;

/** Cheap identity for a page read, so an unchanged page costs no model call.
 *  Shared with the watched-value registry, which asks the same question of the
 *  same snapshots. */
const hashText = Watch.hashText;

async function activeTabId() {
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t?.id ?? null;
  } catch { return null; }
}

/**
 * One look at the page while the person has the wheel.
 *
 * The snapshot is free — it is a local accessibility read, no model involved —
 * and comparing it to the last one is what turns a poll into "on each settle".
 * A page that has not changed is not read again, so the cost is one model call
 * per thing the person actually does.
 */
let lastHandOverRead = 0;
/**
 * The same floor the watch registry uses, for the same reason.
 *
 * Settable so a test can drive watchOnce back to back and check the
 * change-detection it is actually testing. Production never changes it: a page
 * that re-renders would otherwise cost a full model call every four seconds.
 */
let handOverMinReadMs = 60_000;
export function setHandOverFloor(ms) {
  handOverMinReadMs = Number.isFinite(ms) ? ms : 60_000;
}

async function watchOnce() {
  if (holder !== 'person') return { skipped: 'the agent has the wheel' };
  const H = globalThis.BrowserHarness;
  if (!H?.axSnapshot) return { skipped: 'harness has no accessibility read' };
  // Only ever the tab the hand over was for. This used to fall back to
  // whatever tab was focused, which meant a hand over whose tab id did not
  // resolve read the person's bank or their email and sent it to the model.
  // No tab is a reason to stop watching, not a reason to watch something else.
  const tabId = watchTab;
  if (tabId == null) return { skipped: 'no page was handed over' };
  if (tabId == null) return { skipped: 'no page to read' };
  // A page that re-renders — a checkout countdown, results re-sorting — changes
  // its text every poll, and without a floor every one of those was a full
  // model call: about 150 in ten minutes of someone filling in an address.
  if (Date.now() - lastHandOverRead < handOverMinReadMs) {
    return { skipped: 'read too recently' };
  }
  let snap;
  try { snap = await H.axSnapshot(tabId); } catch { return { skipped: 'could not read the page' }; }
  const h = hashText(snap.text);
  if (h === lastSeen) return { skipped: 'nothing settled' };
  lastSeen = h;
  lastHandOverRead = Date.now();
  // The snapshot is awaited, so the person may have handed back while it was
  // in flight. Re-check rather than publish findings into a run they now own.
  if (holder !== 'person') return { skipped: 'handed back while reading' };
  return Validation.observe(tabId, { snap });
}

function startWatching(tabId) {
  stopWatching();
  // Without a tab there is nothing safe to watch, so do not start.
  if (tabId == null) return;
  watchTab = tabId;
  lastSeen = null;
  try {
    // A service worker is torn down after about thirty seconds of idle and
    // this interval goes with it. That is survivable rather than fixed: the
    // navigation trigger in background.js still fires an observe on every page
    // load, and rehydrate() starts this again on the next event. What is lost
    // in the meantime is the in-page settle, on a page that never navigates.
    watchTimer = setInterval(() => { watchOnce().catch(() => {}); }, HANDOVER_WATCH_MS);
  } catch { /* no timers here means the navigation trigger is the only watch */ }
}

function stopWatching() {
  if (watchTimer) { try { clearInterval(watchTimer); } catch {} }
  watchTimer = null;
  watchTab = null;
  lastSeen = null;
}

// ── watched values ──────────────────────────────────────────────────────────
//
// The tenth interface type, and the only one whose move is spread over time.
// watch.js holds the registry, the comparison and the two decisions that shape
// it — that a watch outlives the run, and that it costs nothing while nobody is
// browsing. This is the part that has to sit in the session, because it reads
// pages through the harness and raises findings through the run.

/** Everything a watch needs to answer its own question on a later page. */
async function readWatch(w, pageText) {
  return Reasoner.askPage(w.question, pageText, {
    task: flatModel?.task || w.setDuringTask || null,
    // Deliberately not the current contract. A watch set in one task and read
    // during another must not have the second task's ask put in front of it.
    ask: null,
  });
}

/**
 * One look at every live watch, on the page that has just settled.
 *
 * Called from observe() with the snapshot it already has, and from the
 * navigation trigger when a watch is standing but no task is running. Both
 * paths are settles: there is no timer here and there is deliberately never
 * going to be one.
 *
 * @returns {Promise<{checked, read, moved, skipped}>}
 */
// One sweep at a time. The decision of whether a watch is due reads
// `lastReadAt` and then acts on it, outside any lock — so two top-frame
// navigations landing in the same window both saw the old value and both
// called the model, and the 60-second floor bought nothing. N simultaneous
// settles on a watched origin was N x 8 calls.
let sweeping = null;
async function checkWatches(snap) {
  if (sweeping) return sweeping.then(() => ({ checked: 0, read: 0, moved: 0,
    skipped: 'a sweep was already running' }));
  sweeping = _checkWatches(snap).finally(() => { sweeping = null; });
  return sweeping;
}

/**
 * Take what the page revealed and make it a standing question.
 *
 * Only things that carry a verified quote get in, which the reasoner has
 * already enforced - a question written off a sentence the page does not
 * contain would be worse than no question at all.
 */
async function adopt(noticed, phase) {
  if (!srcModel || !Array.isArray(noticed) || !noticed.length) return 0;
  if (discovered >= MAX_DISCOVERED) return 0;
  const find = (n, id) => {
    if (String(n.id) === String(id)) return n;
    for (const c of n.children || []) {
      const hit = find(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const node = currentNode ? find(srcModel.tree, currentNode) : null;
  // Hung on the node the page is serving, so it is asked in the right place;
  // the root is the fallback, which asks it everywhere rather than nowhere.
  const host = node || srcModel.tree;
  if (!host) return 0;
  const have = new Set((flatModel?.questions || []).map((q) => String(q.question).toLowerCase()));
  let added = 0;
  for (const n of noticed) {
    // `what` is the schema's field - NOTICED_ITEM requires it. `say` and
    // `question` never existed on a schema-conformant item, so this read empty
    // on every real run and adopt silently added nothing; the test's mock used
    // `say` and hid it.
    // Bounded and flattened: an adopted question comes off a page the layer
    // does not control, so it gets one line, no control characters, and a
    // hard length cap before it becomes something every later read asks.
    const text = String(n.what || n.say || n.question || '')
      .replace(/[\r\n\t\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ')
      .trim().slice(0, 160);
    if (!text || have.has(text.toLowerCase())) continue;
    if (discovered + added >= MAX_DISCOVERED) break;
    host.questions = host.questions || [];
    host.questions.push({
      question: text,
      why: 'found by looking at the page, not written in advance',
      whatTheAgentLoses: '',
      moment: 'Now',
      foundOnPage: true,
      firstSeenPhase: phase || null,
    });
    added += 1;
  }
  if (!added) return 0;
  discovered += added;
  try {
    globalThis.ValidationTaskModel?.load(srcModel, modelSource);
    await chrome.storage.local.set({ [MODEL_KEY]: srcModel });
  } catch { /* the questions are still on the in-memory model */ }
  return added;
}

async function _checkWatches(snap) {
  // A watch that has run out is reported before anything else, and exactly
  // once. It is checked ahead of the early return below because a sweep with no
  // live watches left is precisely when the last one has just lapsed.
  const lapsed = await Watch.lapsed();
  for (const w of lapsed) {
    await Watch.markLapsed(w.id);
    await raiseLapsed(w, snap);
  }

  const standing = await Watch.live();
  if (!standing.length) return { checked: 0, read: 0, moved: 0, lapsed: lapsed.length };

  const now = Date.now();
  const hash = hashText(snap.text);
  let read = 0;
  const moved = [];
  const skipped = [];

  for (const w of standing) {
    const s = Watch.shouldRead(w, { url: snap.url, hash, now });
    if (!s.read) { skipped.push({ id: w.id, why: s.why }); continue; }

    const r = await readWatch(w, snap.text);
    read += 1;
    const patch = { seenHash: hash, lastReadAt: now, reads: (w.reads || 0) + 1 };

    // A page that does not say is not a value that has not moved. It is a page
    // that does not say, and nothing is claimed from it.
    if (!r.ok || r.answer == null) { await Watch.update(w.id, patch); continue; }
    // `verified` travels with the reading rather than being asserted later. It
    // is the level askPage actually matched the quote at, and a finding built
    // from this must not claim a stricter one than happened.
    const reading = { answer: r.answer, quote: r.quote, verified: r.verified,
                      at: now, url: snap.url || null };

    // The first reading a watch could take becomes what it is watching. This
    // happens when the page the watch was set on could not answer its own
    // question — the watch stands, and the first page that can read it sets the
    // value rather than the watch reporting a move it never measured.
    if (!w.baseline) {
      await Watch.update(w.id, { ...patch, baseline: reading, last: reading });
      continue;
    }

    await Watch.update(w.id, patch);
    const cmp = Watch.compare(w.last || w.baseline, reading);
    if (!cmp.moved) continue;

    const move = { ...cmp, at: now, url: snap.url || null };
    await Watch.noteMove(w.id, move, reading);
    moved.push({ id: w.id, ...move });
    await raiseMove({ ...w, last: reading }, move, snap);
  }

  return { checked: standing.length, read, moved: moved.length, moves: moved,
           skipped, lapsed: lapsed.length };
}

/**
 * The watch ran out, so say so.
 *
 * Goes out at the same level as any other finding rather than as a quiet log
 * line. "I am no longer watching this" is news to the person who asked for it,
 * and they have no other way to discover it.
 */
async function raiseLapsed(w, snap) {
  const what = w.label || w.widget || 'a value';
  const last = w.last?.answer ?? w.baseline?.answer ?? null;
  const finding = {
    widget: w.widget || `Watching ${what}`,
    phase: currentPhase,
    say: `I have stopped watching ${what}. The watch ran out`
      + (last != null ? `, and the last reading I took was ${last}.` : '.'),
    from: w.last?.quote || w.baseline?.quote || null,
    answerable: true,
    confirming: false,
    contradicts: false,
    source: 'watch',
  };
  try {
    await publish({ append: [{ ...finding, level: 'aside' }], phase: currentPhase });
  } catch { /* a run that has gone is not a reason to lose the record */ }
  return finding;
}

/**
 * The value moved, so say so.
 *
 * With a task running this goes through the run exactly like any other finding:
 * same levels, same gate, same two surfaces. A price that moved while the agent
 * is mid-checkout is precisely something it should be held for.
 *
 * With no task running there is no agent to hold and no run to file it under,
 * so it is spoken and recorded on the watch, and published as an alert rather
 * than as a finding. A finding published now would sit unread in storage and
 * hold the gate of whatever task starts next, which is a run stopped by news
 * from a task that ended weeks ago.
 */
async function raiseMove(w, move, snap) {
  const say = Watch.sayMove(w, move);
  const finding = {
    widget: w.widget || `Watching ${w.label || 'a value'}`,
    phase: currentPhase,
    say,
    from: move.now && w.last?.quote ? w.last.quote : null,
    answerable: true,
    confirming: false,
    contradicts: false,
    paradigm: null,
    checkedAgainst: null,
    // What the person can do about it here: keep watching, or stop. Not the
    // card's "Watch it for me / Decide now" — that pair is for setting one, and
    // this is one that has already fired.
    control: { label: 'Stop watching this', action: 'watch-stop',
               decline: 'Keep watching', node: w.node ?? null,
               widget: w.widget ?? null, watchId: w.id },
    quiet: false,
    node: w.node ?? null,
    cluster: 'watch',
    moment: 'Now',
    moneyMoving: false,
    confidence: null,
    verified: w.last?.verified || null,
    aligned: false,
    source: 'watch',
  };

  await Trace.record({
    nodeId: w.node, label: w.label, phase: currentPhase, holder,
    action: `the watched value moved: ${move.was} → ${move.now}`,
    url: snap.url || null,
    findings: [{ widget: finding.widget, node: w.node ?? null, level: 'aside' }],
  });

  chrome.runtime.sendMessage({
    type: 'validationSpeak', phase: 'watch',
    lines: [{ say, level: 'aside', live: 'polite', widget: finding.widget }],
  }).catch(() => {});

  if (!run) {
    const prev = await stored();
    await publish({ watchAlerts: (prev.watchAlerts || []).concat({
      id: w.id, say, was: move.was, now: move.now, at: move.at,
      url: move.url, node: w.node ?? null, label: w.label ?? null,
    }).slice(-20) });
    return { raised: 'alert' };
  }

  let rendered;
  try {
    ({ findings: rendered } = run.observeFindings([finding], currentPhase, { read: 1, of: 1 }));
  } catch {
    return { raised: 'none' };
  }
  await publish({ append: rendered.map((f) => ({
    widget: f.finding.widget, level: f.level, say: f.finding.say,
    from: f.finding.from, confirming: false,
    paradigm: null, shape: f.finding.shape || null, checkedAgainst: null,
    control: f.visual?.control || null, phase: currentPhase,
    node: f.finding.node || null, cluster: 'watch', moment: 'Now',
    verified: f.finding.verified || null, source: 'watch',
  })) });
  return { raised: 'finding' };
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
    // A new task is a new trace. The old one is a record of a different run,
    // and a lookup that reaches into it would answer a question about this
    // task with something from the last one.
    await Trace.clear();
    currentNode = null;
    currentNodeLabel = null;
    currentPhase = null;
    // A new task starts the narration channel over: no phase has been
    // announced, no plan has been reviewed, nothing is off the plan, and no
    // read is in flight from the previous run.
    lastCheckpointPhase = null;
    planReviewSpoken = false;
    lastOffPlan = false;
    readInFlight = null;
    holder = 'agent';
    handOverNode = null;
    handOverAt = null;
    // Checking is not a setting to remember to switch on. A layer that has to
    // be enabled separately is off exactly when it matters, because nobody
    // predicts the run that will go wrong. Starting a task turns on the
    // surface that reports on it.
    try { await chrome.storage.sync.set({ agentWatch: true }); } catch { /* not fatal */ }
    await publish({ findings: [], probe: null, unspecified: gaps(contract, aboutTask()),
                    acknowledged: [] });
    return { started: true, contract, unspecified: gaps(contract, aboutTask()) };
  },

  /**
   * What the person did not say, and what stays unchecked because of it.
   * The panel turns these into questions; nothing is guessed to fill them.
   */
  unspecified: () => (contract ? gaps(contract, aboutTask()) : []),

  async stop() {
    run = null;
    // Watched values are NOT cleared here, and that is the decision rather than
    // an oversight. The flights gold's own move is keeping the price watch on
    // after booking, because a drop inside a cancellable fare class means
    // cancel and rebook — a registry that died with the run could not express
    // the one thing the type is for. See watch.js for what bounds it instead.
    //
    // A hand over is the opposite and does not outlive the task it was part of.
    // Leaving that watcher running would keep reading pages for a run that has
    // ended.
    stopWatching();
    holder = 'agent';
    handOverNode = null;
    handOverAt = null;
    handOverTab = null;
    // The contract goes too. Leaving it set kept the surface showing a task
    // that had ended — findings gone, the ask still on screen — so there was
    // no way back to starting a new one without reloading. Ending a task has
    // to actually end it.
    contract = null;
    acknowledged.clear();
    await publish({ findings: [], contract: null, probe: null, steps: [],
                    gate: { allowed: true }, acknowledged: [] });
  },

  /** Test seam for the hand-over read floor. Production leaves it at 60s. */
  setHandOverFloor,

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
    const running = !!run || await rehydrate();
    // A watch outlives the run that set it, so a settle is checked for watched
    // values whether or not a task is being checked. With no watches standing
    // and no run, this costs one storage read and nothing else.
    if (!running && !(await Watch.any())) {
      return { skipped: 'no validation run in progress' };
    }
    const H = globalThis.BrowserHarness;
    if (!H?.axSnapshot) return { error: 'harness has no accessibility read' };

    // The hand-over watcher has already read the page to decide whether
    // anything settled, so it hands the snapshot in rather than paying for a
    // second read of the same page.
    const snap = opts.snap || await H.axSnapshot(tabId);

    // Watched values, on the page that has just settled. Deliberately after the
    // read below when there is one, so a movement never jumps ahead of what
    // this page itself says — but before every return, so no settle is missed.
    const watchNow = () => (opts.watches === false
      ? Promise.resolve(null) : checkWatches(snap));

    if (!running) {
      const watched = await watchNow();
      return { skipped: 'no validation run in progress', watched };
    }

    // A task model is loaded: the reasoner reads this snapshot against its
    // questions. No URL regex, no extractors — the page decides what it can
    // answer. With no model loaded this is skipped entirely and the Amazon
    // path below runs unchanged.
    if (flatModel) {
      // Tracked so the gate can wait for it: a commit clicked while this read
      // is mid-flight would otherwise be judged on the page BEFORE the one
      // being committed. The whole read is the flight, not just the model
      // call, so the findings are published by the time a waiter proceeds.
      const flight = observeByModel(snap, opts);
      const guarded = flight.catch(() => {});
      readInFlight = guarded;
      // Cleared only if it is still OUR flight. Two reads can overlap, and
      // the first one finishing must not blank the tracker while the second
      // is still flying - that would let a commit slip through unwaited.
      flight.finally(() => { if (readInFlight === guarded) readInFlight = null; });
      const r = await flight;
      return { ...r, watched: await watchNow() };
    }

    const phase = opts.phase || phaseOf(snap.url);
    if (!phase) {
      // Record that this page has nothing to check, rather than leaving the
      // last page's phase in place. Otherwise the surface keeps presenting a
      // sign-in wall as though it were the review page it was headed for.
      await publish({ phase: null });
      const watched = await watchNow();
      return { skipped: `nothing to check on ${snap.url || 'this page'}`, watched };
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
      return { phase, findings: 0, error: String(e.message || e),
               watched: await watchNow() };
    }

    // Only what is meant to be heard. Ambient findings stay reachable on
    // request rather than being announced.
    const speak = calmSpeech(rendered
      .filter((f) => f.spoken?.speak)
      .map((f) => ({ say: f.spoken.speak, level: f.level, live: f.spoken.live,
                     widget: f.finding.widget })));

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
    return { phase, findings: rendered.length, speak, marks, url: snap.url,
             watched: await watchNow() };
  },

  /**
   * May the agent take this step? Called by the harness agent before acting.
   * A held gate is not advice — the action does not happen.
   */
  async allow(actionDescription, ctx = {}) {
    // Captured before anything is awaited. traceAction reads currentNode at
    // call time, and an observe finishing in that window moves it — so a held
    // action was filed under whatever page arrived next, which is exactly the
    // lookup the trace exists for.
    const atNode = currentNode;
    if (!run && !(await rehydrate())) return { allowed: true };

    // The clock ticks here, before the early return below, because a held
    // agent still scrolls and a hold nobody answers has to end the run whether
    // or not the action in hand was one the gate would have stopped.
    await tickHold();

    // Filed under wherever the run is. An action on its own does not know
    // which decision it belongs to, which is why "go back to where the size
    // was chosen" was a scan of a click list before this.
    // `at` defaults to where the run was when allow() was ENTERED, not where a
    // concurrent observe has since moved it.
    const traceAction = (verdict, at = atNode) => Trace.record({
      nodeId: at, label: labelFor(at) || currentNodeLabel, phase: currentPhase,
      step: ctx.step ?? null, holder,
      action: `${actionDescription || 'something'}${verdict ? ` — ${verdict}` : ''}`,
    });

    // Nothing commits blind, in two halves.
    //
    // First: a committing action clicked while this page's read is mid-flight
    // waits for the read, bounded. The wait is narrated only if it actually
    // engages for more than a beat, so a fast read costs nothing and a slow
    // one reads as diligence rather than lag. With streaming, the rows that
    // can stop this commit arrive in the first seconds, so the common case is
    // a short wait or none.
    const committing = commitClass(actionDescription, ctx);
    if (committing && readInFlight) {
      let waited = false;
      const talk = setTimeout(() => {
        waited = true;
        chrome.runtime.sendMessage({ type: 'validationSpeak', phase: currentPhase,
          lines: [{ say: 'One moment. Checking this page before anything commits.',
            level: 'aside', live: 'polite', widget: 'commit wait' }] }).catch(() => {});
      }, 1500);
      await Promise.race([readInFlight,
        new Promise((r) => setTimeout(r, COMMIT_WAIT_MS))]);
      clearTimeout(talk);
      if (waited) await traceAction('waited for the page read before committing');
    }

    // Second: a committing action on a page that matches no step of the task
    // is held outright. This is the out-of-distribution half of the hard
    // gate: for a step that is hard to undo, "I do not recognise where the
    // agent is" is itself the reason to ask, however clean the findings are.
    if (committing && lastOffPlan && flatModel) {
      await traceAction('held, committing on a page that matches no step of the task');
      const say = 'This page does not match any step of the task I know. '
        + 'I am not letting anything commit here until you look.';
      // Spoken, not just returned: the agent's own log is the only other
      // place this reason lands, and the person this exists for cannot see
      // it there. calmSpeech keeps repeats inside the cooldown polite.
      chrome.runtime.sendMessage({ type: 'validationSpeak', phase: currentPhase,
        lines: calmSpeech([{ say, level: 'stop', live: 'assertive', widget: 'off the plan' }]) })
        .catch(() => {});
      return { allowed: false, waitingOn: ['off the plan'], say };
    }


    // The person has the wheel. The agent may look all it likes and may not
    // move the page under their hands.
    //
    // The pause in handOver() is what stops it burning steps; this is what
    // stops it acting, and the two are deliberately separate. A pause is a flag
    // in the agent's own process and a worker restart or a second run would
    // clear it; the gate is checked at the point of action and does not care
    // how the action got there.
    if (holder === 'person' && changesSomething(actionDescription, ctx)) {
      await traceAction('held, the person has the wheel');
      return {
        allowed: false,
        holder: 'person',
        waitingOn: [],
        say: `You have this part${labelFor(handOverNode) ? `: ${labelFor(handOverNode)}` : ''}. `
           + 'I am not touching anything until you hand it back.',
      };
    }

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
    if (!changesSomething(actionDescription, ctx)) {
      return { allowed: true };
    }

    const prev = await stored();
    // Stops only, same rule as the derived gate in _publish. An aside used to
    // land here too, so the agent silently could not move while an unread
    // aside sat in the panel - a pause the layer never announced as one.
    const unread = (prev.findings || [])
      .filter((f) => f.level === 'stop' && !f.confirming)
      .filter((f) => !acknowledged.has(fkey(f)));

    if (unread.length) {
      const first = leadWith(unread);
      await traceAction('held, unread', atNode);
      return {
        allowed: false,
        waitingOn: unread.map((f) => f.widget),
        unread: unread.length,
        say: unread.length === 1
          ? `Waiting for you: ${first.say}`
          : `Waiting for you: ${first.say} `
            + `And ${unread.length - 1} more you haven't seen.`,
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
        await traceAction(`stopped by the rule ${r.id}`);
        return { allowed: false, rule: r.id,
          say: `A standing rule stops this: ${r.text}.` };
      }
    }

    if (!committing) return { allowed: true };
    const g = run.gate();
    if (!g.allowed) {
      chrome.runtime.sendMessage({
        type: 'validationSpeak', phase: 'gate',
        lines: [{ say: g.say, level: 'stop', live: 'assertive', widget: 'gate' }],
      }).catch(() => {});
      await publish();
    }
    await traceAction(g.allowed ? 'went ahead' : 'held at the gate');
    return g;
  },

  /** Resolve a stop so the agent can continue. */
  async answer(widget, response) {
    if (!run && !(await rehydrate())) return { resolved: false };
    const r = run.answer(widget, response);
    // Answering belongs to the node the question came from, not to wherever
    // the run has drifted to by the time it is answered.
    const at = (await stored()).findings?.find((f) => f.widget === widget);
    await Trace.record({
      nodeId: at?.node ?? currentNode, label: labelFor(at?.node ?? currentNode),
      phase: at?.phase ?? currentPhase, holder,
      action: `answered: ${String(response || '').slice(0, 80)}`,
      answered: [widget],
    });
    // Answering a widget's question deals with that widget's findings too.
    // Without this the same widget kept holding the agent through the
    // unread-findings check after its question was already answered - the
    // overlay's Got-it happened to paper over it, the side panel had no way
    // out at all.
    const prev = await stored();
    let dealt = 0;
    for (const f of prev.findings || []) {
      if (f.widget === widget) { acknowledged.add(fkey(f)); dealt += 1; }
    }
    await publish();
    // A stop surfaced mid-stream is in storage but never entered the run's
    // waiting list, so run.answer() knows nothing about it - yet the
    // acknowledgement above is what actually releases the hold. Answering a
    // real stored finding is resolved, whatever the run thinks.
    const resolved = r.resolved || dealt > 0;
    // One resumption line when the last hold clears. Sighted users see the
    // suspended context sitting on screen; a screen reader user resumes into
    // silence, and the recovery cost of an interruption lives in exactly that
    // gap. Only when nothing else is waiting - resuming is one sentence, not
    // a recap.
    if (resolved) {
      const still = (await stored()).findings || [];
      const ack2 = new Set([...((await stored()).acknowledged) || [], ...acknowledged]);
      const waitingLeft = still.filter((f) => f.level === 'stop' && !f.confirming
        && !ack2.has(fkey(f))).length;
      if (!waitingLeft && currentPhase) {
        chrome.runtime.sendMessage({ type: 'validationSpeak', phase: currentPhase,
          lines: [{ say: `Going on: ${currentPhase}.`, level: 'checkpoint',
            live: 'polite', widget: 'resumed' }] }).catch(() => {});
      }
    }
    if (!r.resolved && dealt) return { resolved: true, remaining: 0 };
    return r;
  },

  /** For tests: shrink the assertive cooldown so "later" fits in a test run. */
  setSpeechCooldown(ms) { ASSERTIVE_COOLDOWN_MS = ms; lastAssertiveAt = 0; },

  /**
   * The adapt patch landed after the plan review was spoken. One polite line
   * naming what the person's own request added; without it, the retrieval
   * path never says "from your request I added" because the review fires at
   * load and the patch arrives half a minute later.
   */
  async planAddendum(a) {
    if (!a || !flatModel) return { spoken: false };
    const fromAsk = (flatModel.questions || [])
      .filter((q) => q.fromAsk === true).map((q) => q.question);
    if (!fromAsk.length) return { spoken: false };
    const say = `From your request I also check: ${fromAsk.slice(0, 3).join('; ')}.`;
    chrome.runtime.sendMessage({ type: 'validationSpeak', phase: currentPhase,
      lines: calmSpeech([{ say, level: 'checkpoint', live: 'polite', widget: 'plan' }]) })
      .catch(() => {});
    const prev = await stored();
    if (prev.planReview) {
      await publish({ planReview: { ...prev.planReview,
        fromAsk: fromAsk.slice(0, 8), adapted: true } });
    }
    return { spoken: true, added: fromAsk.length };
  },

  /**
   * Checkpoint zero: the plan, spoken once, before the run gets going.
   *
   * One polite sentence and a panel record - never a blocking form
   * (decision 15: skippable means the default is to keep moving). Says what
   * the plan is, how much will be checked, how much of that guards money,
   * and what the request itself added if the adapt call ran. Called by the
   * host when a model becomes ready; calling it again is free.
   */
  async planReview() {
    if (planReviewSpoken || !flatModel) return { spoken: false };
    planReviewSpoken = true;
    const phases = flatModel.phases || [];
    const qs = flatModel.questions || [];
    const money = qs.filter((q) => q.moneyMoving === true).length;
    const fromAsk = qs.filter((q) => q.fromAsk === true).map((q) => q.question);
    const parts = [`The plan: ${phases.join(', ')}.`,
      `I will check ${qs.length} things, ${money} of them before money moves.`];
    if (fromAsk.length) {
      parts.push(`From your request I added: ${fromAsk.slice(0, 3).join('; ')}.`);
    }
    const say = parts.join(' ');
    chrome.runtime.sendMessage({ type: 'validationSpeak', phase: null,
      lines: calmSpeech([{ say, level: 'checkpoint', live: 'polite', widget: 'plan' }]) })
      .catch(() => {});
    await publish({ planReview: { at: Date.now(), phases, questions: qs.length,
      money, fromAsk: fromAsk.slice(0, 8) } });
    return { spoken: true, phases: phases.length, questions: qs.length };
  },

  /**
   * The spoken wrap-up, when the run ends.
   *
   * The completion review is not a filing cabinet. A route of "log" means
   * "do not interrupt the run for this", never "the person does not hear it"
   * — and the end of the run is the cheapest possible moment to speak, since
   * there is nothing left to interrupt. So the run ends with: the task
   * outcome first (the completion-moment findings — did the order go
   * through, did the receipt come), then the top few kept findings the
   * person never saw, ranked by the utility model's own scores. Everything
   * else stays in the panel for the guided review.
   */
  async wrapUp(agentSummary) {
    if (!run && !(await rehydrate())) return { spoke: 0 };
    const prev = await stored();
    const ack = new Set([...(prev.acknowledged || []), ...acknowledged]);
    // Unheard: ambient findings were never spoken, and that is the whole
    // pool the review draws from. Asides were already said out loud and
    // stops were answered, so neither is news at the end.
    const unheard = (prev.findings || [])
      .filter((f) => f.level === 'ambient' && !f.confirming && !ack.has(fkey(f)));
    // Capped: a wrap-up is a summary, and ten outcome sentences stop being
    // one. Whatever does not fit is still counted into the panel line below.
    const outcome = unheard.filter((f) => f.moment === 'Completion').slice(0, 4);
    const strength = (f) => f.eu
      ? Math.max(...Object.values(f.eu).filter((x) => typeof x === 'number'))
      : (f.confidence ?? 0);
    const rest = unheard.filter((f) => f.moment !== 'Completion')
      .sort((a, b) => strength(b) - strength(a))
      .slice(0, 3);

    const lines = [];
    for (const f of [...outcome, ...rest]) {
      lines.push({ say: f.say, level: 'aside', live: 'polite', widget: f.widget });
      acknowledged.add(fkey(f));
    }
    const kept = unheard.length - lines.length;
    if (kept > 0) {
      lines.push({ say: `${kept} more thing${kept === 1 ? ' is' : 's are'} in the panel `
        + 'if you want to look back over the run.',
      level: 'aside', live: 'polite', widget: 'wrap up' });
    }
    if (lines.length) {
      chrome.runtime.sendMessage({ type: 'validationSpeak', lines, phase: 'wrap up' })
        .catch(() => {});
    }
    await Trace.record({
      nodeId: currentNode, label: currentNodeLabel, phase: currentPhase, holder,
      action: `run ended: ${String(agentSummary || 'done').slice(0, 80)}`,
    });
    await publish({ wrapUp: { at: Date.now(), spoke: lines.length,
      outcome: outcome.length, kept: Math.max(0, kept) } });
    return { spoke: lines.length, outcome: outcome.length };
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
    // Every other method that reads module state rehydrates first. Without it
    // "Change something" silently did nothing after a worker restart, which is
    // most of the time — the worker is torn down after about thirty seconds
    // idle, and reading the panel is idle.
    if (!contract) await rehydrate();
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
      unspecified: gaps(contract, aboutTask()),
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

  /**
   * One question of the person's own, against the page in front of them.
   *
   * This is the only call in the layer that answers something nobody had
   * already asked. `onRequest()` below replays findings that were computed on
   * a schedule the page set; this reads the page again for the question the
   * person actually has.
   *
   * It touches the agent in no way at all — no interject, no gate, no steer.
   * That is the whole point of it. Today the only way to ask for more is to
   * press a control, and every control sends the agent an instruction, so
   * asking a question changes what the agent does next. Wanting to know is not
   * wanting something different to happen.
   *
   * It is recorded, because a question asked and answered is part of the run,
   * but it is recorded as a question and never as a finding: a finding is
   * something the agent must wait for the person to see, and nothing the
   * person asked for should hold the agent.
   */
  async ask(question, opts = {}) {
    const q = String(question || '').trim();
    if (!q) return { ok: false, error: 'no question was asked' };
    const H = globalThis.BrowserHarness;
    if (!H?.axSnapshot) return { ok: false, question: q, answer: null,
      error: 'harness has no accessibility read',
      say: 'I could not read the page.' };

    let tabId = opts.tabId;
    if (tabId == null) {
      try {
        const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = t?.id;
      } catch { /* fall through */ }
    }
    if (tabId == null) return { ok: false, question: q, answer: null,
      error: 'no page to read', say: 'I could not find a page to read.' };

    const snap = await H.axSnapshot(tabId);
    const r = await Reasoner.askPage(q, snap.text, {
      task: flatModel?.task || null,
      ask: contract ? describe(contract) : null,
      url: snap.url || null,
      ...(opts.reasoner || {}),
    });

    // Recorded next to the run rather than merged into it. `asked` is read by
    // the panel; nothing in the gate looks at it.
    if (run || contract) {
      const prev = await stored();
      await publish({ asked: (prev.asked || []).concat({
        question: q, answer: r.answer, quote: r.quote, say: r.say,
        confidence: r.confidence, verified: r.verified,
        from: snap.url || null, at: Date.now(),
      }).slice(-ASKED_LIMIT) });
    }
    return { ...r, url: snap.url || null, tabId };
  },

  /**
   * The person takes this part themselves.
   *
   * The agent is PAUSED, not stopped: this is a part of the task the person is
   * doing, not the end of the task, and it has to be able to come back. Pausing
   * also means it burns no steps while it waits, which stopping at the gate
   * would not — a gate-held agent keeps looping and re-perceiving.
   */
  async handOver(o = {}) {
    if (!run && !(await rehydrate())) {
      return { handedOver: false, why: 'no task is being checked' };
    }
    if (holder === 'person') {
      return { handedOver: true, watching: !!watchTimer, nodeId: handOverNode,
               why: 'you already have it' };
    }
    const node = o.nodeId ?? currentNode ?? null;
    const label = labelFor(node);
    holder = 'person';
    handOverNode = node;
    handOverAt = Date.now();
    handOverTab = o.tabId ?? await activeTabId();

    let paused = null;
    try {
      paused = globalThis.BrowserAgent?.pause?.({
        reason: o.reason || `handed over${label ? `: ${label}` : ''}`,
        byNode: node,
      });
    } catch { /* no agent loaded: the gate below is still the real stop */ }

    await Trace.record({ nodeId: node, label, phase: currentPhase, holder: 'person',
      action: `handed over${o.reason ? `: ${o.reason}` : ''}` });
    await publish();
    startWatching(handOverTab);

    chrome.runtime.sendMessage({ type: 'validationSpeak', phase: 'control',
      lines: [{ say: `You have this part${label ? `: ${label}` : ''}. `
        + 'I am watching the page and I will not touch anything until you hand it back.',
        level: 'aside', live: 'polite', widget: 'hand over' }] }).catch(() => {});

    return { handedOver: true, watching: true, nodeId: node, label,
             atStep: paused?.atStep ?? null, paused: paused?.paused === true,
             why: paused?.paused === true ? undefined
               : 'the agent was not running, so there was nothing to pause' };
  },

  /**
   * The person gives it back.
   *
   * What changed while the agent was out is built from the trace, not from the
   * agent's own memory. The agent was not there — its memory of this stretch is
   * of a page it never saw — so the only honest account is the record of what
   * the layer read while the person was driving.
   *
   * The account reaches the agent BEFORE the pause is released, which is the
   * same order every other answer in this layer uses: releasing first lets it
   * act on the old page while the news is still in flight.
   */
  async handBack(o = {}) {
    // Every other method that reads module state rehydrates first; this one
    // did not. A worker torn down during a hand over — which is the normal
    // case, since doing a step by hand navigates nothing — came back with
    // holder defaulted to 'agent', so "Give it back" returned early and did
    // nothing, forever, while both surfaces kept showing the button.
    if (!run) await rehydrate();
    if (holder !== 'person') return { resumed: false, why: 'the agent already has it' };
    const since = handOverAt || 0;
    const node = o.nodeId ?? handOverNode;
    const label = labelFor(node);
    stopWatching();

    // One more read, of the page as the person is leaving it. Handing back
    // re-perceives; this is that, on the layer's side.
    const tabId = o.tabId ?? handOverTab ?? await activeTabId();
    if (tabId != null) {
      try { await Validation.observe(tabId); } catch { /* the read is best effort */ }
    }

    const seen = new Set();
    const changedWhileOut = [];
    for (const e of await Trace.since(since)) {
      for (const f of e.findings || []) {
        if (seen.has(f.widget)) continue;
        seen.add(f.widget);
        changedWhileOut.push(f.widget);
      }
    }

    holder = 'agent';
    handOverNode = null;
    handOverAt = null;
    handOverTab = null;
    await Trace.record({ nodeId: node, label, phase: currentPhase, holder: 'agent',
      action: `handed back${changedWhileOut.length
        ? `, ${changedWhileOut.length} thing${changedWhileOut.length === 1 ? '' : 's'} read while out`
        : ', nothing read while out'}` });
    // The wait starts now. Whatever was unread when they took the wheel, they
    // were not ignoring it while they were driving, so the clock measures the
    // silence that begins here rather than the time they spent working.
    const prevHold = (await stored()).hold;
    await publish(prevHold
      ? { hold: { ...prevHold, since: Date.now(), reminded: null, stopped: null } }
      : {});

    const say = changedWhileOut.length
      ? `You are back. The person did ${label || 'that part'} themselves. `
        + `What the page said while you were out: ${changedWhileOut.join('; ')}. `
        + 'Read the page again before you act, and do not redo what they just did.'
      : `You are back. The person did ${label || 'that part'} themselves and nothing `
        + 'new was read off the page while you were out. Read the page again before '
        + 'you act, and do not redo what they just did.';
    try { globalThis.BrowserAgent?.interject?.(say); } catch {}
    // Checked, not fired and forgotten. resume() returns {resumed:false} when
    // no run is in progress — which is what a loop that died with the service
    // worker looks like — and the discarded result meant the person was told
    // the agent was back while it never moved again.
    let back = null;
    try { back = globalThis.BrowserAgent?.resume?.({ rePerceive: true }); } catch {}
    const resumed = back?.resumed !== false;

    return { resumed, nodeId: node, label, changedWhileOut, since, said: say,
      why: resumed ? undefined
        : 'the agent is not running any more, so there was nothing to hand back to' };
  },

  /**
   * Watch a value instead of deciding about it now.
   *
   * The press carries the node and the question; the value it rests on is the
   * finding's own quote, which becomes the anchor of the one question this
   * watch will put to every later page. See watch.js for why that question is
   * frozen here rather than rebuilt on each read.
   *
   * Nothing is sent to the agent. Pressing "Watch it for me" is not an
   * instruction to do something differently now — it is the opposite, a way of
   * not deciding — and the sentence it used to send was a re-read of the page
   * already in front of the person.
   */
  async watch(o = {}) {
    const prev = await stored();
    const f = (prev.findings || []).find((x) =>
      (o.widget && x.widget === o.widget)
      || (o.nodeId != null && x.node === o.nodeId && x.cluster === 'watch'));

    const node = o.nodeId ?? f?.node ?? currentNode ?? null;
    const widget = o.widget ?? f?.widget ?? null;
    const label = labelFor(node) || f?.phase || currentPhase || null;
    const quote = o.quote ?? f?.from ?? null;

    const H = globalThis.BrowserHarness;
    const tabId = o.tabId ?? await activeTabId();
    let snap = o.snap || null;
    if (!snap && H?.axSnapshot && tabId != null) {
      try { snap = await H.axSnapshot(tabId); } catch { snap = null; }
    }
    const url = o.url ?? snap?.url ?? null;
    const question = Watch.questionFor({ quote, widget, label });

    // The baseline is read with the SAME call every later reading uses, on the
    // page the person is looking at. One model call, spent deliberately: a
    // baseline taken from the finding instead would have been produced by a
    // different prompt, and then the first re-read would report the model's
    // change of wording as a change in the value.
    //
    // A page that cannot answer its own watch question still gets a watch. It
    // stands with no baseline, and the first page that can read the value sets
    // it — which is honest, where reporting a move against nothing would not be.
    let baseline = null;
    if (snap) {
      const r = await Reasoner.askPage(question, snap.text,
        { task: flatModel?.task || null, ask: null });
      if (r.ok && r.answer != null) {
        baseline = { answer: r.answer, quote: r.quote, at: Date.now(), url };
      }
    }

    const added = await Watch.add({
      node, label, widget, question, baseline, url,
      origin: Watch.originOf(url),
      // The page this watch has already seen. Without it the very next settle
      // on the same page pays for a second call to be told nothing changed.
      seenHash: snap ? hashText(snap.text) : null,
      task: flatModel?.task || (contract ? describe(contract) : null),
    });

    if (!added.added) {
      const say = `I am not watching that: ${added.why}.`;
      chrome.runtime.sendMessage({ type: 'validationSpeak', phase: 'watch',
        lines: [{ say, level: 'aside', live: 'polite', widget: 'watch' }] }).catch(() => {});
      return { watching: false, why: added.why, say };
    }

    await Trace.record({ nodeId: node, label, phase: currentPhase, holder,
      action: `started watching${label ? `: ${label}` : ''}`, url });

    // What it costs and what it cannot do, said once, at the moment it is set.
    const value = baseline ? ` It is ${baseline.answer} right now.` : '';
    const say = `I am watching ${label || widget || 'that'}.${value} I will tell you `
      + 'when it moves, each time you are on this site. I am not checking it in the '
      + 'background, so I cannot tell you about a change you never open the page for.';
    chrome.runtime.sendMessage({ type: 'validationSpeak', phase: 'watch',
      lines: [{ say, level: 'aside', live: 'polite', widget: 'watch' }] }).catch(() => {});

    const standing = await Watch.live();
    await publish({ watching: standing.length });
    return { watching: true, id: added.watch.id, node, label, question,
             baseline, replaced: added.replaced, say };
  },

  /** Stop watching. By id, or by whatever was being watched at this node. */
  async unwatch(o = {}) {
    const arg = typeof o === 'string' ? { id: o } : (o || {});
    let id = arg.id || arg.watchId || null;
    const standing = await Watch.live();
    if (!id) {
      const m = standing.find((w) =>
        (arg.widget && w.widget === arg.widget)
        || (arg.nodeId != null && w.node === arg.nodeId));
      id = m?.id || null;
    }
    if (!id) return { stopped: false, why: 'nothing was being watched here' };
    const w = standing.find((x) => x.id === id) || null;
    const r = await Watch.remove(id);
    if (!r.stopped) return { stopped: false, why: 'that watch had already ended' };
    await Trace.record({ nodeId: w?.node ?? null, label: w?.label ?? null,
      phase: currentPhase, holder,
      action: `stopped watching${w?.label ? `: ${w.label}` : ''}` });
    const say = `I have stopped watching ${w?.label || w?.widget || 'that'}.`;
    chrome.runtime.sendMessage({ type: 'validationSpeak', phase: 'watch',
      lines: [{ say, level: 'aside', live: 'polite', widget: 'watch' }] }).catch(() => {});
    await publish({ watching: (await Watch.live()).length });
    return { stopped: true, id, say };
  },

  /** What is being watched, and what each one last read. */
  watches: () => Watch.live(),

  /** One look at every live watch, for the caller that drives the settle. */
  checkWatches,

  /**
   * What a widget press should tell the agent, built from the task model's own
   * question rather than from a global table of shopping sentences.
   *
   * Null means "nothing better than the fallback", and the caller falls back to
   * the map in background.js. Two ways to get null, both deliberate: no task
   * model is loaded, which is the Amazon corpus path and must keep the shipped
   * demo unchanged, or the finding carries no interface type to build from.
   */
  async instructionFor(control = {}) {
    if (!flatModel) return null;
    const node = control.node ?? null;
    // The injection window. An instruction about a phase the run has already
    // moved past does not steer anything - the dependent actions are done -
    // and measured on long-horizon agents, a late injected answer can land
    // BELOW never answering at all: the agent reconciles stale guidance
    // against work it has already finished and sometimes redoes it. So an
    // answer whose phase is behind the run routes to the completion review
    // instead of into the agent. Same phase or a future one injects fine -
    // answering early is how constraints want to arrive.
    if (node != null && currentNode != null && srcModel?.tree?.children) {
      const order = srcModel.tree.children.map((c) => String(c.id));
      const topOf = (id) => String(id).split('.')[0];
      const at = order.indexOf(topOf(node));
      const now = order.indexOf(topOf(currentNode));
      if (at >= 0 && now >= 0 && at < now) {
        return { stale: true, node, phase: flatModel.phases[at] || null,
          say: `That part (${labelFor(node) || 'it'}) is already behind the run. `
             + 'I kept your answer for the review instead of steering the agent with it.' };
      }
    }
    let cluster = control.cluster || null;
    let question = control.widget || null;
    if (!cluster || !question) {
      const prev = await stored();
      const f = (prev.findings || []).find((x) =>
        (control.widget && x.widget === control.widget)
        || (node != null && x.node === node && x.control?.action === control.action));
      cluster = cluster || f?.cluster || null;
      question = question || f?.widget || null;
    }
    return Reasoner.instructionFrom({ cluster, question, label: labelFor(node) });
  },

  /**
   * Who is acting on the page.
   *
   * This matters more than it looks. Two things acting on one page with no
   * shared record of which one is acting is how the failure already in the code
   * comments happened: in a recorded run the agent spent ten steps trying to
   * dismiss its own supervisor overlay, and pressed the person's "Got it"
   * button. Marking the overlay `data-bh-ignore` fixed that one case; this is
   * the general answer to the same question.
   */
  status: () => ({
    holder,
    // Which tab the hand over is for, so a closed tab can end it.
    tabId: handOverTab,
    nodeId: handOverNode ?? currentNode ?? null,
    label: labelFor(handOverNode ?? currentNode),
    phase: currentPhase,
    since: handOverAt,
    watching: !!watchTimer,
  }),

  /** One look at the page, for the caller that drives the watch itself. */
  watchOnce,

  /**
   * The trace, keyed to task model nodes.
   *
   * `at(nodeId)` is what makes "go back to where the size was chosen" a lookup.
   * `why(ref)` reads it and calls no model at all.
   *
   * Reading only. Going back through this re-opens a decision; it does not
   * undo anything that has already happened on the site — see trace.js and
   * API.md section 5 on why those two must not look the same.
   */
  trace: {
    all: Trace.all,
    at: Trace.at,
    since: Trace.since,
    last: Trace.last,
    why: Trace.why,
  },

  /**
   * What was happening at a node, or at a step. No model call.
   *
   * Publishes as well as returning. `Trace.why` shipped complete, with its own
   * tests and a route, and nothing rendered it - the same shape of bug as
   * `ask()`, where the capability was finished and unreachable. A lookup no
   * surface can show is not a lookup.
   */
  async why(ref = {}) {
    const answer = await Trace.why(ref);
    try { await publish({ lookedBack: answer }); } catch { /* the answer still returns */ }
    return answer;
  },

  /** Where the run is, as the reasoner last read it off the page. */
  where: () => ({ node: currentNode, label: currentNodeLabel, phase: currentPhase }),

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

// The three ways the person gets back in, under the names the design uses.
// Everything here is already a method on Validation; these exist so the code
// can be read against API.md without a translation step, and so a surface can
// take one mode without taking the whole session object.
//
//   interrupt    holds or stops the agent
//   interrogate  answers a question and does not touch the agent
//   control      the agent stops acting, keeps watching, then resumes
//
// Interrogate not touching the agent is the one that matters. Most of the time
// the person wants more information, not different behaviour, and every other
// control in this extension steers.
globalThis.ValidationInterrupt = {
  pause: (o) => globalThis.BrowserAgent?.pause?.(o),
  resume: (o) => globalThis.BrowserAgent?.resume?.(o),
  stop: (reason) => globalThis.BrowserAgent?.stop?.(reason),
  holdClock,
};
globalThis.ValidationInterrogate = {
  ask: (q, o) => Validation.ask(q, o),
  why: (ref) => Validation.why(ref),
};
globalThis.ValidationControl = {
  handOver: (o) => Validation.handOver(o),
  handBack: (o) => Validation.handBack(o),
  status: () => Validation.status(),
};
globalThis.ValidationTrace = Validation.trace;

// Watched values. `any()` is the cheap question the navigation trigger asks
// before deciding whether a settle is worth reading at all — a watch outlives
// its run, so "is a task running" is no longer the whole answer.
globalThis.ValidationWatch = {
  set: (o) => Validation.watch(o),
  stop: (o) => Validation.unwatch(o),
  list: () => Validation.watches(),
  check: (snap) => checkWatches(snap),
  any: () => Watch.any(),
  setTiming: (o) => Watch.setWatchTiming(o),
};

// Reading a real count off a real page instead of asking the model to guess
// one. background.js owns the tabs; this owns the two things that used to be
// Amazon-shaped — how a search is written in a URL, and how a total is stated.
globalThis.ValidationProbe = Probe;
// Writes the task model from the person's query at run start. Without it the
// layer checks whatever task the shipped file happened to be built for.
globalThis.ValidationGenerate = Generate;

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
    if (!model) { flatModel = null; srcModel = null; modelSource = null; return { loaded: false }; }
    flatModel = Reasoner.flattenModel(model);
    // Kept, not just flattened. A question found by looking at a page has to go
    // back onto the model itself or it is asked once and forgotten, which is
    // what the open noticing pass has always done.
    srcModel = model;
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
  unload() { flatModel = null; srcModel = null; modelSource = null; return { loaded: false }; },
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
