// A remote-mode onboarding write that fails must fail the onboarding, and the
// writes must be shaped so that a failure cannot leave a self-contradicting
// profile.
//
// Two separate defects live here. The first: remoteLibrarian resolves for any
// HTTP status, and onboard() used to discard every response, so with token
// minting succeeding and every profile write returning 500 it still resolved
// and reported success. The person was handed a uid whose profile had never
// been written, and since the uid is that profile's read credential, that is a
// capability issued for nothing.
//
// The second is what checking the status alone does NOT fix. Onboarding used to
// write four profile fields in four calls, all of them against the SAME
// `mine.profile` record, so a failure partway through stored support areas
// without the needs derived from them, or a vision kind the needs contradict.
// Reporting that failure does not repair it, and no rollback can be trusted to
// finish either. The fix is to stop creating the partial state: the four fields
// go in ONE write, so the record either takes the new answers or keeps the old.
// The tests below pin the call SHAPE, because that shape is the guarantee.
//
// Remote mode only, on purpose. Two of the failure shapes here (a non-200
// status, a missing envelope) exist only on the wire. The third, `200
// {ok:false, error}`, is what a Librarian method throwing looks like from this
// side; onboard-contract.test.mjs injects that one in both modes (`failAt`),
// and it stays here too because it is the shape that used to slip past a
// status-only check. That the local branch makes the same writes in the same
// order is also onboard-contract.test.mjs's job, which runs one scenario table
// against both modes.
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

// Record every librarian call so we can assert both the ORDER of the writes and
// that the run STOPS at the first failure rather than carrying on writing.
let calls = [];
// The stub answers in the service's REAL envelope, which is the whole point of
// the second scenario below: a success is `{ok:true, result}`, a method that
// threw is `200 {ok:false, error}`, and only a transport problem carries a
// non-200 status. An earlier version of this stub returned a bare `{result}`
// with no `ok` at all, so it could not have caught a check that reads the
// status alone.
//   librarianStatus -> HTTP status (200 unless we are simulating transport loss)
//   librarianOk     -> the envelope's `ok`, which is where a real outage shows up
function stubFetch({ librarianStatus = () => 200, librarianOk = () => true, notes = [] }) {
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
      if (status !== 200) return reply(status, { error: 'internal-error' });
      if (!librarianOk(m[1], calls.length)) {
        return reply(200, { ok: false, error: 'datastore unavailable' });
      }
      return reply(200, { ok: true, result: m[1] === 'listNotes' ? notes : null });
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
const CLEARING = { supportAreas: ['vision'], freeText: '', visionKind: 'lowVision' };

// ── every write fails ──────────────────────────────────────────────────────
stubFetch({ librarianStatus: () => 500 });
let r = await onboardResult(ARGS);
check('all writes 500: onboard rejects', r.ok === false);
check('all writes 500: message names the failure', /profile write failed/.test(r.error?.message || ''));
check('all writes 500: message carries the status', /500/.test(r.error?.message || ''));
check('all writes 500: stops at the first write', calls.length === 1);

// ── the failure shape that actually happens: 200 with ok:false ─────────────
// A librarian method that throws is answered `200 {ok:false, error}` by design,
// because CONTRACT.md treats application errors as data rather than transport
// failures. That is what an unreachable datastore looks like from here: the
// HTTP request succeeds and the write does not. A check that reads only the
// status calls this a success and hands the person a capability for a profile
// that was never written, which is the exact bug this file exists to prevent,
// arriving through the other door.
stubFetch({ librarianOk: () => false });
r = await onboardResult(ARGS);
check('ok:false at HTTP 200: onboard rejects', r.ok === false);
check('ok:false at HTTP 200: message names the failure', /profile write failed/.test(r.error?.message || ''));
check('ok:false at HTTP 200: message carries the service error', /datastore unavailable/.test(r.error?.message || ''));
check('ok:false at HTTP 200: stops at the first write', calls.length === 1);

// The same shape partway through, which is the one that used to leave a
// half-written profile AND report success.
stubFetch({ librarianOk: (_m, n) => n !== 2 });
r = await onboardResult(ARGS);
check('ok:false partway: onboard rejects', r.ok === false);
check('ok:false partway: nothing attempted after it', calls.length === 2);

// A missing envelope is not a success either. Anything that is not an explicit
// ok:true is a write we cannot vouch for.
stubFetch({ librarianOk: () => true });
globalThis.fetch = (function (inner) {
  return async (url, opts) => {
    const r2 = await inner(url, opts);
    if (/\/v1\/librarian\//.test(String(url))) {
      const body = await r2.json();
      delete body.ok;
      return { status: r2.status, json: async () => body };
    }
    return r2;
  };
})(globalThis.fetch);
r = await onboardResult(ARGS);
check('no ok field at all: onboard rejects', r.ok === false);

// ── the profile is ONE write, never four ───────────────────────────────────
// This is the assertion that makes a half-written profile impossible rather
// than merely reported. If someone re-splits these fields into per-field calls,
// the partial-profile failure mode comes straight back, so it fails here.
stubFetch({ librarianStatus: () => 200 });
r = await onboardResult(ARGS);
check('healthy: onboard resolves', r.ok === true);
check('healthy: returns a uid', typeof r.value?.uid === 'string' && r.value.uid.length > 0);
check('healthy: profile written exactly once', calls.filter((c) => c === 'setProfileFields').length === 1);
check('healthy: no per-field profile writes remain', calls.every((c) => c !== 'setProfileField'));
check('healthy: whole run is note-then-profile', JSON.stringify(calls) === JSON.stringify(['addNote', 'setProfileFields']));

// Every field the form produces has to be in that single write, or the fields
// left out silently stop clearing on a re-onboard.
let sentFields = null;
globalThis.fetch = (function (inner) {
  return async (url, opts = {}) => {
    if (/\/v1\/librarian\/setProfileFields$/.test(String(url))) {
      sentFields = JSON.parse(opts.body).args[0];
    }
    return inner(url, opts);
  };
})(globalThis.fetch);
await onboardResult(ARGS);
check('healthy: the one write carries supportAreas', Array.isArray(sentFields?.supportAreas));
check('healthy: the one write carries needs', Array.isArray(sentFields?.['fields.needs']));
check('healthy: the one write carries visionKind', sentFields?.['fields.visionKind'] === 'lowVision');
check('healthy: the one write carries freeText', sentFields?.freeText === 'I need quiet pages');

// ── clearing: the note goes before the profile ─────────────────────────────
// The profile is the copy a person is shown, so it is written last. If the run
// dies in between, we have not told anyone their description is gone while a
// stored copy of it survives.
stubFetch({ librarianStatus: () => 200, notes: [{ id: 'n1' }] });
r = await onboardResult(CLEARING);
check('clearing: onboard resolves', r.ok === true);
check('clearing: note is removed before the profile is rewritten',
  JSON.stringify(calls) === JSON.stringify(['listNotes', 'deleteNote', 'setProfileFields']));

// ── a failure between the two records still stops the run ──────────────────
// The note and the profile are separate records and nothing spans them, so
// this window cannot be closed by ordering alone. What it CAN do is stop, and
// leave a state that a re-run converges on: every write is unconditional and
// the note upserts by topic, so onboarding the same uid again is a repair.
stubFetch({ librarianStatus: (_m, n) => (n === 2 ? 500 : 200) });
r = await onboardResult(ARGS);
check('cross-record failure: onboard rejects', r.ok === false);
check('cross-record failure: nothing attempted after it', calls.length === 2);
check('cross-record failure: the profile write is what failed', calls[1] === 'setProfileFields');

console.log(`\nRemote write failure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
