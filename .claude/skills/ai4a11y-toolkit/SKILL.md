---
name: ai4a11y-toolkit
description: Ask the person what they need before building anything with it. Use when building an accessibility adapter for a website in code (write it, publish it to the toolkit, run it in the browser with the toolkit's extension, check it, share it), building adaptations into your own web, mobile or XR app that follow the person's toolkit profile and show under the console's Apps, embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), sharing accessibility adapters between apps through Adapter MCP (the toolkit's adapter registry, the SDK, the browser runtime extension, the developer console's Adapters and Apps pages, MCP clients), talking to the hosted toolkit HTTP service with an account's default token, or running/deploying your own toolkit service instance (accounts, workshops, Cloud Run).
---

# AI for Accessibility Toolkit

The AI for Accessibility Toolkit is a platform-agnostic core (a Librarian personal-memory/profile agent plus a Datastore) that turns per-app accessibility settings into one portable, consent-gated understanding of a person's needs — the `AbilityModel` — shared across web, XR, and mobile hosts. A host wires a small set of injected ports (`KVStore`, `Clock`, `Scheduler`, `Consent`, ...) into `createToolkit(...)` and gets back a `{ datastore, librarian }` pair; every write an inference could be wrong about goes through the same proposal/consent machinery, never silently. Surface renderers (`toolkit/surfaces/*.js`) turn the same `AbilityModel` into platform-specific settings, and a hosted HTTP service (see below) lets non-JS clients call the same Librarian methods remotely.

This file is **generated** by `toolkit/scripts/generate-skill.mjs` from the same introspected model as `toolkit/API.md` — do not hand-edit; see "Regenerate" at the bottom.

## Build an adapter with a coding agent

**Ask before you build.** When someone asks you to build an adapter or adaptations, your first reply is your questions (step 3 for a web adapter, step 2 for an app), not code: do not write or publish anything yet. Ask with your question tool if you have one (`question` in opencode, `AskUserQuestion` in Claude Code), or in one plain message, then stop and wait for the answers, even when the request seems complete. The person chooses who it helps, where it runs and who can read its data.

The toolkit supports two kinds of work. Find out first which one the person means, and ask if what they said does not make it clear.

- **A web adapter, run by the toolkit's browser extension.** One JavaScript file that removes one barrier on a website, for example making small buttons bigger. It works on sites the person does not own: the adapter runtime extension runs it in their Chrome on the pages it targets. See "A web adapter" below.
- **An app with its own adaptations.** An app the person builds (a web, mobile or XR app) changes itself. Its adaptations live in its own code, and it follows the person's toolkit profile. It connects to the toolkit, so its adaptations show in the developer console under **Apps**, where the console or a coding agent can switch them on and off. See "Adaptations in your own app" below. The Redbird demo store is one.

The toolkit is a research project in pre-alpha and the adaptations are unvalidated, so the person checks each change themselves.

### A web adapter

The person says what should change, you write the file, and the toolkit runs it in their browser.

**What the person does**

1. Once: set up the adapter runtime extension in Chrome. You walk them through it ("What you do", step 2).
2. In the developer console, open **Adapters** and choose **+ New adapter**. Copy the two lines it shows (the toolkit address and the default token) into a file named `.env` at the top of this repository. Git ignores `.env`, so the token stays out of commits.
3. Open this repository in a coding agent such as Claude Code or opencode, and say what to fix, for example: "Make an adapter that makes small buttons bigger on https://example.com." The agent picks up this skill on its own.
4. Open the page in Chrome. The change appears within a few seconds.
5. Say what to change next. You edit the file and publish again.

**What you do**

`<skill folder>` below is the folder this SKILL.md is in: `.claude/skills/ai4a11y-toolkit` in this repository, or wherever the skill is installed (`.opencode/skills/…`, `.claude/skills/…` in a project, or the same under your home folder). These folders are hidden, so a plain file search may skip them; look there by path. Its helper, `scripts/adapter.mjs`, does every step below that talks to the toolkit: run it rather than writing those calls or steps yourself.

1. Choose the toolkit to work with. **Do not start a toolkit on this computer unless the person asks for one.**
   - If `TOOLKIT_URL` and `TOOLKIT_TOKEN` are already set, in the environment or in a `.env` file at the top of the repository, use them. Do not ask. An older `.env` may name them `TOOLKIT_SERVER_URL` and `TOOLKIT_SERVER_TOKEN`; the helper reads those too. To check without showing the token: `grep -cE '^(TOOLKIT_URL|TOOLKIT_SERVER_URL)=' .env`.
   - Otherwise ask the person: "Use your hosted toolkit (the usual choice), or start one on this computer?"
   - **Hosted** (the default): ask them to open their developer console, choose **Adapters**, then **+ New adapter**, and paste the two lines it shows into `.env` at the top of the repository. If they give you the address and token instead, write the two lines into `.env` yourself, and do not repeat the token back.
   - **On this computer**, only when they choose it: start it as in "Running or deploying your own toolkit service" (`ADMIN_PASSWORD=dev npm run dev:workshop`), make an account, have them sign in at `http://localhost:8080/developer`, and put that console's two lines into `.env`.
   - The helper below reads `TOOLKIT_URL` and `TOOLKIT_TOKEN` from `.env`. Keep the token out of your messages, other files and commits (git ignores `.env`).
2. Check that the person's browser runs adapters: `node <skill folder>/scripts/adapter.mjs check`. It prints "Connected: Chrome … on macOS, last seen …", or says that no browser runtime is connected. If none is, help them set up the extension:
   - Run `node <skill folder>/scripts/adapter.mjs extension` (with `--no-open` if the person does not want windows opened). It finds the extension folder, opens `chrome://extensions` in Chrome, copies the folder's path, and prints the steps. Always run it rather than giving the steps from memory: the person needs the folder's path. If the extension is not on their computer, it prints the `git clone` that gets it; run that where they agree, then `extension` again with `--dir <the cloned folder>/extension`.
   - Chrome lets only the person install it. Give them one step at a time and wait after each: turn on **Developer mode**; choose **Load unpacked** and pick the extension folder (on a Mac, Cmd+Shift+G in the folder picker, then paste); on the extension's **Details**, turn on **Allow User Scripts**; sign in to the developer console, open the extension from the toolbar and choose **Connect with this console**.
   - Run `check` again to confirm.
3. Before you write any code, send the person one message with these questions, then stop and wait for their answer. This holds even when their request seems complete: they choose, not you.
   - Mark each question **Needed** or **Optional**, and give each optional one the default you will use if they skip it.
   - When their request already answers a needed question, turn it into a question to confirm, for example "Who it helps: motor, since the buttons are hard to hit. Right?"
   - Skip the message only when they said to go ahead without questions. Then say which answers and defaults you are using.
   - **Needed**: what gets in their way on the page now, and what should change. For example: "the buttons are too small to hit", so "make them at least 44 pixels tall".
   - **Needed**: which site or pages, for example `https://example.com`, or only its checkout pages. This becomes `--runs-on`.
   - **Needed**: who it helps: vision, motor, hearing, cognitive, sensory or reading. This becomes `--for`. If what they said already points to one, suggest it and ask them to confirm.
   - **Optional**: a name. By default you name it after the change, such as "Bigger buttons".
   - **Optional**: how much, and where on the page, for example the size, the colors, or only the main menu. By default you pick a common value and say what it is.
   - **Optional**: anything on the page to leave alone. By default you change only what matches the problem.
   - **Optional**: whether to share it with everyone on their toolkit. By default it stays private to their account.
   - **Optional**: who can read what it gives the toolkit (what the person does with it, and its stored values): every app of theirs (`--visibility user`), or only this adapter (`--visibility adapter`). By default, every app of theirs.
   - **Optional**: whether it keeps values between runs, such as a size the person picked. By default, no.
4. Write one file, such as `bigger-buttons.js`:
   - It exports one object with `enable(options, toolkit)` and `disable()`. `options` are its parameters. `toolkit` is how it reaches the toolkit, as itself: `await toolkit.data.get(key)`, `toolkit.data.set(key, value)` and `toolkit.data.delete(key)` keep its own values, and `toolkit.observe('Moved the ruler down the page.')` tells the toolkit what the person did (one plain sentence; never page content or anything they typed). Each returns a promise, and rejects when the browser is not connected, so the adapter works without them.
   - `enable()` makes the change and remembers what it changed. `disable()` puts the page back exactly as it was.
   - Plain browser JavaScript only: no `import`, no network calls (`fetch`, `XMLHttpRequest`, `WebSocket`), no `eval`.

   ```javascript
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
   ```
5. Publish it and run it in the person's browser with the helper in this skill's folder (in this repository: `.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs`; Node 18 or later, nothing to install):

   ```bash
   node <skill folder>/scripts/adapter.mjs publish bigger-buttons.js \
     --name "Bigger buttons" --runs-on "https://example.com/*" --for motor \
     --about "Makes small buttons 44 pixels tall, for people who find small targets hard to hit."
   ```
   - `--runs-on` is the pages, one flag per pattern: `https://example.com/*` is each page of that site, `http://localhost/*` is any local port.
   - `--for` is who it helps: vision, motor, hearing, cognitive, sensory, reading.
   - If the person chose to share it, add `--share`. If only this adapter should read what it gives the toolkit, add `--visibility adapter`.
   - If the toolkit refuses the file, the message names the line. Fix it and run the command again.
6. Check that it ran: `node <skill folder>/scripts/adapter.mjs status bigger-buttons` prints "Running on …", or "Failed on …" with the error. Fix the file and publish again. Each publish is a new revision, and open pages pick it up without a reload.
7. When the person asks, share it with everyone on their toolkit: `node <skill folder>/scripts/adapter.mjs share bigger-buttons`. Until then it stays private to their account.
8. Over time the toolkit learns from what the person does with their adapters and suggests changes to their profile. `node <skill folder>/scripts/adapter.mjs learned` lists the suggestions and what it remembers. Read a suggestion to the person and pass on their answer only: `node <skill folder>/scripts/adapter.mjs answer <id> accept` (or `not-now`, `never`).

The adapter also shows on the developer console's **Adapters** page, where the person can read the code and its reports.

### Adaptations in your own app

The adaptations are part of the app's code, so you work in the app's repository and follow its conventions. The app talks to the toolkit with the toolkit's address and the person's default token. Keep both in the app's configuration, such as its `.env`, never in its code or commits.

1. Choose the toolkit to work with, as in step 1 for a web adapter. For an app that should read only its own data, ask the person for an app token made for it: the console's **Account** page, **App tokens**, with its app id under "For app". The default token reads everything.
2. Before you write any code, send the person these questions in one message, then stop and wait for their answer, as in step 3 for a web adapter: needed ones they already answered become questions to confirm, and optional ones carry their defaults.
   - **Needed**: what the app is and where it runs: a web, mobile or XR app.
   - **Needed**: which adaptations it has or should have, what each one changes, and who it helps: vision, motor, hearing, cognitive, sensory or reading.
   - **Needed**: which parts of the person's profile turn each one on, for example bigger text for someone who asked for it.
   - **Optional**: whether the toolkit can switch the adaptations on and off while the app is open, from the console's **Apps** page or a coding agent. By default, yes.
   - **Optional**: which observations the app sends, so the toolkit learns from them: what the person does that says something about their needs, such as switching an adaptation, or making the text bigger again after a reset. By default, only the person switching an adaptation themselves.
   - **Optional**: which suggested profile changes (proposals) the app shows the person to answer, for example only the ones that touch its own adaptations. By default, none: the person answers them on the console's Profiles page.
   - **Optional**: whether to share an adaptation's code with other apps through the toolkit's adapter registry. By default, no: it stays in the app.
   - **Optional**: who can read what the app gives the toolkit (its observations and what the toolkit learns from them): every app of theirs (`user`), or only this app (`app`). By default, every app of theirs.
   - **Optional**: whether observations carry images, such as a screenshot of what the person could not read. By default, no.
   - **Optional**: values the app or its adaptations keep in the toolkit between sessions, such as a chosen size. By default, none: the app keeps its own.
3. Follow the profile. Read it with `getProfile` (`POST /v1/librarian/getProfile`), and listen on `GET /v1/profile/events` so the app follows a change without a reload (see `reference/http-api.md`). Turn on the adaptations the profile asks for. In JavaScript, the surface renderers in `toolkit/surfaces/` map the profile to platform settings.
   - A profile looks like `{ supportAreas: ['vision'], fields: { needs: [{ dimension: 'textSize', value: 1.5, strength: 'preference' }], visionKind: 'lowVision', readingLevel: 6, largeTargets: true } }`. Most of what an app acts on is in `fields.needs`. The developer console's dimensions include `textSize` (a multiplier, 1.0–2.0), `lineSpacing`, `letterSpacing`, `contrast`, `darkTheme`, `reduceMotion`, `simplify`, `dyslexiaFont`, `captions`, `readAloud`, `describeImages`, `labelControls` and `keyboardAccess`; `visionKind` is `blind`, `lowVision` or `colorBlind`. Read a missing one as "not asked for".
   - `node <skill folder>/scripts/adapter.mjs profile` prints the person's current profile, so you can see the real values. The console's Profiles page has nine built-in presets (Profile 1–9) to try the app with.
4. Connect, so the app shows under **Apps**. Wrap each adaptation as an object with `enable(parameters)`, `disable()` and `enabled`, describe it with `defineDescriptor({ appId: '<app id>', ... })`, and connect with `connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ descriptor, adapter })] }) })` (see "Live control" in `reference/adapter-mcp.md`). The app is listed under **Apps** while it is open. Its adaptations stay out of the adapter registry and the console's **Adapters** page. If only the app should read what it gives the toolkit, set `visibility: 'app'` in `application`; an app without live control declares it with `registry.access.declare('<app id>', 'app')`.
5. Send the observations the person chose, each one plain sentence with `profile_observe` or `POST /v1/librarian/logObservation`, for example "Turned on Calm urgency on the Redbird store." Use `type: 'setting-change'` for a deliberate choice. Put `app: '<app id>'` in every observation: the app's visibility applies only to observations that name it. (An app token made for the app names it by itself; with the default token, an observation without `app` is kept for every app.) Never page content or anything they typed. If the person chose images, add up to 4 as `images: [{ mimeType: 'image/png', data: <base64> }]`; they are kept with the observation and shown to the model when it learns. To keep values in the toolkit, use `registry.data({ appId, id }).set(key, value)` for an adaptation published to the registry.
6. If the app shows suggestions, read them with `profile_learned` (`registry.profile.learned()`), keep the ones the person chose (each has a `change`, such as `{op: 'profile-set', path: 'fields.largeTargets', value: true}`), show each in plain words, and pass on the person's answer with `profile_proposal_respond`: accept, declineOnce or suppress. Never answer for them. An accepted change reaches the app through `/v1/profile/events`, like any other profile change.
7. Check it: open the app, then the console's **Apps** page. The app is listed, and **Try it** switches each adaptation. A coding agent can do the same through `/v1/mcp/apps/<app id>`.
8. Only when the person asks to share an adaptation with other apps: publish it with `registry.publish` (see `reference/adapter-mcp.md`). A web adaptation can carry its code; any other is a description only.

## Quick Start

Paths below are relative to the `toolkit/` package root (run from there, or adjust the specifiers when importing `@ai4a11y/toolkit` as a dependency — the package is not on npm yet; vendor it as a packed tarball, see docs/using-in-your-project.md).

```javascript
import { createToolkit } from './index.js';
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
```

## Reference

Read these from this skill's folder when a task needs them:

- `reference/adapter-mcp.md`: sharing adapters between apps through the toolkit's registry, the SDK (`createRegistryClient`, `connectToToolkit`, live control), the registry's MCP tools, the browser runtime, visibility and adapter data.
- `reference/http-api.md`: the hosted service's HTTP endpoints and the `/v1/librarian/{method}` mapping, for a client in any language.
- `reference/core-api.md`: embedding the core in-process: every Librarian and Datastore method by concern, and the ports a host implements.

## Connecting to a hosted instance (URL + token)

The repo intentionally contains **no live instance URL and no tokens** (client
config never belongs in version control). For scripts/agents, configuration
lives in the project's untracked `.env` at the repo root:

```bash
TOOLKIT_URL=https://<your-instance>     # ask a maintainer, or your own deployment
TOOLKIT_TOKEN=aat_...                   # the account's default token, from the developer console
```

Tokens come from **accounts**. An admin makes developer accounts in the
instance's admin console (`/admin`, browser login popup: any username, the
admin password). The developer signs in at `/developer`; the sidebar shows
the account's **default token**, which every app, adapter and script of that
account uses. The console's own sign-in session token is refused outside the
console, and **Account & tokens** can make extra app tokens that are revoked on
their own. All of an account's state is partitioned by its `uid`.

**When a task needs the hosted service, do this first:**

1. Check the environment and `.env` for `TOOLKIT_URL` / `TOOLKIT_TOKEN` (an older `.env` may name them `TOOLKIT_SERVER_URL` / `TOOLKIT_SERVER_TOKEN`; the helper reads both).
2. If either is missing, **ask the user** for it (the URL comes from a
   maintainer or their own deployment; the token is the default token shown
   after signing in at `/developer`) and **offer to write both into
   `.env`** — create the file if needed, and confirm `.env` is gitignored
   *before* writing (`git check-ignore .env`).
3. Read the values from `.env` at run time — never hardcode them in code,
   commits, or generated files, and never echo the token back into output.
4. Verify the connection: `GET $TOOLKIT_URL/v1/whoami` with
   `Authorization: Bearer $TOOLKIT_TOKEN` returns the token's
   `{uid, label, kind}` (`kind` is `default` or `app`).

The browser extensions do **not** use `.env`. The adapter runtime
(`extension/` here) connects from its popup ("Connect with this console")
and keeps the address and token in `chrome.storage.local`. The personalized
extension lives in its own repository and keeps them in `chrome.storage.sync`
(`toolkitServerUrl` / `toolkitServerToken`), written by its Options page.
Do not write a token into any file in this repository other than `.env`.

## Running or deploying your own toolkit service

The reference service in `server/` is a zero-dependency `node:http` app that embeds the toolkit through its public barrel — it is both the hosted deployment and the template for running your own instance.

**Run locally** (file-backed storage, no cloud account needed). A coding agent starts one only when the person chooses it over their hosted toolkit, and never when `TOOLKIT_URL` and `TOOLKIT_TOKEN` are already set (see "Build an adapter with a coding agent", step 1). The repository's own tests start their own servers and need none of this.

```bash
ADMIN_PASSWORD=dev npm run dev:workshop      # from the repo root; --workshop lets any local page call /v1
# make an account (or use the admin console at http://localhost:8080/admin):
#   curl -X POST localhost:8080/admin/accounts -H 'Authorization: Bearer dev' \
#     -H 'content-type: application/json' -d '{"uid":"me"}'      # → 201 {account, password}
# then sign in at http://localhost:8080/developer for the default token
```

For a workshop, the admin console's **Fill in team-1 … team-10** makes a batch
of accounts and shows each password once (print or copy them then).

**Environment variables** (parsed from the server source at doc-generation time): `ADMIN_PASSWORD`, `CORS_ORIGINS`, `DATA_DIR`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `K_SERVICE`, `LOG_CONTENT`, `LOG_FORMAT`, `LOG_LEVEL`, `NODE_ENV`, `PORT`, `TOKEN_SECRET`, `TOOLKIT_BUCKET`, `WS_GEMINI_KEY`. `TOOLKIT_BUCKET` switches storage from the `DATA_DIR` file backend to GCS; `GEMINI_API_KEY` enables the server-side LLM lane (`extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt`) so clients never need a key; `ADMIN_PASSWORD` (a generated 16-character password) guards `/admin` (the admin console: developer accounts and tokens); `TOKEN_SECRET` derives each account's default token (it falls back to `ADMIN_PASSWORD`; when the secret in use changes, each account gets a new default token at its next sign-in and apps need the new one).

**npm scripts** (`server/package.json`):
- `npm run start` — `node index.js`
- `npm run test` — `node test/server-test.mjs && node test/adapters.test.mjs && node test/developer.test.mjs && node test/accounts.test.mjs && node test/apps.test.mjs && node test/learning.test.mjs && node test/access.test.mjs && node test/profile-events.test.mjs && node test/logging.test.mjs && node test/delete-cascade.test.mjs && node test/gcs-pagination.test.mjs && node test/gcs-write-retry.test.mjs && node test/token-conflict.test.mjs`
- `npm run docs` — `node scripts/generate-docs.mjs`

**Deploying**: `server/Dockerfile` builds from the repo root (it copies `toolkit/` + `server/`); `cloudbuild.yaml` + `server/DEPLOYMENT.md` document the Cloud Run deployment (small instance, Secret Manager for the secrets, GCS bucket, IAM). Keep `--max-instances 1` (connected Adapter MCP apps live in the process's memory, so a second instance would report them offline), `--timeout 3600` (each connected app holds one long server-sent-event request), and `CORS_ORIGINS=*` when browser apps on other origins must connect (`/v1` accepts bearer tokens only, never cookies). Everything else — accounts, tokens, profiles, presets, each account's last 200 MCP calls — is in the store and survives a restart. `server/API.md` is generated from the route table (`npm run docs` in `server/`) and the live service serves the same data at `GET /v1/meta`. Liveness: use `/v1/healthz` (bare `/healthz` is intercepted at the run.app edge).

**Extending the wire surface**: add a route entry in `server/src/routes.js` (plain `{route, target, kind}`, or a custom `invoke` for arg-shape dispatch — see `setPause`), then regenerate docs and update the oracle list in `server/test/server-test.mjs`. A remote-mode host wraps these routes in a Librarian-shaped facade.

## Adding this skill to your project

This skill ships **inside the toolkit repo** at `.claude/skills/ai4a11y-toolkit/SKILL.md`, so anyone opening this repo in Claude Code gets it automatically. To use it from **your own project**:

```bash
mkdir -p .claude/skills
cp -r <path-to-toolkit-repo>/.claude/skills/ai4a11y-toolkit .claude/skills/
```

Copy the whole folder: `scripts/adapter.mjs` (the helper in "Build an adapter with a coding agent") and `reference/` live next to `SKILL.md`. Claude Code discovers project skills in `.claude/skills/` on the next session, and so does opencode (it reads `.claude/skills/`, `.opencode/skills/` and `.agents/skills/`). If you vendor or depend on the toolkit, re-copy after upgrades (the file is generated from the toolkit source, so it always matches the version you copied it from — check the "Regenerate" line at the bottom to rebuild it against your checkout).

---

Regenerate with: `npm run docs` (from `toolkit/`). Full reference (surfaces, protocol schemas, barrel exports): `toolkit/API.md`.
