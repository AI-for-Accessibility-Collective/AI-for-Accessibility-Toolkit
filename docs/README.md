# Docs

Documentation for the AI for Accessibility Toolkit. Links are relative to this directory.

## Reference

- [architecture.md](architecture.md) — System architecture: layers, components, and data flow.
- [API.md](API.md) — Public API for auditors, adapters, profiles, and the AI provider abstraction.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common problems and fixes (setup, API keys, build).
- [projects.md](projects.md) — Canonical inventory of collective team projects.
- [agent-card.md](agent-card.md) — Contribution/agent card template for proposing new capabilities.

## Diagrams

[diagrams/](diagrams/) — Architecture diagrams (source of truth):

- `architecture-overview.png` — End-to-end system overview.
- `toolkit-layers.png` — Toolkit layer breakdown.
- `ability-profile-flow.png` — Ability-profile onboarding flow.
- `skill-creation-flow.png` — Skill creation flow (the Engineer builds a skill from a need).
- `xr-agent-ideas.png` — XR/agent concept sketches.

## Design docs

[design/](design/) — Internal design documents (proposals and point-in-time snapshots, not necessarily current behavior):

- [toolkit-refactor-plan.md](design/toolkit-refactor-plan.md) — Extract the Librarian/datastore core into a portable toolkit.
- [adapter-overlap.md](design/adapter-overlap.md) — Overlap audit of built-in adapters vs. existing tools.
- [generative-ephemeral-ui-brainstorm.md](design/generative-ephemeral-ui-brainstorm.md) — Brainstorm on generative ephemeral UI for accessibility.
- [skill-builder-plan.md](design/skill-builder-plan.md) — Original plan for the builder UI (predates the skill/adapter split; the code-gen part became the Adapter Builder).
- [skill-builder-handoff.md](design/skill-builder-handoff.md) — Original hand-off spec for that builder implementation.

## Assets

- [logos/](logos/) — Team and project logo image assets.
