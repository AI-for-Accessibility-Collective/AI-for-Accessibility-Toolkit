// Pack-fixture test: prove what a consumer of the published packages would
// actually receive. Packs @ai4a11y/toolkit and @ai4a11y/tools with `npm pack`,
// installs the tarballs into a scratch project, and imports the real consumer
// surface through public specifiers only. In-repo tests resolve against the
// working tree, so they cannot catch a file missing from `files` or a subpath
// missing from `exports`; this is the only check that can.
//
// The asserted surface is the one the extension repository's builds use
// (josifiin/AI-for-Accessibility-Extension#2). If an assertion here blocks a
// change, the consumer needs updating in the same breath.
//
// The second half typechecks two small consumer files against the installed
// toolkit tarball with the repository's pinned tsc: one that calls
// createToolkit with wrong shapes and must fail, one that calls it correctly
// and must pass. That is the proof the shipped declarations travel with the
// package and describe the real API, which the import checks above cannot
// give (they prove the exports exist, not their shapes).
//
// Run from the repository root, after `npm ci`: node scripts/pack-fixture-test.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'ai4a11y-pack-'));

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
}

// The repository's own tsc (root devDependency, pinned), not a download: the
// version that emitted toolkit/types/ is the version that checks against it.
const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error('pack-fixture-test: typescript is not installed; run `npm ci` at the repository root first');
  process.exit(1);
}

// Typecheck one consumer file inside the scratch project. Returns the tsc
// exit code and its output; a non-zero code with no `error TS` line means
// tsc itself failed to run, which the caller treats as a fixture bug.
function typecheck(consumer, file) {
  const args = [
    tsc, '--noEmit', '--strict', '--allowJs', '--checkJs',
    '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022',
    '--lib', 'es2022', '--skipLibCheck', '--pretty', 'false',
    file,
  ];
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { cwd: consumer, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

try {
  // 1. Pack both packages. `npm pack` works on private packages; only
  //    `npm publish` is blocked by "private": true.
  const tarballs = [];
  for (const dir of ['toolkit', 'tools']) {
    const out = run('npm', ['pack', '--pack-destination', tmp, '--silent'], path.join(repoRoot, dir));
    tarballs.push(path.join(tmp, out.trim().split('\n').pop()));
  }

  // 2. Install the tarballs into a scratch consumer. Offline: no registry deps.
  const consumer = path.join(tmp, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'fixture-consumer', private: true, type: 'module' }, null, 2)
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', ...tarballs], consumer);

  // 3. The checks, written as a file so every import resolves the way a real
  //    consumer's would: from inside the scratch project, through node_modules.
  writeFileSync(path.join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const failures = [];
async function check(name, fn) {
  try { await fn(); } catch (e) { failures.push(name + ': ' + e.message); }
}

// Toolkit surface the personalized extension's build.js uses.
await check('toolkit barrel', async () => {
  const m = await import('@ai4a11y/toolkit');
  assert.ok(Object.keys(m).length > 0, 'empty barrel');
});
await check('core/skill parseSkill', async () => {
  const m = await import('@ai4a11y/toolkit/core/skill');
  assert.equal(typeof m.parseSkill, 'function');
});
await check('registry', async () => {
  const m = await import('@ai4a11y/toolkit/registry');
  assert.ok(Object.keys(m).length > 0, 'empty registry module');
});
await check('platforms/chrome entry files', () => {
  for (const name of ['taxonomy', 'datastore', 'librarian', 'web-surface']) {
    const resolved = require.resolve('@ai4a11y/toolkit/platforms/chrome/' + name + '.entry.js');
    assert.ok(existsSync(resolved), name + '.entry.js resolved but missing on disk');
  }
});
await check('skills/builtin shipped as files', async () => {
  const pkgRoot = path.dirname(require.resolve('@ai4a11y/toolkit/package.json'));
  const skillsDir = path.join(pkgRoot, 'skills', 'builtin');
  const mds = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
  assert.ok(mds.length >= 4, 'expected at least 4 skill files, found ' + mds.length);
  const { parseSkill } = await import('@ai4a11y/toolkit/core/skill');
  const parsed = parseSkill(readFileSync(path.join(skillsDir, mds[0]), 'utf8'));
  assert.ok(parsed && typeof parsed === 'object', 'parseSkill failed on shipped skill');
});

// Tools surface both extensions' builds use.
await check('tools adapter barrel', async () => {
  const m = await import('@ai4a11y/tools/adapters/index.js');
  assert.ok(Object.keys(m).length >= 49, 'adapter barrel too small: ' + Object.keys(m).length);
  for (const name of ['DarkMode', 'FocusMode', 'ReaderMode', 'VoiceCommands', 'axeHandlers', 'fixLowContrast']) {
    assert.ok(name in m, 'adapter barrel missing ' + name);
  }
});
await check('tools root barrel', async () => {
  const m = await import('@ai4a11y/tools');
  assert.ok(Object.keys(m).length > 0, 'empty tools barrel');
});
await check('profiles with JSON import attribute', async () => {
  const m = await import('@ai4a11y/tools/profiles/settings.js');
  assert.ok(m.profiles && Object.keys(m.profiles).length >= 12, 'profiles missing or short');
});
await check('deep tool imports', async () => {
  for (const spec of [
    '@ai4a11y/tools/adapters/_primitives.js',
    '@ai4a11y/tools/auditors/contract-mismatch.js',
    '@ai4a11y/tools/auditors/wcag-issues.js',
    '@ai4a11y/tools/auditors/missing-alt.js',
    '@ai4a11y/tools/auditors/missing-labels.js',
    '@ai4a11y/tools/validators/reader.js',
    '@ai4a11y/tools/validators/aria-parse.js',
    '@ai4a11y/tools/validators/count-first.js',
    '@ai4a11y/tools/utils/ai.js',
    '@ai4a11y/tools/utils/dom.js',
  ]) {
    await import(spec);
  }
});

// Negative checks: test directories must not ship. Checked on disk, not with
// require.resolve: neither package exports ./test/*, so resolution fails with
// ERR_PACKAGE_PATH_NOT_EXPORTED even when the files ARE in the tarball, which
// would make a resolve-based check pass vacuously.
await check('test dirs excluded', () => {
  const roots = {
    '@ai4a11y/toolkit': path.dirname(require.resolve('@ai4a11y/toolkit/package.json')),
    '@ai4a11y/tools': path.dirname(require.resolve('@ai4a11y/tools/constants.js')),
  };
  for (const [name, root] of Object.entries(roots)) {
    assert.ok(!existsSync(path.join(root, 'test')), name + ' shipped its test/ directory');
  }
});

if (failures.length) {
  console.error('PACK FIXTURE FAILURES:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('pack fixture: all consumer-surface checks passed');
`);
  run('node', ['check.mjs'], consumer);

  // 4. The shapes travel. Both files are checked JavaScript, the way the
  //    extension repository consumes the toolkit, so what fails here fails
  //    for it too. tsc resolves '@ai4a11y/toolkit' through the tarball's
  //    exports map `types` conditions; if those were missing, the RIGHT file
  //    would fail on an unresolved module, so it also guards the manifest.
  writeFileSync(path.join(consumer, 'types-right.js'), `// @ts-check
import { createToolkit } from '@ai4a11y/toolkit';
import { parseSkill } from '@ai4a11y/toolkit/core/skill';
import { renderXRSettings } from '@ai4a11y/toolkit/surfaces/xr';

/** @type {import('@ai4a11y/toolkit').KVStore} */
const kv = {
  get: async () => undefined,
  set: async () => {},
  getAll: async () => ({}),
};
const { librarian, datastore } = createToolkit({ kv, clock: { now: () => 0 } });
await datastore.runMigrations();
const model = await librarian.getAbilityModel();
const xr = renderXRSettings(model, { fovDegrees: 90 });
const skill = parseSkill('---\\nname: demo\\n---\\n');
export const summary = { angular: xr.text.angularSizeDeg, needs: model.needs.length, name: skill.name };
`);

  // Each statement below is one wrong call. The expected error count is the
  // number of statements, so a stray error elsewhere (say, a declaration
  // that stopped resolving) would also be caught as a mismatch.
  const wrongCalls = [
    // kv is required
    "createToolkit({});",
    // a KVStore needs set and getAll, not only get
    "createToolkit({ kv: { get: async () => undefined } });",
    // a Clock returns a number
    "createToolkit({ kv, clock: { now: () => 'soon' } });",
    // a surface renders an AbilityModel, not a bare string
    "renderXRSettings('vision');",
  ];
  writeFileSync(path.join(consumer, 'types-wrong.js'), `// @ts-check
import { createToolkit } from '@ai4a11y/toolkit';
import { renderXRSettings } from '@ai4a11y/toolkit/surfaces/xr';

/** @type {import('@ai4a11y/toolkit').KVStore} */
const kv = { get: async () => undefined, set: async () => {}, getAll: async () => ({}) };
${wrongCalls.join('\n')}
`);

  const right = typecheck(consumer, 'types-right.js');
  if (right.code !== 0) {
    console.error('PACK FIXTURE FAILURE: a correct call against the packed toolkit did not typecheck:');
    console.error(right.out);
    process.exit(1);
  }
  const wrong = typecheck(consumer, 'types-wrong.js');
  const errorLines = wrong.out.split('\n').filter((l) => /error TS\d+/.test(l));
  if (wrong.code === 0 || errorLines.length !== wrongCalls.length) {
    console.error('PACK FIXTURE FAILURE: expected exactly ' + wrongCalls.length
      + ' type errors from wrong calls against the packed toolkit, got ' + errorLines.length + ':');
    console.error(wrong.out);
    process.exit(1);
  }
  console.log('pack fixture: shipped declarations reject ' + wrongCalls.length + ' wrong calls and accept a right one');
  console.log('pack-fixture-test: PASS');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
