// @ts-nocheck
// FLAG(review): 11 errors under toolkit/tsconfig.json's strict check at the
// time this header was added. Type declarations still emit from this file;
// remove these lines and fix the errors to opt it into the check.
// Node platform adapter — the device-shared area `createSharedTransport`
// (toolkit/sync/transport.js) needs: "some store all co-located apps can
// reach". On a real host that's an app-group container (iOS), a content
// provider (Android), or a native bridge; here it's one JSON file on disk
// that TWO separate `createToolkit(...)` instances (two "apps") both point
// at — which is exactly what makes the node host's publish/drain demo prove
// something: two independent toolkit cores exchanging envelopes through a
// shared file, not two references to the same in-memory object.
//
// Matches toolkit/sync/transport.js's SharedStore contract: get/set/remove
// by string key, values are plain JSON-serializable envelopes.
//
// Prototype scope: no file locking. Safe for this repo's demo (calls are
// sequentially awaited, never concurrent), NOT a general concurrent-writer
// store — a real host uses its platform's real shared-storage primitive.

import { promises as fs } from 'node:fs';
import path from 'node:path';

async function readStore(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeStore(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), 'utf8');
}

/** A file-backed SharedStore. `file` is the single JSON document every
 *  participating toolkit instance/app on this "device" is given the same
 *  path to. */
export function fileSharedStore(file) {
  return {
    async get(key) {
      const data = await readStore(file);
      return data[key];
    },
    async set(key, value) {
      const data = await readStore(file);
      if (value === undefined) delete data[key];
      else data[key] = value;
      await writeStore(file, data);
    },
    async remove(key) {
      const data = await readStore(file);
      delete data[key];
      await writeStore(file, data);
    },
  };
}
