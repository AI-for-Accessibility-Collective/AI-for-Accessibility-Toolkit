# Contributing

This repository is the developer toolkit from the AI for Accessibility
Collective. If you are looking for the browser extensions, see the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension).

## Ways to contribute

### Share feedback

Try the toolkit or one of the extensions, then open an issue about what worked
and what didn't. If you'd rather not use GitHub, you can email us instead (see
[SUPPORT.md](SUPPORT.md)).

### Write a skill

A skill is a markdown file that turns on a few existing adapters for a specific
need and sets their options. For example, `calm-browsing` turns on
`motion-reducer`, `dark-mode` and `focus-mode` for people who find motion and
clutter on a page overwhelming.

You don't need to write any code. Copy one of the skills in
`toolkit/skills/builtin/` and follow
[Adding a skill](docs/adding-to-the-catalog.md#adding-a-skill).

### Add an adapter or auditor

An adapter is code that makes one change to a page. For example,
`reading-ruler` adds a highlight band that follows your cursor, and
`generate-alt` writes alt text for images with AI. An auditor is code that
finds accessibility problems that axe-core misses, e.g., sections without
headings.

If the adapters you need already exist, write a skill instead. Otherwise,
follow [Adding an adapter](docs/adding-to-the-catalog.md#adding-an-adapter) or
[Adding an auditor](docs/adding-to-the-catalog.md#adding-an-auditor).

### Build an example app

Use the toolkit in your own project, starting from
[docs/QUICKSTART.md](docs/QUICKSTART.md), and open an issue to tell us about
it.

For bigger changes, please open an issue first.

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
`npm test` passes. When you open a PR, GitHub fills in our template, which
asks:

- What does this PR do?
- Which parts of the repository does it change?
- Who does it help?
- How did you test it?

## Working with people with disabilities

- Involve people with disabilities in designing and testing what you build.
- Pay participants.
- Be careful with profile data, as it can reveal someone's disability.
- Don't create ability profiles without input from the community they are
  meant for.

## Questions

See [SUPPORT.md](SUPPORT.md) for how to reach us.

Thank you for your contributions!
