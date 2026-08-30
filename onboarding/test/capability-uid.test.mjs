// Generated profile ids are capabilities: the read routes are open by
// design, so a generated uid must be unguessable (128 random bits), unique,
// and must not leak anything time-ordered the old Date.now()-based ids did.
//
//   node onboarding/test/capability-uid.test.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'onboard-uid-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';

const { onboard, listProfileIds } = await import('../server.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

const a = await onboard({ supportAreas: ['vision'], freeText: '', visionKind: 'lowVision' });
const b = await onboard({ supportAreas: ['hearing'], freeText: '' });

// 16 random bytes base64url-encoded is 22 chars, no padding.
const SHAPE = /^u-[A-Za-z0-9_-]{22}$/;
check(`generated uid has the capability shape (${a.uid})`, SHAPE.test(a.uid));
check('two onboards get different uids', a.uid !== b.uid);
check('no timestamp prefix (old user-<time36> shape is gone)', !a.uid.startsWith('user-'));

// A caller-chosen uid still works (the tradeoff is documented, not blocked).
const c = await onboard({ uid: 'my-memorable-id', supportAreas: [], freeText: '' });
check('typed uid is honored', c.uid === 'my-memorable-id');

const ids = await listProfileIds();
check('all three profiles stored', ids.includes(a.uid) && ids.includes(b.uid) && ids.includes('my-memorable-id'));

rmSync(dir, { recursive: true, force: true });
console.log(`\nCapability uid: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
