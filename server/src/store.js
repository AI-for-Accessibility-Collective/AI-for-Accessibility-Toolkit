// Storage backends behind one small interface: `readJSON(key) -> obj|null`
// and `writeJSON(key, obj) -> void`, where `key` is a document path like
// `users/<uid>/local.json` or `admin/tokens.json` (CONTRACT.md's Storage
// section). Two implementations, selected in index.js by env
// (`TOOLKIT_BUCKET` set -> gcs, else `DATA_DIR` -> file):
//
//   - fileStore(dir):   one JSON file per document, under `dir`. Mirrors
//     toolkit/platforms/node/kv.js's fileKV read-whole/write-whole pattern —
//     same prototype-scope tradeoff (no file locking), just applied to a
//     `<dir>/<key>` document instead of one file per KV area. Every write
//     lands through a temp file and rename, so a reader never sees a
//     half-written document.
//   - gcsStore(bucket): the same interface over the GCS JSON REST v1 API,
//     using plain `fetch` + a token from the Cloud Run/GCE metadata server
//     (no @google-cloud/storage SDK — zero new dependencies).
//
// Both are "prototype scope" like every other adapter here: read-modify-write
// with no locking, no optimistic concurrency, no retries. Fine for a
// single-writer-per-uid personal toolkit; not a production multi-writer store.
//
// The one exception is the document every instance shares, `admin/tokens.json`.
// For it, both backends also offer a conditional pair: `readDoc(key)` returns
// `{value, version}` and `writeJSONIf(key, value, version)` writes only if the
// document still carries that version, throwing StoreConflict otherwise. The
// file backend's version is a hash of the file's bytes, checked under a lock
// file so two processes on one directory cannot both pass the check; the GCS
// backend's version is the object generation, enforced by GCS itself through
// `ifGenerationMatch`. auth.js retries its mutations on conflict.

import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Thrown by writeJSONIf when the document changed since it was read. */
export class StoreConflict extends Error {
  constructor(key) {
    super(`store: ${key} changed since it was read`);
    this.name = 'StoreConflict';
    this.code = 'CONFLICT';
  }
}

// The version of a file document: a hash of its bytes, or null when absent.
async function fileVersion(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return { text, version: crypto.createHash('sha256').update(text, 'utf8').digest('hex') };
  } catch (e) {
    if (e.code === 'ENOENT') return { text: null, version: null };
    throw e;
  }
}

// Write `text` to `file` through a sibling temp file and a rename, so a reader
// never sees a half-written document. A failed write leaves nothing behind.
async function writeFileAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

// Serialize writers of one file across processes with a lock file created
// exclusively (`wx`). The lock carries an owner token, so the holder can tell
// whether the lock is still its own and only ever removes its own lock.
//
// A lock older than LOCK_STALE_MS belongs to a process that died holding it.
// Taking it over is a rename to a name only this taker knows, then an unlink:
// the rename succeeds for exactly one taker, so two waiters cannot both
// "remove the stale lock" and end up inside the critical section together.
// The stale threshold is far above any single write, so a live holder that
// merely stalled keeps its lock; `fn` receives `assertHeld` to check before
// the step that must not run twice.
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;
async function withFileLock(file, fn) {
  const lock = `${file}.lock`;
  const owner = `${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(lock, owner, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        stale = Date.now() - (await fs.stat(lock)).mtimeMs > LOCK_STALE_MS;
      } catch (e2) {
        if (e2.code !== 'ENOENT') throw e2;
      }
      if (stale) {
        const claimed = `${lock}.stale.${owner}`;
        try {
          await fs.rename(lock, claimed);
          await fs.rm(claimed, { force: true });
        } catch (e2) {
          if (e2.code !== 'ENOENT') throw e2;
        }
        continue;
      }
      if (Date.now() > deadline) {
        const err = new Error(`store: could not lock ${file}`);
        err.code = 'LOCK_TIMEOUT';
        throw err;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  const held = async () => {
    try {
      return (await fs.readFile(lock, 'utf8')) === owner;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  };
  const assertHeld = async () => {
    if (!(await held())) throw new StoreConflict(file);
  };
  try {
    return await fn(assertHeld);
  } finally {
    if (await held()) await fs.rm(lock, { force: true });
  }
}

function assertSafeKey(key) {
  // Documents are always constructed by this module's own callers
  // (`users/<uid>/<area>.json`, `admin/tokens.json`) — this is a defensive
  // floor against a stray '..' segment (e.g. a mistyped uid), not a defense
  // against a hostile key an untrusted caller can choose freely.
  if (typeof key !== 'string' || !key || key.includes('..') || key.startsWith('/')) {
    throw new Error(`store: unsafe document key ${JSON.stringify(key)}`);
  }
}

// A uid names one user's profile partition (`users/<uid>/...`). Unlike document
// keys this one CAN reach admin-listing/deletion, so keep it a single safe path
// segment — no separators, no '..'.
export function assertSafeUid(uid) {
  if (typeof uid !== 'string' || !uid || uid.includes('/') || uid.includes('..') || uid.includes('\\')) {
    throw new Error(`store: unsafe uid ${JSON.stringify(uid)}`);
  }
}

/** A store backed by one JSON file per document on disk, under `dir`. */
export function fileStore(dir) {
  return {
    kind: 'file',
    async readJSON(key) {
      assertSafeKey(key);
      const file = path.join(dir, key);
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async writeJSON(key, value) {
      assertSafeKey(key);
      await writeFileAtomic(path.join(dir, key), JSON.stringify(value));
    },
    async readDoc(key) {
      assertSafeKey(key);
      const { text, version } = await fileVersion(path.join(dir, key));
      return { value: text === null ? null : JSON.parse(text), version };
    },
    async writeJSONIf(key, value, version) {
      assertSafeKey(key);
      const file = path.join(dir, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await withFileLock(file, async (assertHeld) => {
        const current = (await fileVersion(file)).version;
        if (current !== version) throw new StoreConflict(key);
        // If the lock was taken over while this check ran, another writer may
        // already have moved the document; do not rename over its work.
        await assertHeld();
        await writeFileAtomic(file, JSON.stringify(value));
      });
    },
    // Every uid that has a `users/<uid>/` directory (i.e. a stored profile).
    async listUsers() {
      try {
        const entries = await fs.readdir(path.join(dir, 'users'), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    // Remove a user's entire profile partition. Returns false if it didn't exist.
    async deleteUser(uid) {
      assertSafeUid(uid);
      const udir = path.join(dir, 'users', uid);
      try {
        await fs.access(udir);
      } catch {
        return false;
      }
      await fs.rm(udir, { recursive: true, force: true });
      return true;
    },
  };
}

// ---- GCS (prod) -------------------------------------------------------------

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** A store backed by GCS objects in `bucket`, one per document key, via the
 *  JSON REST v1 API. Auth is the standard Cloud Run/GCE pattern: fetch a
 *  short-lived access token from the metadata server and cache it until
 *  shortly before it expires. */
export function gcsStore(bucket) {
  let cachedToken = null; // { token, expiresAt }

  async function accessToken() {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token;
    const resp = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!resp.ok) {
      throw new Error(`gcsStore: metadata token fetch failed (${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();
    cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in || 0) * 1000 };
    return cachedToken.token;
  }

  // Follow nextPageToken to exhaustion. GCS caps every listing page (1,000
  // items by default), so a single-page read here means a wrong user list or,
  // worse, a partial delete that reports success.
  async function listAll(params) {
    const token = await accessToken();
    const items = [];
    const prefixes = [];
    let pageToken;
    do {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`gcsStore: list failed (${resp.status}): ${await resp.text()}`);
      const data = await resp.json();
      if (data.items) items.push(...data.items);
      if (data.prefixes) prefixes.push(...data.prefixes);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return { items, prefixes };
  }

  return {
    kind: 'gcs',
    async readJSON(key) {
      assertSafeKey(key);
      const token = await accessToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`gcsStore: read ${key} failed (${resp.status}): ${await resp.text()}`);
      return await resp.json();
    },
    async writeJSON(key, value) {
      assertSafeKey(key);
      const token = await accessToken();
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!resp.ok) throw new Error(`gcsStore: write ${key} failed (${resp.status}): ${await resp.text()}`);
    },
    // The version is the object generation, which GCS changes on every write.
    // A media download carries it in the x-goog-generation header. When a
    // proxy strips that header, a metadata read supplies the generation and
    // the body is downloaded again pinned to it, so value and version always
    // describe the same write. A 404 on the pinned download means the object
    // moved between the two requests; that is a conflict for the caller to
    // retry, not a stale body to write back.
    async readDoc(key) {
      assertSafeKey(key);
      const token = await accessToken();
      const headers = { Authorization: `Bearer ${token}` };
      const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`;
      const resp = await fetch(`${base}?alt=media`, { headers });
      if (resp.status === 404) return { value: null, version: '0' };
      if (!resp.ok) throw new Error(`gcsStore: read ${key} failed (${resp.status}): ${await resp.text()}`);
      const version = resp.headers.get('x-goog-generation');
      if (version) return { value: await resp.json(), version: String(version) };
      const meta = await fetch(`${base}?fields=generation`, { headers });
      if (meta.status === 404) return { value: null, version: '0' };
      if (!meta.ok) throw new Error(`gcsStore: metadata ${key} failed (${meta.status}): ${await meta.text()}`);
      const generation = String((await meta.json()).generation);
      const pinned = await fetch(`${base}?alt=media&generation=${encodeURIComponent(generation)}`, { headers });
      if (pinned.status === 404) throw new StoreConflict(key);
      if (!pinned.ok) throw new Error(`gcsStore: read ${key} failed (${pinned.status}): ${await pinned.text()}`);
      return { value: await pinned.json(), version: generation };
    },
    // `ifGenerationMatch` makes GCS refuse the upload (412) when the object's
    // generation moved since readDoc; '0' means "only if it does not exist".
    async writeJSONIf(key, value, version) {
      assertSafeKey(key);
      const token = await accessToken();
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}&ifGenerationMatch=${encodeURIComponent(String(version))}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (resp.status === 412) throw new StoreConflict(key);
      if (!resp.ok) throw new Error(`gcsStore: conditional write ${key} failed (${resp.status}): ${await resp.text()}`);
    },
    async listUsers() {
      // delimiter='/' collapses each users/<uid>/... into one prefix entry.
      const { prefixes } = await listAll('prefix=users/&delimiter=/');
      return prefixes
        .map((p) => p.replace(/^users\//, '').replace(/\/$/, ''))
        .filter(Boolean)
        .sort();
    },
    async deleteUser(uid) {
      assertSafeUid(uid);
      const token = await accessToken();
      const { items } = await listAll(`prefix=${encodeURIComponent(`users/${uid}/`)}`);
      if (!items.length) return false;
      for (const it of items) {
        const delUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(it.name)}`;
        const delResp = await fetch(delUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        if (!delResp.ok && delResp.status !== 404) {
          throw new Error(`gcsStore: deleteUser ${it.name} failed (${delResp.status}): ${await delResp.text()}`);
        }
      }
      return true;
    },
  };
}

/** Selects the backend per CONTRACT.md: `TOOLKIT_BUCKET` set -> gcs, else
 *  file under `dataDir` (default `./data`). */
export function createStore({ bucket, dataDir } = {}) {
  if (bucket) return gcsStore(bucket);
  return fileStore(dataDir || './data');
}
