// Grants audience-ceiling test — PORTABILITY fix (toolkit-integration pass).
// The audience-ceiling check and the share-audit writes used to live ONLY in
// the Chrome extension's background.js message routes (host-only). This
// proves the enforcement now lives IN the portable core itself —
// core/librarian.js's exportAbilityModel/respondToProposal/revokeGrant call
// toolkit/sync/grants.js's audienceAllowed + recordShareAudit directly — so
// EVERY host (XR, a Node service, any createToolkit consumer, not just
// Chrome) gets both the enforcement and the audit trail for free.
//
//   node toolkit/test/grants-audience-test.js
import { createToolkit } from '../index.js';
import { normalizeGrant, getShareAudit } from '../sync/grants.js';

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

const T = 1_000_000;
const clock = { now: () => T };
const toolsRegistry = { settingsMeta: { fontScale: { type: 'number', range: [50, 200] } } };
const { datastore: ds, librarian: lib } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await ds.runMigrations();

await lib.setProfileField('supportAreas', ['vision']);
await lib.setProfileField('fields.needs', [{ dimension: 'textSize', value: 1.4, strength: 'preference' }]);

// ======================= 1. the ceiling itself =======================
// No UI path mints a non-'personal' grant yet (requestGrant carries no
// audience opt) — seed a 'friends'-audience grant directly in the store,
// exactly what a future "share with family" flow would produce, so the
// ceiling has something above 'personal' to actually test.
await ds.set('mine.grants', [
  normalizeGrant({ id: 'grant-1', appId: 'family-helper', appLabel: 'Family Helper', scopes: ['ability.categories'], audience: 'friends', grantedAt: T }),
]);

// Default sharing is 'personal' — narrower than the grant's 'friends' audience.
const blocked = await lib.exportAbilityModel('family-helper');
check('export refused when the grant audience (friends) exceeds the sharing ceiling (personal)', blocked.ok === false);
check('refusal reason is audience-ceiling, not no-grant', blocked.reason === 'audience-ceiling');

let audit = await getShareAudit(() => ds);
const blockedEntry = audit.find(a => a.action === 'export-blocked' && a.appId === 'family-helper');
check('the blocked export is recorded to the audit trail', !!blockedEntry);
check('the blocked entry carries the grant audience + a blocked result', blockedEntry?.audience === 'friends' && blockedEntry?.result === 'blocked');

// Raise sharing to 'friends' — the SAME grant now clears the ceiling, live,
// with no re-grant needed.
await lib.setProfileField('metaPreferences.sharing', 'friends');
const allowed = await lib.exportAbilityModel('family-helper');
check('export allowed once sharing is raised to friends (checked live, not cached)', allowed.ok === true);
check('the allowed export carries only the granted scope', JSON.stringify(allowed.abilityModel.supportAreas) === JSON.stringify(['vision']));

audit = await getShareAudit(() => ds);
const okEntry = audit.find(a => a.action === 'export' && a.appId === 'family-helper' && a.result === 'ok');
check('the successful export is recorded to the audit trail', !!okEntry);

// Lower back to 'personal' — cut off again immediately, no revoke needed.
await lib.setProfileField('metaPreferences.sharing', 'personal');
check('lowering sharing cuts the friends-audience grant off again', (await lib.exportAbilityModel('family-helper')).ok === false);

// An 'anyone'-audience grant is refused at the 'friends' ceiling too (a
// ceiling, not a binary toggle).
await ds.set('mine.grants', [...(await ds.get('mine.grants')),
  normalizeGrant({ id: 'grant-2', appId: 'community', appLabel: 'Community App', scopes: ['ability.categories'], audience: 'anyone', grantedAt: T }),
]);
await lib.setProfileField('metaPreferences.sharing', 'friends');
check('an anyone-audience grant is still refused at the friends ceiling', (await lib.exportAbilityModel('community')).ok === false);
await lib.setProfileField('metaPreferences.sharing', 'anyone');
check('an anyone-audience grant is allowed once sharing reaches anyone', (await lib.exportAbilityModel('community')).ok === true);
await lib.setProfileField('metaPreferences.sharing', 'personal');

// ======================= 2. the real grant/revoke/insight paths audit too =====
// End to end through requestGrant -> accept (mints at the default 'personal'
// audience, since no UI sets a wider one yet) -> export -> revoke, proving
// core/librarian.js itself — not a host route — is the writer.
const req = await lib.requestGrant('xr-navigator', ['ability.categories', 'settings.text'], { appLabel: 'XR Navigator' });
check('requestGrant drafts a proposal', req.ok === true);
await lib.respondToProposal(req.proposalId, 'accept');
const minted = (await lib.listGrants()).find(g => g.appId === 'xr-navigator');
check('accept mints a personal-audience grant', minted?.audience === 'personal');

audit = await getShareAudit(() => ds);
check('grant-created audit recorded by respondToProposal (core), not a host route',
  audit.some(a => a.action === 'grant-created' && a.appId === 'xr-navigator' && a.audience === 'personal'));
check('the personal grant exports fine at the personal ceiling', (await lib.exportAbilityModel('xr-navigator')).ok === true);

await lib.revokeGrant('xr-navigator');
audit = await getShareAudit(() => ds);
check('grant-revoked audit recorded by revokeGrant (core), before the delete',
  audit.some(a => a.action === 'grant-revoked' && a.appId === 'xr-navigator' && JSON.stringify(a.scopes) === JSON.stringify(['ability.categories', 'settings.text'])));
check('export after revoke is refused as no-grant (not audience-ceiling)', (await lib.exportAbilityModel('xr-navigator')).reason === 'no-grant');

// A cross-app insight, once accepted, records an insight-import audit entry.
const req2 = await lib.requestGrant('xr-navigator', ['settings.text'], { appLabel: 'XR Navigator' });
await lib.respondToProposal(req2.proposalId, 'accept');
const ins = await lib.importInsight('xr-navigator', {
  kind: 'visual.textSize', confidence: 0.8,
  change: { op: 'profile-set', path: 'fields.needs', value: [{ dimension: 'textSize', value: 1.6, strength: 'preference' }] },
});
check('importInsight drafts a proposal', ins.ok === true);
await lib.respondToProposal(ins.proposalId, 'accept');
audit = await getShareAudit(() => ds);
check('insight-import audit recorded by respondToProposal (core), not a host route',
  audit.some(a => a.action === 'insight-import' && a.appId === 'xr-navigator'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
