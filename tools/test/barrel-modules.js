// The adapter barrel (tools/adapters/index.js), read as a list of module names.
//
// Shared by adapter-conformance-test.js and registry-parity-test.js so the two
// tests agree on what "the barrel exports" means. Only `export ... from
// './x.js'` lines count: the barrel also plain-imports modules for their axe
// handlers, and those are not exports. Either quote style is accepted, so a
// formatter that switches quotes cannot silently drop a module from both tests.
//
// Not a test itself: the npm test glob is tools/test/*-test.js.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, '..', 'adapters', 'index.js');

export function readBarrelModules() {
  const src = readFileSync(BARREL, 'utf8');
  return [...new Set(
    [...src.matchAll(/^export\s[^;]*?from\s+['"]\.\/([^'"]+)\.js['"]/gm)].map((m) => m[1]),
  )];
}
