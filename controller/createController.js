// createController — the Controller entry point. M0 is HEADLESS: it wires the
// intent router to a ControlPort and exposes `handle(utterance)`. The web UI,
// the operator-driven presentation, mounts, and the remote transport are later
// milestones (see DESIGN.md) — they all sit above this and never touch the port
// directly.
//
//   const c = createController({ control, llm });
//   const res = await c.handle('bigger text');   // → { ok, intent, say, data }
//
// `control` is any ControlPort (in-process object today; a remote proxy later).
// `llm` is the optional NL lane; omit for deterministic-only.

import { noopControl } from './control-port.js';
import { createRouter } from './router.js';
import { deriveControllerPresentation } from './presentation.js';

/**
 * @param {Object} opts
 * @param {import('./control-port.js').ControlPort} [opts.control]  Receiving app (default: honest noop).
 * @param {{resolve:Function}} [opts.llm]                           Optional NL lane.
 * @param {{abilityModel?:object, librarian?:{getAbilityModel:Function}}} [opts.operator]
 *   Who is operating the Controller — drives how the Controller presents ITSELF
 *   (see presentation.js / M1). Pass `abilityModel` directly, or a `librarian`
 *   to fetch it via `loadPresentation()`. Omit for the default presentation.
 * @param {boolean} [opts.rawToTask]  When the Controller is driving a URL (a
 *   task-capable remote app), send ALL input straight through as a `task` and
 *   skip the local settings grammar. Default false (grammar first, task fallback).
 */
// State-changing commands that are worth a confirmation step when the operator's
// profile asks for it (motor/cognitive → presentation.confirmActions). Benign
// navigation (scroll/back/forward) never needs confirming.
const CONFIRMABLE_ACTIONS = new Set(['activate', 'submit', 'navigate']);
// Whole-utterance matches: "okay now make the text bigger" is a new request
// that happens to start with a yes-word, not a yes.
const AFFIRM = /^(yes|yeah|yep|yup|confirm|do it|ok|okay|sure|go ahead|please do|yes please|okay do it|ok do it)[.!]?$/;
const DENY = /^(no|nope|cancel|stop|never ?mind|don'?t|no thanks|cancel that|stop that)[.!]?$/;

export function createController({ control = noopControl, llm = null, operator = null, rawToTask = false } = {}) {
  const router = createRouter({ control, llm, rawToTask });
  let presentation = deriveControllerPresentation((operator && operator.abilityModel) || {});
  let pending = null; // an Intent awaiting yes/no confirmation

  function needsConfirm(intent) {
    return intent.type === 'command' && CONFIRMABLE_ACTIONS.has(intent.action) && presentation.confirmActions;
  }

  return {
    control,
    router,
    /** The current self-presentation spec (input/output modality, verbosity, …). */
    get presentation() { return presentation; },
    /** True while a command is awaiting a yes/no confirmation. */
    get awaitingConfirmation() { return !!pending; },
    /** Recompute the presentation from a fresh AbilityModel (e.g. after re-onboarding). */
    refreshPresentation(model) { presentation = deriveControllerPresentation(model || {}); return presentation; },
    /** Fetch the operator's AbilityModel via the wired librarian and recompute. */
    async loadPresentation() {
      const lib = operator && operator.librarian;
      if (lib && typeof lib.getAbilityModel === 'function') {
        presentation = deriveControllerPresentation((await lib.getAbilityModel()) || {});
      }
      return presentation;
    },
    /** Interrupt any in-flight long-running work on the receiver (e.g. a running
     *  `task`). Returns the receiver's StopResult, or a graceful result when the
     *  receiver implements no stop(). Safe to call any time. */
    async stop() {
      const fn = control && control.stop;
      if (typeof fn !== 'function') return { ok: true, stopped: false, detail: 'receiver has no stop' };
      try { return await control.stop(); } catch (e) { return { ok: false, error: (e && e.message) || 'stop failed' }; }
    },
    /** Resolve an utterance to an Intent without acting (introspection/preview). */
    resolve: (utterance) => router.resolve(utterance),
    /** Resolve AND act. Returns a normalized `{ ok, intent, say, data }` result.
     *  When a confirmation is pending, a "yes"/"no" resolves it; any other input
     *  abandons the pending action and is handled fresh. */
    async handle(utterance, opts = {}) {
      const u = String(utterance == null ? '' : utterance).trim();
      if (pending) {
        const lower = u.toLowerCase();
        if (AFFIRM.test(lower)) { const p = pending; pending = null; return router.dispatch(p.intent, p.opts); }
        if (DENY.test(lower)) { pending = null; return { ok: true, intent: { type: 'cancel' }, say: 'Okay, cancelled.', data: null }; }
        pending = null; // neither yes nor no — drop it and treat as a new request
      }
      const intent = await router.resolve(u);
      if (needsConfirm(intent)) {
        pending = { intent, opts };
        return { ok: true, pending: true, intent, say: `${intent.say || 'Do that'}? Say yes to confirm.`, data: null };
      }
      return router.dispatch(intent, opts);
    },
  };
}

export default createController;
