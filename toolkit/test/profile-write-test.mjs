// setProfileFields: several profile paths, ONE record write.
//
// Every profile field lives in the single `mine.profile` record, so setting
// four of them with four setProfileField calls is four read-modify-write
// cycles over the same document. A caller that loses its connection partway
// through leaves a profile describing a person who does not exist: needs
// derived from support areas that were never stored, or a vision kind the
// needs contradict. Onboarding is exactly that caller. The plural setter
// exists so the record takes the whole form or none of it.
//
// The counting KV below is the point of the file: correctness of the values is
// easy, but the GUARANTEE is that the record is written once, so we count the
// writes rather than trusting the shape of the code.
//
//   node toolkit/test/profile-write-test.mjs
import { createToolkit } from '../index.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// Counts the sets that actually reach storage, per key.
function countingKV(counts) {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) {
      counts[key] = (counts[key] || 0) + 1;
      areas[area][key] = JSON.parse(JSON.stringify(value));
    },
    async getAll(area) { return { ...areas[area] }; },
  };
}

async function fresh(counts) {
  const tk = createToolkit({
    kv: countingKV(counts), clock: { now: () => 1_700_000_000_000 },
    scheduler: { every() {}, debounce() {} },
    consent: { notifyPending() {} },
  });
  await tk.datastore.runMigrations();
  return tk;
}

// The key the profile actually lands on, so the count below is not guessing at
// a key name that a partition-scheme change could quietly rename.
function profileKeyOf(counts) {
  return Object.keys(counts).find((k) => k.includes('mine.profile'));
}

const FORM = {
  supportAreas: ['vision'],
  'fields.needs': [{ dimension: 'textSize', value: 1.5 }],
  'fields.visionKind': 'lowVision',
  freeText: 'I need bigger text',
};

// ── one call, one write, every value present ───────────────────────────────
{
  const counts = {};
  const { librarian } = await fresh(counts);
  const before = { ...counts };
  await librarian.setProfileFields(FORM);
  const key = profileKeyOf(counts);
  check('profile record is written exactly once', key && counts[key] - (before[key] || 0) === 1,
    { key, before: before[key] || 0, after: counts[key] });

  const p = await librarian.getProfile();
  check('supportAreas set', JSON.stringify(p.supportAreas) === JSON.stringify(['vision']));
  check('nested fields.needs set', p.fields?.needs?.[0]?.dimension === 'textSize');
  check('nested fields.visionKind set', p.fields?.visionKind === 'lowVision');
  check('freeText set', p.freeText === 'I need bigger text');
  check('updatedAt stamped', typeof p.updatedAt === 'number');
}

// ── the same four fields one at a time cost four writes ────────────────────
// Not a style preference. Each of those writes is a separate chance to fail
// with the profile half-updated, which is the failure the plural setter is
// here to remove.
{
  const counts = {};
  const { librarian } = await fresh(counts);
  const key0 = profileKeyOf(counts);
  const before = key0 ? counts[key0] : 0;
  for (const [path, value] of Object.entries(FORM)) await librarian.setProfileField(path, value);
  const key = profileKeyOf(counts);
  check('four singular calls cost four writes', counts[key] - before === 4, { writes: counts[key] - before });
}

// ── singular still behaves exactly as before ───────────────────────────────
{
  const counts = {};
  const { librarian } = await fresh(counts);
  await librarian.setProfileField('fields.visionKind', 'blind');
  check('singular sets a nested path', (await librarian.getProfile()).fields?.visionKind === 'blind');
  await librarian.setProfileField('fields.visionKind', null);
  check('singular clears a nested path', (await librarian.getProfile()).fields?.visionKind === null);
}

// ── prototype-pollution guard survives the plural form ─────────────────────
// The guard is at the sink, and the plural setter is a second door into that
// sink. A poisoned path is dropped; clean paths beside it still land, and a
// call that is ENTIRELY poisoned must not write at all (a dropped path must
// not look like an edit by bumping updatedAt).
{
  const counts = {};
  const { librarian } = await fresh(counts);
  await librarian.setProfileFields({ '__proto__.polluted': 'yes', freeText: 'clean value' });
  check('poisoned path does not reach Object.prototype', ({}).polluted === undefined);
  check('clean path beside it still applies', (await librarian.getProfile()).freeText === 'clean value');

  const key = profileKeyOf(counts);
  const before = counts[key];
  const stamped = (await librarian.getProfile()).updatedAt;
  await librarian.setProfileFields({ 'constructor.x': 1, 'a.prototype.b': 2 });
  check('an entirely poisoned call writes nothing', counts[key] === before);
  check('an entirely poisoned call leaves updatedAt alone', (await librarian.getProfile()).updatedAt === stamped);
  // The singular setter now delegates to the plural one, so its own guard has
  // to keep working through that delegation.
  const stamped2 = (await librarian.getProfile()).updatedAt;
  await librarian.setProfileField('__proto__.owned', 'yes');
  check('poisoned singular path writes nothing', counts[key] === before);
  check('poisoned singular path leaves updatedAt alone', (await librarian.getProfile()).updatedAt === stamped2);
  check('poisoned singular path does not pollute', ({}).owned === undefined);
}

// ── empty and absent inputs ────────────────────────────────────────────────
{
  const counts = {};
  const { librarian } = await fresh(counts);
  await librarian.setProfileFields(FORM);
  const key = profileKeyOf(counts);
  const before = counts[key];
  await librarian.setProfileFields({});
  check('empty field map writes nothing', counts[key] === before);
  check('empty field map returns the profile', (await librarian.setProfileFields()).freeText === 'I need bigger text');
  // Clearing is a write of empty values, not an absence of values: onboarding
  // depends on this to drop what someone deselected.
  await librarian.setProfileFields({ supportAreas: [], 'fields.needs': [], 'fields.visionKind': null, freeText: '' });
  const p = await librarian.getProfile();
  check('empty values clear the profile', p.supportAreas.length === 0 && p.fields.needs.length === 0
    && p.fields.visionKind === null && p.freeText === '');
}

console.log(`\nProfile writes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
