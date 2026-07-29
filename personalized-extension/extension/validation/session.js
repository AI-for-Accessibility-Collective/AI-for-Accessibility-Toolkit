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

import { createRun } from './run.js';
import { contractFromAsk, gaps, describe, toQuery } from './ask.js';

const KEY = 'aa.validation';

// Which phase a URL belongs to. The agent does not announce its phase, and
// asking it to would mean trusting its account of where it is.
function phaseOf(url) {
  const u = String(url || '');
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
const COMMITTING = /add[- ]?to[- ]?cart|proceed to checkout|place your order|buy now/i;

let run = null;
let contract = null;

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

async function stored() {
  const r = await chrome.storage.local.get(KEY);
  return r[KEY] || {};
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
  const s = run ? run.summary() : { steps: [], said: [], spokenWords: 0, waiting: 0 };
  const gate = run ? run.gate() : { allowed: true };
  await chrome.storage.local.set({
    [KEY]: {
      // Keep whatever was already recorded unless this call replaces it.
      // Appending must not re-add what is already recorded. A page can be read
      // more than once -- the navigation trigger and an explicit call both fire
      // on the same page -- and without this the panel shows every finding
      // twice, which reads as two separate problems.
      findings: extra.findings || mergeFindings(prev.findings || [], extra.append || []),
      contract: contract || prev.contract || null,
      ...s, gate, updated: Date.now(),
      ...(({ append, ...rest }) => rest)(extra),
    },
  });
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
    run = createRun(contract, opts);
    await publish({ findings: [], unspecified: gaps(contract) });
    return { started: true, contract, unspecified: gaps(contract) };
  },

  /**
   * What the person did not say, and what stays unchecked because of it.
   * The panel turns these into questions; nothing is guessed to fill them.
   */
  unspecified: () => (contract ? gaps(contract) : []),

  async stop() {
    run = null;
    await publish({ findings: [] });
  },

  isRunning: () => !!run,

  /**
   * Read the page the agent is on and check it.
   *
   * The snapshot comes from the harness's own accessibility read, which is the
   * same tree a screen reader walks — so nothing can be reported that the
   * person could not have reached themselves.
   */
  async observe(tabId, opts = {}) {
    if (!run) return { skipped: 'no validation run in progress' };
    const H = globalThis.BrowserHarness;
    if (!H?.axSnapshot) return { error: 'harness has no accessibility read' };

    const snap = await H.axSnapshot(tabId);
    const phase = opts.phase || phaseOf(snap.url);
    if (!phase) return { skipped: `no phase matches ${snap.url || 'this page'}` };

    // Named `rendered`, not `findings`: destructuring into `findings` would
    // shadow the module-level accumulator this function is meant to append to.
    const { findings: rendered } = run.observe(snap.text, phase);

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
    await publish({ append: rendered.map((f) => ({
      widget: f.finding.widget, level: f.level, say: f.finding.say,
      from: f.finding.from, confirming: !!f.finding.confirming,
      control: f.visual?.control || null, phase,
    })) });

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
  async allow(actionDescription) {
    if (!run) return { allowed: true };
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
    if (!run) return { resolved: false };
    const r = run.answer(widget, response);
    await publish();
    return r;
  },

  /** Findings that were never announced, for when someone asks. */
  onRequest: () => (run ? run.onRequest() : []),

  /** Extractors that could not read something. Never spoken. */
  gaps: () => (run ? run.gaps() : []),

  summary: () => (run ? run.summary() : null),
  phaseOf,
};

globalThis.Validation = Validation;

// Exposed separately so the agent's start route can parse a sentence into a
// contract before a run exists.
globalThis.ValidationAsk = { contractFromAsk, gaps, describe, toQuery };

export default Validation;
