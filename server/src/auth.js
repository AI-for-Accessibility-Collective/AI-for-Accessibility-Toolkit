// Token issue/verify per CONTRACT.md's Tokens section: `aat_` + 32 bytes
// base64url randomness, stored hashed (sha256) as
// `{id, uid, label, hash, createdAt, revoked}` under `admin/tokens.json`. A
// uid may hold multiple tokens; revocation is per-token (id), not per-uid.

import crypto from 'node:crypto';

const TOKENS_DOC = 'admin/tokens.json';
const TOKEN_PREFIX = 'aat_';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function loadTokens(store) {
  const doc = await store.readJSON(TOKENS_DOC);
  return Array.isArray(doc?.tokens) ? doc.tokens : [];
}

// Every mutation is a load, change, save of one shared document. Two things
// keep a concurrent issue from overwriting a revocation:
//
//   - In one process, the mutations queue behind each other here. The per-uid
//     lock in app.js does not cover this document (a token issue for one uid
//     can interleave with a revocation for another).
//   - Across processes (two service instances on one bucket or directory), the
//     save is a conditional write: store.writeJSONIf refuses when the document
//     moved since store.readDoc, and the mutation reloads and retries. Five
//     attempts is far more than the admin routes ever contend for.
//
// A store without the conditional pair falls back to the plain load and save,
// which is the single-process guarantee only.
let tokenQueue = Promise.resolve();
function withTokenLock(fn) {
  const run = tokenQueue.then(fn, fn);
  tokenQueue = run.catch(() => {});
  return run;
}

const MAX_ATTEMPTS = 5;

// Run `change(tokens)` against the current document and save it. `change`
// returns `{ save, result }`: `save` false skips the write (nothing changed),
// `result` is handed back to the caller.
function mutateTokens(store, change) {
  const conditional = typeof store.readDoc === 'function' && typeof store.writeJSONIf === 'function';
  return withTokenLock(async () => {
    for (let attempt = 1; ; attempt++) {
      let tokens;
      let version;
      if (conditional) {
        const doc = await store.readDoc(TOKENS_DOC);
        tokens = Array.isArray(doc.value?.tokens) ? doc.value.tokens : [];
        version = doc.version;
      } else {
        tokens = await loadTokens(store);
      }
      const { save, result } = change(tokens);
      if (!save) return result;
      if (!conditional) {
        await store.writeJSON(TOKENS_DOC, { tokens });
        return result;
      }
      try {
        await store.writeJSONIf(TOKENS_DOC, { tokens }, version);
        return result;
      } catch (e) {
        if (e?.code !== 'CONFLICT' || attempt >= MAX_ATTEMPTS) throw e;
      }
    }
  });
}

/** Mint a new token for `uid`, persist its hash, and return the raw token —
 *  the ONLY time it is ever available (the store keeps only the hash). */
export async function issueToken(store, { uid, label } = {}) {
  if (typeof uid !== 'string' || !uid.trim()) {
    throw new Error('uid is required');
  }
  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const record = {
    id: crypto.randomBytes(8).toString('hex'),
    uid: uid.trim(),
    label: typeof label === 'string' ? label.slice(0, 200) : '',
    hash: sha256Hex(raw),
    createdAt: Date.now(),
    revoked: false,
  };
  await mutateTokens(store, (tokens) => {
    tokens.push(record);
    return { save: true, result: true };
  });
  return { token: raw, uid: record.uid };
}

/** `{id, uid, label, createdAt, revoked}` for every token — never the hash or
 *  a raw token value (CONTRACT.md: "no token values"). */
export async function listTokens(store) {
  const tokens = await loadTokens(store);
  return tokens.map(({ id, uid, label, createdAt, revoked }) => ({ id, uid, label, createdAt, revoked }));
}

/** Revoke by id (idempotent-ish: returns false if the id doesn't exist).
 *  Revocation flips a flag rather than deleting — verifyToken checks it and
 *  a revoked token's audit trail (id/uid/label/createdAt) survives. */
export function revokeToken(store, id) {
  return mutateTokens(store, (tokens) => {
    const rec = tokens.find((t) => t.id === id);
    if (!rec) return { save: false, result: false };
    rec.revoked = true;
    return { save: true, result: true };
  });
}

/** Revoke every token belonging to `uid` (part of user deletion: a wiped
 *  profile's credentials must die with it, or the next authenticated write
 *  recreates the partition). Same flip-the-flag semantics as revokeToken, so
 *  the audit trail survives. Returns how many tokens were newly revoked. */
export function revokeTokensFor(store, uid) {
  return mutateTokens(store, (tokens) => {
    let n = 0;
    for (const rec of tokens) {
      if (rec.uid === uid && !rec.revoked) {
        rec.revoked = true;
        n++;
      }
    }
    return { save: n > 0, result: n };
  });
}

/** Resolve a presented bearer token to its record, or null if missing,
 *  malformed, unknown, or revoked. Hash comparison is timing-safe. */
export async function verifyToken(store, presented) {
  if (typeof presented !== 'string' || !presented.startsWith(TOKEN_PREFIX)) return null;
  const presentedHash = Buffer.from(sha256Hex(presented), 'hex');
  const tokens = await loadTokens(store);
  for (const rec of tokens) {
    const recHash = Buffer.from(rec.hash, 'hex');
    if (recHash.length === presentedHash.length && crypto.timingSafeEqual(recHash, presentedHash)) {
      return rec.revoked ? null : rec;
    }
  }
  return null;
}

/** Constant-time comparison of the presented Authorization bearer value
 *  against the configured ADMIN_PASSWORD (a generated 16-char password). */
export function verifyAdminPassword(adminPassword, presented) {
  if (!adminPassword || typeof presented !== 'string' || !presented) return false;
  const a = Buffer.from(adminPassword, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Admin auth from a raw Authorization header, accepting BOTH schemes:
 *  - `Basic base64(user:password)` — the browser's native login popup for
 *    /admin (any username; only the password is checked). The browser caches
 *    the credential for the session and offers password-manager saving, so
 *    the login is remembered by default.
 *  - `Bearer <password>` — for curl/scripts/tests.
 */
export function verifyAdminHeader(adminPassword, header) {
  if (typeof header !== 'string' || !header.trim()) return false;
  const m = /^(Basic|Bearer)\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  if (/^bearer$/i.test(m[1])) return verifyAdminPassword(adminPassword, m[2].trim());
  let decoded;
  try {
    decoded = Buffer.from(m[2].trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  return verifyAdminPassword(adminPassword, decoded.slice(colon + 1));
}
