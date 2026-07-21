// Co-design scenario tests — grounded in the real study
// "Tasks-and-Breakdowns-Taxonomy.md" (8 sessions, 12 participants: older
// adults 65+, The Arc self-advocates, blind screen-reader users, a11y
// experts). The study named 28 agentic-task scenarios (A–H) and 14 recurring
// breakdowns. This file tests the toolkit against the subset it actually
// implements, and is HONEST about the rest:
//
//   - Content/perception adaptations (#21 plain language, #22 declutter,
//     #23 describe images, #24 read aloud, plus the visual/hearing/motor
//     needs) → real ADAPTERS composed into skills. Tested for catalog coverage.
//   - The "forgets who the user is" breakdown (#5 — instructions say "click
//     the red button" to a blind man) → ability-aware retrieval: the SAME
//     page adapts differently per the person's abilities.
//   - A repeatable non-payment chore (#9, P1's library renewal — "no payment
//     involved") → the implicit reusable-task path.
//   - The "people don't want" boundary (Section H: all four older adults
//     reject banking / government / health) → no-memory zones.
//   - "Silent commitments" / "no undo" (#7, #12) → consent before anything is
//     saved or applied.
//
// Aspirational agent scenarios the toolkit does NOT implement (voice add-to-
// cart #1, travel insurance #5, flight booking #6, multi-person scheduling
// #7, …) are logged as out-of-scope in the coverage ledger, never faked.
// Run: node toolkit/test/codesign-scenarios-test.js
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSkill, resolveSkill, validateSkill } from '../core/skill.js';
import { createDatastore } from '../core/datastore.js';
import { createLibrarian } from '../core/librarian.js';
import { TAXONOMY } from '../core/taxonomy.js';
// The REAL shipping tools catalog — the same registry the extension validates
// skills against (its own header blesses test consumption). Binding to it is
// the point: "an adapter exists for this need" must mean the actual catalog
// has it, not a hand-copied list.
import { skillRegistry, settingsMeta as REAL_META, getSkillById, getRegistryForPrompt }
  from '../../personalized-extension/skills/registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, '..', 'skills', 'builtin');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// The tools interface the toolkit core expects, backed entirely by the REAL
// registry (real ids, real settings vocabulary + ranges) — no test double.
const TOOLS = {
  settingsMeta: REAL_META,
  byId: (id) => getSkillById(id) || null,
  forPrompt: () => getRegistryForPrompt(),
  settingsVocabularyLines: () => Object.entries(REAL_META).map(([k, m]) =>
    `- ${k}: ${m.type}${m.range ? ` ${m.range[0]}–${m.range[1]}` : ''}${m.options ? ` (${m.options.join('|')})` : ''}`),
};
const BUILTINS = readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.md'))
  .map(f => parseSkill(readFileSync(join(BUILTIN_DIR, f), 'utf8')));

function makeSystem() {
  const mem = { local: {}, sync: {} };
  const area = (n) => ({
    get: async (k, d) => (mem[n][k] === undefined ? d : structuredClone(mem[n][k])),
    set: async (k, v) => { mem[n][k] = structuredClone(v); },
  });
  const datastore = createDatastore({
    areas: { local: area('local'), sync: area('sync') },
    globalTier: { tools: () => TOOLS, taxonomy: () => TAXONOMY, skills: () => BUILTINS },
  });
  let t = 1_700_000_000_000;
  const clock = { now: () => t };
  const librarian = createLibrarian({
    datastore: () => datastore, taxonomy: () => TAXONOMY, clock,
    kv: { getAll: async () => structuredClone(mem.local), set: async (i) => { Object.assign(mem.local, structuredClone(i)); } },
  });
  return { mem, datastore, librarian, clock };
}

// ===========================================================================
// PART 1 — the adapter catalog covers the content-transformation needs the
// study surfaced. Each row is a real scenario → the real adapter that serves
// it; we assert the adapter exists and a skill composing it validates+resolves.
// ===========================================================================
console.log('\n--- Part 1: adapters cover the content-transformation needs ---');
const CONTENT_NEEDS = [
  { s: '#21 rewrite in plain language', who: 'Chloe, Yvette, P1', id: 'simplify-text', settings: { autoSimplify: true } },
  { s: '#22 declutter before reading', who: 'Chloe, Made', id: 'reader-mode', settings: { readerMode: true } },
  { s: '#23 describe images & charts', who: 'Made, Daniel, Ronise', id: 'auto-alt-text', settings: { autoDescribe: true } },
  { s: '#24 read a document aloud', who: 'Daniel', id: 'read-aloud', settings: { speechRate: 1.0 } },
  { s: '#18 declutter long pages', who: 'Daniel, Clive', id: 'focus-mode', settings: { focusMode: true, hideDistractions: true } },
  { s: 'low-vision: enlarge text', who: 'P1, Chloe', id: 'visual-assist', settings: { fontScale: 150, enhanceFocus: true } },
  { s: 'low-vision: fix contrast', who: 'Ronise', id: 'fix-contrast', settings: {} },
  { s: 'light sensitivity: dark mode', who: 'Yvette', id: 'dark-mode', settings: { darkMode: true } },
  { s: 'brain fog: reduce motion', who: 'Yvette', id: 'motion-reducer', settings: { motionReducer: true } },
  { s: 'deaf/HoH: captions', who: 'Betsy, Yvette', id: 'auto-captions', settings: { autoCaptions: true } },
  { s: 'blind: fix labels & WCAG', who: 'Made, Daniel', id: 'generate-labels', settings: { autoFixLabels: true } },
  { s: 'motor: keyboard navigation', who: 'Clive, Taylor', id: 'keyboard-nav', settings: { keyboardNav: true } },
];
for (const need of CONTENT_NEEDS) {
  // Bind to the REAL registry: this fails if the shipping catalog ever drops
  // the adapter that serves this co-design need.
  check(`P1: the real catalog has an adapter for ${need.s} (${need.who})`, !!getSkillById(need.id));
  const skill = {
    name: `codesign-${need.id}`, description: `Serves: ${need.s}.`,
    supportAreas: [], siteRelevance: ['all'],
    recipe: { adapters: [{ id: need.id, settings: need.settings }] },
  };
  const v = validateSkill(skill, { tools: TOOLS });
  check(`P1: a skill for ${need.s} validates against the registry`, v.valid);
  const plan = resolveSkill(skill);
  check(`P1: a skill for ${need.s} resolves to a runnable plan`, plan.adapterIds.includes(need.id));
}

// ===========================================================================
// PART 2 — "forgets who the user is" (breakdown #5). The SAME toolkit must
// adapt to the person's abilities, not hand a blind user "click the red
// button." Different real personas → different best skill on their page.
// ===========================================================================
console.log('\n--- Part 2: ability-aware adaptation (breakdown #5) ---');
const PERSONAS = [
  { who: 'Betsy/Yvette (deaf/HoH)', supportAreas: ['hearing'], url: 'https://www.youtube.com/watch?v=x', expect: 'quiet-video' },
  { who: 'Chloe/P1 (low-vision reader)', supportAreas: ['vision', 'reading'], url: 'https://www.nytimes.com/2026/07/20/a.html', expect: 'reading-aid' },
  { who: 'Made/Daniel (blind screen-reader)', supportAreas: ['vision', 'motor'], url: 'https://example.com/app', expect: 'screen-reader-boost' },
];
for (const p of PERSONAS) {
  const { librarian: L } = makeSystem();
  await L.setProfileField('supportAreas', p.supportAreas);
  const got = await L.retrieveSkill(p.url);
  check(`P2: ${p.who} is served the ${p.expect} skill`, got && got.name === p.expect);
}
// The crux: one page, two people, two different adaptations — the toolkit
// remembers WHO each person is.
{
  const sysA = makeSystem(); await sysA.librarian.setProfileField('supportAreas', ['hearing']);
  const sysB = makeSystem(); await sysB.librarian.setProfileField('supportAreas', ['vision', 'reading']);
  const url = 'https://www.youtube.com/watch?v=same';
  const a = await sysA.librarian.retrieveSkill(url);
  const b = await sysB.librarian.retrieveSkill(url);
  check('P2: the same page adapts differently for a deaf vs. a low-vision user', a && b && a.name !== b.name);
}

// ===========================================================================
// PART 3 — a repeatable NON-PAYMENT chore (#9, P1's library renewal, the one
// task she'd fully delegate: "no payment involved"). The implicit path turns
// it into a saved, replayable skill.
// ===========================================================================
console.log('\n--- Part 3: repeatable non-payment chore (#9) ---');
{
  const { librarian: L, datastore: DS } = makeSystem();
  await L.setProfileField('supportAreas', ['vision']);
  const renew = 'Re-claim my free Wall Street Journal access through the library';
  const obs = await L.logObservation({
    type: 'agent-task', url: 'https://www.wsj.com/library-access',
    text: `Agent task "${renew}" finished`, data: { task: renew, summary: 'renewed', success: true },
  });
  check('P3: the renewal chore is logged (a news/reference site, not sensitive)', obs.logged === true);
  const props = await L.listProposals();
  check('P3: a repeatable chore is proposed as a reusable action', props.length === 1 && props[0].change.action.prompt === renew);
  await L.respondToProposal(props[0].id, 'accept');
  const docs = await DS.get('mine.skillDocs');
  check('P3: accepting saves it as a replayable skill', docs.some(s => (s.recipe?.actions || []).some(a => a.prompt === renew)));
  const profiles = await DS.get('mine.profiles');
  check('P3: and as an auto-replay profile action', profiles.some(p => p.autoApply && (p.actions || []).some(a => a.prompt === renew)));
}

// ===========================================================================
// PART 4 — the "people don't want" boundary (Section H). Every older adult
// refused banking; P3 refused government; P2 uses a fake name for health.
// These are no-memory zones: a successful agent task there records NOTHING
// and proposes NOTHING.
// ===========================================================================
console.log('\n--- Part 4: the sensitive-territory boundary (Section H) ---');
const SENSITIVE = [
  { zone: 'banking', who: 'P1, P2, P3, Betsy', url: 'https://www.chase.com/pay-a-bill', task: 'Pay my electricity bill' },
  { zone: 'government', who: 'P3, Daniel (Gov.uk #18, visa #11)', url: 'https://www.irs.gov/refund-status', task: 'Check my refund status' },
  { zone: 'health', who: 'P2, P3 (#14)', url: 'https://www.webmd.com/symptoms', task: 'Look up these symptoms' },
];
for (const z of SENSITIVE) {
  const { librarian: L } = makeSystem();
  await L.setProfileField('supportAreas', ['vision']);
  const obs = await L.logObservation({
    type: 'agent-task', url: z.url, text: `did ${z.task}`, data: { task: z.task, summary: 'done', success: true },
  });
  check(`P4: a task on a ${z.zone} site records nothing (${z.who})`, obs.logged === false && obs.reason === 'no-memory-zone');
  check(`P4: a task on a ${z.zone} site proposes nothing`, (await L.listProposals()).length === 0);
}

// ===========================================================================
// PART 5 — "silent commitments" / "no undo" (breakdowns #7, #12). The study's
// universal demand: suggest, never silently act. Nothing is saved or replayed
// until the person explicitly says yes.
// ===========================================================================
console.log('\n--- Part 5: consent before anything (breakdowns #7, #12) ---');
{
  const { librarian: L, datastore: DS } = makeSystem();
  await L.setProfileField('supportAreas', ['vision', 'reading']);
  // The Engineer building a skill does NOT persist it (Made's confirm-before-
  // execute rule, Daniel's plan-preview requirement).
  L.setGeminiCaller(async () => '```markdown\n---\nname: draft-only\ndescription: A drafted reading skill.\nsupportAreas: [reading]\nsiteRelevance: [news]\n---\n# Draft\n## Recipe\n```json\n{"adapters":[{"id":"visual-assist","settings":{"fontScale":140}}]}\n```\n```');
  const built = await L.buildSkill('make articles easier to read');
  check('P5: the Engineer produced a skill', built.valid && built.skill.name === 'draft-only');
  check('P5: building a skill does NOT save it (no silent commitment)',
    (await L.listSkills()).every(s => s.source === 'builtin'));

  // A reusable-task suggestion is a PROPOSAL, not an action — nothing replays
  // until accept.
  const task = 'Dismiss the newsletter popup';
  await L.logObservation({ type: 'agent-task', url: 'https://www.theatlantic.com/x', text: 'done', data: { task, summary: 'done', success: true } });
  const beforeProfiles = await DS.get('mine.profiles');
  check('P5: a suggested task is not auto-saved before consent',
    !(beforeProfiles || []).some(p => (p.actions || []).some(a => a.prompt === task)));
  const prop = (await L.listProposals())[0];

  // "Not now" (declineOnce) saves nothing and sets a cooldown; the task never runs.
  await L.respondToProposal(prop.id, 'declineOnce');
  check('P5: declining a suggestion saves nothing',
    !((await DS.get('mine.profiles')) || []).some(p => (p.actions || []).some(a => a.prompt === task)));
  check('P5: a declined suggestion is not left pending', (await L.listProposals()).length === 0);
}

// ===========================================================================
// PART 6 — coverage ledger: be honest about which of the 28 scenarios the
// toolkit's mechanisms actually cover, and which are aspirational.
// ===========================================================================
console.log('\n--- Part 6: honest coverage ledger over all 28 scenarios ---');
const LEDGER = {
  adapter:  [21, 22, 23, 24, 18, 19, 20],           // content/perception adaptations
  reusable: [2, 9],                                  // repeatable non-payment chores
  boundary: [11, 14],                                // sensitive → no-memory / handoff
  assistant:[10, 12, 13, 15, 16, 17, 25, 26],        // one-off agent/LLM help (Assistant layer)
  outOfScope:[1, 3, 4, 5, 6, 7, 8, 27, 28],          // aspirational: cart, booking, scheduling, leisure
};
const tagged = Object.values(LEDGER).flat();
check('P6: every one of the 28 scenarios is classified exactly once (documentation)',
  tagged.length === 28 && new Set(tagged).size === 28);
console.log(`   ledger: ${LEDGER.adapter.length} adapter, ${LEDGER.reusable.length} reusable, ` +
  `${LEDGER.boundary.length} boundary, ${LEDGER.assistant.length} assistant, ${LEDGER.outOfScope.length} out-of-scope`);

// A REAL integrity check (not documentation): every adapter that every
// shipping built-in skill references must exist in the real registry — a
// broken builtin (typo'd or removed adapter) fails here.
const builtinAdapterIds = [...new Set(BUILTINS.flatMap(s => (s.recipe?.adapters || []).map(a => a.id)))];
check(`P6: all ${builtinAdapterIds.length} adapters used by shipping builtin skills are real registry ids`,
  builtinAdapterIds.length > 0 && builtinAdapterIds.every(id => !!getSkillById(id)));
// And every content-need adapter this file claims coverage for is real.
check('P6: every content-need adapter mapped from the study is a real registry id',
  CONTENT_NEEDS.every(n => !!getSkillById(n.id)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
