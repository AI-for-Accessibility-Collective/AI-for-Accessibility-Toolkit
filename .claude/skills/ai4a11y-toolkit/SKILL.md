---
name: ai4a11y-toolkit
description: Use when building an accessibility adapter for a website in code (write it, publish it to the toolkit, run it in the browser with the toolkit's extension, check it, share it), building adaptations into your own web, mobile or XR app that follow the person's toolkit profile and show under the console's Apps, embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), sharing accessibility adapters between apps through Adapter MCP (the toolkit's adapter registry, the SDK, the browser runtime extension, the developer console's Adapters and Apps pages, MCP clients), talking to the hosted toolkit HTTP service with an account's default token, or running/deploying your own toolkit service instance (accounts, workshops, Cloud Run).
---

# AI for Accessibility Toolkit

The AI for Accessibility Toolkit is a platform-agnostic core (a Librarian personal-memory/profile agent plus a Datastore) that turns per-app accessibility settings into one portable, consent-gated understanding of a person's needs — the `AbilityModel` — shared across web, XR, and mobile hosts. A host wires a small set of injected ports (`KVStore`, `Clock`, `Scheduler`, `Consent`, ...) into `createToolkit(...)` and gets back a `{ datastore, librarian }` pair; every write an inference could be wrong about goes through the same proposal/consent machinery, never silently. Surface renderers (`toolkit/surfaces/*.js`) turn the same `AbilityModel` into platform-specific settings, and a hosted HTTP service (see below) lets non-JS clients call the same Librarian methods remotely.

This file is **generated** by `toolkit/scripts/generate-skill.mjs` from the same introspected model as `toolkit/API.md` — do not hand-edit; see "Regenerate" at the bottom.

## Build an adapter with a coding agent

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

1. Choose the toolkit to work with. **Do not start a toolkit on this computer unless the person asks for one.**
   - If `TOOLKIT_URL` and `TOOLKIT_TOKEN` are already set, in the environment or in a `.env` file at the top of the repository (`test -f .env`; leave the file closed), use them. Do not ask.
   - Otherwise ask the person: "Use your hosted toolkit (the usual choice), or start one on this computer?"
   - **Hosted** (the default): ask them to open their developer console, choose **Adapters**, then **+ New adapter**, and paste the two lines it shows into `.env` at the top of the repository. If they give you the address and token instead, write the two lines into `.env` yourself, and do not repeat the token back.
   - **On this computer**, only when they choose it: start it as in "Running or deploying your own toolkit service" (`ADMIN_PASSWORD=dev npm run dev:workshop`), make an account, have them sign in at `http://localhost:8080/developer`, and put that console's two lines into `.env`.
   - The helper below reads `TOOLKIT_URL` and `TOOLKIT_TOKEN` from `.env`. Keep the token out of your messages, other files and commits (git ignores `.env`).
2. Check that the person's browser runs adapters: `node <skill folder>/scripts/adapter.mjs check`. It prints "Connected: Chrome … on macOS, last seen …", or says that no browser runtime is connected. If none is, help them set up the extension:
   - Run `node <skill folder>/scripts/adapter.mjs extension`. It opens `chrome://extensions` in Chrome, copies the extension folder's path, and prints the steps.
   - Chrome lets only the person install it. Give them one step at a time and wait after each: turn on **Developer mode**; choose **Load unpacked** and pick the extension folder (on a Mac, Cmd+Shift+G in the folder picker, then paste); on the extension's **Details**, turn on **Allow User Scripts**; sign in to the developer console, open the extension from the toolbar and choose **Connect with this console**.
   - Run `check` again to confirm.
3. Before you write anything, ask the person what you need, in one message. Mark each question **Needed** or **Optional**, and give each optional one the default you will use. Leave out what they already told you. If they told you everything needed, do not ask: say which defaults you will use and go on. Wait for the answers to the needed questions.
   - **Needed**: what gets in their way on the page now, and what should change. For example: "the buttons are too small to hit", so "make them at least 44 pixels tall".
   - **Needed**: which site or pages, for example `https://example.com`, or only its checkout pages. This becomes `--runs-on`.
   - **Needed**: who it helps: vision, motor, hearing, cognitive, sensory or reading. This becomes `--for`. If what they said already points to one, suggest it and ask them to confirm.
   - **Optional**: a name. By default you name it after the change, such as "Bigger buttons".
   - **Optional**: how much, and where on the page, for example the size, the colors, or only the main menu. By default you pick a common value and say what it is.
   - **Optional**: anything on the page to leave alone. By default you change only what matches the problem.
   - **Optional**: whether to share it with everyone on their toolkit. By default it stays private to their account.
   - **Optional**: who can read what it gives the toolkit (what the person does with it, and its stored values): every app of theirs, or only this adapter. By default, every app of theirs.
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
2. Ask what you need, in one message, as in step 3 for a web adapter, with these questions:
   - **Needed**: what the app is and where it runs: a web, mobile or XR app.
   - **Needed**: which adaptations it has or should have, what each one changes, and who it helps: vision, motor, hearing, cognitive, sensory or reading.
   - **Needed**: which parts of the person's profile turn each one on, for example bigger text for someone who asked for it.
   - **Optional**: whether the toolkit can switch the adaptations on and off while the app is open, from the console's **Apps** page or a coding agent. By default, yes.
   - **Optional**: which observations the app sends, so the toolkit learns from them: what the person does that says something about their needs, such as switching an adaptation, or making the text bigger again after a reset. By default, only the person switching an adaptation themselves.
   - **Optional**: which suggested profile changes (proposals) the app shows the person to answer, for example only the ones that touch its own adaptations. By default, none: the person answers them on the console's Profiles page.
   - **Optional**: whether to share an adaptation's code with other apps through the toolkit's adapter registry. By default, no: it stays in the app.
   - **Optional**: who can read what the app gives the toolkit (its observations and what the toolkit learns from them): every app of theirs, or only this app. By default, every app of theirs.
   - **Optional**: whether observations carry images, such as a screenshot of what the person could not read. By default, no.
   - **Optional**: values the app or its adaptations keep in the toolkit between sessions, such as a chosen size. By default, none: the app keeps its own.
3. Follow the profile. Read it with `getProfile` (`POST /v1/librarian/getProfile`), and listen on `GET /v1/profile/events` so the app follows a change without a reload (see "Endpoints"). Turn on the adaptations the profile asks for. In JavaScript, the surface renderers in `toolkit/surfaces/` map the profile to platform settings.
4. Connect, so the app shows under **Apps**. Wrap each adaptation as an object with `enable(parameters)`, `disable()` and `enabled`, describe it with `defineDescriptor({ appId: '<app id>', ... })`, and connect with `connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ descriptor, adapter })] }) })` (see "Live control" in "Sharing adapters between apps"). The app is listed under **Apps** while it is open. Its adaptations stay out of the adapter registry and the console's **Adapters** page. If only the app should read what it gives the toolkit, set `visibility: 'app'` in `application`; an app without live control declares it with `registry.access.declare('<app id>', 'app')`.
5. Send the observations the person chose, each one plain sentence with `profile_observe` or `POST /v1/librarian/logObservation`, for example "Turned on Calm urgency on the Redbird store." Use `type: 'setting-change'` for a deliberate choice. Never page content or anything they typed. If the person chose images, add up to 4 as `images: [{ mimeType: 'image/png', data: <base64> }]`; they are kept with the observation and shown to the model when it learns. To keep values in the toolkit, use `registry.data({ appId, id }).set(key, value)` for an adaptation published to the registry.
6. If the app shows suggestions, read them with `profile_learned` (`registry.profile.learned()`), keep the ones the person chose (each has a `change`, such as `{op: 'profile-set', path: 'fields.largeTargets', value: true}`), show each in plain words, and pass on the person's answer with `profile_proposal_respond`: accept, declineOnce or suppress. Never answer for them. An accepted change reaches the app through `/v1/profile/events`, like any other profile change.
7. Check it: open the app, then the console's **Apps** page. The app is listed, and **Try it** switches each adaptation. A coding agent can do the same through `/v1/mcp/apps/<app id>`.
8. Only when the person asks to share an adaptation with other apps: publish it with `registry.publish` (see "Sharing adapters between apps"). A web adaptation can carry its code; any other is a description only.

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

## Methods by Concern

Read directly off a live `createToolkit(...)` instance — call as `toolkit.librarian.<method>(...)` / `toolkit.datastore.<method>(...)`.

### profile/ability

| Method | Async | Description |
| --- | --- | --- |
| `librarian.getProfile()` | async | (no doc comment) |
| `librarian.replaceProfile(profile)` | async | Replace the active profile in one write, including removal of omitted keys. |
| `librarian.getAbilityModel()` | async | The modality-agnostic AbilityModel view (../core/ability). |
| `librarian.setProfileField(path, value)` | async | User-initiated edit — bypasses the proposal gate by design (the gate exists for *inferred* changes; explicit user intent needs no consent). |
| `librarian.setProfileFields(fields)` | async | Set SEVERAL profile paths in ONE write. |
| `librarian.recordExplicitSetting(key, value, origin)` | async | Fast lane for manual setting flips (popup toggle, onboarding choice). |
| `librarian.recordScopedSettings(scope, settings, opts)` | async | Generalized explicit-setting writer: upserts one durable user-explicit record PER setting key at the given scope (general \| category:<id> \| origin:<host> \| context:<id>). |
| `librarian.hasScopedSetting(scope, key)` | async | Whether a durable user-explicit record for `setting.<key>` exists at `scope`. |
| `librarian.getScopedSetting(scope, key)` | async | The current value of the user-explicit `setting.<key>` record at `scope`, or undefined if none. |
| `librarian.removeScopedSetting(scope, key)` | async | Delete the durable user-explicit record for `setting.<key>` at `scope` — the true inverse of recordScopedSettings (which only ever upserts). |
| `librarian.resetToProfile(opts)` | async | "Forget what I've changed, go back to my profile." undoLast is LIFO and per-session; resetUndo clears a journal without restoring anything. |
| `librarian.getSiteCategory(origin, opts)` | async | Classify once, cache forever; user override wins and is sticky. |
| `librarian.setSiteCategoryOverride(origin, category)` | async | Record the person's own category for an origin. |
| `librarian.getEffectivePreferences(url, contexts)` | async | Deterministic scope-chain merge of machine-actionable settings. |
| `librarian.interpretNeedsPrompt(text)` | async | Prompt for the popup's "what support do you need?" flow. |

### memory

| Method | Async | Description |
| --- | --- | --- |
| `librarian.recall(url, task, contexts)` | async | Context block for agent prompts: core memory block + scored facts for this page + category playbook. |
| `librarian.listMemories(filter)` | async | (no doc comment) |
| `librarian.deleteMemory(id)` | async | (no doc comment) |
| `librarian.listProcedural(category)` | async | Procedural memory (Phase 2): what the person's assistant KNOWS HOW TO DO for them — custom adapters (mine.skills) and saved reusable actions (mine.profiles[].actions). |
| `librarian.logObservation(obs)` | async | The single entry point for observations — and the privacy floor. |
| `librarian.extract()` | async | Drain the episodic log behind the cursor: one Gemini call extracts candidate facts AND gates them against existing same-scope memories, returning ADD/UPDATE/SUPERSEDE/NOOP operations plus profile-tier proposal drafts. |
| `librarian.reflect()` | async | Daily consolidation. |

### notes

| Method | Async | Description |
| --- | --- | --- |
| `librarian.addNote(text, opts)` | async | Store one note. |
| `librarian.listNotes(filter)` | async | Browse what is stored. |
| `librarian.updateNote(id, patch)` | async | Re-file or reword one note. |
| `librarian.deleteNote(id)` | async | Forget one note outright. |
| `librarian.findNotes(query, opts)` | async | Query the prose. |

### proposals/consent

| Method | Async | Description |
| --- | --- | --- |
| `librarian.listProposals(status)` | async | (no doc comment) |
| `librarian.respondToProposal(id, response)` | async | accept \| declineOnce \| suppress. |

### skills

| Method | Async | Description |
| --- | --- | --- |
| `librarian.listSkills()` | async | All skills available to this person: built-in (global tier) + their own (mine.skillDocs). |
| `librarian.retrieveSkill(url, contexts)` | async | Retrieve the best-fitting skill for a page + this person (diagram: "Librarian retrieves the skill for use"). |
| `librarian.findSkillForNeed(need)` | async | The skill-creation flow's first diamond: "does the skill exist in the db?" — checked BEFORE the Engineer builds anything. |
| `librarian.resolveSkill(skill)` |  | Compile a skill to the deterministic apply-plan (settings + adapter ids) the host's adapter layer consumes. |
| `librarian.buildSkill(need, opts)` | async | The Engineer: build a new skill from a plain-language need, grounded in the real adapter catalog. |
| `librarian.saveSkill(skill)` | async | Persist a user-validated skill to their Skills db (mine.skillDocs). |
| `librarian.deleteSkill(name)` | async | (no doc comment) |

### grants/sharing

| Method | Async | Description |
| --- | --- | --- |
| `librarian.requestGrant(appId, scopes, opts)` | async | Ask the user (via a proposal) for read access to `scopes` of the AbilityModel. |
| `librarian.listGrants()` | async | The "what each app can see" panel's data: live (active) grants only — revoke is a delete, so anything still stored is active. |
| `librarian.revokeGrant(appId)` | async | Revoke = LOCAL DELETE (no tombstone, no propagation). |
| `librarian.exportAbilityModel(appId)` | async | Read-only, default-deny export of the granted AbilityModel slice. |
| `librarian.importInsight(sourceAppId, insight)` | async | The write half of cross-app flow: a granted app contributes something it learned (XR's FOV→text-size, ArtInsight's preferred description style). |
| `librarian.importInsightOutbox(outbox)` | async | Batch entry for a user-carried insight OUTBOX (the ArtInsight→web return path, or any consumer app's export). |
| `librarian.setSharingPaused(paused)` | async | The global cross-app OFF switch. |

### blob/transport

| Method | Async | Description |
| --- | --- | --- |
| `librarian.exportProfileBlob()` | async | §6 transport (b): the user deliberately exports a portable JSON blob on one device/app and imports it on another (the XR⇄web demo). |
| `librarian.importProfileBlob(blob)` | async | Merge an imported blob into the ACTIVE partition's profile. |

### acting-user/pauses

| Method | Async | Description |
| --- | --- | --- |
| `librarian.setActingUser(id, opts)` | async | A lightweight "who's using this now?" partition so two people on one device/headset never cross-contaminate. |
| `librarian.getActingUser()` |  | (no doc comment) |
| `librarian.setMemoryPaused(paused)` | async | (no doc comment) |
| `librarian.setOriginPaused(origin, paused)` | async | (no doc comment) |
| `datastore.setActingUser(id, opts)` | async | Switch the active partition. |
| `datastore.getActingUser()` |  | The active partition + helper-mode flag. |

### core

| Method | Async | Description |
| --- | --- | --- |
| `librarian.setGeminiCaller(fn)` |  | (no doc comment) |
| `datastore.catalog()` |  | (no doc comment) |
| `datastore.get(name)` | async | (no doc comment) |
| `datastore.set(name, value)` | async | (no doc comment) |
| `datastore.patch(name, fn)` | async | (no doc comment) |
| `datastore.memoryShardKey(scope)` |  | Memory fact shards. |
| `datastore.getMemoryShard(scope)` | async | (no doc comment) |
| `datastore.setMemoryShard(scope, records)` | async | (no doc comment) |
| `datastore.allMemoryShards()` | async | (no doc comment) |
| `datastore.global.tools()` |  | (no doc comment) |
| `datastore.global.taxonomy()` |  | (no doc comment) |
| `datastore.global.skills()` |  | Built-in skills (SKILL.md playbooks) shipped with the host. |
| `datastore.runMigrations()` | async | (no doc comment) |

## Ports contract

A host implements these to construct a toolkit instance (`createToolkit({ kv, clock, scheduler, consent, demo, ... })`) and, separately, `ActuationPort` for voice/agent control surfaces.

### KVStore (`ports/index.js`)

Async key/value access over named storage areas.

| Property | Type | Description |
| --- | --- | --- |
| `get` | `(area: string, key: string) => Promise<any>` | Resolve the raw stored value, or `undefined` when absent. |
| `set` | `(area: string, key: string, value: any) => Promise<void>` | Persist a value. |
| `getAll` | `(area: string) => Promise<Record<string, any>>` | Every entry currently in the area, as a `{ key: value }` map. |

### Clock (`ports/index.js`)

The only source of "now" the core may read.

| Property | Type | Description |
| --- | --- | --- |
| `now` | `() => number` | Epoch milliseconds, like `Date.now()`. |

### Scheduler (`ports/index.js`)

Deferred and recurring work.

| Property | Type | Description |
| --- | --- | --- |
| `every` | `(id: string, periodMinutes: number, handler: () => void) => void` | Run `handler` roughly every `periodMinutes`. |
| `debounce` | `(id: string, delayMs: number, handler: () => void) => void` | Run `handler` once, `delayMs` after the most recent call for this `id` (later calls reset the timer). |

### Consent (`ports/index.js`)

The accessible channel for surfacing pending consent items (proposals, cross-app grant requests, cross-app insights) to the user.

| Property | Type | Description |
| --- | --- | --- |
| `notifyPending` | `(count: number) => (void \| Promise<void>)` | Reflect that `count` items await the user's decision (0 clears it). |
| `present` (optional) | `(item: {type: 'proposal'\|'grant-request'\|'cross-app-insight', proposal: object}) => Promise<void>` | Surface one pending item in the host's accessible modality. |
| `capture` (optional) | `(proposalId: string) => Promise<'accept'\|'declineOnce'\|'suppress'\|null>` | Collect the user's decision for a presented item (null = no decision yet). |

### DemoHook (`ports/index.js`)

The extension's live-diagram instrumentation, lifted out of the core so the engine carries no `globalThis.AA_DEMO_MODE` / `globalThis.aaDemoTrace` reads.

| Property | Type | Description |
| --- | --- | --- |
| `isOn` | `() => boolean` | Live value of demo mode (read per call). |
| `trace` | `(diagram: string, region: string, label: string) => void` | Emit a diagram trace; no-op when no demo surface is attached. |

### Sensors (`ports/index.js`)

OPTIONAL.

| Property | Type | Description |
| --- | --- | --- |
| `read` | `(kind: string) => Promise<any>` | Read a named sensor (e.g. 'fov.textSizeMultiplier', 'device.dynamicType'). |

### ActuationPort (`ports/actuation.js`)

The host-agnostic surface a modality-neutral control layer actuates through.

| Property | Type | Description |
| --- | --- | --- |
| `getContext` | `() => Promise<SurfaceContext>` | Snapshot of the current surface: tab, zoom, which settings are non-default. |
| `applySettings` | `(changes: Object<string,*>, scope?: string\|null) => Promise<ApplyResult>` | Validate + clamp `changes` against the settings registry, persist them at the resolved scope, live-apply to the current surface, and journal enough to undo. |
| `undoLast` | `() => Promise<UndoResult>` | Revert the most recent applySettings call (LIFO); pops the journal only once the revert actually lands, so a failed undo keeps the step retryable. |
| `resetUndo` | `() => Promise<{ok:true}>` | Clear the undo journal (a fresh control-session starting). |
| `readPage` | `(mode?: 'outline'\|'text', chunk?: number) => Promise<ReadPageResult>` | Extract page text. |
| `pageAction` | `(action: string, target?: string, text?: string) => Promise<PageActionResult>` | Perform one page interaction (scroll/click/type/focus-nav/navigate/etc). |

**Provided default/no-op implementations:** `noopMedia` (ports/index.js), `noopDemo` (ports/index.js), `noopSensors` (ports/index.js), `noopConsent` (ports/index.js), `noopScheduler` (ports/index.js), `systemClock` (ports/index.js), `noopActuation` (ports/actuation.js).

### Supporting types (referenced by `ActuationPort`)

#### Media

| Property | Type | Description |
| --- | --- | --- |
| `put` | `(id: string, image: {mimeType: string, data: string}) => Promise<void>` | Store one image (`data` is base64). |
| `get` | `(id: string) => Promise<{mimeType: string, data: string}\|null>` | Read one image back, or null when it is gone. |
| `delete` | `(id: string) => Promise<void>` | Forget one image. |

#### SurfaceTab

| Property | Type | Description |
| --- | --- | --- |
| `title` | `string` | Sanitized (no control chars/newlines), capped ~120 chars. |
| `origin` | `string\|null` | Hostname of the active tab's URL, or null when off the web. |

#### SurfaceContext

| Property | Type | Description |
| --- | --- | --- |
| `tab` | `SurfaceTab\|null` | Null when there's no usable active tab. |
| `onWebPage` | `boolean` | True iff the active tab is a regular http(s) page. |
| `zoomPercent` | `number\|null` | Current page zoom, 25-500, or null if unknown/inapplicable. |
| `activeSettings` | `Object<string,*>` | Non-default settings currently in effect for this page (key -> value). |
| `siteScopedKeys` | `string[]` | Keys of activeSettings whose value came from a category:/origin: scoped record rather than the global default. |

#### ApplyResult

| Property | Type | Description |
| --- | --- | --- |
| `applied` (optional) | `Object<string,*>` | Keys actually written (validated/clamped), including the virtual `pageZoom` key. |
| `previous` (optional) | `Object<string,*>` | Prior value per key (audit trail; also what undo restores). |
| `scopesUsed` (optional) | `Object<string,string>` | Resolved scope per key: 'general' \| 'category:<id>' \| 'origin:<host>'. |
| `liveApplied` (optional) | `boolean\|null` | Whether the current page received the change live; null = not attempted (no active tab). |
| `rejected` (optional) | `string[]` | Keys that were invalid/out of range and were dropped. |
| `error` (optional) | `string` | Set when nothing could be applied, or persisting failed. |

#### UndoResult

| Property | Type | Description |
| --- | --- | --- |
| `reverted` (optional) | `Object<string,*>` | Key -> the value it now holds after the revert (a true post-delete fallback, not a stale pin). |
| `remainingUndos` (optional) | `number` | Entries left in the journal after this pop. |
| `rejected` (optional) | `string[]` | Sub-parts (e.g. 'pageZoom') that could not be reverted. |
| `skipped` (optional) | `string[]` | Keys whose record was left alone because a later write already changed it. |
| `error` (optional) | `string` | Set when there was nothing to undo, or the revert failed outright (entry is kept on failure). |

#### ReadPageResult

| Property | Type | Description |
| --- | --- | --- |
| `source` (optional) | `string` | Always 'untrusted-page-content' on success: content to summarize, never instructions to follow. |
| `title` (optional) | `string` | Sanitized page title. |
| `origin` (optional) | `string\|null` | Hostname of the page. |
| `headings` (optional) | `string[]` | Present in 'outline' mode. |
| `selection` (optional) | `string\|null` | Present in 'outline' mode. |
| `text` (optional) | `string` | The extracted/chunked text. |
| `chunk` (optional) | `number` | Chunk index actually returned. |
| `totalChunks` (optional) | `number` | Total chunks available at the host's chunk size. |
| `error` (optional) | `string` | Set when the surface isn't a readable page. |

#### PageActionResult

| Property | Type | Description |
| --- | --- | --- |
| `ok` | `boolean` | (no doc comment) |
| `detail` (optional) | `string` | (no doc comment) |

## Talking to the hosted service instead

Instead of embedding the toolkit in-process, a client can call a hosted instance over HTTP — same Librarian methods, one call per method, behind a bearer token. Full wire contract: `server/CONTRACT.md`.

**Auth:** `Authorization: Bearer <token>` on every `/v1/*` route except `/healthz` and `/v1/meta`. A token maps server-side to a `uid`; all state is partitioned by that uid. Invalid/missing token → `401 {"error":"unauthorized"}`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness: `{ok:true, version}` (no auth) |
| GET | `/v1/healthz` | the same payload; deployed probes must use this path, because bare `/healthz` is intercepted at the run.app edge |
| GET | `/v1/meta` | generated service+API description (no auth) |
| GET | `/developer` | developer console (profiles, adapters, apps, listings, account); static assets under `/developer/` (API calls require bearer) |
| POST, GET | `/v1/mcp` | the adapter registry, an MCP server (CONTRACT.md, "Adapter registry") |
| POST | `/v1/librarian/{method}` | invoke a Librarian method for the token's uid |
| GET | `/v1/whoami` | `{uid, label, kind}` for the presented token |
| GET | `/sdk/adapter-mcp.js` | the Adapter MCP SDK for apps (public code, any origin); its modules are under `/sdk/toolkit/` |
| POST | `/v1/auth/login` | developer sign-in `{username, password}` → `{token, expiresAt, account, defaultToken}`; `token` is a session |
| POST | `/v1/auth/logout` | end this session (session token) |
| GET | `/v1/account` | `{account, defaultToken, tokens, session, liveApps}` (session token) |
| PUT | `/v1/account` | rename the account `{displayName}` → `{account}`; the username stays (session token) |
| POST | `/v1/account/default-token` | regenerate the default token → `{defaultToken}` (session token) |
| POST | `/v1/account/tokens` | make an app token `{label?}` → `{token, id, label}`, shown once (session token) |
| DELETE | `/v1/account/tokens/{id}` | revoke one of the account's tokens (session token) |
| POST | `/v1/account/password` | change password `{current, next}` (session token) |
| GET | `/v1/account/presets` | `{presets}` saved profile presets (session token) |
| PUT | `/v1/account/presets` | replace saved presets `{presets}` (session token) |
| GET | `/v1/profile/selection` | `{revision, selected, updatedAt}`: the preset last loaded with `replaceProfile`, `selected` is `{id, name, edited}` or null (any token) |
| GET | `/v1/profile/events` | server-sent events: a `profile` event with that same object on connecting and on every profile write, so an app follows the profile without a refresh. It carries no profile content; read that with `getProfile` (any token) |
| GET | `/v1/profile/presets` | `{presets: [{id, name, description, builtIn}]}`: the console's built-in presets, then the account's saved ones (any token) |
| POST | `/v1/profile/select` | `{id}` makes that preset the active profile, as the console's Load profile does → `{revision, selected, updatedAt, profile}` (any token) |
| POST | `/v1/providers` | register an Adapter MCP app instance → `{providerId, endpoints}` (app or default token) |
| DELETE | `/v1/providers/{providerId}` | sign the instance off |
| GET | `/v1/providers/{providerId}/channel` | server-sent events: relayed MCP requests for the instance |
| POST | `/v1/providers/{providerId}/channel` | the instance's JSON-RPC response to one relayed request |
| POST | `/v1/mcp/providers/{providerId}` | MCP endpoint for one connected instance (same account) |
| POST | `/v1/mcp/apps/{appId}` | MCP endpoint for the app's single live instance (same account) |
| GET | `/v1/apps` | the account's connected apps, grouped by app, with `hiddenApps` |
| DELETE | `/v1/apps/{appId}` | forget an app that is not connected |
| PUT | `/v1/apps/{appId}/hidden` | hide the app in the developer console |
| DELETE | `/v1/apps/{appId}/hidden` | show it again |
| GET | `/v1/adapters` | list the adapter marketplace `{adapters, apps}`; filters `?app=` `?kind=` `?mine=1` `?installed=1` |
| POST | `/v1/adapters` | register an adapter `{appId, id, name, …}` → 201 `{adapter}`; `code` present makes kind `code` |
| POST | `/v1/adapters/sync` | publish an app's whole catalog `{appId, appName?, adapters[], full?}` |
| GET | `/v1/adapters/{appId}/{id}` | `{adapter}` |
| PUT | `/v1/adapters/{appId}/{id}` | update (registering uid or admin) |
| DELETE | `/v1/adapters/{appId}/{id}` | remove (registering uid or admin) |
| GET | `/v1/adapters/{appId}/{id}/code` | `{code, sha256, size, updatedAt}` for a kind-`code` listing |
| PUT | `/v1/adapters/{appId}/{id}/install` | mark installed for the calling uid |
| DELETE | `/v1/adapters/{appId}/{id}/install` | clear installed for the calling uid |
| GET | `/admin/accounts` | list developer accounts with token and live-app counts; `?passwords=1` → `{passwords: [{uid, displayName, password\|null, reason?}]}`, every admin-issued password; `?format=csv` → the same as a CSV download (username, name, password, password_note, status, last_sign_in, created, app_tokens, has_data) |
| POST | `/admin/accounts` | make an account `{uid, displayName?, password?}` → 201 `{account, password?}` |
| POST | `/admin/accounts/bulk` | make many `{accounts: [{uid, displayName?}]}` → `{results}` |
| PUT | `/admin/accounts/{uid}` | rename `{displayName}` |
| GET | `/admin/accounts/{uid}/password` | the password an admin issued `{password\|null, reason?}`; `null` once the developer changed it themselves |
| POST | `/admin/accounts/{uid}/password` | reset the password `{password?}` → `{password?}` |
| POST | `/admin/accounts/{uid}/disable` | turn off: revoke every token, disconnect its apps |
| POST | `/admin/accounts/{uid}/enable` | turn back on |
| DELETE | `/admin/accounts/{uid}` | delete the account, its data and its tokens |
| GET | `/admin/assets/console.js` | the admin console's script (public code) |
| POST | `/admin/tokens` | create token `{uid, label?, kind?}` → `{token, uid}` (token shown once) |
| GET | `/admin/tokens` | list `{id, uid, label, kind, createdAt, expiresAt?, revoked}` (no token values; `id` is what DELETE takes) |
| DELETE | `/admin/tokens/{id}` | revoke |
| GET | `/admin/users` | list `{users: uid[]}`, every uid holding stored state |
| DELETE | `/admin/users/{uid}` | delete that uid's partition and revoke its tokens; returns `{ok, uid, revokedTokens}` (a count), or 404 when the uid had neither data nor live tokens |
| GET | `/admin` | admin console (accounts, tokens, stored data) — browser login popup |

## `/v1/librarian/{method}`

- `{method}` is the camelCase Librarian method name (e.g. `getAbilityModel`,
  `recall`, `respondToProposal`) — the SAME names as the extension's
  `librarian*` message types with the `librarian` prefix dropped and the first
  letter lower-cased. `librarianEffectivePreferences` → `effectivePreferences`
  maps to `getEffectivePreferences` (alias table in the server route map).
- Body: `{"args": [...]}` — positional arguments exactly as the in-process
  method takes them. Missing body = `{"args": []}`.
- Success: `200 {"ok":true, "result": <return value>}`.
- Method threw: `200 {"ok":false, "error": "<message>"}` (application errors
  are data, not transport failures).
- Unknown method: `404 {"error":"unknown-method"}`.
- Methods that don't exist server-side by design (none today) must be listed in
  `/v1/meta` as `unsupported`.
- In addition to the 36 extension-message aliases, the following DIRECT-surface
  methods (called by the voice side panel on the Librarian object rather than
  via `librarian*` messages) are first-class routes under their own names:
  `interpretNeedsPrompt`, `hasScopedSetting`, `getScopedSetting`,
  `removeScopedSetting`, `recordExplicitSetting`, `resetToProfile`
  ("back to my profile": the bulk inverse of `recordScopedSettings`. Without a
  wire route a remote host's reset reaches nothing and reports success anyway).
- `setProfileFields` is a first-class route under its own name for the same
  reason, with no extension message behind it. Every profile field lives in one
  stored record, so a caller that writes four fields in four requests writes
  that record four times and a failure between any two of them leaves a profile
  that contradicts itself. Fields belonging to one form go over the wire
  together.
- The natural-language note methods — `addNote`, `listNotes`, `updateNote`,
  `deleteNote`, `findNotes` — are routes under their own names too. Notes are
  the free-form text the person wrote about their own needs; a hosted instance
  partitions them by uid like every other record, and they remain outside
  `GRANT_SCOPES`, so no other app can read one.
- `replaceProfile(profile)` replaces the entire active profile in one record
  write, removing omitted keys. It rejects non-JSON values, unsafe object keys,
  and malformed structured fields. The service manages `schemaVersion`,
  `createdAt`, and `updatedAt`. Memories, grants, and skills remain separate.
  An optional second argument `{id, name}` names the preset being loaded; the
  service keeps it as the selected profile (stored with the console's
  preferences). `{id, name, edited: true}` says the profile is that preset with
  changes (the console's temporary profile). A later `setProfileField`, `setProfileFields` or
  `respondToProposal` marks it `edited`, and a `replaceProfile` with no
  preset clears it. Every one of those writes also announces itself on
  `/v1/profile/events`.
- 49 routes total.

## Connecting to a hosted instance (URL + token)

The repo intentionally contains **no live instance URL and no tokens** (client
config never belongs in version control). For scripts/agents, configuration
lives in the project's untracked `.env` at the repo root:

```bash
TOOLKIT_SERVER_URL=https://<your-instance>     # ask a maintainer, or your own deployment
TOOLKIT_SERVER_TOKEN=aat_...                   # the account's default token, from the developer console
```

Tokens come from **accounts**. An admin makes developer accounts in the
instance's admin console (`/admin`, browser login popup: any username, the
admin password). The developer signs in at `/developer`; the sidebar shows
the account's **default token**, which every app, adapter and script of that
account uses. The console's own sign-in session token is refused outside the
console, and **Account & tokens** can make extra app tokens that are revoked on
their own. All of an account's state is partitioned by its `uid`.

**When a task needs the hosted service, do this first:**

1. Check `.env` for `TOOLKIT_SERVER_URL` / `TOOLKIT_SERVER_TOKEN`.
2. If either is missing, **ask the user** for it (the URL comes from a
   maintainer or their own deployment; the token is the default token shown
   after signing in at `/developer`) and **offer to write both into
   `.env`** — create the file if needed, and confirm `.env` is gitignored
   *before* writing (`git check-ignore .env`).
3. Read the values from `.env` at run time — never hardcode them in code,
   commits, or generated files, and never echo the token back into output.
4. Verify the connection: `GET $TOOLKIT_SERVER_URL/v1/whoami` with
   `Authorization: Bearer $TOOLKIT_SERVER_TOKEN` returns the token's
   `{uid, label, kind}` (`kind` is `default` or `app`).

The browser extensions do **not** use `.env` and do not live in this
repository. Their config lives in `chrome.storage.sync` (`toolkitServerUrl` /
`toolkitServerToken`), written by each extension's Options page. Do not write a
token into any file in this repository; the extension repository documents its
own demo-build configuration.

## Sharing adapters between apps (Adapter MCP)

**Adapter MCP** (profile `ai4a11y.adapter-mcp` `0.1.0`, on MCP `2025-11-25`) is how apps built with the toolkit **share adapters**: the toolkit service is an MCP server (the adapter registry, `/v1/mcp`) where an app publishes its adapters and other apps find and install them. A pre-alpha draft — the wire shapes can still change, and the adapters it carries are not validated with the people they are meant for, so treat what you build as a prototype. Design: `docs/design/adapter-mcp.md` (§14 is the registry); SDK guide: `toolkit/adapter-mcp/README.md`; wire checks: `toolkit/protocol/adapter/`.

**What gets shared.** An adapter is `{owner, appId, id}` (owner = the publishing account). A portable one carries a `web-module@1` package: one self-contained JavaScript file exporting an object with `enable(options)` and `disable()` (disable puts the page back), no `import`s, no network, no eval (`lintWebModule` says what is refused). Without a package it is a description only (XR, native). Each publish is a new revision; the registry computes `executionArtifactDigest` and `descriptorDigest`. **Private until the owner shares it**; installing your own follows the latest revision, installing someone else's pins the revision you chose.

```javascript
const { createRegistryClient, loadInstalledAdapters, defineDescriptor } =
  await import(`${TOOLKIT_URL}/sdk/adapter-mcp.js`);   // in Node: @ai4a11y/toolkit/adapter-mcp
const registry = createRegistryClient({ url: TOOLKIT_URL, token: DEFAULT_TOKEN });
const descriptor = defineDescriptor({ appId: 'my-app', id: 'big-text', name: 'Big text', version: '0.1.0',
  description: 'Makes the text bigger.', targets: [{ platforms: ['*'], urls: ['https://example.com/*'] }] });
await registry.publish({ appName: 'My app', descriptor, code: BIG_TEXT_SOURCE });  // a new revision, private
await registry.share({ appId: 'my-app', id: 'big-text' });                        // everyone on this toolkit can find it
const { adapters } = await registry.search({ url: location.href });                // yours + shared with you
await registry.install('my-app', adapters[0].adapter);                              // or 'browser-runtime'
for (const { adapter, entry } of await loadInstalledAdapters(registry, 'my-app')) adapter?.enable(entry.parameters);
```

**Registry tools** (`POST /v1/mcp` with any token of the account; `GET /v1/mcp` streams `notifications/resources/list_changed`; adapters are also resources `adapter://owner/appId/id`):

- `adapter_search` — Find adapters to adopt: your own and those other accounts shared on this toolkit. Returns summaries with each adapter's key, latest revision and where it runs.
- `adapter_get` — Read one adapter: its descriptor and, for a portable adapter, its package code, at the latest or a given revision.
- `adapter_publish` — Publish an adapter from your application as a new revision. With a package (web-module@1 code) other applications can run it; without one it is a description only. Private until shared.
- `adapter_share` — Share one of your adapters with everyone on this toolkit, or stop sharing it.
- `adapter_delete` — Delete one of your adapters and all its revisions. Apps that installed it stop receiving it.
- `adapter_install` — Install an adapter into one of your apps (for example browser-runtime), or change an installation: pin a revision, switch it off, turn it off on a site, set its parameters.
- `adapter_uninstall` — Remove an adapter from one of your apps.
- `adapter_installed` — What an app has installed, resolved to revisions, with packages when asked. A runtime calls this to stay in step.
- `adapter_report` — A runtime reports what happened when it ran adapters: applied, failed (with the error), skipped or removed, per page origin.
- `adapter_status` — The latest reports from your runtimes, per adapter and app.

**Profile and learning tools** (the same endpoint; SDK: `registry.profile.get()`, `.observe({text, origin, type, data, images, app, adapter})`, `.learned()`, `.learnNow()`, `.respond(id, 'accept' | 'declineOnce' | 'suppress')`, `.forget(id)`, `.pause(true)`, `.reset({memories})`). The toolkit learns about the person over time: apps report what the person did with `profile_observe` (one plain sentence, the site, small data, never page content), the registry adds running, removing and switching adapters in `browser-runtime`, and about 30 seconds after the last observation the service turns them into memories and suggested profile changes. **A suggestion changes the profile only when the person accepts it**: show it to them and pass on their answer, never accept for them. The developer console's Profiles page shows the same under "What your toolkit learned", with pause and reset. See `server/CONTRACT.md`, "Profile and learning tools".

- `profile_get` — Read the person's profile: their needs and settings, which every app renders.
- `profile_observe` — Tell the toolkit what the person did with an adapter or app, so it can learn: one plain sentence, the site, small details, and up to 4 images. Who can read it follows the visibility of the app or adapter it comes from. Skipped while learning is paused.
- `profile_learned` — What the toolkit learned: the memories it keeps, the suggested profile changes waiting for an answer, how many it suggested this week against its weekly limit, and whether learning is paused.
- `profile_learn_now` — Learn from the observations so far now, instead of waiting a little after the last one. Uses the toolkit's language model.
- `profile_proposal_respond` — Answer a suggested profile change: accept (the profile changes and apps follow it), declineOnce, or suppress.
- `profile_memory_delete` — Forget one memory.
- `profile_learning_pause` — Pause or resume learning. While paused, observations are not kept.
- `profile_learning_reset` — Start learning over: clear the suggested changes (the weekly count starts again at zero) and the "stop suggesting" list; with memories, also the memories and pending observations. The profile itself stays as it is.

**Who can read what an app or adapter gives the toolkit, and adapters' own data** (the same endpoint; SDK: `registry.access.declare(appId, 'user' | 'app')`, `.get()`, `.restrict({app} | {adapter}, level | null)`; `registry.data(adapterKey).get(key?)`, `.set(key, value)`, `.delete(key?)`). Each app and adapter declares a visibility for its observations, what the toolkit learns from them, and its stored data: `user` (every app of the person's account; the default), `app` (only that app), or `adapter` (only that adapter and the apps that run it). An app declares it with `app_declare` or `application.visibility` when it connects; an adapter with `visibility` in its descriptor. The person can narrow either in the developer console (the **Apps** and **Adapters** pages), never widen it. App- and adapter-level data is learned in a store of its own and never becomes a suggested change to the shared profile. The console session and the default token read everything; an app token bound to an app (the console's **Account** page, "For app") reads user-level data plus its own app's. An adapter's data is up to 4 MB of JSON per account.

- `app_declare` — Declare an app and who can read what it gives the toolkit: user (every app of the person) or app (only this app). The person can narrow it in the developer console.
- `access_get` — Who can read what each app and adapter gives the toolkit: what each declared, what the person chose, and the result. With an app token, only that app and its adapters.
- `access_restrict` — Narrow who can read what an app or adapter gives the toolkit (the developer console's setting). Only the account's own tools may, never an app token.
- `adapter_data_get` — Read an adapter's stored data: its settings and anything else it keeps between runs, for this account.
- `adapter_data_set` — Store one value for an adapter, for this account. Who can read it follows the adapter's visibility.
- `adapter_data_delete` — Delete one of an adapter's stored values, or all of them.

**The browser runtime** (`extension/`, an unpacked Chrome extension, Chrome 135+): it runs everything installed into the app `browser-runtime` as user scripts on the URLs each adapter targets, picks up a new revision in open pages without a reload, can be switched off per site from its popup, and reports applied / failed (with the error) / skipped per page origin with `adapter_report`. Setup: Load unpacked → turn on **Allow User Scripts** on its Details → sign in to the console → popup → **Connect with this console** (the skill's `adapter.mjs extension` walks a person through it, and `adapter.mjs check` confirms it). On connecting, the runtime checks in with an empty `adapter_report`, so `adapter_status` lists it before it runs anything. Adapters are built in code with a coding agent (the console's **+ New adapter** is a guide to that); the console's **Adapters** page edits them (live lint), saves revisions, runs them in the browser, shares them, installs others' and shows the runtime's reports.

SDK helpers: `createRegistryClient`, `loadInstalledAdapters`, `defineDescriptor`, `lintWebModule`, `createAdapterProvider`, `fromToggleAdapter`, `fromAction`, `connectToToolkit`, `detectBrowserPlatform`, `createMcpClient`, `adapterClient`, `catalogDescriptors`.

**Live control (optional).** An app that is open can also connect for live control: `connectToToolkit({ url, token, provider: createAdapterProvider({ application, adapters: [fromToggleAdapter({ adapter, descriptor })] }) })`. The toolkit relays standard MCP calls to it while it is connected: `POST /v1/mcp/apps/{appId}` (its single live instance) or `/v1/mcp/providers/{providerId}`; the console's **Apps** page offers the same as Try it. `createAdapterProvider` throws `AdapterMcpError` with the reasons for a bad descriptor; read them rather than loosening it. Tools a connected app answers (plus an `apply_<id>` shortcut per adapter, taking `{enabled, parameters?, target?, requestKey?}`):

- `adapter_list` — List the accessibility adapters this application exposes, with its platform and the guarantees it supports. Read-only.
- `adapter_describe` — Get one adapter's full descriptor (parameters, targets, effects) and whether it is available now. Read-only.
- `adapter_targets` — List concrete targets (pages, documents, apps) this adapter can address right now. Read-only.
- `adapter_query` — Read an adapter's current state on a target without changing anything. Read-only.
- `adapter_check` — Check whether a desired configuration could run on a target now, without applying it or calling AI. Read-only.
- `adapter_apply` — Apply, update, or turn off an adapter on one target. Stateful adapters take the complete desired configuration.
- `adapter_revert` — Undo an earlier apply using its receipt, if the adapter offered undo and nothing changed since.

A client pins the adapter it means with `adapterRef` = `{appId, id, version, descriptorDigest}`; undo works only through the receipt an apply returned. From Claude Code: `claude mcp add --transport http ai4a11y-toolkit $TOOLKIT_SERVER_URL/v1/mcp --header "Authorization: Bearer <default token>"` for the registry, and `…/v1/mcp/apps/<appId>` for one connected app.

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

Copy the whole folder: `scripts/adapter.mjs` (the helper in "Build an adapter with a coding agent") lives next to `SKILL.md`. Claude Code discovers project skills in `.claude/skills/` on the next session, and so does opencode (it reads `.claude/skills/`, `.opencode/skills/` and `.agents/skills/`). If you vendor or depend on the toolkit, re-copy after upgrades (the file is generated from the toolkit source, so it always matches the version you copied it from — check the "Regenerate" line at the bottom to rebuild it against your checkout).

---

Regenerate with: `npm run docs` (from `toolkit/`). Full reference (surfaces, protocol schemas, barrel exports): `toolkit/API.md`.
