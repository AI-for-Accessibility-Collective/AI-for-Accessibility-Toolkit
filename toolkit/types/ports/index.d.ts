/**
 * @typedef {Object} KVStore
 * Async key/value access over named storage areas. Mirrors the subset of
 * `chrome.storage.<area>` the datastore uses. `area` is a logical string the
 * host maps to a real backend (e.g. 'local' | 'sync').
 * @property {(area: string, key: string) => Promise<any>} get
 *   Resolve the raw stored value, or `undefined` when absent. (Defaulting is
 *   the datastore's job, not the port's.)
 * @property {(area: string, key: string, value: any) => Promise<void>} set
 *   Persist a value. MUST reject if the write fails.
 * @property {(area: string) => Promise<Record<string, any>>} getAll
 *   Every entry currently in the area, as a `{ key: value }` map. Equivalent
 *   to `chrome.storage.<area>.get(null)`. Used to enumerate the dynamic
 *   memory-shard keys the catalog can't name ahead of time.
 */
/**
 * @typedef {Object} Clock
 * The only source of "now" the core may read. Injecting it removes the last
 * hidden global from the engine and makes the slow-lane lifecycle testable.
 * @property {() => number} now  Epoch milliseconds, like `Date.now()`.
 */
/**
 * @typedef {Object} Scheduler
 * Deferred and recurring work. The host decides the real mechanism
 * (`chrome.alarms`, `BGTaskScheduler`, a frame loop, a test stub).
 * @property {(id: string, periodMinutes: number, handler: () => void) => void} every
 *   Run `handler` roughly every `periodMinutes`. Calling again with the same
 *   `id` re-registers, not duplicates.
 * @property {(id: string, delayMs: number, handler: () => void) => void} debounce
 *   Run `handler` once, `delayMs` after the most recent call for this `id`
 *   (later calls reset the timer). The fast path for "extract soon after a
 *   burst of observations".
 */
/**
 * @typedef {Object} Consent
 * The accessible channel for surfacing pending consent items (proposals,
 * cross-app grant requests, cross-app insights) to the user.
 *
 * REQUIRED: `notifyPending`, the indicator that something awaits a decision.
 * The Chrome host is PULL-based: the badge notifies, and the popup lists and
 * resolves items through the librarian's own methods, so notifyPending is all
 * it needs (or implements).
 *
 * OPTIONAL (Phase 3): `present` / `capture`, for PUSH-based hosts whose
 * reliable modality is not a visual list (XR TTS prompt, a screen-reader live
 * region, a large-target dialog). A host that implements them surfaces each
 * pending item itself and feeds the user's decision back through the SAME
 * `respondToProposal` path, so the consent semantics (never auto-apply,
 * sender-can't-self-resolve, suppression/cooldown) are identical on every
 * host. Copy shown to the user should respect the profile's
 * `metaPreferences.language` ('plain' → plain-language pass).
 * @property {(count: number) => (void | Promise<void>)} notifyPending
 *   Reflect that `count` items await the user's decision (0 clears it).
 *   MUST NOT throw into the caller; failures are swallowed by the adapter.
 * @property {(item: {type: 'proposal'|'grant-request'|'cross-app-insight', proposal: object}) => Promise<void>} [present]
 *   Surface one pending item in the host's accessible modality.
 * @property {(proposalId: string) => Promise<'accept'|'declineOnce'|'suppress'|null>} [capture]
 *   Collect the user's decision for a presented item (null = no decision yet).
 */
/**
 * @typedef {Object} DemoHook
 * The extension's live-diagram instrumentation, lifted out of the core so the
 * engine carries no `globalThis.AA_DEMO_MODE` / `globalThis.aaDemoTrace`
 * reads. Non-extension hosts pass the no-op default below.
 * @property {() => boolean} isOn   Live value of demo mode (read per call).
 * @property {(diagram: string, region: string, label: string) => void} trace
 *   Emit a diagram trace; no-op when no demo surface is attached.
 */
/**
 * @typedef {Object} Sensors
 * OPTIONAL. A host that can MEASURE the user (XR field-of-view / gaze, a
 * device's own accessibility settings, a phone's Dynamic Type size) supplies
 * this so a measured signal can become a modality-neutral ability need. The
 * core never reads a sensor directly; a host reads it, maps it to a `need`,
 * and contributes it through the normal consent path (importInsight /
 * logObservation), so a measurement is a PROPOSAL like any other, never a
 * silent write. Purely a host concern; named here so every conformer speaks
 * the same shape. (Phase 4; the XR FOV→text-size loop is the reference use.)
 * @property {(kind: string) => Promise<any>} read
 *   Read a named sensor (e.g. 'fov.textSizeMultiplier', 'device.dynamicType').
 *   Resolves to the raw reading, or null if the host can't measure it.
 */
/**
 * @typedef {Object} Media
 * Where the Librarian keeps the images an observation carries (a screenshot of
 * what the person saw, a photo), one record per image, so the episodic log
 * itself stays small. A host without one drops images and keeps the text.
 * @property {(id: string, image: {mimeType: string, data: string}) => Promise<void>} put
 *   Store one image (`data` is base64). MUST reject if the write fails.
 * @property {(id: string) => Promise<{mimeType: string, data: string}|null>} get
 *   Read one image back, or null when it is gone.
 * @property {(id: string) => Promise<void>} delete
 *   Forget one image. Deleting a missing one is not an error.
 */
/** A Media port that keeps nothing — observations keep their text only. */
export const noopMedia: null;
export namespace noopDemo {
    function isOn(): boolean;
    function trace(): void;
}
export namespace noopSensors {
    function read(): Promise<null>;
}
export namespace noopConsent {
    function notifyPending(): void;
}
export namespace noopScheduler {
    function every(): void;
    function debounce(): void;
}
export namespace systemClock {
    function now(): number;
}
/**
 * Async key/value access over named storage areas. Mirrors the subset of
 * `chrome.storage.<area>` the datastore uses. `area` is a logical string the
 * host maps to a real backend (e.g. 'local' | 'sync').
 */
export type KVStore = {
    /**
     *   Resolve the raw stored value, or `undefined` when absent. (Defaulting is
     *   the datastore's job, not the port's.)
     */
    get: (area: string, key: string) => Promise<any>;
    /**
     *   Persist a value. MUST reject if the write fails.
     */
    set: (area: string, key: string, value: any) => Promise<void>;
    /**
     *   Every entry currently in the area, as a `{ key: value }` map. Equivalent
     *   to `chrome.storage.<area>.get(null)`. Used to enumerate the dynamic
     *   memory-shard keys the catalog can't name ahead of time.
     */
    getAll: (area: string) => Promise<Record<string, any>>;
};
/**
 * The only source of "now" the core may read. Injecting it removes the last
 * hidden global from the engine and makes the slow-lane lifecycle testable.
 */
export type Clock = {
    /**
     * Epoch milliseconds, like `Date.now()`.
     */
    now: () => number;
};
/**
 * Deferred and recurring work. The host decides the real mechanism
 * (`chrome.alarms`, `BGTaskScheduler`, a frame loop, a test stub).
 */
export type Scheduler = {
    /**
     *   Run `handler` roughly every `periodMinutes`. Calling again with the same
     *   `id` re-registers, not duplicates.
     */
    every: (id: string, periodMinutes: number, handler: () => void) => void;
    /**
     *   Run `handler` once, `delayMs` after the most recent call for this `id`
     *   (later calls reset the timer). The fast path for "extract soon after a
     *   burst of observations".
     */
    debounce: (id: string, delayMs: number, handler: () => void) => void;
};
/**
 * The accessible channel for surfacing pending consent items (proposals,
 * cross-app grant requests, cross-app insights) to the user.
 *
 * REQUIRED: `notifyPending`, the indicator that something awaits a decision.
 * The Chrome host is PULL-based: the badge notifies, and the popup lists and
 * resolves items through the librarian's own methods, so notifyPending is all
 * it needs (or implements).
 *
 * OPTIONAL (Phase 3): `present` / `capture`, for PUSH-based hosts whose
 * reliable modality is not a visual list (XR TTS prompt, a screen-reader live
 * region, a large-target dialog). A host that implements them surfaces each
 * pending item itself and feeds the user's decision back through the SAME
 * `respondToProposal` path, so the consent semantics (never auto-apply,
 * sender-can't-self-resolve, suppression/cooldown) are identical on every
 * host. Copy shown to the user should respect the profile's
 * `metaPreferences.language` ('plain' → plain-language pass).
 */
export type Consent = {
    /**
     *   Reflect that `count` items await the user's decision (0 clears it).
     *   MUST NOT throw into the caller; failures are swallowed by the adapter.
     */
    notifyPending: (count: number) => (void | Promise<void>);
    /**
     * Surface one pending item in the host's accessible modality.
     */
    present?: ((item: {
        type: "proposal" | "grant-request" | "cross-app-insight";
        proposal: object;
    }) => Promise<void>) | undefined;
    /**
     * Collect the user's decision for a presented item (null = no decision yet).
     */
    capture?: ((proposalId: string) => Promise<"accept" | "declineOnce" | "suppress" | null>) | undefined;
};
/**
 * The extension's live-diagram instrumentation, lifted out of the core so the
 * engine carries no `globalThis.AA_DEMO_MODE` / `globalThis.aaDemoTrace`
 * reads. Non-extension hosts pass the no-op default below.
 */
export type DemoHook = {
    /**
     * Live value of demo mode (read per call).
     */
    isOn: () => boolean;
    /**
     *   Emit a diagram trace; no-op when no demo surface is attached.
     */
    trace: (diagram: string, region: string, label: string) => void;
};
/**
 * OPTIONAL. A host that can MEASURE the user (XR field-of-view / gaze, a
 * device's own accessibility settings, a phone's Dynamic Type size) supplies
 * this so a measured signal can become a modality-neutral ability need. The
 * core never reads a sensor directly; a host reads it, maps it to a `need`,
 * and contributes it through the normal consent path (importInsight /
 * logObservation), so a measurement is a PROPOSAL like any other, never a
 * silent write. Purely a host concern; named here so every conformer speaks
 * the same shape. (Phase 4; the XR FOV→text-size loop is the reference use.)
 */
export type Sensors = {
    /**
     *   Read a named sensor (e.g. 'fov.textSizeMultiplier', 'device.dynamicType').
     *   Resolves to the raw reading, or null if the host can't measure it.
     */
    read: (kind: string) => Promise<any>;
};
/**
 * Where the Librarian keeps the images an observation carries (a screenshot of
 * what the person saw, a photo), one record per image, so the episodic log
 * itself stays small. A host without one drops images and keeps the text.
 */
export type Media = {
    /**
     *   Store one image (`data` is base64). MUST reject if the write fails.
     */
    put: (id: string, image: {
        mimeType: string;
        data: string;
    }) => Promise<void>;
    /**
     *   Read one image back, or null when it is gone.
     */
    get: (id: string) => Promise<{
        mimeType: string;
        data: string;
    } | null>;
    /**
     *   Forget one image. Deleting a missing one is not an error.
     */
    delete: (id: string) => Promise<void>;
};
//# sourceMappingURL=index.d.ts.map