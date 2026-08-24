# Toolkit Core

The platform-agnostic heart of the AI for Accessibility Toolkit: the **Librarian**
(personal memory/profile agent), the **Datastore** (Global/Mine catalog facade),
the **ability and surface model**, the **skill layer**, and **cross-app sync**.
Pure logic — no `chrome.*`, no DOM, no `Date.now()`. Everything platform-specific
arrives through injected **ports**, so the same engine runs in a browser host
today and an iOS or XR host tomorrow.

```
toolkit/
├── index.js               createToolkit({ kv, clock, scheduler, consent, ... })
├── core/
│   ├── taxonomy.js        Site-category vocabulary + host classification
│   ├── datastore.js       createDatastore({ kv, clock, taxonomy, toolsRegistry, builtinSkills })
│   ├── librarian.js       createLibrarian({ datastore, taxonomy, clock, ... })
│   ├── units.js           Typed units for ability magnitudes
│   ├── strength.js        Requirement strength (how hard a need presses)
│   ├── ability.js         toAbilityModel(profile): the modality-neutral AbilityModel (needs[])
│   ├── surface.js         SurfaceProfile — ability rendered for one device
│   ├── memory-class.js    Memory taxonomy labels
│   ├── skill.js           SKILL.md parse / validate / resolve / match
│   └── skill-builder.js   The Engineer: builds a SKILL.md from a plain need
├── skills/builtin/        Starter SKILL.md playbooks
├── surfaces/              AbilityModel → per-device rendering (web.js, xr.js) — both
│                          read the SAME live needs[] librarian.getAbilityModel() returns
├── sync/                  Cross-app sharing: grants.js (scopes, audience ceiling,
│                          share-audit trail), blob.js, transport.js
├── ports/                 Port contracts a host must provide (JSDoc) + index
├── platforms/chrome/       Chrome host adapter (reference): port impls a
│                          browser host bundles into its own lib scripts
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
device-independent terms: `{ schemaVersion, supportAreas, freeText, language,
readingLevel, confidence, needs[] }`, where each `needs[]` entry is a
modality-neutral `{ dimension, value, strength, unit?, confidence?, source? }`.
A **surface** renders that SAME model into one device's settings:
`surfaces/web.js` produces web settings (font scale, dark mode),
`surfaces/xr.js` produces XR parameters (angular text size, world-locked
captions) — one needs vocabulary, two renderings.

## Memory scoping and the privacy floor

Memory is sharded along a scope chain — `general → context:* → category:* →
origin:*` — merged by specificity, so a narrow preference beats a general
default. `taxonomy.js` marks finance, health and government as **no-memory zones
by default**: profiles still adapt those pages, but nothing is recorded there
without an explicit opt-in.

## Cross-app sharing

`sync/grants.js` implements sharing between apps as a **visible, scoped,
default-deny grant**. Reads require a grant; writes arrive as proposals the
local user resolves. A consuming app can never approve its own request. Every
grant also carries an **audience** (`'personal' | 'friends' | 'anyone'`) — a
ceiling the profile's sharing level must clear, re-checked on every export so
lowering the level cuts off access immediately without revoking the grant —
and every grant/export/insight event is recorded to a **share-audit trail**
(`mine.shareAudit`, via `grants.js#recordShareAudit`). Both the ceiling check
and the audit writes live IN `core/librarian.js` itself (`requestGrant`'s
accept path, `revokeGrant`, `exportAbilityModel`, the cross-app-insight accept
path), so every host gets them for free — not just Chrome.

## Running the tests

```bash
cd toolkit && npm test          # ability model, skill layer, scenarios, cross-app
                                 # grants/audience/audit, plus the phase*.test.mjs suite
```
