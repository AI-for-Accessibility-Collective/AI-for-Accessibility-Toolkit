// @ts-nocheck
// FLAG(review): 2 errors under toolkit/tsconfig.json's strict check at the
// time this header was added. Type declarations still emit from this file;
// remove these lines and fix the errors to opt it into the check.
// esbuild entry → a Chrome host bundles this into its own lib/datastore.js
// (classic IIFE). Constructs the datastore against chrome-backed ports and
// assigns globalThis.Datastore, preserving the load contract the service
// worker and test rely on.
//
// AA_TAXONOMY, AA_TOOLS, and AA_SKILLS must already be on the global
// (taxonomy.js, the generated tools-registry.js, and skills-db.js are
// imported before this in background.js and eval'd before this in the test).
import { createDatastore } from '../../core/datastore.js';
import { chromeKV, chromeClock } from './ports.js';

globalThis.Datastore = createDatastore({
  kv: chromeKV(),
  clock: chromeClock(),
  taxonomy: globalThis.AA_TAXONOMY,
  toolsRegistry: globalThis.AA_TOOLS || null,
  builtinSkills: globalThis.AA_SKILLS || [],
});
