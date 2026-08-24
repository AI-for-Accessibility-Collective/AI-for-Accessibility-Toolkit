#!/usr/bin/env node
// toolkit/scripts/generate-skill.mjs — renders the SAME introspect.mjs model
// (plus server/CONTRACT.md's route table) to
// .claude/skills/ai4a11y-toolkit/SKILL.md, so an agent working in this repo
// (or a consumer repo that vendors the skill) knows how to embed the
// toolkit, call its API, implement a host port, or talk to the hosted
// service — without re-deriving any of it from source. Deterministic, same
// as generate-api-docs.mjs: no timestamps, same model in, byte-identical
// Markdown out.
//
//   node toolkit/scripts/generate-skill.mjs

import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel } from './introspect.mjs';
import { QUICK_START_CODE } from './generate-api-docs.mjs';
import { renderMethodGroups, renderPorts } from './render-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_ROOT = path.join(__dirname, '..');       // toolkit/
const REPO_ROOT = path.join(TOOLKIT_ROOT, '..');        // repo root
const SKILL_DIR = path.join(REPO_ROOT, '.claude', 'skills', 'ai4a11y-toolkit');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');
const CONTRACT_PATH = path.join(REPO_ROOT, 'server', 'CONTRACT.md');

// A fixed, hand-authored 3-sentence identity blurb (per the mission: "from a
// template" — this is editorial prose about what the toolkit IS, not a
// method description, so it is not extracted from source like the tables
// below are).
const WHAT_IS_IT = `The AI for Accessibility Toolkit is a platform-agnostic core (a Librarian personal-memory/profile agent plus a Datastore) that turns per-app accessibility settings into one portable, consent-gated understanding of a person's needs — the \`AbilityModel\` — shared across web, XR, and mobile hosts. A host wires a small set of injected ports (\`KVStore\`, \`Clock\`, \`Scheduler\`, \`Consent\`, ...) into \`createToolkit(...)\` and gets back a \`{ datastore, librarian }\` pair; every write an inference could be wrong about goes through the same proposal/consent machinery, never silently. Surface renderers (\`toolkit/surfaces/*.js\`) turn the same \`AbilityModel\` into platform-specific settings, and a hosted HTTP service (see below) lets non-JS clients call the same Librarian methods remotely.`;

/** Pull the section starting at a heading line matched by `headingPred`
 *  through (but not including) the next `##` heading. Returns null if not
 *  found — the caller decides how to degrade (this generator never invents
 *  contract text it couldn't read). */
function extractSection(md, headingPred) {
  const lines = md.split('\n');
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && /^##\s/.test(lines[i]) && headingPred(lines[i])) { start = i; continue; }
    if (start !== -1 && i > start && /^##\s/.test(lines[i])) { end = i; break; }
  }
  if (start === -1) return null;
  return lines.slice(start, end).join('\n').trim();
}

/** The `- Auth: ...` bullet under `## Base`, including its indented
 *  continuation lines (CONTRACT.md wraps it across 3 lines) — stops at the
 *  next bullet or a blank line. */
function extractAuthLine(contractMd) {
  const lines = contractMd.split('\n');
  const idx = lines.findIndex((l) => /^- Auth:/.test(l));
  if (idx === -1) return null;
  const collected = [lines[idx].replace(/^- Auth:\s*/, '')];
  let i = idx + 1;
  while (i < lines.length && lines[i].trim() && !/^- /.test(lines[i])) {
    collected.push(lines[i].trim());
    i++;
  }
  return collected.join(' ');
}

function buildServiceMappingSection() {
  let contractMd;
  try {
    contractMd = readFileSync(CONTRACT_PATH, 'utf8');
  } catch {
    return '_(server/CONTRACT.md not found at generation time — regenerate once it exists.)_';
  }
  const authLine = extractAuthLine(contractMd);
  const endpoints = extractSection(contractMd, (l) => l.trim() === '## Endpoints');
  const methodMapping = extractSection(contractMd, (l) => l.includes('/v1/librarian/{method}'));
  return [
    authLine ? `**Auth:** ${authLine}` : '',
    endpoints || '_(no `## Endpoints` section found in server/CONTRACT.md)_',
    methodMapping || '_(no `/v1/librarian/{method}` section found in server/CONTRACT.md)_',
  ].filter(Boolean).join('\n\n');
}

/** "Run your own service" section — every fact is read live from server/
 *  sources (env vars from actual process.env.* references, scripts from
 *  server/package.json) so the section can't drift from the code. */
function buildServerDevSection() {
  const serverDir = path.join(REPO_ROOT, 'server');
  let envVars = [];
  let scripts = {};
  try {
    const srcFiles = ['index.js', ...readdirSync(path.join(serverDir, 'src')).map((f) => `src/${f}`)];
    const seen = new Set();
    for (const f of srcFiles) {
      const src = readFileSync(path.join(serverDir, f), 'utf8');
      for (const m of src.matchAll(/process\.env\.([A-Z_]+)/g)) seen.add(m[1]);
    }
    envVars = [...seen].sort();
    scripts = JSON.parse(readFileSync(path.join(serverDir, 'package.json'), 'utf8')).scripts || {};
  } catch {
    return '_(server/ not found at generation time — regenerate from a full checkout.)_';
  }
  const scriptLines = Object.entries(scripts).map(([k, v]) => `- \`npm run ${k}\` — \`${v}\``).join('\n');
  return `The reference service in \`server/\` is a zero-dependency \`node:http\` app that embeds the toolkit through its public barrel — it is both the hosted deployment and the template for running your own instance.

**Run locally** (file-backed storage, no cloud account needed):

\`\`\`bash
DATA_DIR=./data ADMIN_PASSWORD=dev PORT=8080 node server/index.js
# mint a token:  curl -X POST localhost:8080/admin/tokens \\
#   -H 'Authorization: Bearer dev' -H 'content-type: application/json' \\
#   -d '{"uid":"me","label":"dev"}'
\`\`\`

**Environment variables** (parsed from the server source at doc-generation time): ${envVars.map((v) => `\`${v}\``).join(', ')}. \`TOOLKIT_BUCKET\` switches storage from the \`DATA_DIR\` file backend to GCS; \`GEMINI_API_KEY\` enables the server-side LLM lane (\`extract\`/\`reflect\`/\`buildSkill\`/\`interpretNeedsPrompt\`) so clients never need a key; \`ADMIN_PASSWORD\` (a generated 16-character password) guards \`/admin\` (token management UI + CRUD).

**npm scripts** (\`server/package.json\`):
${scriptLines}

**Deploying**: \`server/Dockerfile\` builds from the repo root (it copies \`toolkit/\` + \`server/\`); \`cloudbuild.yaml\` + \`server/DEPLOYMENT.md\` document the Cloud Run deployment (small instance, Secret Manager for the two secrets, GCS bucket, IAM). \`server/API.md\` is generated from the route table (\`npm run docs\` in \`server/\`) and the live service serves the same data at \`GET /v1/meta\`. Liveness: use \`/v1/healthz\` (bare \`/healthz\` is intercepted at the run.app edge).

**Extending the wire surface**: add a route entry in \`server/src/routes.js\` (plain \`{route, target, kind}\`, or a custom \`invoke\` for arg-shape dispatch — see \`setPause\`), then regenerate docs and update the oracle list in \`server/test/server-test.mjs\`. A remote-mode host wraps these routes in a Librarian-shaped facade.`;
}

const ADD_SKILL_SECTION = `This skill ships **inside the toolkit repo** at \`.claude/skills/ai4a11y-toolkit/SKILL.md\`, so anyone opening this repo in Claude Code gets it automatically. To use it from **your own project**:

\`\`\`bash
mkdir -p .claude/skills
cp -r <path-to-toolkit-repo>/.claude/skills/ai4a11y-toolkit .claude/skills/
\`\`\`

Claude Code discovers project skills in \`.claude/skills/\` on the next session. If you vendor or depend on the toolkit, re-copy after upgrades (the file is generated from the toolkit source, so it always matches the version you copied it from — check the "Regenerate" line at the bottom to rebuild it against your checkout).`;

export function renderSkillMd(model) {
  const serviceMapping = buildServiceMappingSection();
  const serverDev = buildServerDevSection();
  return `---
name: ai4a11y-toolkit
description: Use when embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), talking to the hosted toolkit HTTP service, or running/deploying your own toolkit service instance.
---

# AI for Accessibility Toolkit

${WHAT_IS_IT}

This file is **generated** by \`toolkit/scripts/generate-skill.mjs\` from the same introspected model as \`toolkit/API.md\` — do not hand-edit; see "Regenerate" at the bottom.

## Quick Start

Paths below are relative to the \`toolkit/\` package root (run from there, or adjust the specifiers when importing as a published \`@a11y-toolkit/core\` dependency).

\`\`\`javascript
${QUICK_START_CODE}\`\`\`

## Methods by Concern

Read directly off a live \`createToolkit(...)\` instance — call as \`toolkit.librarian.<method>(...)\` / \`toolkit.datastore.<method>(...)\`.

${renderMethodGroups(model.methodGroups)}

## Ports contract

A host implements these to construct a toolkit instance (\`createToolkit({ kv, clock, scheduler, consent, demo, ... })\`) and, separately, \`ActuationPort\` for voice/agent control surfaces.

${renderPorts(model.ports)}

## Talking to the hosted service instead

Instead of embedding the toolkit in-process, a client can call a hosted instance over HTTP — same Librarian methods, one call per method, behind a bearer token. Full wire contract: \`server/CONTRACT.md\`.

${serviceMapping}

## Connecting to a hosted instance (URL + token)

The repo intentionally contains **no live instance URL and no tokens** (client
config never belongs in version control). For scripts/agents, configuration
lives in the project's untracked \`.env\` at the repo root:

\`\`\`bash
TOOLKIT_SERVER_URL=https://<your-instance>     # ask a maintainer, or your own deployment
TOOLKIT_SERVER_TOKEN=aat_...                   # UID-bound access token, minted on the instance's /admin page
\`\`\`

**When a task needs the hosted service, do this first:**

1. Check \`.env\` for \`TOOLKIT_SERVER_URL\` / \`TOOLKIT_SERVER_TOKEN\`.
2. If either is missing, **ask the user** for it (the URL comes from a
   maintainer or their own deployment; a token is minted on the instance's
   \`/admin\` page — browser login popup) and **offer to write both into
   \`.env\`** — create the file if needed, and confirm \`.env\` is gitignored
   *before* writing (\`git check-ignore .env\`).
3. Read the values from \`.env\` at run time — never hardcode them in code,
   commits, or generated files, and never echo the token back into output.
4. Verify the connection: \`GET $TOOLKIT_SERVER_URL/v1/whoami\` with
   \`Authorization: Bearer $TOOLKIT_SERVER_TOKEN\` returns the token's
   \`{uid, label}\`.

The browser extension does **not** use \`.env\` — its equivalent config is the
extension's Options page (stored in \`chrome.storage.sync\` as
\`toolkitServerUrl\` / \`toolkitServerToken\`).

## Running or deploying your own toolkit service

${serverDev}

## Adding this skill to your project

${ADD_SKILL_SECTION}

---

Regenerate with: \`npm run docs\` (from \`toolkit/\`). Full reference (surfaces, protocol schemas, barrel exports): \`toolkit/API.md\`.
`;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const model = await buildModel();
  const md = renderSkillMd(model);
  mkdirSync(SKILL_DIR, { recursive: true });
  writeFileSync(SKILL_PATH, md, 'utf8');
  process.stdout.write(`Wrote ${SKILL_PATH} (${md.length} bytes)\n`);
}
