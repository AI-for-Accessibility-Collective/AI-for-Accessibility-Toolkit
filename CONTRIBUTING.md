# Contributing

This repository is the developer toolkit from the AI for Accessibility
Collective. If you are looking for the browser extensions, see the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension).

## Ways to contribute

- Share feedback on using the toolkit or the extensions (see
  [SUPPORT.md](SUPPORT.md)).
- Write a skill. This is a good first contribution, as we only have four so
  far.
- Add an adapter or auditor.
- Build an example app with the toolkit in your own repository.

You can also email us instead of using GitHub (see
[MAINTAINERS.md](MAINTAINERS.md)). For bigger changes, please open an issue
first.

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

On Windows, run the tests in Git Bash or WSL.

## Skill or adapter?

A skill is a markdown file that turns on a set of existing adapters for a
specific need. For example, `calm-browsing` turns on `motion-reducer`,
`dark-mode` and `focus-mode`.

An adapter is code that changes a page, e.g., a reading ruler or AI-generated
alt text.

If the adapters you need already exist, you only need to write a skill.
Step-by-step instructions for adding a skill, adapter, auditor or profile are
in [docs/adding-to-the-catalog.md](docs/adding-to-the-catalog.md).

## Pull requests

- One change per PR.
- Describe who it helps and how you tested it.
- Make sure `npm test` passes.

It's fine to use AI coding tools, as long as you read and test the code
yourself.

## Working with people with disabilities

- Involve people with disabilities in designing and testing what you build.
- Pay participants.
- Be careful with profile data, as it can reveal someone's disability.
- Don't create ability profiles without input from the community they are
  meant for.

## Questions

Feel free to open an issue or email us (see [MAINTAINERS.md](MAINTAINERS.md)).
For security problems, see [SECURITY.md](SECURITY.md).

Thank you for your contributions!
