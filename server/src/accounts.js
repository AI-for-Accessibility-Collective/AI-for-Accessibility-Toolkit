// Developer accounts: a name and password an admin hands out, so a developer
// signs in to /developer instead of copying tokens around.
//
// Stored in one shared document, `admin/accounts.json`:
//   { accounts: { <uid>: { uid, displayName, passwordHash, createdAt,
//                          updatedAt, lastLoginAt, disabled,
//                          defaultTokenGeneration } } }
// The username IS the uid: the account's profile partition is
// `users/<uid>/`, the same one an admin-minted token for that uid reaches.
//
// Signing in returns two credentials with different jobs:
//
//   - a SESSION token (kind "session", expires) for the developer console
//     itself. Only a session can manage the account (tokens, password,
//     preferences), so an app holding an app token cannot escalate.
//   - the account's DEFAULT token (kind "default"), the one every app and
//     adapter the developer builds uses to talk to the toolkit. It is shown
//     after every sign-in, so it has to be recoverable — but no raw token is
//     stored anywhere. It is derived: HMAC-SHA256(secret, uid + generation).
//     Only its hash goes into admin/tokens.json, like every other token.
//     Regenerating it bumps the generation and revokes the old one.
//
// The secret is TOKEN_SECRET when set, else the admin password. Changing it
// changes every derived value; the next sign-in notices the old default no
// longer matches, revokes it and issues a new generation, so apps must be
// given the new token. That is the documented cost of rotating the secret.
//
// Passwords are scrypt hashes (N=2^15, r=8, p=1, 16-byte salt). Sign-in is
// rate limited per username and per client address in memory (one process),
// which is proportionate for a prototype service; a multi-instance deployment
// would want a shared limiter.

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { sharedDoc } from './shared-doc.js';
import { issueToken, revokeTokensWhere, verifyToken, listTokens } from './auth.js';
import { assertSafeUid } from './store.js';

const scrypt = promisify(crypto.scrypt);
const ACCOUNTS_DOC = 'admin/accounts.json';
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,63}$/;
export const MIN_PASSWORD = 8;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

export class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, expected] = parts;
  const want = Buffer.from(expected, 'base64url');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64url'), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

// Spent on unknown usernames so a miss takes as long as a wrong password.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

/** A readable generated password: 4 groups of 4 from an alphabet without
 *  look-alike characters (no 0/O, 1/l/I). */
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireUsername(value) {
  const uid = normalizeUsername(value);
  if (!USERNAME.test(uid)) throw new AccountError(400, 'invalid-username', 'A username is 2–64 lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.');
  assertSafeUid(uid);
  return uid;
}

function requirePassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > 200) {
    throw new AccountError(400, 'weak-password', `A password needs at least ${MIN_PASSWORD} characters.`);
  }
  return value;
}

function cleanDisplayName(value, fallback) {
  const name = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return name || fallback;
}

/** Public account fields: never the password hash. */
export function publicAccount(a) {
  return {
    uid: a.uid, displayName: a.displayName, disabled: !!a.disabled,
    createdAt: a.createdAt, updatedAt: a.updatedAt, lastLoginAt: a.lastLoginAt || null,
  };
}

/**
 * @param {Object} config
 * @param {object} config.store
 * @param {string} config.secret  HMAC key for default tokens
 * @param {{dropUser?: (uid: string) => void, dropTokens?: (ids: string[]) => void}} [config.relay]
 */
export function createAccounts({ store, secret, relay = {} }) {
  if (!secret) throw new Error('createAccounts: a secret is required');
  const doc = sharedDoc(store, ACCOUNTS_DOC, (v) => ({ accounts: v && typeof v.accounts === 'object' && v.accounts ? v.accounts : {} }));
  const failures = new Map(); // key -> {count, since}

  function deriveDefaultToken(uid, generation) {
    const mac = crypto.createHmac('sha256', secret).update(`ai4a11y-default-token:v1:${uid}:${generation}`).digest();
    return `aat_${mac.toString('base64url')}`;
  }

  async function revoke(predicate) {
    const ids = await revokeTokensWhere(store, predicate);
    if (ids.length) relay.dropTokens?.(ids);
    return ids;
  }

  async function get(uid) {
    return (await doc.read()).accounts[uid] || null;
  }

  async function list() {
    const { accounts } = await doc.read();
    return Object.values(accounts).map(publicAccount).sort((a, b) => a.uid.localeCompare(b.uid, 'en', { numeric: true }));
  }

  async function create({ uid: rawUid, displayName, password }) {
    const uid = requireUsername(rawUid);
    const generated = password == null || password === '';
    const plain = generated ? generatePassword() : requirePassword(password);
    const passwordHash = await hashPassword(plain);
    const now = Date.now();
    const created = await doc.mutate(({ accounts }) => {
      if (accounts[uid]) return { save: false, result: null };
      accounts[uid] = { uid, displayName: cleanDisplayName(displayName, uid), passwordHash, createdAt: now, updatedAt: now, lastLoginAt: null, disabled: false, defaultTokenGeneration: 0 };
      return { save: true, result: accounts[uid] };
    });
    if (!created) throw new AccountError(409, 'account-exists', `An account named ${uid} already exists.`);
    return { account: publicAccount(created), ...(generated ? { password: plain } : {}) };
  }

  async function update(uid, change) {
    const result = await doc.mutate(({ accounts }) => {
      const a = accounts[uid];
      if (!a) return { save: false, result: null };
      change(a);
      a.updatedAt = Date.now();
      return { save: true, result: { ...a } };
    });
    if (!result) throw new AccountError(404, 'not-found', `No account named ${uid}.`);
    return result;
  }

  /** Make sure the account's current default token is live and return it. */
  async function ensureDefaultToken(account) {
    const value = deriveDefaultToken(account.uid, account.defaultTokenGeneration || 0);
    if (await verifyToken(store, value)) return value;
    // Not live: revoked by a regenerate or a disable, or derived under an old
    // secret. Retire whatever default is left and move to a new generation.
    return rotateDefaultToken(account.uid);
  }

  async function rotateDefaultToken(uid) {
    const updated = await update(uid, (a) => { a.defaultTokenGeneration = (a.defaultTokenGeneration || 0) + 1; });
    await revoke((rec) => rec.uid === uid && rec.kind === 'default');
    const value = deriveDefaultToken(uid, updated.defaultTokenGeneration);
    await issueToken(store, { uid, label: 'Default token', kind: 'default', raw: value });
    return value;
  }

  function limited(key) {
    const f = failures.get(key);
    if (!f) return false;
    if (Date.now() - f.since > LOGIN_WINDOW_MS) { failures.delete(key); return false; }
    return f.count >= LOGIN_MAX_FAILURES;
  }
  function fail(key) {
    const f = failures.get(key);
    if (!f || Date.now() - f.since > LOGIN_WINDOW_MS) failures.set(key, { count: 1, since: Date.now() });
    else f.count++;
    if (failures.size > 10_000) failures.delete(failures.keys().next().value);
  }

  /**
   * Sign in. Returns the session token, the account, and its default token.
   * @param {{username: string, password: string, client?: string}} input
   */
  async function login({ username, password, client = 'unknown' }) {
    const uid = normalizeUsername(username);
    const keys = [`user:${uid}`, `client:${client}`];
    if (keys.some(limited)) throw new AccountError(429, 'too-many-attempts', 'Too many sign-in attempts. Wait 15 minutes, or ask the workshop host to reset your password.');
    const account = USERNAME.test(uid) ? await get(uid) : null;
    const ok = account ? await checkPassword(password, account.passwordHash) : (await checkPassword(password, await DUMMY_HASH), false);
    if (!ok) {
      keys.forEach(fail);
      throw new AccountError(401, 'invalid-credentials', 'That username and password do not match an account.');
    }
    if (account.disabled) throw new AccountError(403, 'account-disabled', 'This account is turned off. Ask the person running this toolkit to turn it back on.');
    for (const k of keys) failures.delete(k);
    const defaultToken = await ensureDefaultToken(account);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const session = await issueToken(store, { uid, label: 'Developer console sign-in', kind: 'session', expiresAt });
    const updated = await update(uid, (a) => { a.lastLoginAt = Date.now(); });
    return { token: session.token, expiresAt, account: publicAccount(updated), defaultToken };
  }

  async function logout(sessionId) {
    await revoke((rec) => rec.id === sessionId && rec.kind === 'session');
  }

  /** The signed-in account's own view: account, default token, its tokens. */
  async function overview(uid) {
    const account = await get(uid);
    if (!account) throw new AccountError(404, 'not-found', 'This sign-in has no account. Sign in again.');
    const defaultToken = await ensureDefaultToken(account);
    const tokens = (await listTokens(store, { uid })).filter(t => t.kind !== 'session');
    return { account: publicAccount(await get(uid)), defaultToken, tokens };
  }

  async function changePassword(uid, { current, next }, keepSessionId) {
    const account = await get(uid);
    if (!account) throw new AccountError(404, 'not-found', 'No such account.');
    if (!(await checkPassword(current ?? '', account.passwordHash))) throw new AccountError(403, 'invalid-credentials', 'The current password is not right.');
    const passwordHash = await hashPassword(requirePassword(next));
    await update(uid, (a) => { a.passwordHash = passwordHash; });
    // Other browsers signed in with the old password are signed out.
    await revoke((rec) => rec.uid === uid && rec.kind === 'session' && rec.id !== keepSessionId);
  }

  /** Admin: set (or generate) a new password and sign out every session. */
  async function resetPassword(uid, password) {
    const generated = password == null || password === '';
    const plain = generated ? generatePassword() : requirePassword(password);
    const passwordHash = await hashPassword(plain);
    await update(uid, (a) => { a.passwordHash = passwordHash; });
    await revoke((rec) => rec.uid === uid && rec.kind === 'session');
    return generated ? { password: plain } : {};
  }

  /** Admin: disabling also revokes every token, so apps stop at once. */
  async function setDisabled(uid, disabled) {
    const updated = await update(uid, (a) => { a.disabled = !!disabled; });
    if (disabled) {
      await revoke((rec) => rec.uid === uid);
      relay.dropUser?.(uid);
    }
    return publicAccount(updated);
  }

  async function setDisplayName(uid, displayName) {
    return publicAccount(await update(uid, (a) => { a.displayName = cleanDisplayName(displayName, uid); }));
  }

  async function remove(uid) {
    return doc.mutate(({ accounts }) => {
      if (!accounts[uid]) return { save: false, result: false };
      delete accounts[uid];
      return { save: true, result: true };
    });
  }

  return {
    get, list, create, login, logout, overview, changePassword, resetPassword,
    setDisabled, setDisplayName, remove, rotateDefaultToken, revoke,
  };
}
