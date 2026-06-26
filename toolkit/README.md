# @a11y-toolkit/core

The portable personal-memory / ability-model engine extracted from the
AI-for-Accessibility Chrome extension. Platform-agnostic: the core touches no
`chrome.*`, no `Date.now()`, and no DOM — it depends only on **injected
ports**, so the same engine can run in a browser extension, an iOS app, an XR
runtime, or a test.

> **Status: Phase 0 of the refactor plan** ([../docs/toolkit-refactor-plan.md](../docs/toolkit-refactor-plan.md)).
> This phase *carves the seam* with **zero behavior change** for the extension.
> It does **not** yet split AbilityModel from SurfaceProfile (Phase 1), rename
> the memory taxonomy (Phase 2), or add cross-app sharing (Phase 3). It is a
> research prototype — see the plan for what's deliberately deferred.

## Layout

```
toolkit/
  index.js              createToolkit({ kv, clock, scheduler, consent, ... }) → { datastore, librarian }
  core/
    taxonomy.js         site-category vocabulary (pure data + methods)
    datastore.js        createDatastore({ kv, clock, taxonomy, toolsRegistry }) — catalog facade
    librarian.js        createLibrarian({ datastore, taxonomy, clock, scheduler, consent, demo })
  ports/
    index.js            the port interfaces (JSDoc) + no-op/system defaults
  adapters/
    chrome/             the ONLY place chrome.* lives
      ports.js          chromeKV / chromeClock / chromeScheduler / chromeConsent / chromeDemo
      *.entry.js        esbuild entry shims → built to the extension's lib/*.js classic scripts
```

## Ports (Phase 0)

| Port        | Purpose                                  | Chrome impl              |
|-------------|------------------------------------------|--------------------------|
| `KVStore`   | get/set/getAll over storage areas        | `chrome.storage.*`       |
| `Clock`     | `now()` — the only source of time        | `Date.now()`             |
| `Scheduler` | `every()` periodic + `debounce()`        | `chrome.alarms` + `setTimeout` |
| `Consent`   | `notifyPending(count)` — proposal signal | `chrome.action` badge    |
| `DemoHook`  | live-diagram instrumentation             | `globalThis.AA_DEMO_MODE` / `aaDemoTrace` |

The **LLM** is still injected post-construction via
`librarian.setGeminiCaller(fn)` (the pre-existing seam, unchanged).
`SecretStore`, `Sensors`, and `Surface` are named in the plan but are
host-owned / later-phase and not wired here.

## How the Chrome extension consumes this

The reference implementation is ES modules. The extension's service worker
(`importScripts`) and popup (`<script>`) need classic scripts that assign
`globalThis.AA_TAXONOMY` / `Datastore` / `Librarian`, so `build.js` bundles
each `adapters/chrome/*.entry.js` to an IIFE — the same pattern the repo
already uses for `harness.js` / `agent.js` / `tools-registry.js`.

**`personalized-extension/extension/lib/{taxonomy,datastore,librarian}.js` are
generated build outputs. Edit the source here under `toolkit/`, then
`npm run build`.**

## A new (non-Chrome) host

```js
import { createToolkit } from '@a11y-toolkit/core';
const { datastore, librarian } = createToolkit({
  kv: myKVStore,            // required
  clock: myClock,           // defaults to the system wall clock
  scheduler: myScheduler,   // defaults to no-op (drive extract/reflect yourself)
  consent: myConsent,       // defaults to no-op
  toolsRegistry: myTools,   // the settings/tools registry, or null
});
librarian.setGeminiCaller(myLlm);  // optional slow lane
```

## Tests (regression gate)

Run from `personalized-extension/` after `npm run build`:

- `node test/librarian-test.js` — 69 asserts, fast lane + reflection.
- `node test/toolkit-ports-test.js` — the Phase 0 port-seam paths.
- `node test/run-tests.js` — structural checks.

Both unit tests load the **built** `lib/*.js` bundles, so they also prove the
ES-module source survives esbuild + classic-script `eval` under the chrome
mock.
