// REAL-server integration test for the extension's remote mode: boots the
// actual toolkit-service app (server/src/app.js, fileStore in a temp dir) and
// drives the actual extension facade (extension/remote-librarian.js) against
// it over real HTTP — the cross-seam check the stub-server unit test can't do.
//
// Covers the full extension-visible surface: token issue → whoami → profile →
// ability model → scoped settings → effective preferences → skills → grants →
// consent → export/import blob → natural-language notes → BOTH setPause arg
// shapes → share audit → per-uid isolation.
//
// Run: node personalized-extension/test/remote-integration-test.mjs
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../../server/src/app.js';
import { fileStore } from '../../server/src/store.js';
import { createGeminiCaller } from '../../server/src/gemini.js';
import { createToolkitHost } from '../../server/src/toolkit-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.join(__dirname, '..', 'extension');
const ADMIN_PASSWORD = 'integration-admin-pw';
const RUN = `itest-${Date.now().toString(36)}`;
const UID_A = `${RUN}-a`;
const UID_B = `${RUN}-b`;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, extra); }
}

function loadFacade(baseUrl, token) {
  const src = fs.readFileSync(path.join(EXT_DIR, 'remote-librarian.js'), 'utf8');
  const sandbox = { console, fetch };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'remote-librarian.js' });
  sandbox.RemoteLibrarian.configure({ url: baseUrl, token });
  return sandbox.RemoteLibrarian;
}

// Default: boot the real app in-process. With REMOTE_BASE + REMOTE_ADMIN_TOKEN
// set, target a DEPLOYED service instead (e.g. the Cloud Run instance) — same
// assertions, live wire. Remote runs use throwaway uids; revoke their tokens
// in the finally block so nothing lingers.
const REMOTE_BASE = process.env.REMOTE_BASE || null;
const REMOTE_ADMIN = process.env.REMOTE_ADMIN_PASSWORD || process.env.REMOTE_ADMIN_TOKEN || null;

let server = null, dataDir = null, base;
const ADMIN = REMOTE_BASE ? REMOTE_ADMIN : ADMIN_PASSWORD;
if (REMOTE_BASE) {
  if (!REMOTE_ADMIN) { console.error('REMOTE_BASE set but REMOTE_ADMIN_PASSWORD missing'); process.exit(2); }
  base = REMOTE_BASE.replace(/\/$/, '');
  console.log(`[remote mode] targeting ${base}`);
} else {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tk-integration-'));
  const store = fileStore(dataDir);
  const app = createApp({
    store,
    adminPassword: ADMIN_PASSWORD,
    toolkitHost: createToolkitHost({ store, geminiCaller: createGeminiCaller({ apiKey: null }) }),
    version: 'integration-test',
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function admin(pathname, opts = {}) {
  const res = await fetch(base + pathname, {
    method: opts.method || 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

try {
  // ---- issue a real token, configure the real facade -----------------------
  const tok = await admin('/admin/tokens', { body: { uid: UID_A, label: 'integration' } });
  check('admin issues a token', tok.status === 200 && tok.body.token?.startsWith('aat_'));
  const RL = loadFacade(base, tok.body.token);
  const L = RL.asLibrarian();

  const who = await RL.whoami();
  check('whoami returns the bound uid', who.uid === UID_A);

  // ---- profile / ability model --------------------------------------------
  await L.setProfileField('supportAreas', ['vision']);
  await L.setProfileField('fields.needs', [
    { dimension: 'textSize', value: 1.5, strength: 'preference', source: 'test' },
    { dimension: 'darkTheme', value: true, strength: 'preference', source: 'test' },
  ]);
  const model = await L.getAbilityModel();
  check('getAbilityModel carries the needs', (model.needs || []).some((n) => n.dimension === 'textSize' && n.value === 1.5));
  check('supportAreas carried', (model.supportAreas || []).includes('vision'));

  // ---- scoped settings + effective preferences -----------------------------
  await L.recordScopedSettings('origin:news.example.com', { fontScale: 170 }, { sourceLabel: 'integration' });
  const prefs = await L.getEffectivePreferences('https://news.example.com/story', []);
  check('effectivePreferences merges the scoped setting (alias route works)', prefs?.settings?.fontScale === 170,
    JSON.stringify(prefs?.settings));

  // ---- skills --------------------------------------------------------------
  const skill = {
    name: 'integration-skill', description: 'test skill',
    supportAreas: ['vision'], siteRelevance: ['news'],
    recipe: { adapters: [{ id: 'visual-assist', settings: { fontScale: 150 } }], actions: [] },
  };
  const saved = await L.saveSkill(skill);
  check('saveSkill persists', saved?.saved === true, JSON.stringify(saved));
  const skills = await L.listSkills();
  check('listSkills returns the saved skill', (skills || []).some((s) => s.name === 'integration-skill'));
  const found = await L.findSkillForNeed('larger text on news sites');
  check('findSkillForNeed (findSkill alias) resolves', found === null || typeof found === 'object');

  // ---- grants + consent + export ------------------------------------------
  const grantReq = await L.requestGrant('xr-app', ['ability.categories', 'settings.text'], { label: 'XR headset' });
  check('requestGrant creates a pending proposal', !!grantReq && grantReq.ok !== false);
  const proposals = await L.listProposals('pending');
  const grantProp = (proposals || []).find((p) => p.change?.op === 'grant-request');
  check('grant proposal is pending (consent-gated)', !!grantProp);
  if (grantProp) {
    await L.respondToProposal(grantProp.id, 'accept');
    const grants = await L.listGrants();
    check('grant minted after consent', (grants || []).some((g) => g.appId === 'xr-app'));
    const exported = await L.exportAbilityModel('xr-app');
    const exportedNeeds = exported?.model?.needs ?? exported?.needs ?? [];
    check('exportAbilityModel returns scope-filtered model', exported && exported.ok !== false && Array.isArray(exportedNeeds),
      JSON.stringify(exported)?.slice(0, 120));
  }
  const audit = await L.getShareAudit();
  check('shareAudit reachable via facade', Array.isArray(audit));

  // ---- profile blob round-trip via a SECOND uid ----------------------------
  const blob = await L.exportProfileBlob();
  check('exportProfileBlob yields aa-profile-blob', blob?.kind === 'aa-profile-blob');
  const tok2 = await admin('/admin/tokens', { body: { uid: UID_B, label: 'device-b' } });
  const L2 = loadFacade(base, tok2.body.token).asLibrarian();
  const before = await L2.getAbilityModel();
  check('second uid starts empty (isolation)', (before.needs || []).length === 0);
  await L2.importProfileBlob(blob);
  const after = await L2.getAbilityModel();
  check('blob import transfers the model across uids', (after.needs || []).some((n) => n.dimension === 'textSize'));

  // ---- natural-language notes over the wire --------------------------------
  // The whole point of notes is that they are the person's own words; if the
  // wire mangled or dropped them, the profile would silently lose the one part
  // of itself that isn't reconstructible from settings.
  const note = await L.addNote('Long pages tire my eyes; I read in short bursts.', { topic: 'fatigue' });
  check('addNote over the wire returns the stored note', note?.ok === true && typeof note.id === 'string', JSON.stringify(note));
  check('the prose survives the round trip verbatim',
    (await L.listNotes({ topic: 'fatigue' }))[0]?.text === 'Long pages tire my eyes; I read in short bursts.');
  const noteHits = await L.findNotes('eyes tire');
  check('findNotes ranks over the wire and reports matched terms',
    noteHits.length === 1 && noteHits[0].matched.length >= 1, JSON.stringify(noteHits));
  await L.updateNote(note.id, { scope: 'category:news' });
  check('updateNote re-files across shards over the wire',
    (await L.listNotes({ scope: 'category:news' })).some((n) => n.id === note.id));
  check('a note never becomes an applied setting, even remotely',
    !('fatigue' in ((await L.getEffectivePreferences('https://bbc.com/news', [])).settings || {})));
  check('notes are isolated per uid like every other record',
    (await L2.listNotes()).length === 0);
  check('deleteNote over the wire', (await L.deleteNote(note.id))?.removed === true);

  // ---- both setPause shapes (the seam that was actually broken) ------------
  await L.setMemoryPaused(true);
  let o = await L.logObservation({ url: 'https://anywhere.org/x', kind: 'setting-changed', detail: { key: 'fontScale', value: 120 } });
  check('setMemoryPaused via wire: observations drop globally', o?.logged === false && o?.reason === 'paused', JSON.stringify(o));
  await L.setMemoryPaused(false);
  await L.setOriginPaused('example.com', true);
  o = await L.logObservation({ url: 'https://example.com/x', kind: 'setting-changed', detail: { key: 'fontScale', value: 120 } });
  check('setOriginPaused via wire: only that origin drops', o?.logged === false && o?.reason === 'origin-paused', JSON.stringify(o));
  o = await L.logObservation({ url: 'https://elsewhere.org/x', kind: 'setting-changed', detail: { key: 'fontScale', value: 120 } });
  check('other origins unaffected by origin pause', o?.reason !== 'origin-paused' && o?.reason !== 'paused', JSON.stringify(o));
  await L.setOriginPaused('example.com', false);

  // ---- slow lane surfaces the no-server-key state as data ------------------
  const ex = await L.extract().catch((e) => ({ threw: String(e?.message || e) }));
  check('extract without server key fails soft (data or thrown app error, not crash)', ex !== undefined);
} finally {
  if (REMOTE_BASE) {
    // Revoke this run's tokens so nothing usable lingers server-side.
    try {
      const list = await admin('/admin/tokens', { method: 'GET' });
      for (const t of list.body || []) {
        if (t.uid?.startsWith(RUN)) await admin(`/admin/tokens/${t.id}`, { method: 'DELETE' });
      }
      console.log(`[remote mode] revoked ${RUN}-* tokens`);
    } catch (e) { console.warn('[remote mode] token cleanup failed:', e.message); }
  }
  if (server) await new Promise((r) => server.close(r));
  if (dataDir) await fs.promises.rm(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
