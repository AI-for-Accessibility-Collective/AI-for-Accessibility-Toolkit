// With no ADMIN_PASSWORD set, the list and delete routes must stay shut — and
// say WHY, so an operator who forgot to configure one is not left reading
// "unauthorized" and hunting for a password that does not exist.
//
// This is its own file because server.js reads ADMIN_PASSWORD once at module
// load: a single process cannot exercise both the configured and unconfigured
// gate. http-routes.test.mjs covers the configured half.
//
//   node onboarding/test/admin-disabled.test.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'onboard-noadmin-'));
process.env.DATA_DIR = dir;
process.env.ONBOARD_MODE = 'local';
delete process.env.ADMIN_PASSWORD;
delete process.env.GEMINI_API_KEY;

const { server } = await import('../server.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  {
    const cfg = await (await fetch(base + '/api/config')).json();
    check('config reports admin disabled', cfg.adminEnabled === false);
  }

  {
    const r = await fetch(base + '/api/profiles');
    const d = await r.json();
    check('listing profiles is refused', r.status === 401);
    check('…and names the cause as configuration, not a bad password', d.error === 'admin-not-configured');
  }

  {
    // Guessing a password must not open the gate when none is configured.
    const r = await fetch(base + '/api/profiles', { headers: { 'x-admin-password': '' } });
    check('an empty password does not open the gate', r.status === 401);
    const any = await fetch(base + '/api/profiles', { headers: { 'x-admin-password': 'anything' } });
    check('an arbitrary password does not open the gate', any.status === 401);
  }

  {
    const r = await fetch(base + '/api/profiles/u-whatever', { method: 'DELETE' });
    check('deleting a profile is refused', r.status === 401);
  }

  {
    // Onboarding stays open by design: a person onboarding has no credential yet.
    const r = await fetch(base + '/api/onboard', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ supportAreas: ['reading'], freeText: '' }),
    });
    check('onboarding still works without an admin password', r.status === 200 && (await r.json()).ok === true);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nAdmin disabled: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
