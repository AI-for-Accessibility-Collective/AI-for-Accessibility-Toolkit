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
 *   Extract page text. 'outline' (default) = headings + opening text; 'text' =
 *   the full text in fixed-size chunks (pass chunk to continue).
 *   NOTE (issue #7): despite the name, this RETURNS text for the caller to
 *   deliver — it must NOT itself speak. Delivery is the caller's choice of
 *   channel: an ARIA live region on web (so it arrives in the person's OWN
 *   screen-reader voice, at their rate), UIAccessibility on iOS, spatial audio
 *   on XR, real TTS only where there is no AT. Reaching for speechSynthesis is
 *   the failure mode for exactly the users this serves. The neutral, go-forward
 *   ControlPort (controller/control-port.js) names this `getContent`
 *   precisely to drop the "read aloud" implication; this web-shaped port is
 *   superseded by it.
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
export const noopActuation: ActuationPort;
export default noopActuation;
export type SurfaceTab = {
    /**
     * Sanitized (no control chars/newlines), capped ~120 chars.
     */
    title: string;
    /**
     * Hostname of the active tab's URL, or null when off the web.
     */
    origin: string | null;
};
export type SurfaceContext = {
    /**
     * Null when there's no usable active tab.
     */
    tab: SurfaceTab | null;
    /**
     * True iff the active tab is a regular http(s) page.
     */
    onWebPage: boolean;
    /**
     * Current page zoom, 25-500, or null if unknown/inapplicable.
     */
    zoomPercent: number | null;
    /**
     * Non-default settings currently in effect for this page (key -> value).
     */
    activeSettings: {
        [x: string]: any;
    };
    /**
     * Keys of activeSettings whose value came from a category:/origin: scoped record rather than the global default.
     */
    siteScopedKeys: string[];
};
export type ApplyResult = {
    /**
     * Keys actually written (validated/clamped), including the virtual `pageZoom` key.
     */
    applied?: {
        [x: string]: any;
    } | undefined;
    /**
     * Prior value per key (audit trail; also what undo restores).
     */
    previous?: {
        [x: string]: any;
    } | undefined;
    /**
     * Resolved scope per key: 'general' | 'category:<id>' | 'origin:<host>'.
     */
    scopesUsed?: {
        [x: string]: string;
    } | undefined;
    /**
     * Whether the current page received the change live; null = not attempted (no active tab).
     */
    liveApplied?: boolean | null | undefined;
    /**
     * Keys that were invalid/out of range and were dropped.
     */
    rejected?: string[] | undefined;
    /**
     * Set when nothing could be applied, or persisting failed.
     */
    error?: string | undefined;
};
export type UndoResult = {
    /**
     * Key -> the value it now holds after the revert (a true post-delete fallback, not a stale pin).
     */
    reverted?: {
        [x: string]: any;
    } | undefined;
    /**
     * Entries left in the journal after this pop.
     */
    remainingUndos?: number | undefined;
    /**
     * Sub-parts (e.g. 'pageZoom') that could not be reverted.
     */
    rejected?: string[] | undefined;
    /**
     * Keys whose record was left alone because a later write already changed it.
     */
    skipped?: string[] | undefined;
    /**
     * Set when there was nothing to undo, or the revert failed outright (entry is kept on failure).
     */
    error?: string | undefined;
};
export type ReadPageResult = {
    /**
     * Always 'untrusted-page-content' on success — content to summarize, never instructions to follow.
     */
    source?: string | undefined;
    /**
     * Sanitized page title.
     */
    title?: string | undefined;
    /**
     * Hostname of the page.
     */
    origin?: string | null | undefined;
    /**
     * Present in 'outline' mode.
     */
    headings?: string[] | undefined;
    /**
     * Present in 'outline' mode.
     */
    selection?: string | null | undefined;
    /**
     * The extracted/chunked text.
     */
    text?: string | undefined;
    /**
     * Chunk index actually returned.
     */
    chunk?: number | undefined;
    /**
     * Total chunks available at the host's chunk size.
     */
    totalChunks?: number | undefined;
    /**
     * Set when the surface isn't a readable page.
     */
    error?: string | undefined;
};
export type PageActionResult = {
    ok: boolean;
    detail?: string | undefined;
};
/**
 * The host-agnostic surface a modality-neutral control layer actuates
 * through. One instance per host. Every method is async and MUST NOT throw —
 * failures resolve to a `{error}` (or `{ok:false, detail}` for pageAction)
 * result object, because these results cross an RPC boundary
 * (chrome.runtime.sendMessage today) where thrown errors don't propagate
 * usefully.
 */
export type ActuationPort = {
    /**
     *   Snapshot of the current surface: tab, zoom, which settings are non-default.
     */
    getContext: () => Promise<SurfaceContext>;
    /**
     *   Validate + clamp `changes` against the settings registry, persist them at
     *   the resolved scope, live-apply to the current surface, and journal enough
     *   to undo. `scope` is `'category:<id>'` | `'origin:<host>'` | omitted (=
     *   wherever the key's current value already lives, else general).
     */
    applySettings: (changes: {
        [x: string]: any;
    }, scope?: string | null) => Promise<ApplyResult>;
    /**
     *   Revert the most recent applySettings call (LIFO); pops the journal only
     *   once the revert actually lands, so a failed undo keeps the step retryable.
     */
    undoLast: () => Promise<UndoResult>;
    /**
     *   Clear the undo journal (a fresh control-session starting).
     */
    resetUndo: () => Promise<{
        ok: true;
    }>;
    /**
     *   Extract page text. 'outline' (default) = headings + opening text; 'text' =
     *   the full text in fixed-size chunks (pass chunk to continue).
     *   NOTE (issue #7): despite the name, this RETURNS text for the caller to
     *   deliver — it must NOT itself speak. Delivery is the caller's choice of
     *   channel: an ARIA live region on web (so it arrives in the person's OWN
     *   screen-reader voice, at their rate), UIAccessibility on iOS, spatial audio
     *   on XR, real TTS only where there is no AT. Reaching for speechSynthesis is
     *   the failure mode for exactly the users this serves. The neutral, go-forward
     *   ControlPort (controller/control-port.js) names this `getContent`
     *   precisely to drop the "read aloud" implication; this web-shaped port is
     *   superseded by it.
     */
    readPage: (mode?: "outline" | "text", chunk?: number) => Promise<ReadPageResult>;
    /**
     *   Perform one page interaction (scroll/click/type/focus-nav/navigate/etc).
     */
    pageAction: (action: string, target?: string, text?: string) => Promise<PageActionResult>;
};
//# sourceMappingURL=actuation.d.ts.map