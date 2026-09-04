#!/usr/bin/env node
// toolkit/scripts/generate-api-docs.mjs — renders the introspect.mjs model to
// toolkit/API.md: a concise, generated reference (never hand-edited — see
// the "regenerate with" line at the bottom of the output). Deterministic:
// same model in, byte-identical Markdown out, every run (no timestamps).
//
//   node toolkit/scripts/generate-api-docs.mjs
//
// QUICK_START_CODE below is exported so generate-skill.mjs can reuse the
// exact same snippet in SKILL.md, and so toolkit/test/api-docs-test.js can
// extract + actually execute it (the markers
// `<!-- QUICKSTART:START -->` / `<!-- QUICKSTART:END -->` bound the fenced
// block in the rendered Markdown for that extraction).

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel } from './introspect.mjs';
import { renderMethodGroups, renderPorts, renderSurfaces, renderProtocol, renderBarrel, slugify } from './render-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..'); // toolkit/

// A self-contained smoke test of createToolkit on the node reference
// adapters (toolkit/platforms/node/*) — imports are relative to toolkit/,
// which is where the conformance test places this snippet before running
// it. Throws (non-zero exit) on any failed assertion.
export const QUICK_START_CODE = `import { createToolkit } from './index.js';
import { memoryKV } from './platforms/node/kv.js';
import { nodeClock, nodeScheduler, consoleConsent } from './platforms/node/ports.js';

const { datastore, librarian } = createToolkit({
  kv: memoryKV(),
  clock: nodeClock(),
  scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
});

await datastore.runMigrations();
await librarian.setProfileField('supportAreas', ['vision']);
await librarian.setProfileField('fields.needs', [
  { dimension: 'textSize', value: 1.4, strength: 'preference', source: 'onboarding' },
]);

const model = await librarian.getAbilityModel();
if (!model.supportAreas.includes('vision')) {
  throw new Error('Quick Start failed: supportAreas was not written');
}
if (!model.needs.some((n) => n.dimension === 'textSize' && n.value === 1.4)) {
  throw new Error('Quick Start failed: needs[] was not written');
}

console.log('Quick Start OK:', JSON.stringify(model));
`;

function renderToc(model) {
  const lines = [
    '- [Quick Start](#quick-start)',
    '- [Methods by Concern](#methods-by-concern)',
  ];
  for (const g of model.methodGroups) lines.push(`  - [${g.concern}](#${slugify(g.concern)})`);
  lines.push('- [Ports](#ports)', '- [Surfaces](#surfaces)', '- [Protocol](#protocol)', '- [Barrel Exports](#barrel-exports-toolkitindexjs)');
  return lines.join('\n');
}

export function renderApiMd(model) {
  return `# Toolkit API Reference

**Generated** from the toolkit source by \`toolkit/scripts/generate-api-docs.mjs\`
(reading \`toolkit/scripts/introspect.mjs\`'s model). Do not hand-edit — see
"Regenerate" at the bottom.

## Table of Contents

${renderToc(model)}

## Quick Start

\`createToolkit\` wired to the plain-Node reference adapters (\`toolkit/platforms/node/\`) — the template a new JS-runtime host (iOS/React Native bridge, XR runtime, a server) copies.

<!-- QUICKSTART:START -->
\`\`\`javascript
${QUICK_START_CODE}\`\`\`
<!-- QUICKSTART:END -->

## Methods by Concern

Every method below was read off a REAL \`createToolkit(...)\` instance at doc-generation time — none of this is hand-transcribed, so it cannot drift from what is actually callable. \`owner\` is \`librarian\` or \`datastore\` — call as \`toolkit.librarian.<method>(...)\` / \`toolkit.datastore.<method>(...)\` from the object \`createToolkit\` returns.

${renderMethodGroups(model.methodGroups)}

## Ports

The interfaces a host supplies to \`createToolkit({ kv, clock, scheduler, consent, demo, ... })\`, plus the separate \`ActuationPort\` (\`toolkit/ports/actuation.js\`) a host wires for voice/agent control surfaces. Read off the JSDoc \`@typedef\`/\`@property\` blocks in \`toolkit/ports/index.js\` and \`toolkit/ports/actuation.js\`.

${renderPorts(model.ports)}

## Surfaces

Pure functions that render the SAME \`AbilityModel\` (\`librarian.getAbilityModel()\`) into a platform's own settings vocabulary. Adding a new platform means adding a new \`toolkit/surfaces/*.js\` file with this shape — this table picks it up automatically on the next \`npm run docs\`.

${renderSurfaces(model.surfaces)}

## Protocol

The versioned JSON Schemas in \`toolkit/protocol/\` describing the toolkit's cross-app wire formats (profile blob, insight outbox, shared-transport envelope) — for a non-JS conformer implementing the same contract.

${renderProtocol(model.protocol)}

## Barrel Exports (\`toolkit/index.js\`)

Everything importable from \`@a11y-toolkit/core\` (the package root).

${renderBarrel(model.barrelExports)}

---

Regenerate with: \`npm run docs\` (from \`toolkit/\`).
`;
}

// Compare filesystem paths, not URL strings: import.meta.url is
// percent-encoded (spaces, ~) so a raw `file://` + argv comparison fails on
// paths like an iCloud checkout. fileURLToPath decodes both to the same form.
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const model = await buildModel();
  const md = renderApiMd(model);
  writeFileSync(path.join(ROOT, 'API.md'), md, 'utf8');
  process.stdout.write(`Wrote ${path.join(ROOT, 'API.md')} (${md.length} bytes)\n`);
}
