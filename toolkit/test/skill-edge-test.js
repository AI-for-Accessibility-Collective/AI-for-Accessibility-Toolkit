// Comprehensive Skill Builder test — realistic flows AND edge cases, focused
// on the fragile boundary: parsing whatever the LLM emits, validating values,
// and the full build→save→retrieve→apply loop. No browser.
// Run: node toolkit/test/skill-edge-test.js
import { parseSkill, serializeSkill, validateSkill, resolveSkill, matchSkill } from '../core/skill.js';
import { parseBuiltSkill, buildSkill } from '../core/skill-builder.js';
import { createDatastore } from '../core/datastore.js';
import { createLibrarian } from '../core/librarian.js';
import { TAXONOMY } from '../core/taxonomy.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS:', name); } else { fail++; console.log('FAIL:', name); } }
async function throws(name, fn) { try { await fn(); check(name, false); } catch { check(name, true); } }

const META = {
  fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1.0, 3.0] },
  letterSpacing: { type: 'number', range: [0, 0.5] }, darkMode: { type: 'boolean' }, focusMode: { type: 'boolean' },
  hideDistractions: { type: 'boolean' }, showProgress: { type: 'boolean' }, motionReducer: { type: 'boolean' },
  enhanceFocus: { type: 'boolean' }, readingGuide: { type: 'boolean' }, autoCaptions: { type: 'boolean' },
  colorBlindMode: { type: 'enum', options: ['none', 'protanopia', 'deuteranopia', 'tritanopia'] },
};
const IDS = ['visual-assist', 'focus-mode', 'motion-reducer', 'dark-mode', 'auto-captions', 'color-filter'];
const tools = {
  settingsMeta: META, byId: (id) => IDS.includes(id) ? { id } : null,
  forPrompt: () => IDS.map(id => ({ id, name: id, description: id, supportAreas: ['vision'] })),
  settingsVocabularyLines: () => Object.keys(META).map(k => `- ${k}`),
};

const GOOD = `---
name: reading-aid
description: Easier reading on articles.
supportAreas: [vision, reading]
siteRelevance: [news]
---

# Reading Aid
Bigger, calmer text.

## Recipe
\`\`\`json
{ "adapters": [ { "id": "visual-assist", "settings": { "fontScale": 130 } }, { "id": "focus-mode", "settings": { "focusMode": true } } ] }
\`\`\`
`;

// ---- PARSING: realistic ----------------------------------------------------
const g = parseSkill(GOOD);
check('parses name/description', g.name === 'reading-aid' && g.description.startsWith('Easier'));
check('parses list fields', g.supportAreas.includes('vision') && g.siteRelevance.includes('news'));
check('parses recipe', g.recipe.adapters.length === 2 && g.recipe.adapters[0].id === 'visual-assist');

// ---- PARSING: edge cases (what LLMs actually emit) --------------------------
check('tolerates preamble before frontmatter',
  parseSkill('Sure! Here is your skill:\n\n' + GOOD).name === 'reading-aid');
check('tolerates CRLF line endings',
  parseSkill(GOOD.replace(/\n/g, '\r\n')).name === 'reading-aid');
check('tolerates whole doc wrapped in ```markdown fence (via parseBuiltSkill)',
  parseBuiltSkill('```markdown\n' + GOOD + '\n```', { tools }).skill.name === 'reading-aid');
check('description containing a colon parses fully',
  parseSkill('---\nname: x\ndescription: Do this: then that\n---\n# X').description === 'Do this: then that');
check('single (non-array) supportAreas coerces to array',
  Array.isArray(parseSkill('---\nname: x\ndescription: y\nsupportAreas: vision\n---\n# X').supportAreas));
check('no frontmatter → empty name, whole text is body',
  parseSkill('# Just a heading\nno frontmatter here').name === '');
check('missing recipe → empty adapters (no crash)',
  parseSkill('---\nname: x\ndescription: y\n---\n# X\nno recipe').recipe.adapters.length === 0);
check('malformed recipe JSON (trailing comma) → empty adapters, no throw',
  parseSkill('---\nname: x\ndescription: y\n---\n## Recipe\n```json\n{"adapters":[{"id":"visual-assist",}]}\n```').recipe.adapters.length === 0);
check('recipe adapters not an array → empty',
  parseSkill('---\nname: x\ndescription: y\n---\n```json\n{"adapters":"nope"}\n```').recipe.adapters.length === 0);
check('empty / null input → parses to empty skill, no throw',
  parseSkill('').name === '' && parseSkill(null).recipe.adapters.length === 0);

// ---- VALIDATION: realistic + edge ------------------------------------------
check('valid skill passes', validateSkill(g, { tools }).valid);
check('unknown adapter rejected',
  !validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"ghost"}]}\n```'), { tools }).valid);
check('unknown setting key rejected',
  validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"visual-assist","settings":{"nope":1}}]}\n```'), { tools })
    .errors.some(e => e.includes('nope')));
const oor = validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":9999}}]}\n```'), { tools });
check('out-of-range number rejected (fontScale 9999)', !oor.valid && oor.errors.some(e => e.includes('out of range')));
const wt = validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"dark-mode","settings":{"darkMode":"yes"}}]}\n```'), { tools });
check('wrong-type boolean rejected (darkMode "yes")', !wt.valid && wt.errors.some(e => e.includes('true or false')));
const be = validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"color-filter","settings":{"colorBlindMode":"purple"}}]}\n```'), { tools });
check('bad enum value rejected (colorBlindMode purple)', !be.valid && be.errors.some(e => e.includes('not one of')));
check('empty recipe rejected', !validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n# X'), { tools }).valid);
check('missing name rejected', validateSkill(parseSkill('---\ndescription: b\n---\n```json\n{"adapters":[{"id":"dark-mode"}]}\n```'), { tools }).errors.includes('missing name'));
check('in-range boundary values accepted (fontScale 50 and 200)',
  validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":50}}]}\n```'), { tools }).valid &&
  validateSkill(parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":200}}]}\n```'), { tools }).valid);

// ---- RESOLVE ---------------------------------------------------------------
check('resolve merges + orders', (() => { const p = resolveSkill(g); return p.settings.fontScale === 130 && p.settings.focusMode === true && p.adapterIds[0] === 'visual-assist'; })());
check('resolve: later step wins on key conflict', (() => {
  const s = parseSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":120}},{"id":"focus-mode","settings":{"fontScale":150}}]}\n```');
  return resolveSkill(s).settings.fontScale === 150;
})());
check('resolve of empty recipe → empty plan, no crash', resolveSkill(parseSkill('# nothing')).adapterIds.length === 0);

// ---- MATCH -----------------------------------------------------------------
check('matches on area + category', matchSkill(g, { supportAreas: ['vision'], category: 'news' }) > 0);
check('no overlap → 0', matchSkill(g, { supportAreas: ['motor'], category: 'video' }) === 0);
const allSkill = parseSkill('---\nname: c\ndescription: d\nsupportAreas: [sensory]\nsiteRelevance: [all]\n---\n```json\n{"adapters":[{"id":"motion-reducer"}]}\n```');
check('siteRelevance "all" matches any category', matchSkill(allSkill, { supportAreas: [], category: 'shopping' }) > 0);

// ---- ROUND-TRIP ------------------------------------------------------------
check('serialize → parse preserves recipe', resolveSkill(parseSkill(serializeSkill(g))).settings.fontScale === 130);

// ---- THE ENGINEER: LLM output variations -----------------------------------
check('Engineer accepts clean output', parseBuiltSkill(GOOD, { tools }).valid);
check('Engineer accepts preamble + fence', parseBuiltSkill('Here you go:\n```markdown\n' + GOOD + '\n```', { tools }).skill.name === 'reading-aid');
check('Engineer flags unknown adapter as invalid',
  !parseBuiltSkill('---\nname: a\ndescription: b\n---\n```json\n{"adapters":[{"id":"ghost"}]}\n```', { tools }).valid);
check('Engineer flags empty output as invalid', !parseBuiltSkill('', { tools }).valid);

// ---- LIBRARIAN INTEGRATION: build → save → retrieve → resolve → delete ------
const mem = { local: {}, sync: {} };
const area = (n) => ({ get: async (k, d) => mem[n][k] === undefined ? d : structuredClone(mem[n][k]), set: async (k, v) => { mem[n][k] = structuredClone(v); } });
const datastore = createDatastore({ areas: { local: area('local'), sync: area('sync') }, globalTier: { tools: () => tools, taxonomy: () => TAXONOMY, skills: () => [g] } });
const librarian = createLibrarian({ datastore: () => datastore, taxonomy: () => TAXONOMY, kv: { getAll: async () => structuredClone(mem.local), set: async (i) => Object.assign(mem.local, structuredClone(i)) } });

(async () => {
  await librarian.setProfileField('supportAreas', ['vision', 'reading']);

  // No LLM wired → buildSkill fails gracefully.
  const noLlm = await librarian.buildSkill('anything');
  check('buildSkill with no LLM fails gracefully', noLlm.skill === null && noLlm.errors.length > 0);

  // Wire a stub LLM that returns a valid skill; build with a % in the need (regression: URL-decode bug).
  librarian.setGeminiCaller(async () => GOOD.replace('reading-aid', 'news-ease').replace('[news]', '[news]'));
  const built = await librarian.buildSkill('make text 50% bigger on news');
  check('buildSkill handles a need containing "%"', built.valid && built.skill.name === 'news-ease');

  const saved = await librarian.saveSkill(built.skill);
  check('saveSkill persists valid skill', saved.saved);
  // Idempotent: saving same name again upserts (no duplicate).
  await librarian.saveSkill(built.skill);
  const mine = (await librarian.listSkills()).filter(s => s.source === 'mine');
  check('duplicate save upserts, not duplicates', mine.filter(s => s.name === 'news-ease').length === 1);

  // Invalid skill is refused by saveSkill even if a caller bypasses the UI.
  const badSave = await librarian.saveSkill({ name: 'x', description: 'y', supportAreas: [], siteRelevance: [], recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 9999 } }] } });
  check('saveSkill refuses out-of-range value', badSave.saved === false && badSave.errors.length > 0);

  // Retrieve on a news page → prefers a matching skill; resolve → apply-plan.
  const got = await librarian.retrieveSkill('https://www.nytimes.com/x');
  check('retrieveSkill returns a match on news', got && (got.name === 'news-ease' || got.name === 'reading-aid'));
  check('resolved plan is applyable settings', got && typeof librarian.resolveSkill(got).settings === 'object');

  // Retrieve where nothing fits → null (unlabeled/no-profile page).
  await librarian.setProfileField('supportAreas', ['motor']);
  const none = await librarian.retrieveSkill('https://random-forum.example/thread');
  check('retrieveSkill returns null when nothing matches', none === null);

  const del = await librarian.deleteSkill('news-ease');
  check('deleteSkill removes it', del && !(await librarian.listSkills()).some(s => s.name === 'news-ease'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
