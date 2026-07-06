// Smoke test for librarian.js fast lane with a chrome.storage mock.
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'extension', 'lib') + '/';

// --- chrome mock ---
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

(async () => {
  // 1. Migrations stamp
  const meta = await DS.runMigrations();
  check('migrations stamp lastMigration=3', meta.lastMigration === 3); // id 2 = settings-unit normalization, id 3 = lastConfirmedAt backfill
  check('migrations record taxonomy version', meta.taxonomyVersion === 2);

  // 2. Profile init + explicit edit
  stores.local.userProfile = { supportAreas: ['vision'], freeText: 'small text is hard' };
  const p = await L.getProfile();
  check('profile seeds from legacy userProfile', p.supportAreas.includes('vision'));
  await L.setProfileField('metaPreferences.language', 'plain');
  const p2 = await L.getProfile();
  check('setProfileField nested path', p2.metaPreferences.language === 'plain');

  // 3. Site categories: hostmap, TLD rule, caching, user override
  check('hostmap: nytimes → news', await L.getSiteCategory('www.nytimes.com') === 'news');
  check('TLD rule: irs.gov → government', await L.getSiteCategory('irs.gov') === 'government');
  check('finance host: chase → finance', await L.getSiteCategory('chase.com') === 'finance');
  await L.setSiteCategoryOverride('example.com', 'education');
  check('user override sticky', await L.getSiteCategory('example.com') === 'education');

  // 4. No-memory zones + pause
  const r1 = await L.logObservation({ origin: 'chase.com', type: 'setting-change', text: 'x' });
  check('finance observation dropped', r1.logged === false && r1.reason === 'no-memory-zone');
  const r2 = await L.logObservation({ origin: 'nytimes.com', type: 'setting-change', text: 'enabled dark mode' });
  check('news observation logged', r2.logged === true);
  await L.setOriginPaused('medium.com', true);
  const r3 = await L.logObservation({ origin: 'medium.com', type: 'setting-change', text: 'y' });
  check('paused origin dropped', r3.logged === false && r3.reason === 'origin-paused');
  await L.setMemoryPaused(true);
  const r4 = await L.logObservation({ origin: 'nytimes.com', type: 'setting-change', text: 'z' });
  check('global pause drops everything', r4.logged === false && r4.reason === 'paused');
  await L.setMemoryPaused(false);

  // 5. Effective preferences: scope precedence general < context < category < origin
  const now = Date.now();
  const mk = (scope, settings, extra = {}) => ({
    id: 'm-' + scope + '-' + Object.keys(settings)[0], text: 't', tier: 'preference', scope, kind: 'preference',
    importance: 5, confidence: 0.9, decayClass: 'stable', settings,
    occurrenceCount: 1, firstSeenAt: now, createdAt: now, updatedAt: now, lastAccessed: now,
    status: 'active', supersededBy: null, source: 'test', conditions: null, aspect: null, ...extra,
  });
  await DS.setMemoryShard('general', [mk('general', { fontScale: 110, darkMode: true })]);
  await DS.setMemoryShard('context:video', [mk('context:video', { autoCaptions: true })]);
  await DS.setMemoryShard('category:news', [mk('category:news', { fontScale: 130 })]);
  await DS.setMemoryShard('origin:nytimes.com', [mk('origin:nytimes.com', { fontScale: 150 })]);
  const prefs = await L.getEffectivePreferences('https://www.nytimes.com/article', ['video']);
  check('origin beats category beats general', prefs.settings.fontScale === 150);
  check('general survives merge', prefs.settings.darkMode === true);
  check('context contributes', prefs.settings.autoCaptions === true);
  check('category resolved', prefs.category === 'news');

  // conditions: a record active only at night, tested against current hour
  const h = new Date().getHours();
  await DS.setMemoryShard('general', [
    mk('general', { fontScale: 110 }),
    mk('general', { lineHeight: 2.5 }, { id: 'm-cond', conditions: { timeOfDay: { fromHour: (h + 2) % 24, toHour: (h + 3) % 24 } } }),
  ]);
  const prefs2 = await L.getEffectivePreferences('https://unknownsite12345.io/', []);
  check('out-of-window condition filtered', prefs2.settings.lineHeight === undefined);

  // 6. Recall block
  const rec = await L.recall('https://www.nytimes.com/article', 'enlarge text', []);
  check('recall block has core + scoped facts', rec.block.includes('About this user') && rec.block.includes('On news sites'));
  check('recall facts scored + capped', rec.facts.length > 0 && rec.facts.length <= 12);

  // 7. Proposals: draft → suppress → re-draft blocked; cooldown counting
  stores.local['aa.mine.proposals'] = [];
  const profile = await L.getProfile();
  await L._draftProposals(
    [{ aspect: 'profile.vision.fontScale', aspectLabel: 'font size', change: { op: 'profile-set', path: 'fields.vision.fontScale', value: 150 }, rationale: 'r', evidence: [] }],
    { suppressions: await DS.get('mine.suppressions'), profile, now: Date.now() });
  let props = await L.listProposals();
  check('proposal drafted', props.length === 1);
  const resp = await L.respondToProposal(props[0].id, 'suppress');
  check('suppress accepted', resp.ok && resp.status === 'suppressed');
  const sups = await DS.get('mine.suppressions');
  check('suppression stored as preference', sups.some(s => s.aspect === 'profile.vision.fontScale' && s.mode === 'permanent'));
  await L._draftProposals(
    [{ aspect: 'profile.vision.fontScale', aspectLabel: 'font size', change: { op: 'profile-set', path: 'x', value: 1 }, rationale: 'r', evidence: [] }],
    { suppressions: await DS.get('mine.suppressions'), profile, now: Date.now() });
  props = await L.listProposals();
  check('suppressed aspect not re-proposed', props.length === 0);

  // accept path applies profile-set
  await L._draftProposals(
    [{ aspect: 'profile.hearing.captions', aspectLabel: 'captions', change: { op: 'profile-set', path: 'fields.hearing.captions', value: true }, rationale: 'r', evidence: [] }],
    { suppressions: await DS.get('mine.suppressions'), profile, now: Date.now() });
  props = await L.listProposals();
  const acc = await L.respondToProposal(props[0].id, 'accept');
  const p3 = await L.getProfile();
  check('accept applies profile change', acc.ok && p3.fields?.hearing?.captions === true);

  // 8. Reflection: promotion (3 origins, same category+setting) + hygiene
  for (const o of ['cnn.com', 'bbc.com', 'reuters.com']) {
    await DS.setMemoryShard(`origin:${o}`, [mk(`origin:${o}`, { motionReducer: true })]);
  }
  // a stale task memory to expire
  await DS.setMemoryShard('origin:cnn.com', [
    ...(await DS.getMemoryShard('origin:cnn.com')),
    mk('origin:cnn.com', { x: 1 }, { id: 'm-stale', tier: 'task', decayClass: 'fast', updatedAt: now - 20 * 24 * 3600 * 1000, createdAt: now - 20 * 24 * 3600 * 1000 }),
  ]);
  const ref = await L.reflect();
  check('reflect ran', ref.ran === true);
  check('promotion: 3 origins → category fact', ref.promoted >= 1);
  const newsCat = await DS.getMemoryShard('category:news');
  check('category fact has promoted setting', newsCat.some(r => r.status === 'active' && r.settings?.motionReducer === true));
  const cnn = await DS.getMemoryShard('origin:cnn.com');
  check('origin copies superseded after promotion', cnn.some(r => r.status === 'superseded' && r.settings?.motionReducer));
  check('stale task memory expired', ref.expired >= 1);
  const views = await DS.get('mine.views');
  check('core block rendered', typeof views.coreBlock === 'string' && views.coreBlock.includes('vision'));

  // 9. deleteMemory
  const del = await L.deleteMemory('m-origin:nytimes.com-fontScale');
  const nyt = await DS.getMemoryShard('origin:nytimes.com');
  check('deleteMemory removes record', del === true && !nyt.some(r => r.id === 'm-origin:nytimes.com-fontScale'));

  // 10. interpretNeeds prompt: registry-grounded + profile-conditioned
  const inp = await L.interpretNeedsPrompt('Make text easier to read for me on news sites');
  check('prompt lists registry settings', inp.includes('- fontScale (number 50-200)') && inp.includes('- autoCaptions (boolean)'));
  check('prompt lists built-in tools', inp.includes('Visual Assist:') && inp.includes('Simplify Text:'));
  check('prompt includes profile', inp.includes('Support areas: vision') && inp.includes('small text is hard'));
  check('prompt keeps response contract', inp.includes('"newSkills"') && inp.includes('"settings"'));
  check('prompt embeds user text', inp.includes('Make text easier to read for me on news sites'));

  // 11. Reusable-task proposal: agent-task observation → proposal → accept
  //     creates an auto-apply profile action (diagram 2 implicit flow).
  stores.local['aa.mine.proposals'] = [];
  stores.local.customProfiles = [];
  const obsR = await L.logObservation({
    type: 'agent-task',
    url: 'https://www.youtube.com/watch?v=abc',
    text: 'Agent task "Turn on captions for this video" finished successfully: captions enabled',
    data: { task: 'Turn on captions for this video', summary: 'captions enabled', success: true },
  });
  check('agent-task observation logged', obsR.logged === true);
  let rProps = await L.listProposals();
  check('reusable-action proposal drafted', rProps.length === 1 && rProps[0].change.op === 'add-profile-action');
  check('proposal targets video category', rProps[0].change.siteTypes.join() === 'video');
  // duplicate observation → no second proposal (pending dedup by aspect)
  await L.logObservation({
    type: 'agent-task', url: 'https://vimeo.com/123',
    text: 'same task again',
    data: { task: 'Turn on captions for this video', summary: 'ok', success: true },
  });
  rProps = await L.listProposals();
  check('no duplicate proposal while pending', rProps.length === 1);
  const accR = await L.respondToProposal(rProps[0].id, 'accept');
  const profs = await DS.get('mine.profiles');
  const created = profs.find(p => p.siteTypes?.includes('video') && p.autoApply);
  check('accept creates auto-apply profile', accR.ok && !!created);
  check('profile carries the action prompt', created && created.actions.some(a => a.prompt === 'Turn on captions for this video'));
  // re-run of the same task after accept → no new proposal (already saved)
  await L.logObservation({
    type: 'agent-task', url: 'https://www.youtube.com/watch?v=xyz',
    text: 'again', data: { task: 'Turn on captions for this video', summary: 'ok', success: true },
  });
  check('no re-proposal after action saved', (await L.listProposals()).length === 0);
  // failed runs never propose
  await L.logObservation({
    type: 'agent-task', url: 'https://www.youtube.com/watch?v=fail',
    text: 'failed', data: { task: 'Dismiss the popup', summary: 'reached max steps', success: false },
  });
  check('failed run does not propose', (await L.listProposals()).length === 0);
  // suppress at category level gags future automation suggestions there
  await L.logObservation({
    type: 'agent-task', url: 'https://www.youtube.com/watch?v=new',
    text: 'new task', data: { task: 'Open the transcript panel', summary: 'done', success: true },
  });
  const supProps = await L.listProposals();
  check('different task proposes again', supProps.length === 1);
  await L.respondToProposal(supProps[0].id, 'suppress');
  await L.logObservation({
    type: 'agent-task', url: 'https://vimeo.com/999',
    text: 'another', data: { task: 'Mute the autoplay video', summary: 'done', success: true },
  });
  check('suppression gags category automations', (await L.listProposals()).length === 0);
  // no-memory zone: agent task on a banking site never proposes
  await L.logObservation({
    type: 'agent-task', url: 'https://www.chase.com/account',
    text: 'bank task', data: { task: 'Enlarge the statement text', summary: 'done', success: true },
  });
  check('no proposals from no-memory zones', (await L.listProposals()).length === 0);

  // 12. Explicit setting changes stick: a manual toggle must beat auto-apply
  // profiles and learned records on subsequent pages (the "my change
  // reverted" bug).
  stores.local.customProfiles = [{
    id: 'p-video', name: 'Video automations', autoApply: true,
    siteTypes: ['video'], settings: { dyslexiaFont: true, fontScale: 125 }, actions: [],
  }];
  await DS.setMemoryShard('origin:youtube.com', [mk('origin:youtube.com', { dyslexiaFont: true })]);
  await L.recordExplicitSetting('dyslexiaFont', false, 'youtube.com');
  const exPrefs = await L.getEffectivePreferences('https://www.youtube.com/watch?v=1', ['video']);
  check('explicit off beats auto-apply profile', exPrefs.settings.dyslexiaFont === false);
  check('explicit off beats origin-scope learned record', exPrefs.settings.dyslexiaFont === false);
  check('non-conflicting profile settings survive', exPrefs.settings.fontScale === 125);
  check('explicit entry marked in applied trail',
    exPrefs.applied.some(a => a.explicit && /dyslexiaFont/.test(a.text)));
  // flipping it back updates the same record instead of duplicating
  await L.recordExplicitSetting('dyslexiaFont', true, 'youtube.com');
  const genShard = await DS.getMemoryShard('general');
  const exRecs = genShard.filter(r => r.source === 'user-explicit' && r.aspect === 'setting.dyslexiaFont');
  check('explicit record updated in place, not duplicated', exRecs.length === 1);
  check('updated record carries new value', exRecs[0].settings.dyslexiaFont === true);
  const exPrefs2 = await L.getEffectivePreferences('https://www.youtube.com/watch?v=1', ['video']);
  check('flip back wins again', exPrefs2.settings.dyslexiaFont === true);
  // explicit records survive memory pause (direct command, not inference)
  await L.setMemoryPaused(true);
  await L.recordExplicitSetting('darkMode', false, null);
  const genShard2 = await DS.getMemoryShard('general');
  check('explicit setting recorded even while paused',
    genShard2.some(r => r.aspect === 'setting.darkMode' && r.settings.darkMode === false));
  await L.setMemoryPaused(false);

  // 13. Scoped explicit settings (popup "make news sites easier to read"):
  // must apply ON news sites and NOT leak to other categories.
  stores.local.customProfiles = [];
  await DS.setMemoryShard('general', []);
  await DS.setMemoryShard('category:news', []);
  const ids = await L.recordScopedSettings('category:news', { fontScale: 150, lineHeight: 1.8 });
  check('recordScopedSettings returns one id per setting', ids.length === 2);
  const newsPrefs = await L.getEffectivePreferences('https://www.nytimes.com/article', []);
  check('scoped setting applies on matching category', newsPrefs.settings.fontScale === 150
    && newsPrefs.settings.lineHeight === 1.8);
  const shopPrefs = await L.getEffectivePreferences('https://www.amazon.com/dp/x', []);
  check('scoped setting does NOT leak to other categories', shopPrefs.settings.fontScale === undefined);
  const blankPrefs = await L.getEffectivePreferences('https://unknown-xyz-9.io/', []);
  check('scoped setting does NOT leak to uncategorized sites', blankPrefs.settings.fontScale === undefined);
  // re-applying updates in place (no duplicate records)
  await L.recordScopedSettings('category:news', { fontScale: 130 });
  const newsShard = await DS.getMemoryShard('category:news');
  const fsRecs = newsShard.filter(r => r.source === 'user-explicit' && r.aspect === 'setting.fontScale');
  check('scoped re-apply updates in place', fsRecs.length === 1 && fsRecs[0].settings.fontScale === 130);
  // invalid scope falls back to general
  await L.recordScopedSettings('not a scope!!', { darkMode: true });
  const genShard3 = await DS.getMemoryShard('general');
  check('invalid scope falls back to general',
    genShard3.some(r => r.aspect === 'setting.darkMode' && r.settings.darkMode === true));

  // 13b. Delete primitive: hasScopedSetting reflects presence; removeScopedSetting
  // is the true inverse of recordScopedSettings (deletes the record, not shadows it).
  await DS.setMemoryShard('general', []);
  await DS.setMemoryShard('category:news', []);
  check('hasScopedSetting is false before any write', (await L.hasScopedSetting('category:news', 'fontScale')) === false);
  check('getScopedSetting is undefined before any write', (await L.getScopedSetting('category:news', 'fontScale')) === undefined);
  await L.recordScopedSettings('category:news', { fontScale: 175 });
  check('hasScopedSetting is true after a write', (await L.hasScopedSetting('category:news', 'fontScale')) === true);
  check('getScopedSetting returns the written value', (await L.getScopedSetting('category:news', 'fontScale')) === 175);
  const rem = await L.removeScopedSetting('category:news', 'fontScale');
  check('removeScopedSetting reports it removed a record', rem.removed === true);
  check('removeScopedSetting deletes the record (no shadow left)',
    (await DS.getMemoryShard('category:news')).every(r => r.aspect !== 'setting.fontScale'));
  const remPrefs = await L.getEffectivePreferences('https://www.nytimes.com/article', []);
  check('a removed scoped setting no longer applies', remPrefs.settings.fontScale === undefined);
  check('removeScopedSetting is idempotent', (await L.removeScopedSetting('category:news', 'fontScale')).removed === false);
  check('removeScopedSetting on an invalid scope does not throw',
    (await L.removeScopedSetting('bad!!scope', 'fontScale')).removed === false);

  // 14. Settings unit handling. Coercion (incl. the multiplier guess) now lives
  // at the WRITE boundary + a one-time migration; the READ path is clamp-only
  // (the `>10` heuristic was deleted from reads). So a RAW record inserted
  // post-migration with a multiplier is no longer second-guessed on read — it
  // is clamped to range. lineHeight 1.5 is already in range and is left alone.
  await DS.setMemoryShard('general', []);
  await DS.setMemoryShard('category:news', []);
  const badRec = mk('general', { fontScale: 1.5, lineHeight: 1.5 }, { id: 'm-bad-units', source: 'inferred' });
  await DS.setMemoryShard('general', [badRec]);
  const sanePrefs = await L.getEffectivePreferences('https://unknown-sanitize.io/', []);
  check('raw sub-range value clamped on read (no read-side multiplier guess)', sanePrefs.settings.fontScale === 50);
  check('lineHeight in-range value untouched', sanePrefs.settings.lineHeight === 1.5);
  // normalizeRecord coerces on write too (recordScopedSettings path)
  await DS.setMemoryShard('category:news', []);
  await L.recordScopedSettings('category:news', { fontScale: 2 }); // 2x -> 200%
  const newsShard2 = await DS.getMemoryShard('category:news');
  const fsRec = newsShard2.find(r => r.aspect === 'setting.fontScale');
  check('recordScopedSettings coerces multiplier on write', fsRec && fsRec.settings.fontScale === 200);
  // out-of-range high value clamps to max
  await DS.setMemoryShard('general', [mk('general', { fontScale: 999 }, { id: 'm-hi', source: 'inferred' })]);
  const clampPrefs = await L.getEffectivePreferences('https://unknown-clamp.io/', []);
  check('fontScale above range clamps to max', clampPrefs.settings.fontScale === 200);

  // 15. Provenance + specificity: on a news site, a category:news explicit
  // setting beats a (newer) general explicit one, and provenance reports the
  // scope so the popup can write a change back to the right place.
  await DS.setMemoryShard('general', []);
  await DS.setMemoryShard('category:news', []);
  await L.recordScopedSettings('category:news', { fontScale: 150 });
  await new Promise(r => setTimeout(r, 5)); // ensure newer timestamp on general
  await L.recordScopedSettings('general', { fontScale: 120 }); // newer, but less specific
  const provPrefs = await L.getEffectivePreferences('https://www.apnews.com/x', []);
  check('apnews resolves to news category', provPrefs.category === 'news');
  check('category-scoped explicit beats newer general explicit', provPrefs.settings.fontScale === 150);
  check('provenance reports the winning scope', provPrefs.provenance.fontScale === 'category:news');
  // off a news site, only the general one applies
  const offNews = await L.getEffectivePreferences('https://example-unknown-7.io/', []);
  check('off-category falls back to general explicit', offNews.settings.fontScale === 120
    && offNews.provenance.fontScale === 'general');

  // 16. Lifecycle correctness (Phase 2). (a) Downward correction: an explicit
  // user value beats a HIGHER inferred one (no LLM — explicit records get final
  // say in the merge; this is what "drop the Math.max ratchet" actually means).
  stores.local.customProfiles = [];
  await DS.setMemoryShard('general', []);
  await DS.setMemoryShard('category:news', []);
  await DS.setMemoryShard('origin:nytimes.com',
    [mk('origin:nytimes.com', { fontScale: 150 }, { id: 'm-inf-fs', source: 'inferred' })]);
  await L.recordExplicitSetting('fontScale', 90, 'nytimes.com');
  const downPrefs = await L.getEffectivePreferences('https://www.nytimes.com/x', []);
  check('explicit LOWER value beats higher inferred (downward correction)', downPrefs.settings.fontScale === 90);

  // (b) Decay measures last-confirmed, not last-accessed: a stale-but-recently-
  // surfaced record must NOT outrank a freshly-confirmed one.
  const dayMs = 24 * 3600 * 1000;
  await DS.setMemoryShard('general', [
    mk('general', { a: 1 }, { id: 'm-stale-conf', decayClass: 'fast', importance: 5, confidence: 0.9,
      lastConfirmedAt: now - 60 * dayMs, lastAccessed: now, updatedAt: now }),
    mk('general', { b: 1 }, { id: 'm-fresh-conf', decayClass: 'fast', importance: 5, confidence: 0.9,
      lastConfirmedAt: now, lastAccessed: now - 60 * dayMs, updatedAt: now }),
  ]);
  const rl = await L.recall('https://unknown-decay-9.io/', '', []);
  const sIdx = rl.facts.findIndex(f => f.id === 'm-stale-conf');
  const fIdx = rl.facts.findIndex(f => f.id === 'm-fresh-conf');
  check('fresh-confirmed outranks stale-confirmed despite recent access',
    fIdx >= 0 && (sIdx === -1 || fIdx < sIdx));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
