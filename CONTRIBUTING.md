# Contributing

Thank you for wanting to contribute! This repository holds the developer side
of the AI for Accessibility Collective's work: the core library (`toolkit/`),
the catalog of adapters, auditors and profiles (`tools/`), a small hosted
service (`server/`), and three optional pieces built on them (`controller/`,
`onboarding/` and `cli/`). This is a research project with a small team, so
most of what we merge adds one thing to the catalog (e.g., a skill, an
adapter, an auditor, or a profile).

If you are working on the browser extensions themselves (the popup,
onboarding, the Adapter and Skill Builders, voice mode, the web apps), that
code lives in the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension),
which has its own guide.

## Ways to help

Many of these don't need any code.

- Feedback: If you tried the toolkit or one of the extensions, let us know
  what worked and where it got in your way. We use these reports as research
  data, and [SUPPORT.md](SUPPORT.md) lists where to send them.
- Docs: Typos and confusing sentences are both worth a pull request.
- Accessibility of this repository: Alt text for images and text
  descriptions for diagrams are the most useful places to start.
- Skills: The catalog has about 50 adapters but only four built-in skills, so
  this is where we need the most help. A skill is a markdown file, not code
  (see [Adding a skill](#adding-a-skill)).
- Adapters and auditors: These are for things the catalog can't do yet. For
  example, published review checks for ARIA, contrast, keyboard navigation,
  forms and tables could each become one.
- Example applications: Please build them in your own repository and tell us
  about them, so this one stays small.

If GitHub itself is a barrier, you can also email us about any of these (the
current address is in [MAINTAINERS.md](MAINTAINERS.md)).

We don't have any issues labeled `good first issue` yet, so if you are looking
for a first task, we recommend writing a skill.

For anything bigger than one skill, one adapter, or a docs fix, it would be
great if you could open an issue first with what you'd like to change and who
it helps. That way we can let you know early if someone is already working on
it, or if it might fit better in a fork (see
[Forks and spin-offs](#forks-and-spin-offs)).

## Setting up

1. Install [Node.js](https://nodejs.org/) 20.19 or later (22.13+ and 24+ also
   work, and CI runs 20 and 22).

2. Fork the repository, then clone your fork and install the dependencies:

   ```bash
   git clone <your fork>
   cd AI-for-Accessibility-Toolkit
   npm install
   ```

3. Run the tests:

   ```bash
   npm test
   ```

   This runs about 3,000 checks in under half a minute and needs no API key
   or browser. If you are on Windows, run it from Git Bash or WSL, since the
   test script is a shell loop.

4. *(Optional)* Run a demo to see the toolkit work before you change anything:

   ```bash
   node toolkit/hosts/skill-demo/demo.js   # find, build, check and save a skill
   node toolkit/hosts/xr-demo/demo.js      # one profile shared from a web host to an XR host
   ```

The core is plain ES modules with no build step, and there's no browser
extension in this repository. The Python CLI in `cli/` is experimental and has
its own setup in [cli/README.md](cli/README.md).

## Skill or adapter?

Most catalog contributions are one or the other, not both.

- An **adapter** is code that makes one change to a page, e.g., dark mode, a
  reading ruler, or AI-written alt text. Adapters live in `tools/adapters/`.
  Write one only when no existing adapter can do what you need.
- A **skill** is a `SKILL.md` file that turns on existing adapters, with
  settings, for one need. For example, `calm-browsing` turns on
  `motion-reducer`, `dark-mode` and `focus-mode` for people who find motion
  and clutter overwhelming. Skills live in `toolkit/skills/builtin/` and have
  no code.

So, if the need can be met by switching on adapters that already exist, it
should be a skill. If the page needs to do something no adapter does yet,
you'll need to write the adapter first and then a skill that uses it. The
other terms you'll come across (auditor, validator, port, surface, grant) are
defined in [docs/GLOSSARY.md](docs/GLOSSARY.md).

## Where things go

| I want to... | Where |
|---|---|
| Combine adapters for a need | A skill in `toolkit/skills/builtin/<name>.md` |
| Fix something on a page | An adapter in `tools/adapters/` |
| Detect a barrier on a page | An auditor in `tools/auditors/` |
| Tune or add a preset | `tools/profiles/settings.json` |
| Render a profile for a new platform | A surface in `toolkit/surfaces/` |
| Run the core in a new kind of host | Ports in `toolkit/platforms/<host>/`, starting from `toolkit/platforms/node/` |
| Change the browser extensions | The extension repository |

## Adding a skill

The easiest way to start is to copy one of the four existing skills, e.g.,
`toolkit/skills/builtin/calm-browsing.md`, and change it. A skill looks like
this:

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

A few rules, all checked by `validateSkill`:

- The JSON under `## Recipe` is what runs. The text above it is for people and
  for the model that picks skills, so make sure the two match.
- Use only adapter ids and setting keys that exist in
  `toolkit/registry/tools.js`. The ids are the registry entries, and the
  setting keys are in `settingsMeta`.
- `supportAreas` values come from `SUPPORT_AREAS` in
  [`toolkit/core/ability.js`](toolkit/core/ability.js) (vision, hearing,
  motor, cognitive, reading, sensory), and `siteRelevance` values are
  categories from [`toolkit/core/taxonomy.js`](toolkit/core/taxonomy.js) or
  `all`. Skills are found by these two fields, so a skill with a value outside
  these lists is never picked.
- Use one to four adapters, and only the ones that serve the need.
- Start the description with the need, and name conditions only as examples,
  the way `calm-browsing` does.

You can check it with `node toolkit/test/skill-test.js`, then `npm test`.

> **Note**: a new built-in skill shows up in the demos right away, and in the
> extension once the extension repository rebuilds. The hosted server doesn't
> load built-in skills.

Hosts can also have the Engineer (`toolkit/core/skill-builder.js`) write a
skill from a plain-language need while they run, and those skills go through
the same checks.

## Adding an adapter

An adapter takes more steps than a skill, because several files need to know
it exists. The quickest way to see them all is to follow an existing adapter
through the repository. We recommend copying `tools/adapters/reading-ruler.js`
(about 120 lines), and this lists every file that mentions it:

```bash
grep -rln "ReadingRuler\|reading-ruler\|readingRuler" tools toolkit cli scripts
```

There are two kinds of adapter, and the conformance test treats them
differently:

- A switchable tool is an exported object with `enabled`, `enable()`,
  `disable()` and `toggle()`, where `disable()` undoes everything `enable()`
  did (e.g., `ReadingRuler`).
- A one-way fix is a set of functions that repair something on the page, plus
  an `axeHandlers` map from axe rule ids to those functions (e.g.,
  `fix-tables.js`, which has an AI fallback, and `fix-landmarks.js`, which
  doesn't use AI).

The steps:

1. Write `tools/adapters/<name>.js`. Shared DOM helpers (`isVisible`,
   `markProcessed`, `wasProcessed`, ...) are in `tools/utils/dom.js`, and any
   model call goes through `tools/utils/ai.js` (see
   [AI features](#surfaces-platforms-and-ai-features)).
2. Export it from `tools/adapters/index.js`. If it has `axeHandlers`, import
   them there and spread them into the combined map. Make sure no other
   adapter already handles the same axe rule (`wcag-fixes.js` covers many),
   since a later entry silently replaces an earlier one.
3. Add it to `tools/test/adapter-conformance-test.js`: the object's name goes
   in `TOOL_OBJECTS`, or the file name goes in `ADDITIVE_MODULES` for a
   one-way fix.
4. Add an entry to `toolkit/registry/tools.js`. It needs `id`, `name`,
   `description`, `supportAreas`, `siteRelevance` and `settings`, and the
   existing entries also set `requiresAI`, `icon`, `emoji` and `quickStart`.
   The Engineer reads `description` when it picks adapters for a skill, so
   please say plainly what the adapter does.
5. Add each new setting key to `settingsMeta` in the same file. No test
   catches a missing key, but any skill that uses it will fail validation.
6. Add a line to `adaptersForTools` in `tools/profiles/settings.js` that maps
   the setting key to the adapter's file name.
7. Write a test in `tools/test/` (e.g., `reading-ruler-test.js`). If the
   adapter changes layout or styles, add a check to
   `tools/test/browser-validate.js` too, since jsdom can't see those.
8. Regenerate the type declarations and the CLI bundle (`npm run build:types`
   and `npm run build:cli`) and commit what changes. Any registry edit changes
   the types, and any new adapter changes the bundle.

`node tools/test/registry-parity-test.js` checks that steps 2, 4 and 6 agree.
It has two lists for the rare cases that rule can't express: `SUB_SETTINGS`
for a key that only tunes another key's adapter, and `KNOWN_UNREACHABLE` for an
adapter left out of the registry on purpose. If you use either one, please add
a comment saying why.

*(Optional)* If the CLI should be able to switch your adapter on from a
profile, also add it to `applyProfileByName` in `cli/cli-tools.js`. This is a
new import from `cli/` into `tools/`, so it needs a `KNOWN_EDGES` entry too
(see [Package boundaries](#package-boundaries)).

## Adding an auditor

Auditors find barriers on a page so adapters can fix them. We use axe-core for
standard WCAG checks, so write a custom auditor only for what axe misses. An
auditor is usually one function that returns the elements with the problem:

```js
// tools/auditors/missing-headings.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then add `export * from './missing-headings.js';` to
`tools/auditors/index.js`. Keep in mind that jsdom does no layout, so in tests
`isVisible()` returns false unless you stub `getBoundingClientRect` (see
`tools/test/auditors-test.js` for how).

## Adding a profile

A profile (also called a preset) is a set of starting settings for someone the
toolkit doesn't know yet. There are twelve in `tools/profiles/settings.json`,
each built from published guidance and described in
[docs/PROFILE-CARDS.md](docs/PROFILE-CARDS.md). Most changes will be tuning an
existing one.

A new profile goes inside the `"profiles"` object:

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

The keys under `tools` are the setting keys in `settingsMeta` in
[`toolkit/registry/tools.js`](toolkit/registry/tools.js), the same list skills
are checked against. Adding a profile also means updating `EXPECTED_PROFILES`
and the count of 12 in `tools/test/profiles-test.js`, adding any new keys to
`RECOGNIZED` there, and writing a card for it in `docs/PROFILE-CARDS.md`.
Please open an issue first, since a new profile needs the same grounding in
published research as the existing twelve.

In the `description`, say what the preset does rather than who its users are,
since two people who pick the same preset can need very different things.

## Surfaces, platforms and AI features

- A surface is a function in `toolkit/surfaces/` that turns a person's ability
  model into one platform's settings (`web.js`, `mobile.js`, `xr.js`). A new
  one also needs a line in the `exports` map of `toolkit/package.json`, or
  people who install the package won't be able to import it.
- To run the core in a new kind of host, implement the ports in
  `toolkit/platforms/<host>/`, using `toolkit/platforms/node/` as the
  template.
- Code in `tools/` reaches a model only through `tools/utils/ai.js`. The host
  passes a provider object to `setAIProvider()`, and the comment on each
  wrapper in `ai.js` says whether that method is required or optional. The
  core instead takes a function from the host that sends a prompt and returns
  the model's text. Neither imports a vendor SDK, so please keep it that way.

## Testing

`npm test` is the main check. It runs the tools, toolkit, controller and
onboarding suites, plus the import-boundary check. It stops at the first file
that fails and doesn't print that file's name, so if a failure isn't obvious,
try running the suite you changed on its own (e.g.,
`node tools/test/reading-ruler-test.js`).

If you changed the server, also run `node server/test/server-test.mjs`.

Two suites drive a real headless Chromium. They're left out of `npm test`
because they need a browser download that `npm install` doesn't do:

```bash
npx playwright install --only-shell chromium   # once, about 100 MB
npm run validate:browser   # each adapter's real effect in a real layout, and that turning it off undoes it
npm run test:e2e           # the /chat page in onboarding/, end to end
```

Please run both before opening a PR that touches `onboarding/`, `controller/`,
`tools/`, `toolkit/` or `server/src/`. CI runs them for those paths in a
separate job (`.github/workflows/browser.yml`). That job doesn't block a merge,
but please look at a red result before asking for review.

Some files are generated, so instead of editing them by hand, regenerate them
and commit the result:

| File | Regenerate with | When |
|---|---|---|
| `toolkit/API.md` and `.claude/skills/ai4a11y-toolkit/SKILL.md` | `npm --prefix toolkit run docs` | you changed the core API (`npm test` fails if they're stale) |
| `toolkit/types/` | `npm run build:types` | you changed code in `toolkit/`, including the registry (CI fails if stale) |
| `cli/cli-tools.bundle.js` | `npm run build:cli` | you changed an adapter or anything else the CLI imports (CI fails if stale) |
| `server/API.md` | `npm --prefix server run docs` | you changed a server route. It has a timestamp, so skip it otherwise |

## Opening a pull request

- Keep it to one change, e.g., one skill, one adapter, or one fix.
- Say who it helps (which need or profile) and how you tested it. The PR
  template asks for both.
- `npm test` has to pass, plus the browser suites if you touched the folders
  listed under Testing.
- If you added an import between packages, please mention it in the
  description.
- If you worked with people the change is meant for, we'd love to hear how!

Using an AI coding assistant is fine (a lot of this repository was written
with one), but please read and run the code yourself before opening the PR.

There's no linter, formatter or commit message format. Please match the style
of the file you're editing, write JSDoc on exported functions in `toolkit/`
(the type declarations are built from it), and link to large binaries instead
of committing them.

## What to expect from review

This is a research project funded through November 2026, and the people
reviewing PRs are also doing the research. Until then we review as time
allows. After that, review may be slow or stop for a while until longer-term
maintainers are named (see Governance in [ROADMAP.md](ROADMAP.md)). If your PR
sits without a review, it's probably because we're busy with the research, and
it's fine to leave a comment to remind us.

## Forks and spin-offs

The core is deliberately small, and we don't expect every idea to land here.
If the toolkit is useful to you but you need it to do things we aren't
planning to support, please fork it. That's fine with us, and forks are part of
how we hope the toolkit gets used.

If you learn something from your fork, we'd love to hear about it (e.g., which
adapters or designs worked and which didn't, a need the ability model couldn't
express, or results from testing with the people you built it for). You can
open an issue or send a short write-up, and pull requests with your changes are
welcome too.

A few notes for forks:

- The Apache 2.0 license already allows all of this, so nothing here is
  required.
- Please rename your fork enough that people won't mistake it for this
  project, and keep the "research probe, not validated, not a replacement for
  assistive technology" framing anywhere you reuse our claims.
- If you'd like us to know about your project, open an issue and tell us about
  it.

We're still working out how forks and outside contributions will be handled
after the research phase, and we'll update this section then.

## Package boundaries

`toolkit/`, `tools/`, `server/`, `controller/`, `onboarding/` and `cli/` are
separate packages, and imports between them only go one way. `toolkit/` (the
core) and `tools/` (the catalog) import from no other package. `server/`,
`controller/` and `cli/` can import from those two, and `onboarding/` also
reuses parts of `server/`.

`scripts/import-boundaries-test.mjs` checks four rules as part of `npm test`:

1. An import into `toolkit/` or `tools/` only uses paths listed in that
   package's `exports` map. A deeper path works here but breaks for anyone who
   installs the package. Tolerated exceptions go in the test's `KNOWN_BREAKS`
   list, with the reason.
2. Every import between packages is declared: its direction is in the test's
   `ALLOWED` table, and the file is in `KNOWN_EDGES` with a one-line reason.
3. There are no cycles.
4. A new import between packages is called out in the PR description.

When the test fails, it prints the two files. Add the pair to `KNOWN_EDGES`
with a reason and mention it in your PR. If it says the direction isn't in
`ALLOWED`, please open an issue instead of editing the table. If you remove an
import, remember to remove its entry too.

The test only reads relative imports in package code, so please call out
anything else yourself, e.g., an import from a test file, or the way
`onboarding/chat.js` loads `/controller/lib/...` through a URL.

## Working with disabled people

The project's first principle is "Nothing about us without us"
([docs/GLOSSARY.md](docs/GLOSSARY.md#principles)). For contributors, that
means:

- Involve people with disabilities in the design and evaluation of what you
  build, not only at the end.
- Pay the people who take part.
- Handle profile and personalization data carefully. A profile describes
  someone's needs, so it can reveal a disability.
- Don't create or simulate an ability profile without input from the
  community it's meant for.

Testing with a screen reader or other assistive technology yourself is useful,
but it isn't the same as testing with people who use it every day.

## Questions

Feel free to open an issue here, or in the extension repository for extension
work. If you'd rather not use GitHub, the email address in
[MAINTAINERS.md](MAINTAINERS.md) works too. Security problems go through
[SECURITY.md](SECURITY.md), never a public issue.

Thank you for your contributions!
