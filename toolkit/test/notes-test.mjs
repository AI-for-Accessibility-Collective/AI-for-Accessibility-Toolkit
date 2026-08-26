// Natural-language notes API — store / organize / query.
//
// Runs the PURE core over an in-memory KVStore (no Chrome, no network), the
// same way phase1.test.mjs does.
//
//   node toolkit/test/notes-test.mjs
import { createToolkit, GRANT_SCOPES, filterAbilityModelByScopes } from '../index.js';

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

// A clock we can push forward, so decay/recency is testable without waiting.
let nowMs = 1_700_000_000_000;
const clock = { now: () => nowMs };

async function fresh() {
  const tk = createToolkit({
    kv: memKV(), clock,
    scheduler: { every() {}, debounce() {} },
    consent: { notifyPending() {} },
  });
  await tk.datastore.runMigrations();
  return tk;
}

const { librarian: L } = await fresh();

// ---- store ---------------------------------------------------------------
const added = await L.addNote('I have low vision and read with my nose near the screen.');
check('addNote returns ok + id', added.ok === true && typeof added.id === 'string');
check('addNote echoes the note back', added.note.text.startsWith('I have low vision'));
check('a bare note defaults to general scope', added.note.scope === 'general');
check('a bare note is user-explicit', added.note.source === 'user-explicit');

check('empty text is refused, not stored', (await L.addNote('   ')).ok === false);
check('null text is refused', (await L.addNote(null)).reason === 'empty-text');

const longText = 'x'.repeat(900);
const long = await L.addNote(longText, { topic: 'long' });
check('over-long note is truncated to the record cap', long.note.text.length === 500);

// ---- organize ------------------------------------------------------------
await L.addNote('Captions matter more than audio quality to me.', { topic: 'hearing' });
await L.addNote('News sites overwhelm me — too many columns.', { scope: 'category:news', topic: 'layout' });

const all = await L.listNotes();
check('listNotes returns every active note', all.length === 4, all.map(n => n.topic));
check('listNotes is newest-first', all[0].updatedAt >= all[all.length - 1].updatedAt);
check('scope filter narrows to one shard',
  (await L.listNotes({ scope: 'category:news' })).length === 1);
check('topic filter narrows to one topic',
  (await L.listNotes({ topic: 'hearing' }))[0].text.startsWith('Captions matter'));

// Same topic + same scope is a refinement, not a second note.
nowMs += 60_000;
const refined = await L.addNote('Captions matter, and I need them accurate, not just present.',
  { topic: 'hearing' });
check('same topic+scope updates in place (one note, not two)',
  (await L.listNotes({ topic: 'hearing' })).length === 1);
check('the refinement is the text that survived',
  refined.note.text.endsWith('not just present.'));
check('re-stating bumps occurrenceCount', refined.note.occurrenceCount === 2);
check('same topic at a DIFFERENT scope is a separate note',
  (await L.addNote('Here, captions are unusable.', { topic: 'hearing', scope: 'origin:example.com' })).ok
  && (await L.listNotes({ topic: 'hearing' })).length === 2);

// Topics are filing labels, normalized.
const odd = await L.addNote('Bright screens hurt.', { topic: '  Light   Sensitivity!! ' });
check('topic is normalized to a slug', odd.note.topic === 'light-sensitivity');
check('a junk topic files as untopiced, not as a junk aspect',
  (await L.addNote('Standalone thought.', { topic: '???' })).note.topic === null);

// Re-filing.
const moved = await L.updateNote(odd.note.id, { scope: 'category:shopping', text: 'Bright screens hurt my eyes.' });
check('updateNote moves the note between shards', moved.ok && moved.note.scope === 'category:shopping');
check('the note is gone from its old shard',
  !(await L.listNotes({ scope: 'general' })).some(n => n.id === odd.note.id));
check('the note is present in its new shard',
  (await L.listNotes({ scope: 'category:shopping' })).some(n => n.id === odd.note.id));
check('updateNote rewords', moved.note.text === 'Bright screens hurt my eyes.');
check('updateNote on a missing id reports not-found',
  (await L.updateNote('nope', { text: 'x' })).reason === 'not-found');
check('updateNote refuses to blank a note', (await L.updateNote(moved.note.id, { text: '  ' })).ok === false);

// ---- query ---------------------------------------------------------------
const vision = await L.findNotes('vision');
check('findNotes matches on a word in the text', vision.length >= 1 && vision[0].text.includes('low vision'));
check('findNotes reports WHICH terms matched', vision[0].matched.includes('vision'));

check('findNotes matches a plural/tense variant via prefix',
  (await L.findNotes('caption')).some(n => n.text.toLowerCase().includes('captions')));
check('a query with no overlap returns nothing', (await L.findNotes('bicycle repair')).length === 0);
check('stopwords alone match nothing meaningful',
  (await L.findNotes('the and with')).length === 0);
check('an empty query returns everything, best-scored first',
  (await L.findNotes('')).length === (await L.listNotes()).length);
check('limit is honoured', (await L.findNotes('', { limit: 2 })).length === 2);

// url narrows to the page's scope chain, and a scoped note outranks a general one.
const onNews = await L.findNotes('captions', { url: 'https://bbc.com/news' });
check('a url restricts results to that page\'s scope chain',
  onNews.every(n => n.scope === 'general' || n.scope === 'category:news'));
check('an origin note is invisible on a different origin',
  !onNews.some(n => n.scope === 'origin:example.com'));
const onExample = await L.findNotes('captions', { url: 'https://example.com/x' });
check('a scoped note outranks a general one on its own page',
  onExample[0].scope === 'origin:example.com', onExample.map(n => n.scope));
check('explicit scope option restricts to exactly that scope',
  (await L.findNotes('', { scope: 'category:news' })).every(n => n.scope === 'category:news'));

// ---- notes never actuate, and never leave the device ---------------------
const eff = await L.getEffectivePreferences('https://bbc.com/news', []);
check('a note NEVER becomes an applied setting',
  !Object.keys(eff.settings).length, eff.settings);

await L.setProfileField('supportAreas', ['vision']);
const am = await L.getAbilityModel();
check('the AbilityModel has no notes field', !('notes' in am));
check('no grant scope can reach a note',
  !GRANT_SCOPES.some(sc => 'notes' in filterAbilityModelByScopes({ ...am, notes: ['leak'] }, [sc])));

// ---- recall surfaces prose in its own section ----------------------------
const rec = await L.recall('https://bbc.com/news', '', []);
check('recall gives notes their own heading', rec.block.includes('### In their own words'));
check('recall quotes the note text', rec.block.includes('too many columns'));
await L.recordScopedSettings('general', { fontScale: 150 });
const rec2 = await L.recall('https://bbc.com/news', '', []);
check('engine sentences stay under their own heading, not the prose one',
  rec2.block.indexOf('You set fontScale') > rec2.block.indexOf('### General preferences'));

// ---- delete --------------------------------------------------------------
const victim = (await L.listNotes({ scope: 'category:shopping' }))[0];
check('deleteNote removes it', (await L.deleteNote(victim.id)).removed === true);
check('it is really gone', !(await L.listNotes()).some(n => n.id === victim.id));
check('deleting twice reports not-found', (await L.deleteNote(victim.id)).removed === false);
check('deleteNote refuses a non-note record id',
  (await L.deleteNote((await L.listMemories()).memories.find(m => m.kind === 'preference').id)).ok === false);

// ---- inferred notes respect the memory pause -----------------------------
await L.setMemoryPaused(true);
check('an INFERRED note is refused while memory is paused',
  (await L.addNote('They seem to prefer dark mode.', { source: 'inferred' })).reason === 'paused');
check('a note the PERSON writes is stored even while paused',
  (await L.addNote('I still want to say this.', { topic: 'paused-ok' })).ok === true);
await L.setMemoryPaused(false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
