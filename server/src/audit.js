// Audit entries for account changes and sign-ins, written through the logger.
//
// `auditAccounts` wraps the accounts service so every route that changes an
// account is logged the same way, whichever file calls it. It logs who and
// what (uid, client address, error code), never passwords or tokens.

import { normalizeUsername } from './accounts.js';

/**
 * @param {ReturnType<import('./accounts.js').createAccounts>} accounts
 * @param {ReturnType<import('./log.js').createLogger>} log
 */
export function auditAccounts(accounts, log) {
  const wrap = (name, onDone, onFail) => async (...args) => {
    try {
      const result = await accounts[name](...args);
      onDone?.(result, ...args);
      return result;
    } catch (e) {
      onFail?.(e, ...args);
      throw e;
    }
  };
  const uidOf = (value) => {
    try { return normalizeUsername(String(value ?? '')).slice(0, 64); } catch { return undefined; }
  };

  return {
    ...accounts,
    create: wrap('create',
      (r) => log.info('account.created', { uid: r?.account?.uid ?? r?.uid }),
      (e, input) => log.warn('account.create.failed', { uid: uidOf(input?.uid), errorCode: e.code })),
    createMany: wrap('createMany', (results) => {
      for (const r of results) {
        if (r.ok) log.info('account.created', { uid: r.uid });
        else log.warn('account.create.failed', { uid: uidOf(r.uid), errorCode: r.error });
      }
    }),
    login: wrap('login',
      (r, input) => log.info('auth.signin', { uid: r.account.uid, client: input?.client }),
      (e, input) => log.warn('auth.signin.failed', { uid: uidOf(input?.username), client: input?.client, errorCode: e.code || 'error' })),
    logout: wrap('logout', (_r, sessionId) => log.info('auth.signout', { tokenId: sessionId })),
    changePassword: wrap('changePassword',
      (_r, uid) => log.info('account.password.changed', { uid }),
      (e, uid) => log.warn('account.password.change.failed', { uid, errorCode: e.code })),
    resetPassword: wrap('resetPassword', (_r, uid) => log.info('account.password.reset', { uid, by: 'admin' })),
    setDisabled: wrap('setDisabled', (_r, uid, disabled) => log.info(disabled ? 'account.disabled' : 'account.enabled', { uid, by: 'admin' })),
    issuedPassword: wrap('issuedPassword', (r, uid) => log.info('account.password.viewed', { uid, by: 'admin', shown: r.password != null })),
    issuedPasswords: wrap('issuedPasswords', (r) => log.info('account.passwords.viewed', { by: 'admin', shown: r.filter(x => x.password != null).length })),
    setDisplayName: wrap('setDisplayName', (_r, uid, _name, by = 'admin') => log.info('account.renamed', { uid, by })),
    remove: wrap('remove', (removed, uid) => { if (removed) log.info('account.deleted', { uid, by: 'admin' }); }),
    rotateDefaultToken: wrap('rotateDefaultToken', (_r, uid) => log.info('token.default.rotated', { uid })),
  };
}
