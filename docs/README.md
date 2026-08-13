# Docs

Documentation for the AI for Accessibility Toolkit. Links are relative to this
directory. Rule of thumb: **top level = current behavior** (reference, guides,
shipped features); **[design/](design/) = internal, point-in-time** plans and
analyses that are not necessarily current.

## Start here

- [architecture.md](architecture.md) — System architecture: the three agents (Assistant, Engineer, Librarian), layers, components, and data flow.
- [xr-getting-started.md](xr-getting-started.md) — Short path for XR developers: demo, the needs model, embed-vs-HTTP integration, consent-gated write-back.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common problems and fixes (setup, API keys, build).

## Reference

- [API.md](API.md) — The **tools layer** API: auditors, adapters, profiles, and the AI-provider abstraction.
- Generated references elsewhere in the repo (regenerate, don't edit):
  - [../toolkit/API.md](../toolkit/API.md) — the toolkit core (Librarian/Datastore methods, ports, surfaces, protocol); `npm run docs` in `toolkit/`.
  - [../server/API.md](../server/API.md) — the hosted service's HTTP routes; also served live at `GET /v1/meta`.
  - [../.claude/skills/ai4a11y-toolkit/SKILL.md](../.claude/skills/ai4a11y-toolkit/SKILL.md) — the Claude Code skill (same generated model).
- Hosted service (hand-maintained, in [../server/](../server/)): [CONTRACT.md](../server/CONTRACT.md) (wire contract) · [DEPLOYMENT.md](../server/DEPLOYMENT.md) (runbook) · [INTERNAL-USE.md](../server/INTERNAL-USE.md) (team guidelines).

## Feature docs (shipped behavior)

- [voice-mode.md](voice-mode.md) — Voice mode: full toolkit control via Gemini Live (consent invariants, undo, actuation port).
- [artinsight-integration.md](artinsight-integration.md) — ArtInsight as the toolkit's second consumer (Swift conformer, profile blob, insight outbox).

## Community

- [projects.md](projects.md) — Canonical inventory of collective team projects.
- [agent-card.md](agent-card.md) — Contribution/agent card template for proposing new capabilities.

## Design docs (internal, point-in-time)

[design/](design/) — proposals and analyses; snapshots, not necessarily current behavior:

- [toolkit-refactor-plan.md](design/toolkit-refactor-plan.md) — Extract the Librarian/datastore core into a portable toolkit (Phases 0–4, with status updates).
- [toolkit-adversarial-analysis.md](design/toolkit-adversarial-analysis.md) — W3C-persona adversarial analysis that stress-tested the refactor plan.
- [cross-surface-analysis.md](design/cross-surface-analysis.md) — How one AbilityModel renders to web/XR/mobile; the translation chain and its honest limits.
- [adapter-robustness-plan.md](design/adapter-robustness-plan.md) — Demand × differentiation plan behind the adapter-robustness program (W1–W5).
- [observable-settings.md](design/observable-settings.md) — Survey of OS/browser accessibility settings an extension can observe.
- [adapter-overlap.md](design/adapter-overlap.md) — Overlap audit of built-in adapters vs. existing tools.
- [verifier-architecture.md](design/verifier-architecture.md) — The validation layer: validators, human contract, agent overlay.
- [skill-builder-plan.md](design/skill-builder-plan.md) — Original plan for the builder UI (predates the skill/adapter split; the code-gen part became the Adapter Builder).
- [skill-builder-handoff.md](design/skill-builder-handoff.md) — Original hand-off spec for that builder implementation.
- [generative-ephemeral-ui-brainstorm.md](design/generative-ephemeral-ui-brainstorm.md) — Brainstorm on generative ephemeral UI for accessibility.

## Assets

- [diagrams/](diagrams/) — Architecture diagrams: `architecture-overview.png`, `toolkit-layers.png`, `ability-profile-flow.png`, `skill-creation-flow.png`, `xr-agent-ideas.png`.
- [logos/](logos/) — Team and project logo image assets.
