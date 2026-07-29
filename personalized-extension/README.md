# Personalized Extension

AI-powered accessibility Chrome extension that **personalizes the web to each user**. Instead of mapping disability profiles to fixed tool sets, users describe their needs in plain language; a personal memory agent (the **Librarian**) learns their preferences over time, applies the right **adapters** per site, and — when nothing built-in fits — has an **Engineer** agent build a new adapter on demand.

> **Terminology.** An **adapter** is the executable code that adapts a page — built-in ones ship in a shared, read-only **Global db**, and users can generate their own in the **Adapter Builder**. A **skill** (`SKILL.md`) is a recipe that *composes* existing adapters for a need, built in the **Skill Builder**. Needing a new combination is common (skill); needing a brand-new capability is rare (adapter). Everything a user accumulates lives in their private **Mine** store. Internal code identifiers still say "skill" from an earlier naming — see the root `CLAUDE.md`.

## Architecture

The design separates a **shared, read-only Global database** from a **per-user, writable "Mine" datastore**, mediated by the Librarian. Two flows realize it:

| Diagram | What it shows |
|---|---|
| [`extension/demo/personal.svg`](extension/demo/personal.svg) | Personal ability-profile / memory flow: cold-start → Librarian → adapted page → continual update |
| [`extension/demo/skill-creation.svg`](extension/demo/skill-creation.svg) | Adapter-creation flow: explicit ("does it exist in the **global db**?") and implicit (Assistant does a task → propose to save) paths |

### The two databases

- **Global db — shared, read-only, shipped with the extension.** The corpus of built-in adapters every user starts from. **This is the folder the Data Corpus group contributes to (see [Shared adapter corpus](#shared-adapter-corpus-the-global-db) below).**
  - Code: [`skills/builtin/`](skills/builtin/) (the adapter modules) + [`skills/registry.js`](skills/registry.js) (their catalog/metadata). `build.js` generates `extension/lib/tools-registry.js` from the registry, exposed at runtime as `Datastore.global.tools()`.
- **Mine — per-user, writable, private.** Everything the user accumulates: their ability profile, learned preferences (memory), custom-built adapters, saved automations, the episodic log, and pending proposals. Stored in `chrome.storage` and owned exclusively by the Librarian.
  - Code: [`extension/lib/datastore.js`](extension/lib/datastore.js) — the `mine.*` entries in its `CATALOG` (e.g. `mine.skills` = custom adapters, `mine.profile` = ability profile, memory shards, `mine.proposals`).

### The agents

| Diagram label | Role | Code |
|---|---|---|
| **Librarian** (personal memory/profile agent) | Sole writer of the Mine store; recalls preferences, classifies sites, scopes adapters, gates proposals behind consent | [`extension/lib/librarian.js`](extension/lib/librarian.js) |
| **Assistant** (browser automation agent) | Performs one-off browser tasks via CDP; its outcomes can become saved, auto-replayed adapters | [`extension/browser-harness/`](extension/browser-harness/) |
| **Engineer** (Skill Builder) | Composes existing adapters into a new `SKILL.md` skill for a described need | [`extension/skill-builder/`](extension/skill-builder/) |

Behind the Engineer sits the **Adapter Builder** ([`extension/adapter-builder/`](extension/adapter-builder/)) — it generates a brand-new adapter as real JS, run as a user-script. Needs from onboarding go to the Skill Builder first, because most of them are a new combination of adapters that already exist; only what the Engineer can't compose gets handed on to the Adapter Builder.

## Shared adapter corpus (the Global db)

**`skills/builtin/` is the shared corpus — the diagram's "Global db" — and is where the Data Corpus group contributes.** Each file is one built-in adapter; [`skills/registry.js`](skills/registry.js) is the manifest that gives the AI recommender (and the "does this already exist in the global db?" check) its grounding metadata.

```
skills/
├── registry.js          # Catalog: id, name, description, supportAreas, settings,
│                        #   emoji, quickStart flag — the metadata the recommender
│                        #   and the global-db lookup are grounded in
└── builtin/             # The shared adapter corpus (one module per adapter)
    ├── dark-mode.js
    ├── auto-captions.js
    ├── visual-assist.js
    └── …                # ← Data Corpus group adds new shared adapters here
```

To contribute a shared adapter:

1. Write the adapter in the canonical `tools/adapters/` at the repository root, then re-export it here in one line so both extensions share the code:
   ```js
   // skills/builtin/my-adapter.js
   export * from '../../../tools/adapters/my-adapter.js';
   ```
   The build rewrites the canonical adapter's `utils/ai.js` import to this extension's provider, so the same file runs in both. A few adapters that genuinely diverged still keep their own code here — edit those in place.
2. Register it in `skills/registry.js` with its metadata (`supportAreas`, `settings`, a one-line `description` the recommender reads, and `quickStart: true` if it should appear in fast onboarding). New setting keys go in `settingsMeta` in the same file.
3. `npm run build` regenerates `extension/lib/tools-registry.js`, after which it's part of the Global db every user can be recommended and enable.

Because the Global db is **read-only at runtime**, contributions here are reviewed, shipped centrally, and shared across all users — distinct from a user's private custom adapters (which the Engineer writes into their **Mine** `mine.skills` store).

## How it works

**Personal memory flow** (see `personal.svg`):

1. **Cold-start** — Onboarding collects support areas + a free-text self-description; the Librarian seeds a personal ability profile.
2. **Adapt** — On each page, the Librarian resolves the effective preferences for that site (a scope chain: general → context → category → origin) and the content script applies the matching adapters. Site classification is automatic and cached (host-map + AI fallback).
3. **Continual update** — Deliberate changes (a toggle, an accepted suggestion) are recorded as durable, scoped preferences so they stick and stay private.

**Adapter-creation flow** (see `skill-creation.svg`):

- **Explicit** — The user describes a need; the Librarian checks the **Global db** ("does this already exist?"). If a built-in adapter or an existing skill covers it, that's applied — possibly scoped to a category like news sites. If not, the **Engineer** composes existing adapters into a new skill, and only a need no combination can cover goes on to the **Adapter Builder** for new code.
- **Implicit** — The **Assistant** performs a one-off browser task; if it looks reusable, the Librarian surfaces a consent-gated proposal to save it. On accept, it becomes an auto-replayed adapter for that site category.

## Built-in adapters

46 ship today, 16 of them flagged `quickStart` for fast onboarding. They cover
vision (29), cognitive (19), motor (14), reading (10), sensory (8), and
hearing (3) — an adapter usually serves more than one.

`skills/registry.js` is the list, with each adapter's description, support
areas, and the settings it controls. A few to give the range:

| Adapter | Description | Support Areas |
|-------|-------------|---------------|
| Auto Alt Text | AI-generated image descriptions | Vision |
| Explore Charts | Reads a chart back as a navigable data table | Vision |
| Simplify Text | AI rewrites complex text to simpler reading level | Cognitive, Reading |
| Generate Captions | AI-generated captions for video/audio content | Hearing |
| Dark Mode | Inverts page to dark theme | Vision, Sensory |
| Magnifier | Follows the cursor with a zoomed view | Vision |
| Reading Ruler | Horizontal guide that tracks the line you're on | Reading, Cognitive |
| Bigger Click Targets | Enlarges and spaces out small clickable controls | Motor, Vision |
| Confirm Actions | "Click again to confirm" guard on destructive buttons | Motor, Cognitive |
| Flash Guard | Suppresses flashing content (WCAG 2.3.1) | Sensory, Vision |
| Voice Commands | Hands-free browsing via voice | Motor |
| Visual Assist | Font scaling, spacing, large cursor, dyslexia font, focus enhancement | Vision, Reading |

## Install

```bash
# From the repository root
cd personalized-extension
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select the `personalized-extension/extension/` folder. (Developer mode also enables `chrome.userScripts`, which custom adapters require.)

## Gemini API Key

The extension uses Google's Gemini API for adapter recommendations, site classification, the Librarian's reasoning, and AI-powered adapters (alt text, simplification). Get a key from [Google AI Studio](https://aistudio.google.com/apikey) — the free tier allows 15 requests/minute. Enter it during onboarding or in the popup. The host-map portion of site classification and all built-in non-AI adapters work without a key.

## Project Structure

```
personalized-extension/
├── extension/
│   ├── manifest.json
│   ├── background.js            # Service worker: Gemini, user-script registration,
│   │                           #   site classification, Librarian message routing
│   ├── lib/                     # BUILT from toolkit/ + generated — don't hand-edit
│   │   ├── datastore.js         # Global (read-only) + Mine (per-user) datastore facade
│   │   ├── librarian.js         # Personal memory/profile agent — sole writer of Mine
│   │   ├── taxonomy.js          # Site categories + host-map for classification
│   │   ├── tools-registry.js    # Generated from skills/registry.js (the Global db at runtime)
│   │   ├── skills-db.js         # Generated from toolkit/skills/builtin/ (built-in skills)
│   │   └── demo-trace.js        # Demo-only instrumentation
│   ├── browser-harness/         # Assistant: CDP-driven browser automation agent
│   ├── skill-builder/           # Engineer: the Skill Builder (composes adapters)
│   ├── adapter-builder/         # Adapter Builder (writes a new adapter's code)
│   ├── onboarding/              # Cold-start onboarding flow
│   ├── popup/                   # Popup (toggles, suggestions, memory panel)
│   ├── sidepanel/               # Assistant side panel (voice + task running)
│   ├── permission/              # Consent prompts for cross-app access
│   ├── offscreen/               # Offscreen document (audio capture for voice)
│   ├── content/                 # Content script (bundled by esbuild)
│   └── demo/                    # Architecture diagrams + live highlighter
├── skills/
│   ├── registry.js              # Global db catalog + settingsMeta vocabulary
│   └── builtin/                 # Shared adapter corpus — mostly re-exports of
│                                #   tools/adapters/; Data Corpus group contributes here
├── utils/                       # Gemini abstraction, color/DOM utilities, recommender
├── skill-creator/               # Model-facing SKILL.md guidance for authoring adapters
├── test/                        # Librarian regression gate + browser tests
├── scripts/                     # Icon generation
├── build.js                     # esbuild config + tools-registry/skills-db generation
└── package.json
```

## Development

```bash
npm run watch    # Rebuild on changes
npm run build    # One-time build

node test/librarian-test.js      # Librarian regression gate
node test/run-tests.js           # Bundle + registry checks
node test/skills-page-test.js    # Skill Builder page (needs a local Chromium)
```

After building, reload the extension in `chrome://extensions` to pick up changes.
`extension/lib/*.js` is generated — edit `toolkit/` or `skills/registry.js` and rebuild.
