// Phase 3 toolkit test — runs the PURE core directly (ES modules, in-memory
// KVStore, deterministic clock, no Chrome, no eval). Covers increment 1: the
// cross-app GRANT model and the read-as-a-visible-grant path.
//   1. grants.js pure schema/filter
//   2. requestGrant -> proposal -> accept -> grant -> scoped export -> revoke
//   3. the safety invariants: default-deny, consent-reuse, sender-can't-
//      self-resolve, scope-filtered/categories-only export, revoke=delete
//
//   node toolkit/test/phase3.test.mjs
import { createToolkit, GRANT_SCOPES, validateScopes, normalizeGrant, isActive, filterAbilityModelByScopes } from '../index.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}

// ======================= 1. grants.js pure =======================
check('GRANT_SCOPES is the closed whitelist', GRANT_SCOPES.join(',') === 'ability.categories,reading.level,language,settings.text');
check('validateScopes: valid subset -> true', validateScopes(['ability.categories', 'language']) === true);
check('validateScopes: unknown scope -> false', validateScopes(['ability.categories', 'settings.all']) === false);
check('validateScopes: empty -> false (default-deny)', validateScopes([]) === false);
check('validateScopes: non-array -> false', validateScopes('ability.categories') === false);

const ng = normalizeGrant({ appId: 'xr', scopes: ['language', 'bogus.scope'], grantedAt: 42 });
check('normalizeGrant: drops non-whitelisted scopes', JSON.stringify(ng.scopes) === JSON.stringify(['language']));
check('normalizeGrant: defaults appLabel to appId', ng.appLabel === 'xr');
check('isActive: appId + scopes -> true', isActive({ appId: 'xr', scopes: ['language'] }) === true);
check('isActive: no scopes -> false', isActive({ appId: 'xr', scopes: [] }) === false);
check('isActive: null -> false', isActive(null) === false);

const fullAM = { schemaVersion: 1, supportAreas: ['vision', 'cognitive'], freeText: 'secret diagnosis text', language: 'plain', readingLevel: 'simple', confidence: 0.9, needs: [{ dimension: 'textSize', value: 1.6, strength: 'floor' }] };
const projCat = filterAbilityModelByScopes(fullAM, ['ability.categories']);
check('filter ability.categories -> supportAreas only', JSON.stringify(projCat) === JSON.stringify({ schemaVersion: 1, supportAreas: ['vision', 'cognitive'] }));
check('filter ability.categories: NO freeText leak', !('freeText' in projCat) && !('confidence' in projCat));
const projText = filterAbilityModelByScopes(fullAM, ['settings.text']);
check('filter settings.text -> needs only (modality-neutral)', JSON.stringify(projText) === JSON.stringify({ schemaVersion: 1, needs: fullAM.needs }));
const projMulti = filterAbilityModelByScopes(fullAM, ['reading.level', 'language']);
check('filter merges multiple scopes', projMulti.readingLevel === 'simple' && projMulti.language === 'plain' && !('supportAreas' in projMulti));
check('filter always includes schemaVersion', filterAbilityModelByScopes(fullAM, []).schemaVersion === 1);
check('filter: export is a SUBSET of the AbilityModel (no invented fields)',
  Object.keys(filterAbilityModelByScopes(fullAM, GRANT_SCOPES)).every(k => k === 'schemaVersion' || k in fullAM));
check('filter: never emits a SurfaceProfile key (e.g. fontScale)',
  !('fontScale' in filterAbilityModelByScopes(fullAM, GRANT_SCOPES)));
// READ-ONLY boundary: the projection must COPY, never alias, the source arrays/
// objects — a consuming app mutating the export must not corrupt the source.
const isoSrc = { schemaVersion: 1, supportAreas: ['vision'], needs: [{ dimension: 'textSize', value: 1.6 }] };
const isoOut = filterAbilityModelByScopes(isoSrc, ['ability.categories', 'settings.text']);
isoOut.supportAreas.push('TAMPERED');
isoOut.needs[0].value = 999;
check('filter: export does NOT alias source supportAreas (mutation isolated)', isoSrc.supportAreas.length === 1);
check('filter: export does NOT alias source needs objects (mutation isolated)', isoSrc.needs[0].value === 1.6);

// ======================= 2 + 3. grant flow + invariants =======================
let T = 1_000_000;
const clock = { now: () => T };
const toolsRegistry = { settingsMeta: { fontScale: { type: 'number', range: [50, 200] } } };
const { datastore: ds, librarian: lib } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await ds.runMigrations();

check('mine.grants resolves to the sync area (roams)', ds.catalog()['mine.grants'].area === 'sync');

// Seed an AbilityModel to export later.
await lib.setProfileField('supportAreas', ['vision', 'cognitive']);
await lib.setProfileField('fields.readingLevel', 'simple');
await lib.setProfileField('metaPreferences.language', 'plain');
await lib.setProfileField('fields.needs', [{ dimension: 'textSize', value: 1.6, strength: 'floor' }]);

// bad scope -> rejected, NO proposal, NO grant.
const bad = await lib.requestGrant('xr-headset', ['settings.all']);
check('requestGrant bad scope rejected', bad.ok === false && bad.reason === 'bad-scope');
check('bad scope wrote no proposal', (await lib.listProposals()).length === 0);
check('bad scope wrote no grant', (await lib.listGrants()).length === 0);

// valid request -> exactly one pending grant-request proposal.
const req = await lib.requestGrant('xr-headset', ['ability.categories', 'settings.text'], { appLabel: 'XR Reader' });
check('requestGrant valid -> ok + proposalId', req.ok === true && !!req.proposalId);
const pend = await lib.listProposals('pending');
check('exactly one pending proposal, op=grant-request', pend.length === 1 && pend[0].change.op === 'grant-request' && pend[0].aspect === 'grant:xr-headset');

// DEFAULT-DENY: a pending request is NOT a grant.
const denyExport = await lib.exportAbilityModel('xr-headset');
check('default-deny: export before accept -> no-grant', denyExport.ok === false && denyExport.reason === 'no-grant');

// SENDER-CANNOT-SELF-RESOLVE: none of the app-facing methods flip the proposal.
await lib.exportAbilityModel('xr-headset');
await lib.revokeGrant('xr-headset');
await lib.requestGrant('xr-headset', ['ability.categories', 'settings.text'], { appLabel: 'XR Reader' });
check('sender methods never resolve the proposal (still pending)',
  (await lib.listProposals('pending')).every(p => p.status === 'pending')
  && (await lib.listProposals('pending')).length === 1);

// Accept on the LOCAL surface mints the grant.
const acc = await lib.respondToProposal(req.proposalId, 'accept');
check('accept applied', acc.ok && acc.status === 'accepted');
const grants = await lib.listGrants();
check('accept minted exactly one grant', grants.length === 1 && grants[0].appId === 'xr-headset');
check('grant carries scopes + grantedAt', JSON.stringify(grants[0].scopes) === JSON.stringify(['ability.categories', 'settings.text']) && grants[0].grantedAt === T);

// Scoped, categories-only export.
const exp = await lib.exportAbilityModel('xr-headset');
check('export ok after grant', exp.ok === true);
check('export has granted aspects only (supportAreas + needs)',
  JSON.stringify(exp.abilityModel.supportAreas) === JSON.stringify(['vision', 'cognitive'])
  && exp.abilityModel.needs.length === 1);
check('export omits ungranted aspects (no readingLevel/language)',
  !('readingLevel' in exp.abilityModel) && !('language' in exp.abilityModel));
check('export never leaks freeText', !('freeText' in exp.abilityModel));
// End-to-end read-only: mutating an export must not corrupt the stored profile.
exp.abilityModel.supportAreas.push('TAMPERED');
const exp2 = await lib.exportAbilityModel('xr-headset');
check('export is read-only end-to-end (re-export unaffected by mutation)',
  JSON.stringify(exp2.abilityModel.supportAreas) === JSON.stringify(['vision', 'cognitive']));

// already-granted: re-requesting a covered scope set does nothing.
const again = await lib.requestGrant('xr-headset', ['ability.categories']);
check('already-granted re-request rejected', again.ok === false && again.reason === 'already-granted');

// REVOKE = LOCAL DELETE.
const rev = await lib.revokeGrant('xr-headset');
check('revoke ok', rev.ok === true);
check('revoke deleted the grant', (await lib.listGrants()).length === 0);
check('export after revoke -> no-grant', (await lib.exportAbilityModel('xr-headset')).ok === false);
check('revoke unknown app is a no-op ok', (await lib.revokeGrant('never-existed')).ok === true);

// CONSENT-REUSE: declineOnce writes a cooldown suppression; re-request is dropped.
const req2 = await lib.requestGrant('artinsight', ['language']);
check('second app request pending', req2.ok === true);
await lib.respondToProposal(req2.proposalId, 'declineOnce');
const sup = await ds.get('mine.suppressions');
check('declineOnce wrote a cooldown suppression on grant:artinsight',
  sup.some(s => s.aspect === 'grant:artinsight' && s.mode === 'cooldown'));
const req3 = await lib.requestGrant('artinsight', ['language']);
check('re-request during cooldown is suppressed (no new pending proposal)',
  req3.ok === false && req3.reason === 'suppressed'
  && (await lib.listProposals('pending')).filter(p => p.aspect === 'grant:artinsight').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
