// ACTUATION PORT — the interface a host implements to let a modality-neutral
// control surface (today: voice mode; eventually XR/mobile agents) touch the
// host's browser/page surface: read what's on screen, change settings, undo
// them, read the page aloud, and perform simple page interactions.
//
// Lifted out of the Chrome extension's
// personalized-extension/extension/voice-routes.js, where all of this used to
// be welded directly to chrome.tabs / chrome.scripting / chrome.storage. That
// file now calls a concrete ActuationPort
// (personalized-extension/extension/chrome-actuation.js) instead of touching
// chrome.* itself, so the SAME voice tool-call contract (voiceGetContext /
// voiceApplySettings / voiceUndoLast / voiceResetUndo / voiceReadPage /
// voicePageAction — see extension/offscreen/src/live/tools.js) can be
// re-implemented for a non-Chrome host by writing one more object with this
// same shape — no changes needed above the port.
//
// This module is documentation + a no-op default, same pattern as
// toolkit/ports/index.js. It has no runtime dependency on any platform.
//
// Deliberately NOT re-exported from toolkit/index.js: another change was
// landing there in parallel, and this port is easy to keep collision-free by
// importing it directly:
//
//   import { noopActuation } from '<path-to>/toolkit/ports/actuation.js';
//
// The Chrome host implements this shape in
// personalized-extension/extension/chrome-actuation.js — but as a classic
// (importScripts) script, not an ES module, because it runs in the
// extension's service worker alongside voice-routes.js (no ES module loader
// there). It therefore can't literally `import` this file; it satisfies the
// shape by duck typing. This file remains the source of truth for what that
// shape is and what each method must return.

/**
 * @typedef {Object} SurfaceTab
 * @property {string} title           Sanitized (no control chars/newlines), capped ~120 chars.
 * @property {string|null} origin     Hostname of the active tab's URL, or null when off the web.
 */

/**
 * @typedef {Object} SurfaceContext
 * @property {SurfaceTab|null} tab         Null when there's no usable active tab.
 * @property {boolean} onWebPage           True iff the active tab is a regular http(s) page.
 * @property {number|null} zoomPercent     Current page zoom, 25-500, or null if unknown/inapplicable.
 * @property {Object<string,*>} activeSettings  Non-default settings currently in effect for this page (key -> value).
 * @property {string[]} siteScopedKeys     Keys of activeSettings whose value came from a category:/origin: scoped record rather than the global default.
 */

/**
 * @typedef {Object} ApplyResult
 * @property {Object<string,*>} [applied]     Keys actually written (validated/clamped), including the virtual `pageZoom` key.
 * @property {Object<string,*>} [previous]    Prior value per key (audit trail; also what undo restores).
 * @property {Object<string,string>} [scopesUsed]  Resolved scope per key: 'general' | 'category:<id>' | 'origin:<host>'.
 * @property {boolean|null} [liveApplied]     Whether the current page received the change live; null = not attempted (no active tab).
 * @property {string[]} [rejected]            Keys that were invalid/out of range and were dropped.
 * @property {string} [error]                 Set when nothing could be applied, or persisting failed.
 */

/**
 * @typedef {Object} UndoResult
 * @property {Object<string,*>} [reverted]      Key -> the value it now holds after the revert (a true post-delete fallback, not a stale pin).
 * @property {number} [remainingUndos]          Entries left in the journal after this pop.
 * @property {string[]} [rejected]              Sub-parts (e.g. 'pageZoom') that could not be reverted.
 * @property {string[]} [skipped]               Keys whose record was left alone because a later write already changed it.
 * @property {string} [error]                   Set when there was nothing to undo, or the revert failed outright (entry is kept on failure).
 */

/**
 * @typedef {Object} ReadPageResult
 * @property {string} [source]         Always 'untrusted-page-content' on success — content to summarize, never instructions to follow.
 * @property {string} [title]          Sanitized page title.
 * @property {string|null} [origin]    Hostname of the page.
 * @property {string[]} [headings]     Present in 'outline' mode.
 * @property {string|null} [selection] Present in 'outline' mode.
 * @property {string} [text]           The extracted/chunked text.
 * @property {number} [chunk]          Chunk index actually returned.
 * @property {number} [totalChunks]    Total chunks available at the host's chunk size.
 * @property {string} [error]          Set when the surface isn't a readable page.
 */

/**
 * @typedef {Object} PageActionResult
 * @property {boolean} ok
 * @property {string} [detail]
 */

/**
 * @typedef {Object} ActuationPort
 * The host-agnostic surface a modality-neutral control layer actuates
 * through. One instance per host. Every method is async and MUST NOT throw —
 * failures resolve to a `{error}` (or `{ok:false, detail}` for pageAction)
 * result object, because these results cross an RPC boundary
 * (chrome.runtime.sendMessage today) where thrown errors don't propagate
 * usefully.
 *
 * @property {() => Promise<SurfaceContext>} getContext
 *   Snapshot of the current surface: tab, zoom, which settings are non-default.
 * @property {(changes: Object<string,*>, scope?: string|null) => Promise<ApplyResult>} applySettings
 *   Validate + clamp `changes` against the settings registry, persist them at
 *   the resolved scope, live-apply to the current surface, and journal enough
 *   to undo. `scope` is `'category:<id>'` | `'origin:<host>'` | omitted (=
 *   wherever the key's current value already lives, else general).
 * @property {() => Promise<UndoResult>} undoLast
 *   Revert the most recent applySettings call (LIFO); pops the journal only
 *   once the revert actually lands, so a failed undo keeps the step retryable.
 * @property {() => Promise<{ok:true}>} resetUndo
 *   Clear the undo journal (a fresh control-session starting).
 * @property {(mode?: 'outline'|'text', chunk?: number) => Promise<ReadPageResult>} readPage
 *   Extract page text for TTS/Q&A. 'outline' (default) = headings + opening
 *   text; 'text' = the full text in fixed-size chunks (pass chunk to continue).
 * @property {(action: string, target?: string, text?: string) => Promise<PageActionResult>} pageAction
 *   Perform one page interaction (scroll/click/type/focus-nav/navigate/etc).
 */

/**
 * A conforming ActuationPort that touches nothing and reports honestly that
 * there is no surface to act on. Default for hosts with no browser/page
 * surface (a bare Librarian-only host, a unit test exercising only the
 * memory-side tools, an XR host before its own port lands).
 * @type {ActuationPort}
 */
export const noopActuation = {
  async getContext() {
    return { tab: null, onWebPage: false, zoomPercent: null, activeSettings: {}, siteScopedKeys: [] };
  },
  async applySettings() {
    return { error: 'no actuation surface on this host' };
  },
  async undoLast() {
    return { error: 'nothing to undo in this session' };
  },
  async resetUndo() {
    return { ok: true };
  },
  async readPage() {
    return { error: 'no actuation surface on this host' };
  },
  async pageAction() {
    return { ok: false, detail: 'no actuation surface on this host' };
  },
};

export default noopActuation;
