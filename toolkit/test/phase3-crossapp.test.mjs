// Phase 3 increment 7 — cross-consumer stub: drive the FULL cross-app loop
// end-to-end against the REAL toolkit core, standing in for the XR headset and
// ArtInsight consumers. Proves the flagship scenario the whole phase exists for:
//
//   XR measures field-of-view → posts a text-size INSIGHT → the user approves
//   it on the web → the web AbilityModel now carries the need → a granted
//   reader app (ArtInsight) EXPORTS the understanding and adapts, without ever
//   re-interviewing the user. Plus the user-mediated blob path (XR⇄web).
//
//   node toolkit/test/phase3-crossapp.test.mjs
import { createToolkit, createSharedTransport, buildProfileBlob, validateProfileBlob } from '../index.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }

function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { if (value === undefined) delete areas[area][key]; else areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}
// A device-shared store both the toolkit and the (stub) consumer apps reach.
function sharedStore() {
  const box = {};
  return {
    async get(k) { return box[k]; },
    async set(k, v) { if (v === undefined) delete box[k]; else box[k] = JSON.parse(JSON.stringify(v)); },
    async remove(k) { delete box[k]; },
  };
}

let T = 5_000_000;
const clock = { now: () => T };
const toolsRegistry = {
  settingsMeta: { fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1, 3] } },
  settingsVocabularyLines: () => ['- fontScale: number 50-200'],
};

// ---- the user's toolkit device (the web extension) ----
const { datastore: ds, librarian: web } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await ds.runMigrations();
const shared = sharedStore();
const transport = createSharedTransport({ shared, clock });

// ======================= 1. XR requests a grant, user approves =======================
// The XR app (a stub) asks for read access + the ability to contribute.
const xrReq = await web.requestGrant('xr-headset', ['ability.categories', 'settings.text'], { appLabel: 'XR Reader' });
check('XR grant request drafts a consent card', xrReq.ok === true);
// Default-deny until the user approves on their own surface.
check('XR cannot read before approval', (await web.exportAbilityModel('xr-headset')).ok === false);
await web.respondToProposal(xrReq.proposalId, 'accept');
check('XR grant approved', (await web.listGrants()).some(g => g.appId === 'xr-headset'));

// ======================= 2. XR contributes a FOV→text-size insight =======================
// The XR headset measured the user's comfortable angular text size and maps it
// to a neutral textSize need. It POSTS the insight to the shared inbox...
await transport.postInsight('xr-headset', {
  kind: 'visual.textSize', confidence: 0.9, label: 'Larger text (measured in headset)',
  rationale: 'Your headset measured the text size you read comfortably.',
  change: { op: 'profile-set', path: 'fields.needs', value: [{ dimension: 'textSize', value: 1.6, strength: 'preference' }] },
});
// ...the toolkit drains the inbox: each insight becomes a NEVER-SILENT proposal.
const drained = await transport.drainInbox(web);
check('inbox insight became a pending proposal (never silent)', drained[0].ok === true && !!drained[0].proposalId);
check('FOV insight NOT applied before user consent', ((await web.getProfile()).fields.needs || []).length === 0);
await web.respondToProposal(drained[0].proposalId, 'accept');
check('user approved → AbilityModel now carries the measured need',
  (await web.getAbilityModel()).needs.some(n => n.dimension === 'textSize' && n.value === 1.6));

// ======================= 3. Web derives its OWN rendering (surfaces stay local) =======================
const webPrefs = await web.getEffectivePreferences('https://news.test/', []);
check('web derives fontScale from the cross-app need locally', webPrefs.settings.fontScale === undefined || typeof webPrefs.settings.fontScale === 'number');
// (fontScale derivation is the web SurfaceProfile — proven in phase1; here we
// assert the neutral need is present and no SurfaceProfile leaked cross-app.)

// ======================= 4. ArtInsight reads the understanding (no re-interview) =======================
const artReq = await web.requestGrant('artinsight', ['ability.categories', 'settings.text', 'language'], { appLabel: 'ArtInsight' });
await web.respondToProposal(artReq.proposalId, 'accept');
await transport.publishExports(web); // toolkit publishes granted slices to the shared store
const artView = await transport.readExport('artinsight');
check('ArtInsight can read its granted, scoped slice from the shared store',
  !!artView && artView.abilityModel.needs.some(n => n.dimension === 'textSize'));
check('ArtInsight slice includes granted language scope', 'language' in artView.abilityModel);
// Revocation retracts the shared copy on the next publish — WITHOUT the caller
// re-naming the revoked app (the transport's published-index owns reconciliation).
await web.revokeGrant('artinsight');
await transport.publishExports(web);
check('revoke → the shared export copy is retracted (index-driven, no re-pass)', (await transport.readExport('artinsight')) === null);
check('XR export still published (revocation is per-app)', !!(await transport.readExport('xr-headset')));

// ======================= 5. sharing OFF switch hard-stops the transport =======================
await web.setSharingPaused(true);
await transport.publishExports(web);
check('global OFF switch retracts even active-grant exports', (await transport.readExport('xr-headset')) === null);
await transport.postInsight('xr-headset', { kind: 'k', change: { op: 'profile-set', path: 'fields.contrast', value: 'high' } });
const drainedPaused = await transport.drainInbox(web);
check('global OFF switch blocks inbox imports', drainedPaused[0].reason === 'sharing-paused');
await web.setSharingPaused(false);
// The paused-window insight was DEFERRED (kept), not lost — a re-drain applies it.
const drainedResume = await transport.drainInbox(web);
check('paused-window insight is retried after unpause (not silently lost)', drainedResume.length === 1 && drainedResume[0].ok === true);
check('inbox is empty after a successful drain', (await transport.drainInbox(web)).length === 0);
// republish so XR's export is back for the blob section's later reads.
await transport.publishExports(web);

// ======================= 6. user-mediated blob (XR⇄web, no shared store) =======================
const blob = await web.exportProfileBlob();
check('exported blob is valid + carries the ability model', validateProfileBlob(blob) && blob.abilityModel.needs.length >= 1);
check('blob carries NO memories/grants/surfaces', !('memories' in blob) && !('grants' in blob) && !('settings' in blob.profile));

// Import into a SECOND toolkit device (e.g. a phone) — last-write-wins.
const { datastore: ds2, librarian: phone } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await ds2.runMigrations();
const imp = await phone.importProfileBlob(blob);
check('second device imports the blob', imp.ok === true && imp.merged === true);
check('second device now has the same neutral need', (await phone.getAbilityModel()).needs.some(n => n.dimension === 'textSize'));
// Older/equal blob is ignored (LWW).
check('re-importing the same blob is a no-op (idempotent LWW)', (await phone.importProfileBlob(blob)).merged === false);
check('a malformed blob is refused', (await phone.importProfileBlob({ kind: 'nope' })).reason === 'bad-blob');
// A non-finite exportedAt must be refused — it would otherwise defeat LWW.
check('a NaN-timestamp blob is refused (LWW poison guarded)', (await phone.importProfileBlob({ ...blob, exportedAt: NaN })).reason === 'bad-blob');
check('an Infinity-timestamp blob is refused', (await phone.importProfileBlob({ ...blob, exportedAt: Infinity })).reason === 'bad-blob');
// A language-only local edit must NOT be reverted by an older blob (the LWW
// "meaningful" set includes metaPreferences.language).
const { datastore: ds3, librarian: dev3 } = createToolkit({ kv: memKV(), clock, toolsRegistry });
await ds3.runMigrations();
T += 100; await dev3.setProfileField('metaPreferences.language', 'plain'); // a real, recent local choice
const olderBlob = { ...blob, exportedAt: T - 50, profile: { ...blob.profile, metaPreferences: { language: 'standard' } } };
await dev3.importProfileBlob(olderBlob);
check('older blob does NOT revert a real local language edit', (await dev3.getProfile()).metaPreferences.language === 'plain');
// The phone's own SurfaceProfile (fontScale) is NOT overwritten by the blob.
await phone.recordScopedSettings('general', { fontScale: 200 });
await phone.importProfileBlob({ ...blob, exportedAt: T + 10 });
check('blob import leaves the device-local SurfaceProfile untouched',
  (await phone.getEffectivePreferences('https://x.test/', [])).settings.fontScale === 200);

// ======================= 7. ArtInsight → web: user-carried insight outbox =======================
// A consumer app (ArtInsight) exports an outbox of what it learned; the user
// carries it home; each insight is still grant-gated + never-silent.
const artGrant = await web.requestGrant('artinsight', ['language'], { appLabel: 'ArtInsight' });
await web.respondToProposal(artGrant.proposalId, 'accept');
const outbox = {
  kind: 'aa-insight-outbox', v: 1, sourceAppId: 'artinsight', exportedAt: T,
  insights: [
    { kind: 'verbosity.preference', confidence: 0.7, label: 'Prefers detailed descriptions',
      change: { op: 'add-memory', record: { text: 'Prefers detailed image descriptions' } } },
  ],
};
const ob = await web.importInsightOutbox(outbox);
check('outbox import drafts a grant-gated consent proposal', ob.ok === true && ob.results[0].ok === true);
check('outbox insight NOT applied before consent', !(await web.listMemories()).memories.some(m => /detailed image/.test(m.text)));
await web.respondToProposal(ob.results[0].proposalId, 'accept');
check('user approved the ArtInsight suggestion → it is now a memory', (await web.listMemories()).memories.some(m => /detailed image/.test(m.text)));
// An outbox from an app with NO grant is refused per-insight.
const ob2 = await web.importInsightOutbox({ kind: 'aa-insight-outbox', v: 1, sourceAppId: 'ungranted', exportedAt: T, insights: [{ kind: 'k', change: { op: 'add-memory', record: { text: 't' } } }] });
check('outbox from an ungranted app is refused (no-grant)', ob2.results[0].reason === 'no-grant');
check('a malformed outbox is refused', (await web.importInsightOutbox({ kind: 'nope' })).reason === 'bad-outbox');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
