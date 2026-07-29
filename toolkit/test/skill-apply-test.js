// Skill → apply bridge. A skill is only useful if the settings it resolves to
// are settings the extension's apply path actually consumes. This test walks
// every built-in skill (and a freshly built one) from SKILL.md → resolveSkill →
// settings, and asserts every resolved key is recognized by the apply path —
// catching a skill that silently resolves to a dead setting nothing acts on.
//
// Run: node toolkit/test/skill-apply-test.js
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSkill, resolveSkill } from '../core/skill.js';
import { parseBuiltSkill } from '../core/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(__dirname, '..', 'skills', 'builtin');

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }

// The exact settings keys the extension apply path (personalized-extension
// content.js applyProfileSettings + the basic extension) knows how to act on.
// A resolved key outside this set would be silently ignored at apply time.
const APPLY_KEYS = new Set([
  'enabled', 'autoWcagFix', 'autoFixLabels', 'autoDescribe', 'autoVideoDescribe',
  'autoCaptions', 'autoSimplify', 'autoSummarize', 'fixContrast', 'darkMode',
  'contrastMode', 'colorBlindMode', 'dyslexiaFont', 'fontScale', 'lineHeight',
  'letterSpacing', 'largeCursor', 'enhanceFocus', 'readingGuide', 'focusMode',
  'hideDistractions', 'showProgress', 'readerMode', 'motionReducer', 'keyboardNav',
  'voiceCommands',
]);

// Minimal tools registry so validate/parse-built has adapter ids + settings meta.
const IDS = ['visual-assist', 'focus-mode', 'motion-reducer', 'dark-mode', 'auto-captions',
  'auto-alt-text', 'generate-labels', 'wcag-fixes', 'keyboard-nav'];
const tools = {
  settingsMeta: {
    fontScale: { type: 'number', range: [50, 300] }, lineHeight: { type: 'number', range: [1, 3] },
    enhanceFocus: { type: 'boolean' }, readingGuide: { type: 'boolean' }, focusMode: { type: 'boolean' },
    hideDistractions: { type: 'boolean' }, showProgress: { type: 'boolean' }, motionReducer: { type: 'boolean' },
    darkMode: { type: 'boolean' }, autoCaptions: { type: 'boolean' }, autoDescribe: { type: 'boolean' },
    autoFixLabels: { type: 'boolean' }, autoWcagFix: { type: 'boolean' }, keyboardNav: { type: 'boolean' },
  },
  byId: (id) => IDS.includes(id) ? { id } : null,
};

// ── EVERY BUILT-IN SKILL RESOLVES TO APPLYABLE SETTINGS ───────────────────────
const files = readdirSync(BUILTIN_DIR).filter(f => f.endsWith('.md'));
check('ships built-in skills', files.length >= 4);

for (const f of files) {
  const skill = parseSkill(readFileSync(join(BUILTIN_DIR, f), 'utf8'));
  const plan = resolveSkill(skill);
  check(`${f}: resolves to at least one adapter`, plan.adapterIds.length > 0);
  check(`${f}: resolves to a non-empty settings object`, Object.keys(plan.settings).length > 0);
  const orphans = Object.keys(plan.settings).filter(k => !APPLY_KEYS.has(k));
  check(`${f}: every resolved setting is applyable (no orphans: ${orphans.join(',') || 'none'})`, orphans.length === 0);
}

// ── SPECIFIC WORKFLOWS: the right skill flips the right switches ───────────────
function loadSkill(name) { return parseSkill(readFileSync(join(BUILTIN_DIR, name), 'utf8')); }

{
  const plan = resolveSkill(loadSkill('screen-reader-boost.md'));
  // These are exactly the flags the extension maps to WcagFixes / GenerateLabels
  // / AutoAltText modules — the screen-reader stack.
  check('screen-reader-boost enables alt text, labels, and wcag fixes',
    plan.settings.autoDescribe === true && plan.settings.autoFixLabels === true && plan.settings.autoWcagFix === true);
  check('screen-reader-boost enables keyboard navigation', plan.settings.keyboardNav === true);
}
{
  const plan = resolveSkill(loadSkill('reading-aid.md'));
  check('reading-aid scales the font to a sane number', typeof plan.settings.fontScale === 'number' && plan.settings.fontScale >= 100 && plan.settings.fontScale <= 300);
  check('reading-aid opens line spacing and calms the page', plan.settings.lineHeight > 1 && plan.settings.focusMode === true && plan.settings.hideDistractions === true);
}
{
  const plan = resolveSkill(loadSkill('calm-browsing.md'));
  check('calm-browsing reduces motion and dims distractions', plan.settings.motionReducer === true && plan.settings.hideDistractions === true);
}
{
  const plan = resolveSkill(loadSkill('quiet-video.md'));
  check('quiet-video turns on captions and reduces motion', plan.settings.autoCaptions === true && plan.settings.motionReducer === true);
}

// ── A FRESHLY BUILT SKILL (the Engineer) ALSO RESOLVES TO APPLYABLE SETTINGS ───
const BUILT = `Here is your skill:
\`\`\`markdown
---
name: night-reader
description: Calm, dark, large-text reading for late-night articles.
supportAreas: [vision, reading]
siteRelevance: [news, blog]
---
# Night Reader
\`\`\`json
{ "adapters": [
  { "id": "visual-assist", "settings": { "fontScale": 140, "enhanceFocus": true } },
  { "id": "dark-mode", "settings": { "darkMode": true } },
  { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true } }
] }
\`\`\`
\`\`\``;
const built = parseBuiltSkill(BUILT, { tools });
check('Engineer output (with preamble + fences) parses to a valid skill', built.valid && built.skill.name === 'night-reader');
{
  const plan = resolveSkill(built.skill);
  const orphans = Object.keys(plan.settings).filter(k => !APPLY_KEYS.has(k));
  check('built skill resolves only to applyable settings', orphans.length === 0);
  check('built skill actually flips its switches (dark + big text)', plan.settings.darkMode === true && plan.settings.fontScale === 140);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
