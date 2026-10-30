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
import { QUICK_START_CODE, PACKAGE_NAME } from './generate-api-docs.mjs';
import { renderMethodGroups, renderPorts } from './render-lib.mjs';
import { PROFILE_NAME, PROFILE_VERSION, MCP_PROTOCOL_VERSION, TOOL_DESCRIPTIONS, REGISTRY_TOOL_DESCRIPTIONS, WEB_MODULE, BROWSER_RUNTIME_APP } from '../protocol/adapter/index.js';
import * as adapterMcp from '../adapter-mcp/index.js';

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
ADMIN_PASSWORD=dev npm run dev:workshop      # from the repo root; --workshop lets any local page call /v1
# make an account (or use the admin console at http://localhost:8080/admin):
#   curl -X POST localhost:8080/admin/accounts -H 'Authorization: Bearer dev' \\
#     -H 'content-type: application/json' -d '{"uid":"me"}'      # → 201 {account, password}
# then sign in at http://localhost:8080/developer for the default token
\`\`\`

For a workshop, the admin console's **Fill in team-1 … team-10** makes a batch
of accounts and shows each password once (print or copy them then).

**Environment variables** (parsed from the server source at doc-generation time): ${envVars.map((v) => `\`${v}\``).join(', ')}. \`TOOLKIT_BUCKET\` switches storage from the \`DATA_DIR\` file backend to GCS; \`GEMINI_API_KEY\` enables the server-side LLM lane (\`extract\`/\`reflect\`/\`buildSkill\`/\`interpretNeedsPrompt\`) so clients never need a key; \`ADMIN_PASSWORD\` (a generated 16-character password) guards \`/admin\` (the admin console: developer accounts and tokens); \`TOKEN_SECRET\` derives each account's default token (it falls back to \`ADMIN_PASSWORD\`; when the secret in use changes, each account gets a new default token at its next sign-in and apps need the new one).

**npm scripts** (\`server/package.json\`):
${scriptLines}

**Deploying**: \`server/Dockerfile\` builds from the repo root (it copies \`toolkit/\` + \`server/\`); \`cloudbuild.yaml\` + \`server/DEPLOYMENT.md\` document the Cloud Run deployment (small instance, Secret Manager for the secrets, GCS bucket, IAM). Keep \`--max-instances 1\` (connected Adapter MCP apps live in the process's memory, so a second instance would report them offline), \`--timeout 3600\` (each connected app holds one long server-sent-event request), and \`CORS_ORIGINS=*\` when browser apps on other origins must connect (\`/v1\` accepts bearer tokens only, never cookies). Everything else — accounts, tokens, profiles, presets, each account's last 200 MCP calls — is in the store and survives a restart. Logs are structured JSON on Cloud Run (requests, sign-ins, account and token changes, apps connecting, MCP calls, errors with stacks; never passwords, tokens or profile content); DEPLOYMENT.md shows routing them to a 365-day log bucket. \`server/API.md\` is generated from the route table (\`npm run docs\` in \`server/\`) and the live service serves the same data at \`GET /v1/meta\`. Liveness: use \`/v1/healthz\` (bare \`/healthz\` is intercepted at the run.app edge).

**Extending the wire surface**: add a route entry in \`server/src/routes.js\` (plain \`{route, target, kind}\`, or a custom \`invoke\` for arg-shape dispatch — see \`setPause\`), then regenerate docs and update the oracle list in \`server/test/server-test.mjs\`. A remote-mode host wraps these routes in a Librarian-shaped facade.`;
}

/** "Sharing adapters" — the version numbers, tool names and SDK exports are
 *  read from the protocol and SDK modules, so they cannot drift. */
function buildAdapterMcpSection() {
  const registryTools = Object.entries(REGISTRY_TOOL_DESCRIPTIONS).map(([name, text]) => `- \`${name}\` — ${text}`).join('\n');
  const tools = Object.entries(TOOL_DESCRIPTIONS).map(([name, text]) => `- \`${name}\` — ${text}`).join('\n');
  const helpers = ['createRegistryClient', 'loadInstalledAdapters', 'defineDescriptor', 'lintWebModule', 'createAdapterProvider', 'fromToggleAdapter', 'fromAction', 'connectToToolkit', 'detectBrowserPlatform', 'createMcpClient', 'adapterClient', 'catalogDescriptors']
    .filter((name) => typeof adapterMcp[name] === 'function');
  return `**Adapter MCP** (profile \`${PROFILE_NAME}\` \`${PROFILE_VERSION}\`, on MCP \`${MCP_PROTOCOL_VERSION}\`) is how apps built with the toolkit **share adapters**: the toolkit service is an MCP server (the adapter registry, \`/v1/mcp\`) where an app publishes its adapters and other apps find and install them. A pre-alpha draft — the wire shapes can still change, and the adapters it carries are not validated with the people they are meant for, so treat what you build as a prototype. Design: \`docs/design/adapter-mcp.md\` (§14 is the registry); SDK guide: \`toolkit/adapter-mcp/README.md\`; wire checks: \`toolkit/protocol/adapter/\`.

**What gets shared.** An adapter is \`{owner, appId, id}\` (owner = the publishing account). A portable one carries a \`${WEB_MODULE}\` package: one self-contained JavaScript file exporting an object with \`enable(options)\` and \`disable()\` (disable puts the page back), no \`import\`s, no network, no eval (\`lintWebModule\` says what is refused). Without a package it is a description only (XR, native). Each publish is a new revision; the registry computes \`executionArtifactDigest\` and \`descriptorDigest\`. **Private until the owner shares it**; installing your own follows the latest revision, installing someone else's pins the revision you chose.

\`\`\`javascript
const { createRegistryClient, loadInstalledAdapters, defineDescriptor } =
  await import(\`\${TOOLKIT_URL}/sdk/adapter-mcp.js\`);   // in Node: ${PACKAGE_NAME}/adapter-mcp
const registry = createRegistryClient({ url: TOOLKIT_URL, token: DEFAULT_TOKEN });
const descriptor = defineDescriptor({ appId: 'my-app', id: 'big-text', name: 'Big text', version: '0.1.0',
  description: 'Makes the text bigger.', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }] });
await registry.publish({ appName: 'My app', descriptor, code: BIG_TEXT_SOURCE });  // a new revision, private
await registry.share({ appId: 'my-app', id: 'big-text' });                        // everyone on this toolkit can find it
const { adapters } = await registry.search({ url: location.href });                // yours + shared with you
await registry.install('my-app', adapters[0].adapter);                              // or 'browser-runtime'
for (const { adapter, entry } of await loadInstalledAdapters(registry, 'my-app')) adapter?.enable(entry.parameters);
\`\`\`

**Registry tools** (\`POST /v1/mcp\` with any token of the account; \`GET /v1/mcp\` streams \`notifications/resources/list_changed\`; adapters are also resources \`adapter://owner/appId/id\`):

${registryTools}

**The browser runtime** (\`extension/\`, an unpacked Chrome extension, Chrome 135+): it runs everything installed into the app \`${BROWSER_RUNTIME_APP}\` as user scripts on the URLs each adapter targets, picks up a new revision in open pages without a reload, can be switched off per site from its popup, and reports applied / failed (with the error) / skipped per page origin with \`adapter_report\`. Setup: Load unpacked → turn on **Allow User Scripts** on its Details → sign in to the console → popup → **Connect with this console**. The console's **Adapters** page is where a developer writes an adapter (live lint), saves revisions, runs it in their browser, shares it, installs others' and sees the runtime's reports.

SDK helpers: ${helpers.map((h) => `\`${h}\``).join(', ')}.

**Live control (optional).** An app that is open can also connect for live control: \`connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ adapter, descriptor })] }) })\`. The toolkit relays standard MCP calls to it while it is connected: \`POST /v1/mcp/apps/{appId}\` (its single live instance) or \`/v1/mcp/providers/{providerId}\`; the console's **Apps** page offers the same as Try it. \`createAdapterProvider\` throws \`AdapterMcpError\` with the reasons for a bad descriptor; read them rather than loosening it. Tools a connected app answers (plus an \`apply_<id>\` shortcut per adapter, taking \`{enabled, parameters?, target?, requestKey?}\`):

${tools}

A client pins the adapter it means with \`adapterRef\` = \`{appId, id, version, descriptorDigest}\`; undo works only through the receipt an apply returned. From Claude Code: \`claude mcp add --transport http ai4a11y-toolkit $TOOLKIT_SERVER_URL/v1/mcp --header "Authorization: Bearer <default token>"\` for the registry, and \`…/v1/mcp/apps/<appId>\` for one connected app.`;
}

// Plain-language steps for the most common task: build an adapter in code
// with a coding agent. Hand-written, like WHAT_IS_IT; the helper it names is
// scripts/adapter.mjs in this skill's folder.
const BUILD_AN_ADAPTER = `An adapter is one JavaScript file that removes one barrier on a website, for example making small buttons bigger. The person says what should change, you write the file, and the toolkit runs it in their browser. The toolkit is a research project in pre-alpha and the adapters are unvalidated, so the person checks each change on the page.

**What the person does**

1. Once: set up the adapter runtime extension in Chrome (\`extension/README.md\`, "Set it up": Load unpacked, Allow User Scripts, Connect with this console).
2. In the developer console, open **Adapters** and choose **+ New adapter**. The guide there gives the commands to add this skill to a project and to set the toolkit address and the default token.
3. Tell you what to fix, for example: "Make an adapter that makes small buttons bigger on https://example.com." You pick up this skill on your own.
4. Open the page in Chrome. The change appears within a few seconds.
5. Say what to change next. You edit the file and publish again.

**What you do**

1. Get the toolkit address and the token from the person. Keep them in the environment as \`TOOLKIT_URL\` and \`TOOLKIT_TOKEN\`. Never write the token into a file.
2. Write one file, such as \`bigger-buttons.js\`:
   - It exports one object with \`enable(options)\` and \`disable()\`.
   - \`enable()\` makes the change and remembers what it changed. \`disable()\` puts the page back exactly as it was.
   - Plain browser JavaScript only: no \`import\`, no network calls (\`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`), no \`eval\`.

   \`\`\`javascript
   // Bigger buttons: makes small buttons at least 44 pixels tall,
   // for people who find small targets hard to hit.
   export const BiggerButtons = {
     enabled: false,
     changed: [],
     enable() {
       if (this.enabled) return;
       this.enabled = true;
       for (const el of document.querySelectorAll('button, [role="button"]')) {
         this.changed.push({ el, before: el.style.minHeight });
         el.style.minHeight = '44px';
       }
     },
     disable() {
       if (!this.enabled) return;
       this.enabled = false;
       for (const { el, before } of this.changed) el.style.minHeight = before;
       this.changed = [];
     },
   };
   \`\`\`
3. Publish it and run it in the person's browser with the helper in this skill's folder (in this repository: \`.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs\`; Node 18 or later, nothing to install):

   \`\`\`bash
   node <skill folder>/scripts/adapter.mjs publish bigger-buttons.js \\
     --name "Bigger buttons" --runs-on "https://example.com/*" --for motor \\
     --about "Makes small buttons 44 pixels tall, for people who find small targets hard to hit."
   \`\`\`
   - \`--runs-on\` is the pages, one flag per pattern: \`https://example.com/*\` is each page of that site, \`http://localhost/*\` is any local port.
   - \`--for\` is who it helps: vision, motor, hearing, cognitive, sensory, reading.
   - If the toolkit refuses the file, the message names the line. Fix it and run the command again.
4. Check that it ran: \`node <skill folder>/scripts/adapter.mjs status bigger-buttons\` prints "Running on …", or "Failed on …" with the error. Fix the file and publish again. Each publish is a new revision, and open pages pick it up without a reload.
5. When the person asks, share it with everyone on their toolkit: \`node <skill folder>/scripts/adapter.mjs share bigger-buttons\`. Until then it stays private to their account.

The adapter also shows on the developer console's **Adapters** page, where the person can read the code and its reports. To publish from your own app's code instead, see "Sharing adapters between apps" below.`;

const ADD_SKILL_SECTION = `This skill ships **inside the toolkit repo** at \`.claude/skills/ai4a11y-toolkit/SKILL.md\`, so anyone opening this repo in Claude Code gets it automatically. To use it from **your own project**:

\`\`\`bash
mkdir -p .claude/skills
cp -r <path-to-toolkit-repo>/.claude/skills/ai4a11y-toolkit .claude/skills/
\`\`\`

Or download it from any toolkit service, which serves it at \`/skill/ai4a11y-toolkit/SKILL.md\` and \`/skill/ai4a11y-toolkit/scripts/adapter.mjs\` (the developer console's **+ New adapter** guide gives the commands).

Copy the whole folder: \`scripts/adapter.mjs\` (the helper in "Build an adapter with a coding agent") lives next to \`SKILL.md\`. Claude Code discovers project skills in \`.claude/skills/\` on the next session, and so does opencode (it reads \`.claude/skills/\`, \`.opencode/skills/\` and \`.agents/skills/\`). If you vendor or depend on the toolkit, re-copy after upgrades (the file is generated from the toolkit source, so it always matches the version you copied it from — check the "Regenerate" line at the bottom to rebuild it against your checkout).`;

export function renderSkillMd(model) {
  const serviceMapping = buildServiceMappingSection();
  const serverDev = buildServerDevSection();
  const adapterMcpSection = buildAdapterMcpSection();
  return `---
name: ai4a11y-toolkit
description: Use when building an accessibility adapter for a website in code (write it, publish it to the toolkit, run it in the browser, check it, share it), embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), sharing accessibility adapters between apps through Adapter MCP (the toolkit's adapter registry, the SDK, the browser runtime extension, the developer console's Adapters and Apps pages, MCP clients), talking to the hosted toolkit HTTP service with an account's default token, or running/deploying your own toolkit service instance (accounts, workshops, Cloud Run).
---

# AI for Accessibility Toolkit

${WHAT_IS_IT}

This file is **generated** by \`toolkit/scripts/generate-skill.mjs\` from the same introspected model as \`toolkit/API.md\` — do not hand-edit; see "Regenerate" at the bottom.

## Build an adapter with a coding agent

${BUILD_AN_ADAPTER}

## Quick Start

Paths below are relative to the \`toolkit/\` package root (run from there, or adjust the specifiers when importing \`${PACKAGE_NAME}\` as a dependency — the package is not on npm yet; vendor it as a packed tarball, see docs/using-in-your-project.md).

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
TOOLKIT_SERVER_TOKEN=aat_...                   # the account's default token, from the developer console
\`\`\`

Tokens come from **accounts**. An admin makes developer accounts in the
instance's admin console (\`/admin\`, browser login popup: any username, the
admin password). The developer signs in at \`/developer\`; the sidebar shows
the account's **default token**, which every app, adapter and script of that
account uses. The console's own sign-in session token is refused outside the
console, and **Account & tokens** can make extra app tokens that are revoked on
their own. All of an account's state is partitioned by its \`uid\`.

**When a task needs the hosted service, do this first:**

1. Check \`.env\` for \`TOOLKIT_SERVER_URL\` / \`TOOLKIT_SERVER_TOKEN\`.
2. If either is missing, **ask the user** for it (the URL comes from a
   maintainer or their own deployment; the token is the default token shown
   after signing in at \`/developer\`) and **offer to write both into
   \`.env\`** — create the file if needed, and confirm \`.env\` is gitignored
   *before* writing (\`git check-ignore .env\`).
3. Read the values from \`.env\` at run time — never hardcode them in code,
   commits, or generated files, and never echo the token back into output.
4. Verify the connection: \`GET $TOOLKIT_SERVER_URL/v1/whoami\` with
   \`Authorization: Bearer $TOOLKIT_SERVER_TOKEN\` returns the token's
   \`{uid, label, kind}\` (\`kind\` is \`default\` or \`app\`).

The browser extensions do **not** use \`.env\` and do not live in this
repository. Their config lives in \`chrome.storage.sync\` (\`toolkitServerUrl\` /
\`toolkitServerToken\`), written by each extension's Options page. Do not write a
token into any file in this repository; the extension repository documents its
own demo-build configuration.

## Sharing adapters between apps (Adapter MCP)

${adapterMcpSection}

## Running or deploying your own toolkit service

${serverDev}

## Adding this skill to your project

${ADD_SKILL_SECTION}

---

Regenerate with: \`npm run docs\` (from \`toolkit/\`). Full reference (surfaces, protocol schemas, barrel exports): \`toolkit/API.md\`.
`;
}

// Compare filesystem paths, not URL strings: import.meta.url is
// percent-encoded (spaces, ~) so a raw `file://` + argv comparison fails on
// paths like an iCloud checkout. fileURLToPath decodes both to the same form.
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const model = await buildModel();
  const md = renderSkillMd(model);
  mkdirSync(SKILL_DIR, { recursive: true });
  writeFileSync(SKILL_PATH, md, 'utf8');
  process.stdout.write(`Wrote ${SKILL_PATH} (${md.length} bytes)\n`);
}
