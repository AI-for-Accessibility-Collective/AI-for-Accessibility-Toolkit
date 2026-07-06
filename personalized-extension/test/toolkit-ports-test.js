// Phase 0 port-seam regression test — companion to librarian-test.js.
//
// librarian-test.js covers the fast lane + reflection comprehensively. This
// file covers the paths the carve-out specifically touched but that the gate
// did NOT exercise:
//   A. respondToProposal evidence-confidence boost — the former direct
//      `chrome.storage.local.get(null)` scan, now Datastore.allMemoryShards().
//   B. listMemories — also a former direct local scan.
//   C. the slow lane extract() against a fake LLM — clock.now(), the cursor,
//      registry-grounded prompt, idempotency.
//   D. the demo-mode origin fallback the `const`->`let` fix unblocked (the
//      original threw a const-reassignment error on this path).
//
// Loads the BUILT lib/*.js bundles (the real shipped artifacts), same as
// librarian-test.js — so it also proves the toolkit ES-module source survives
// esbuild + classic-script eval with the chrome mock.
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'extension', 'lib') + '/';

// --- chrome mock (identical to librarian-test.js) ---
const stores = { local: {}, sync: {} };
function mkArea(name) {
  return {
    get(keys, cb) {
      let out;
      if (keys === null) out = { ...stores[name] };
      else if (typeof keys === 'string') out = { [keys]: stores[name][keys] };
      else out = Object.fromEntries(keys.map(k => [k, stores[name][k]]));
      if (cb) cb(out); else return Promise.resolve(out);
    },
    set(obj, cb) { Object.assign(stores[name], JSON.parse(JSON.stringify(obj))); if (cb) cb(); else return Promise.resolve(); },
  };
}
globalThis.chrome = {
  storage: { local: mkArea('local'), sync: mkArea('sync'), onChanged: { addListener() {} } },
  runtime: { lastError: null },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { query: async () => [] },
};

eval(fs.readFileSync(path + 'taxonomy.js', 'utf8'));
eval(fs.readFileSync(path + 'tools-registry.js', 'utf8'));
eval(fs.readFileSync(path + 'datastore.js', 'utf8'));
eval(fs.readFileSync(path + 'librarian.js', 'utf8'));

const L = globalThis.Librarian;
const DS = globalThis.Datastore;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
const now = Date.now();
const mk = (scope, settings, extra = {}) => ({
  id: 'm-' + scope + '-' + Object.keys(settings)[0], text: 't', tier: 'preference', scope, kind: 'preference',
  importance: 5, confidence: 0.7, decayClass: 'stable', settings,
  occurrenceCount: 1, firstSeenAt: now, createdAt: now, updatedAt: now, lastAccessed: now,
  status: 'active', supersededBy: null, source: 'test', conditions: null, aspect: null, ...extra,
});

(async () => {
  await DS.runMigrations();

  // A. evidence-confidence boost on accept (allMemoryShards scan across shards)
  await DS.setMemoryShard('general', [mk('general', { darkMode: true }, { id: 'ev-1', confidence: 0.7 })]);
  await DS.setMemoryShard('category:news', [mk('category:news', { fontScale: 130 }, { id: 'ev-2', confidence: 0.5 })]);
  stores.local['aa.mine.proposals'] = [{
    id: 'p-ev', aspect: 'profile.x', aspectLabel: 'x',
    change: { op: 'profile-set', path: 'fields.x', value: 1 },
    rationale: 'r', evidence: ['ev-1', 'ev-2'], status: 'pending', createdAt: now, respondedAt: null,
  }];
  const r = await L.respondToProposal('p-ev', 'accept');
  const gen = await DS.getMemoryShard('general');
  const news = await DS.getMemoryShard('category:news');
  check('accept applied', r.ok && r.status === 'accepted');
  check('evidence ev-1 confidence boosted +0.1', Math.abs(gen.find(x => x.id === 'ev-1').confidence - 0.8) < 1e-9);
  check('evidence ev-2 (other shard) boosted +0.1', Math.abs(news.find(x => x.id === 'ev-2').confidence - 0.6) < 1e-9);

  // B. listMemories enumerates all shards + returns suppressions
  const lm = await L.listMemories();
  check('listMemories finds ev-1 with scope', lm.memories.some(m => m.id === 'ev-1' && m.scope === 'general'));
  check('listMemories finds ev-2 with scope', lm.memories.some(m => m.id === 'ev-2' && m.scope === 'category:news'));
  check('listMemories status filter works',
    (await L.listMemories({ status: 'active' })).memories.every(m => m.status === 'active'));
  check('listMemories returns suppressions array', Array.isArray(lm.suppressions));

  // C. slow lane extract() with a fake LLM (clock + DS calls + cursor + grounding)
  let captured = null;
  L.setGeminiCaller(async (prompt) => {
    captured = prompt;
    return JSON.stringify({
      operations: [{ op: 'ADD', record: { text: 'prefers dark mode on news', scope: 'category:news', settings: { darkMode: true }, tier: 'preference', kind: 'preference', importance: 6, confidence: 0.8, decayClass: 'slow' } }],
      proposals: [],
    });
  });
  stores.local['aa.mine.episodicLog'] = { cursor: 0, entries: [
    { id: 1, t: now, type: 'setting-change', weight: 3, origin: 'nytimes.com', category: 'news', data: {}, text: 'enabled dark mode' },
  ] };
  const ex = await L.extract();
  check('extract ran', ex.ran === true && ex.applied.ADD === 1);
  check('extract advanced cursor', (await DS.get('mine.episodicLog')).cursor === 1);
  check('extract prompt grounded in registry units', captured.includes('fontScale'));
  const newsAfter = await DS.getMemoryShard('category:news');
  check('extract ADD landed in scope', newsAfter.some(x => x.settings && x.settings.darkMode === true && x.source === 'inferred'));
  check('extract idempotent (cursor drained)', (await L.extract()).reason === 'empty');

  // D. demo-mode origin fallback (the const->let fix): agent-task with NO
  //    origin, demo on, must fall back to youtube.com/video and propose.
  globalThis.AA_DEMO_MODE = true;
  stores.local['aa.mine.proposals'] = [];
  stores.local.customProfiles = [];
  const dr = await L.logObservation({
    type: 'agent-task', text: 'did a thing',
    data: { task: 'Turn on captions', summary: 'ok', success: true },
    // deliberately no url / origin
  });
  check('demo agent-task with no origin logged', dr.logged === true);
  const dprops = await L.listProposals();
  check('demo fallback proposed a reusable action', dprops.length === 1 && dprops[0].change.siteTypes.join() === 'video');
  globalThis.AA_DEMO_MODE = false;

  // E. Phase 2 lifecycle ops (LLM-gated, so exercised here via the fake caller):
  //    CONTRADICT lowers confidence; SUPERSEDE refuses to retire a `floor`;
  //    NOOP/UPDATE bump lastConfirmedAt.
  await DS.setMemoryShard('origin:nytimes.com', [
    mk('origin:nytimes.com', { darkMode: true }, { id: 'c-pref', confidence: 0.7, strength: 'preference' }),
    mk('origin:nytimes.com', { autoCaptions: true }, { id: 'c-floor', confidence: 0.9, strength: 'floor', lastConfirmedAt: now - 100000 }),
    mk('origin:nytimes.com', { motionReducer: true }, { id: 'c-noop', confidence: 0.7, lastConfirmedAt: now - 100000 }),
  ]);
  stores.local['aa.mine.episodicLog'] = { cursor: 1000, entries: [
    { id: 1001, t: now, type: 'setting-change', weight: 3, origin: 'nytimes.com', category: 'news', data: {}, text: 'flipped some things' },
  ] };
  L.setGeminiCaller(async () => JSON.stringify({ operations: [
    { op: 'CONTRADICT', id: 'c-pref' },
    { op: 'SUPERSEDE', id: 'c-floor', record: { text: 'no captions', scope: 'origin:nytimes.com', settings: { autoCaptions: false } } },
    { op: 'NOOP', id: 'c-noop' },
  ], proposals: [] }));
  const exL = await L.extract();
  const shardL = await DS.getMemoryShard('origin:nytimes.com');
  const cPref = shardL.find(r => r.id === 'c-pref');
  const cFloor = shardL.find(r => r.id === 'c-floor');
  const cNoop = shardL.find(r => r.id === 'c-noop');
  check('extract counted the CONTRADICT op', exL.applied.CONTRADICT === 1);
  check('CONTRADICT lowered confidence (0.7 -> 0.5), record stays active',
    Math.abs(cPref.confidence - 0.5) < 1e-9 && cPref.status === 'active');
  check('SUPERSEDE refused on a floor record (still active, not superseded)',
    cFloor.status === 'active' && !cFloor.supersededBy);
  check('floor SUPERSEDE downgraded to a confidence drop (0.9 -> 0.7)',
    Math.abs(cFloor.confidence - 0.7) < 1e-9);
  check('NOOP reconfirmation bumped lastConfirmedAt', cNoop.lastConfirmedAt >= now);

  // F. Phase 2 inc 3-4: reflection grounding, memoryClass label, behavior-
  //    summary view, and the evidence-discard prune.
  // F1. Grounding — an ADDed fact cites the episodic-log ids it was distilled
  //     from (episodic id-space, distinct from a proposal's record-id evidence).
  await DS.setMemoryShard('category:education', []);
  stores.local['aa.mine.episodicLog'] = { cursor: 2000, entries: [
    { id: 2001, t: now, type: 'setting-change', weight: 3, origin: 'coursera.org', category: 'education', data: {}, text: 'enabled dark mode' },
    { id: 2002, t: now, type: 'setting-change', weight: 3, origin: 'coursera.org', category: 'education', data: {}, text: 'enabled dark mode again' },
  ] };
  L.setGeminiCaller(async () => JSON.stringify({ operations: [
    { op: 'ADD', record: { text: 'prefers dark mode on education sites', scope: 'category:education', settings: { darkMode: true }, tier: 'preference', kind: 'preference', importance: 6, confidence: 0.8, decayClass: 'slow' } },
  ], proposals: [] }));
  await L.extract();
  const eduShard = await DS.getMemoryShard('category:education');
  const grounded = eduShard.find(r => r.settings && r.settings.darkMode === true);
  check('grounding: ADDed fact cites the consumed episodic entry ids',
    grounded && JSON.stringify(grounded.evidence) === JSON.stringify([2001, 2002]));

  // F2. listMemories stamps the derived memoryClass (additive, non-persisted).
  const lmEdu = await L.listMemories({ scope: 'category:education' });
  check('listMemories stamps memoryClass=semantic on a preference',
    lmEdu.memories.find(m => m.id === grounded.id)?.memoryClass === 'semantic');
  check('memoryClass is NOT persisted to the shard',
    (await DS.getMemoryShard('category:education'))[0].memoryClass === undefined);

  // F3 + F4. One reflect() that exercises BOTH the behavior-summary view and
  //          the evidence-discard prune. Discard scenario: 3001 is old +
  //          processed + uncited (drop); 3002 is old + processed but cited by an
  //          active record (keep its lineage); 3003 is unprocessed (keep).
  const OLD = now - 40 * 24 * 3600 * 1000; // outside the 7-day grace
  stores.local['aa.mine.episodicLog'] = { cursor: 3002, entries: [
    { id: 3001, t: OLD, type: 'observation', weight: 1, origin: 'x.test', category: null, data: {}, text: 'old uncited' },
    { id: 3002, t: OLD, type: 'observation', weight: 1, origin: 'x.test', category: null, data: {}, text: 'old but cited' },
    { id: 3003, t: now, type: 'observation', weight: 1, origin: 'x.test', category: null, data: {}, text: 'unprocessed' },
  ] };
  await DS.setMemoryShard('origin:x.test', [mk('origin:x.test', { darkMode: true }, { id: 'cite-r', evidence: [3002] })]);
  const rfl = await L.reflect();
  const views = await DS.get('mine.views');
  check('reflect builds a deterministic behaviorSummary view',
    views.behaviorSummary && typeof views.behaviorSummary.text === 'string' && views.behaviorSummary.counts.semantic >= 1);
  check('behaviorSummary lists the education category adaptation',
    views.behaviorSummary.categories.includes('education'));
  const logAfter = await DS.get('mine.episodicLog');
  const idsAfter = logAfter.entries.map(e => e.id);
  check('evidence-discard dropped the old, processed, UNCITED entry', !idsAfter.includes(3001));
  check('evidence-discard KEPT the still-cited entry (lineage)', idsAfter.includes(3002));
  check('evidence-discard KEPT the unprocessed entry', idsAfter.includes(3003));
  check('reflect reports a discarded count', rfl.discarded >= 1);

  // F5. id-allocator guard: after a prune, a new observation must get an id
  //     strictly above the cursor (never reissue a pruned id <= cursor).
  await L.logObservation({ type: 'setting-change', text: 'post-prune', origin: 'x.test' });
  const logNew = await DS.get('mine.episodicLog');
  check('post-prune observation got an id above the cursor',
    logNew.entries[logNew.entries.length - 1].id > logNew.cursor);

  // G. Phase 3 inc 1: cross-app grant flow against the BUILT bundle (proves the
  //    toolkit/sync module bundles + works under esbuild + classic-script eval).
  await L.setProfileField('supportAreas', ['vision']);
  await L.setProfileField('metaPreferences.language', 'plain');
  const gReq = await L.requestGrant('xr-headset', ['ability.categories', 'language'], { appLabel: 'XR Reader' });
  check('grant: requestGrant drafts a pending proposal', gReq.ok === true && !!gReq.proposalId);
  check('grant: default-deny before accept', (await L.exportAbilityModel('xr-headset')).ok === false);
  await L.respondToProposal(gReq.proposalId, 'accept');
  const gList = await L.listGrants();
  check('grant: accept minted the grant', gList.some(g => g.appId === 'xr-headset'));
  const gExp = await L.exportAbilityModel('xr-headset');
  check('grant: scoped export returns granted aspects only',
    gExp.ok === true && JSON.stringify(gExp.abilityModel.supportAreas) === JSON.stringify(['vision'])
    && gExp.abilityModel.language === 'plain' && !('readingLevel' in gExp.abilityModel));
  check('grant: export never leaks a SurfaceProfile key', !('fontScale' in gExp.abilityModel));
  await L.revokeGrant('xr-headset');
  check('grant: revoke = delete (export now denied)', (await L.exportAbilityModel('xr-headset')).ok === false);
  check('grant store lives in the sync area', DS.catalog()['mine.grants'].area === 'sync');

  // H. Phase 3 inc 2: acting-user partition against the BUILT bundle (proves
  //    the datastore's key-derivation survives esbuild + classic-script eval).
  check('default acting user is null', L.getActingUser().id === null);
  await L.setActingUser('guest');
  check('switched to guest partition', L.getActingUser().id === 'guest');
  await L.recordScopedSettings('origin:guesttest.com', { fontScale: 175 });
  check('guest sees its own write', (await L.getEffectivePreferences('https://guesttest.com/', [])).settings.fontScale === 175);
  check('guest data stored under the aa.u.guest:: prefix', stores.local['aa.u.guest::aa.mine.memory.origin:guesttest.com'] !== undefined);
  await L.setActingUser(null);
  check('null partition does NOT see the guest write (isolation)',
    (await L.getEffectivePreferences('https://guesttest.com/', [])).settings.fontScale === undefined);

  // I. Phase 3 inc 3: cross-app insight write + global off switch (BUILT bundle).
  const gArt = await L.requestGrant('artapp', ['language'], { appLabel: 'ArtInsight' });
  await L.respondToProposal(gArt.proposalId, 'accept');
  const insB = await L.importInsight('artapp', {
    kind: 'reading.level', confidence: 0.8,
    change: { op: 'profile-set', path: 'fields.readingLevel', value: 'simple' },
  });
  check('insight drafted as a proposal via built bundle', insB.ok === true && !!insB.proposalId);
  check('insight is NOT applied before accept', ((await L.getProfile()).fields || {}).readingLevel === undefined);
  await L.respondToProposal(insB.proposalId, 'accept');
  check('accepted insight applied readingLevel', (await L.getProfile()).fields.readingLevel === 'simple');
  await L.setSharingPaused(true);
  check('sharingPaused blocks export (bundle)', (await L.exportAbilityModel('artapp')).reason === 'sharing-paused');
  await L.setSharingPaused(false);
  check('unpause restores the grant (bundle)', (await L.exportAbilityModel('artapp')).ok === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
