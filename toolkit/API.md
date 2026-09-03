# Toolkit API Reference

**Generated** from the toolkit source by `toolkit/scripts/generate-api-docs.mjs`
(reading `toolkit/scripts/introspect.mjs`'s model). Do not hand-edit — see
"Regenerate" at the bottom.

## Table of Contents

- [Quick Start](#quick-start)
- [Methods by Concern](#methods-by-concern)
  - [profile/ability](#profileability)
  - [memory](#memory)
  - [notes](#notes)
  - [proposals/consent](#proposalsconsent)
  - [skills](#skills)
  - [grants/sharing](#grantssharing)
  - [blob/transport](#blobtransport)
  - [acting-user/pauses](#acting-userpauses)
  - [core](#core)
- [Ports](#ports)
- [Surfaces](#surfaces)
- [Protocol](#protocol)
- [Barrel Exports](#barrel-exports-toolkitindexjs)

## Quick Start

`createToolkit` wired to the plain-Node reference adapters (`toolkit/platforms/node/`) — the template a new JS-runtime host (iOS/React Native bridge, XR runtime, a server) copies.

<!-- QUICKSTART:START -->
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
<!-- QUICKSTART:END -->

## Methods by Concern

Every method below was read off a REAL `createToolkit(...)` instance at doc-generation time — none of this is hand-transcribed, so it cannot drift from what is actually callable. `owner` is `librarian` or `datastore` — call as `toolkit.librarian.<method>(...)` / `toolkit.datastore.<method>(...)` from the object `createToolkit` returns.

### profile/ability

| Method | Async | Description |
| --- | --- | --- |
| `librarian.getProfile()` | async | (no doc comment) |
| `librarian.getAbilityModel()` | async | The modality-agnostic AbilityModel view (../core/ability). |
| `librarian.setProfileField(path, value)` | async | User-initiated edit — bypasses the proposal gate by design (the gate exists for *inferred* changes; explicit user intent needs no consent). |
| `librarian.recordExplicitSetting(key, value, origin)` | async | Fast lane for manual setting flips (popup toggle, onboarding choice). |
| `librarian.recordScopedSettings(scope, settings, opts)` | async | Generalized explicit-setting writer: upserts one durable user-explicit record PER setting key at the given scope (general \| category:<id> \| origin:<host> \| context:<id>). |
| `librarian.hasScopedSetting(scope, key)` | async | Whether a durable user-explicit record for `setting.<key>` exists at `scope`. |
| `librarian.getScopedSetting(scope, key)` | async | The current value of the user-explicit `setting.<key>` record at `scope`, or undefined if none. |
| `librarian.removeScopedSetting(scope, key)` | async | Delete the durable user-explicit record for `setting.<key>` at `scope` — the true inverse of recordScopedSettings (which only ever upserts). |
| `librarian.resetToProfile(opts)` | async | "Forget what I've changed, go back to my profile." undoLast is LIFO and per-session; resetUndo clears a journal without restoring anything. |
| `librarian.getSiteCategory(origin, opts)` | async | Classify once, cache forever; user override wins and is sticky. |
| `librarian.setSiteCategoryOverride(origin, category)` | async | (no doc comment) |
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

## Ports

The interfaces a host supplies to `createToolkit({ kv, clock, scheduler, consent, demo, ... })`, plus the separate `ActuationPort` (`toolkit/ports/actuation.js`) a host wires for voice/agent control surfaces. Read off the JSDoc `@typedef`/`@property` blocks in `toolkit/ports/index.js` and `toolkit/ports/actuation.js`.

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
| `source` (optional) | `string` | Always 'untrusted-page-content' on success — content to summarize, never instructions to follow. |
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

## Surfaces

Pure functions that render the SAME `AbilityModel` (`librarian.getAbilityModel()`) into a platform's own settings vocabulary. Adding a new platform means adding a new `toolkit/surfaces/*.js` file with this shape — this table picks it up automatically on the next `npm run docs`.

Every surface renderer takes the SAME input — the needs AbilityModel (librarian.getAbilityModel() shape — see core/ability.js).

| Module | Export | Params | Async | Description |
| --- | --- | --- | --- | --- |
| `surfaces/mobile.js` | `renderMobileSettings` (named) | `(model)` |  | mobile OS accessibility settings: { text: {scalePercent, lineSpacing, boldText}, display: {darkMode, highContrast, reduceTransparency}, motion: {reduceMotion}, media: {captions}, speech: {rate}, simplifyLanguage, touch: {largeTargets, minTargetPt} } A neutral (empty-needs) model renders every value at its OS default — no phantom adaptations. |
| `surfaces/web.js` | `renderWebSettings` (named) | `(model)` |  | web settings (subset of the registry's settingsMeta keys) |
| `surfaces/xr.js` | `renderXRSettings` (named) | `(model, sensors)` |  | XR rendering parameters |

## Protocol

The versioned JSON Schemas in `toolkit/protocol/` describing the toolkit's cross-app wire formats (profile blob, insight outbox, shared-transport envelope) — for a non-JS conformer implementing the same contract.

| Schema | kind | v | Required top-level fields |
| --- | --- | --- | --- |
| [`protocol/insight-outbox.schema.json`](../protocol/insight-outbox.schema.json) | `aa-insight-outbox` | 1 | `kind`, `v`, `sourceAppId`, `exportedAt`, `insights` |
| [`protocol/profile-blob.schema.json`](../protocol/profile-blob.schema.json) | `aa-profile-blob` | 1 | `kind`, `v`, `exportedAt`, `profile` |
| [`protocol/transport-envelope.schema.json`](../protocol/transport-envelope.schema.json) | _(version-only handshake)_ | 1 | `v` |

See [`protocol/README.md`](../protocol/README.md) for the full wire-format writeup, versioning rules, and fixtures.

## Barrel Exports (`toolkit/index.js`)

Everything importable from `@a11y-toolkit/core` (the package root).

| Export | Kind | From |
| --- | --- | --- |
| `createToolkit` | function | index.js |
| `createToolkit` | default | index.js |
| `createDatastore` | re-export | ./core/datastore.js |
| `createLibrarian` | re-export | ./core/librarian.js |
| `taxonomy` | re-export | ./core/taxonomy.js |
| `createSurfaceAdapter` | re-export | ./core/surface.js |
| `UNIT` | re-export | ./core/units.js |
| `SETTING_UNITS` | re-export | ./core/units.js |
| `unitOf` | re-export | ./core/units.js |
| `coerceSetting` | re-export | ./core/units.js |
| `coerceSettings` | re-export | ./core/units.js |
| `clampSetting` | re-export | ./core/units.js |
| `clampSettings` | re-export | ./core/units.js |
| `toAbilityModel` | re-export | ./core/ability.js |
| `normalizeNeed` | re-export | ./core/ability.js |
| `STRENGTH_RANK` | re-export | ./core/strength.js |
| `rankOf` | re-export | ./core/strength.js |
| `GRANT_SCOPES` | re-export | ./sync/index.js |
| `validateScopes` | re-export | ./sync/index.js |
| `normalizeGrant` | re-export | ./sync/index.js |
| `isActive` | re-export | ./sync/index.js |
| `filterAbilityModelByScopes` | re-export | ./sync/index.js |
| `buildProfileBlob` | re-export | ./sync/index.js |
| `validateProfileBlob` | re-export | ./sync/index.js |
| `BLOB_KIND` | re-export | ./sync/index.js |
| `BLOB_VERSION` | re-export | ./sync/index.js |
| `createSharedTransport` | re-export | ./sync/index.js |
| `EXPORT_PREFIX` | re-export | ./sync/index.js |
| `INBOX_KEY` | re-export | ./sync/index.js |
| `ENVELOPE_VERSION` | re-export | ./sync/index.js |
| `noopDemo` | star-re-export | ./ports/index.js |
| `noopSensors` | star-re-export | ./ports/index.js |
| `noopConsent` | star-re-export | ./ports/index.js |
| `noopScheduler` | star-re-export | ./ports/index.js |
| `systemClock` | star-re-export | ./ports/index.js |

---

Regenerate with: `npm run docs` (from `toolkit/`).
