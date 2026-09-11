# Contributing

This is a **toolkit**, not an app. Contributions extend one of three layers:

- the **core** (`toolkit/`) — the Librarian/datastore, ability model, skill
  engine, ports, surfaces, and reference platform bindings;
- the **catalog** (`tools/`) — reusable adapters, auditors, and profiles any
  host can draw from;
- the **service** (`server/`) — the hosted HTTP surface over the core.

Most contributions add an **adapter, auditor, profile, or skill** to the
catalog, a **surface** renderer, or a **platform port**.

Working on the browser extensions themselves (popup, onboarding, the
builders, voice mode, the web apps)? That code lives in the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension)
— see its CONTRIBUTING for the routing table.

**Want to help without writing code?** You can: tell us what happened when
you used the toolkit or the extensions ([SUPPORT.md](SUPPORT.md)), or
improve these docs — typos and unclear sentences are real contributions.
Neither requires programming, and if GitHub itself is a barrier, the email
route in [MAINTAINERS.md](MAINTAINERS.md) works for both.

## Contributions we're looking for

Beyond whatever you are personally interested in building, these are wanted and unowned (see
[ROADMAP.md](ROADMAP.md) for the full list):

- **`SKILL.md` recipes** — the best first contribution: no code, and it
  exercises the whole validation path. See "Adding a skill" below.
- **Adapters and auditors** for capabilities the catalog lacks — including
  translations of published accessibility review patterns (ARIA, contrast,
  keyboard navigation, forms, tables) into adapters.
- **Example applications** built on the toolkit — with or without the
  personalization core. We invite you to build this in a separate repository to keep only core components in this repository.
- **Per-audience documentation and walkthroughs** — non-code, high value.
- **Accessibility fixes to this repository itself** — image alt text and
  diagram descriptions first.
- **Real-use reports**: what you tried to build, where the API fought you.

Issues labeled `good first issue` are kept as on-ramps where they exist.

### Skills we'd love to see

*This is a placeholder section which we will build out, based on feedback from community engagement.*

## Set up

```bash
git clone <your fork>
cd <your clone> && npm install
npm test        # tools, toolkit, controller, and onboarding suites, plus the import-boundary check
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
A skill can only reference adapters that already exist. Every other term
(auditor, validator, preset, port, surface, grant) is defined once, in
[docs/GLOSSARY.md](docs/GLOSSARY.md).

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
Then add one line to `adaptersForTools` in `tools/profiles/settings.js` that
maps the new setting key to the adapter's module name;
`node tools/test/registry-parity-test.js` fails until the barrel, the registry,
and that mapping agree, and it checks every key of an entry on its own. Each
host keeps its own copy of the mapping (for the CLI, `applyProfileByName` in
`cli/cli-tools.js`), so an adapter a profile switches on needs a line there as
well. That test carries two lists for the cases the rule cannot express: add a
key that only shapes another key's adapter to `SUB_SETTINGS` under its entry
id, and a barrel module that is deliberately left without a registry entry to
`KNOWN_UNREACHABLE`, with the reason in a comment either way.
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

Profiles are starting points assembled from published guidance, not
characterizations of the people who pick them — say in the `description`
what the preset does, not who its users are. See
[docs/PROFILE-CARDS.md](docs/PROFILE-CARDS.md).

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
- `supportAreas` values come from `SUPPORT_AREAS` in
  [`toolkit/core/ability.js`](toolkit/core/ability.js); `siteRelevance` values
  are taxonomy categories ([`toolkit/core/taxonomy.js`](toolkit/core/taxonomy.js))
  or `all`. `validateSkill` rejects anything else, because retrieval matches on
  these two fields and a skill outside the vocabulary is never found again.
- Keep it minimal (1–4 adapters). Verify with `node toolkit/test/skill-test.js`.
- In the description, lead with the need the skill serves; name conditions
  only as examples ("Use when motion or clutter cause overload — common with
  migraine, vestibular disorders, or sensory sensitivity").

A host's **Engineer** (`toolkit/core/skill-builder.js`) can also author skills
from a plain-language need at runtime — the same validation applies.

## Adding an AI capability

The core and adapters reach the model through a provider abstraction, never a
concrete SDK. Add the method to the provider interface (`tools/utils/ai.js` for
catalog adapters; the toolkit core takes an injected LLM caller) and implement it
in your host's provider. Keep prompts and the provider host-side.

## Testing

```bash
npm test                                 # tools, toolkit, controller, and onboarding suites, plus the import-boundary check
node toolkit/hosts/xr-demo/demo.js       # cross-surface + grants loop
node toolkit/hosts/skill-demo/demo.js    # retrieve → resolve → build → validate → save
node server/test/server-test.mjs         # hosted service
```

Two suites drive a real headless Chromium and are kept out of `npm test` on
purpose, because they need a browser download that `npm install` does not do:

```bash
npx playwright install chromium          # one-time browser download
npm run validate:browser                 # each adapter's real effect and reversal in a real layout
npm run test:e2e                         # the /chat page end to end; the only test that runs onboarding/chat.js
```

Run both before opening a PR that touches `onboarding/`, `controller/`,
`tools/`, `toolkit/`, or `server/src/`. CI also runs them for such changes in
a separate job (`.github/workflows/browser.yml`) that does not block a merge;
a red result there is still worth reading before you ask for review.

`toolkit/API.md` and the `ai4a11y-toolkit` skill are **generated** — if you
change the core API, regenerate them (see the note at the top of each file)
rather than hand-editing. So is `toolkit/types/`, the core's type
declarations: `npm run build:types` regenerates it from the JSDoc, and CI
fails when it is stale.

## PR guidelines

- One feature per PR.
- Tests must pass (`npm test` + the demos above, plus the two browser suites
  if you touched `onboarding/`, `controller/`, `tools/`, `toolkit/`, or
  `server/src/`).
- Regenerate `toolkit/API.md` / the skill if you changed the core surface,
  and `toolkit/types/` (`npm run build:types`) if you changed a signature.
- Describe who benefits (which disability/need).

## What to expect from review

This is a time-boxed research project. During the active phase we review as
capacity allows; afterwards, review may be slow or paused while longer-term
maintainership is defined (see [ROADMAP.md](ROADMAP.md), Governance). An
unreviewed PR is a statement about our capacity, not about your
contribution.

## Forks and spin-offs

This project is a research probe with a deliberately small core. We do not
expect — or want — every idea to land in this repository. If the toolkit is
useful to you but you need it to go somewhere we aren't going, **fork it.
We consider that as a success, not a defection.**

What we ask in return is the learnings. If your fork or spin-off teaches
you something — an adapter that worked, a design that didn't, a need the
ability model can't express, results from testing with the people you built
it for — open an issue or a short write-up telling us what you found. Code
back is welcome; understanding back is the part we can't get any other way.

Practical notes for forkers:

- The Apache 2.0 license already permits all of this; this section is an
  invitation, not a condition.
- Please rename your fork enough that people don't mistake it for this
  project, and keep the "research probe, not validated, not a replacement
  for assistive technology" framing anywhere you inherit our claims.
- If you want your project listed alongside the others building on the
  toolkit, add it to [docs/projects.md](docs/projects.md) by pull request.

How outside contributions and forks will be handled longer term
(custodianship, reconciling forks) is still being defined; this section
will be updated when it is.

## Code style

- ES modules throughout.
- Use the AI provider abstraction for AI features — no concrete SDK in core/catalog.
- Document which needs/profiles a feature helps.
- No large binaries — link externally.

## Package boundaries

Six of the top-level directories are packages with one direction of
dependency: `toolkit/`, `tools/`, `server/`, `controller/`, `onboarding/`, and
`cli/`. `toolkit/` (the core) and `tools/` (the catalog) import from no sibling.
`server/`, `controller/`, and `cli/` depend inward on those two. `onboarding/`
is the one edge between neighbors: it reuses the server's auth, LLM caller,
store, and toolkit host, and serves the controller's modules to its chat page.

Four rules keep that shape, and `npm test` checks them inside those six
directories (`scripts/import-boundaries-test.mjs`). `examples/`, `scripts/`,
and `docs/` are outside the walk, so an import from there into a package is
not checked; keep it on a path the package's `exports` map exposes.

1. **No relative import reaches past another package's public exports.**
   `toolkit/package.json` and `tools/package.json` have `exports` maps; an
   import into either has to land on a path the map exposes. A deep path the
   map does not list works in this repository and fails for anyone who
   installs the package. `server/` and `onboarding/` have a manifest but no
   exports map yet, and `controller/` and `cli/` have no manifest; the test
   treats every file as reachable in a package that has a manifest but no
   map, and only the root `.js` files in a directory with no manifest. An
   import that has to land on a path the map does not expose goes in the
   test's `KNOWN_BREAKS` list with the reason it is tolerated, and the test
   fails again once it stops being a break.
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

The test reads relative import specifiers only. An import through a URL path
a server mounts (the way `onboarding/chat.js` loads `/controller/lib/...`) is
an edge too; call it out the same way. A file read by path is not an import
and is not checked: `toolkit/scripts/generate-skill.mjs` reads
`server/CONTRACT.md` and the server source when it generates the skill file,
and that script is not in the package's `files` list, so the published
package does not carry the reach.

## Ethics

- People with disabilities must be involved in design and evaluation.
- Compensate participants.
- Handle profiles and personalization data carefully.
- Don't simulate ability profiles without community input.

## Questions?

Open an issue on this repository (or the extension repository's, for
extension work). Current contact routes: [MAINTAINERS.md](MAINTAINERS.md).
