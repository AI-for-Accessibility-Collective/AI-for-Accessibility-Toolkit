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
import { PROFILE_NAME, PROFILE_VERSION, MCP_PROTOCOL_VERSION, TOOL_DESCRIPTIONS, REGISTRY_TOOL_DESCRIPTIONS, PROFILE_TOOL_DESCRIPTIONS, ACCESS_TOOL_DESCRIPTIONS, WEB_MODULE, BROWSER_RUNTIME_APP } from '../protocol/adapter/index.js';
import * as adapterMcp from '../adapter-mcp/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_ROOT = path.join(__dirname, '..');       // toolkit/
const REPO_ROOT = path.join(TOOLKIT_ROOT, '..');        // repo root
const SKILL_DIR = path.join(REPO_ROOT, '.claude', 'skills', 'ai4a11y-toolkit');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');
// Reference material an agent reads when it needs it. Kept out of SKILL.md so
// that file stays whole: opencode cuts a tool's output at about 50 KB, and a
// cut SKILL.md loses its end, where the agent learns the skill's folder.
const REFERENCE_DIR = path.join(SKILL_DIR, 'reference');
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

**Run locally** (file-backed storage, no cloud account needed). A coding agent starts one only when the person chooses it over their hosted toolkit, and never when \`TOOLKIT_URL\` and \`TOOLKIT_TOKEN\` are already set (see "Build an adapter with a coding agent", step 1). The repository's own tests start their own servers and need none of this.

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

**Deploying**: \`server/Dockerfile\` builds from the repo root (it copies \`toolkit/\` + \`server/\`); \`cloudbuild.yaml\` + \`server/DEPLOYMENT.md\` document the Cloud Run deployment (small instance, Secret Manager for the secrets, GCS bucket, IAM). Keep \`--max-instances 1\` (connected Adapter MCP apps live in the process's memory, so a second instance would report them offline), \`--timeout 3600\` (each connected app holds one long server-sent-event request), and \`CORS_ORIGINS=*\` when browser apps on other origins must connect (\`/v1\` accepts bearer tokens only, never cookies). Everything else — accounts, tokens, profiles, presets, each account's last 200 MCP calls — is in the store and survives a restart. \`server/API.md\` is generated from the route table (\`npm run docs\` in \`server/\`) and the live service serves the same data at \`GET /v1/meta\`. Liveness: use \`/v1/healthz\` (bare \`/healthz\` is intercepted at the run.app edge).

**Extending the wire surface**: add a route entry in \`server/src/routes.js\` (plain \`{route, target, kind}\`, or a custom \`invoke\` for arg-shape dispatch — see \`setPause\`), then regenerate docs and update the oracle list in \`server/test/server-test.mjs\`. A remote-mode host wraps these routes in a Librarian-shaped facade.`;
}

/** "Sharing adapters" — the version numbers, tool names and SDK exports are
 *  read from the protocol and SDK modules, so they cannot drift. */
function buildAdapterMcpSection() {
  const registryTools = Object.entries(REGISTRY_TOOL_DESCRIPTIONS).map(([name, text]) => `- \`${name}\` — ${text}`).join('\n');
  const profileTools = Object.entries(PROFILE_TOOL_DESCRIPTIONS).map(([name, text]) => `- \`${name}\` — ${text}`).join('\n');
  const accessTools = Object.entries(ACCESS_TOOL_DESCRIPTIONS).map(([name, text]) => `- \`${name}\` — ${text}`).join('\n');
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

**Profile and learning tools** (the same endpoint; SDK: \`registry.profile.get()\`, \`.observe({text, origin, type, data, images, app, adapter})\`, \`.learned()\`, \`.learnNow()\`, \`.respond(id, 'accept' | 'declineOnce' | 'suppress')\`, \`.forget(id)\`, \`.pause(true)\`, \`.reset({memories})\`). The toolkit learns about the person over time: apps report what the person did with \`profile_observe\` (one plain sentence, the site, small data, never page content), the registry adds running, removing and switching adapters in \`${BROWSER_RUNTIME_APP}\`, and about 30 seconds after the last observation the service turns them into memories and suggested profile changes. **A suggestion changes the profile only when the person accepts it**: show it to them and pass on their answer, never accept for them. The developer console's Memory page shows the same under "What your toolkit learned", with pause and reset. See \`server/CONTRACT.md\`, "Profile and learning tools".

${profileTools}

**Who can read what an app or adapter gives the toolkit, and adapters' own data** (the same endpoint; SDK: \`registry.access.declare(appId, 'user' | 'app')\`, \`.get()\`, \`.restrict({app} | {adapter}, level | null)\`; \`registry.data(adapterKey).get(key?)\`, \`.set(key, value)\`, \`.delete(key?)\`). Each app and adapter declares a visibility for its observations, what the toolkit learns from them, and its stored data: \`user\` (every app of the person's account; the default), \`app\` (only that app), or \`adapter\` (only that adapter and the apps that run it). An app declares it with \`app_declare\` or \`application.visibility\` when it connects; an adapter with \`visibility\` in its descriptor. The person can narrow either in the developer console (the **Apps** and **Adapters** pages), never widen it. App- and adapter-level data is learned in a store of its own and never becomes a suggested change to the shared profile. The console session and the default token read everything; an app token bound to an app (the console's **Account** page, "For app") reads user-level data plus its own app's. An adapter's data is up to 4 MB of JSON per account.

${accessTools}

**The browser runtime** (\`extension/\`, an unpacked Chrome extension, Chrome 135+): it runs everything installed into the app \`${BROWSER_RUNTIME_APP}\` as user scripts on the URLs each adapter targets, picks up a new revision in open pages without a reload, can be switched off per site from its popup, and reports applied / failed (with the error) / skipped per page origin with \`adapter_report\`. Setup: Load unpacked → turn on **Allow User Scripts** on its Details → sign in to the console → popup → **Connect with this console** (the skill's \`adapter.mjs extension\` walks a person through it, and \`adapter.mjs check\` confirms it). On connecting, the runtime checks in with an empty \`adapter_report\`, so \`adapter_status\` lists it before it runs anything. Adapters are built in code with a coding agent (the console's **+ New adapter** is a guide to that); the console's **Adapters** page edits them (live lint), saves revisions, runs them in the browser, shares them, installs others' and shows the runtime's reports.

SDK helpers: ${helpers.map((h) => `\`${h}\``).join(', ')}.

**Live control (optional).** An app that is open can also connect for live control: \`connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ adapter, descriptor })] }) })\`. The toolkit relays standard MCP calls to it while it is connected: \`POST /v1/mcp/apps/{appId}\` (its single live instance) or \`/v1/mcp/providers/{providerId}\`; the console's **Apps** page offers the same as Try it. \`createAdapterProvider\` throws \`AdapterMcpError\` with the reasons for a bad descriptor; read them rather than loosening it. Tools a connected app answers (plus an \`apply_<id>\` shortcut per adapter, taking \`{enabled, parameters?, target?, requestKey?}\`):

${tools}

A client pins the adapter it means with \`adapterRef\` = \`{appId, id, version, descriptorDigest}\`; undo works only through the receipt an apply returned. From Claude Code: \`claude mcp add --transport http ai4a11y-toolkit $TOOLKIT_URL/v1/mcp --header "Authorization: Bearer <default token>"\` for the registry, and \`…/v1/mcp/apps/<appId>\` for one connected app.`;
}

// Plain-language steps for the most common task: build an adapter in code
// with a coding agent. Hand-written, like WHAT_IS_IT; the helper it names is
// scripts/adapter.mjs in this skill's folder.
const BUILD_AN_ADAPTER = `**Ask before you build.** When someone asks you to build an adapter or adaptations, your first reply is your questions (step 3 for a web adapter, step 2 for an app), not code: do not write or publish anything yet. Ask with your question tool if you have one (\`question\` in opencode, \`AskUserQuestion\` in Claude Code), or in one plain message, then stop and wait for the answers, even when the request seems complete. The person chooses who it helps, where it runs and who can read its data.

The toolkit supports two kinds of work. Find out first which one the person means, and ask if what they said does not make it clear.

- **A web adapter, run by the toolkit's browser extension.** One JavaScript file that removes one barrier on a website, for example making small buttons bigger. It works on sites the person does not own: the adapter runtime extension runs it in their Chrome on the pages it targets. See "A web adapter" below.
- **An app with its own adaptations.** An app the person builds (a web, mobile or XR app) changes itself. Its adaptations live in its own code, and it follows the person's toolkit profile. It connects to the toolkit, so its adaptations show in the developer console under **Apps**, where the console or a coding agent can switch them on and off. See "Adaptations in your own app" below. The Redbird demo store is one.

The toolkit is a research project in pre-alpha and the adaptations are unvalidated, so the person checks each change themselves.

### A web adapter

The person says what should change, you write the file, and the toolkit runs it in their browser.

**What the person does**

1. Once: set up the adapter runtime extension in Chrome. You walk them through it ("What you do", step 2).
2. In the developer console, open **Adapters** and choose **+ New adapter**. Copy the two lines it shows (the toolkit address and the default token) into a file named \`.env\` at the top of this repository. Git ignores \`.env\`, so the token stays out of commits.
3. Open this repository in a coding agent such as Claude Code or opencode, and say what to fix, for example: "Make an adapter that makes small buttons bigger on https://example.com." The agent picks up this skill on its own.
4. Open the page in Chrome. The change appears within a few seconds.
5. Say what to change next. You edit the file and publish again.

**What you do**

\`<skill folder>\` below is the folder this SKILL.md is in: \`.claude/skills/ai4a11y-toolkit\` in this repository, or wherever the skill is installed (\`.opencode/skills/…\`, \`.claude/skills/…\` in a project, or the same under your home folder). These folders are hidden, so a plain file search may skip them; look there by path. Its helper, \`scripts/adapter.mjs\`, does every step below that talks to the toolkit: run it rather than writing those calls or steps yourself.

1. Choose the toolkit to work with. **Do not start a toolkit on this computer unless the person asks for one.**
   - If \`TOOLKIT_URL\` and \`TOOLKIT_TOKEN\` are already set, in the environment or in a \`.env\` file at the top of the repository, use them. Do not ask. An older \`.env\` may name them \`TOOLKIT_SERVER_URL\` and \`TOOLKIT_SERVER_TOKEN\`; the helper reads those too. To check without showing the token: \`grep -cE '^(TOOLKIT_URL|TOOLKIT_SERVER_URL)=' .env\`.
   - Otherwise ask the person: "Use your hosted toolkit (the usual choice), or start one on this computer?"
   - **Hosted** (the default): ask them to open their developer console, choose **Adapters**, then **+ New adapter**, and paste the two lines it shows into \`.env\` at the top of the repository. If they give you the address and token instead, write the two lines into \`.env\` yourself, and do not repeat the token back.
   - **On this computer**, only when they choose it: start it as in "Running or deploying your own toolkit service" (\`ADMIN_PASSWORD=dev npm run dev:workshop\`), make an account, have them sign in at \`http://localhost:8080/developer\`, and put that console's two lines into \`.env\`.
   - The helper below reads \`TOOLKIT_URL\` and \`TOOLKIT_TOKEN\` from \`.env\`. Keep the token out of your messages, other files and commits (git ignores \`.env\`).
2. Check that the person's browser runs adapters: \`node <skill folder>/scripts/adapter.mjs check\`. It prints "Connected: Chrome … on macOS, last seen …", or says that no browser runtime is connected. If none is, help them set up the extension:
   - Run \`node <skill folder>/scripts/adapter.mjs extension\` (with \`--no-open\` if the person does not want windows opened). It finds the extension folder, opens \`chrome://extensions\` in Chrome, copies the folder's path, and prints the steps. Always run it rather than giving the steps from memory: the person needs the folder's path. If the extension is not on their computer, it prints the \`git clone\` that gets it; run that where they agree, then \`extension\` again with \`--dir <the cloned folder>/extension\`.
   - Chrome lets only the person install it. Give them one step at a time and wait after each: turn on **Developer mode**; choose **Load unpacked** and pick the extension folder (on a Mac, Cmd+Shift+G in the folder picker, then paste); on the extension's **Details**, turn on **Allow User Scripts**; sign in to the developer console, open the extension from the toolbar and choose **Connect with this console**.
   - Run \`check\` again to confirm.
3. Before you write any code, send the person one message with these questions, then stop and wait for their answer. This holds even when their request seems complete: they choose, not you.
   - Mark each question **Needed** or **Optional**, and give each optional one the default you will use if they skip it.
   - When their request already answers a needed question, turn it into a question to confirm, for example "Who it helps: motor, since the buttons are hard to hit. Right?"
   - Skip the message only when they said to go ahead without questions. Then say which answers and defaults you are using.
   - **Needed**: what gets in their way on the page now, and what should change. For example: "the buttons are too small to hit", so "make them at least 44 pixels tall".
   - **Needed**: which site or pages, for example \`https://example.com\`, or only its checkout pages. This becomes \`--runs-on\`.
   - **Needed**: who it helps: vision, motor, hearing, cognitive, sensory or reading. This becomes \`--for\`. If what they said already points to one, suggest it and ask them to confirm.
   - **Optional**: a name. By default you name it after the change, such as "Bigger buttons".
   - **Optional**: how much, and where on the page, for example the size, the colors, or only the main menu. By default you pick a common value and say what it is.
   - **Optional**: anything on the page to leave alone. By default you change only what matches the problem.
   - **Optional**: whether to share it with everyone on their toolkit. By default it stays private to their account.
   - **Optional**: who can read what it gives the toolkit (what the person does with it, and its stored values): every app of theirs (\`--visibility user\`), or only this adapter (\`--visibility adapter\`). By default, every app of theirs.
   - **Optional**: whether it keeps values between runs, such as a size the person picked. By default, no.
4. Write one file, such as \`bigger-buttons.js\`:
   - It exports one object with \`enable(options, toolkit)\` and \`disable()\`. \`options\` are its parameters. \`toolkit\` is how it reaches the toolkit, as itself: \`await toolkit.data.get(key)\`, \`toolkit.data.set(key, value)\` and \`toolkit.data.delete(key)\` keep its own values, and \`toolkit.observe('Moved the ruler down the page.')\` tells the toolkit what the person did (one plain sentence; never page content or anything they typed). Each returns a promise, and rejects when the browser is not connected, so the adapter works without them.
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
5. Publish it and run it in the person's browser with the helper in this skill's folder (in this repository: \`.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs\`; Node 18 or later, nothing to install):

   \`\`\`bash
   node <skill folder>/scripts/adapter.mjs publish bigger-buttons.js \\
     --name "Bigger buttons" --runs-on "https://example.com/*" --for motor \\
     --about "Makes small buttons 44 pixels tall, for people who find small targets hard to hit."
   \`\`\`
   - \`--runs-on\` is the pages, one flag per pattern: \`https://example.com/*\` is each page of that site, \`http://localhost/*\` is any local port.
   - \`--for\` is who it helps: vision, motor, hearing, cognitive, sensory, reading.
   - If the person chose to share it, add \`--share\`. If only this adapter should read what it gives the toolkit, add \`--visibility adapter\`.
   - If the toolkit refuses the file, the message names the line. Fix it and run the command again.
6. Check that it ran: \`node <skill folder>/scripts/adapter.mjs status bigger-buttons\` prints "Running on …", or "Failed on …" with the error. Fix the file and publish again. Each publish is a new revision, and open pages pick it up without a reload.
7. When the person asks, share it with everyone on their toolkit: \`node <skill folder>/scripts/adapter.mjs share bigger-buttons\`. Until then it stays private to their account.
8. Over time the toolkit learns from what the person does with their adapters and suggests changes to their profile. \`node <skill folder>/scripts/adapter.mjs learned\` lists the suggestions and what it remembers. Read a suggestion to the person and pass on their answer only: \`node <skill folder>/scripts/adapter.mjs answer <id> accept\` (or \`not-now\`, \`never\`).

The adapter also shows on the developer console's **Adapters** page, where the person can read the code and its reports.

### Adaptations in your own app

The adaptations are part of the app's code, so you work in the app's repository and follow its conventions. The app talks to the toolkit with the toolkit's address and the person's default token. Keep both in the app's configuration, such as its \`.env\`, never in its code or commits.

1. Choose the toolkit to work with, as in step 1 for a web adapter. For an app that should read only its own data, ask the person for an app token made for it: the console's **Account** page, **App tokens**, with its app id under "For app". The default token reads everything.
2. Before you write any code, send the person these questions in one message, then stop and wait for their answer, as in step 3 for a web adapter: needed ones they already answered become questions to confirm, and optional ones carry their defaults.
   - **Needed**: what the app is and where it runs: a web, mobile or XR app.
   - **Needed**: which adaptations it has or should have, what each one changes, and who it helps: vision, motor, hearing, cognitive, sensory or reading.
   - **Needed**: which parts of the person's profile turn each one on, for example bigger text for someone who asked for it.
   - **Optional**: whether the toolkit can switch the adaptations on and off while the app is open, from the console's **Apps** page or a coding agent. By default, yes.
   - **Optional**: which observations the app sends, so the toolkit learns from them: what the person does that says something about their needs, such as switching an adaptation, or making the text bigger again after a reset. By default, only the person switching an adaptation themselves.
   - **Optional**: which suggested profile changes (proposals) the app shows the person to answer, for example only the ones that touch its own adaptations. By default, none: the person answers them on the console's Memory page.
   - **Optional**: whether to share an adaptation's code with other apps through the toolkit's adapter registry. By default, no: it stays in the app.
   - **Optional**: who can read what the app gives the toolkit (its observations and what the toolkit learns from them): every app of theirs (\`user\`), or only this app (\`app\`). By default, every app of theirs.
   - **Optional**: whether observations carry images, such as a screenshot of what the person could not read. By default, no.
   - **Optional**: values the app or its adaptations keep in the toolkit between sessions, such as a chosen size. By default, none: the app keeps its own.
3. Follow the profile. Read it with \`getProfile\` (\`POST /v1/librarian/getProfile\`), and listen on \`GET /v1/profile/events\` so the app follows a change without a reload (see \`reference/http-api.md\`). Turn on the adaptations the profile asks for. In JavaScript, the surface renderers in \`toolkit/surfaces/\` map the profile to platform settings.
   - A profile looks like \`{ supportAreas: ['vision'], fields: { needs: [{ dimension: 'textSize', value: 1.5, strength: 'preference' }], visionKind: 'lowVision', readingLevel: 6, largeTargets: true } }\`. Most of what an app acts on is in \`fields.needs\`. The developer console's dimensions include \`textSize\` (a multiplier, 1.0–2.0), \`lineSpacing\`, \`letterSpacing\`, \`contrast\`, \`darkTheme\`, \`reduceMotion\`, \`simplify\`, \`dyslexiaFont\`, \`captions\`, \`readAloud\`, \`describeImages\`, \`labelControls\` and \`keyboardAccess\`; \`visionKind\` is \`blind\`, \`lowVision\` or \`colorBlind\`. Read a missing one as "not asked for".
   - \`node <skill folder>/scripts/adapter.mjs profile\` prints the person's current profile, so you can see the real values. The console's Profiles page has nine built-in presets (Profile 1–9) to try the app with.
4. Connect, so the app shows under **Apps**. Wrap each adaptation as an object with \`enable(parameters)\`, \`disable()\` and \`enabled\`, describe it with \`defineDescriptor({ appId: '<app id>', ... })\`, and connect with \`connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ descriptor, adapter })] }) })\` (see "Live control" in \`reference/adapter-mcp.md\`). The app is listed under **Apps** while it is open. Its adaptations stay out of the adapter registry and the console's **Adapters** page. If only the app should read what it gives the toolkit, set \`visibility: 'app'\` in \`application\`; an app without live control declares it with \`registry.access.declare('<app id>', 'app')\`.
5. Send the observations the person chose, each one plain sentence with \`profile_observe\` or \`POST /v1/librarian/logObservation\`, for example "Turned on Calm urgency on the Redbird store." Use \`type: 'setting-change'\` for a deliberate choice. Put \`app: '<app id>'\` in every observation: the app's visibility applies only to observations that name it. (An app token made for the app names it by itself; with the default token, an observation without \`app\` is kept for every app.) Never page content or anything they typed. If the person chose images, add up to 4 as \`images: [{ mimeType: 'image/png', data: <base64> }]\`; they are kept with the observation and shown to the model when it learns. To keep values in the toolkit, use \`registry.data({ appId, id }).set(key, value)\` for an adaptation published to the registry.
6. If the app shows suggestions, read them with \`profile_learned\` (\`registry.profile.learned()\`), keep the ones the person chose (each has a \`change\`, such as \`{op: 'profile-set', path: 'fields.largeTargets', value: true}\`), show each in plain words, and pass on the person's answer with \`profile_proposal_respond\`: accept, declineOnce or suppress. Never answer for them. An accepted change reaches the app through \`/v1/profile/events\`, like any other profile change.
7. Check it: open the app, then the console's **Apps** page. The app is listed, and **Try it** switches each adaptation. A coding agent can do the same through \`/v1/mcp/apps/<app id>\`.
8. Only when the person asks to share an adaptation with other apps: publish it with \`registry.publish\` (see \`reference/adapter-mcp.md\`). A web adaptation can carry its code; any other is a description only.`;

const ADD_SKILL_SECTION = `This skill ships **inside the toolkit repo** at \`.claude/skills/ai4a11y-toolkit/SKILL.md\`, so anyone opening this repo in Claude Code gets it automatically. To use it from **your own project**:

\`\`\`bash
mkdir -p .claude/skills
cp -r <path-to-toolkit-repo>/.claude/skills/ai4a11y-toolkit .claude/skills/
\`\`\`

Copy the whole folder: \`scripts/adapter.mjs\` (the helper in "Build an adapter with a coding agent") and \`reference/\` live next to \`SKILL.md\`. Claude Code discovers project skills in \`.claude/skills/\` on the next session, and so does opencode (it reads \`.claude/skills/\`, \`.opencode/skills/\` and \`.agents/skills/\`). If you vendor or depend on the toolkit, re-copy after upgrades (the file is generated from the toolkit source, so it always matches the version you copied it from — check the "Regenerate" line at the bottom to rebuild it against your checkout).`;

const GENERATED = 'Generated by \`toolkit/scripts/generate-skill.mjs\` with the skill: do not hand-edit.';

/** The reference files beside SKILL.md, by path relative to the skill folder. */
export function renderReferences(model) {
  return {
    'reference/adapter-mcp.md': `# Sharing adapters between apps (Adapter MCP)

${GENERATED}

${buildAdapterMcpSection()}
`,
    'reference/http-api.md': `# Talking to the hosted service

${GENERATED}

Instead of embedding the toolkit in-process, a client can call a hosted instance over HTTP — same Librarian methods, one call per method, behind a bearer token. Full wire contract: \`server/CONTRACT.md\`.

${buildServiceMappingSection()}
`,
    'reference/core-api.md': `# Embedding the core

${GENERATED}

## Methods by Concern

Read directly off a live \`createToolkit(...)\` instance — call as \`toolkit.librarian.<method>(...)\` / \`toolkit.datastore.<method>(...)\`.

${renderMethodGroups(model.methodGroups)}

## Ports contract

A host implements these to construct a toolkit instance (\`createToolkit({ kv, clock, scheduler, consent, demo, ... })\`) and, separately, \`ActuationPort\` for voice/agent control surfaces.

${renderPorts(model.ports)}
`,
  };
}

export function renderSkillMd(model) {
  const serverDev = buildServerDevSection();
  return `---
name: ai4a11y-toolkit
description: Ask the person what they need before building anything with it. Use when building an accessibility adapter for a website in code (write it, publish it to the toolkit, run it in the browser with the toolkit's extension, check it, share it), building adaptations into your own web, mobile or XR app that follow the person's toolkit profile and show under the console's Apps, embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), sharing accessibility adapters between apps through Adapter MCP (the toolkit's adapter registry, the SDK, the browser runtime extension, the developer console's Adapters and Apps pages, MCP clients), talking to the hosted toolkit HTTP service with an account's default token, or running/deploying your own toolkit service instance (accounts, workshops, Cloud Run).
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

## Reference

Read these from this skill's folder when a task needs them:

- \`reference/adapter-mcp.md\`: sharing adapters between apps through the toolkit's registry, the SDK (\`createRegistryClient\`, \`connectToToolkit\`, live control), the registry's MCP tools, the browser runtime, visibility and adapter data.
- \`reference/http-api.md\`: the hosted service's HTTP endpoints and the \`/v1/librarian/{method}\` mapping, for a client in any language.
- \`reference/core-api.md\`: embedding the core in-process: every Librarian and Datastore method by concern, and the ports a host implements.

## Connecting to a hosted instance (URL + token)

The repo intentionally contains **no live instance URL and no tokens** (client
config never belongs in version control). For scripts/agents, configuration
lives in the project's untracked \`.env\` at the repo root:

\`\`\`bash
TOOLKIT_URL=https://<your-instance>     # ask a maintainer, or your own deployment
TOOLKIT_TOKEN=aat_...                   # the account's default token, from the developer console
\`\`\`

Tokens come from **accounts**. An admin makes developer accounts in the
instance's admin console (\`/admin\`, browser login popup: any username, the
admin password). The developer signs in at \`/developer\`; the sidebar shows
the account's **default token**, which every app, adapter and script of that
account uses. The console's own sign-in session token is refused outside the
console, and **Account & tokens** can make extra app tokens that are revoked on
their own. All of an account's state is partitioned by its \`uid\`.

**When a task needs the hosted service, do this first:**

1. Check the environment and \`.env\` for \`TOOLKIT_URL\` / \`TOOLKIT_TOKEN\` (an older \`.env\` may name them \`TOOLKIT_SERVER_URL\` / \`TOOLKIT_SERVER_TOKEN\`; the helper reads both).
2. If either is missing, **ask the user** for it (the URL comes from a
   maintainer or their own deployment; the token is the default token shown
   after signing in at \`/developer\`) and **offer to write both into
   \`.env\`** — create the file if needed, and confirm \`.env\` is gitignored
   *before* writing (\`git check-ignore .env\`).
3. Read the values from \`.env\` at run time — never hardcode them in code,
   commits, or generated files, and never echo the token back into output.
4. Verify the connection: \`GET $TOOLKIT_URL/v1/whoami\` with
   \`Authorization: Bearer $TOOLKIT_TOKEN\` returns the token's
   \`{uid, label, kind}\` (\`kind\` is \`default\` or \`app\`).

The browser extensions do **not** use \`.env\`. The adapter runtime
(\`extension/\` here) connects from its popup ("Connect with this console")
and keeps the address and token in \`chrome.storage.local\`. The personalized
extension lives in its own repository and keeps them in \`chrome.storage.sync\`
(\`toolkitServerUrl\` / \`toolkitServerToken\`), written by its Options page.
Do not write a token into any file in this repository other than \`.env\`.

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
  mkdirSync(REFERENCE_DIR, { recursive: true });
  for (const [file, text] of Object.entries(renderReferences(model))) {
    writeFileSync(path.join(SKILL_DIR, file), text, 'utf8');
    process.stdout.write(`Wrote ${path.join(SKILL_DIR, file)} (${text.length} bytes)\n`);
  }
}
