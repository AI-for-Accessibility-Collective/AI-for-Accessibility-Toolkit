// Node platform adapters — KVStore. This is the TEMPLATE an XR / mobile
// (any JS-runtime) host copies: swap `fileKV`'s disk backing for the real
// platform store (a native file API, AsyncStorage, IndexedDB, …) and every
// call site in toolkit/core stays unchanged, same as the Chrome adapters do
// for `chrome.storage.*` (see ../chrome/ports.js:chromeKV).
//
// Two variants, matching the two the demo host needs:
//   - fileKV(dir):  persists across process runs — one JSON file per logical
//     `area` ('local' | 'sync', whatever the datastore names) under `dir`.
//     This is what makes the node host's "export from device A, import on
//     device B" demo meaningful: A and B are two REAL, separately-persisted
//     KV roots, not just two objects in the same process's memory.
//   - memoryKV():   a plain in-process Map-of-maps, for a one-shot script or
//     a unit test that doesn't need persistence at all.
//
// Prototype scope, like every reference adapter here: no file locking, no
// atomic-rename-on-write, no concurrent-writer safety. A real mobile/XR host
// backs this with its platform's real persistence API instead of hand-rolling
// file I/O; this file exists to prove the PORT SHAPE (get/set/getAll per
// area) is enough, not to be a production KV engine.

import { promises as fs } from 'node:fs';
import path from 'node:path';

async function readAreaFile(dir, area) {
  const file = path.join(dir, `${area}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeAreaFile(dir, area, data) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${area}.json`);
  await fs.writeFile(file, JSON.stringify(data), 'utf8');
}

/** A KVStore backed by one JSON file per area on disk, under `dir`. Mirrors
 *  toolkit/ports/index.js's KVStore contract exactly: get() resolves the raw
 *  stored value or `undefined`; set() persists (deleting on `undefined`);
 *  getAll() resolves the whole area as a `{ key: value }` map. */
export function fileKV(dir) {
  return {
    async get(area, key) {
      const data = await readAreaFile(dir, area);
      return data[key];
    },
    async set(area, key, value) {
      const data = await readAreaFile(dir, area);
      if (value === undefined) delete data[key];
      else data[key] = value;
      await writeAreaFile(dir, area, data);
    },
    async getAll(area) {
      return await readAreaFile(dir, area);
    },
  };
}

/** A KVStore over a plain in-process object — no disk I/O, no persistence
 *  across runs. Same contract as fileKV; useful for a script that only needs
 *  one process lifetime, or a test. */
export function memoryKV() {
  const areas = {};
  return {
    async get(area, key) {
      return (areas[area] || {})[key];
    },
    async set(area, key, value) {
      areas[area] = areas[area] || {};
      if (value === undefined) delete areas[area][key];
      else areas[area][key] = JSON.parse(JSON.stringify(value));
    },
    async getAll(area) {
      return { ...(areas[area] || {}) };
    },
  };
}
