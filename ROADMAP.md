# Roadmap

Last updated: September 10, 2026. This lists what is open, not what
is done. Statuses describe what is in the codebase, not a claim about any
team's plans. This is a research probe, and nothing here is a
release commitment.

## Governance

- **Maintainer and code owners: to be designated.** The Collective is
  working out stewardship of this repository (maintenance, moderation of
  outside contributions, hosting). Until then, nothing on this list has an
  owner unless it names one, and response times on issues and pull
  requests are best-effort.
- A more detailed contribution policy (what gets accepted, how it is reviewed, how
  improvements from forks come back) is being drafted.

## Recently landed

- The core and the catalog are consumable as packages; the extension
  repository vendors them as pinned tarballs and rebuilds its bundles from
  them.
- The CLI returned to this repository (`cli/`), rewired to the split tree,
  with a test harness.

## Open, toward the end of the research phase (November 2026)

The Collective's current research phase runs to November 2026. By then this
repository aims to be a fully packaged research release: cleaned tree,
current documentation and disclosures, agreed attribution, and
supplementary resources (learnings, design principles, co-design
insights). Concretely open:

- Create a non-technical landing page for audiences that are not familiar with GitHub.
- Write per-audience documentation (the README is currently written for all audiences, though it lists the map of intended audiences).
- Create more example applications, including demonstrations built with
  and without toolkit components.
- Host community engagement sessions for feedback from disabled communities.
- Conduct developer validation through community events and workshops.
- XR agent example: real-time adaptations in the physical world.
- Perform a security review before public release. The split makes this concrete:
  this repository's SECURITY.md was rewritten to match this tree, and the
  extension repository carries its own.
- Integrate learnings from each institution's projects (the list lives in [docs/projects.md](docs/projects.md)).
- Define design principles (in progress; the current statement is the
  Principles section of [docs/GLOSSARY.md](docs/GLOSSARY.md#principles)).
- Audit this repository's own accessibility and improve to the extent possible for a GitHub repository.

## Future (in coordination with the AI Collaborative: Accessibility)

- Build an evaluation benchmark (test-sites arena), with success measures
  for different types of adaptation, including combined and intersecting
  needs. The mechanical half, an execution-checking harness, is scoped as
  its own work item; benchmark-based accessibility assessment stays
  deferred until an external evaluation framework lands.

## Named gaps without an owner

These were raised in the Collective's review and are represented here
rather than filled. Each is owner-TBD.

- Offering the Controller inside an arbitrary page without host code to
  mount it. The review asked for in-page natural-language requests and a
  voice-mode UI; the [Controller](controller/) already provides the
  text/voice widget, speech recognition, and natural-language commands
  (see [docs/voice-mode.md](docs/voice-mode.md)), so what remains open is
  the delivery path: today a host must implement a `ControlPort` and mount
  the widget itself.
- Letting a person ask for a new adaptation from inside a host by pointing
  at the page and describing the need in their own words — which would
  double as a consented dataset of what adaptations people actually want.
- An observer API for behavioral inference (build the interface now;
  attach a model only once consented observational data exists).
- An easy feedback route for end users and researchers — for example a
  closed beta with sign-up — so the next version can learn from use.
  GitHub issues are the only route today.
- Borrowing external review agents (for example, published accessibility
  review agents for ARIA, contrast, keyboard navigation, forms, tables)
  and translating some into adapters — with the Librarian potentially
  acting as an orchestrator over borrowed agents rather than each being
  rewritten.
- A structured "why nothing happened" signal from adapters, so a host can
  tell a missing API key from a model refusal (see "When no AI provider is
  configured" in [docs/COMPONENTS.md](docs/COMPONENTS.md#when-no-ai-provider-is-configured)).
- Native mobile (iOS) application example.
- Public release, and the distribution decisions that precede it
  (extension store listings, package registry publishing). Maintainer
  decisions, owner to be designated.
