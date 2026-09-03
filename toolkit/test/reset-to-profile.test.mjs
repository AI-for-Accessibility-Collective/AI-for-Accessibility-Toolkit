// resetToProfile — "forget what I've changed, go back to my profile".
//
// undoLast is LIFO and per-session; resetUndo clears a journal without restoring
// anything. Neither answers "start again from who I am", which is the whole
// point of an ability model: after a session drifts through a dozen spoken
// adjustments there must be a way back to the person.
//
// Runs the PURE core over an in-memory KVStore (no Chrome, no network).
//
//   node toolkit/test/reset-to-profile.test.mjs
import { createToolkit } from '../index.js';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

function memKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return areas[area][key]; },
    async set(area, key, value) { areas[area][key] = JSON.parse(JSON.stringify(value)); },
    async getAll(area) { return { ...areas[area] }; },
  };
}
const clock = { now: () => 1_700_000_000_000 };
async function fresh() {
  const tk = createToolkit({
    kv: memKV(), clock,
    scheduler: { every() {}, debounce() {} },
    consent: { notifyPending() {} },
  });
  await tk.datastore.runMigrations();
  return tk;
}

// ── the drift, then the way back ─────────────────────────────────────────────
{
  const { librarian: L } = await fresh();
  await L.recordScopedSettings('general', { fontScale: 180, darkMode: true });
  await L.recordScopedSettings('origin:example.com', { contrastMode: 'yellow-black' });

  // getEffectivePreferences returns { settings, applied, provenance, … }.
  const before = (await L.getEffectivePreferences('https://example.com/a')).settings;
  check('drift: explicit settings are in effect first', before.fontScale === 180 && before.darkMode === true, before);

  const r = await L.resetToProfile();
  check('reset: reports what it forgot', r.forgotten.length === 3, r.forgotten);
  check('reset: names the keys and scopes', (() => {
    const k = r.forgotten.map((f) => `${f.scope}/${f.key}`).sort();
    return k.join(',') === 'general/darkMode,general/fontScale,origin:example.com/contrastMode';
  })(), r.forgotten);
  check('reset: forgotten carries the value that was dropped', r.forgotten.find((f) => f.key === 'fontScale').value === 180);
  check('reset: lists the scopes it touched', r.scopes.includes('general') && r.scopes.includes('origin:example.com'));

  const after = (await L.getEffectivePreferences('https://example.com/a')).settings;
  check('reset: the explicit overrides are gone', !('fontScale' in after) && !('darkMode' in after), after);
  check('reset: contrast override at the origin scope is gone too', !('contrastMode' in after), after);
  check('reset: returns the restored view', r.restored && typeof r.restored.settings === 'object');
  check('reset: the restored view matches a fresh read', JSON.stringify(r.restored.settings) === JSON.stringify((await L.getEffectivePreferences(null)).settings));

  // Idempotent.
  const again = await L.resetToProfile();
  check('reset: a second reset is a no-op', again.forgotten.length === 0 && again.scopes.length === 0);
}

// ── it forgets overrides, not the person ─────────────────────────────────────
{
  const { librarian: L } = await fresh();
  await L.setProfileField('supportAreas', ['hearing']);
  await L.addNote('I am deaf', { source: 'user-explicit', topic: 'self-description' });
  await L.recordScopedSettings('general', { fontScale: 200 });

  await L.resetToProfile();

  const profile = await L.getProfile();
  check('reset: the PROFILE survives', Array.isArray(profile.supportAreas) && profile.supportAreas.includes('hearing'));
  const model = await L.getAbilityModel();
  check('reset: the ability model survives', model.supportAreas.includes('hearing'));
  // The self-description note is user-explicit but NOT a setting.* record.
  const notes = await L.getNotes ? await L.getNotes() : null;
  if (notes) check('reset: notes survive (only setting.* records are dropped)', JSON.stringify(notes).includes('deaf'));
  check('reset: the setting override is gone', (await L.getScopedSetting('general', 'fontScale')) === undefined);
}

// ── scoped reset only clears that scope ──────────────────────────────────────
{
  const { librarian: L } = await fresh();
  await L.recordScopedSettings('general', { fontScale: 150 });
  await L.recordScopedSettings('origin:news.example', { fontScale: 250 });

  const r = await L.resetToProfile({ scope: 'origin:news.example' });
  check('scoped reset: only that scope is forgotten', r.forgotten.length === 1 && r.forgotten[0].scope === 'origin:news.example');
  check('scoped reset: the other scope is untouched', (await L.getScopedSetting('general', 'fontScale')) === 150);
  check('scoped reset: the named scope is cleared', (await L.getScopedSetting('origin:news.example', 'fontScale')) === undefined);

  // An invalid scope is treated as 'general' (same as every other scope writer).
  await L.resetToProfile({ scope: 'nonsense!!' });
  check('scoped reset: an invalid scope falls back to general', (await L.getScopedSetting('general', 'fontScale')) === undefined);
}

console.log(`\nresetToProfile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
