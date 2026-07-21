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

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'skills', 'builtin');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// A stand-in for the AA_TOOLS registry, matching the real adapter ids.
const REGISTRY_IDS = ['auto-alt-text', 'auto-captions', 'color-filter', 'dark-mode',
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

// ---- round-trip serialize -> parse -----------------------------------------
const rt = parseSkill(serializeSkill(reading));
check('serialize->parse preserves name', rt.name === 'reading-aid');
check('serialize->parse preserves recipe', resolveSkill(rt).settings.fontScale === 130);

// ---- the Engineer: prompt + output parsing ---------------------------------
const prompt = buildSkillPrompt('make news sites calmer and easier to read', { profile: { supportAreas: ['vision'] }, tools, taxonomy: TAXONOMY });
check('prompt grounds the model in real adapter ids', prompt.includes('visual-assist') && prompt.includes('focus-mode'));
check('prompt lists setting vocabulary', prompt.includes('fontScale'));
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
const mem = { local: {}, sync: {} };
const area = (n) => ({
  get: async (k, d) => (mem[n][k] === undefined ? d : structuredClone(mem[n][k])),
  set: async (k, v) => { mem[n][k] = structuredClone(v); },
});
const datastore = createDatastore({
  areas: { local: area('local'), sync: area('sync') },
  globalTier: { tools: () => tools, taxonomy: () => TAXONOMY, skills: () => builtins },
});
const librarian = createLibrarian({
  datastore: () => datastore, taxonomy: () => TAXONOMY,
  kv: { getAll: async () => structuredClone(mem.local), set: async (i) => { Object.assign(mem.local, structuredClone(i)); } },
});

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

  // saveSkill rejects an invalid skill.
  const badSave = await librarian.saveSkill({ name: 'broken', description: 'x', recipe: { adapters: [{ id: 'nope' }] }, supportAreas: [], siteRelevance: [] });
  check('saveSkill rejects invalid skill', badSave.saved === false && badSave.errors.length > 0);

  const del = await librarian.deleteSkill('my-shop-helper');
  check('deleteSkill removes it', del === true && !(await librarian.listSkills()).some(s => s.name === 'my-shop-helper'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
