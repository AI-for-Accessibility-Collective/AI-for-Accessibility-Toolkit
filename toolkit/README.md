# Toolkit Core

The platform-agnostic heart of the AI for Accessibility Toolkit: the **Librarian**
(personal memory/profile agent), the **Datastore** (Global/Mine catalog facade),
and the **site taxonomy**. Pure logic — no `chrome.*`, no DOM, no `Date.now()`.

This is Phase 0 of [docs/design/toolkit-refactor-plan.md](../docs/design/toolkit-refactor-plan.md):
the code that *understands the user* extracted behind stable interfaces so any
host — Chrome extension today, XR/iOS/mobile tomorrow — can run it.

```
toolkit/
├── core/                  # Platform-agnostic (ES modules, pure logic)
│   ├── ports.js          # Port contracts a host must provide (JSDoc)
│   ├── taxonomy.js       # Site-category vocabulary + host classification
│   ├── datastore.js      # createDatastore({ areas, globalTier, clock })
│   ├── librarian.js      # createLibrarian({ datastore, taxonomy, kv, ... })
│   ├── ability-model.js  # AbilityModel: device-independent understanding
│   ├── broker.js         # Cross-app permission broker (grants, export, insights)
│   ├── skill.js          # SKILL.md parse/validate/resolve/match (skill → adapters)
│   └── skill-builder.js  # The Engineer: builds a SKILL.md from a plain-language need
├── skills/builtin/        # Starter SKILL.md playbooks (reading-aid, calm-browsing, …)
├── surfaces/              # SurfaceAdapters: AbilityModel → per-device rendering
│   ├── web.js            # → web settings (fontScale, darkMode, ...)
│   └── xr.js             # → XR params (angular text size, world-locked captions)
├── adapters/
│   └── chrome/           # Chrome host adapter (entries bundled by
│                         #   personalized-extension/build.js into
│                         #   extension/lib/{taxonomy,datastore,librarian}.js)
├── hosts/
│   └── xr-demo/          # Runnable second consumer: node hosts/xr-demo/demo.js
└── test/                  # Node tests (no browser, in-memory ports)
    ├── ability-model-test.js
    └── broker-test.js
```

## AbilityModel and Surfaces (Phase 1)

`librarian.getAbilityModel()` returns the **AbilityModel** — what we
understand about the person in device-independent terms (relative
magnitudes, need-named enums, per-dimension confidence). Surfaces render it:

```js
const model = await librarian.getAbilityModel();
renderWebSettings(model);                          // { fontScale: 150, darkMode: true, ... }
renderXRSettings(model, { fovDegrees: 90 });       // { text: { angularSizeDeg: 0.525, ... }, ... }
```

The flagship cross-surface scenario: onboard once on the web; an XR host
reads the same model and sizes text by visual angle, world-locks captions,
and enables motion-comfort measures — no re-interviewing the user.

## Permission Broker (Phase 3)

`createBroker({ datastore, librarian })` is the policy layer for sharing the
person's understanding with other apps ("Access" / "Shareable with
permission control" in the architecture diagram):

- **Default deny** — apps hold explicit, revocable, audited grants naming
  which AbilityModel dimensions they may read (`ability.text`,
  `ability.vision`, …). The person's free-text self-description needs its
  own scope; raw memories and the episodic log are never reachable.
- **Insights arrive as proposals** — an app with write permission
  contributes through `importInsight()`, which routes into the Librarian's
  consent queue (same suppression/cooldown gates as internal inferences,
  with app provenance shown). Nothing auto-applies.

## Skills (the Engineer + Skills db)

A **skill** is a `SKILL.md` playbook that **orchestrates adapters** — instructions
(read by an agent) naming which adapters to apply, with what settings, for a
given need and page. Adapters are the executable code; a skill composes them.

```js
const skill = await librarian.retrieveSkill('https://news.example.com'); // best fit for person + page
librarian.resolveSkill(skill);            // → { settings: { fontScale: 130, focusMode: true, … }, adapterIds: [...] }
const { skill: built } = await librarian.buildSkill('bigger text when I shop'); // the Engineer authors a new one
await librarian.saveSkill(built);         // after the user validates it
```

A skill is both **model-facing** (the markdown body is instructions) and
**machine-runnable** (a fenced JSON recipe resolves deterministically to the
same settings the adapter layer already applies — no LLM at apply-time).
Starter skills live in `skills/builtin/`; author more as `.md` files.

## See the whole loop run

```bash
node toolkit/hosts/xr-demo/demo.js      # onboard once → web + XR + cross-app broker
node toolkit/hosts/skill-demo/demo.js   # retrieve → resolve → build → validate → save a skill
```

Onboard on web → grant a simulated XR app scoped access → XR renders
FOV-aware adaptations → XR's field-of-view insight flows back → lands as a
consent-gated proposal → accept → both surfaces update. No Chrome involved —
the core running on in-memory ports.

## Platform Ports

A host provides these to run the core (see `core/ports.js` for full contracts):

| Port | Purpose | Chrome implementation |
|------|---------|----------------------|
| `areas` | Keyed storage, `local` + `sync` areas | `chrome.storage.local` / `.sync` |
| `kv` | Bulk enumeration of memory shards | `chrome.storage.local.get(null)` |
| `scheduler` | Periodic jobs (extract every 30 min, reflect daily) | `chrome.alarms` |
| `clock` | `now()` — injectable for deterministic tests | `Date.now` |
| `notifier` | Pending-proposal count surfaced to the user | `chrome.action` badge |
| `globalTier` | Read-only shipped data (tools registry, taxonomy) | `globalThis.AA_TOOLS` / `AA_TAXONOMY` |
| `demo` | Demo-mode flag + trace hooks (optional) | `globalThis.AA_DEMO_MODE` / `aaDemoTrace` |

The LLM is injected at runtime via `librarian.setGeminiCaller(fn)` — the same
seam the Chrome background worker has always used.

## Consuming from a new host

```js
import { createDatastore } from './core/datastore.js';
import { createLibrarian } from './core/librarian.js';
import { TAXONOMY } from './core/taxonomy.js';

const datastore = createDatastore({ areas: myKeyedStorage, globalTier, clock });
const librarian = createLibrarian({
  datastore: () => datastore,
  taxonomy: () => TAXONOMY,
  kv, scheduler, clock, notifier,
});
librarian.setGeminiCaller(async (prompt) => myLLM.complete(prompt));
```

## Invariants (do not break)

- **Single-writer**: only the Librarian writes `mine.profile`, `mine.suppressions`,
  `mine.episodicLog`, `mine.proposals`, `mine.siteIndex`, `mine.views`, and
  memory shards.
- **Privacy floor**: observations on no-memory categories (finance/health/
  government), paused origins, or while globally paused are dropped at
  `logObservation` — the single entry point.
- **Suggest, never apply**: profile-tier changes become proposals; nothing
  inferred auto-applies.
- **Regression gate**: `personalized-extension/test/librarian-test.js` (69
  asserts) must pass against the built Chrome artifacts after any change here.
