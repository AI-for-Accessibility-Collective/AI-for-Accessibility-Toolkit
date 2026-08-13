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

async function saveTokens(store, tokens) {
  await store.writeJSON(TOKENS_DOC, { tokens });
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
  const tokens = await loadTokens(store);
  tokens.push(record);
  await saveTokens(store, tokens);
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
export async function revokeToken(store, id) {
  const tokens = await loadTokens(store);
  const rec = tokens.find((t) => t.id === id);
  if (!rec) return false;
  rec.revoked = true;
  await saveTokens(store, tokens);
  return true;
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
 *  against the configured ADMIN_TOKEN. */
export function verifyAdminToken(adminToken, presented) {
  if (!adminToken || typeof presented !== 'string' || !presented) return false;
  const a = Buffer.from(adminToken, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
