/**
 * @overload
 * @param {ToolkitPorts} ports
 * @returns {Toolkit}
 */
export function createToolkit(ports: ToolkitPorts): Toolkit;
export { createDatastore } from "./core/datastore.js";
export { createLibrarian } from "./core/librarian.js";
export { taxonomy } from "./core/taxonomy.js";
export { createSurfaceAdapter } from "./core/surface.js";
export * from "./ports/index.js";
export default createToolkit;
/**
 * What a host hands to `createToolkit`. Only `kv` is required; every other
 * port has a no-op or wall-clock default (see ./ports/index.js).
 */
export type ToolkitPorts = {
    /**
     * Required.
     */
    kv: import("./ports/index.js").KVStore;
    /**
     * Defaults to the system wall clock.
     */
    clock?: import("./ports/index.js").Clock | undefined;
    /**
     * Defaults to a no-op (drive the slow lane yourself).
     */
    scheduler?: import("./ports/index.js").Scheduler | undefined;
    /**
     * Defaults to a no-op.
     */
    consent?: import("./ports/index.js").Consent | undefined;
    /**
     * Defaults to a no-op.
     */
    demo?: import("./ports/index.js").DemoHook | undefined;
    /**
     * Defaults to the bundled web taxonomy.
     */
    taxonomy?: import("./core/taxonomy.js").Taxonomy | undefined;
    /**
     * The settings/tools registry (AA_TOOLS shape), or null.
     */
    toolsRegistry?: import("./core/skill.js").ToolsRegistry | null | undefined;
    /**
     * Built-in SKILL.md playbooks (parsed Skill objects), or [].
     */
    builtinSkills?: import("./core/skill.js").Skill[] | undefined;
};
export type Toolkit = {
    datastore: ReturnType<typeof createDatastore>;
    librarian: ReturnType<typeof createLibrarian>;
};
import { createDatastore } from './core/datastore.js';
import { createLibrarian } from './core/librarian.js';
export { UNIT, SETTING_UNITS, unitOf, coerceSetting, coerceSettings, clampSetting, clampSettings } from "./core/units.js";
export { toAbilityModel, normalizeNeed, SUPPORT_AREAS } from "./core/ability.js";
export { STRENGTH_RANK, rankOf } from "./core/strength.js";
export { GRANT_SCOPES, validateScopes, normalizeGrant, isActive, filterAbilityModelByScopes, buildProfileBlob, validateProfileBlob, BLOB_KIND, BLOB_VERSION, createSharedTransport, EXPORT_PREFIX, INBOX_KEY, ENVELOPE_VERSION } from "./sync/index.js";
//# sourceMappingURL=index.d.ts.map