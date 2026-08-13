// The 36 `/v1/librarian/{method}` routes, alias-mapped exactly the way
// personalized-extension/extension/background.js's `librarian*` message
// switch (lines ~1798-1929) maps message types onto Librarian methods.
//
// `route` is the wire {method} path segment: drop the message type's
// `librarian` prefix and lower-case the first letter — the same rule
// CONTRACT.md states ("the extension's `librarian*` message types with the
// `librarian` prefix dropped and the first letter lower-cased"). `target` is
// the Librarian method actually invoked; where it differs from `route` the
// extension's switch case is doing a rename (an alias), same as
// `librarianEffectivePreferences` -> `getEffectivePreferences`.
//
// `kind: 'librarian'` entries call `instance.librarian[target](...args)`
// directly. The single `kind: 'datastore'` entry (`shareAudit`) has no
// Librarian-object method — background.js's own case reaches past the
// Librarian for it too (`Grants.getShareAudit(dsGetter)`, not `L.<method>`).
// toolkit/sync/grants.js's `getShareAudit(datastore)` is `(await
// datastore.get('mine.shareAudit')) || []` — since that helper isn't
// re-exported by the toolkit/index.js barrel (only the grant/scope/blob/
// transport helpers are), this file reproduces that one-line read directly
// against the `datastore` facade handed back by `createToolkit()`, which IS
// reached only through the barrel. No other toolkit/sync/* import needed.
export const LIBRARIAN_ROUTES = [
  { route: 'getProfile', target: 'getProfile', kind: 'librarian' },
  { route: 'getAbilityModel', target: 'getAbilityModel', kind: 'librarian' },
  { route: 'listProcedural', target: 'listProcedural', kind: 'librarian' },
  { route: 'setProfileField', target: 'setProfileField', kind: 'librarian' },
  { route: 'recordScopedSettings', target: 'recordScopedSettings', kind: 'librarian' },
  { route: 'getSiteCategory', target: 'getSiteCategory', kind: 'librarian' },
  // alias: librarianSetSiteCategory -> L.setSiteCategoryOverride(origin, category)
  { route: 'setSiteCategory', target: 'setSiteCategoryOverride', kind: 'librarian' },
  // alias: librarianEffectivePreferences -> L.getEffectivePreferences(url, contexts)
  // (background.js prefers globalThis.WebSurface.resolveWebPreferences when a
  // web surface bundle is loaded; the server has no web surface, so it always
  // takes the plain Librarian fallback background.js itself falls back to.)
  { route: 'effectivePreferences', target: 'getEffectivePreferences', kind: 'librarian' },
  { route: 'recall', target: 'recall', kind: 'librarian' },
  { route: 'listMemories', target: 'listMemories', kind: 'librarian' },
  { route: 'listProposals', target: 'listProposals', kind: 'librarian' },
  { route: 'logObservation', target: 'logObservation', kind: 'librarian' },
  { route: 'respondToProposal', target: 'respondToProposal', kind: 'librarian' },
  { route: 'deleteMemory', target: 'deleteMemory', kind: 'librarian' },
  // alias: librarianSetPause serves TWO Librarian methods, disambiguated by
  // arg shape exactly like background.js's own branch (`if (msg.origin)`):
  //   [origin: string, paused]  -> setOriginPaused(origin, paused)
  //   [paused]                  -> setMemoryPaused(paused)
  // The remote-librarian facade sends both through this one wire route, so the
  // server must mirror the branch or a remote setOriginPaused would silently
  // flip the GLOBAL memory pause instead of pausing one origin.
  {
    route: 'setPause',
    target: 'setMemoryPaused | setOriginPaused (by arg shape)',
    kind: 'custom-librarian',
    invoke: async (librarian, args) =>
      typeof args[0] === 'string'
        ? await librarian.setOriginPaused(args[0], args[1])
        : await librarian.setMemoryPaused(args[0]),
  },
  // alias: librarianExtractNow -> L.extract()
  { route: 'extractNow', target: 'extract', kind: 'librarian' },
  // alias: librarianReflectNow -> L.reflect()
  { route: 'reflectNow', target: 'reflect', kind: 'librarian' },
  { route: 'listGrants', target: 'listGrants', kind: 'librarian' },
  { route: 'revokeGrant', target: 'revokeGrant', kind: 'librarian' },
  { route: 'setSharingPaused', target: 'setSharingPaused', kind: 'librarian' },
  { route: 'requestGrant', target: 'requestGrant', kind: 'librarian' },
  { route: 'importInsight', target: 'importInsight', kind: 'librarian' },
  { route: 'exportAbilityModel', target: 'exportAbilityModel', kind: 'librarian' },
  // special: librarianShareAudit -> toolkit/sync/grants.js's getShareAudit
  // (datastore.get('mine.shareAudit') || []), not a Librarian-object method.
  // See file header.
  {
    route: 'shareAudit',
    target: 'shareAudit',
    kind: 'datastore',
    note: "datastore-backed: (await datastore.get('mine.shareAudit')) || [] — mirrors toolkit/sync/grants.js's getShareAudit, not a Librarian method",
    invoke: async (datastore) => (await datastore.get('mine.shareAudit')) || [],
  },
  { route: 'getActingUser', target: 'getActingUser', kind: 'librarian' },
  { route: 'setActingUser', target: 'setActingUser', kind: 'librarian' },
  { route: 'exportProfileBlob', target: 'exportProfileBlob', kind: 'librarian' },
  { route: 'importProfileBlob', target: 'importProfileBlob', kind: 'librarian' },
  { route: 'importInsightOutbox', target: 'importInsightOutbox', kind: 'librarian' },
  { route: 'listSkills', target: 'listSkills', kind: 'librarian' },
  { route: 'retrieveSkill', target: 'retrieveSkill', kind: 'librarian' },
  // alias: librarianFindSkill -> L.findSkillForNeed(need)
  { route: 'findSkill', target: 'findSkillForNeed', kind: 'librarian' },
  { route: 'buildSkill', target: 'buildSkill', kind: 'librarian' },
  { route: 'resolveSkill', target: 'resolveSkill', kind: 'librarian' },
  { route: 'saveSkill', target: 'saveSkill', kind: 'librarian' },
  { route: 'deleteSkill', target: 'deleteSkill', kind: 'librarian' },

  // ---- direct-surface routes (no librarian* message equivalent) -----------
  // The voice side panel calls these on the Librarian directly (voice-routes.js)
  // rather than through the background message dispatcher, so remote mode
  // needs them as first-class wire routes or voice memory would silently stay
  // local while everything else went remote. recordExplicitSetting is included
  // for API completeness (same family as recordScopedSettings).
  { route: 'interpretNeedsPrompt', target: 'interpretNeedsPrompt', kind: 'librarian' },
  { route: 'hasScopedSetting', target: 'hasScopedSetting', kind: 'librarian' },
  { route: 'getScopedSetting', target: 'getScopedSetting', kind: 'librarian' },
  { route: 'removeScopedSetting', target: 'removeScopedSetting', kind: 'librarian' },
  { route: 'recordExplicitSetting', target: 'recordExplicitSetting', kind: 'librarian' },
];

// Map for O(1) route -> entry lookup during dispatch.
export const LIBRARIAN_ROUTES_BY_NAME = new Map(LIBRARIAN_ROUTES.map((r) => [r.route, r]));

/** Invoke one resolved route against a live `{ librarian, datastore }` toolkit
 *  instance with positional `args` (the request body's `args` array). */
export async function invokeLibrarianRoute(entry, instance, args) {
  if (entry.kind === 'datastore') {
    return await entry.invoke(instance.datastore, args);
  }
  if (entry.kind === 'custom-librarian') {
    return await entry.invoke(instance.librarian, args);
  }
  const fn = instance.librarian[entry.target];
  if (typeof fn !== 'function') {
    throw new Error(`server misconfiguration: librarian.${entry.target} is not callable`);
  }
  return await fn.apply(instance.librarian, args);
}
