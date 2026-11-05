import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolkit } from '../../toolkit/index.js';
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createToolkitPreferenceProvider, ActingUserMismatchError } from '../src/toolkit-preferences.mjs';

// Shared in-memory port tests persistence across toolkit instances, not restarts.
function memoryKV() {
  const areas = {};
  return {
    async get(area, key) { return structuredClone(areas[area]?.[key]); },
    async set(area, key, value) {
      areas[area] = areas[area] || {};
      if (value === undefined) delete areas[area][key];
      else areas[area][key] = structuredClone(value);
    },
    async getAll(area) { return structuredClone(areas[area] || {}); },
  };
}

test('profile text size reaches the pipeline and can be restored', async () => {
  const kv = memoryKV();
  const { librarian } = createToolkit({ kv });
  const pipelineFor = librarian => createCaptionFlowPipeline({
    transcriber: createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) }),
    captionProcessor: createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) }),
    preferenceProvider: createToolkitPreferenceProvider({ librarian }),
  });
  const request = { videoId: 'fictional-notice-001', media: { kind: 'fixture' } };
  const pipeline = pipelineFor(librarian);
  assert.equal((await pipeline.run(request)).preferences.fontScale, 1);
  await createToolkitPreferenceProvider({ librarian }).setTextSize({ value: 1.3, unit: 'ratio' });
  assert.equal((await pipeline.run(request)).preferences.fontScale, 1.3);
  const reopened = createToolkit({ kv }).librarian;
  assert.equal((await pipelineFor(reopened).run(request)).preferences.fontScale, 1.3);
  await reopened.setProfileField('fields.needs', []);
  assert.equal((await pipelineFor(reopened).run(request)).preferences.fontScale, 1);
});

test('explicit text-size choice saves a ratio without removing other needs', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setProfileField('fields.needs', [
    { dimension: 'reduceMotion', value: true, strength: 'preference' },
    { dimension: 'textSize', value: 1.1, strength: 'preference', unit: 'ratio' },
  ]);
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.4 });
  const model = await librarian.getAbilityModel();
  assert.ok(model.needs.some(n => n.dimension === 'reduceMotion' && n.value === true));
  assert.equal(model.needs.filter(n => n.dimension === 'textSize' && n.source === 'captionflow-user').length, 1);
  assert.equal((await provider.getPreferences({})).fontScale, 1.4);
  assert.equal(model.needs.find(n => n.source === 'captionflow-user').unit, 'ratio');
});

test('invalid text-size choices are rejected before they change the profile', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.3, unit: 'ratio' });
  const before = await librarian.getAbilityModel();
  for (const input of [
    { value: 1.5, unit: 'degrees' }, { value: 150, unit: 'percent' },
    { value: '1.5', unit: 'ratio' }, { value: Infinity }, { value: 3 }, { value: 1.4, unit: null },
  ]) {
    await assert.rejects(provider.setTextSize(input), /textSize/);
    assert.deepEqual(await librarian.getAbilityModel(), before);
  }
});

test('saving a choice does not erase text-size needs from another source', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const existing = { dimension: 'textSize', value: 1.7, strength: 'preference', source: 'other-app' };
  await librarian.setProfileField('fields.needs', [existing]);
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.3 });
  await provider.setTextSize({ value: 1.4 });
  const needs = (await librarian.getProfile()).fields.needs;
  assert.ok(needs.some(n => n.source === 'other-app' && n.value === 1.7));
  assert.equal(needs.filter(n => n.source === 'captionflow-user').length, 1);
  assert.equal((await provider.getPreferences({})).fontScale, 1.4);
});

test('an explicit text-size change preserves existing hard needs', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setProfileField('fields.needs', [{ dimension: 'textSize', value: 1.8, strength: 'floor', unit: 'ratio' }]);
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.2, unit: 'ratio' });
  assert.equal((await provider.getPreferences({})).fontScale, 1.8);
  assert.ok((await librarian.getAbilityModel()).needs.some(n => n.dimension === 'textSize' && n.strength === 'floor'));
});

test('unsupported units and invalid or out-of-range text sizes fail without silently changing the need', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  for (const need of [
    { dimension: 'textSize', value: 150, unit: 'percent' },
    { dimension: 'textSize', value: '1.5', unit: 'ratio' },
    { dimension: 'textSize', value: 3, unit: 'ratio' },
  ]) {
    await librarian.setProfileField('fields.needs', [need]);
    await assert.rejects(provider.getPreferences({}), /textSize/);
  }
});

test('acting-user guard refuses a read or write when the declared user does not match the toolkit', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setActingUser('alice');
  const provider = createToolkitPreferenceProvider({ librarian, actingUserId: 'bob' });
  await assert.rejects(provider.getPreferences({}), ActingUserMismatchError);
  await assert.rejects(provider.setTextSize({ value: 1.3 }), ActingUserMismatchError);
  // Nothing was written under the wrong partition.
  await librarian.setActingUser('bob');
  assert.deepEqual((await librarian.getAbilityModel()).needs.filter(n => n.dimension === 'textSize'), []);
});

test('acting-user guard allows a matching declared user and refuses a mid-operation switch', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setActingUser('alice');
  const provider = createToolkitPreferenceProvider({ librarian, actingUserId: 'alice' });
  await provider.setTextSize({ value: 1.3 });
  assert.equal((await provider.getPreferences({})).fontScale, 1.3);

  // Simulate the user switching away between the provider's read and write.
  const realGetProfile = librarian.getProfile.bind(librarian);
  librarian.getProfile = async () => {
    const result = await realGetProfile();
    await librarian.setActingUser('mallory');
    return result;
  };
  await assert.rejects(provider.setTextSize({ value: 1.9 }), ActingUserMismatchError);
  await librarian.setActingUser('alice');
  assert.equal((await provider.getPreferences({})).fontScale, 1.3, 'alice profile unchanged by the refused write');
});

test('acting-user guard refuses when the host toolkit exposes no getActingUser()', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const bareLibrarian = { getAbilityModel: librarian.getAbilityModel.bind(librarian), getProfile: librarian.getProfile.bind(librarian), setProfileField: librarian.setProfileField.bind(librarian) };
  const provider = createToolkitPreferenceProvider({ librarian: bareLibrarian });
  await assert.rejects(provider.getPreferences({}), ActingUserMismatchError);
});

test('strongest text-size need wins when the profile contains multiple entries', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setProfileField('fields.needs', [
    { dimension: 'textSize', value: 1.8, strength: 'floor' },
    { dimension: 'textSize', value: 1.2, strength: 'hint' },
  ]);
  assert.equal((await createToolkitPreferenceProvider({ librarian }).getPreferences({})).fontScale, 1.8);
  await librarian.setProfileField('fields.needs', [
    { dimension: 'textSize', value: 1.2, strength: 'hint' },
    { dimension: 'textSize', value: 1.8, strength: 'floor' },
  ]);
  assert.equal((await createToolkitPreferenceProvider({ librarian }).getPreferences({})).fontScale, 1.8);
});

test('undo restores the previous choice, distinct from clearing to the default', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.2 });
  await provider.setTextSize({ value: 1.4 });
  assert.equal((await provider.getPreferences({})).fontScale, 1.4);
  const result = await provider.undoTextSize();
  assert.equal(result.undone, true);
  assert.equal((await provider.getPreferences({})).fontScale, 1.2, 'undo restores the prior choice, not a blank/default');
});

test('undoing the first-ever choice removes the entry instead of inventing a default', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.6 });
  const result = await provider.undoTextSize();
  assert.equal(result.undone, true);
  assert.deepEqual(result.restoredTo, null);
  assert.deepEqual((await provider.getPreferences({})), {}, 'back to no textSize need at all, not a guessed default');
});

test('undo with nothing to undo is a reported no-op, not an error', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  const result = await provider.undoTextSize();
  assert.deepEqual(result, { undone: false, reason: 'no-history' });
});

test('undo walks back through multiple choices in order', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const provider = createToolkitPreferenceProvider({ librarian });
  await provider.setTextSize({ value: 1.1 });
  await provider.setTextSize({ value: 1.3 });
  await provider.setTextSize({ value: 1.5 });
  assert.equal((await provider.getPreferences({})).fontScale, 1.5);
  await provider.undoTextSize();
  assert.equal((await provider.getPreferences({})).fontScale, 1.3);
  await provider.undoTextSize();
  assert.equal((await provider.getPreferences({})).fontScale, 1.1);
  await provider.undoTextSize();
  assert.deepEqual((await provider.getPreferences({})), {});
  assert.deepEqual(await provider.undoTextSize(), { undone: false, reason: 'no-history' });
});

test('undo does not touch another source\'s textSize floor or another acting user\'s history', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  const historyKV = memoryKV();
  await librarian.setActingUser('alice');
  await librarian.setProfileField('fields.needs', [{ dimension: 'textSize', value: 2.0, strength: 'floor' }]);
  const alice = createToolkitPreferenceProvider({ librarian, actingUserId: 'alice', historyKV });
  await alice.setTextSize({ value: 1.2 });
  assert.equal((await alice.getPreferences({})).fontScale, 2.0, 'floor still wins the effective value');

  await librarian.setActingUser('bob');
  const bob = createToolkitPreferenceProvider({ librarian, actingUserId: 'bob', historyKV });
  assert.deepEqual(await bob.undoTextSize(), { undone: false, reason: 'no-history' }, "bob has no history of his own");

  await librarian.setActingUser('alice');
  const aliceAgain = createToolkitPreferenceProvider({ librarian, actingUserId: 'alice', historyKV });
  const result = await aliceAgain.undoTextSize();
  assert.equal(result.undone, true);
  assert.deepEqual(result.restoredTo, null, "alice's own first-ever choice undoes to nothing");
  assert.ok((await librarian.getAbilityModel()).needs.some(n => n.dimension === 'textSize' && n.strength === 'floor'), 'the floor need is untouched');
});

test('undo acting-user guard refuses when the declared user does not match the toolkit', async () => {
  const { librarian } = createToolkit({ kv: memoryKV() });
  await librarian.setActingUser('alice');
  const provider = createToolkitPreferenceProvider({ librarian, actingUserId: 'alice' });
  await provider.setTextSize({ value: 1.3 });
  await librarian.setActingUser('mallory');
  await assert.rejects(provider.undoTextSize(), ActingUserMismatchError);
});

test('undo history survives through a durable historyKV across fresh provider instances', async () => {
  const kv = memoryKV();
  const { librarian } = createToolkit({ kv });
  const historyKV = memoryKV();
  await createToolkitPreferenceProvider({ librarian, historyKV }).setTextSize({ value: 1.7 });
  const result = await createToolkitPreferenceProvider({ librarian, historyKV }).undoTextSize();
  assert.equal(result.undone, true);
  assert.deepEqual(result.restoredTo, null);
});
