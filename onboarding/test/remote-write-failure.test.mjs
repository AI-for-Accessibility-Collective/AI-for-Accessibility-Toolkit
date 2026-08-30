// A remote-mode onboarding write that fails must fail the onboarding.
//
// remoteLibrarian resolves for any HTTP status, and onboard() used to discard
// every response. With token minting succeeding and all three profile writes
// returning 500, onboard() still resolved and reported success: the person was
// handed a uid whose profile had never been written. Since the uid is the
// profile's read credential, that is a capability issued for nothing.
//
//   node onboarding/test/remote-write-failure.test.mjs

process.env.ONBOARD_MODE = 'remote';
process.env.TOOLKIT_URL = 'http://toolkit.test';
process.env.ADMIN_PASSWORD = 'test-only-not-a-real-secret';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

// Record every librarian call so we can assert the run STOPS at the first
// failure rather than carrying on writing.
let calls = [];
function stubFetch({ librarianStatus }) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const reply = (status, obj) => ({ status, json: async () => obj });
    if (u.endsWith('/admin/users')) return reply(200, { users: [] });
    if (u.endsWith('/admin/tokens')) return reply(200, { token: 'tok-test' });
    const m = /\/v1\/librarian\/([^/?]+)$/.exec(u);
    if (m) {
      calls.push(m[1]);
      const status = librarianStatus(m[1], calls.length);
      return status === 200
        ? reply(200, { result: null })
        : reply(status, { error: 'internal-error' });
    }
    throw new Error('unexpected fetch: ' + u + ' ' + (opts.method || 'GET'));
  };
}

const { onboard } = await import('../server.js');

async function onboardResult(args) {
  try { return { ok: true, value: await onboard(args) }; }
  catch (e) { return { ok: false, error: e }; }
}

const ARGS = { supportAreas: ['vision'], freeText: 'I need quiet pages', visionKind: 'lowVision' };

// ── every write fails ──────────────────────────────────────────────────────
stubFetch({ librarianStatus: () => 500 });
let r = await onboardResult(ARGS);
check('all writes 500: onboard rejects', r.ok === false);
check('all writes 500: message names the failure', /profile write failed/.test(r.error?.message || ''));
check('all writes 500: message carries the status', /500/.test(r.error?.message || ''));
check('all writes 500: stops at the first write', calls.length === 1);

// ── one write in the middle fails ──────────────────────────────────────────
// The partial-failure case is the one that used to be invisible: some fields
// landed, the rest did not, and the person was told it all worked.
stubFetch({ librarianStatus: (_m, n) => (n === 2 ? 500 : 200) });
r = await onboardResult(ARGS);
check('partial failure: onboard rejects', r.ok === false);
check('partial failure: no writes attempted after the failure', calls.length === 2);

// ── the healthy path still resolves ────────────────────────────────────────
stubFetch({ librarianStatus: () => 200 });
r = await onboardResult(ARGS);
check('all writes 200: onboard resolves', r.ok === true);
check('all writes 200: returns a uid', typeof r.value?.uid === 'string' && r.value.uid.length > 0);
check('all writes 200: every field written', calls.length === 5);

console.log(`\nRemote write failure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
