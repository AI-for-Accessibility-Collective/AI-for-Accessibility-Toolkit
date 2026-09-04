// Pack-fixture test: prove what a consumer of the published packages would
// actually receive. Packs @ai4a11y/toolkit and @ai4a11y/tools with `npm pack`,
// installs the tarballs into a scratch project, and imports the real consumer
// surface through public specifiers only. In-repo tests resolve against the
// working tree, so they cannot catch a file missing from `files` or a subpath
// missing from `exports`; this is the only check that can.
//
// The asserted surface is the one the extension repository's builds use
// (josifiin/AI-for-Accessibility-Extension#2), plus the node reference port
// modules server/src imports. If an assertion here blocks a change, the consumer
// needs updating in the same breath.
//
// Run from the repository root: node scripts/pack-fixture-test.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'ai4a11y-pack-'));

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
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
await check('platforms/node reference ports', async () => {
  // server/src embeds the core over kv.js and ports.js; an installer of the
  // package must be able to reach them the same way (see
  // scripts/import-boundaries-test.mjs). shared-store.js is the third port
  // module in that directory and is listed with them.
  const ports = await import('@ai4a11y/toolkit/platforms/node/ports.js');
  assert.equal(typeof ports.nodeClock, 'function');
  const kv = await import('@ai4a11y/toolkit/platforms/node/kv.js');
  assert.equal(typeof kv.memoryKV, 'function');
  const shared = await import('@ai4a11y/toolkit/platforms/node/shared-store.js');
  assert.equal(typeof shared.fileSharedStore, 'function');
});
await check('platforms/node/host.js stays out of exports', () => {
  // FLAG(review): host.js is the runnable demo (npm run demo:node). It calls
  // main() and process.exit() when imported, so the exports map names the
  // three port modules one by one instead of a platforms/node/*.js pattern.
  // The file still ships in the tarball (files: platforms/); it is only not
  // resolvable through the package name.
  assert.throws(() => require.resolve('@ai4a11y/toolkit/platforms/node/host.js'),
    (e) => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
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
  console.log('pack-fixture-test: PASS');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
