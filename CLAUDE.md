# AI for Accessibility Toolkit

A general, platform-agnostic toolkit developers embed to add **agentic
accessibility** to any app. It is a library, not an application: no browser
extension, no bundled UI. Host apps (web, mobile, XR, server) wire in platform
ports and consume the core, the catalog, or the hosted service.

## Architecture

- `toolkit/` — the platform-agnostic core. Sub-parts:
  - `core/`: Librarian (memory/profile agent), datastore, the ability model
    (`ability.js`, `surface.js`, `strength.js`, `units.js`, `memory-class.js`,
    `taxonomy.js`), and the skill engine (`skill.js`, `skill-builder.js`). The
    old broker was folded into `sync/grants.js` and the Librarian. Imports only
    `ports/` and `sync/` — never a surface, adapter, or catalog.
  - `ports/` — the interfaces a host implements (KVStore, Clock, Scheduler,
    Consent, actuation). The core reaches every platform capability through these.
  - `surfaces/` — pure renderers mapping an AbilityModel → per-platform settings
    (`web.js`, `xr.js`).
  - `platforms/node/`, `platforms/chrome/` — reference host implementations of the
    ports (the template a new host copies).
  - `registry/` — the canonical tools catalog + settings vocabulary.
  - `skills/builtin/` — starter `SKILL.md` recipes.
  - `sync/`, `protocol/` — profile-blob transport + JSON-schema wire contracts.
  - `hosts/` — runnable demos (`xr-demo`, `skill-demo`).
- `tools/` — the developer **catalog**: `adapters/` (executable fixes),
  `auditors/` (issue detectors), `profiles/` (ability presets), `utils/`.
- `server/` — hosted HTTP service exposing the Librarian methods to any
  language/runtime.
- `cli/` — the Python CLI (`ai4a11y`) that drives a real page over the
  DevTools Protocol and bundles the catalog as `cli/cli-tools.bundle.js`.
  Rebuild the bundle with `npm run build:cli` and commit it; CI fails on drift.
- `controller/` — an **optional** UI layer (a sibling of the toolkit, not part
  of the core): the default text/voice control surface that drives any app
  through a neutral `ControlPort`. It *consumes* the toolkit (imports
  `../toolkit/registry/tools.js` for the settings vocabulary); the toolkit never
  depends on it. See `controller/DESIGN.md` + `controller/PROTOCOL.md`.
- `onboarding/` — a zero-dep example host serving three surfaces on one port:
  `/chat` (the front door; `/` redirects there — one conversational input doing
  both profile capture and app control, over the same `createController` core),
  `/onboarding` (the step-by-step form), and `/controller` (the widget demo).
  Runs `local` (its own data dir) or `remote` (proxying `server/`) — in local
  mode alongside a running service it warns about the two-store split.
- `examples/`, `docs/` — runnable examples and documentation.

`createToolkit({ kv, clock, scheduler, consent, ... }) → { datastore, librarian }`
is the entry point. See `toolkit/API.md` (generated) and the `ai4a11y-toolkit`
skill for the full surface.

## Terminology

- **AbilityModel** — the device-independent understanding of a person's needs.
  Every surface renders it; hosts never store platform settings as the source of
  truth.
- **Adapter** — executable code performing one accessibility fix. The catalog is
  `tools/adapters/`; the registry (`toolkit/registry/tools.js`) is the manifest of
  them + their settings vocabulary.
- **Skill / `SKILL.md`** — a model-facing recipe composing adapters for a need.
  The **Engineer** (`toolkit/core/skill-builder.js`) authors them; they resolve
  deterministically at apply-time (no LLM). Starter recipes: `toolkit/skills/builtin/`.
- **Auditor** — code in `tools/auditors/` that finds issues for adapters to fix.
- **Port / Surface / Host** — a host implements ports and (optionally) a surface;
  the core stays platform-free.

## Known tradeoffs (context for reviewers)

1. **Acting-user partition: job anchoring** (`toolkit/core/`) — The datastore's
   `partitionKey` isolation is total; background jobs are anchored to the
   partition that enqueued them, and `setActingUser` drains in-flight writes.
   Two **accepted residual limitations** (prototype-scoped, first-party /
   mistakes-not-malice): (a) `setActingUser`'s drain wait has no timeout, so a
   hung LLM call in an in-flight `extract` can delay a partition switch — a host
   should give its LLM fetch an `AbortSignal` timeout; (b) cross-app insight
   proposals share the user's single weekly proposal budget with no per-source
   sub-cap.

## Build & Test

Pure ES modules, no build step for the core. The one generated file is
`cli/cli-tools.bundle.js` (`npm run build:cli`). Run the suites:

```bash
npm test                       # tools, toolkit, controller, and onboarding suites
node toolkit/hosts/xr-demo/demo.js
node toolkit/hosts/skill-demo/demo.js
node server/test/server-test.mjs
```

`toolkit/API.md` and the `ai4a11y-toolkit` skill are **generated** from the
introspected model — edit the source and regenerate (see the note at the top of
each), never hand-edit.
