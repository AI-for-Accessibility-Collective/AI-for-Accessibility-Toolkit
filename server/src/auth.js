// Token issue/verify per CONTRACT.md's Tokens section: `aat_` + 32 bytes
// base64url, stored hashed (sha256) as
// `{id, uid, label, kind, appId?, hash, createdAt, expiresAt?, revoked}` under
// `admin/tokens.json`. A uid may hold multiple tokens; revocation is per-token
// (id), not per-uid.
//
// Three kinds share one verification path:
//   app      — minted by an admin or by the account holder for an app
//              (records from before kinds existed read as app). Bound to
//              one appId, it reads what the toolkit keeps at user level plus
//              its own app's data (access.js); unbound, it is account-wide;
//   default  — the account's default token, derived from the uid and a
//              generation (accounts.js), so it can be shown again after every
//              sign-in without the raw value being stored anywhere;
//   session  — a developer-console sign-in, with an expiry. Only a session
//              may manage the account (accounts.js); apps get app/default tokens.

import crypto from 'node:crypto';
import { sharedDoc } from './shared-doc.js';

const TOKENS_DOC = 'admin/tokens.json';
const TOKEN_PREFIX = 'aat_';
export const TOKEN_KINDS = Object.freeze(['app', 'default', 'session']);
const APP_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const normalize = (doc) => ({ tokens: Array.isArray(doc?.tokens) ? doc.tokens : [] });
const docs = new WeakMap();
function tokensDoc(store) {
  if (!docs.has(store)) docs.set(store, sharedDoc(store, TOKENS_DOC, normalize));
  return docs.get(store);
}

async function loadTokens(store) {
  return (await tokensDoc(store).read()).tokens;
}

const kindOf = (rec) => rec.kind || 'app';
const expired = (rec, now) => typeof rec.expiresAt === 'number' && rec.expiresAt <= now;

/** A fresh raw token value. */
export function newTokenValue() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/** Mint a token for `uid`, persist its hash, and return the raw token — the
 *  ONLY time it is available (the store keeps only the hash). `raw` lets a
 *  caller supply a derived value (the account's default token). Expired
 *  sessions are pruned on the way, so sign-ins do not grow the document. */
export async function issueToken(store, { uid, label, kind = 'app', appId, expiresAt, raw } = {}) {
  if (typeof uid !== 'string' || !uid.trim()) {
    throw new Error('uid is required');
  }
  if (!TOKEN_KINDS.includes(kind)) throw new Error(`unknown token kind ${kind}`);
  if (appId !== undefined && (kind !== 'app' || typeof appId !== 'string' || !APP_ID.test(appId))) throw new Error('appId binds an app token to one app id (lowercase letters, digits, dot, dash, underscore)');
  const value = raw ?? newTokenValue();
  if (!value.startsWith(TOKEN_PREFIX)) throw new Error('a token value must start with aat_');
  const record = {
    id: crypto.randomBytes(8).toString('hex'),
    uid: uid.trim(),
    label: typeof label === 'string' ? label.slice(0, 200) : '',
    kind,
    ...(appId ? { appId } : {}),
    hash: sha256Hex(value),
    createdAt: Date.now(),
    revoked: false,
  };
  if (typeof expiresAt === 'number') record.expiresAt = expiresAt;
  await tokensDoc(store).mutate(({ tokens }) => {
    const now = Date.now();
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (kindOf(tokens[i]) === 'session' && (expired(tokens[i], now) || tokens[i].revoked)) tokens.splice(i, 1);
    }
    tokens.push(record);
    return { save: true, result: true };
  });
  return { token: value, uid: record.uid, id: record.id, kind, ...(appId ? { appId } : {}) };
}

/** `{id, uid, label, kind, createdAt, expiresAt, revoked}` for every token —
 *  never the hash or a raw token value (CONTRACT.md: "no token values"). */
export async function listTokens(store, { uid } = {}) {
  const tokens = await loadTokens(store);
  return tokens
    .filter((t) => !uid || t.uid === uid)
    .map(({ id, uid: owner, label, createdAt, revoked, expiresAt, kind, appId }) => ({
      id, uid: owner, label, kind: kind || 'app', ...(appId ? { appId } : {}), createdAt, revoked, ...(expiresAt ? { expiresAt } : {}),
    }));
}

/** Revoke every token matching `predicate(record)`. Revocation flips a flag
 *  rather than deleting, so the audit trail (id/uid/label/createdAt)
 *  survives. Returns the revoked records' ids. */
export function revokeTokensWhere(store, predicate) {
  return tokensDoc(store).mutate(({ tokens }) => {
    const ids = [];
    for (const rec of tokens) {
      if (!rec.revoked && predicate(rec)) {
        rec.revoked = true;
        ids.push(rec.id);
      }
    }
    return { save: ids.length > 0, result: ids };
  });
}

/** Revoke by id (returns false if the id doesn't exist). */
export function revokeToken(store, id, { uid } = {}) {
  return tokensDoc(store).mutate(({ tokens }) => {
    const rec = tokens.find((t) => t.id === id && (!uid || t.uid === uid));
    if (!rec) return { save: false, result: false };
    rec.revoked = true;
    return { save: true, result: true };
  });
}

/** Revoke every token belonging to `uid` (part of user deletion: a wiped
 *  profile's credentials must die with it, or the next authenticated write
 *  recreates the partition). Returns how many tokens were newly revoked. */
export async function revokeTokensFor(store, uid) {
  return (await revokeTokensWhere(store, (rec) => rec.uid === uid)).length;
}

/** Resolve a presented bearer token to its record, or null if missing,
 *  malformed, unknown, revoked, or expired. Hash comparison is timing-safe. */
export async function verifyToken(store, presented) {
  if (typeof presented !== 'string' || !presented.startsWith(TOKEN_PREFIX)) return null;
  const presentedHash = Buffer.from(sha256Hex(presented), 'hex');
  const tokens = await loadTokens(store);
  const now = Date.now();
  for (const rec of tokens) {
    const recHash = Buffer.from(rec.hash, 'hex');
    if (recHash.length === presentedHash.length && crypto.timingSafeEqual(recHash, presentedHash)) {
      if (rec.revoked || expired(rec, now)) return null;
      return { ...rec, kind: kindOf(rec) };
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
