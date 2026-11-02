// Each account's folders on the host, and the sandbox token that names the
// account to the model proxy and the browser tools.
//
//   <data>/accounts/<uid>/
//     token        the sandbox token (host only; also in config/opencode.json)
//     config/      opencode.json, mounted read-only into the sandbox
//     home/        the sandbox's home: opencode's sessions and caches
//     work/        the sandbox's /work: the adapters it writes
//     chats/       the sidebar's chats, as the person saw them (host only)
//     page-data/   pages the person shared, by chat (host only, never logged)

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, chownSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const UID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function assertUid(uid) {
  if (typeof uid !== 'string' || !UID.test(uid) || uid.includes('..')) throw Object.assign(new Error('bad account id'), { status: 400 });
  return uid;
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {number} [o.sandboxUser]  the sandbox's uid: when the host runs as
 *   root (on the VM), the folders the sandbox writes are handed to it
 */
export function createAccounts({ dataDir, sandboxUser = 1000 }) {
  const root = path.join(dataDir, 'accounts');
  mkdirSync(root, { recursive: true });
  const tokens = new Map(); // token -> uid

  const dirOf = (uid) => path.join(root, assertUid(uid));

  /** Make the account's folders and token if they are new. */
  function ensure(uid) {
    const dir = dirOf(uid);
    for (const sub of ['config', 'home', 'work', 'work/adapters', 'chats', 'page-data']) mkdirSync(path.join(dir, sub), { recursive: true });
    if (process.getuid?.() === 0) for (const sub of ['home', 'work', 'work/adapters']) chownSync(path.join(dir, sub), sandboxUser, sandboxUser);
    const file = path.join(dir, 'token');
    let token = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (!token) {
      token = `sbx_${randomBytes(24).toString('base64url')}`;
      writeFileSync(file, token, { mode: 0o600 });
    }
    tokens.set(token, uid);
    return { dir, token };
  }

  /** The account a sandbox token belongs to, or null. */
  function uidForToken(token) {
    if (typeof token !== 'string' || !token.startsWith('sbx_')) return null;
    for (const [known, uid] of tokens) {
      const a = Buffer.from(known), b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) return uid;
    }
    return null;
  }

  /** Accounts that already have folders (to start their sandboxes when the host starts). */
  function known() {
    return readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && UID.test(d.name)).map(d => d.name);
  }

  for (const uid of known()) ensure(uid);
  return { ensure, dirOf, uidForToken, known };
}
