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
const toolsRegistry = {
  settingsMeta: { fontScale: { type: 'number', range: [50, 200] } },
  // extract()'s prompt grounds itself in the registry vocabulary (real hosts
  // pass AA_TOOLS, which has this).
  settingsVocabularyLines: () => ['- fontScale: number 50-200 (percent of base font size)'],
};
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

// ======================= 4. acting-user partition (inc 2) =======================
const kvP = memKV();
const { datastore: dsP, librarian: libP } = createToolkit({ kv: kvP, clock, toolsRegistry });
await dsP.runMigrations();

check('default acting user is null (single-user)', libP.getActingUser().id === null);

// Write data in the DEFAULT (null) partition.
await libP.recordScopedSettings('general', { darkMode: true });
await libP.setProfileField('supportAreas', ['vision']);
const nullReq = await libP.requestGrant('app-a', ['language']);
await libP.respondToProposal(nullReq.proposalId, 'accept');
check('null partition has its data',
  (await libP.getEffectivePreferences('https://x.test/', [])).settings.darkMode === true
  && (await libP.listGrants()).length === 1);

// Switch to a NAMED partition -> a clean slate (isolation).
const sw = await libP.setActingUser('alice');
check('setActingUser alice ok', sw.ok === true && sw.id === 'alice' && libP.getActingUser().id === 'alice');
check('alice partition is empty (profile/grants/prefs isolated)',
  (await libP.getEffectivePreferences('https://x.test/', [])).settings.darkMode === undefined
  && (await libP.listGrants()).length === 0
  && (await libP.getProfile()).supportAreas.length === 0);
check('alice sees no general memory shard', (await dsP.getMemoryShard('general')).length === 0);
check('alice allMemoryShards excludes the null partition', Object.keys(await dsP.allMemoryShards()).length === 0);

// Write alice-specific data, then round-trip back to null.
await libP.recordScopedSettings('general', { fontScale: 150 });
check('alice can write her own partition', (await libP.getEffectivePreferences('https://x.test/', [])).settings.fontScale === 150);
await libP.setActingUser(null);
const back = await libP.getEffectivePreferences('https://x.test/', []);
check('null data intact after round-trip; alice data not visible',
  back.settings.darkMode === true && back.settings.fontScale === undefined
  && (await libP.listGrants()).length === 1
  && (await libP.getProfile()).supportAreas[0] === 'vision');

// bad id rejected; partition unchanged.
const badId = await libP.setActingUser('has spaces!');
check('bad acting-user id rejected, partition unchanged', badId.ok === false && badId.reason === 'bad-id' && libP.getActingUser().id === null);

// Physical layout: null = ORIGINAL keys (no migration); alice under the prefix.
check('null partition at original key (back-compat, no migration)', (await kvP.get('sync', 'aa.mine.grants')).length === 1);
check('alice data under the aa.u.alice:: prefix', (await kvP.get('local', 'aa.u.alice::aa.mine.memory.general')) !== undefined);
check('null grant key contains no partition leak', JSON.stringify(await kvP.get('sync', 'aa.mine.grants')).indexOf('alice') === -1);

// helperMode flag + persistence across a fresh datastore (reload).
await libP.setActingUser('bob', { helperMode: true });
check('helperMode flag set on bob', libP.getActingUser().id === 'bob' && libP.getActingUser().helperMode === true);
const { datastore: dsP2, librarian: libP2 } = createToolkit({ kv: kvP, clock, toolsRegistry });
await dsP2.runMigrations(); // loadActingUser() restores the pointer
check('acting user persists across a fresh datastore (reload -> bob)', libP2.getActingUser().id === 'bob' && libP2.getActingUser().helperMode === true);
check('migrations stamp the partition scheme', (await dsP2.runMigrations()).partitionScheme === 1);

// ======================= 5. cross-app insight write + off switch (inc 3) =======================
const kvI = memKV();
const { datastore: dsI, librarian: libI } = createToolkit({ kv: kvI, clock, toolsRegistry });
await dsI.runMigrations();
const rq = await libI.requestGrant('xr', ['settings.text'], { appLabel: 'XR Reader' });
await libI.respondToProposal(rq.proposalId, 'accept');

check('importInsight without a grant -> no-grant (write needs the same visible grant)',
  (await libI.importInsight('rogue', { kind: 'x', change: { op: 'profile-set', path: 'fields.x', value: 1 } })).reason === 'no-grant');
check('importInsight profile-set outside fields.* rejected (no safety-switch escalation)',
  (await libI.importInsight('xr', { kind: 'escalate', change: { op: 'profile-set', path: 'sharingPaused', value: false } })).reason === 'bad-insight');
check('importInsight missing kind rejected',
  (await libI.importInsight('xr', { change: { op: 'profile-set', path: 'fields.x', value: 1 } })).reason === 'bad-insight');
// Prototype pollution: fields.__proto__.<x> must be refused at the GATE...
check('importInsight rejects a prototype-pollution path at the gate',
  (await libI.importInsight('xr', { kind: 'pp', change: { op: 'profile-set', path: 'fields.__proto__.polluted', value: 'PWNED' } })).reason === 'bad-insight');
// ...and setProfileField must never walk into Object.prototype even if called directly.
await libI.setProfileField('fields.__proto__.polluted', 'PWNED');
check('setProfileField sink refuses prototype segments (no global pollution)', ({}).polluted === undefined);
check('setProfileField prototype-poison path did not corrupt the profile', (await libI.getProfile()).polluted === undefined);

const ins = await libI.importInsight('xr', {
  kind: 'visual.textSize', confidence: 0.95, label: 'Larger text',
  rationale: 'Your headset measured your comfortable text size.',
  change: { op: 'profile-set', path: 'fields.needs', value: [{ dimension: 'textSize', value: 1.6, strength: 'preference' }] },
});
check('importInsight drafts a pending proposal', ins.ok === true && !!ins.proposalId);
const insProp = (await libI.listProposals('pending')).find(p => p.id === ins.proposalId);
check('insight proposal carries its source app + op', insProp.source === 'xr' && insProp.change.op === 'cross-app-insight');
check('NEVER SILENT: profile unchanged before accept', ((await libI.getProfile()).fields.needs || []).length === 0);
await libI.respondToProposal(ins.proposalId, 'accept');
check('accept applied the profile-set insight', (await libI.getProfile()).fields.needs[0].value === 1.6);

const ins2 = await libI.importInsight('xr', {
  kind: 'preference.captions', confidence: 1,
  change: { op: 'add-memory', record: { text: 'Needs captions', scope: 'general', settings: { autoCaptions: true }, tier: 'preference', kind: 'preference' } },
});
await libI.respondToProposal(ins2.proposalId, 'accept');
const capRec = (await dsI.getMemoryShard('general')).find(r => r.settings && r.settings.autoCaptions === true);
check('add-memory insight lands with cross-app provenance', !!capRec && capRec.source === 'cross-app:xr');
check('cross-app insight confidence capped at 0.9 (never arrives as certainty)', capRec.confidence <= 0.9);

// A cross-app app must NOT be able to mint an un-supersedable floor / a control kind.
const floorIns = await libI.importInsight('xr', {
  kind: 'preference.forcefloor', confidence: 1,
  change: { op: 'add-memory', record: { text: 'force', scope: 'general', settings: { darkMode: true }, tier: 'profile', kind: 'suppression', strength: 'floor' } },
});
await libI.respondToProposal(floorIns.proposalId, 'accept');
const forced = (await dsI.getMemoryShard('general')).filter(r => r.source === 'cross-app:xr').pop();
check('cross-app record strength clamped to preference (no un-supersedable floor)', forced.strength === 'preference');
check('cross-app record tier clamped to preference', forced.tier === 'preference');
check('cross-app record control-kind (suppression) refused', forced.kind !== 'suppression');

const ins3 = await libI.importInsight('xr', { kind: 'visual.contrast', confidence: 0.5, change: { op: 'profile-set', path: 'fields.contrast', value: 'high' } });
await libI.respondToProposal(ins3.proposalId, 'declineOnce');
const ins3b = await libI.importInsight('xr', { kind: 'visual.contrast', confidence: 0.5, change: { op: 'profile-set', path: 'fields.contrast', value: 'high' } });
check('declined insight kind is suppressed on re-import (cooldown reused)', ins3b.ok === false && ins3b.reason === 'suppressed');

await libI.setSharingPaused(true);
check('sharingPaused blocks export', (await libI.exportAbilityModel('xr')).reason === 'sharing-paused');
check('sharingPaused blocks importInsight', (await libI.importInsight('xr', { kind: 'k', change: { op: 'profile-set', path: 'fields.x', value: 1 } })).reason === 'sharing-paused');
check('sharingPaused blocks requestGrant', (await libI.requestGrant('another', ['language'])).reason === 'sharing-paused');
await libI.setSharingPaused(false);
check('unpause restores export (grants kept, not revoked)', (await libI.exportAbilityModel('xr')).ok === true);

// ======================= 6. job anchoring + migrate-on-activation (inc 3) =======================
// (a) The debounced extract is anchored to the partition that enqueued it.
const fired = [];
const manualSched = { every() {}, debounce(id, ms, fn) { fired.push(fn); } };
const { datastore: dsA, librarian: libA } = createToolkit({ kv: memKV(), clock, scheduler: manualSched, toolsRegistry });
await dsA.runMigrations();
let llmCalls = 0;
libA.setGeminiCaller(async () => { llmCalls++; return JSON.stringify({ operations: [], proposals: [] }); });
await libA.logObservation({ type: 'setting-change', text: 'x', origin: 'nytimes.com' });
await libA.setActingUser('carol');
fired[fired.length - 1]?.();                 // the debounce fires AFTER the switch
await new Promise(r => setTimeout(r, 5));
check('debounced extract skipped after a partition switch (anchored)', llmCalls === 0);
await libA.setActingUser(null);
await libA.extract();                        // periodic-net path under the right partition
check('the observation drained in ITS OWN partition later', llmCalls === 1);

// (b) A partition switch WAITS for an in-flight slow-lane job to complete.
const { datastore: dsB, librarian: libB } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await dsB.runMigrations();
let releaseLlm; const llmGate = new Promise(r => { releaseLlm = r; });
libB.setGeminiCaller(async () => { await llmGate; return JSON.stringify({ operations: [{ op: 'ADD', record: { text: 't', scope: 'general', settings: { darkMode: true }, tier: 'preference', kind: 'preference' } }], proposals: [] }); });
await libB.logObservation({ type: 'setting-change', text: 'y', origin: 'nytimes.com' });
const extractP = libB.extract();             // in flight, blocked on the gated LLM
let switched = false;
const switchP = libB.setActingUser('dave').then(() => { switched = true; });
await new Promise(r => setTimeout(r, 10));
check('setActingUser WAITS while a slow-lane job is in flight', switched === false);
releaseLlm();
await extractP; await switchP;
check('switch completed after the job drained', switched === true && libB.getActingUser().id === 'dave');
await libB.setActingUser(null);
check('the in-flight extract landed in its ORIGINAL (null) partition',
  (await dsB.getMemoryShard('general')).some(r => r.settings && r.settings.darkMode === true));

// (c) Migrate-on-activation: a named partition with legacy-shaped data is
//     swept current the moment it becomes active.
const kvM = memKV();
await kvM.set('local', 'aa.u.eve::aa.mine.memory.general', [{ id: 'l1', settings: { fontScale: 1.5 }, status: 'active', updatedAt: 5, createdAt: 5 }]);
const { datastore: dsM, librarian: libM } = createToolkit({ kv: kvM, clock, toolsRegistry });
await dsM.runMigrations();
await libM.setActingUser('eve');
const eveShard = await dsM.getMemoryShard('general');
check('migrate-on-activation: legacy multiplier coerced (1.5 -> 150)', eveShard[0].settings.fontScale === 150);
check('migrate-on-activation: lastConfirmedAt backfilled', eveShard[0].lastConfirmedAt === 5);
const pmeta = await kvM.get('local', 'aa.u.eve::aa.partitionMeta');
check('partition stamped current after activation', !!pmeta && pmeta.lastMigration === 3);
await libM.setActingUser(null);
check('null partition untouched by the sweep', (await dsM.getMemoryShard('general')).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
