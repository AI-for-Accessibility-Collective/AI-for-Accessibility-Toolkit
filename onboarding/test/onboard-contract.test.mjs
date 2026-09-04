// One contract, two write paths. onboard() in onboarding/server.js stores a
// person's profile in one of two modes: local (the toolkit embedded in this
// process over a file store) or remote (a running toolkit service, reached
// with fetch). A person onboarding against the hosted service and a person
// onboarding locally must end up with the same profile, because the profile
// is what every adaptation reads. The two branches agree today because the
// people editing them are careful. This file makes the agreement a test.
//
// The same scenario table runs against both modes, and every assertion is
// written once. Two layers of checks:
//
//   per mode    each scenario's call sequence, arguments, uid handling, and
//               return value match the contract the table states;
//   cross-mode  the recorded sequences, the profile fields written, the uid
//               outcome, and the return value are identical between modes.
//
// A divergence therefore fails twice, once naming the mode that broke the
// contract and once naming the scenario where the modes disagree.
//
// Shape. server.js reads ONBOARD_MODE once at module load, so one process
// cannot run both modes; the existing suites already keep one process per
// module-load environment (admin-disabled.test.mjs says why). This file
// follows that rule: run with no arguments it spawns itself twice, once per
// mode, and compares the two reports. Run with --mode=local or --mode=remote
// it is the per-mode child.
//
// Recording. Both modes record at the same seam: the Librarian that a toolkit
// host's getInstance(uid) hands back is wrapped in a Proxy that logs each
// call with the uid it was made for, and throws when the scenario says that
// call must fail. In remote mode the toolkit host belongs to the real service
// (server/src/app.js), booted in this process on an ephemeral port the way
// server/test/server-test.mjs boots it, and TOOLKIT_URL points at it; a
// throw inside the proxy is what the service answers `200 {ok:false}` for.
// In local mode the host is built inside server.js, which exports no handle
// to it, so the local child registers onboard-contract.hooks.mjs, which swaps
// the toolkit host module server.js imports for a wrapper that returns the
// same recording Librarian. Nothing outside this test changes for either
// mode, and no part of the service is stubbed.
//
//   node onboarding/test/onboard-contract.test.mjs
//   node onboarding/test/onboard-contract.test.mjs --mode=local   (one mode)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const MODES = ['local', 'remote'];
const TOPIC = 'self-description';
const NOTE_OPTS = { source: 'user-explicit', topic: TOPIC };
const UID_SHAPE = /^u-[A-Za-z0-9_-]{22}$/;
const LISTED = '<a note listNotes returned>';
// A child that never exits (a write that hangs, a hook that wedges the loader)
// must not hang `npm test` with it. The whole run takes well under a second
// here; the limit is generous so a slow CI runner does not trip it.
// FLAG(review): the limit is a guess at "far longer than any honest run".
const CHILD_TIMEOUT_MS = 60_000;

// ── the contract, as a table ─────────────────────────────────────────────────
// Rows run in this order, in one process per mode, against one store. A row
// with `uidFrom` starts from whatever the earlier rows left on that uid, the
// self-description note included, so the rows that need a note in place say
// which earlier row put it there. Reordering them changes what they test.
//
// `input`   what the form (or any caller) sends to onboard().
// `uidFrom` run against the uid an earlier scenario produced.
// `failAt`  make the Nth Librarian call fail: the method throws in both
//           modes, and in remote mode the service reports that throw in its
//           `200 {ok:false, error}` envelope.
// `written` the values the profile write must carry after normalization;
//           needs are derived from them with the same deriveDefaultNeeds.
// `calls`   the exact Librarian call sequence, in order, and nothing after.
// `uid`     'generated' (a fresh capability id) or 'same-as:<key>': the uid
//           every write lands under and, when onboard() resolves, the uid it
//           returns. The two must be the same uid.
// `ok`      whether onboard() resolves.
const SCENARIOS = [
  {
    key: 'fresh-text',
    input: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    written: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    calls: ['addNote', 'setProfileFields'], uid: 'generated', ok: true,
  },
  {
    key: 'fresh-empty-text',
    input: { supportAreas: ['hearing'], freeText: '' },
    written: { supportAreas: ['hearing'], freeText: '', visionKind: undefined },
    calls: ['listNotes', 'setProfileFields'], uid: 'generated', ok: true,
  },
  {
    key: 'existing-uid-rewrites-text',
    uidFrom: 'fresh-text',
    input: { supportAreas: ['reading'], freeText: 'a different sentence' },
    written: { supportAreas: ['reading'], freeText: 'a different sentence', visionKind: undefined },
    calls: ['addNote', 'setProfileFields'], uid: 'same-as:fresh-text', ok: true,
  },
  {
    // Needs the note that fresh-text wrote (and existing-uid-rewrites-text
    // rewrote) still on this uid: it is what deleteNote removes.
    key: 'existing-uid-clears-text',
    uidFrom: 'fresh-text',
    input: { supportAreas: ['reading'], freeText: '' },
    written: { supportAreas: ['reading'], freeText: '', visionKind: undefined },
    calls: ['listNotes', 'deleteNote', 'setProfileFields'], uid: 'same-as:fresh-text', ok: true,
  },
  {
    key: 'unknown-typed-uid-not-honored',
    input: { uid: 'my-memorable-id', supportAreas: [], freeText: '' },
    written: { supportAreas: [], freeText: '', visionKind: undefined },
    calls: ['listNotes', 'setProfileFields'], uid: 'generated', ok: true,
  },
  {
    key: 'input-normalized',
    input: { supportAreas: ['vision', 'nope', 7], freeText: '  spaced out  ', visionKind: 'weird' },
    written: { supportAreas: ['vision'], freeText: 'spaced out', visionKind: undefined },
    calls: ['addNote', 'setProfileFields'], uid: 'generated', ok: true,
  },
  {
    key: 'blind-explicit',
    input: { supportAreas: ['vision', 'reading'], freeText: 'I use a screen reader', visionKind: 'blind' },
    written: { supportAreas: ['vision', 'reading'], freeText: 'I use a screen reader', visionKind: 'blind' },
    calls: ['addNote', 'setProfileFields'], uid: 'generated', ok: true,
  },
  {
    key: 'invalid-uid-rejected-before-any-write',
    input: { uid: 'a/b', supportAreas: ['vision'], freeText: 'x' },
    calls: [], ok: false,
  },
  {
    key: 'note-write-fails',
    failAt: 1,
    input: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    written: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    calls: ['addNote'], uid: 'generated', ok: false,
  },
  {
    key: 'profile-write-fails',
    failAt: 2,
    input: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    written: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    calls: ['addNote', 'setProfileFields'], uid: 'generated', ok: false,
  },
  {
    key: 'existing-uid-restores-text',
    uidFrom: 'fresh-text',
    input: { supportAreas: ['reading'], freeText: 'back again' },
    written: { supportAreas: ['reading'], freeText: 'back again', visionKind: undefined },
    calls: ['addNote', 'setProfileFields'], uid: 'same-as:fresh-text', ok: true,
  },
  {
    // Needs the note existing-uid-restores-text put back after
    // existing-uid-clears-text deleted it: without one there is no deleteNote
    // for the second call to be.
    key: 'clearing-delete-fails',
    uidFrom: 'fresh-text',
    failAt: 2,
    input: { supportAreas: ['reading'], freeText: '' },
    written: { supportAreas: ['reading'], freeText: '', visionKind: undefined },
    calls: ['listNotes', 'deleteNote'], uid: 'same-as:fresh-text', ok: false,
  },
];

// JSON with sorted keys, so two objects built in different key orders compare
// equal. undefined-valued keys drop out, the same as they do over the wire.
function canon(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
    }
    return v;
  });
}

function describe(trace) {
  if (!trace.length) return '(no calls)';
  return trace.map((c) => `${c.method}(${canon(c.args).slice(1, -1)})`).join(' then ');
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); if (detail) console.log(detail); }
}

const modeArg = process.argv.find((a) => a.startsWith('--mode='));
if (modeArg) {
  await runOneMode(modeArg.slice('--mode='.length));
} else {
  await runBothModesAndCompare();
}

// ── the per-mode child ───────────────────────────────────────────────────────
async function runOneMode(mode) {
  if (!MODES.includes(mode)) throw new Error('unknown mode: ' + mode);
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outFile = outArg ? outArg.slice('--out='.length) : null;

  // Shared by both recorders: every Librarian call lands here, in order, with
  // the uid it was made for; `failAt` names the one call that must fail for
  // the current scenario; `reached` counts how often the recorder was handed
  // something to record, so a recorder that never engaged is reported as
  // such rather than as server.js making no calls.
  const state = { trace: [], failAt: 0, reached: 0 };

  process.env.ONBOARD_MODE = mode;
  delete process.env.GEMINI_API_KEY;
  let dataDir = null;
  let service = null;
  const report = { mode, scenarios: [] };
  const uids = {}; // scenario key -> the uid it produced
  try {
    // Everything that can fail sits inside the try, so a server.js that does
    // not load, or a hook that does not install, still leaves no temp store
    // behind. The store goes under the parent's report directory when there
    // is one: a child the parent has to kill never reaches the finally below,
    // and the parent removes its own directory either way.
    dataDir = mkdtempSync(path.join(outFile ? path.dirname(outFile) : tmpdir(), 'onboard-contract-'));
    if (mode === 'local') {
      process.env.DATA_DIR = dataDir;
      installLocalRecorder(state);
      await installHooks();
    } else {
      process.env.ADMIN_PASSWORD = 'test-only-not-a-real-secret';
      service = await startService(state, dataDir, process.env.ADMIN_PASSWORD);
      process.env.TOOLKIT_URL = service.url;
    }
    const { onboard, deriveDefaultNeeds } = await import('../server.js');

    for (const scen of SCENARIOS) {
      const input = { ...scen.input };
      if (scen.uidFrom) {
        // Running on without the uid would test a fresh profile under the
        // name of a re-onboard, and pass for the wrong reason.
        check(`${mode} ${scen.key}: runs after ${scen.uidFrom}, which produced a uid`, scen.uidFrom in uids,
          `      ${scen.uidFrom} did not resolve, or is not earlier in the table`);
        if (!(scen.uidFrom in uids)) continue;
        input.uid = uids[scen.uidFrom];
      }
      state.trace = [];
      state.failAt = scen.failAt || 0;

      let outcome;
      try { outcome = { ok: true, value: await onboard(input) }; }
      catch (e) { outcome = { ok: false, error: e }; }
      if (outcome.ok) uids[scen.key] = outcome.value.uid;

      const trace = normalize(state.trace);
      const entry = {
        key: scen.key,
        ok: outcome.ok,
        trace,
        profileFields: trace.find((c) => c.method === 'setProfileFields')?.args[0] ?? null,
        uidOutcome: outcome.ok ? uidOutcome(scen, input, outcome.value.uid, uids) : null,
        wroteUnder: writeTarget(scen, input, state.trace, outcome, uids),
        returned: outcome.ok ? { ...outcome.value, uid: undefined } : null,
      };
      report.scenarios.push(entry);
      assertScenario(mode, scen, entry, outcome, deriveDefaultNeeds);
    }

    // A recorder that never engaged makes every scenario read as "no calls",
    // which is also what a broken onboard() looks like. Say which it was.
    check(mode === 'local'
      ? 'local: the module hook wrapped the toolkit host that server.js built (onboard-contract.hooks.mjs)'
      : 'remote: the in-process service reached the recording toolkit host for the calls server.js sent it',
      state.reached > 0);
  } finally {
    if (service) await service.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  }

  report.pass = pass;
  report.fail = fail;
  if (outFile) writeFileSync(outFile, JSON.stringify(report));
  console.log(`\nOnboard contract (${mode}): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// Two ways to register module hooks, by Node version. `registerHooks()`
// (in-thread, synchronous) is the current API; Node 26 prints a deprecation
// warning for the older `register()`. `registerHooks()` is missing from the
// oldest versions the package's engines field allows (20.19 and 22.13, both
// checked), so those get `register()`, which runs the same hooks on a
// separate thread. The hooks file is written to work under either.
async function installHooks() {
  const mod = await import('node:module');
  if (typeof mod.registerHooks === 'function') {
    const hooks = await import('./onboard-contract.hooks.mjs');
    mod.registerHooks({ resolve: hooks.resolve, load: hooks.load });
  } else {
    mod.register('./onboard-contract.hooks.mjs', import.meta.url);
  }
}

// deleteNote takes an id the toolkit generated, which differs by mode and by
// run. Replace it with a marker when it is one of the ids the preceding
// listNotes returned; an id from anywhere else stays as it is, and fails the
// argument check by name.
function normalize(trace) {
  let listed = [];
  return trace.map((c) => {
    if (c.method === 'listNotes') listed = c.listed || [];
    const args = c.method === 'deleteNote' && listed.includes(c.args[0]) ? [LISTED] : c.args;
    return { method: c.method, args };
  });
}

function uidOutcome(scen, input, uid, uids) {
  if (scen.uidFrom) return uid === uids[scen.uidFrom] ? 'same-as:' + scen.uidFrom : 'other';
  if (input.uid && uid === input.uid) return 'supplied';
  return UID_SHAPE.test(uid) ? 'generated' : 'other';
}

// Which uid the Librarian calls were made for, as a label that reads the same
// in both modes. The returned uid is what a person is handed, so a run that
// resolves must have written under that uid and no other: a token minted for
// one id and a result naming another would hand out a capability for an
// empty profile, and the trace of {method, args} alone would not show it.
function writeTarget(scen, input, rawTrace, outcome, uids) {
  const seen = [...new Set(rawTrace.map((c) => c.uid))];
  if (!seen.length) return null;
  if (seen.length > 1) return 'several: ' + seen.join(', ');
  if (outcome.ok) return seen[0] === outcome.value.uid ? 'returned' : 'not the returned uid: ' + seen[0];
  return uidOutcome(scen, input, seen[0], uids);
}

// `written` is absent on a row that makes no writes, and a row that does make
// writes could be added without one. Fall back to the empty answers rather
// than throwing here, including for deriveDefaultNeeds, which needs an
// iterable: a row missing `written` has to read as a failed argument check on
// one call, not as a TypeError that takes the whole child's report with it.
function expectedArgs(method, written, deriveDefaultNeeds) {
  const { supportAreas = [], freeText = '', visionKind } = written || {};
  switch (method) {
    case 'addNote': return [freeText, NOTE_OPTS];
    case 'listNotes': return [{ topic: TOPIC }];
    case 'deleteNote': return [LISTED];
    case 'setProfileFields': return [{
      supportAreas,
      'fields.needs': deriveDefaultNeeds(supportAreas, freeText, visionKind),
      'fields.visionKind': visionKind ?? null,
      freeText,
    }];
    default: return null;
  }
}

// Every assertion the contract makes about one mode, written once.
function assertScenario(mode, scen, entry, outcome, deriveDefaultNeeds) {
  const tag = `${mode} ${scen.key}:`;
  const got = entry.trace.map((c) => c.method);

  check(`${tag} onboard() ${scen.ok ? 'resolves' : 'rejects'}`, entry.ok === scen.ok,
    entry.ok ? undefined : `      error: ${outcome.error?.message}`);
  if (!scen.ok) {
    check(`${tag} the rejection is an Error with a message`,
      outcome.error instanceof Error && outcome.error.message.length > 0);
  }
  check(`${tag} call sequence is ${scen.calls.join(' then ') || 'nothing'}, and nothing after`,
    got.join(',') === scen.calls.join(','),
    `      got: ${got.join(' then ') || '(no calls)'}`);

  // Every call lands under the one uid the scenario names: the returned uid
  // when onboard() resolves, and the table's `uid` when it does not.
  const target = !scen.calls.length ? null : scen.ok ? 'returned' : scen.uid;
  check(`${tag} every call is made for ${target === 'returned' ? 'the returned uid' : target ?? 'no uid (no calls)'}`,
    entry.wroteUnder === target, `      got: ${entry.wroteUnder}`);

  for (let i = 0; i < scen.calls.length; i++) {
    const method = scen.calls[i];
    const call = entry.trace[i];
    if (!call || call.method !== method) continue; // the sequence check already failed
    const want = expectedArgs(method, scen.written, deriveDefaultNeeds);
    check(`${tag} call ${i + 1} ${method} carries the expected arguments`,
      canon(call.args) === canon(want),
      `      got:  ${canon(call.args)}\n      want: ${canon(want)}`);
  }

  if (scen.ok && entry.ok) {
    check(`${tag} uid is ${scen.uid}`, entry.uidOutcome === scen.uid, `      got: ${entry.uidOutcome}`);
    const w = scen.written;
    const want = {
      supportAreas: w.supportAreas, freeText: w.freeText, visionKind: w.visionKind,
      needs: deriveDefaultNeeds(w.supportAreas, w.freeText, w.visionKind),
    };
    check(`${tag} returns {supportAreas, freeText, visionKind, needs} for what was written`,
      canon(entry.returned) === canon(want),
      `      got:  ${canon(entry.returned)}\n      want: ${canon(want)}`);
  }
}

// ── the recording Librarian, shared by both modes ────────────────────────────
// Wraps the Librarian a toolkit host's getInstance(uid) returned. The proxy
// records each method call with the uid, throws when the call is the one the
// scenario says must fail, and otherwise delegates unchanged.
function recordLibrarian(state, librarian, uid) {
  state.reached++;
  return new Proxy(librarian, {
    get(target, key) {
      const v = target[key];
      if (typeof key !== 'string' || typeof v !== 'function') return v;
      return async (...args) => {
        const entry = { method: key, args: structuredClone(args), uid };
        const n = state.trace.push(entry);
        if (state.failAt === n) throw new Error('injected failure');
        const result = await v.apply(target, args);
        if (key === 'listNotes') entry.listed = (result || []).map((x) => x.id);
        return result;
      };
    },
  });
}

// Local mode: onboard-contract.hooks.mjs hands every Librarian that server.js
// obtains to this global, from inside the module it swapped in.
function installLocalRecorder(state) {
  globalThis.__onboardContractRecord = (librarian, uid) => recordLibrarian(state, librarian, uid);
}

// ── remote mode: the real service, in this process ───────────────────────────
// Boots server/src/app.js the way server/test/server-test.mjs does: a file
// store under the test's temp dir, a toolkit host over it, createApp() on an
// ephemeral port. server.js then talks to it over real HTTP, so token
// minting, /admin/users, the note upsert by topic, and the response envelope
// are all the service's own, not a reading of them. The one thing added is
// the recording proxy on the host's getInstance, the same wrapper the local
// hooks apply, so both modes record at the same seam. The service turns a
// throw from the proxy into `200 {ok:false, error}` (handleLibrarianCall),
// which is the failure shape onboard() has to stop at.
//
// The service builds a uid's toolkit instance before it invokes any librarian
// method, and building it runs the datastore migrations, which write the
// uid's partition. So /admin/users lists a uid from its first librarian call
// onward, even one whose method then threw; minting a token alone creates
// nothing. No scenario can observe the difference (a failed onboard() returns
// no uid to reuse); it is noted so nobody adds a rule here that the service
// does not have.
async function startService(state, dataDir, adminPassword) {
  const { createApp } = await import('../../server/src/app.js');
  const { fileStore } = await import('../../server/src/store.js');
  const { createToolkitHost } = await import('../../server/src/toolkit-host.js');
  const store = fileStore(dataDir);
  const host = createToolkitHost({
    store,
    // Onboarding never needs the LLM lane; the same throwing caller
    // server.js uses in local mode.
    geminiCaller: async () => { throw new Error('no-llm-in-contract-test'); },
  });
  const recordingHost = {
    ...host,
    getInstance: async (uid) => {
      const instance = await host.getInstance(uid);
      return { ...instance, librarian: recordLibrarian(state, instance.librarian, uid) };
    },
  };
  const server = http.createServer(createApp({ store, adminPassword, toolkitHost: recordingHost, version: 'contract-test' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ── the parent: both modes, then the comparison ──────────────────────────────
function runChild(mode, outFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HERE, '--mode=' + mode, '--out=' + outFile], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      console.log(`FAIL: the ${mode} child did not exit within ${CHILD_TIMEOUT_MS / 1000}s; killed`);
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); console.log(`FAIL: could not start the ${mode} child: ${e.message}`); resolve(null); });
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve(code ?? `signal ${signal}`); });
  });
}

async function runBothModesAndCompare() {
  const dir = mkdtempSync(path.join(tmpdir(), 'onboard-contract-reports-'));
  const reports = {};
  const exits = {};
  try {
    for (const mode of MODES) {
      const outFile = path.join(dir, mode + '.json');
      console.log(`\n── ${mode} mode ──`);
      exits[mode] = await runChild(mode, outFile);
      try { reports[mode] = JSON.parse(readFileSync(outFile, 'utf8')); }
      catch { reports[mode] = null; }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n── cross-mode ──');
  const { local, remote } = reports;
  check('both modes produced a report', !!local && !!remote,
    `      exit codes: local ${exits.local}, remote ${exits.remote}`);
  if (local && remote) {
    for (const scen of SCENARIOS) {
      const l = local.scenarios.find((s) => s.key === scen.key);
      const r = remote.scenarios.find((s) => s.key === scen.key);
      const tag = `${scen.key}:`;
      // Two missing entries would compare equal below; say so instead.
      check(`${tag} both modes ran the scenario`, !!l && !!r,
        `      local ${l ? 'ran' : 'skipped'}, remote ${r ? 'ran' : 'skipped'}`);
      if (!l || !r) continue;
      // Whether the outcome is the RIGHT one is the per-mode child's check.
      // This one only says the two modes did the same thing, so its name must
      // not claim which thing: two modes that both reject a row the table says
      // resolves agree, and the line would otherwise read "both modes resolve".
      check(`${tag} both modes agree on whether onboard() resolves`, l.ok === r.ok,
        `      local ${l.ok ? 'resolved' : 'rejected'}, remote ${r.ok ? 'resolved' : 'rejected'}`);
      check(`${tag} same call sequence with the same arguments in both modes`,
        canon(l.trace) === canon(r.trace),
        `      local:  ${describe(l.trace)}\n      remote: ${describe(r.trace)}`);
      check(`${tag} same profile fields written in both modes`,
        canon(l.profileFields) === canon(r.profileFields),
        `      local:  ${canon(l.profileFields)}\n      remote: ${canon(r.profileFields)}`);
      check(`${tag} calls made for the same uid in both modes`, l.wroteUnder === r.wroteUnder,
        `      local ${l.wroteUnder}, remote ${r.wroteUnder}`);
      if (scen.ok) {
        check(`${tag} same uid outcome in both modes`, l.uidOutcome === r.uidOutcome,
          `      local ${l.uidOutcome}, remote ${r.uidOutcome}`);
        check(`${tag} same returned object in both modes, uid aside`,
          canon(l.returned) === canon(r.returned),
          `      local:  ${canon(l.returned)}\n      remote: ${canon(r.returned)}`);
      }
    }
  }

  const line = (m) => reports[m] ? `${m} ${reports[m].pass} passed, ${reports[m].fail} failed` : `${m} did not report (exit ${exits[m]})`;
  console.log(`\nOnboard contract: ${MODES.map(line).join('; ')}; cross-mode ${pass} passed, ${fail} failed`);
  // A child exits non-zero when any of its checks failed, and a missing
  // report is already a cross-mode failure, so the exit codes say the rest.
  process.exit(fail || MODES.some((m) => exits[m] !== 0) ? 1 : 0);
}
