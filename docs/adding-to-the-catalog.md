# Adding to the catalog

The catalog is the set of skills, adapters, auditors and profiles that apps
built on the toolkit can use. See [CONTRIBUTING.md](../CONTRIBUTING.md) for
setting up the repository.

| To... | Add a... | In |
|---|---|---|
| Turn on a few existing adapters together, e.g., for reading on a cluttered page | skill | `toolkit/skills/builtin/` |
| Change a page in a new way | adapter | `tools/adapters/` |
| Find accessibility problems on a page | auditor | `tools/auditors/` |
| Add or change a preset of starting settings | profile | `tools/profiles/settings.json` |

## Adding a skill

A skill is a markdown file with a header, a short description, and a recipe
that says which adapters to turn on. You don't need to write any code.

1. Copy one of the skills in `toolkit/skills/builtin/`, e.g.,
   `calm-browsing.md`, and rename the copy after your skill
   (`quiet-reading.md` in the example below).

2. Fill in the header.

| Field | What to put | Example |
|---|---|---|
| `name` | The file name without `.md` | `quiet-reading` |
| `description` | What the skill does, then when to use it. If you name a condition, give it as an example, e.g., "(common with ADHD or dyslexia)". | `Shows only the article on a cluttered page. Use when ads, sidebars or popups make it hard to keep your place while reading (common with ADHD or dyslexia).` |
| `supportAreas` | One or more of `vision`, `hearing`, `motor`, `cognitive`, `reading` and `sensory` | `[cognitive, reading]` |
| `siteRelevance` | The kinds of sites it's for. One or more of `news`, `social`, `video`, `shopping`, `education`, `productivity`, `reference`, `finance`, `health`, `government` and `other`, or `all` for any site | `[news, education, reference]` |

3. Pick one to four adapters. To see every adapter and the settings that turn
   it on, run:

```bash
node -e "import('./toolkit/registry/tools.js').then(m => m.skillRegistry.forEach(t => console.log(t.id, JSON.stringify(t.settings))))"
```

   For example, it prints `reader-mode {"readerMode":true}` and
   `focus-mode {"focusMode":true,"hideDistractions":true,"showProgress":true}`.

4. Write the body: a title, one or two sentences on what the skill does, a
   list of what each adapter does, and the recipe.

````markdown
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

   Keep the list under "What it does" the same as the recipe. You can also add
   "When to use" and "Notes" sections, like `calm-browsing.md` does.

5. Run the skill tests, then all the tests.

```bash
node toolkit/test/skill-test.js
npm test
```

   If something in your skill is wrong, the test prints the problem above the
   failing line, e.g., `unknown adapter "reader-modes"` or
   `setting "fontScale"=300 out of range 50–200`.

## Adding an adapter

An adapter is code that makes one change to a page. Most adapters are
objects you turn on with `enable()` and off with `disable()`, like
`ReadingRuler` in `tools/adapters/reading-ruler.js`. Skills and profiles turn
an adapter on with its setting key, e.g., `readingRuler: true`.

1. Write `tools/adapters/<name>.js`. We recommend copying `reading-ruler.js`.
   The shape is:

```js
export const MyAdapter = {
  enabled: false,

  enable(options = {}) {
    if (this.enabled) return;
    this.enabled = true;
    // change the page
  },

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    // undo everything enable() did
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },
};
```

2. Export it in `tools/adapters/index.js`.

```js
export { ReadingRuler } from './reading-ruler.js';
```

3. Add its name to `TOOL_OBJECTS` in `tools/test/adapter-conformance-test.js`.
   This test checks that every adapter with `enable()` also has `disable()`.

```js
const TOOL_OBJECTS = [ ..., 'ReadingRuler', ... ];
```

4. Add an entry in `toolkit/registry/tools.js`, and say plainly what the
   adapter does in `description`. The Engineer (the agent that writes new
   skills) reads it to pick adapters.

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

6. In `tools/profiles/settings.js`, add a line to `adaptersForTools` that
   turns on your adapter when its setting key is set.

```js
if (tools.readingRuler) enabled.push('reading-ruler');
```

7. Write a test in `tools/test/`. For example, `reading-ruler-test.js` loads a
   small page in jsdom, turns the adapter on and off, and checks that
   `disable()` removes everything `enable()` added.

```bash
node tools/test/reading-ruler-test.js
```

8. Rebuild the type declarations and the CLI bundle, and commit the changes.

```bash
npm run build:types
npm run build:cli
```

To see your adapter work in a real browser, add a check to
`tools/test/browser-validate.js` and run `npm run validate:browser` (see
[Testing](#testing)).

A few adapters are functions that fix a page once, e.g.,
`tools/adapters/fix-tables.js`. For one of those, list the file name in
`ADDITIVE_MODULES` in step 3 (not `TOOL_OBJECTS`). If it fixes axe rules, also
add its `axeHandlers` to the combined map in `tools/adapters/index.js`.

## Adding an auditor

An auditor finds accessibility problems on a page. The standard WCAG checks
already run through axe-core (in `tools/auditors/wcag-issues.js`). A new
auditor should look for something axe doesn't check.

An auditor is usually a function that returns the elements with the problem.
For example, `findEmptyLinks` in `tools/auditors/missing-labels.js` returns
links with no accessible name:

```js
import { isVisible, wasProcessed, hasAccessibleName } from '../utils/dom.js';

export function findEmptyLinks() {
  return Array.from(document.querySelectorAll('a[href]'))
    .filter(link => {
      if (wasProcessed(link)) return false;
      if (!isVisible(link)) return false;
      return !hasAccessibleName(link);
    });
}
```

`tools/utils/dom.js` has helpers for this, e.g., `isVisible`, `wasProcessed`
(true for elements an adapter has already fixed) and `hasAccessibleName`.

1. Write your function in a file in `tools/auditors/`, or add it to an
   existing file there if it fits.

2. Export the file in `tools/auditors/index.js`.

```js
export * from './missing-labels.js';
```

3. Add checks to `tools/test/auditors-test.js`. To give an element a size in
   the test, set its `data-w` and `data-h` attributes (the default is 200 by
   40).

```bash
node tools/test/auditors-test.js
```

## Adding a profile

A profile is a preset of starting settings. For example, `lowVision` turns on
larger text (`fontScale: 150`), wider line spacing and contrast fixes. There
are twelve in `tools/profiles/settings.json`: `blind`, `lowVision`,
`colorBlind`, `deaf`, `motor`, `dyslexia`, `adhd`, `cognitive`, `olderAdult`,
`anxiety`, `sensory` and `photosensitive`. Each one is described in
[PROFILE-CARDS.md](PROFILE-CARDS.md).

To change a profile, edit the settings under its `tools` key. The setting keys
are the ones in `settingsMeta` in `toolkit/registry/tools.js`.

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

Run `npm test` before opening a PR. It stops at the first file that fails. To
find the problem, run the test file for what you changed on its own, e.g.,
`node tools/test/reading-ruler-test.js`.

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
4. `KNOWN_EDGES` matches the code. A new import fails until it's listed, and an
   entry whose import is gone fails too. Please also mention new imports in
   your PR.

If the test fails after you add an import, add the pair it prints to
`KNOWN_EDGES`. If the import isn't allowed, please open an issue.
