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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
