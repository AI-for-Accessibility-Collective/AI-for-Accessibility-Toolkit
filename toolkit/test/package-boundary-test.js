// Package-boundary smoke test (Gap 3, deliverable 1) — proves the PUBLIC
// package surface (the barrel at toolkit/index.js) is sufficient on its own
// for a platform host to build the whole flagship loop: no deep `./core/*`
// or `./sync/*` file imports, only what `../index.js` exports.
//
//   node toolkit/test/package-boundary-test.js
//
// If a future change to index.js's re-export list drops something a host
// needs, this test's import line fails fast (a missing named export is a
// SyntaxError at module load), and the flow assertions below catch anything
// still importable but no longer functionally sufficient.

import {
  createToolkit,
  GRANT_SCOPES,
  BLOB_KIND,
  BLOB_VERSION,
  validateProfileBlob,
  buildProfileBlob,
  createSharedTransport,
  SUPPORT_AREAS,
} from '../index.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

// The support-area vocabulary is part of the public surface: a host that
// builds an onboarding form or validates its own registry reads it from here.
check('SUPPORT_AREAS is exported from the barrel as a frozen, non-empty list',
  Array.isArray(SUPPORT_AREAS) && Object.isFrozen(SUPPORT_AREAS) && SUPPORT_AREAS.length > 0);

// A minimal in-memory KVStore — no chrome.*, no filesystem — the smallest
// possible port a "test host" can supply, per toolkit/ports/index.js's
// KVStore contract (get/set/getAll per logical area).
function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area]?.[key]; },
    async set(area, key, value) {
      areas[area] = areas[area] || {};
      if (value === undefined) delete areas[area][key];
      else areas[area][key] = JSON.parse(JSON.stringify(value));
    },
    async getAll(area) { return { ...(areas[area] || {}) }; },
  };
}

const clock = { now: () => 1_700_000_000_000 };
const toolsRegistry = {
  settingsMeta: { fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1, 3] } },
  settingsVocabularyLines: () => ['- fontScale: number 50-200'],
};

// ======================= boot a toolkit instance on the barrel =======================
const { datastore, librarian } = createToolkit({ kv: memKV(), clock, toolsRegistry });
check('createToolkit returns a datastore + librarian', !!datastore && !!librarian);
await datastore.runMigrations();

// ======================= observe =======================
const obsResult = await librarian.logObservation({ type: 'onboarding', text: 'small text is hard to read' });
check('observe (logObservation) accepts an onboarding observation', obsResult.logged === true);

// Structured needs — the same setProfileField path every host (chrome/xr/node)
// uses to write the ability-model source fields.
await librarian.setProfileField('supportAreas', ['vision']);
await librarian.setProfileField('fields.needs', [
  { dimension: 'textSize', value: 1.4, strength: 'preference', source: 'onboarding' },
]);

// ======================= recall =======================
const recalled = await librarian.recall('https://example.test/article', 'reading', []);
check('recall returns a prompt block + profile', typeof recalled.block === 'string' && !!recalled.profile);
check('recall reflects the declared support area', recalled.profile.supportAreas.includes('vision'));

// ======================= getAbilityModel =======================
const model = await librarian.getAbilityModel();
check('getAbilityModel projects the written need', model.needs.some(n => n.dimension === 'textSize' && n.value === 1.4));
check('GRANT_SCOPES is reachable from the barrel', Array.isArray(GRANT_SCOPES) && GRANT_SCOPES.includes('settings.text'));

// ======================= requestGrant =======================
const req = await librarian.requestGrant('demo-app', ['ability.categories', 'settings.text'], { appLabel: 'Demo App' });
check('requestGrant drafts a consent proposal', req.ok === true && !!req.proposalId);
check('export is default-deny before the user accepts', (await librarian.exportAbilityModel('demo-app')).ok === false);
await librarian.respondToProposal(req.proposalId, 'accept');
check('the grant is now active', (await librarian.listGrants()).some(g => g.appId === 'demo-app'));

// ======================= exportAbilityModel =======================
const exported = await librarian.exportAbilityModel('demo-app');
check('exportAbilityModel returns the granted, scoped slice', exported.ok === true
  && exported.abilityModel.needs.some(n => n.dimension === 'textSize'));
check('exportAbilityModel never leaks freeText (scope-filtered)', !('freeText' in exported.abilityModel));

// ======================= exportProfileBlob =======================
const blob = await librarian.exportProfileBlob();
check('exportProfileBlob returns a well-formed blob', validateProfileBlob(blob));
check('blob kind/version match the barrel-exported protocol constants', blob.kind === BLOB_KIND && blob.v === BLOB_VERSION);
check('blob carries the ability model, no memories/grants', !!blob.abilityModel && !('memories' in blob) && !('grants' in blob));

// ======================= the standalone sync helpers, used directly =======================
// A host also needs these OUTSIDE a librarian instance (e.g. validating a
// blob received from another app, or standing up a shared-store transport) —
// prove they too are reachable from the barrel, not just via `librarian.*`.
const rebuilt = buildProfileBlob(recalled.profile, model, clock.now());
check('buildProfileBlob is usable standalone from the barrel', validateProfileBlob(rebuilt));

function fileFreeSharedStore() {
  const box = {};
  return {
    async get(k) { return box[k]; },
    async set(k, v) { if (v === undefined) delete box[k]; else box[k] = v; },
    async remove(k) { delete box[k]; },
  };
}
const transport = createSharedTransport({ shared: fileFreeSharedStore(), clock });
const published = await transport.publishExports(librarian, ['demo-app']);
check('createSharedTransport is usable standalone from the barrel', published.published.includes('demo-app'));
const readBack = await transport.readExport('demo-app');
check('the published export round-trips through the shared store', !!readBack && readBack.abilityModel.needs.some(n => n.dimension === 'textSize'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
