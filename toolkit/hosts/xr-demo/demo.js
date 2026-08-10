#!/usr/bin/env node
// XR demo host — Phase 4's "prove it with a second consumer", runnable today.
//
// Simulates the full cross-surface loop from the architecture diagrams with
// NO Chrome anywhere — the toolkit core running on plain in-memory ports:
//
//   1. ONBOARDING (web host): person declares abilities + structured needs.
//   2. GRANT: the person approves XR Navigator's read request (a proposal,
//      like any other — the requesting app can never resolve its own ask).
//   3. FACILITATION (XR host): reads the filtered, modality-neutral
//      AbilityModel through the Librarian's grant API, senses the
//      environment (FOV), renders real-time adaptations from the SAME
//      needs model the web surface reads.
//   4. INSIGHT BACK: the XR app's FOV measurement suggests larger text — it
//      flows back through importInsight and lands as a CONSENT-GATED
//      PROPOSAL on the person's queue (never silently applied).
//   5. VALIDATION: the person accepts; both surfaces now render the update,
//      and the cross-app share-audit trail shows exactly what happened.
//
// Run: node toolkit/hosts/xr-demo/demo.js

import { createDatastore } from '../../core/datastore.js';
import { createLibrarian } from '../../core/librarian.js';
import { TAXONOMY } from '../../core/taxonomy.js';
import { renderWebSettings } from '../../surfaces/web.js';
import { renderXRSettings } from '../../surfaces/xr.js';
import { getShareAudit } from '../../sync/grants.js';

// ---- in-memory ports, shaped like the chain's KVStore port (get/set/getAll
// per area) — see toolkit/ports/index.js and adapters/chrome/ports.js
// chromeKV, and the same pattern toolkit/hosts/skill-demo/demo.js uses. A
// real host swaps this for its platform (chrome.storage, a native store, …).
const mem = { local: {}, sync: {} };
const kv = {
  async get(area, key) { return mem[area][key] === undefined ? undefined : structuredClone(mem[area][key]); },
  async set(area, key, value) { mem[area][key] = structuredClone(value); },
  async getAll(area) { return structuredClone(mem[area]); },
};
const clock = { now: () => Date.now() };
const tools = {
  settingsMeta: {
    fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1.0, 3.0] },
    darkMode: { type: 'boolean' }, motionReducer: { type: 'boolean' }, autoCaptions: { type: 'boolean' },
  },
  byId: () => null,
  forPrompt: () => [],
  settingsVocabularyLines: () => [],
};
const datastore = createDatastore({ kv, clock, taxonomy: TAXONOMY, toolsRegistry: tools, builtinSkills: [] });
const librarian = createLibrarian({ datastore, taxonomy: TAXONOMY, clock });

const log = (s) => console.log(s);

(async () => {
  log('━━━ 1. ONBOARDING (web) ━━━');
  await librarian.setProfileField('supportAreas', ['vision']);
  await librarian.setProfileField('freeText', 'small text is hard for me');
  // Structured needs — modality-neutral, the SAME vocabulary every surface
  // (web, XR, …) reads. This is the toolkit/core/ability.js#toAbilityModel
  // writer path: setProfileField('fields.needs', …), zero new plumbing.
  await librarian.setProfileField('fields.needs', [
    { dimension: 'textSize', value: 1.3, strength: 'preference', source: 'onboarding' },
    { dimension: 'darkTheme', value: true, strength: 'preference', source: 'onboarding' },
    { dimension: 'reduceMotion', value: true, strength: 'preference', source: 'onboarding' },
  ]);
  const model = await librarian.getAbilityModel();
  log(`  AbilityModel needs: ${model.needs.map(n => `${n.dimension}=${n.value}`).join(', ')}`);
  log(`  Web surface renders: ${JSON.stringify(renderWebSettings(model))}`);

  log('\n━━━ 2. GRANT (consent UI) ━━━');
  // A request is NOT a grant — it drafts an ordinary proposal through the
  // same consent machinery (suppression/cooldown/weekly cap). Only
  // respondToProposal('accept') on the LOCAL user surface mints the grant;
  // XR Navigator has no code path that resolves its own request.
  const req = await librarian.requestGrant('xr-navigator', ['ability.categories', 'settings.text'], {
    appLabel: 'XR Navigator',
    rationale: 'XR Navigator wants to read your accessibility needs so it can adapt its headset UI.',
  });
  if (!req.ok) { log(`  ✗ grant request failed: ${req.reason}`); process.exit(1); }
  await librarian.respondToProposal(req.proposalId, 'accept');
  const grant = (await librarian.listGrants()).find(g => g.appId === 'xr-navigator');
  log(`  Granted ${grant.appLabel}: scopes=[${grant.scopes.join(', ')}], audience=${grant.audience}`);
  log('  (No scope for freeText — the person\'s own words stay private.)');

  log('\n━━━ 3. FACILITATION (XR host) ━━━');
  const exported = await librarian.exportAbilityModel('xr-navigator');
  if (!exported.ok) { log(`  ✗ export blocked: ${exported.reason}`); process.exit(1); }
  const shared = exported.abilityModel;
  log(`  XR app received: needs=${JSON.stringify(shared.needs)}, freeText=${shared.freeText === undefined ? 'NOT SHARED' : 'leaked!'}`);
  const sensors = { fovDegrees: 100, viewingDistanceM: 1.2 };   // "sense the environment"
  const xr = renderXRSettings(model, sensors);
  log(`  Real-time adaptation: text ${xr.text.angularSizeDeg}° (${(xr.text.worldHeightM * 1000).toFixed(1)}mm at ${sensors.viewingDistanceM}m), ` +
      `comfortVignette=${xr.motion.comfortVignette}, darkEnv=${xr.ui.darkEnvironmentPreferred}`);

  log('\n━━━ 4. INSIGHT FLOWS BACK (XR → Librarian, as a proposal) ━━━');
  const insight = await librarian.importInsight('xr-navigator', {
    kind: 'visual.textSize',
    label: 'making text larger everywhere',
    change: { op: 'profile-set', path: 'fields.needs', value: [
      { dimension: 'textSize', value: 1.5, strength: 'preference', source: 'xr-navigator' },
      { dimension: 'darkTheme', value: true, strength: 'preference', source: 'onboarding' },
      { dimension: 'reduceMotion', value: true, strength: 'preference', source: 'onboarding' },
    ] },
    rationale: 'Your field-of-view measurements suggest text at 150% is comfortable.',
    confidence: 0.8,
  });
  if (!insight.ok) { log(`  ✗ insight rejected: ${insight.reason}`); process.exit(1); }
  const pending = await librarian.listProposals('pending');
  log(`  Pending proposals: ${pending.length} — "${pending[0].aspectLabel}" (from ${pending[0].source})`);
  log('  Nothing auto-applied: the person decides.');

  log('\n━━━ 5. THE PERSON ACCEPTS → both surfaces update ━━━');
  await librarian.respondToProposal(pending[0].id, 'accept');
  const updated = await librarian.getAbilityModel();
  const updatedTextSize = updated.needs.find(n => n.dimension === 'textSize')?.value;
  log(`  AbilityModel now: textSize=${updatedTextSize}`);
  log(`  Web renders: fontScale=${renderWebSettings(updated).fontScale}`);
  log(`  XR renders:  ${renderXRSettings(updated, sensors).text.angularSizeDeg}° text`);

  const auditLog = await getShareAudit(() => datastore);
  log(`\n  Audit trail: ${auditLog.map(a => a.action).join(' → ')}`);

  // Exit code doubles as a smoke test for CI.
  const ok = updatedTextSize === 1.5
    && shared.freeText === undefined
    && pending.length === 1
    && auditLog.some(a => a.action === 'grant-created')
    && auditLog.some(a => a.action === 'export')
    && auditLog.some(a => a.action === 'insight-import');
  log(ok ? '\n✓ Cross-surface loop complete.' : '\n✗ Loop failed!');
  process.exit(ok ? 0 : 1);
})();
