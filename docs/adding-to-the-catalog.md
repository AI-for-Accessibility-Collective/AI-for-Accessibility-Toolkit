# Adding to the catalog

Step-by-step instructions for adding a skill, adapter, auditor or profile. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for setting up.

| I want to... | Add a... | In |
|---|---|---|
| Combine adapters for a need | skill | `toolkit/skills/builtin/` |
| Fix something on a page | adapter | `tools/adapters/` |
| Find accessibility problems on a page | auditor | `tools/auditors/` |
| Add or change a preset of starting settings | profile | `tools/profiles/settings.json` |

## Adding a skill

1. Copy one of the skills in `toolkit/skills/builtin/` (e.g., `calm-browsing.md`).

2. Change the name, description and recipe. For example:

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

3. Run the tests.

```bash
node toolkit/test/skill-test.js
npm test
```

Notes:

- The recipe can only use adapter ids and setting keys from
  `toolkit/registry/tools.js`.
- `supportAreas` can be vision, hearing, motor, cognitive, reading or sensory.
- `siteRelevance` can be any category in `toolkit/core/taxonomy.js`, or `all`.
- Use one to four adapters.
- Start the description with what the skill helps with, and mention conditions
  only as examples (e.g., "common with ADHD or dyslexia").

## Adding an adapter

An adapter is either an object with `enable()` and `disable()` (e.g.,
`tools/adapters/reading-ruler.js`), or a set of functions that fix a page once
(e.g., `tools/adapters/fix-tables.js`). We recommend copying `reading-ruler.js`
to start. This lists every file that mentions it:

```bash
grep -rln "ReadingRuler\|reading-ruler\|readingRuler" tools toolkit cli scripts
```

1. Write `tools/adapters/<name>.js`.

2. Export it from `tools/adapters/index.js`. If it fixes axe rules, add its
   `axeHandlers` there too.

3. Add it to `TOOL_OBJECTS` in `tools/test/adapter-conformance-test.js` (or
   `ADDITIVE_MODULES` if it fixes a page once).

4. Add an entry to `toolkit/registry/tools.js`, and add any new setting key to
   `settingsMeta` in the same file.

5. Add a line for it to `adaptersForTools` in `tools/profiles/settings.js`.

6. Add a test in `tools/test/` (e.g., `reading-ruler-test.js`).

7. Run `npm run build:types` and `npm run build:cli`, and commit the changes.

*(Optional)* If your adapter changes layout or styles, also add a check in
`tools/test/browser-validate.js`.

## Adding an auditor

Auditors find accessibility problems that axe-core misses. An auditor is
usually one function:

```js
// tools/auditors/missing-headings.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then export it from `tools/auditors/index.js`:

```js
export * from './missing-headings.js';
```

## Adding a profile

There are twelve profiles in `tools/profiles/settings.json`, described in
[PROFILE-CARDS.md](PROFILE-CARDS.md). To change one, edit its `tools`
settings.

To add a new profile, please open an issue first. A new profile also needs:

- An entry in the `"profiles"` object:

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

- The updated list and count of profiles in `tools/test/profiles-test.js`.
- A card in [PROFILE-CARDS.md](PROFILE-CARDS.md).

In the description, say what the profile does, not who it is for.

## Testing

Run `npm test` before opening a PR. It stops at the first failing file, so to
debug, run one test file at a time (e.g., `node tools/test/reading-ruler-test.js`).

If you changed `onboarding/`, `controller/`, `tools/`, `toolkit/` or
`server/src/`, also run the browser tests:

```bash
npx playwright install --only-shell chromium   # once
npm run validate:browser
npm run test:e2e
```

These also run in CI (`.github/workflows/browser.yml`), but don't block
merging.

Regenerate these files instead of editing them by hand:

| If you changed... | Run |
|---|---|
| the core API in `toolkit/` | `npm --prefix toolkit run docs` |
| any code in `toolkit/` | `npm run build:types` |
| an adapter, or anything else the CLI uses | `npm run build:cli` |
| a server route | `npm --prefix server run docs` |

## Package boundaries

`toolkit/`, `tools/`, `server/`, `controller/`, `onboarding/` and `cli/` are
separate packages, and `toolkit/` and `tools/` don't import from any of the
others. `scripts/import-boundaries-test.mjs` checks four rules:

1. Imports into `toolkit/` or `tools/` only use paths in their `exports` map
   (exceptions go in `KNOWN_BREAKS`).
2. Every import between packages is allowed in `ALLOWED` and listed in
   `KNOWN_EDGES` with a reason.
3. There are no cycles.
4. New imports between packages are mentioned in the PR.

If the test fails after you add an import, add the pair it prints to
`KNOWN_EDGES`. If the import isn't allowed, please open an issue.
