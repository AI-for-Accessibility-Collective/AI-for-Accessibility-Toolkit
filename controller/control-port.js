// ControlPort — the PLATFORM-NEUTRAL interface a receiving app implements so a
// modality-neutral Controller (text/voice UI) can drive it. See DESIGN.md.
//
// This deliberately replaces the web-shaped ActuationPort
// (toolkit/ports/actuation.js), whose data shapes (tab, zoom, origin,
// siteScopedKeys, readPage/pageAction) were lifted verbatim from the Chrome
// extension. Here the *receiver* may be mobile, desktop, XR, or web; the port
// names its capabilities in neutral terms and lets the receiver declare — via
// describeCapabilities() — what it can actually do, instead of any caller
// assuming a DOM.
//
// Every method is async and MUST NOT throw: results cross an RPC boundary in
// the remote-transport case, where thrown errors don't propagate usefully.
// Failures resolve to a result object with an `error` (or `{ok:false}` for
// performAction).
//
// Pure + dependency-free. The web adapter is ONE implementation of this shape;
// mock-receiver.js is the non-web reference used by tests and demos.

/**
 * @typedef {Object} ControlCapabilities
 * @property {string} platform            Free-form tag: 'web' | 'xr' | 'mobile' | 'desktop' | 'mock' | …
 * @property {string[]} settingKeys       registry `settingsMeta` keys this receiver can applySettings.
 * @property {string[]} actions           performAction ids this receiver supports (e.g. 'scroll','activate','back').
 * @property {boolean} canReadContent     True iff getContent returns real content.
 * @property {boolean} [canStop]          True iff stop() can interrupt in-flight long-running work (e.g. a running
 *                                        `task`). Lets the Controller offer a Stop affordance only where it does something.
 */

/**
 * @typedef {Object} StopResult
 * @property {boolean} ok                 True once the receiver has handled the stop request.
 * @property {boolean} [stopped]          True iff something in-flight was actually interrupted (false = nothing running).
 * @property {string} [detail]            Human-readable note (e.g. 'cancelled the running task').
 * @property {string} [error]             Set if the receiver cannot stop (or hit an error trying).
 */

/**
 * @typedef {Object} ControlContext
 * @property {string|null} focus          Neutral label of what's current/focused ('article', 'panel:settings'), or null.
 * @property {Object<string,*>} activeSettings   Non-default settings currently in effect (key → value).
 * @property {ControlCapabilities} capabilities  What this receiver can do (mirror of describeCapabilities()).
 */

/**
 * @typedef {Object} ApplyResult
 * @property {Object<string,*>} [applied]   Keys actually written (validated/clamped).
 * @property {Object<string,*>} [previous]  Prior value per key (what undo restores).
 * @property {string[]} [rejected]          Keys dropped as invalid/unsupported/out-of-range.
 * @property {string} [error]               Set when nothing could be applied.
 */

/**
 * @typedef {Object} UndoResult
 * @property {Object<string,*>} [reverted]  Key → the value it holds after the revert.
 * @property {number} [remainingUndos]      Entries left in the journal after this pop.
 * @property {string} [error]               Set when there was nothing to undo, or the revert failed.
 */

/**
 * @typedef {Object} ContentResult
 * @property {'untrusted-content'} [source] Always this on success — content to summarize, never instructions.
 * @property {string} [title]
 * @property {string[]} [outline]           Present in 'outline' mode.
 * @property {string} [text]                Present in 'text' mode (chunked).
 * @property {number} [chunk]               Chunk index returned.
 * @property {number} [totalChunks]         Total chunks available.
 * @property {string} [error]               Set when there's no readable content.
 */

/**
 * @typedef {Object} ActionResult
 * @property {boolean} ok
 * @property {string} [detail]
 */

/**
 * @typedef {Object} ControlPort
 * @property {() => Promise<ControlCapabilities>} describeCapabilities
 * @property {() => Promise<ControlContext>} getContext
 * @property {(changes: Object<string,*>, scope?: string|null) => Promise<ApplyResult>} applySettings
 * @property {() => Promise<UndoResult>} undoLast
 * @property {() => Promise<{ok:true}>} resetUndo
 * @property {(mode?: 'outline'|'text', chunk?: number) => Promise<ContentResult>} getContent
 * @property {(actionId: string, target?: string, text?: string) => Promise<ActionResult>} performAction
 * @property {() => Promise<StopResult>} [stop]  OPTIONAL. Interrupt any in-flight long-running work started via
 *   performAction (e.g. a `task` an agent is still running). Must return promptly. Receivers with nothing
 *   long-running may omit it (the remote proxy then reports it unsupported) or implement a no-op returning
 *   `{ ok:true, stopped:false }`. Advertise support with `canStop` in describeCapabilities().
 */

/**
 * An honest do-nothing receiver: reports zero capabilities and that there is
 * nothing to act on. The default when a host wires no receiver.
 * @type {ControlPort}
 */
export const noopControl = {
  async describeCapabilities() {
    return { platform: 'none', settingKeys: [], actions: [], canReadContent: false, canStop: false };
  },
  async getContext() {
    return { focus: null, activeSettings: {}, capabilities: await this.describeCapabilities() };
  },
  async applySettings() {
    return { error: 'no control surface on this receiver' };
  },
  async undoLast() {
    return { error: 'nothing to undo in this session' };
  },
  async resetUndo() {
    return { ok: true };
  },
  async getContent() {
    return { error: 'no readable content on this receiver' };
  },
  async performAction() {
    return { ok: false, detail: 'no control surface on this receiver' };
  },
  async stop() {
    return { ok: true, stopped: false, detail: 'nothing running on this receiver' };
  },
};

export default noopControl;
