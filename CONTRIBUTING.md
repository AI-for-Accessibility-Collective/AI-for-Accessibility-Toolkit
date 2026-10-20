# Contributing

This repository is the developer toolkit from the AI for Accessibility
Collective. If you are looking for the browser extensions, see the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension).

## Ways to contribute

### Share feedback

To try the toolkit, run the demos in [docs/QUICKSTART.md](docs/QUICKSTART.md).
To try the extensions, follow the extension repository's
[Getting Started](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension/blob/main/docs/GETTING-STARTED.md)
guide. Then open an issue about what worked and what didn't. If you'd rather
not use GitHub, you can email us instead (see [SUPPORT.md](SUPPORT.md)).

### Write a skill

A skill is a markdown file that turns on a few existing adapters for a specific
need and sets their options. For example, `calm-browsing` turns on
`motion-reducer`, `dark-mode` and `focus-mode` for people who find motion and
clutter on a page overwhelming.

You don't need to write any code. Copy one of the skills in
`toolkit/skills/builtin/` and follow
[Adding a skill](docs/adding-to-the-catalog.md#adding-a-skill).

### Add an adapter

An adapter is code that makes one change to a page. For example,
`reading-ruler` adds a highlight band that follows your cursor, and
`generate-alt` writes alt text for images with AI.

If the adapters you need already exist, write a skill instead. Otherwise,
follow [Adding an adapter](docs/adding-to-the-catalog.md#adding-an-adapter).

### Add an auditor

An auditor is code that finds accessibility problems on a page. For example,
`findEmptyLinks` finds links with no accessible name. The catalog already runs
axe-core for the standard WCAG checks, so write a new auditor for problems axe
doesn't check. Follow
[Adding an auditor](docs/adding-to-the-catalog.md#adding-an-auditor).

### Build an example app

Build an app on the toolkit in your own repository. To get started, follow
[docs/QUICKSTART.md](docs/QUICKSTART.md), which has the demos and a short code
example. When you have something working, open an issue with a link to it.

## Setting up

1. Install [Node.js](https://nodejs.org/) 20.19 or later.

2. Clone your fork and install package dependencies.

```bash
git clone <your fork>
cd AI-for-Accessibility-Toolkit
npm install
```

3. Run the tests.

```bash
npm test
```

## Pull requests

Keep each PR to one change, e.g., one skill or one adapter, and make sure
`npm test` passes.

GitHub fills in this template when you open a PR. You can also copy it from
here:

```markdown
## What does this PR do?

## Which parts of the repository does it change?

- [ ] Core (`toolkit/`)
- [ ] Skills or registry (`toolkit/skills/builtin/`, `toolkit/registry/`)
- [ ] Adapters, auditors or profiles (`tools/`)
- [ ] Hosted service (`server/`)
- [ ] Controller (`controller/`)
- [ ] Onboarding example (`onboarding/`)
- [ ] CLI (`cli/`)
- [ ] Docs

## Who does it help?

Which needs or profiles does this help?

## How did you test it?

- [ ] `npm test` passes
- [ ] If I changed `onboarding/`, `controller/`, `tools/`, `toolkit/` or `server/src/`, `npm run validate:browser` and `npm run test:e2e` pass
- [ ] If I changed code in `toolkit/`, an adapter or a server route, I rebuilt the generated files (see Testing in docs/adding-to-the-catalog.md)
```

If you're planning a bigger change, e.g., to the core in `toolkit/core/`,
please open an issue to discuss it before you start.

## Working with people with disabilities

- Involve people with disabilities in designing and testing what you build.
- Pay participants.
- Be careful with profile data, as it can reveal someone's disability.
- Don't create ability profiles without input from the community they are
  meant for.

## Questions

See [SUPPORT.md](SUPPORT.md) for how to reach us.

Thank you for your contributions!
