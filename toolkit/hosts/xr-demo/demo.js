#!/usr/bin/env node
// XR demo host — Phase 4's "prove it with a second consumer", runnable today.
//
// Simulates the full cross-surface loop from the architecture diagrams with
// NO Chrome anywhere — the toolkit core running on plain in-memory ports:
//
//   1. ONBOARDING (web host): person declares abilities + sets preferences.
//   2. GRANT: the person grants "XR Navigator" scoped read access + write.
//   3. FACILITATION (XR host): reads the filtered understanding through the
//      broker, senses the environment (FOV), renders real-time adaptations.
//   4. INSIGHT BACK: the XR app's FOV measurement suggests larger text — it
//      flows back through the broker and lands as a CONSENT-GATED PROPOSAL
//      on the person's queue (never silently applied).
//   5. VALIDATION: the person accepts; both surfaces now render the update.
//
// Run: node toolkit/hosts/xr-demo/demo.js

import { createDatastore } from '../../core/datastore.js';
import { createLibrarian } from '../../core/librarian.js';
import { createBroker } from '../../core/broker.js';
import { TAXONOMY } from '../../core/taxonomy.js';
import { renderWebSettings } from '../../surfaces/web.js';
import { renderXRSettings } from '../../surfaces/xr.js';

// ---- in-memory ports (a real host swaps these for its platform) -----------
const mem = { local: {}, sync: {} };
const area = (name) => ({
  get: async (key, def) => (mem[name][key] === undefined ? def : structuredClone(mem[name][key])),
  set: async (key, value) => { mem[name][key] = structuredClone(value); },
});
const datastore = createDatastore({
  areas: { local: area('local'), sync: area('sync') },
  globalTier: {
    tools: () => ({
      settingsMeta: { fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1.0, 3.0] } },
      settingsVocabularyLines: () => [],
      forPrompt: () => [],
    }),
    taxonomy: () => TAXONOMY,
  },
});
const librarian = createLibrarian({
  datastore: () => datastore,
  taxonomy: () => TAXONOMY,
  kv: {
    getAll: async () => structuredClone(mem.local),
    set: async (items) => { Object.assign(mem.local, structuredClone(items)); },
  },
});
const broker = createBroker({ datastore: () => datastore, librarian });

const log = (s) => console.log(s);

(async () => {
  log('━━━ 1. ONBOARDING (web) ━━━');
  await librarian.setProfileField('supportAreas', ['vision']);
  await librarian.setProfileField('freeText', 'small text is hard for me');
  await librarian.recordScopedSettings('general', { fontScale: 130, darkMode: true, motionReducer: true });
  const model = await librarian.getAbilityModel();
  log(`  AbilityModel: text.size=${model.text.size}, dark=${model.vision.lightPreference}, motion=${model.motion}`);
  log(`  Web surface renders: ${JSON.stringify(renderWebSettings(model))}`);

  log('\n━━━ 2. GRANT (consent UI) ━━━');
  const grant = await broker.createGrant({
    appId: 'xr-navigator',
    appName: 'XR Navigator',
    read: ['ability.text', 'ability.vision', 'ability.motion', 'ability.audio'],
    write: true,
  });
  log(`  Granted ${grant.appName}: read=[${grant.read.join(', ')}], write=${grant.write}`);
  log('  (No grant for ability.freeText — the person\'s own words stay private.)');

  log('\n━━━ 3. FACILITATION (XR host) ━━━');
  const shared = await broker.exportUnderstanding(grant.id);
  log(`  XR app received: text=${JSON.stringify(shared.text)}, freeText=${shared.freeText === undefined ? 'NOT SHARED' : 'leaked!'}`);
  const sensors = { fovDegrees: 100, viewingDistanceM: 1.2 };   // "sense the environment"
  const xr = renderXRSettings({ ...model, ...shared }, sensors);
  log(`  Real-time adaptation: text ${xr.text.angularSizeDeg}° (${(xr.text.worldHeightM * 1000).toFixed(1)}mm at ${sensors.viewingDistanceM}m), ` +
      `comfortVignette=${xr.motion.comfortVignette}, darkEnv=${xr.ui.darkEnvironmentPreferred}`);

  log('\n━━━ 4. INSIGHT FLOWS BACK (XR → Librarian, as a proposal) ━━━');
  await broker.importInsight(grant.id, {
    aspect: 'setting.fontScale',
    aspectLabel: 'making text larger everywhere',
    change: { op: 'add-memory', record: {
      text: 'XR sessions show comfortable reading needs ~150% text.',
      tier: 'preference', scope: 'general', kind: 'preference',
      settings: { fontScale: 150 }, importance: 7, decayClass: 'stable',
    } },
    rationale: 'Your field-of-view measurements suggest text at 150% is comfortable.',
    confidence: 0.8,
  });
  const pending = await librarian.listProposals('pending');
  log(`  Pending proposals: ${pending.length} — "${pending[0].aspectLabel}" (from ${pending[0].origin.source})`);
  log('  Nothing auto-applied: the person decides.');

  log('\n━━━ 5. THE PERSON ACCEPTS → both surfaces update ━━━');
  await librarian.respondToProposal(pending[0].id, 'accept');
  const updated = await librarian.getAbilityModel();
  log(`  AbilityModel now: text.size=${updated.text.size}`);
  log(`  Web renders: fontScale=${renderWebSettings(updated).fontScale}`);
  log(`  XR renders:  ${renderXRSettings(updated, sensors).text.angularSizeDeg}° text`);

  const auditLog = await broker.getAuditLog();
  log(`\n  Audit trail: ${auditLog.map(a => a.kind).join(' → ')}`);

  // Exit code doubles as a smoke test for CI.
  const ok = updated.text.size === 1.5
    && shared.freeText === undefined
    && pending.length === 1
    && auditLog.some(a => a.kind === 'export') && auditLog.some(a => a.kind === 'import');
  log(ok ? '\n✓ Cross-surface loop complete.' : '\n✗ Loop failed!');
  process.exit(ok ? 0 : 1);
})();
