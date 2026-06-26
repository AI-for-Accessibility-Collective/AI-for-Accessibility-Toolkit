// Phase 1 toolkit test — runs the PURE core directly (ES modules, in-memory
// KVStore, no Chrome, no eval). Covers the three Phase 1 additions:
//   1. typed units — coercion parity with the legacy heuristic
//   2. requirement strength — floor > preference > hint in the merge
//   3. SurfaceAdapter — honest cannot-satisfy verdicts
//
//   node toolkit/test/phase1.test.mjs
import { createToolkit } from '../index.js';
import { coerceSetting, coerceSettings, unitOf } from '../core/units.js';
import { createSurfaceAdapter } from '../core/surface.js';
import { createWebSurface } from '../adapters/chrome/web-surface.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// --- in-memory KVStore (proves the core needs no chrome) ---
function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}

// Minimal tools registry: just the settingsMeta the merge/coercion reads.
const settingsMeta = {
  fontScale:  { type: 'number', range: [50, 200], description: 'Font size %' },
  lineHeight: { type: 'number', range: [1.0, 3.0], description: 'Line spacing' },
  darkMode:   { type: 'boolean', description: 'Dark theme' },
};
const toolsRegistry = { settingsMeta };

const rec = (scope, settings, extra = {}) => ({
  id: 'r-' + scope + '-' + Object.keys(settings)[0] + '-' + (extra.strength || 'pref'),
  text: 't', tier: 'preference', scope, kind: 'preference',
  importance: 5, confidence: 0.9, decayClass: 'stable', settings,
  status: 'active', source: 'test', conditions: null,
  occurrenceCount: 1, firstSeenAt: 1, createdAt: 1, updatedAt: 1, lastAccessed: 1,
  supersededBy: null, aspect: null, ...extra,
});

// ======================= 1. typed units =======================
check('unitOf(fontScale) = percent', unitOf('fontScale') === 'percent');
check('unitOf(lineHeight) = ratio', unitOf('lineHeight') === 'ratio');
check('coerce fontScale 1.5 -> 150 (multiplier)', coerceSetting('fontScale', 1.5, settingsMeta) === 150);
check('coerce fontScale 2 -> 200', coerceSetting('fontScale', 2, settingsMeta) === 200);
check('coerce fontScale 999 -> clamp 200', coerceSetting('fontScale', 999, settingsMeta) === 200);
check('coerce lineHeight 1.5 untouched', coerceSetting('lineHeight', 1.5, settingsMeta) === 1.5);
check('coerce passes through booleans', coerceSetting('darkMode', true, settingsMeta) === true);
check('coerce passes through unknown keys', coerceSetting('angularTextHeight', 5, settingsMeta) === 5);
check('coerceSettings maps all keys',
  JSON.stringify(coerceSettings({ fontScale: 1.5, darkMode: true }, settingsMeta)) === JSON.stringify({ fontScale: 150, darkMode: true }));

// ======================= 2. requirement strength =======================
const { datastore: ds, librarian: lib } = createToolkit({ kv: memKV(), toolsRegistry });
await ds.runMigrations();

// A floor at the LESS specific scope (general) must beat a soft preference at
// the MORE specific scope (origin) — the "floor never dropped by a narrower
// soft preference" rule.
await ds.setMemoryShard('general', [rec('general', { fontScale: 160 }, { strength: 'floor' })]);
await ds.setMemoryShard('origin:nytimes.com', [rec('origin:nytimes.com', { fontScale: 120 }, { strength: 'preference' })]);
const p1 = await lib.getEffectivePreferences('https://www.nytimes.com/article', []);
check('floor at general beats preference at origin', p1.settings.fontScale === 160);
check('floor provenance is general', p1.provenance.fontScale === 'general');

// A hint at the MORE specific scope must NOT beat a preference at a less
// specific scope.
await ds.setMemoryShard('general', [rec('general', { darkMode: false }, { strength: 'preference' })]);
await ds.setMemoryShard('origin:nytimes.com', [rec('origin:nytimes.com', { darkMode: true }, { strength: 'hint' })]);
const p2 = await lib.getEffectivePreferences('https://www.nytimes.com/article', []);
check('preference beats a more-specific hint', p2.settings.darkMode === false);

// All-preference: existing precedence preserved (origin beats general).
await ds.setMemoryShard('general', [rec('general', { fontScale: 110 })]);
await ds.setMemoryShard('origin:nytimes.com', [rec('origin:nytimes.com', { fontScale: 150 })]);
const p3 = await lib.getEffectivePreferences('https://www.nytimes.com/article', []);
check('all-preference: origin still beats general (unchanged)', p3.settings.fontScale === 150);

// A record with NO strength field reads as preference (back-compat).
await ds.setMemoryShard('general', [rec('general', { fontScale: 130 })]); // rec() sets no strength when extra omits it
const noStrength = (await ds.getMemoryShard('general'))[0];
check('records may carry no strength field', noStrength.strength === undefined);
const p4 = await lib.getEffectivePreferences('https://unknown-xyz.test/', []);
check('missing strength merges as preference', p4.settings.fontScale === 130);

// ======================= 3. SurfaceAdapter cannot-satisfy =======================
const web = createWebSurface(settingsMeta);
const s1 = web.apply({ fontScale: 150, darkMode: true });
check('web surface applies supported settings', s1.applied.fontScale === 150 && s1.applied.darkMode === true);
check('web surface fully satisfied', s1.satisfied === true && s1.unmet.length === 0);

const s2 = web.apply({ fontScale: 300 });
check('web surface degrades out-of-range to bound', s2.applied.fontScale === 200 && s2.degradedTo.fontScale === 200);
check('degraded still counts as satisfied', s2.satisfied === true);

const s3 = web.apply({ angularTextHeight: 5 });
check('web surface reports unsupported XR-only key', s3.unmet.length === 1 && s3.unmet[0].reason === 'unsupported');
check('unsupported key makes it NOT satisfied', s3.satisfied === false && !('angularTextHeight' in s3.applied));

// A surface that can represent only a bounded set, no degrade → not-representable.
const strict = createSurfaceAdapter({
  id: 'strict',
  supports: { contrastMode: { representable: (v) => v === 'none' || v === 'light' } },
});
const s4 = strict.apply({ contrastMode: 'yellow-black' });
check('strict surface reports not-representable', s4.unmet.length === 1 && s4.unmet[0].reason === 'not-representable');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
