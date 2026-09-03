// Re-onboarding must clear what the person deselected. `fields.needs` was
// always written unconditionally; supportAreas and fields.visionKind were
// written only when non-empty, so a re-onboard left them stale and the
// profile disagreed with itself (empty needs, lingering areas, lingering
// visionKind driving voice-primary presentation the person had removed).
//
// The free-text self-description had the same guard and is the most sensitive
// field of the set, so it gets its own section below. Note that every case in
// this file used to pass freeText: '' and so never exercised the clearing path
// at all. The free-text cases deliberately START from a non-empty value.
//
//   node onboarding/test/reonboard.test.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// DATA_DIR is read at module load, so set it before the dynamic import.
const dir = mkdtempSync(path.join(tmpdir(), 'onboard-test-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';

const { onboard } = await import('../server.js');
const { fileStore } = await import('../../server/src/store.js');
const { createToolkitHost } = await import('../../server/src/toolkit-host.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

async function profileOf(uid) {
  // Read back through the same host machinery local mode uses.
  const host = createToolkitHost({
    store: fileStore(dir),
    geminiCaller: async () => { throw new Error('no-llm-in-test'); },
  });
  const { librarian } = await host.getInstance(uid);
  return librarian.getProfile();
}

// The self-description is stored twice: as profile.freeText and as a note
// filed under the stable 'self-description' topic. Both have to be checked.
async function selfDescriptionNotesOf(uid) {
  const host = createToolkitHost({
    store: fileStore(dir),
    geminiCaller: async () => { throw new Error('no-llm-in-test'); },
  });
  const { librarian } = await host.getInstance(uid);
  return librarian.listNotes({ topic: 'self-description' });
}

// First onboard: vision, explicitly blind.
await onboard({ uid: 'retest', supportAreas: ['vision'], freeText: '', visionKind: 'blind' });
let p = await profileOf('retest');
check('first onboard: supportAreas stored', Array.isArray(p.supportAreas) && p.supportAreas.includes('vision'));
check('first onboard: visionKind stored', p.fields?.visionKind === 'blind');
check('first onboard: needs derived', Array.isArray(p.fields?.needs) && p.fields.needs.length > 0);

// Re-onboard with everything deselected: all three must clear together.
await onboard({ uid: 'retest', supportAreas: [], freeText: '', visionKind: undefined });
p = await profileOf('retest');
check('re-onboard: supportAreas cleared', Array.isArray(p.supportAreas) && p.supportAreas.length === 0);
check('re-onboard: visionKind cleared', !p.fields?.visionKind);
check('re-onboard: needs cleared', Array.isArray(p.fields?.needs) && p.fields.needs.length === 0);

// Re-onboard switching populations: the old kind must not survive.
await onboard({ uid: 'retest', supportAreas: ['vision'], freeText: '', visionKind: 'lowVision' });
p = await profileOf('retest');
check('switch: visionKind is the new value', p.fields?.visionKind === 'lowVision');
check('switch: needs follow the new kind', p.fields.needs.some((n) => n.dimension === 'textSize'));

// ── free text: clearing the box clears BOTH representations ────────────────
await onboard({ uid: 'freetext', supportAreas: ['reading'], freeText: 'I need quiet pages', visionKind: undefined });
p = await profileOf('freetext');
check('free text: stored on first onboard', p.freeText === 'I need quiet pages');
check('free text: note stored on first onboard', (await selfDescriptionNotesOf('freetext')).length === 1);

// Submitting an empty description must remove the sentence the person wrote
// about their own disability, in both places it lives.
await onboard({ uid: 'freetext', supportAreas: ['reading'], freeText: '', visionKind: undefined });
p = await profileOf('freetext');
check('free text: cleared on empty re-onboard', !p.freeText);
check('free text: note removed on empty re-onboard', (await selfDescriptionNotesOf('freetext')).length === 0);

// Rewriting it (rather than clearing it) still upserts rather than appends.
await onboard({ uid: 'freetext', supportAreas: ['reading'], freeText: 'one sentence', visionKind: undefined });
await onboard({ uid: 'freetext', supportAreas: ['reading'], freeText: 'a different sentence', visionKind: undefined });
const rewritten = await selfDescriptionNotesOf('freetext');
check('free text: rewrite leaves exactly one note', rewritten.length === 1);
check('free text: rewrite updates the note text', rewritten[0]?.text === 'a different sentence');
check('free text: rewrite updates freeText', (await profileOf('freetext')).freeText === 'a different sentence');

rmSync(dir, { recursive: true, force: true });
console.log(`\nRe-onboard consistency: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
