// Phase 1 toolkit test — runs the PURE core directly (ES modules, in-memory
// KVStore, no Chrome, no eval). Covers the three Phase 1 additions:
//   1. typed units — coercion parity with the legacy heuristic
//   2. requirement strength — floor > preference > hint in the merge
//   3. SurfaceAdapter — honest cannot-satisfy verdicts
//
//   node toolkit/test/phase1.test.mjs
import { createToolkit } from '../index.js';
import { coerceSetting, coerceSettings, clampSetting, unitOf } from '../core/units.js';
import { createSurfaceAdapter } from '../core/surface.js';
import { createWebSurface, deriveWebSettings, resolveWebPreferences } from '../adapters/chrome/web-surface.js';
import { toAbilityModel } from '../core/ability.js';

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
// clampSetting is the READ-path normalizer: clamp-only, NO multiplier guess.
check('clampSetting: in-range untouched', clampSetting('fontScale', 150, settingsMeta) === 150);
check('clampSetting: above range clamped to max', clampSetting('fontScale', 999, settingsMeta) === 200);
check('clampSetting: does NOT guess multiplier (1.5 -> clamp 50)', clampSetting('fontScale', 1.5, settingsMeta) === 50);
check('clampSetting: passes through booleans + unknown keys', clampSetting('darkMode', true, settingsMeta) === true && clampSetting('zzz', 7, settingsMeta) === 7);

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

// ======================= 4. AbilityModel projector (increment 2) =======================
const emptyProfile = { schemaVersion: 1, supportAreas: ['vision'], freeText: 'small text', fields: {}, metaPreferences: { language: 'plain' } };
const am0 = toAbilityModel(emptyProfile);
check('toAbilityModel: empty fields -> needs []', Array.isArray(am0.needs) && am0.needs.length === 0);
check('toAbilityModel: carries supportAreas/freeText/language', am0.supportAreas[0] === 'vision' && am0.freeText === 'small text' && am0.language === 'plain');
check('toAbilityModel: null profile is safe', toAbilityModel(null).needs.length === 0);
const amN = toAbilityModel({ fields: { needs: [
  { dimension: 'textSize', value: 1.6, strength: 'floor' },
  { dimension: 'bogus', strength: 'WAT' },          // bad strength -> preference; kept (has dimension)
  { value: 1 },                                      // no dimension -> dropped
] } });
check('toAbilityModel: drops needs without a dimension', amN.needs.length === 2);
check('toAbilityModel: clamps bad strength to preference', amN.needs.find(n => n.dimension === 'bogus').strength === 'preference');

// ======================= 5. deriveWebSettings (increment 2) =======================
check('deriveWebSettings: empty needs is INERT', JSON.stringify(deriveWebSettings({ needs: [] })) === JSON.stringify({ settings: {}, strengthByKey: {}, unmet: [] }));
check('deriveWebSettings: no model is inert', JSON.stringify(deriveWebSettings(null).settings) === '{}');
const d1 = deriveWebSettings({ needs: [{ dimension: 'textSize', value: 1.6, strength: 'floor' }] });
check('deriveWebSettings: textSize 1.6 -> fontScale 160', d1.settings.fontScale === 160 && d1.strengthByKey.fontScale === 'floor');
const d2 = deriveWebSettings({ needs: [{ dimension: 'flyToMoon', value: 1 }] });
check('deriveWebSettings: unknown dimension -> no setting, reported unmet',
  Object.keys(d2.settings).length === 0 && d2.unmet.some(u => u.key === 'flyToMoon'));
const d3 = deriveWebSettings({ needs: [
  { dimension: 'textSize', value: 1.2, strength: 'preference' },
  { dimension: 'textSize', value: 1.8, strength: 'floor' },
] });
check('deriveWebSettings: stronger need wins a collision', d3.settings.fontScale === 180);

// ======================= 6. resolveWebPreferences (increment 2) =======================
const { datastore: ds2, librarian: lib2 } = createToolkit({ kv: memKV(), toolsRegistry });
await ds2.runMigrations();
const rwpArgs = (url) => ({ librarian: lib2, settingsMeta, url, contexts: [] });

// getAbilityModel must be READ-ONLY — never materialize mine.profile (it runs on
// the per-navigation hot path). Verified on a fresh toolkit with no profile yet.
const { datastore: dsRO, librarian: libRO } = createToolkit({ kv: memKV(), toolsRegistry });
const amRO = await libRO.getAbilityModel();
check('getAbilityModel: empty needs on fresh profile', amRO.needs.length === 0);
check('getAbilityModel: READ-ONLY (does not materialize mine.profile)', (await dsRO.get('mine.profile')) === null);

// IDENTITY: empty needs + a real record -> response.settings deep-equals the raw merge.
await ds2.setMemoryShard('general', [rec('general', { fontScale: 140, darkMode: true })]);
const raw = await lib2.getEffectivePreferences('https://news-x.test/', []);
const resolved = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: settings deep-equal raw merge (identity)', JSON.stringify(resolved.settings) === JSON.stringify(raw.settings));
check('resolveWebPreferences: satisfied + no unmet for web-native settings', resolved.surface.satisfied === true && resolved.surface.unmet.length === 0);
check('resolveWebPreferences: preserves provenance + category', JSON.stringify(resolved.provenance) === JSON.stringify(raw.provenance));

// ACTIVE: a structured need with no conflicting record -> derived baseline fills it.
await lib2.setProfileField('fields.needs', [{ dimension: 'textSize', value: 1.5, strength: 'floor' }]);
await ds2.setMemoryShard('general', []); // no records -> derived baseline is the only source
const active = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: derived ability baseline applies when no record', active.settings.fontScale === 150);
check('resolveWebPreferences: derived key gets ability provenance', active.provenance.fontScale === 'derived:ability');

// COMPOSITION: a real record beats the derived baseline (identity-safe rule).
await ds2.setMemoryShard('general', [rec('general', { fontScale: 120 })]);
const composed = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: real record beats derived baseline', composed.settings.fontScale === 120);

// DERIVED CLAMP: an out-of-range derived value is clamped to the registry bound.
await lib2.setProfileField('fields.needs', [{ dimension: 'textSize', value: 5, strength: 'floor' }]); // 5x -> 500% -> 200
await ds2.setMemoryShard('general', []);
const clampD = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: derived out-of-range clamped to bound', clampD.settings.fontScale === 200);

// IDENTITY HARDENING (from the adversarial review): the surface must NOT drop
// keys the merge produced — an off-vocabulary extracted key and a string-typed
// numeric both survive verbatim, and neither trips the cannot-satisfy branch.
await lib2.setProfileField('fields.needs', []);
await ds2.setMemoryShard('general', [rec('general', { fontScale: 140, autoSummaries: true })]); // autoSummaries not in settingsMeta
const rawO = await lib2.getEffectivePreferences('https://news-x.test/', []);
const resO = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: off-vocabulary key PRESERVED (not dropped)',
  resO.settings.autoSummaries === true && JSON.stringify(resO.settings) === JSON.stringify(rawO.settings));
check('resolveWebPreferences: off-vocab key does NOT trip cannot-satisfy', resO.surface.satisfied === true && resO.surface.unmet.length === 0);

await ds2.setMemoryShard('general', [rec('general', { fontScale: '150' })]); // string numeric (LLM-style)
const resS = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: string-numeric on a registry key PRESERVED', resS.settings.fontScale === '150' && resS.surface.satisfied === true);

// CANNOT-SATISFY: comes from an ABILITY NEED with no web rendering, not merge keys.
await lib2.setProfileField('fields.needs', [{ dimension: 'spatialAudio', value: true, strength: 'floor' }]);
await ds2.setMemoryShard('general', []);
const csN = await resolveWebPreferences(rwpArgs('https://news-x.test/'));
check('resolveWebPreferences: unmappable ability need reported unmet',
  csN.surface.unmet.some(u => u.key === 'spatialAudio') && csN.surface.satisfied === false);
check('resolveWebPreferences: unmappable need does not pollute settings', !('spatialAudio' in csN.settings));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
