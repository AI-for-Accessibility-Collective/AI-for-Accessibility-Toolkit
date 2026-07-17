#!/usr/bin/env node
// Skill layer demo — the Engineer builds a skill, the Librarian retrieves one,
// and both resolve to the adapter settings that actually adapt the page.
// Zero setup: no API key (a stub LLM stands in for the Engineer), no browser.
//
//   node toolkit/hosts/skill-demo/demo.js

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSkill, resolveSkill } from '../../core/skill.js';
import { buildSkill } from '../../core/skill-builder.js';
import { createDatastore } from '../../core/datastore.js';
import { createLibrarian } from '../../core/librarian.js';
import { TAXONOMY } from '../../core/taxonomy.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN = join(HERE, '..', '..', 'skills', 'builtin');
const log = (s) => console.log(s);

// A minimal registry stub (the real host injects AA_TOOLS).
const IDS = ['visual-assist', 'focus-mode', 'motion-reducer', 'dark-mode', 'auto-captions', 'keyboard-nav', 'auto-alt-text', 'generate-labels', 'wcag-fixes'];
const META = { fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1, 3] },
  focusMode: { type: 'boolean' }, hideDistractions: { type: 'boolean' }, motionReducer: { type: 'boolean' },
  darkMode: { type: 'boolean' }, autoCaptions: { type: 'boolean' }, enhanceFocus: { type: 'boolean' }, readingGuide: { type: 'boolean' } };
const tools = {
  settingsMeta: META, byId: (id) => IDS.includes(id) ? { id } : null,
  forPrompt: () => IDS.map(id => ({ id, name: id, description: id, supportAreas: ['vision'] })),
  settingsVocabularyLines: () => Object.keys(META).map(k => `- ${k}`),
};
const builtins = readdirSync(BUILTIN).filter(f => f.endsWith('.md')).map(f => parseSkill(readFileSync(join(BUILTIN, f), 'utf8')));

// In-memory ports.
const mem = { local: {}, sync: {} };
const area = (n) => ({ get: async (k, d) => mem[n][k] === undefined ? d : structuredClone(mem[n][k]), set: async (k, v) => { mem[n][k] = structuredClone(v); } });
const datastore = createDatastore({ areas: { local: area('local'), sync: area('sync') }, globalTier: { tools: () => tools, taxonomy: () => TAXONOMY, skills: () => builtins } });
const librarian = createLibrarian({ datastore: () => datastore, taxonomy: () => TAXONOMY, kv: { getAll: async () => structuredClone(mem.local), set: async (i) => Object.assign(mem.local, structuredClone(i)) } });

(async () => {
  await librarian.setProfileField('supportAreas', ['vision', 'reading']);

  log('━━━ 1. LIBRARIAN RETRIEVES a built-in skill for the page ━━━');
  const retrieved = await librarian.retrieveSkill('https://www.nytimes.com/2026/article');
  log(`  Page: a news article · person: low-vision reader`);
  log(`  → Retrieved skill: "${retrieved.name}" — ${retrieved.description}`);
  const plan = librarian.resolveSkill(retrieved);
  log(`  → Compiles to adapters: [${plan.adapterIds.join(', ')}]`);
  log(`  → With settings: ${JSON.stringify(plan.settings)}`);
  log('    (the host now hands these settings to the adapter layer — the actual page fix)\n');

  log('━━━ 2. ENGINEER BUILDS a new skill from a plain-language need ━━━');
  // Stub LLM: the real host injects Gemini/Claude via setGeminiCaller.
  librarian.setGeminiCaller(async (prompt) => {
    log('  (Engineer prompt grounds the model in the real adapter catalog — ' +
        (prompt.includes('visual-assist') ? 'confirmed)' : 'MISSING!)'));
    return [
      '---', 'name: shopping-ease',
      'description: Larger text and fewer distractions on shopping sites.',
      'supportAreas: [vision, cognitive]', 'siteRelevance: [shopping]', '---',
      '# Shopping Ease', 'Bigger product text, calmer page.',
      '## Recipe', '```json',
      JSON.stringify({ adapters: [{ id: 'visual-assist', settings: { fontScale: 140, enhanceFocus: true } }, { id: 'focus-mode', settings: { focusMode: true, hideDistractions: true } }] }, null, 2),
      '```',
    ].join('\n');
  });
  const need = '"Make text bigger and hide clutter when I shop online"';
  log(`  Need: ${need}`);
  const built = await librarian.buildSkill('Make text bigger and hide clutter when I shop online');
  log(`  → Engineer produced skill "${built.skill.name}" (valid: ${built.valid})`);
  log(`  → Resolves to: ${JSON.stringify(resolveSkill(built.skill).settings)}\n`);

  log('━━━ 3. USER VALIDATES → saved to their Skills db ━━━');
  const saved = await librarian.saveSkill(built.skill);
  log(`  Saved: ${saved.saved}`);
  const mine = (await librarian.listSkills()).filter(s => s.source === 'mine');
  log(`  Your skills now include: ${mine.map(s => s.name).join(', ')}`);
  // On a shopping site, the Librarian now retrieves the user's own skill:
  const onShop = await librarian.retrieveSkill('https://www.amazon.com/dp/x');
  log(`  → On a shopping page, Librarian retrieves: "${onShop.name}"\n`);

  const ok = retrieved.name === 'reading-aid'
    && plan.settings.fontScale === 130
    && built.valid && built.skill.name === 'shopping-ease'
    && saved.saved && onShop.name === 'shopping-ease';
  log(ok ? '✓ Skill flow complete: retrieve → resolve → build → validate → save → retrieve.'
        : '✗ Skill flow failed!');
  process.exit(ok ? 0 : 1);
})();
