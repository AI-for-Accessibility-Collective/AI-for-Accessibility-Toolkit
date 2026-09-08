// Toolkit SDK entry — the one call a new host makes. Wires the datastore and
// librarian cores together against a set of injected platform ports and hands
// back the constructed surface. The Chrome extension does NOT use this (it
// loads three separate classic-script bundles so the popup, the service
// worker, and the test can each pull in only what they need — see
// platforms/chrome/*.entry.js); this is the path a fresh consumer (iOS, XR, a
// Node service, a test) takes.
//
//   import { createToolkit } from '@ai4a11y/toolkit';
//   const { datastore, librarian } = createToolkit({ kv, clock, scheduler, consent, toolsRegistry });
//   librarian.setGeminiCaller(myLlm);   // optional slow lane

import { taxonomy as defaultTaxonomy } from './core/taxonomy.js';
import { createDatastore } from './core/datastore.js';
import { createLibrarian } from './core/librarian.js';
import { systemClock, noopScheduler, noopConsent, noopDemo } from './ports/index.js';

/**
 * @typedef {Object} ToolkitPorts
 * What a host hands to `createToolkit`. Only `kv` is required; every other
 * port has a no-op or wall-clock default (see ./ports/index.js).
 * @property {import('./ports/index.js').KVStore} kv                    Required.
 * @property {import('./ports/index.js').Clock} [clock]                 Defaults to the system wall clock.
 * @property {import('./ports/index.js').Scheduler} [scheduler]         Defaults to a no-op (drive the slow lane yourself).
 * @property {import('./ports/index.js').Consent} [consent]             Defaults to a no-op.
 * @property {import('./ports/index.js').DemoHook} [demo]               Defaults to a no-op.
 * @property {import('./core/taxonomy.js').Taxonomy} [taxonomy]         Defaults to the bundled web taxonomy.
 * @property {import('./core/skill.js').ToolsRegistry|null} [toolsRegistry]  The settings/tools registry (AA_TOOLS shape), or null.
 * @property {import('./core/skill.js').Skill[]} [builtinSkills]        Built-in SKILL.md playbooks (parsed Skill objects), or [].
 */

/**
 * @typedef {Object} Toolkit
 * @property {ReturnType<typeof createDatastore>} datastore
 * @property {ReturnType<typeof createLibrarian>} librarian
 */

/**
 * @overload
 * @param {ToolkitPorts} ports
 * @returns {Toolkit}
 */
/**
 * FLAG(review): the overload signature above exists so `kv` is required for
 * callers; the alternative is Partial<ToolkitPorts>, which would let a call
 * with no kv typecheck. Check that types/index.d.ts reads the way a consumer
 * should see it.
 * The implementation signature keeps the runtime default (`= {}`) legal for
 * the checker so the missing-kv error below stays a plain Error; callers see
 * the overload above, where `kv` is required.
 * @param {Partial<ToolkitPorts>} [ports]
 * @returns {Toolkit}
 */
export function createToolkit({
  kv,
  clock = systemClock,
  scheduler = noopScheduler,
  consent = noopConsent,
  demo = noopDemo,
  taxonomy = defaultTaxonomy,
  toolsRegistry = null,
  builtinSkills = [],
} = {}) {
  if (!kv) throw new Error('createToolkit: a kv port is required');
  const datastore = createDatastore({ kv, clock, taxonomy, toolsRegistry, builtinSkills });
  const librarian = createLibrarian({ datastore, taxonomy, clock, scheduler, consent, demo });
  return { datastore, librarian };
}

export { createDatastore } from './core/datastore.js';
export { createLibrarian } from './core/librarian.js';
export { taxonomy } from './core/taxonomy.js';
export { createSurfaceAdapter } from './core/surface.js';
export { UNIT, SETTING_UNITS, unitOf, coerceSetting, coerceSettings, clampSetting, clampSettings } from './core/units.js';
export { toAbilityModel, normalizeNeed, SUPPORT_AREAS } from './core/ability.js';
export { STRENGTH_RANK, rankOf } from './core/strength.js';
export { GRANT_SCOPES, validateScopes, normalizeGrant, isActive, filterAbilityModelByScopes,
  buildProfileBlob, validateProfileBlob, BLOB_KIND, BLOB_VERSION,
  createSharedTransport, EXPORT_PREFIX, INBOX_KEY, ENVELOPE_VERSION } from './sync/index.js';
export * from './ports/index.js';

export default createToolkit;
