// End-to-end SCENARIO tests — exercise the whole toolkit the way a real
// person's session would, not module-by-module. One in-memory datastore +
// Librarian + a scripted Engineer LLM drive the actual diagram flows:
//
//   A. Explicit skill creation: reuse check → Engineer build → a weak first
//      attempt the person REJECTS with feedback → revision → save → the
//      profile/memory records the ability context → retrieve + resolve.
//   B. Implicit reusable task: agent run → proposal → accept → BOTH the
//      auto-replay profile action AND a Skills-db skill, with the edge cases
//      (dedup while pending, idempotent re-run, name-collision safety, failed
//      runs, no-memory zones).
//   C. Cross-app privacy: the sharing ceiling gates every export live
//      (Librarian.exportAbilityModel + toolkit/sync/grants.js), and an
//      adversarial app's insights are validated, consent-gated, and defanged
//      even if accepted (capped strength, no control kinds, clamped
//      settings) — never able to leak raw memory or escalate privilege.
//   D. Engineer robustness: the parser/validator survives the messy things a
//      real LLM emits (preamble, wrapped fences, bad values, mixed recipes).
//
// No browser, no network. Run: node toolkit/test/scenario-test.js
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSkill, resolveSkill, validateSkill, matchSkill } from '../core/skill.js';
import { parseBuiltSkill } from '../core/skill-builder.js';
import { createDatastore } from '../core/datastore.js';
import { createLibrarian } from '../core/librarian.js';
import { normalizeGrant, getShareAudit } from '../sync/grants.js';
import { TAXONOMY } from '../core/taxonomy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'skills', 'builtin');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
// ---- a faithful tools registry (matches the real adapter ids/settings) -----
const SETTINGS_META = {
  fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1.0, 3.0] },
  letterSpacing: { type: 'number', range: [0, 0.5] }, darkMode: { type: 'boolean' },
  focusMode: { type: 'boolean' }, hideDistractions: { type: 'boolean' }, showProgress: { type: 'boolean' },
  motionReducer: { type: 'boolean' }, readerMode: { type: 'boolean' }, keyboardNav: { type: 'boolean' },
  enhanceFocus: { type: 'boolean' }, readingGuide: { type: 'boolean' }, autoDescribe: { type: 'boolean' },
  autoCaptions: { type: 'boolean' }, autoSimplify: { type: 'boolean' }, largeCursor: { type: 'boolean' },
  colorBlindMode: { type: 'enum', options: ['none', 'protanopia', 'deuteranopia', 'tritanopia'] },
};
const REGISTRY_IDS = ['auto-alt-text', 'auto-captions', 'color-filter', 'dark-mode', 'dyslexia-font',
  'fix-contrast', 'focus-mode', 'generate-captions', 'generate-labels', 'keyboard-nav', 'large-cursor',
  'motion-reducer', 'read-aloud', 'reader-mode', 'simplify-text', 'visual-assist', 'voice-commands', 'wcag-fixes'];
const TOOLS = {
  settingsMeta: SETTINGS_META,
  byId: (id) => REGISTRY_IDS.includes(id) ? { id } : null,
  forPrompt: () => REGISTRY_IDS.map(id => ({ id, name: id, description: `the ${id} adapter`, supportAreas: ['vision', 'reading'] })),
  settingsVocabularyLines: () => Object.entries(SETTINGS_META).map(([k, m]) =>
    `- ${k}: ${m.type}${m.range ? ` ${m.range[0]}–${m.range[1]}` : ''}${m.options ? ` (${m.options.join('|')})` : ''}`),
};

// Real built-in skills, parsed from disk — the same ones the extension ships.
const BUILTINS = readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.md'))
  .map(f => parseSkill(readFileSync(join(BUILTIN_DIR, f), 'utf8')));

// ---- a scripted Engineer: realistic SKILL.md, weak first, strong on revision
// Records the last prompt it saw so a test can prove the revision loop carried
// the previous attempt + feedback.
function makeEngineer() {
  const state = { lastPrompt: null, calls: 0 };
  const llm = async (prompt) => {
    state.lastPrompt = prompt;
    state.calls++;
    if (!/Author a SKILL\.md/.test(prompt)) return '{}'; // not a build call (e.g. a stray extract)
    const revision = prompt.includes('The person tried it and said:');
    const fontScale = revision ? 175 : 105; // first attempt too small on purpose
    const doc = [
      '---',
      'name: big-calm-news',
      'description: Large, calm news reading. Use on news and article pages for low-vision readers.',
      'supportAreas: [vision, reading]',
      'siteRelevance: [news]',
      '---',
      '# Big Calm News',
      'Makes long news articles large and calm.',
      '## Recipe',
      '```json',
      JSON.stringify({ adapters: [
        { id: 'visual-assist', settings: { fontScale, lineHeight: 1.8, enhanceFocus: true, readingGuide: true } },
        { id: 'focus-mode', settings: { focusMode: true, hideDistractions: true } },
      ] }, null, 2),
      '```',
    ].join('\n');
    return '```markdown\n' + doc + '\n```'; // realistic: model wraps the whole doc
  };
  return { llm, state };
}

// ---- system factory: fresh in-memory toolkit each scenario -----------------
// In-memory ports, shaped like the chain's KVStore port (get/set/getAll per
// area) — see toolkit/ports/index.js and platforms/chrome/ports.js chromeKV.
function makeSystem() {
  const mem = { local: {}, sync: {} };
  const kv = {
    async get(area, key) { return mem[area][key] === undefined ? undefined : structuredClone(mem[area][key]); },
    async set(area, key, value) { mem[area][key] = structuredClone(value); },
    async getAll(area) { return structuredClone(mem[area]); },
  };
  let t = 1_700_000_000_000; // fixed start; advance() gives monotonic time
  const clock = { now: () => t };
  const advance = (ms) => { t += ms; };
  const datastore = createDatastore({ kv, clock, taxonomy: TAXONOMY, toolsRegistry: TOOLS, builtinSkills: BUILTINS });
  const librarian = createLibrarian({ datastore, taxonomy: TAXONOMY, clock });
  return { mem, datastore, librarian, clock, advance };
}

// ===========================================================================
// SCENARIO A — explicit skill creation, full journey with a rejection loop
// ===========================================================================
async function scenarioA() {
  console.log('\n--- Scenario A: explicit skill creation ---');
  const { librarian: L, datastore: DS, advance } = makeSystem();
  const eng = makeEngineer();
  L.setGeminiCaller(eng.llm);

  // Cold start: the person describes low vision + a reading need.
  await L.setProfileField('supportAreas', ['vision', 'reading']);
  await L.setProfileField('freeText', 'Low vision, I read a lot of news and long articles');

  // Reuse check: a real reading need should surface the built-in reading-aid
  // BEFORE the Engineer is ever asked.
  const reuse = await L.findSkillForNeed('make the text easier to read on news sites');
  check('A: reuse check finds a built-in reading skill', reuse && reuse.name === 'reading-aid' && reuse.source === 'builtin');

  // A clearly unrelated need finds nothing → the Engineer will be asked.
  const noReuse = await L.findSkillForNeed('play a louder chime for alerts');
  check('A: reuse check returns null for an unrelated need', noReuse === null);
  check('A: reuse check did not call the Engineer', eng.state.calls === 0);

  // Build: first attempt (the Engineer returns fontScale 105 — too small).
  const first = await L.buildSkill('a big, calm reading layout tuned for me');
  check('A: Engineer produced a valid first skill', first.valid && first.skill.name === 'big-calm-news');
  check('A: first attempt is deliberately weak (small text)', resolveSkill(first.skill).settings.fontScale === 105);
  check('A: nothing saved before the person validates', (await L.listSkills()).every(s => s.source === 'builtin'));

  // Reject with feedback → revision. The revised skill must be bigger AND the
  // Engineer must actually have received the previous attempt + the feedback.
  advance(5000);
  const revised = await L.buildSkill('a big, calm reading layout tuned for me', {
    previous: first.skill, feedback: 'the text is still far too small',
  });
  check('A: revision carried the previous skill into the prompt', eng.state.lastPrompt.includes('name: big-calm-news'));
  check('A: revision carried the feedback into the prompt', eng.state.lastPrompt.includes('far too small'));
  check('A: revised skill is larger', resolveSkill(revised.skill).settings.fontScale === 175);

  // Save (the consent gate). Now it is mine and retrievable.
  const saved = await L.saveSkill(revised.skill);
  check('A: save succeeds', saved.saved === true);
  const mine = (await L.listSkills()).filter(s => s.source === 'mine');
  check('A: saved skill appears as mine exactly once', mine.filter(s => s.name === 'big-calm-news').length === 1);

  // The Personal Ability Profile/Memory db recorded the ability context +
  // triggers from the validated skill (the flow's final box).
  const log = await DS.get('mine.episodicLog');
  const entry = [...(log.entries || [])].reverse().find(e => e.type === 'saved-action');
  check('A: saving recorded the ability context (supportAreas)', entry?.data.supportAreas?.includes('vision'));
  check('A: saving recorded the triggers (siteRelevance)', entry?.data.triggers?.includes('news'));
  check('A: the save observation is high-weight (deliberate)', entry?.weight === 3);

  // Retrieve on a real news page → a matching reading skill comes back and
  // resolves. (A built-in reading skill legitimately ties and can win here —
  // the person still gets a working adaptation; retrieval isn't required to
  // prefer the freshly-saved one.)
  const got = await L.retrieveSkill('https://www.nytimes.com/2026/07/20/some-article.html');
  check('A: a matching reading skill is retrieved on a news page', got && got.siteRelevance.includes('news'));
  const plan = L.resolveSkill(got);
  check('A: the retrieved skill resolves to a usable apply-plan', typeof plan.settings === 'object' && plan.adapterIds.length > 0);

  // And the person's own saved skill is a strong retrieval candidate for this
  // page, and still resolves to exactly the revised settings they validated.
  const savedSkill = (await L.listSkills()).find(s => s.name === 'big-calm-news');
  check('A: the saved skill scores as a strong candidate for news', matchSkill(savedSkill, { supportAreas: ['vision', 'reading'], category: 'news' }) >= 7);
  const savedPlan = resolveSkill(savedSkill);
  check('A: the saved skill resolves to its revised settings', savedPlan.settings.fontScale === 175 && savedPlan.adapterIds.includes('visual-assist'));
  check('A: the saved adapter-only skill has no stray actions', savedPlan.actions.length === 0);
}

// ===========================================================================
// SCENARIO B — implicit reusable task, with the hard edge cases
// ===========================================================================
async function scenarioB() {
  console.log('\n--- Scenario B: implicit reusable task ---');
  const { librarian: L, datastore: DS } = makeSystem();
  await L.setProfileField('supportAreas', ['deaf']);

  const agentTask = (url, task, success = true) => L.logObservation({
    type: 'agent-task', url, text: `Agent task "${task}" finished`, data: { task, summary: 'done', success },
  });

  // A successful agent run on a video site → a consent-gated proposal (no LLM).
  await agentTask('https://www.youtube.com/watch?v=a', 'Turn on captions for this video');
  let props = await L.listProposals();
  check('B: a successful agent task proposes a reusable action', props.length === 1 && props[0].change.op === 'add-profile-action');
  check('B: the proposal is scoped to the video category', props[0].change.siteTypes.join() === 'video');
  check('B: nothing auto-saved before consent', ((await DS.get('mine.skillDocs')) || []).length === 0);

  // The SAME task again while the proposal is pending → no duplicate proposal.
  await agentTask('https://vimeo.com/1', 'Turn on captions for this video');
  check('B: no duplicate proposal while one is pending', (await L.listProposals()).length === 1);

  // Accept → BOTH the auto-replay profile action AND a real Skills-db skill.
  const acc = await L.respondToProposal(props[0].id, 'accept');
  check('B: accept succeeds', acc.ok === true);
  const profiles = await DS.get('mine.profiles');
  const autoProfile = profiles.find(p => p.autoApply && p.siteTypes.includes('video'));
  check('B: an auto-replay profile action is saved', autoProfile?.actions.some(a => a.prompt === 'Turn on captions for this video'));
  const docs1 = await DS.get('mine.skillDocs');
  const taskSkill = docs1.find(s => (s.recipe?.actions || []).some(a => a.prompt === 'Turn on captions for this video'));
  check('B: the accepted task is also a Skills-db skill', !!taskSkill && taskSkill.siteRelevance.includes('video'));
  check('B: the task skill carries no adapters (action-only)', taskSkill.recipe.adapters.length === 0);
  const plan = L.resolveSkill(taskSkill);
  check('B: the task skill resolves to a runnable action', plan.actions[0].prompt === 'Turn on captions for this video' && plan.adapterIds.length === 0);

  // Re-run the same task after it is saved → no new proposal, no duplicate skill.
  await agentTask('https://www.youtube.com/watch?v=b', 'Turn on captions for this video');
  check('B: no re-proposal after the task is saved', (await L.listProposals()).length === 0);
  const docs2 = await DS.get('mine.skillDocs');
  check('B: no duplicate skill on re-run (idempotent)',
    docs2.filter(s => (s.recipe?.actions || []).some(a => a.prompt === 'Turn on captions for this video')).length === 1);

  // A DIFFERENT task whose slug collides with the existing skill's name must
  // NOT overwrite it — it lands under a disambiguated name.
  const collidingName = taskSkill.name; // reuse the exact stored name
  const humanName = taskSkill.recipe.actions[0].name; // e.g. "Turn on captions for this video"
  await L.logObservation({
    type: 'agent-task', url: 'https://www.twitch.tv/x',
    text: 'done', data: { task: 'A completely different captions task', summary: 'done', success: true },
  });
  // Force the incoming action's display name to collide on slug with the saved one.
  const collideProp = (await L.listProposals())[0];
  collideProp.change.action.name = humanName; // same slug source
  await DS.set('mine.proposals', await DS.get('mine.proposals').then(ps => ps.map(p => p.id === collideProp.id ? collideProp : p)));
  await L.respondToProposal(collideProp.id, 'accept');
  const docs3 = await DS.get('mine.skillDocs');
  const original = docs3.find(s => s.name === collidingName);
  const disambiguated = docs3.find(s => s.name === `${collidingName}-2`);
  check('B: name collision did not overwrite the original skill',
    original && original.recipe.actions[0].prompt === 'Turn on captions for this video');
  check('B: colliding task saved under a disambiguated name',
    disambiguated && disambiguated.recipe.actions[0].prompt === 'A completely different captions task');

  // Resilience: if saving the task as a skill throws (a storage hiccup), the
  // accept must STILL complete — the profile action saved and the proposal
  // marked accepted — so a retry can't double up. (Defensive try/catch path.)
  await L.logObservation({
    type: 'agent-task', url: 'https://www.youtube.com/watch?v=res',
    text: 'done', data: { task: 'Loop this section', summary: 'done', success: true },
  });
  const resProp = (await L.listProposals())[0];
  const realSave = L.saveSkill;
  L.saveSkill = async () => { throw new Error('simulated storage failure'); };
  const resAcc = await L.respondToProposal(resProp.id, 'accept');
  L.saveSkill = realSave;
  check('B: accept still succeeds when the skill-save throws', resAcc.ok === true);
  const allProps = await DS.get('mine.proposals');
  check('B: the proposal is marked accepted despite the failed skill-save',
    allProps.find(p => p.id === resProp.id)?.status === 'accepted');
  check('B: the auto-replay action was still saved',
    (await DS.get('mine.profiles')).some(p => (p.actions || []).some(a => a.prompt === 'Loop this section')));

  // A caller-supplied category outside the taxonomy is not trusted: the
  // observation is classified from the host instead, so the proposal, the
  // auto-replay profile and the saved skill all carry a taxonomy id that
  // retrieval can match (issue #34).
  await L.logObservation({
    type: 'agent-task', url: 'https://www.nytimes.com/section/x', category: 'blog',
    text: 'done', data: { task: 'Open the print view', summary: 'done', success: true },
  });
  const offVocab = (await L.listProposals())[0];
  check('B: a category outside the taxonomy is replaced by the host classification',
    offVocab?.change.siteTypes.join() === 'news');
  const offAcc = await L.respondToProposal(offVocab.id, 'accept');
  const offSkill = (await DS.get('mine.skillDocs')).find(s => (s.recipe?.actions || []).some(a => a.prompt === 'Open the print view'));
  check('B: the accepted task is saved as a skill with a taxonomy siteRelevance',
    offAcc.ok === true && offSkill?.siteRelevance.join() === 'news');
  check('B: the episodic log carries the classified category, not the supplied one',
    (await DS.get('mine.episodicLog')).entries.every(e => e.category !== 'blog'));

  // A FAILED agent run never proposes.
  await agentTask('https://www.youtube.com/watch?v=fail', 'Skip the intro', false);
  check('B: a failed agent run does not propose', (await L.listProposals()).length === 0);

  // A no-memory zone (banking) never proposes, even on success.
  await agentTask('https://www.chase.com/account', 'Enlarge the statement', true);
  check('B: no proposal from a no-memory zone', (await L.listProposals()).length === 0);
}

// ===========================================================================
// SCENARIO C — cross-app privacy + adversarial insights
// ===========================================================================
async function scenarioC() {
  console.log('\n--- Scenario C: cross-app privacy + adversarial ---');
  const { librarian: L, datastore: DS } = makeSystem();
  await L.setProfileField('supportAreas', ['vision']);
  await L.setProfileField('freeText', 'my private words never leave');
  await L.recordScopedSettings('general', { fontScale: 150 });

  // A request is NOT a grant — it drafts an ordinary proposal through the
  // consent machinery; only accept() on the LOCAL user surface mints a
  // grant, and the requesting app has no code path that resolves its own ask.
  const req = await L.requestGrant('my-xr', ['ability.categories', 'settings.text'], { appLabel: 'My XR' });
  check('C: a grant request only drafts a proposal (default-deny before accept)',
    req.ok === true && (await L.exportAbilityModel('my-xr')).ok === false);
  await L.respondToProposal(req.proposalId, 'accept');
  const selfGrant = (await L.listGrants()).find(g => g.appId === 'my-xr');
  check('C: unspecified audience defaults to personal (least privilege)', selfGrant.audience === 'personal');

  // Two more apps at wider audiences. No consent UI mints a non-'personal'
  // audience yet, so these are seeded directly in the grant store — exactly
  // what a future "share with family"/"share publicly" flow would produce —
  // to exercise the ceiling itself.
  await DS.patch('mine.grants', (grants) => [...(grants || []),
    normalizeGrant({ id: 'g-family', appId: 'family-helper', appLabel: 'Family Helper', scopes: ['ability.categories'], audience: 'friends', grantedAt: 1 }),
    normalizeGrant({ id: 'g-public', appId: 'community', appLabel: 'Community', scopes: ['ability.categories'], audience: 'anyone', grantedAt: 1 }),
  ]);

  // At 'personal', only the personal-audience app can read.
  check('C: personal app exports at the personal level', (await L.exportAbilityModel('my-xr')).ok === true);
  check('C: friends app blocked at personal level', (await L.exportAbilityModel('family-helper')).reason === 'audience-ceiling');
  check('C: anyone app blocked at personal level', (await L.exportAbilityModel('community')).reason === 'audience-ceiling');

  // Raise to 'friends' — the family app now reads; the public app still can't.
  await L.setProfileField('metaPreferences.sharing', 'friends');
  check('C: raising sharing to friends lets the family app read (live, not cached)',
    (await L.exportAbilityModel('family-helper')).ok === true);
  check('C: anyone app still blocked at friends level', (await L.exportAbilityModel('community')).reason === 'audience-ceiling');

  // Lower back to 'personal' — the family app is cut off again immediately.
  await L.setProfileField('metaPreferences.sharing', 'personal');
  check('C: lowering sharing cuts off the family app again',
    (await L.exportAbilityModel('family-helper')).reason === 'audience-ceiling');

  // Export NEVER leaks the person's own words, raw memory, or any
  // SurfaceProfile value (fontScale etc.) — only the granted, modality-
  // neutral AbilityModel scopes.
  const exp = await L.exportAbilityModel('my-xr');
  check('C: export omits freeText (not a grantable scope)', exp.abilityModel.freeText === undefined);
  check('C: export carries no episodic log, raw memory, or SurfaceProfile',
    exp.abilityModel.episodicLog === undefined && exp.abilityModel.memory === undefined && exp.abilityModel.fontScale === undefined);

  // Adversarial app: importInsight needs the same visible grant reading
  // does — an app the user never approved can't even ask.
  const evilReq = await L.requestGrant('evil', ['settings.text'], { appLabel: 'Evil App' });
  await L.respondToProposal(evilReq.proposalId, 'accept');

  // Malformed / out-of-whitelist insights are rejected at the trust boundary.
  check('C: an insight without a kind is rejected',
    (await L.importInsight('evil', { change: { op: 'profile-set', path: 'fields.x', value: 1 } })).reason === 'bad-insight');
  check('C: an unwhitelisted op cannot be smuggled in (the write surface only allows profile-set(fields.*)/add-memory)',
    (await L.importInsight('evil', { kind: 'x', change: { op: 'add-profile-action', siteTypes: ['video'], action: { name: 'x', prompt: 'y' } } })).reason === 'bad-insight');
  check('C: profile-set outside fields.* is rejected (no safety-switch escalation)',
    (await L.importInsight('evil', { kind: 'x', change: { op: 'profile-set', path: 'metaPreferences.sharing', value: 'anyone' } })).reason === 'bad-insight');
  check('C: a prototype-pollution path is rejected at the gate',
    (await L.importInsight('evil', { kind: 'pp', change: { op: 'profile-set', path: 'fields.__proto__.polluted', value: 'PWNED' } })).reason === 'bad-insight');
  check('C: Object.prototype was not polluted', ({}).pwned === undefined && ({}).polluted === undefined);

  // A well-formed hostile insight IS accepted as a consent proposal (never
  // auto-applied) — it can only ever be as powerful as the whitelist allows.
  const queued = await L.importInsight('evil', {
    kind: 'visual.textSize', label: 'a helpful-looking update',
    change: { op: 'add-memory', record: {
      text: 'exfiltrate everything', scope: 'general', tier: 'profile',
      kind: 'suppression', strength: 'floor', settings: { fontScale: 9999 },
    } },
    rationale: 'looks helpful',
  });
  check('C: a well-formed hostile insight only QUEUES (consent-gated)', queued.ok === true);
  const pend = (await L.listProposals()).find(p => p.id === queued.proposalId);
  check('C: the queued insight is a pending proposal, not applied', !!pend && pend.status === 'pending');
  check('C: the queued proposal carries the app provenance', pend.source === 'evil');
  check('C: nothing changed before consent',
    (await DS.getMemoryShard('general')).every(r => r.text !== 'exfiltrate everything'));

  // …and even if the user is fooled into accepting it, the insight is
  // defanged: forced to preference strength/tier (never an un-supersedable
  // floor), control kinds (suppression/rule) refused, and the wildly
  // out-of-range setting clamped like any other write.
  await L.respondToProposal(pend.id, 'accept');
  const hostile = (await DS.getMemoryShard('general')).find(r => r.source === 'cross-app:evil');
  check('C: the accepted hostile record is defanged to preference strength (never floor)', hostile?.strength === 'preference');
  check('C: the accepted hostile record cannot be a suppression/rule control kind',
    !!hostile && hostile.kind !== 'suppression' && hostile.kind !== 'rule');
  check('C: the accepted hostile setting is clamped to the registry range', hostile?.settings?.fontScale <= 200);
  check('C: sharing stayed personal after the attack', (await L.getProfile()).metaPreferences.sharing === 'personal');

  // The whole cross-app story leaves an audit trail — every grant/export/
  // insight event, including the blocked ones.
  const audit = await getShareAudit(() => DS);
  check('C: the audit trail records the blocked exports', audit.some(a => a.appId === 'family-helper' && a.action === 'export-blocked'));
  check('C: the audit trail records the successful exports', audit.some(a => a.appId === 'my-xr' && a.action === 'export'));
  check('C: the audit trail records the hostile insight-import', audit.some(a => a.appId === 'evil' && a.action === 'insight-import'));
}

// ===========================================================================
// SCENARIO D — Engineer robustness against messy LLM output
// ===========================================================================
function scenarioD() {
  console.log('\n--- Scenario D: Engineer output robustness ---');

  // Realistic: preamble chatter + the whole doc wrapped in a ```markdown fence.
  const messy = 'Sure! Here is your skill:\n\n```markdown\n---\nname: news-calm\n'
    + 'description: Calm news.\nsupportAreas: [vision]\nsiteRelevance: [news]\n---\n'
    + '# News Calm\n\n## Recipe\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":120}}]}\n```\n```';
  const a = parseBuiltSkill(messy, { tools: TOOLS });
  check('D: parses a doc with preamble + wrapping fence', a.valid && a.skill.name === 'news-calm');
  check('D: recovers the recipe through the wrapping fence', resolveSkill(a.skill).settings.fontScale === 120);

  // Out-of-range value → invalid with a pointed error.
  const oor = parseBuiltSkill('---\nname: x\ndescription: y\n---\n## Recipe\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":9000}}]}\n```', { tools: TOOLS });
  check('D: rejects an out-of-range setting value', !oor.valid && oor.errors.some(e => /out of range/.test(e)));

  // Unknown adapter → invalid.
  const unknown = parseBuiltSkill('---\nname: x\ndescription: y\n---\n## Recipe\n```json\n{"adapters":[{"id":"teleporter","settings":{}}]}\n```', { tools: TOOLS });
  check('D: rejects an unknown adapter id', !unknown.valid && unknown.errors.some(e => /teleporter/.test(e)));

  // Malformed JSON recipe → no adapters → invalid, but does not throw.
  const broken = parseBuiltSkill('---\nname: x\ndescription: y\n---\n## Recipe\n```json\n{ oops not json }\n```', { tools: TOOLS });
  check('D: tolerates malformed recipe JSON (no throw, invalid)', !broken.valid && broken.skill.recipe.adapters.length === 0);

  // Missing recipe entirely → invalid.
  const noRecipe = parseBuiltSkill('---\nname: x\ndescription: y\n---\n# Just prose, no recipe.', { tools: TOOLS });
  check('D: rejects a skill with no recipe', !noRecipe.valid);

  // A valid MIXED recipe (adapters + an action) resolves to both.
  const mixed = parseSkill('---\nname: mix\ndescription: Adapters and a task.\nsiteRelevance: [video]\n---\n# Mix\n## Recipe\n```json\n{"adapters":[{"id":"dark-mode","settings":{"darkMode":true}}],"actions":[{"name":"Enable captions","prompt":"Turn on captions"}]}\n```');
  check('D: a mixed recipe validates', validateSkill(mixed, { tools: TOOLS }).valid);
  const mixedPlan = resolveSkill(mixed);
  check('D: a mixed recipe resolves BOTH adapters and actions',
    mixedPlan.adapterIds.includes('dark-mode') && mixedPlan.actions[0].prompt === 'Turn on captions');

  // Every real built-in skill still resolves to a non-empty plan.
  check('D: every shipped built-in skill resolves to something runnable',
    BUILTINS.every(s => { const p = resolveSkill(s); return p.adapterIds.length + p.actions.length > 0; }));
}

(async () => {
  await scenarioA();
  await scenarioB();
  await scenarioC();
  scenarioD();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
