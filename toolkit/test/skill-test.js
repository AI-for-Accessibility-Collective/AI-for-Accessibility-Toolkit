// Skill layer unit test — parse/validate/resolve/match, the Engineer, and the
// Librarian skill API. Exercises the real builtin SKILL.md files. No browser.
// Run: node toolkit/test/skill-test.js
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSkill, serializeSkill, validateSkill, resolveSkill, matchSkill, matchSkillToNeed } from '../core/skill.js';
import { buildSkillPrompt, parseBuiltSkill } from '../core/skill-builder.js';
import { createDatastore } from '../core/datastore.js';
import { createLibrarian } from '../core/librarian.js';
import { TAXONOMY } from '../core/taxonomy.js';
import { SUPPORT_AREAS } from '../core/ability.js';
import { skillRegistry } from '../registry/tools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'skills', 'builtin');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// A stand-in for the AA_TOOLS registry, matching the real adapter ids.
const REGISTRY_IDS = ['auto-alt-text', 'captions', 'color-filter', 'dark-mode',
  'dyslexia-font', 'fix-contrast', 'focus-mode', 'generate-captions', 'generate-labels',
  'keyboard-nav', 'large-cursor', 'motion-reducer', 'read-aloud', 'reader-mode',
  'simplify-text', 'visual-assist', 'voice-commands', 'wcag-fixes'];
const SETTINGS_META = {
  fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1.0, 3.0] },
  letterSpacing: { type: 'number', range: [0, 0.5] }, darkMode: { type: 'boolean' },
  focusMode: { type: 'boolean' }, hideDistractions: { type: 'boolean' }, showProgress: { type: 'boolean' },
  motionReducer: { type: 'boolean' }, readerMode: { type: 'boolean' }, keyboardNav: { type: 'boolean' },
  enhanceFocus: { type: 'boolean' }, readingGuide: { type: 'boolean' }, autoDescribe: { type: 'boolean' },
  autoFixLabels: { type: 'boolean' }, autoWcagFix: { type: 'boolean' }, autoCaptions: { type: 'boolean' },
  autoSimplify: { type: 'boolean' }, voiceCommands: { type: 'boolean' }, largeCursor: { type: 'boolean' },
  dyslexiaFont: { type: 'boolean' }, colorBlindMode: { type: 'enum', options: ['none', 'protanopia'] },
};
const tools = {
  settingsMeta: SETTINGS_META,
  byId: (id) => REGISTRY_IDS.includes(id) ? { id } : null,
  forPrompt: () => REGISTRY_IDS.map(id => ({ id, name: id, description: id, supportAreas: ['vision'] })),
  settingsVocabularyLines: () => Object.keys(SETTINGS_META).map(k => `- ${k}`),
};

// ---- parse + validate the REAL builtin skills ------------------------------
const builtinFiles = readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.md'));
check('ships builtin skills', builtinFiles.length >= 4);
const builtins = [];
for (const f of builtinFiles) {
  const skill = parseSkill(readFileSync(join(BUILTIN_DIR, f), 'utf8'));
  builtins.push(skill);
  check(`${f}: has name + description`, !!skill.name && !!skill.description);
  check(`${f}: recipe has adapters`, skill.recipe.adapters.length > 0);
  const { valid, errors } = validateSkill(skill, { tools });
  check(`${f}: validates against registry`, valid || (console.log('   errors:', errors), false));
}

// ---- parse specifics -------------------------------------------------------
const reading = builtins.find(s => s.name === 'reading-aid');
check('reading-aid parses supportAreas array', reading.supportAreas.includes('vision') && reading.supportAreas.includes('reading'));
check('reading-aid parses siteRelevance array', reading.siteRelevance.includes('news'));
check('reading-aid recipe references visual-assist', reading.recipe.adapters.some(a => a.id === 'visual-assist'));

// ---- resolve to apply-plan (skill → adapters bridge) -----------------------
const plan = resolveSkill(reading);
check('resolve merges settings from all steps', plan.settings.fontScale === 130 && plan.settings.focusMode === true);
check('resolve lists adapter ids in order', plan.adapterIds[0] === 'visual-assist' && plan.adapterIds.includes('focus-mode'));
const calm = builtins.find(s => s.name === 'calm-browsing');
check('calm-browsing keeps showProgress:false (sensory)', resolveSkill(calm).settings.showProgress === false);

// ---- matching (Librarian retrieval scoring) --------------------------------
check('reading-aid matches vision reader on news', matchSkill(reading, { supportAreas: ['vision'], category: 'news' }) > 0);
check('reading-aid does not match a motor user on video', matchSkill(reading, { supportAreas: ['motor'], category: 'video' }) === 0);
check('calm-browsing (siteRelevance all) matches anywhere', matchSkill(calm, { supportAreas: ['sensory'], category: 'shopping' }) > 0);

// ---- matching a plain-language need (reuse-before-build check) -------------
const readNeed = 'Make text easier to read for me on news sites';
check('reading-aid covers a plain reading need', matchSkillToNeed(reading, readNeed) >= 4);
check('reading need scores reading-aid above calm-browsing',
  matchSkillToNeed(reading, readNeed) > matchSkillToNeed(calm, readNeed));
check('unrelated need does not match reading-aid', matchSkillToNeed(reading, 'louder alert sounds') < 4);
check('empty need matches nothing', matchSkillToNeed(reading, '') === 0);
check('generic words alone match nothing', matchSkillToNeed(reading, 'please make this site more like that') === 0);

// ---- validation catches bad skills -----------------------------------------
const bad = parseSkill('---\nname: bad\ndescription: x\n---\n## Recipe\n```json\n{"adapters":[{"id":"not-a-real-adapter","settings":{"nope":1}}]}\n```');
const badRes = validateSkill(bad, { tools });
check('rejects unknown adapter', !badRes.valid && badRes.errors.some(e => e.includes('not-a-real-adapter')));
check('rejects unknown setting', badRes.errors.some(e => e.includes('nope')));

// ---- validation catches vocabulary slips (issue #34) -----------------------
// supportAreas and siteRelevance are what retrieval matches on, so a value
// outside the vocabulary is a skill that can never be found again. It must
// fail here, at authoring time, and the message must name the bad value and
// the allowed set so the Engineer can re-prompt.
const badArea = validateSkill({ ...reading, supportAreas: ['vision', 'neurodivergent'] }, { tools });
check('rejects a supportArea outside SUPPORT_AREAS', !badArea.valid);
check('supportArea error names the bad value and the allowed set',
  badArea.errors.some(e => e.includes('"neurodivergent"') && SUPPORT_AREAS.every(a => e.includes(a))));
const badSite = validateSkill({ ...reading, siteRelevance: ['news', 'banking'] }, { tools });
check('rejects a siteRelevance outside the taxonomy', !badSite.valid);
check('siteRelevance error names the bad value, the categories, and "all"',
  badSite.errors.some(e => e.includes('"banking"') && TAXONOMY.categoryIds().every(c => e.includes(c)) && e.includes('all')));
check('siteRelevance "all" is accepted', validateSkill({ ...reading, siteRelevance: ['all'] }, { tools }).valid);
check('every taxonomy category is accepted as siteRelevance',
  validateSkill({ ...reading, siteRelevance: TAXONOMY.categoryIds() }, { tools }).valid);
check('every SUPPORT_AREAS value is accepted as a supportArea',
  validateSkill({ ...reading, supportAreas: [...SUPPORT_AREAS] }, { tools }).valid);
check('empty supportAreas and siteRelevance stay valid (action skills carry none)',
  validateSkill({ ...reading, supportAreas: [], siteRelevance: [] }, { tools }).valid);
check('a host-supplied taxonomy is honored',
  validateSkill({ ...reading, siteRelevance: ['gallery'] }, { tools, taxonomy: { categoryIds: () => ['gallery'] } }).valid);
check('a data-only host taxonomy ({ categories: [{ id }] }) is honored',
  validateSkill({ ...reading, siteRelevance: ['gallery'] }, { tools, taxonomy: { categories: [{ id: 'gallery' }] } }).valid);
check('an explicit null taxonomy falls back to the bundled one instead of throwing',
  validateSkill({ ...reading, siteRelevance: ['news'] }, { tools, taxonomy: null }).valid);
// A hand-built skill (saveSkill callers) may pass a single string where a
// list is expected. It is one value, not a string to iterate per character,
// and a non-iterable value must not throw.
const oneString = validateSkill({ ...reading, supportAreas: 'vision' }, { tools });
check('a single-string supportAreas is treated as a one-item list', oneString.valid);
check('a non-iterable supportAreas does not throw',
  validateSkill({ ...reading, supportAreas: {} }, { tools }).valid === false);
// Whatever validation calls valid, retrieval must be able to score. A skill
// stored with a single string scored 0 on its area while validating clean,
// which is the "saved but never found again" failure this check guards.
const oneStringSkill = { ...reading, supportAreas: 'vision', siteRelevance: 'news' };
check('a single-string supportAreas still scores at retrieval',
  matchSkill(oneStringSkill, { supportAreas: ['vision'], category: 'news' })
    === matchSkill({ ...reading, supportAreas: ['vision'], siteRelevance: ['news'] }, { supportAreas: ['vision'], category: 'news' }));
check('a single-string supportAreas is not iterated per character',
  matchSkill(oneStringSkill, { supportAreas: ['v', 'i', 's'], category: null }) === 0);
// parseSkill normalizes the two list fields, so the validator rejects only
// true vocabulary misses: a bare comma list and a capitalized id are slips.
const slipped = parseSkill('---\nname: slip\ndescription: A formatting slip.\nsupportAreas: Vision, reading\nsiteRelevance: [News, ALL]\n---\n# Slip\n```json\n{"adapters":[],"actions":[{"name":"x","prompt":"do x"}]}\n```');
check('parseSkill splits a bare comma list and lowercases ids',
  JSON.stringify(slipped.supportAreas) === '["vision","reading"]' && JSON.stringify(slipped.siteRelevance) === '["news","all"]');
check('a normalized formatting slip validates', validateSkill(slipped, { tools }).valid);
// The Engineer path (serialize, parse, validate) keeps rejecting a value that
// normalization cannot repair.
check('Engineer output with a vocabulary slip is still invalid after normalization',
  !parseBuiltSkill(serializeSkill({ ...reading, supportAreas: ['focus'] }), { tools }).valid);

// ---- the registry uses the same vocabulary --------------------------------
// One source of truth, in both directions: every entry's areas are in the
// constant, and every value in the constant is helped by at least one entry.
const registryAreas = new Set(skillRegistry.flatMap(e => e.supportAreas || []));
check('every registry entry supportArea is in SUPPORT_AREAS',
  [...registryAreas].every(a => SUPPORT_AREAS.includes(a)));
// This second direction is a coverage claim, not a vocabulary rule: it fires
// when a value is added to SUPPORT_AREAS that no adapter serves yet, which is
// a profile that would be offered nothing. Adding a value means either adding
// an entry that helps it or deciding this check should not hold.
check('every SUPPORT_AREAS value is helped by at least one registry entry',
  SUPPORT_AREAS.every(a => registryAreas.has(a)));
const registrySites = new Set(skillRegistry.flatMap(e => e.siteRelevance || []));
check('every registry entry siteRelevance is a taxonomy category or "all"',
  [...registrySites].every(c => c === 'all' || TAXONOMY.categoryIds().includes(c)));

// ---- action skills (reusable tasks saved as skills) ------------------------
const actionSkill = parseSkill('---\nname: turn-on-captions\ndescription: Turns captions on for videos.\nsiteRelevance: [video]\n---\n# Turn on captions\n\n## Recipe\n```json\n{"adapters":[],"actions":[{"name":"Turn on captions","prompt":"Turn on captions for this video"}]}\n```');
check('action-only skill validates', validateSkill(actionSkill, { tools }).valid);
const actionPlan = resolveSkill(actionSkill);
check('action skill resolves its task', actionPlan.actions.length === 1 && actionPlan.actions[0].prompt === 'Turn on captions for this video');
check('action skill round-trips through serialize', resolveSkill(parseSkill(serializeSkill(actionSkill))).actions.length === 1);
const nothing = parseSkill('---\nname: empty\ndescription: x\n---\n## Recipe\n```json\n{"adapters":[]}\n```');
check('recipe with nothing to do is invalid', !validateSkill(nothing, { tools }).valid);

// ---- round-trip serialize -> parse -----------------------------------------
const rt = parseSkill(serializeSkill(reading));
check('serialize->parse preserves name', rt.name === 'reading-aid');
check('serialize->parse preserves recipe', resolveSkill(rt).settings.fontScale === 130);

// ---- the Engineer: prompt + output parsing ---------------------------------
const prompt = buildSkillPrompt('make news sites calmer and easier to read', { profile: { supportAreas: ['vision'] }, tools, taxonomy: TAXONOMY });
check('prompt grounds the model in real adapter ids', prompt.includes('visual-assist') && prompt.includes('focus-mode'));
check('prompt lists setting vocabulary', prompt.includes('fontScale'));
check('prompt lists the support-area vocabulary', prompt.includes(`Support areas for supportAreas: ${SUPPORT_AREAS.join(', ')}`));
check('prompt lists the site categories', prompt.includes(`siteRelevance: ${TAXONOMY.categoryIds().join(', ')}`));
check('prompt asks for SKILL.md shape', prompt.includes('SKILL.md') && prompt.includes('"adapters"'));
check('prompt has no revision block without feedback', !prompt.includes('The person tried it'));

// The evaluation loop: a rejected attempt + feedback goes back to the Engineer.
const revisePrompt = buildSkillPrompt('make news sites calmer and easier to read', {
  profile: { supportAreas: ['vision'] }, tools, taxonomy: TAXONOMY,
  previous: reading, feedback: 'the text is still too small',
});
check('revision prompt carries the previous skill', revisePrompt.includes('name: reading-aid'));
check('revision prompt carries the feedback', revisePrompt.includes('the text is still too small'));

// Simulate an LLM returning a well-formed skill (wrapped in a markdown fence).
const fakeLLMOut = '```markdown\n' + serializeSkill({
  name: 'news-calm', description: 'Calm, readable news pages.',
  supportAreas: ['vision', 'sensory'], siteRelevance: ['news'],
  recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 120 } }, { id: 'motion-reducer', settings: { motionReducer: true } }] },
  body: '# News Calm\nMakes news readable.',
}) + '\n```';
const built = parseBuiltSkill(fakeLLMOut, { tools });
check('Engineer parses valid LLM output', built.valid && built.skill.name === 'news-calm');
check('Engineer strips outer markdown fence, keeps recipe', resolveSkill(built.skill).settings.fontScale === 120);

// ---- Librarian skill API (in-memory ports, builtin skills injected) --------
// In-memory KVStore, shaped like the chain's KVStore port (get/set/getAll per
// area) — see toolkit/ports/index.js and platforms/chrome/ports.js chromeKV.
const mem = { local: {}, sync: {} };
const kv = {
  async get(area, key) { return mem[area][key] === undefined ? undefined : structuredClone(mem[area][key]); },
  async set(area, key, value) { mem[area][key] = structuredClone(value); },
  async getAll(area) { return structuredClone(mem[area]); },
};
const clock = { now: () => Date.now() };
const datastore = createDatastore({ kv, clock, taxonomy: TAXONOMY, toolsRegistry: tools, builtinSkills: builtins });
const librarian = createLibrarian({ datastore, taxonomy: TAXONOMY, clock });

(async () => {
  await librarian.setProfileField('supportAreas', ['vision', 'reading']);

  const all = await librarian.listSkills();
  check('listSkills includes builtins', all.length >= 4 && all.every(s => s.source === 'builtin'));

  const retrieved = await librarian.retrieveSkill('https://www.nytimes.com/article');
  check('retrieveSkill picks a vision/reading skill on news', retrieved && retrieved.supportAreas.includes('reading'));

  const applyPlan = librarian.resolveSkill(retrieved);
  check('retrieved skill resolves to a settings plan', typeof applyPlan.settings === 'object' && applyPlan.adapterIds.length > 0);

  // Reuse-before-build: an existing skill is found for a covered need; a
  // need nothing covers returns null (so the Engineer gets asked).
  const found = await librarian.findSkillForNeed('make long text easier to read on news sites');
  check('findSkillForNeed returns a covering skill', found && found.name === 'reading-aid');
  const notFound = await librarian.findSkillForNeed('translate pages into sign language video');
  check('findSkillForNeed returns null when nothing covers the need', notFound === null);

  // Save a user skill → appears in listSkills as mine, retrievable.
  const saveRes = await librarian.saveSkill({
    name: 'my-shop-helper', description: 'Bigger text on shopping sites.',
    supportAreas: ['vision'], siteRelevance: ['shopping'],
    recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 140 } }] }, body: '# Shop Helper',
  });
  check('saveSkill persists a valid skill', saveRes.saved === true);
  const afterSave = await librarian.listSkills();
  check('saved skill appears as mine', afterSave.some(s => s.name === 'my-shop-helper' && s.source === 'mine'));

  // The flow's final step: saving records ability context + triggers so the
  // profile/memory db learns from the validated skill.
  const log = await datastore.get('mine.episodicLog');
  const saveEntry = [...(log.entries || [])].reverse().find(e => e.type === 'saved-action');
  check('saving a skill records ability context and triggers',
    !!saveEntry && saveEntry.data.supportAreas?.includes('vision') && saveEntry.data.triggers?.includes('shopping'));

  // A caller may hand saveSkill a single string where a list belongs.
  // validateSkill reads it as a one-item list, so it must also be STORED as
  // one: the observation text, the dedup compare and matchSkill all read the
  // stored field back as a list, and a bare string used to be spread into
  // characters or throw on .join after the skill was already written.
  // The throw is the failure under test, so catch it and report a failed
  // check rather than letting it abort the rest of the suite.
  let strSave = null;
  try {
    strSave = await librarian.saveSkill({
      name: 'string-fields', description: 'Bigger text on news sites.',
      supportAreas: 'vision', siteRelevance: 'news',
      recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 140 } }] }, body: '# String Fields',
    });
  } catch { /* reported by the check below */ }
  check('saveSkill accepts single-string vocabulary fields without throwing', strSave?.saved === true);
  const stored = (await librarian.listSkills()).find(s => s.name === 'string-fields');
  check('saveSkill stores the list form it validated',
    JSON.stringify(stored?.supportAreas) === '["vision"]' && JSON.stringify(stored?.siteRelevance) === '["news"]');
  await librarian.deleteSkill('string-fields');

  // saveSkill rejects an invalid skill.
  const badSave = await librarian.saveSkill({ name: 'broken', description: 'x', recipe: { adapters: [{ id: 'nope' }] }, supportAreas: [], siteRelevance: [] });
  check('saveSkill rejects invalid skill', badSave.saved === false && badSave.errors.length > 0);

  const del = await librarian.deleteSkill('my-shop-helper');
  check('deleteSkill removes it', del === true && !(await librarian.listSkills()).some(s => s.name === 'my-shop-helper'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
