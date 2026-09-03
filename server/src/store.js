// Storage backends behind one small interface: `readJSON(key) -> obj|null`
// and `writeJSON(key, obj) -> void`, where `key` is a document path like
// `users/<uid>/local.json` or `admin/tokens.json` (CONTRACT.md's Storage
// section). Two implementations, selected in index.js by env
// (`TOOLKIT_BUCKET` set -> gcs, else `DATA_DIR` -> file):
//
//   - fileStore(dir):   one JSON file per document, under `dir`. Mirrors
//     toolkit/platforms/node/kv.js's fileKV read-whole/write-whole pattern —
//     same prototype-scope tradeoff (no file locking, no atomic rename), just
//     applied to a `<dir>/<key>` document instead of one file per KV area.
//   - gcsStore(bucket): the same interface over the GCS JSON REST v1 API,
//     using plain `fetch` + a token from the Cloud Run/GCE metadata server
//     (no @google-cloud/storage SDK — zero new dependencies).
//
// Both are "prototype scope" like every other adapter here: read-modify-write
// with no locking, no optimistic concurrency, no retries. Fine for a
// single-writer-per-uid personal toolkit; not a production multi-writer store.

import { promises as fs } from 'node:fs';
import path from 'node:path';

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
function assertSafeUid(uid) {
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
      const file = path.join(dir, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(value), 'utf8');
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
