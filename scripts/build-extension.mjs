// Copy the toolkit modules the adapter runtime extension uses into
// extension/vendor/, at the same relative paths, so their imports resolve
// unchanged inside the unpacked extension (Chrome does not follow files
// outside the extension's folder).
//
//   node scripts/build-extension.mjs           copy
//   node scripts/build-extension.mjs --check   fail if a copy differs (CI)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

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
  'adapter-mcp/client.js',
  'adapter-mcp/registry.js',
];
const VENDOR = path.join(ROOT, 'extension', 'vendor');
const check = process.argv.includes('--check');

const stale = [];
for (const file of FILES) {
  const from = path.join(ROOT, 'toolkit', file);
  const to = path.join(VENDOR, file);
  const source = readFileSync(from);
  if (check) {
    if (!existsSync(to) || !readFileSync(to).equals(source)) stale.push(file);
    continue;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, source);
}
// Nothing else belongs in vendor/.
const listed = new Set(FILES.map(f => path.join(VENDOR, f)));
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const extra = walk(VENDOR).filter(f => !listed.has(f)).map(f => path.relative(VENDOR, f));

if (check) {
  if (stale.length || extra.length) {
    console.error(`extension/vendor is out of date: ${[...stale, ...extra.map(f => `${f} (not a toolkit file)`)].join(', ')}. Run npm run build:extension and commit the result.`);
    process.exit(1);
  }
  console.log(`extension/vendor matches the toolkit (${FILES.length} files).`);
} else {
  if (extra.length) console.warn(`Left in extension/vendor (not copied by this script): ${extra.join(', ')}`);
  console.log(`Copied ${FILES.length} toolkit modules into extension/vendor.`);
}
