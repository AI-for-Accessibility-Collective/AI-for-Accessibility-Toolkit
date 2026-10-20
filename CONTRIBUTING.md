# Contributing

Thank you for wanting to contribute! This repository holds the AI for
Accessibility Collective's developer toolkit, and most contributions add one
thing to its catalog, usually a skill or an adapter. If you are working on the
browser extensions instead, that code lives in the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension),
which has its own guide.

## Ways to help

You don't need to write code for most of these:

- If you tried the toolkit or one of the extensions, let us know what worked
  and where it got in your way (see [SUPPORT.md](SUPPORT.md)).
- Fix typos or confusing sentences in the docs.
- Add alt text for images or text descriptions for diagrams in this
  repository.
- Write a skill. We have about 50 adapters but only four skills, so this is the
  best first task.
- Add an adapter or auditor for something the catalog can't do yet.
- Build an example app on the toolkit in your own repository, and tell us
  about it.

If GitHub is a barrier, you can also email us (the address is in
[MAINTAINERS.md](MAINTAINERS.md)). For anything bigger than one skill or
adapter, please open an issue first so we can let you know if someone is
already working on it.

## Setting up

```bash
git clone <your fork>
cd AI-for-Accessibility-Toolkit
npm install
npm test
```

You'll need Node.js 20.19 or later. `npm test` takes under half a minute and
needs no API key. If you are on Windows, run it from Git Bash or WSL.

## Skill or adapter?

- A **skill** is a markdown file that turns on existing adapters for one need,
  e.g., `calm-browsing` turns on `motion-reducer`, `dark-mode` and
  `focus-mode`. No code.
- An **adapter** is code that changes a page in a way no existing adapter can,
  e.g., a reading ruler or AI-written alt text.

If the adapters you need already exist, write a skill. Otherwise, write the
adapter first. The step-by-step instructions for adding a skill, adapter,
auditor or profile are in
[docs/adding-to-the-catalog.md](docs/adding-to-the-catalog.md).

## Opening a pull request

- Keep it to one change, e.g., one skill or one adapter.
- Say who it helps and how you tested it (the PR template asks for both).
- Make sure `npm test` passes.
- Using an AI coding assistant is fine, but please read and run the code
  yourself first.

## What to expect from review

This is a research project funded through November 2026, and the people
reviewing PRs are also doing the research, so we review as time allows. After
November 2026, review may be slow until longer-term maintainers are named (see
[ROADMAP.md](ROADMAP.md)). If your PR sits without a review, feel free to
leave a comment to remind us.

## Forks and spin-offs

If you need the toolkit to do things we aren't planning to support, please
fork it - that's fine with us, and the Apache 2.0 license allows it. We'd love
to hear what you learn, so feel free to open an issue about it. Please rename
your fork so people won't mistake it for this project, and wherever you
describe what it does, say that it's a research probe, it hasn't been
validated, and it isn't a replacement for assistive technology.

## Working with disabled people

- Involve people with disabilities in the design and evaluation of what you
  build.
- Pay the people who take part.
- Handle profile data carefully, since a profile can reveal a disability.
- Don't create or simulate an ability profile without input from the
  community it's meant for.

## Questions

Feel free to open an issue, or email us if you'd rather not use GitHub (see
[MAINTAINERS.md](MAINTAINERS.md)). Security problems go through
[SECURITY.md](SECURITY.md), never a public issue.

Thank you for your contributions!
