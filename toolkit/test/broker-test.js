// Permission broker unit test (Phase 3 exit gate).
// Run: node toolkit/test/broker-test.js
import { createDatastore } from '../core/datastore.js';
import { createLibrarian } from '../core/librarian.js';
import { createBroker, READ_SCOPES } from '../core/broker.js';
import { TAXONOMY } from '../core/taxonomy.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}
async function throws(name, fn) {
  try { await fn(); check(name, false); }
  catch { check(name, true); }
}

const mem = { local: {}, sync: {} };
const area = (name) => ({
  get: async (key, def) => (mem[name][key] === undefined ? def : structuredClone(mem[name][key])),
  set: async (key, value) => { mem[name][key] = structuredClone(value); },
});
const datastore = createDatastore({
  areas: { local: area('local'), sync: area('sync') },
  globalTier: {
    tools: () => ({
      settingsMeta: { fontScale: { type: 'number', range: [50, 200] } },
      settingsVocabularyLines: () => [],
      forPrompt: () => [],
    }),
    taxonomy: () => TAXONOMY,
  },
});
const librarian = createLibrarian({
  datastore: () => datastore,
  taxonomy: () => TAXONOMY,
  kv: {
    getAll: async () => structuredClone(mem.local),
    set: async (items) => { Object.assign(mem.local, structuredClone(items)); },
  },
});
const broker = createBroker({ datastore: () => datastore, librarian });

(async () => {
  await librarian.setProfileField('supportAreas', ['vision']);
  await librarian.setProfileField('freeText', 'my private words');
  await librarian.recordScopedSettings('general', { fontScale: 150 });

  // Default deny
  check('no grants initially', (await broker.listGrants()).length === 0);
  await throws('export without grant throws', () => broker.exportUnderstanding('grant-nope'));
  await throws('unknown read scope rejected', () => broker.createGrant({ appId: 'x', read: ['ability.rawMemories'] }));

  // Scope filtering
  const g = await broker.createGrant({ appId: 'xr-app', read: ['ability.text', 'ability.vision'], write: false });
  const out = await broker.exportUnderstanding(g.id);
  check('granted dimension present (text.size 1.5)', out.text?.size === 1.5);
  check('granted dimension confidence travels', out.confidence['text.size'] === 0.9);
  check('ungranted dimension ABSENT not zeroed', out.motion === undefined && out.audio === undefined);
  check('freeText never leaves without its own scope', out.freeText === undefined);
  check('supportAreas absent without its scope', out.supportAreas === undefined);
  check('provenance stamped', out.provenance.appId === 'xr-app' && out.provenance.grantId === g.id);

  // freeText requires explicit scope
  const g2 = await broker.createGrant({ appId: 'trusted-app', read: ['ability.freeText'], write: false });
  const out2 = await broker.exportUnderstanding(g2.id);
  check('freeText shared only with explicit scope', out2.freeText === 'my private words');

  // Write permission
  await throws('importInsight without write permission throws', () =>
    broker.importInsight(g.id, { aspect: 'setting.fontScale', change: { op: 'profile-set', path: 'fields.x', value: 1 } }));

  const g3 = await broker.createGrant({ appId: 'xr-writer', read: ['ability.text'], write: true });
  const res = await broker.importInsight(g3.id, {
    aspect: 'setting.fontScale',
    aspectLabel: 'larger text',
    change: { op: 'add-memory', record: { text: 'XR: 170% comfortable', scope: 'general', settings: { fontScale: 170 } } },
    rationale: 'FOV measurement',
    confidence: 0.8,
  });
  check('insight queued as proposal', res.queued === true);
  const pending = await librarian.listProposals('pending');
  check('proposal pending, not applied', pending.length === 1);
  check('proposal carries app provenance', pending[0].origin?.source === 'xr-writer');
  const before = await librarian.getAbilityModel();
  check('nothing auto-applied (still 1.5)', before.text.size === 1.5);

  // Accept → applies; accepted proposal beats older explicit toggle
  await librarian.respondToProposal(pending[0].id, 'accept');
  const after = await librarian.getAbilityModel();
  check('accepted insight applies (1.7 beats older explicit 1.5)', after.text.size === 1.7);

  // Suppression gates external insights too
  const res2 = await broker.importInsight(g3.id, {
    aspect: 'setting.darkMode', aspectLabel: 'dark mode',
    change: { op: 'add-memory', record: { text: 'x', scope: 'general', settings: { darkMode: true } } },
  });
  check('second insight queued', res2.queued === true);
  const p2 = (await librarian.listProposals('pending'))[0];
  await librarian.respondToProposal(p2.id, 'suppress');
  const res3 = await broker.importInsight(g3.id, {
    aspect: 'setting.darkMode', aspectLabel: 'dark mode again',
    change: { op: 'add-memory', record: { text: 'y', scope: 'general', settings: { darkMode: true } } },
  });
  check('suppressed aspect blocks external insight', res3.queued === false);

  // Revocation
  await broker.revokeGrant(g.id);
  await throws('revoked grant cannot export', () => broker.exportUnderstanding(g.id));

  // Audit
  const audit = await broker.getAuditLog();
  const kinds = audit.map(a => a.kind);
  check('audit logs grant/export/import/revoke', ['grant-created', 'export', 'import', 'grant-revoked'].every(k => kinds.includes(k)));

  // Prototype pollution: an app-supplied insight must never reach a
  // path-walking writer with a dangerous op/path, even if accepted.
  const gEvil = await broker.createGrant({ appId: 'evil', read: ['ability.text'], write: true });
  await throws('profile-set op rejected for external apps', () =>
    broker.importInsight(gEvil.id, {
      aspect: 'profile.x', change: { op: 'profile-set', path: '__proto__.pwned', value: 'yes' },
    }));
  // Insights arrive over a transport as JSON; JSON.parse creates a real own
  // "__proto__" key (unlike a JS literal, which invokes the proto setter).
  await throws('insight with __proto__ key (JSON transport) rejected', () =>
    broker.importInsight(gEvil.id, {
      aspect: 'x',
      change: JSON.parse('{"op":"add-memory","record":{"__proto__":{"pwned":1},"scope":"general"}}'),
    }));
  check('Object.prototype not polluted', ({}).pwned === undefined);
  // setProfileField itself refuses unsafe paths (defense in depth).
  await throws('setProfileField refuses __proto__ path', () =>
    librarian.setProfileField('__proto__.pwned', 'yes'));
  check('Object.prototype still clean after direct attempt', ({}).pwned === undefined);

  // Read scopes constant sanity
  check('READ_SCOPES covers all model dimensions', READ_SCOPES.length === 8);

  // Sharing level (privacy layer): the profile's sharing choice is the export
  // ceiling for a grant's audience — personal < friends < anyone.
  await throws('unknown audience rejected', () =>
    broker.createGrant({ appId: 'x', read: ['ability.text'], audience: 'everyone' }));
  const gFriend = await broker.createGrant({ appId: 'sister-app', read: ['ability.text'], audience: 'friends' });
  await throws('friends grant blocked while sharing is personal', () =>
    broker.exportUnderstanding(gFriend.id));
  const blocked = (await broker.getAuditLog()).some(a => a.kind === 'export-blocked' && a.appId === 'sister-app');
  check('blocked export is audited', blocked);
  await librarian.setProfileField('metaPreferences.sharing', 'friends');
  const friendExport = await broker.exportUnderstanding(gFriend.id);
  check('friends grant exports once sharing allows it', friendExport.text !== undefined);
  const gPublic = await broker.createGrant({ appId: 'community', read: ['ability.text'], audience: 'anyone' });
  await throws('anyone grant still blocked at friends level', () =>
    broker.exportUnderstanding(gPublic.id));
  await librarian.setProfileField('metaPreferences.sharing', 'personal');
  await throws('lowering sharing cuts off friends grants again', () =>
    broker.exportUnderstanding(gFriend.id));
  const gSelf = await broker.createGrant({ appId: 'my-xr', read: ['ability.text'] });
  check('personal grants still export at the personal level', (await broker.exportUnderstanding(gSelf.id)).text !== undefined);

  // Action insights become agent-run tasks on accept — the broker must
  // reject malformed ones at the trust boundary, and queue well-formed ones.
  await throws('action insight without a prompt rejected', () =>
    broker.importInsight(gEvil.id, {
      aspect: 'auto.video', change: { op: 'add-profile-action', siteTypes: ['video'], action: { name: 'x' } },
    }));
  await throws('action insight with non-array siteTypes rejected', () =>
    broker.importInsight(gEvil.id, {
      aspect: 'auto.video', change: { op: 'add-profile-action', siteTypes: 'video', action: { name: 'x', prompt: 'do y' } },
    }));
  await throws('action insight with oversized prompt rejected', () =>
    broker.importInsight(gEvil.id, {
      aspect: 'auto.video', change: { op: 'add-profile-action', siteTypes: ['video'], action: { name: 'x', prompt: 'y'.repeat(1001) } },
    }));
  const okIns = await broker.importInsight(gEvil.id, {
    aspect: 'reusable-action.category:video', aspectLabel: 'auto captions on video sites',
    change: { op: 'add-profile-action', siteTypes: ['video'], action: { name: 'Enable captions', prompt: 'Turn on captions' } },
    rationale: 'measured you enabling captions',
  });
  check('well-formed action insight queues as a proposal', okIns.queued === true);

  // Fail closed: an unrecognized sharing value (corruption, bad write) must
  // NARROW access to the personal ceiling, never widen it.
  await librarian.setProfileField('metaPreferences.sharing', 'garbage-value');
  await throws('corrupt sharing level blocks friends grants', () =>
    broker.exportUnderstanding(gFriend.id));
  check('corrupt sharing level still allows personal grants', (await broker.exportUnderstanding(gSelf.id)).text !== undefined);
  await librarian.setProfileField('metaPreferences.sharing', 'personal');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
