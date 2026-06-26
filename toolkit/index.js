// Toolkit SDK entry — the one call a new host makes. Wires the datastore and
// librarian cores together against a set of injected platform ports and hands
// back the constructed surface. The Chrome extension does NOT use this (it
// loads three separate classic-script bundles so the popup, the service
// worker, and the test can each pull in only what they need — see
// adapters/chrome/*.entry.js); this is the path a fresh consumer (iOS, XR, a
// Node service, a test) takes.
//
//   import { createToolkit } from '@a11y-toolkit/core';
//   const { datastore, librarian } = createToolkit({ kv, clock, scheduler, consent, toolsRegistry });
//   librarian.setGeminiCaller(myLlm);   // optional slow lane

import { taxonomy as defaultTaxonomy } from './core/taxonomy.js';
import { createDatastore } from './core/datastore.js';
import { createLibrarian } from './core/librarian.js';
import { systemClock, noopScheduler, noopConsent, noopDemo } from './ports/index.js';

/**
 * @param {Object} ports
 * @param {import('./ports/index.js').KVStore} ports.kv               Required.
 * @param {import('./ports/index.js').Clock} [ports.clock]            Defaults to the system wall clock.
 * @param {import('./ports/index.js').Scheduler} [ports.scheduler]    Defaults to a no-op (drive the slow lane yourself).
 * @param {import('./ports/index.js').Consent} [ports.consent]        Defaults to a no-op.
 * @param {import('./ports/index.js').DemoHook} [ports.demo]          Defaults to a no-op.
 * @param {Object} [ports.taxonomy]                                   Defaults to the bundled web taxonomy.
 * @param {Object|null} [ports.toolsRegistry]                         The settings/tools registry (AA_TOOLS shape), or null.
 * @returns {{ datastore: object, librarian: object }}
 */
export function createToolkit({
  kv,
  clock = systemClock,
  scheduler = noopScheduler,
  consent = noopConsent,
  demo = noopDemo,
  taxonomy = defaultTaxonomy,
  toolsRegistry = null,
} = {}) {
  if (!kv) throw new Error('createToolkit: a kv port is required');
  const datastore = createDatastore({ kv, clock, taxonomy, toolsRegistry });
  const librarian = createLibrarian({ datastore, taxonomy, clock, scheduler, consent, demo });
  return { datastore, librarian };
}

export { createDatastore } from './core/datastore.js';
export { createLibrarian } from './core/librarian.js';
export { taxonomy } from './core/taxonomy.js';
export { createSurfaceAdapter } from './core/surface.js';
export { UNIT, SETTING_UNITS, unitOf, coerceSetting, coerceSettings } from './core/units.js';
export * from './ports/index.js';

export default createToolkit;
