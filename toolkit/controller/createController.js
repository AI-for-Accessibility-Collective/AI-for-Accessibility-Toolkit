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
 */
export function createController({ control = noopControl, llm = null, operator = null } = {}) {
  const router = createRouter({ control, llm });
  let presentation = deriveControllerPresentation((operator && operator.abilityModel) || {});

  return {
    control,
    router,
    /** The current self-presentation spec (input/output modality, verbosity, …). */
    get presentation() { return presentation; },
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
    /** Resolve an utterance to an Intent without acting (introspection/preview). */
    resolve: (utterance) => router.resolve(utterance),
    /** Resolve AND act. Returns a normalized `{ ok, intent, say, data }` result. */
    async handle(utterance) {
      const intent = await router.resolve(utterance);
      return router.dispatch(intent);
    },
  };
}

export default createController;
