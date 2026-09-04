# Contributing

This is a **toolkit**, not an app. Contributions extend one of three layers:

- the **core** (`toolkit/`) — the Librarian/datastore, ability model, skill
  engine, ports, surfaces, and reference platform bindings;
- the **catalog** (`tools/`) — reusable adapters, auditors, and profiles any
  host can draw from;
- the **service** (`server/`) — the hosted HTTP surface over the core.

Most contributions add an **adapter, auditor, profile, or skill** to the
catalog, a **surface** renderer, or a **platform port**.

## Set up

```bash
git clone <your fork>
cd <your clone> && npm install
npm test        # tools, toolkit, controller, and onboarding suites
```

Pure ES modules; the core has no build step. There is no browser extension in
this repo; hosts (web/mobile/XR/server) live in their own projects and consume
this toolkit. There is an experimental Python CLI in `cli/`, which drives a real
Chromium page and injects the catalog; see [cli/README.md](cli/README.md) for
its setup and tests.

## Skill or adapter — which am I building?

Usually **one, not both**:

- **Adapter** = executable **code** that performs one adaptation (the "hands").
  Build one only for a **brand-new capability** no existing adapter provides.
  Lives in `tools/adapters/`.
- **Skill** = a `SKILL.md` **recipe** composing existing adapters for a need
  (the "brain"). Build one for a **reusable combination/tuning** of things that
  already exist. No code. Lives in `toolkit/skills/builtin/`.

Rule of thumb: **new primitive → adapter (code); new recipe → skill (no code).**
A skill can only reference adapters that already exist.

## Cheat sheet

| I want to… | Do this |
|--------------|---------|
| **Detect an issue** | Add auditor → `tools/auditors/` → export from `index.js` |
| **Fix an issue** | Add adapter → `tools/adapters/` → add to `axeHandlers` in `index.js` |
| **Register a tool** | Add its entry to `toolkit/registry/tools.js` (`supportAreas`, `settings`, `description`) + any new keys to `settingsMeta` |
| **Combine adapters for a need** | Add skill → `toolkit/skills/builtin/<name>.md` |
| **Add a profile** | Edit `tools/profiles/settings.json` |
| **Render to a new platform** | Add a surface → `toolkit/surfaces/<name>.js` |
| **Support a new host runtime** | Implement the ports → `toolkit/platforms/<host>/` (copy `platforms/node/`) |

## Adding an auditor

Auditors find accessibility issues (axe-core for standard WCAG; custom for what axe misses).

```js
// tools/auditors/missing-headings.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then `export * from './missing-headings.js';` in `tools/auditors/index.js`.

## Adding an adapter

```js
// tools/adapters/fix-carousels.js
import { markProcessed } from '../utils/dom.js';

export const name = 'fix-carousels';
export const profiles = ['blind', 'motor'];

export function fixCarouselControls(carousel) {
  if (carousel.dataset.ai4a11yProcessed) return;
  markProcessed(carousel, 'pending');
  // ... fix logic ...
  markProcessed(carousel, 'done');
}

export const axeHandlers = { 'aria-required-attr': fixCarouselControls };
```

Then in `tools/adapters/index.js` add the export and spread its handlers, and
register the tool in `toolkit/registry/tools.js` (id, `supportAreas`,
`settings`, one-line `description`) plus any new setting keys in `settingsMeta`.
Read `tools/adapters/fix-tables.js` (heuristic + AI fallback) or
`tools/adapters/fix-landmarks.js` (deterministic) for a full example.

## Adding a profile

```json
// tools/profiles/settings.json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

The full settings vocabulary — every key, type, and range — is `settingsMeta` in
[`toolkit/registry/tools.js`](toolkit/registry/tools.js); it's the same vocabulary
`validateSkill` checks recipes against.

## Adding a skill

A `SKILL.md` composing existing adapters — no code:

````markdown
---
name: quiet-reading
description: Distraction-free, high-contrast reading. Use on articles and docs.
supportAreas: [cognitive, reading, sensory]
siteRelevance: [news, education, reference]
---

# Quiet Reading
Strips clutter and boosts contrast so text is easy to focus on.

## What it does
1. **reader-mode** — extracts the article into a clean view.
2. **focus-mode** — hides ads and side content.

## Recipe
```json
{
  "adapters": [
    { "id": "reader-mode", "settings": { "readerMode": true } },
    { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true } }
  ]
}
```
````

- The `Recipe` JSON is the runnable truth. Reference only adapter ids and setting
  keys that exist in the registry — `validateSkill` rejects unknown ones.
- Keep it minimal (1–4 adapters). Verify with `node toolkit/test/skill-test.js`.

A host's **Engineer** (`toolkit/core/skill-builder.js`) can also author skills
from a plain-language need at runtime — the same validation applies.

## Adding an AI capability

The core and adapters reach the model through a provider abstraction, never a
concrete SDK. Add the method to the provider interface (`tools/utils/ai.js` for
catalog adapters; the toolkit core takes an injected LLM caller) and implement it
in your host's provider. Keep prompts and the provider host-side.

## Testing

```bash
npm test                                 # tools, toolkit, controller, and onboarding suites
node toolkit/hosts/xr-demo/demo.js       # cross-surface + grants loop
node toolkit/hosts/skill-demo/demo.js    # retrieve → resolve → build → validate → save
node server/test/server-test.mjs         # hosted service
```

`toolkit/API.md` and the `ai4a11y-toolkit` skill are **generated** — if you
change the core API, regenerate them (see the note at the top of each file)
rather than hand-editing.

## PR guidelines

- One feature per PR.
- Tests must pass (`npm test` + the demos above).
- Regenerate `toolkit/API.md` / the skill if you changed the core surface.
- Describe who benefits (which disability/need).

## Code style

- ES modules throughout.
- Use the AI provider abstraction for AI features — no concrete SDK in core/catalog.
- Document which needs/profiles a feature helps.
- No large binaries — link externally.

## Package boundaries

The six top-level directories are packages with one direction of dependency.
`toolkit/` (the core) and `tools/` (the catalog) import from no sibling.
`server/`, `controller/`, and `cli/` depend inward on those two. `onboarding/`
is the one edge between neighbors: it reuses the server's auth, LLM caller,
store, and toolkit host, and serves the controller's modules to its chat page.

Four rules keep that shape, and `npm test` checks them
(`scripts/import-boundaries-test.mjs`):

1. **No relative import reaches past another package's public exports.**
   `toolkit/package.json` and `tools/package.json` have `exports` maps; an
   import into either has to land on a path the map exposes. A deep path the
   map does not list works in this repository and fails for anyone who
   installs the package. `server/`, `controller/`, and `cli/` have no exports
   map yet; the test treats every file as reachable in a package that has a
   manifest but no map, and only the root `.js` files in a directory with no
   manifest.
2. **A cross-package import is a dependency the importing package declares.**
   There are no npm workspaces yet, so "declares" means the edge is in the
   test's `ALLOWED` table (which package may import from which) and its
   `KNOWN_EDGES` list (which file imports what, with a one-line reason). When
   workspaces land, the declaration moves to `dependencies`.
3. **The graph stays acyclic.** The test checks both the table and what the
   code does.
4. **A new edge gets called out in review.** Add it to `KNOWN_EDGES` with its
   reason in the same change and say so in the PR description. The test fails
   until the entry exists, and fails again if the import goes away and the
   entry stays.

The test reads relative specifiers only. An import through a URL path a server
mounts (the way `onboarding/chat.js` loads `/controller/lib/...`) is an edge
too; call it out the same way.

## Ethics

- People with disabilities must be involved in design and evaluation.
- Compensate participants.
- Handle profiles and personalization data carefully.
- Don't simulate ability profiles without community input.

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
