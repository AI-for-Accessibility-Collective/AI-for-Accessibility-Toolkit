---
name: ai4a11y-toolkit
description: Use when building an accessibility adapter for a website in code (write it, publish it to the toolkit, run it in the browser, check it, share it), embedding the AI for Accessibility personalization toolkit (the Librarian/Datastore core) into a host app, calling its API directly, implementing a platform port (KVStore, Clock, Scheduler, Consent, ActuationPort, ...), sharing accessibility adapters between apps through Adapter MCP (the toolkit's adapter registry, the SDK, the browser runtime extension, the developer console's Adapters and Apps pages, MCP clients), talking to the hosted toolkit HTTP service with an account's default token, or running/deploying your own toolkit service instance (accounts, workshops, Cloud Run).
---

# AI for Accessibility Toolkit

The AI for Accessibility Toolkit is a platform-agnostic core (a Librarian personal-memory/profile agent plus a Datastore) that turns per-app accessibility settings into one portable, consent-gated understanding of a person's needs — the `AbilityModel` — shared across web, XR, and mobile hosts. A host wires a small set of injected ports (`KVStore`, `Clock`, `Scheduler`, `Consent`, ...) into `createToolkit(...)` and gets back a `{ datastore, librarian }` pair; every write an inference could be wrong about goes through the same proposal/consent machinery, never silently. Surface renderers (`toolkit/surfaces/*.js`) turn the same `AbilityModel` into platform-specific settings, and a hosted HTTP service (see below) lets non-JS clients call the same Librarian methods remotely.

This file is **generated** by `toolkit/scripts/generate-skill.mjs` from the same introspected model as `toolkit/API.md` — do not hand-edit; see "Regenerate" at the bottom.

## Build an adapter with a coding agent

An adapter is one JavaScript file that removes one barrier on a website, for example making small buttons bigger. The person says what should change, you write the file, and the toolkit runs it in their browser. The toolkit is a research project in pre-alpha and the adapters are unvalidated, so the person checks each change on the page.

**What the person does**

1. Once: set up the adapter runtime extension in Chrome (`extension/README.md`, "Set it up": Load unpacked, Allow User Scripts, Connect with this console).
2. In the developer console, open **Adapters** and choose **+ New adapter**. Copy the two lines it shows (the toolkit address and the default token) into a file named `.env` at the top of this repository. Git ignores `.env`, so the token stays out of commits.
3. Open this repository in a coding agent such as Claude Code or opencode, and say what to fix, for example: "Make an adapter that makes small buttons bigger on https://example.com." The agent picks up this skill on its own.
4. Open the page in Chrome. The change appears within a few seconds.
5. Say what to change next. You edit the file and publish again.

**What you do**

1. Check that `.env` exists at the top of the repository. The helper below reads `TOOLKIT_URL` and `TOOLKIT_TOKEN` from it, so leave the file closed: keep the token out of your messages, other files and commits. If it is missing, ask the person to copy the two lines from the developer console (**Adapters**, **+ New adapter**).
2. Write one file, such as `bigger-buttons.js`:
   - It exports one object with `enable(options)` and `disable()`.
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
3. Publish it and run it in the person's browser with the helper in this skill's folder (in this repository: `.claude/skills/ai4a11y-toolkit/scripts/adapter.mjs`; Node 18 or later, nothing to install):

   ```bash
   node <skill folder>/scripts/adapter.mjs publish bigger-buttons.js \
     --name "Bigger buttons" --runs-on "https://example.com/*" --for motor \
     --about "Makes small buttons 44 pixels tall, for people who find small targets hard to hit."
   ```
   - `--runs-on` is the pages, one flag per pattern: `https://example.com/*` is each page of that site, `http://localhost/*` is any local port.
   - `--for` is who it helps: vision, motor, hearing, cognitive, sensory, reading.
   - If the toolkit refuses the file, the message names the line. Fix it and run the command again.
4. Check that it ran: `node <skill folder>/scripts/adapter.mjs status bigger-buttons` prints "Running on …", or "Failed on …" with the error. Fix the file and publish again. Each publish is a new revision, and open pages pick it up without a reload.
5. When the person asks, share it with everyone on their toolkit: `node <skill folder>/scripts/adapter.mjs share bigger-buttons`. Until then it stays private to their account.

The adapter also shows on the developer console's **Adapters** page, where the person can read the code and its reports. To publish from your own app's code instead, see "Sharing adapters between apps" below.

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

**Provided default/no-op implementations:** `noopDemo` (ports/index.js), `noopSensors` (ports/index.js), `noopConsent` (ports/index.js), `noopScheduler` (ports/index.js), `systemClock` (ports/index.js), `noopActuation` (ports/actuation.js).

### Supporting types (referenced by `ActuationPort`)

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

**The browser runtime** (`extension/`, an unpacked Chrome extension, Chrome 135+): it runs everything installed into the app `browser-runtime` as user scripts on the URLs each adapter targets, picks up a new revision in open pages without a reload, can be switched off per site from its popup, and reports applied / failed (with the error) / skipped per page origin with `adapter_report`. Setup: Load unpacked → turn on **Allow User Scripts** on its Details → sign in to the console → popup → **Connect with this console**. The console's **Adapters** page is where a developer writes an adapter (live lint), saves revisions, runs it in their browser, shares it, installs others' and sees the runtime's reports.

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

**Run locally** (file-backed storage, no cloud account needed):

```bash
ADMIN_PASSWORD=dev npm run dev:workshop      # from the repo root; --workshop lets any local page call /v1
# make an account (or use the admin console at http://localhost:8080/admin):
#   curl -X POST localhost:8080/admin/accounts -H 'Authorization: Bearer dev' \
#     -H 'content-type: application/json' -d '{"uid":"me"}'      # → 201 {account, password}
# then sign in at http://localhost:8080/developer for the default token
```

For a workshop, the admin console's **Fill in team-1 … team-10** makes a batch
of accounts and shows each password once (print or copy them then).

**Environment variables** (parsed from the server source at doc-generation time): `ADMIN_PASSWORD`, `CORS_ORIGINS`, `DATA_DIR`, `GEMINI_API_KEY`, `K_SERVICE`, `LOG_FORMAT`, `LOG_LEVEL`, `NODE_ENV`, `PORT`, `TOKEN_SECRET`, `TOOLKIT_BUCKET`. `TOOLKIT_BUCKET` switches storage from the `DATA_DIR` file backend to GCS; `GEMINI_API_KEY` enables the server-side LLM lane (`extract`/`reflect`/`buildSkill`/`interpretNeedsPrompt`) so clients never need a key; `ADMIN_PASSWORD` (a generated 16-character password) guards `/admin` (the admin console: developer accounts and tokens); `TOKEN_SECRET` derives each account's default token (it falls back to `ADMIN_PASSWORD`; when the secret in use changes, each account gets a new default token at its next sign-in and apps need the new one).

**npm scripts** (`server/package.json`):
- `npm run start` — `node index.js`
- `npm run test` — `node test/server-test.mjs && node test/adapters.test.mjs && node test/developer.test.mjs && node test/accounts.test.mjs && node test/apps.test.mjs && node test/profile-events.test.mjs && node test/logging.test.mjs && node test/delete-cascade.test.mjs && node test/gcs-pagination.test.mjs && node test/gcs-write-retry.test.mjs && node test/token-conflict.test.mjs`
- `npm run docs` — `node scripts/generate-docs.mjs`

**Deploying**: `server/Dockerfile` builds from the repo root (it copies `toolkit/` + `server/`); `cloudbuild.yaml` + `server/DEPLOYMENT.md` document the Cloud Run deployment (small instance, Secret Manager for the secrets, GCS bucket, IAM). Keep `--max-instances 1` (connected Adapter MCP apps live in the process's memory, so a second instance would report them offline), `--timeout 3600` (each connected app holds one long server-sent-event request), and `CORS_ORIGINS=*` when browser apps on other origins must connect (`/v1` accepts bearer tokens only, never cookies). Everything else — accounts, tokens, profiles, presets, each account's last 200 MCP calls — is in the store and survives a restart. Logs are structured JSON on Cloud Run (requests, sign-ins, account and token changes, apps connecting, MCP calls, errors with stacks; never passwords, tokens or profile content); DEPLOYMENT.md shows routing them to a 365-day log bucket. `server/API.md` is generated from the route table (`npm run docs` in `server/`) and the live service serves the same data at `GET /v1/meta`. Liveness: use `/v1/healthz` (bare `/healthz` is intercepted at the run.app edge).

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
