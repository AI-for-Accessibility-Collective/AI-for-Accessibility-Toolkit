import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createToolkit } from '../../toolkit/index.js';
import { fileKV } from '../../toolkit/platforms/node/kv.js';
import { createToolkitPreferenceProvider } from '../src/toolkit-preferences.mjs';

const execFileAsync = promisify(execFile);

// These tests prove storage survives beyond one JS object, unlike the
// in-memory tests in toolkit-preferences.test.mjs (which reopen a toolkit
// against the *same* memoryKV() object -- that proves the Librarian doesn't
// cache stale state, not that anything is durable). Here every "reopen" uses
// a brand-new fileKV(dir) pointed at the same directory, and the last test
// restarts in a genuinely separate OS process.

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'captionflow-durable-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a text-size choice survives reopening fileKV as a brand-new object pointed at the same directory', async () => {
  await withTempDir(async (dir) => {
    const toolkitA = createToolkit({ kv: fileKV(dir) }); // fresh KV instance #1
    await toolkitA.librarian.setActingUser('alice');
    await createToolkitPreferenceProvider({ librarian: toolkitA.librarian, actingUserId: 'alice' })
      .setTextSize({ value: 1.6, unit: 'ratio' });

    // No reference to toolkitA or its KV crosses this line.
    const toolkitB = createToolkit({ kv: fileKV(dir) }); // fresh KV instance #2, same dir
    await toolkitB.librarian.setActingUser('alice');
    const prefs = await createToolkitPreferenceProvider({ librarian: toolkitB.librarian, actingUserId: 'alice' })
      .getPreferences({});
    assert.equal(prefs.fontScale, 1.6);
  });
});

test('fileKV partitions by acting user on disk, matching the in-memory guard behaviour', async () => {
  await withTempDir(async (dir) => {
    const toolkit1 = createToolkit({ kv: fileKV(dir) });
    await toolkit1.librarian.setActingUser('alice');
    await createToolkitPreferenceProvider({ librarian: toolkit1.librarian, actingUserId: 'alice' })
      .setTextSize({ value: 1.2 });

    const toolkit2 = createToolkit({ kv: fileKV(dir) });
    await toolkit2.librarian.setActingUser('bob');
    const bobPrefs = await createToolkitPreferenceProvider({ librarian: toolkit2.librarian, actingUserId: 'bob' })
      .getPreferences({});
    assert.deepEqual(bobPrefs, {}, "bob's partition must not see alice's text size");

    await toolkit2.librarian.setActingUser('alice');
    const alicePrefs = await createToolkitPreferenceProvider({ librarian: toolkit2.librarian, actingUserId: 'alice' })
      .getPreferences({});
    assert.equal(alicePrefs.fontScale, 1.2);
  });
});

test('restoring the previous (empty) needs is durable: a later process sees the restore, not the old value', async () => {
  await withTempDir(async (dir) => {
    const toolkit1 = createToolkit({ kv: fileKV(dir) });
    await toolkit1.librarian.setActingUser('alice');
    const provider1 = createToolkitPreferenceProvider({ librarian: toolkit1.librarian, actingUserId: 'alice' });
    await provider1.setTextSize({ value: 1.9 });
    // Explicit restore to the previous (empty) needs -- not a real undo stack,
    // see TOOLKIT_PREFERENCES.md, but this is what "restoring" means today.
    await toolkit1.librarian.setProfileField('fields.needs', []);

    const toolkit2 = createToolkit({ kv: fileKV(dir) });
    await toolkit2.librarian.setActingUser('alice');
    const provider2 = createToolkitPreferenceProvider({ librarian: toolkit2.librarian, actingUserId: 'alice' });
    assert.deepEqual(await provider2.getPreferences({}), {});
  });
});

test('a text-size choice survives an actual process restart, not just a new JS object in the same process', async () => {
  await withTempDir(async (dir) => {
    const writerScript = new URL('./fixtures/durable-storage-writer.mjs', import.meta.url);
    const readerScript = new URL('./fixtures/durable-storage-reader.mjs', import.meta.url);
    await execFileAsync(process.execPath, [writerScript.pathname, dir, 'alice', '1.45']);
    const { stdout } = await execFileAsync(process.execPath, [readerScript.pathname, dir, 'alice']);
    assert.equal(JSON.parse(stdout).fontScale, 1.45);
  });
});
