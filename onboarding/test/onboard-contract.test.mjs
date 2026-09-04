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
// Recording. The remote branch's writes are fetch() calls, so a fetch stub
// records them (the same way remote-write-failure.test.mjs does) and answers
// in the service's real envelope. The local branch builds its Librarian
// inside server.js and exports no handle to it, so the local child registers
// onboard-contract.hooks.mjs, which swaps the toolkit host module server.js
// imports for a wrapper that returns a recording Librarian. Nothing outside
// this test changes for either mode.
//
//   node onboarding/test/onboard-contract.test.mjs
//   node onboarding/test/onboard-contract.test.mjs --mode=local   (one mode)

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const MODES = ['local', 'remote'];
const TOPIC = 'self-description';
const NOTE_OPTS = { source: 'user-explicit', topic: TOPIC };
const UID_SHAPE = /^u-[A-Za-z0-9_-]{22}$/;
const LISTED = '<a note listNotes returned>';

// ── the contract, as a table ─────────────────────────────────────────────────
// `input`   what the form (or any caller) sends to onboard().
// `uidFrom` run against the uid an earlier scenario produced.
// `failAt`  make the Nth Librarian call fail (the envelope says ok:false in
//           remote mode; the method throws in local mode).
// `written` the values the profile write must carry after normalization;
//           needs are derived from them with the same deriveDefaultNeeds.
// `calls`   the exact Librarian call sequence, in order, and nothing after.
// `uid`     'generated' (a fresh capability id) or 'same-as:<key>'.
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
    calls: ['addNote'], ok: false,
  },
  {
    key: 'profile-write-fails',
    failAt: 2,
    input: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    written: { supportAreas: ['vision'], freeText: 'I need bigger text', visionKind: 'lowVision' },
    calls: ['addNote', 'setProfileFields'], ok: false,
  },
  {
    key: 'existing-uid-restores-text',
    uidFrom: 'fresh-text',
    input: { supportAreas: ['reading'], freeText: 'back again' },
    written: { supportAreas: ['reading'], freeText: 'back again', visionKind: undefined },
    calls: ['addNote', 'setProfileFields'], uid: 'same-as:fresh-text', ok: true,
  },
  {
    key: 'clearing-delete-fails',
    uidFrom: 'fresh-text',
    failAt: 2,
    input: { supportAreas: ['reading'], freeText: '' },
    written: { supportAreas: ['reading'], freeText: '', visionKind: undefined },
    calls: ['listNotes', 'deleteNote'], ok: false,
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

  // Shared by both recorders: every Librarian call lands here, in order, and
  // `failAt` names the one call that must fail for the current scenario.
  const state = { trace: [], failAt: 0 };

  process.env.ONBOARD_MODE = mode;
  delete process.env.GEMINI_API_KEY;
  let dataDir = null;
  if (mode === 'local') {
    dataDir = mkdtempSync(path.join(tmpdir(), 'onboard-contract-'));
    process.env.DATA_DIR = dataDir;
    installLocalRecorder(state);
    const { register } = await import('node:module');
    register('./onboard-contract.hooks.mjs', import.meta.url);
  } else {
    process.env.TOOLKIT_URL = 'http://toolkit.test';
    process.env.ADMIN_PASSWORD = 'test-only-not-a-real-secret';
    installRemoteStub(state);
  }

  const { onboard, deriveDefaultNeeds } = await import('../server.js');

  const report = { mode, scenarios: [] };
  const uids = {}; // scenario key -> the uid it produced
  try {
    for (const scen of SCENARIOS) {
      const input = { ...scen.input };
      if (scen.uidFrom) input.uid = uids[scen.uidFrom];
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
        returned: outcome.ok ? { ...outcome.value, uid: undefined } : null,
      };
      report.scenarios.push(entry);
      assertScenario(mode, scen, entry, outcome, deriveDefaultNeeds);
    }
  } finally {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  }

  report.pass = pass;
  report.fail = fail;
  if (outFile) writeFileSync(outFile, JSON.stringify(report));
  console.log(`\nOnboard contract (${mode}): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
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
    return { method: c.method, args: JSON.parse(JSON.stringify(args)) };
  });
}

function uidOutcome(scen, input, uid, uids) {
  if (scen.uidFrom) return uid === uids[scen.uidFrom] ? 'same-as:' + scen.uidFrom : 'other';
  if (input.uid && uid === input.uid) return 'supplied';
  return UID_SHAPE.test(uid) ? 'generated' : 'other';
}

function expectedArgs(method, written, deriveDefaultNeeds) {
  const { supportAreas, freeText, visionKind } = written;
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

// ── local mode: a recording Librarian ────────────────────────────────────────
// onboard-contract.hooks.mjs hands every Librarian that server.js obtains to
// this function. The proxy records each method call, throws when the call is
// the one the scenario says must fail, and otherwise delegates unchanged.
function installLocalRecorder(state) {
  globalThis.__onboardContractRecord = (librarian) => new Proxy(librarian, {
    get(target, key) {
      const v = target[key];
      if (typeof key !== 'string' || typeof v !== 'function') return v;
      return async (...args) => {
        const entry = { method: key, args: structuredClone(args) };
        const n = state.trace.push(entry);
        if (state.failAt === n) throw new Error('injected failure');
        const result = await v.apply(target, args);
        if (key === 'listNotes') entry.listed = (result || []).map((x) => x.id);
        return result;
      };
    },
  });
}

// ── remote mode: a stub of the toolkit service ───────────────────────────────
// Answers in the service's real envelope (server/CONTRACT.md): a success is
// `200 {ok:true, result}`, a method that threw is `200 {ok:false, error}`.
// The failure injected here takes the second shape, because that is what an
// unreachable datastore looks like from onboarding. The stub keeps just
// enough state per uid (notes by topic, the profile, which uids hold data)
// for the scenarios above to play out the way the real service plays them.
// FLAG(review): the stub is the test's own reading of the service; a change
// in the real service's note upsert or listUsers rule would not show up here.
function installRemoteStub(state) {
  const users = new Set();
  const notes = new Map();   // uid -> [{id, text, topic}]
  const tokens = new Map();  // token -> uid
  let nextToken = 0, nextNote = 0;

  function librarian(uid, method, args) {
    const mine = notes.get(uid) || [];
    notes.set(uid, mine);
    switch (method) {
      case 'addNote': {
        const [text, opts = {}] = args;
        const body = String(text ?? '').trim();
        if (!body) return { ok: false, reason: 'empty-text' };
        const existing = mine.find((n) => n.topic === opts.topic);
        const note = existing || { id: 'note-' + (++nextNote), topic: opts.topic };
        note.text = body;
        if (!existing) mine.push(note);
        users.add(uid);
        return { ok: true, ...note };
      }
      case 'listNotes': {
        const [filter = {}] = args;
        return mine.filter((n) => !filter.topic || n.topic === filter.topic).map((n) => ({ ...n }));
      }
      case 'deleteNote': {
        const i = mine.findIndex((n) => n.id === args[0]);
        if (i < 0) return { ok: false, removed: false, reason: 'not-found' };
        mine.splice(i, 1);
        return { ok: true, removed: true };
      }
      case 'setProfileFields': {
        users.add(uid);
        return args[0];
      }
      default: return undefined;
    }
  }

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const reply = (status, obj) => ({ status, json: async () => obj });
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/admin/users')) return reply(200, { users: [...users].sort() });
    if (u.endsWith('/admin/tokens')) {
      const token = 'tok-' + (++nextToken);
      tokens.set(token, body.uid);
      return reply(200, { token, uid: body.uid });
    }
    const m = /\/v1\/librarian\/([^/?]+)$/.exec(u);
    if (!m) throw new Error('unexpected fetch: ' + u + ' ' + (opts.method || 'GET'));
    const uid = tokens.get(String(opts.headers?.authorization || '').replace(/^Bearer /, ''));
    if (!uid) return reply(401, { error: 'unauthorized' });
    const args = body.args || [];
    const entry = { method: m[1], args };
    const n = state.trace.push(entry);
    if (state.failAt === n) return reply(200, { ok: false, error: 'injected failure' });
    const result = librarian(uid, m[1], args);
    if (result === undefined) return reply(404, { error: 'unknown-method' });
    if (m[1] === 'listNotes') entry.listed = result.map((x) => x.id);
    return reply(200, { ok: true, result });
  };
}

// ── the parent: both modes, then the comparison ──────────────────────────────
function runChild(mode, outFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HERE, '--mode=' + mode, '--out=' + outFile], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env },
    });
    child.on('error', (e) => { console.log(`FAIL: could not start the ${mode} child: ${e.message}`); resolve(null); });
    child.on('exit', (code, signal) => resolve(code ?? `signal ${signal}`));
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
  const [local, remote] = MODES.map((m) => reports[m]);
  check('both modes produced a report', !!local && !!remote,
    `      exit codes: local ${exits.local}, remote ${exits.remote}`);
  if (local && remote) {
    check('both modes ran the same number of checks', local.pass + local.fail === remote.pass + remote.fail,
      `      local ${local.pass + local.fail}, remote ${remote.pass + remote.fail}`);
    for (const scen of SCENARIOS) {
      const l = local.scenarios.find((s) => s.key === scen.key);
      const r = remote.scenarios.find((s) => s.key === scen.key);
      const tag = `${scen.key}:`;
      check(`${tag} both modes ${scen.ok ? 'resolve' : 'reject'}`, l?.ok === r?.ok,
        `      local ${l?.ok ? 'resolved' : 'rejected'}, remote ${r?.ok ? 'resolved' : 'rejected'}`);
      check(`${tag} same call sequence with the same arguments in both modes`,
        canon(l?.trace) === canon(r?.trace),
        `      local:  ${describe(l?.trace || [])}\n      remote: ${describe(r?.trace || [])}`);
      check(`${tag} same profile fields written in both modes`,
        canon(l?.profileFields) === canon(r?.profileFields),
        `      local:  ${canon(l?.profileFields)}\n      remote: ${canon(r?.profileFields)}`);
      if (scen.ok) {
        check(`${tag} same uid outcome in both modes`, l?.uidOutcome === r?.uidOutcome,
          `      local ${l?.uidOutcome}, remote ${r?.uidOutcome}`);
        check(`${tag} same returned object in both modes, uid aside`,
          canon(l?.returned) === canon(r?.returned),
          `      local:  ${canon(l?.returned)}\n      remote: ${canon(r?.returned)}`);
      }
    }
  }

  const line = (m) => reports[m] ? `${m} ${reports[m].pass} passed, ${reports[m].fail} failed` : `${m} did not report (exit ${exits[m]})`;
  console.log(`\nOnboard contract: ${MODES.map(line).join('; ')}; cross-mode ${pass} passed, ${fail} failed`);
  const anyModeFailed = MODES.some((m) => !reports[m] || reports[m].fail > 0 || exits[m] !== 0);
  process.exit(fail || anyModeFailed ? 1 : 0);
}
