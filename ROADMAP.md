# Roadmap

Last updated: 2026-08-30. This lists what is genuinely open, not what is done. Statuses describe what is in the codebase, not a claim about any team's plans. This is a research probe, pre-alpha; nothing here is a release commitment.

## Governance

- **Maintainer and code owners: to be designated before the hackathon.** Until then, nothing on this list has an owner unless it names one.

## In review (draft pull requests exist)

- Make the core and the catalog consumable as packages, with a packed-tarball check in CI.
- Return the CLI to this repository, rewired to the split tree, with a test harness.

## Open, carried from the pre-split roadmap

- Write per-audience documentation (the README now carries the map; the substance is open).
- Create example applications.
- Test with users.
- Developer validation (hackathon).
- Security review before public release. The split makes this concrete: this repository's SECURITY.md was rewritten to match this tree, and the extension repository carries its own.
- Build the evaluation benchmark (test-sites arena). The mechanical half, an execution-checking harness, is scoped as its own work item; benchmark-based accessibility assessment stays deferred until an external evaluation framework lands.
- Integrate team projects (the list lives in [docs/projects.md](docs/projects.md)).
- Define design principles (in progress; the README's Principles section is the current statement).

## Future (no work exists)

- A structured "why nothing happened" signal from adapters, so a host can tell a missing API key from a model refusal (see the README's "When no AI provider is configured").
- Native mobile app (iOS).
- XR agent: real-time adaptations in the physical world.
- Public release, and the distribution decisions that precede it (extension store listings, package registry publishing). Maintainer decisions, owner to be designated.

## Named gaps without an owner

These were raised in the Collective's review and are represented here rather than filled. Each is owner-TBD.

- Offering the Controller inside an arbitrary page without host code to mount it. The review asked for in-page natural-language requests and a voice-mode UI; the [Controller](controller/) already provides the text/voice widget, speech recognition, and natural-language commands (see [docs/voice-mode.md](docs/voice-mode.md)), so what remains open is the delivery path: today a host must implement a `ControlPort` and mount the widget itself.
- An observer API for behavioral inference.
- Closed-beta signup flows.
- Borrowing external review agents.

Prepared with AI assistance; reviewed and edited by Josephine, who is responsible for its content.
