// esbuild entry → built to personalized-extension/extension/lib/datastore.js
// (classic IIFE). Constructs the datastore against chrome-backed ports and
// assigns globalThis.Datastore, preserving the load contract the service
// worker and test rely on.
//
// AA_TAXONOMY and AA_TOOLS must already be on the global (taxonomy.js and the
// generated tools-registry.js are imported before this in background.js and
// eval'd before this in the test).
import { createDatastore } from '../../core/datastore.js';
import { chromeKV, chromeClock } from './ports.js';

globalThis.Datastore = createDatastore({
  kv: chromeKV(),
  clock: chromeClock(),
  taxonomy: globalThis.AA_TAXONOMY,
  toolsRegistry: globalThis.AA_TOOLS || null,
});
