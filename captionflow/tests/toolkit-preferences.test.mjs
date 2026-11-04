import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolkit } from '../../toolkit/index.js';
import { createCaptionFlowPipeline } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createToolkitPreferenceProvider } from '../src/toolkit-preferences.mjs';

// Shared in-memory port tests persistence across toolkit instances, not restarts.
function memoryKV() {
  const areas = { local: {}, sync: {} };
  return {
    async get(area, key) { return structuredClone(areas[area]?.[key]); },
    async set(area, key, value) {
      if (value === undefined) delete areas[area][key];
      else areas[area][key] = structuredClone(value);
    },
    async getAll(area) { return structuredClone(areas[area]); },
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
