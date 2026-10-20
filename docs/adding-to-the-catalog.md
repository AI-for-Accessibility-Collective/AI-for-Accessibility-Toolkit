# Adding to the catalog

Step-by-step instructions for adding a skill, adapter, auditor or profile. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for setting up.

| I want to... | Add a... | In |
|---|---|---|
| Combine adapters for a need | skill | `toolkit/skills/builtin/` |
| Change a page in a new way | adapter | `tools/adapters/` |
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

Most adapters are an object you turn on and off with `enable()` and
`disable()`, like `ReadingRuler` in `tools/adapters/reading-ruler.js`. A few
are functions that fix a page once, like `tools/adapters/fix-tables.js`.

The easiest way to start is to copy `reading-ruler.js`. Each step below shows
the line `reading-ruler` uses, so you can add the same line for your adapter.

1. Write `tools/adapters/<name>.js`.

2. Export it in `tools/adapters/index.js`.

```js
export { ReadingRuler } from './reading-ruler.js';
```

3. Add its name to `TOOL_OBJECTS` in `tools/test/adapter-conformance-test.js`
   (for an adapter that fixes a page once, add the file name to
   `ADDITIVE_MODULES` instead).

```js
const TOOL_OBJECTS = [ ..., 'ReadingRuler', ... ];
```

4. Add an entry in `toolkit/registry/tools.js`.

```js
{
  id: 'reading-ruler',
  name: 'Reading Ruler',
  description: 'A soft highlight band that follows your cursor down the page ...',
  supportAreas: ['reading', 'cognitive'],
  siteRelevance: ['news', 'education', 'reference'],
  requiresAI: false,
  icon: 'horizontal_rule',
  emoji: '\u{1F4CF}',
  quickStart: false,
  settings: { readingRuler: true },
},
```

5. Add its setting key to `settingsMeta`, further down the same file.

```js
readingRuler: { type: 'boolean', description: 'A highlight band that follows your reading line' },
```

6. In `tools/profiles/settings.js`, add a line to `adaptersForTools` so that
   the setting turns on your adapter.

```js
if (tools.readingRuler) enabled.push('reading-ruler');
```

7. Add a test in `tools/test/` (e.g., `reading-ruler-test.js`).

8. Rebuild the type declarations and the CLI bundle, and commit the changes.

```bash
npm run build:types
npm run build:cli
```

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

Then export it in `tools/auditors/index.js`.

```js
export * from './missing-headings.js';
```

## Adding a profile

There are twelve profiles in `tools/profiles/settings.json`, described in
[PROFILE-CARDS.md](PROFILE-CARDS.md). To change one, edit its `tools`
settings.

To add a new profile, please open an issue first. A new profile needs:

1. An entry in the `"profiles"` object.

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

2. The updated list and count of profiles in `tools/test/profiles-test.js`.

3. A card in [PROFILE-CARDS.md](PROFILE-CARDS.md).

In the description, say what the profile does, not who it is for.

## Testing

Run `npm test` before opening a PR. It stops at the first failing file, so to
debug, run one test file at a time (e.g., `node tools/test/reading-ruler-test.js`).

If you changed `onboarding/`, `controller/`, `tools/`, `toolkit/` or
`server/src/`, also run the browser tests.

```bash
npx playwright install --only-shell chromium   # once
npm run validate:browser
npm run test:e2e
```

These also run in CI (`.github/workflows/browser.yml`), but don't block
merging.

Some files are built from other code. Rebuild them instead of editing them by
hand:

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
