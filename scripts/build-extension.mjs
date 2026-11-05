// Copy the toolkit modules the adapter runtime extension uses into
// extension/vendor/, at the same relative paths, so their imports resolve
// unchanged inside the unpacked extension (Chrome does not follow files
// outside the extension's folder). Also axe-core, the copy the CLI pins
// (cli/axe-core.min.js), which the sidebar's previews run in the page, and
// the building blocks (toolkit/blocks) bundled into one script,
// vendor/blocks.js, which the runtime injects before each adapter: user
// scripts cannot import.
//
//   node scripts/build-extension.mjs           copy
//   node scripts/build-extension.mjs --check   fail if a copy differs (CI)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILES = [
  'protocol/adapter/index.js',
  'protocol/adapter/descriptor.js',
  'protocol/adapter/schema.js',
  'protocol/adapter/canonical.js',
  'protocol/adapter/match.js',
  'protocol/adapter/wire.js',
  'protocol/adapter/package.js',
  'protocol/adapter/registry.js',
  'protocol/adapter/profile.js',
  'protocol/adapter/access.js',
  'protocol/adapter/page-types.js',
  'adapter-mcp/client.js',
  'adapter-mcp/registry.js',
  // The person's settings for the blocks, as the web surface derives them.
  'blocks/personal.js',
  'blocks/personal-sites.js',
  'blocks/shortcut.js',
  'core/ability.js',
  'core/strength.js',
  'core/units.js',
  'core/surface.js',
  'platforms/chrome/web-surface.js',
];
const VENDOR = path.join(ROOT, 'extension', 'vendor');
// Other files, as [source under the repository, path under vendor/].
const OTHER = [['cli/axe-core.min.js', 'axe-core.min.js']];
// Bundles, as [entry under the repository, path under vendor/].
const BUNDLES = [['toolkit/blocks/runtime.js', 'blocks.js']];
const COPIES = [...FILES.map(f => [path.join('toolkit', f), f]), ...OTHER, ...BUNDLES];
const check = process.argv.includes('--check');

function bundle(entry) {
  const out = buildSync({
    entryPoints: [path.join(ROOT, entry)], absWorkingDir: ROOT, bundle: true, format: 'iife', write: false, charset: 'utf8', legalComments: 'none',
    banner: { js: `// Generated from ${entry} by scripts/build-extension.mjs: do not edit.` },
  });
  return Buffer.from(out.outputFiles[0].text);
}

const stale = [];
for (const [origin, file] of COPIES) {
  const from = path.join(ROOT, origin);
  const to = path.join(VENDOR, file);
  const source = BUNDLES.some(([b]) => b === origin) ? bundle(origin) : readFileSync(from);
  if (check) {
    if (!existsSync(to) || !readFileSync(to).equals(source)) stale.push(file);
    continue;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, source);
}
// Nothing else belongs in vendor/.
const listed = new Set(COPIES.map(([, f]) => path.join(VENDOR, f)));
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const extra = walk(VENDOR).filter(f => !listed.has(f)).map(f => path.relative(VENDOR, f));

if (check) {
  if (stale.length || extra.length) {
    console.error(`extension/vendor is out of date: ${[...stale, ...extra.map(f => `${f} (not a toolkit file)`)].join(', ')}. Run npm run build:extension and commit the result.`);
    process.exit(1);
  }
  console.log(`extension/vendor matches the toolkit (${COPIES.length} files).`);
} else {
  if (extra.length) console.warn(`Left in extension/vendor (not copied by this script): ${extra.join(', ')}`);
  console.log(`Copied ${COPIES.length} files into extension/vendor.`);
}
