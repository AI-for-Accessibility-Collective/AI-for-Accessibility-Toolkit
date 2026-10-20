# Adding to the catalog

This page has the step-by-step instructions for adding a skill, adapter,
auditor or profile. If you haven't set up the repository yet, start with
[CONTRIBUTING.md](../CONTRIBUTING.md).

| I want to... | Where |
|---|---|
| Combine adapters for a need | A skill in `toolkit/skills/builtin/` |
| Fix something on a page | An adapter in `tools/adapters/` |
| Detect a barrier on a page | An auditor in `tools/auditors/` |
| Tune or add a preset | A profile in `tools/profiles/settings.json` |

## Adding a skill

Copy one of the four skills in `toolkit/skills/builtin/` (e.g.,
`calm-browsing.md`) and change it. A skill looks like this:

````markdown
---
name: quiet-reading
description: Shows only the article on a cluttered page. Use when ads, sidebars or popups make it hard to keep your place while reading (common with ADHD or dyslexia).
supportAreas: [cognitive, reading]
siteRelevance: [news, education, reference]
---

# Quiet Reading
Shows only the article, so there is less on the page pulling attention away.

## What it does
1. **reader-mode** - pulls the article into a clean view.
2. **focus-mode** - hides ads, popups and side content.

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

The JSON under `## Recipe` is what runs, so make sure the text above it says
the same thing. A few rules that the tests check:

- Adapter ids and setting keys have to exist in `toolkit/registry/tools.js`.
- `supportAreas` can only use vision, hearing, motor, cognitive, reading and
  sensory.
- `siteRelevance` can only use the categories in `toolkit/core/taxonomy.js`,
  or `all`.

Please use one to four adapters. Start the description with what the skill
helps with, and only mention conditions as examples (e.g., "common with ADHD
or dyslexia"). Then run
`node toolkit/test/skill-test.js` and `npm test`.

## Adding an adapter

We recommend copying `tools/adapters/reading-ruler.js`. An adapter is either an
object with `enable()` and `disable()`, where `disable()` undoes everything
(e.g., `ReadingRuler`), or a set of one-way fix functions plus an
`axeHandlers` map (e.g., `fix-tables.js`).

Several files need to know about a new adapter. This lists them for
`reading-ruler`:

```bash
grep -rln "ReadingRuler\|reading-ruler\|readingRuler" tools toolkit cli scripts
```

The steps:

1. Write `tools/adapters/<name>.js`.
2. Export it from `tools/adapters/index.js`, and add its `axeHandlers` to the
   combined map there if it has any.
3. List it in `tools/test/adapter-conformance-test.js`, in `TOOL_OBJECTS` or
   `ADDITIVE_MODULES`.
4. Add an entry to `toolkit/registry/tools.js` (copy the `reading-ruler` one),
   and add any new setting key to `settingsMeta` in the same file.
5. Add a line to `adaptersForTools` in `tools/profiles/settings.js` that maps
   the setting key to your file.
6. Write a test in `tools/test/` (e.g., `reading-ruler-test.js`).
7. Run `npm run build:types` and `npm run build:cli`, and commit what changes.

If you miss a step, the failing check in `npm test` usually says what is
missing.

> **Note**: if your adapter changes layout or styles, also add a check to
> `tools/test/browser-validate.js` (see [Testing](#testing)), since the
> regular tests can't see those.

## Adding an auditor

An auditor finds a barrier on a page so an adapter can fix it. We use
axe-core for standard WCAG checks, so write one only for what axe misses. An
auditor is usually one function:

```js
// tools/auditors/missing-headings.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then add `export * from './missing-headings.js';` to
`tools/auditors/index.js`.

## Adding a profile

A profile (also called a preset) is a set of starting settings for a new user,
before they've changed anything themselves. There are twelve, each described in
[PROFILE-CARDS.md](PROFILE-CARDS.md), and most changes will be tuning one of
them.

If you want to add a new one, please open an issue first, since it needs to be
based on published research like the other twelve. It goes inside the
`"profiles"` object in `tools/profiles/settings.json`:

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

You'll also need to update the list and the count of 12 in
`tools/test/profiles-test.js`, and add a card to
[PROFILE-CARDS.md](PROFILE-CARDS.md). In the `description`, say what the
preset does rather than who its users are.

## Testing

`npm test` is the main check. It stops at the first file that fails, so if the
failure isn't clear, run the test file you changed on its own (e.g.,
`node tools/test/reading-ruler-test.js`).

If you changed `onboarding/`, `controller/`, `tools/`, `toolkit/` or
`server/src/`, please also run the two browser suites:

```bash
npx playwright install --only-shell chromium   # once
npm run validate:browser
npm run test:e2e
```

CI runs these in a separate job (`.github/workflows/browser.yml`) that doesn't
block a merge, but please look at a red result before asking for review.

Some files are generated, so instead of editing them by hand, regenerate them
and commit the result:

| If you changed... | Run |
|---|---|
| the core API in `toolkit/` | `npm --prefix toolkit run docs` (updates `toolkit/API.md` and the toolkit skill) |
| any code in `toolkit/`, including the registry | `npm run build:types` |
| an adapter, or anything else the CLI uses | `npm run build:cli` |
| a server route | `npm --prefix server run docs` |

## Package boundaries

`toolkit/`, `tools/`, `server/`, `controller/`, `onboarding/` and `cli/` are
separate packages, and `scripts/import-boundaries-test.mjs` (part of
`npm test`) checks four rules for imports between them:

1. An import into `toolkit/` or `tools/` only uses paths in that package's
   `exports` map. Exceptions go in the test's `KNOWN_BREAKS` list.
2. Every import between packages is allowed by the test's `ALLOWED` table and
   listed in `KNOWN_EDGES` with a one-line reason.
3. There are no cycles.
4. A new import between packages is mentioned in the PR description.

In practice, if you add an import from one package into another and the test
fails, add the pair it prints to `KNOWN_EDGES` with a reason. If it says the
direction isn't allowed, please open an issue instead of editing `ALLOWED`.
