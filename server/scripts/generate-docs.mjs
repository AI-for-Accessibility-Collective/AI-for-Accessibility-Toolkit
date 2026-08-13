#!/usr/bin/env node
// Regenerates server/API.md from the live route table + Librarian method
// list. Run via `npm run docs` (cwd = server/) or directly
// (`node server/scripts/generate-docs.mjs`, any cwd) — paths are resolved
// off import.meta.url, not process.cwd().

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildMeta, generateMarkdown } from '../src/meta.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const pkg = JSON.parse(readFileSync(path.join(serverDir, 'package.json'), 'utf8'));

const meta = buildMeta({ version: pkg.version });
const markdown = generateMarkdown(meta);
const outPath = path.join(serverDir, 'API.md');
writeFileSync(outPath, markdown, 'utf8');

console.log(
  `Wrote ${outPath} (${markdown.length} bytes, ${meta.librarian.methodCount} librarian methods, ` +
    `${meta.librarian.unsupportedCount} unsupported)`
);
