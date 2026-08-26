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

/**
 * @param {Object} opts
 * @param {import('./control-port.js').ControlPort} [opts.control]  Receiving app (default: honest noop).
 * @param {{resolve:Function}} [opts.llm]                           Optional NL lane.
 */
export function createController({ control = noopControl, llm = null } = {}) {
  const router = createRouter({ control, llm });

  return {
    control,
    router,
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
