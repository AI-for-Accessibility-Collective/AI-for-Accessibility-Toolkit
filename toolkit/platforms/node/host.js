#!/usr/bin/env node
// @ts-nocheck
// FLAG(review): 18 errors under toolkit/tsconfig.json's strict check at the
// time this count was taken. Type declarations still emit from this file;
// remove these lines and fix the errors to opt it into the check.
// Node reference host (Gap 3, deliverable 2) — the template an XR / mobile
// (any JS-runtime) host copies wholesale: real node ports (file-backed KV +
// shared store, timers, console consent — see ./kv.js, ./shared-store.js,
// ./ports.js) driving the SAME `createToolkit(...)` barrel every other host
// uses (toolkit/index.js). Unlike toolkit/hosts/xr-demo/demo.js and
// toolkit/hosts/skill-demo/demo.js (which use IN-MEMORY ports and a single
// process-lifetime instance to narrate a scripted scenario), this host
// proves persistence and cross-process-shaped transport actually work: two
// SEPARATE toolkit instances, each with its own on-disk KV root, exchanging
// a user-carried profile blob and live shared-transport envelopes through a
// real file on disk.
//
//   1. ONBOARD device A (file-backed KV root #1).
//   2. RECALL — the retrieval-prompt path a facilitation surface calls.
//   3. EXPORT a profile blob from A, IMPORT it into device B (a second
//      toolkit instance, file-backed KV root #2) — confirms the ability
//      model transfers across two independently-persisted instances.
//   4. createSharedTransport, file-backed: A publishes its granted export
//      for "device-b" to the shared file; B reads it back through its OWN
//      transport instance pointed at the same file. Then B posts an insight
//      into the shared inbox; A drains it into a consent-gated proposal,
//      accepts it, and the accepted value lands in A's AbilityModel.
//
// Run: node toolkit/platforms/node/host.js
// Exits 0 on a clean loop, 1 (with a message) on any assertion failure.
// Writes nothing outside a temp dir under the OS tmpdir, which it deletes
// before exiting either way.

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { createToolkit, createSharedTransport, validateProfileBlob } from '../../index.js';
import { fileKV } from './kv.js';
import { fileSharedStore } from './shared-store.js';
import { nodeClock, nodeScheduler, consoleConsent } from './ports.js';

const log = (s) => console.log(s);

// A minimal tools registry — only what the ability-model / settings-vocab
// paths this demo exercises actually read (same minimal shape
// toolkit/test/phase3-crossapp.test.mjs and toolkit/hosts/xr-demo/demo.js use).
const toolsRegistry = {
  settingsMeta: { fontScale: { type: 'number', range: [50, 200] }, lineHeight: { type: 'number', range: [1, 3] } },
  settingsVocabularyLines: () => ['- fontScale: number 50-200'],
};

function bootToolkit(dir, clock) {
  return createToolkit({
    kv: fileKV(dir),
    clock,
    scheduler: nodeScheduler(),
    consent: consoleConsent(),
    toolsRegistry,
  });
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aa-toolkit-node-host-'));
  const clock = nodeClock();

  try {
    log('━━━ 1. ONBOARD device A (file-backed KV) ━━━');
    const a = bootToolkit(path.join(root, 'device-a'), clock);
    await a.datastore.runMigrations();
    await a.librarian.setProfileField('supportAreas', ['vision']);
    await a.librarian.setProfileField('freeText', 'small text is hard to read');
    await a.librarian.setProfileField('fields.needs', [
      { dimension: 'textSize', value: 1.5, strength: 'preference', source: 'onboarding' },
    ]);
    const model = await a.librarian.getAbilityModel();
    log(`  AbilityModel: needs=${JSON.stringify(model.needs)}`);
    assertTrue(model.needs.some(n => n.dimension === 'textSize' && n.value === 1.5), 'onboarding wrote textSize=1.5');

    log('\n━━━ 2. RECALL ━━━');
    const recalled = await a.librarian.recall('https://example.test/article', 'reading', []);
    log(`  Recall block:\n${recalled.block.split('\n').map(l => '    ' + l).join('\n')}`);
    assertTrue(typeof recalled.block === 'string' && recalled.block.includes('vision'), 'recall block reflects support areas');

    log('\n━━━ 3. EXPORT a profile blob from A, IMPORT into device B ━━━');
    const blob = await a.librarian.exportProfileBlob();
    assertTrue(validateProfileBlob(blob), 'exported blob is well-formed');
    log(`  Exported blob: kind=${blob.kind} v=${blob.v} needs=${blob.abilityModel.needs.length}`);

    const b = bootToolkit(path.join(root, 'device-b'), clock);
    await b.datastore.runMigrations();
    const imp = await b.librarian.importProfileBlob(blob);
    assertTrue(imp.ok && imp.merged, `device B imported the blob (${JSON.stringify(imp)})`);
    const modelB = await b.librarian.getAbilityModel();
    log(`  Device B AbilityModel after import: needs=${JSON.stringify(modelB.needs)}`);
    assertTrue(modelB.needs.some(n => n.dimension === 'textSize' && n.value === 1.5), 'ability model transferred A -> B');
    log('  ✓ ability model transferred across two separately-persisted instances');

    log('\n━━━ 4. SHARED TRANSPORT (file-backed): publish (A) -> read (B), post (B) -> drain (A) ━━━');
    const sharedFile = path.join(root, 'shared.json');
    const transportA = createSharedTransport({ shared: fileSharedStore(sharedFile), clock });
    const transportB = createSharedTransport({ shared: fileSharedStore(sharedFile), clock });

    const grantReq = await a.librarian.requestGrant('device-b', ['ability.categories', 'settings.text'], { appLabel: 'Device B' });
    assertTrue(grantReq.ok, `A drafted a grant request for device-b (${grantReq.reason || ''})`);
    await a.librarian.respondToProposal(grantReq.proposalId, 'accept');
    assertTrue((await a.librarian.listGrants()).some(g => g.appId === 'device-b'), 'grant for device-b is active');

    const pub = await transportA.publishExports(a.librarian);
    assertTrue(pub.published.includes('device-b'), `A published its export for device-b (${JSON.stringify(pub)})`);
    log(`  A published exports for: ${pub.published.join(', ')}`);

    // B reads what A published, through its OWN transport instance pointed
    // at the SAME file — proving the file is a real shared area, not shared
    // in-process state.
    const readBack = await transportB.readExport('device-b');
    assertTrue(!!readBack && readBack.abilityModel.needs.some(n => n.dimension === 'textSize'), 'device B read A\'s published export');
    log(`  B read A's export via the shared file: needs=${JSON.stringify(readBack.abilityModel.needs)}`);

    // B posts an insight into the shared inbox; A drains it as a
    // consent-gated proposal — never silently applied.
    await transportB.postInsight('device-b', {
      kind: 'visual.textSize', confidence: 0.8, label: 'Even larger text (measured on device B)',
      rationale: 'Device B observed the user zooming further.',
      change: {
        op: 'profile-set', path: 'fields.needs',
        value: [{ dimension: 'textSize', value: 1.7, strength: 'preference', source: 'device-b' }],
      },
    });
    const drained = await transportA.drainInbox(a.librarian);
    assertTrue(!!drained[0]?.ok && !!drained[0].proposalId, `A drained the posted insight into a pending proposal (${JSON.stringify(drained)})`);
    log(`  A drained 1 insight -> pending proposal ${drained[0].proposalId}`);
    assertTrue(!(await a.librarian.getAbilityModel()).needs.some(n => n.dimension === 'textSize' && n.value === 1.7),
      'the drained insight is NOT applied before consent');

    await a.librarian.respondToProposal(drained[0].proposalId, 'accept');
    const modelA2 = await a.librarian.getAbilityModel();
    log(`  A accepted the proposal: needs=${JSON.stringify(modelA2.needs)}`);
    assertTrue(modelA2.needs.some(n => n.dimension === 'textSize' && n.value === 1.7), 'accepted insight applied to A\'s AbilityModel');

    log('\n✓ Node host loop complete.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✗ Node host loop failed:', err.message);
    process.exit(1);
  });
