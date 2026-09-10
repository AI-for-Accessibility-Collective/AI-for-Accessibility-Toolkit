# How this was built

Software carries the assumptions of the process that made it. This page
says what that process was, so you can judge the result with open eyes.

## Who built it

The toolkit comes from the **AI for Accessibility Collective**, a
one-year, multi-institution research initiative: university research labs
in the United States and the United Kingdom, community-partner
organizations of and for disabled people, and funder support from
Google.org. Institutions are credited in the [README](../README.md);
individual contributions are recorded in the repository history and
[CITATION.cff](../CITATION.cff).

The Collective's members did not set out to write one product together.
Each institution ran its own research project — memory support for older
adults, accessible STEM simulations for blind and low-vision learners,
speech recognition for non-standard speech, creativity support, and more
(see [projects.md](projects.md)) — and the toolkit is the extraction: the
generalizable pieces those projects and their questions pointed at.

## How it was made

- **As technology probes, not a product roadmap.** Nearly everything here
  exists to test a research question — can one ability model render across
  web and XR? can a plain-language need become a reusable recipe? can
  memory stay private by default and still be useful? The code is the
  experiment, and "pre-alpha" in the README is a description, not
  modesty.
- **With AI assistance, deliberately.** Much of this codebase was written
  with AI coding tools, by researchers and engineers reviewing the output.
  That is part of the research posture: a project about AI agents for
  accessibility, built partly by AI agents, with the friction and failure
  modes that produced treated as findings. Generated code was reviewed and
  tested; the test suites and CI checks in each package are the honest
  record of how much.
- **Iteratively and in public view.** The repository's history — including
  a substantial mid-project re-architecture that separated the
  platform-agnostic core from the browser extensions — is preserved in
  full, in both repositories. We chose visible history over a tidy story.
- **On existing shoulders.** Where mature open tools existed we built on
  them rather than rebuilding: axe-core for WCAG detection, Dark Reader,
  Mozilla Readability, OpenDyslexic, and others recorded in the extension
  repository's VENDORED.md.

## How disabled people were and are involved

Honestly: less, so far, than the end state requires — and structurally, at
the level the Collective could do well in a one-year research phase.

- The member institutions' research projects each work directly with their
  own communities — blind and low-vision learners and families, deaf and
  hard-of-hearing students, people with non-standard speech, older adults
  — and that work informed what the toolkit tries to generalize.
  Community-partner organizations sit inside the Collective, not outside
  it.
- The ability profiles were assembled from published, evidence-based
  guidance (see [PROFILE-CARDS.md](PROFILE-CARDS.md)), not invented — and
  also not yet validated by users of this toolkit. The cards say so.
- Co-design sessions with community members are run by the member
  institutions. Participation currently flows through those institutions;
  if you or your organization want to take part, use the contact route in
  [../MAINTAINERS.md](../MAINTAINERS.md) and your note will be passed to
  the right team.
- The project's own rule, stated in [CONTRIBUTING](../CONTRIBUTING.md):
  people with disabilities must be involved in design and evaluation,
  participants are compensated, and ability profiles are not simulated
  without community input.

## What that process means for you

- Expect research edges: unvalidated adapters, moving APIs, docs that
  trail the code in places.
- Expect honesty about limits: the [README](../README.md) status line,
  the extension repository's WHAT-TO-EXPECT page, and the profile cards
  are all part of the same commitment this page is.
- Expect the invitation to be real: the Collective's phase ends, the
  repositories remain, and the model is that others fork, build, and send
  learnings back. See [CONTRIBUTING](../CONTRIBUTING.md).
