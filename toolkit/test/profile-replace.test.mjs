import assert from 'node:assert/strict';
import { createToolkit } from '../index.js';
import { memoryKV } from '../platforms/node/kv.js';

let now = 1000, writes = 0, rejectWrite = false;
const underlying = memoryKV();
const kv = {
  ...underlying,
  async set(area, key, value) {
    if (key.includes('mine.profile')) {
      if (rejectWrite) throw new Error('storage unavailable');
      writes++;
    }
    return underlying.set(area, key, value);
  },
};
const { librarian, datastore } = createToolkit({ kv, clock: { now: () => now } });
await datastore.runMigrations();
await librarian.setProfileFields({ custom: 'remove me', 'fields.old': true, memoryPaused: true });
await datastore.set('mine.grants', [{ appId: 'keep' }]);
await datastore.setMemoryShard('general', [{ id: 'memory-keep' }]);
const old = await librarian.getProfile();
const before = writes;
now = 2000;
const incoming = { supportAreas: ['vision'], fields: { needs: [{ dimension: 'textSize', value: 1.5 }] }, nested: { key: false }, createdAt: 99, schemaVersion: 88 };
const replaced = await librarian.replaceProfile(incoming);
assert.equal(writes - before, 1, 'replacement must be one record write');
assert.equal(replaced.custom, undefined);
assert.equal(replaced.fields.old, undefined);
assert.equal(replaced.memoryPaused, undefined, 'omitted flags are removed too');
assert.equal(replaced.schemaVersion, 1);
assert.equal(replaced.createdAt, old.createdAt ?? 2000);
assert.equal(replaced.updatedAt, 2000);
assert.equal((await librarian.getAbilityModel()).needs[0].value, 1.5);
incoming.fields.needs[0].value = 9;
assert.equal((await librarian.getProfile()).fields.needs[0].value, 1.5, 'no shared input references');
assert.deepEqual(await datastore.get('mine.grants'), [{ appId: 'keep' }]);
assert.deepEqual(await datastore.getMemoryShard('general'), [{ id: 'memory-keep' }]);

const invalid = [null, [], 'text', { supportAreas: null }, { fields: [] }, { metaPreferences: null },
  { freeText: 1 }, { fields: { needs: [{}] } }, { v: Infinity }, { v: undefined },
  JSON.parse('{"fields":{"__proto__":{"polluted":true}}}'), { v: { constructor: {} } }];
const cycle = {}; cycle.child = cycle; invalid.push(cycle);
const stable = await librarian.getProfile();
const count = writes;
for (const value of invalid) await assert.rejects(() => librarian.replaceProfile(value));
assert.equal(writes, count, 'invalid input must never write');
assert.deepEqual(await librarian.getProfile(), stable);
assert.equal({}.polluted, undefined);
rejectWrite = true;
await assert.rejects(() => librarian.replaceProfile({ freeText: 'failed' }), /storage unavailable/);
assert.deepEqual(await librarian.getProfile(), stable, 'failed writes leave the old profile intact');
rejectWrite = false;
await librarian.replaceProfile({});
assert.deepEqual((await librarian.getAbilityModel()).needs, [], 'empty replacement clears previous needs');
console.log('Profile replacement: atomic writes, deletion, isolation, validation, and failure checks passed.');
