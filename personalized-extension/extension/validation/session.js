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

async function publish(extra = {}) {
  const s = run ? run.summary() : { steps: [], said: [], spokenWords: 0, waiting: 0 };
  const gate = run ? run.gate() : { allowed: true };
  await chrome.storage.local.set({
    [KEY]: { contract, ...s, gate, updated: Date.now(), ...extra },
  });
}

const Validation = {
  /** Begin a task. `contract` is what the person asked for. */
  async start(c, opts = {}) {
    contract = c;
    run = createRun(c, opts);
    await publish({ findings: [] });
    return { started: true };
  },

  async stop() {
    run = null;
    await publish();
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

    const { findings } = run.observe(snap.text, phase);

    // Only what is meant to be heard. Ambient findings stay reachable on
    // request rather than being announced.
    const speak = findings
      .filter((f) => f.spoken?.speak)
      .map((f) => ({ say: f.spoken.speak, level: f.level, live: f.spoken.live,
                     widget: f.finding.widget }));

    const marks = findings
      .filter((f) => f.visual && f.level !== 'ambient')
      .map((f) => ({ ...f.visual, level: f.level, widget: f.finding.widget }));

    await publish({ findings: findings.map((f) => ({
      widget: f.finding.widget, level: f.level, say: f.finding.say,
      confirming: !!f.finding.confirming, control: f.visual?.control || null,
      phase,
    })) });

    // The voice engine listens for this; the panel reads storage.
    if (speak.length) {
      chrome.runtime.sendMessage({ type: 'validationSpeak', lines: speak, phase })
        .catch(() => {});   // nothing listening is fine — storage still has it
    }
    return { phase, findings: findings.length, speak, marks, url: snap.url };
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
export default Validation;
