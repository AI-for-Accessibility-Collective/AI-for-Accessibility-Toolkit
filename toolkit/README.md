# Toolkit Core

The platform-agnostic heart of the AI for Accessibility Toolkit: the **Librarian**
(personal memory/profile agent), the **Datastore** (Global/Mine catalog facade),
the **ability and surface model**, the **skill layer**, and **cross-app sync**.
Pure logic — no `chrome.*`, no DOM, no `Date.now()`. Everything platform-specific
arrives through injected **ports**, so the same engine runs in a Chrome extension
today and an iOS or XR host tomorrow.

```
toolkit/
├── index.js               createToolkit({ kv, clock, scheduler, consent, ... })
├── core/
│   ├── ports.js           Port contracts a host must provide (JSDoc)
│   ├── taxonomy.js        Site-category vocabulary + host classification
│   ├── datastore.js       createDatastore({ areas, globalTier, clock })
│   ├── librarian.js       createLibrarian({ datastore, taxonomy, kv, ... })
│   ├── units.js           Typed units for ability magnitudes
│   ├── strength.js        Requirement strength (how hard a need presses)
│   ├── ability.js         Ability dimensions, device-independent
│   ├── surface.js         SurfaceProfile — ability rendered for one device
│   ├── memory-class.js    Memory taxonomy labels
│   ├── ability-model.js   AbilityModel: the device-independent understanding
│   ├── broker.js          Cross-app permission broker (grants, export, insights)
│   ├── skill.js           SKILL.md parse / validate / resolve / match
│   └── skill-builder.js   The Engineer: builds a SKILL.md from a plain need
├── skills/builtin/        Starter SKILL.md playbooks
├── surfaces/              AbilityModel → per-device rendering (web.js, xr.js)
├── sync/                  Cross-app sharing: grants.js, blob.js, transport.js
├── ports/                 Port index
├── adapters/chrome/       Chrome host adapter. build.js bundles these entries
│                          into personalized-extension/extension/lib/*.js
├── hosts/                 Runnable consumers, no browser needed
│   ├── xr-demo/           node hosts/xr-demo/demo.js
│   └── skill-demo/        node hosts/skill-demo/demo.js
└── test/                  Node tests against in-memory ports
```

## Two layers, and which is which

**Adapters** are the executable code that changes a page; they live in the
repository-root `tools/adapters/`. A **skill** (`SKILL.md`) is a recipe naming
which adapters to run, with what settings, in what order — plus optional
**action steps** the browser agent performs. `core/skill.js` parses and resolves
a skill **deterministically**: no model runs at apply time.

## Ability, surfaces, and strength

`librarian.getAbilityModel()` returns what we understand about the person in
device-independent terms — relative magnitudes in typed units, need-named enums,
requirement strength, and per-dimension confidence. A **surface** renders that
into one device's settings: `surfaces/web.js` produces web settings (font scale,
dark mode), `surfaces/xr.js` produces XR parameters (angular text size,
world-locked captions).

## Memory scoping and the privacy floor

Memory is sharded along a scope chain — `general → context:* → category:* →
origin:*` — merged by specificity, so a narrow preference beats a general
default. `taxonomy.js` marks finance, health and government as **no-memory zones
by default**: profiles still adapt those pages, but nothing is recorded there
without an explicit opt-in.

## Cross-app sharing

`sync/` and `core/broker.js` implement sharing between apps as a **visible,
scoped, default-deny grant**. Reads require a grant; writes arrive as proposals
the local user resolves. A consuming app can never approve its own request.

## Running the tests

```bash
cd toolkit && npm test          # ability model, broker, skill layer
node --test test/phase1.test.mjs test/phase3.test.mjs test/phase3-crossapp.test.mjs
```
