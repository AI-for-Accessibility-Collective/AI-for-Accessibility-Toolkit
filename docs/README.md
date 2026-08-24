# Docs

Documentation for the AI for Accessibility Toolkit — a platform-agnostic library
for adding agentic accessibility to any app. Links are relative to this
directory. Rule of thumb: **top level = current behavior** (reference, guides);
**[design/](design/) = internal, point-in-time** plans and analyses that are not
necessarily current.

## Start here

- [architecture.md](architecture.md) — System architecture: the Librarian and Engineer agents, the ability model, ports, surfaces, the datastore, and the consent/broker layer.
- [../.claude/skills/ai4a11y-toolkit/SKILL.md](../.claude/skills/ai4a11y-toolkit/SKILL.md) — Embedding walkthrough: wire the ports, call the API, implement a host, or use the HTTP service.
- [xr-getting-started.md](xr-getting-started.md) — Short path for a non-web host: demo, the needs model, embed-vs-HTTP integration, consent-gated write-back.

## Reference

- [../toolkit/API.md](../toolkit/API.md) — The **core** API (Librarian/Datastore methods, ports, surfaces, protocol). Generated — regenerate with `npm run docs` in `toolkit/`, don't hand-edit.
- [API.md](API.md) — The **catalog** API: auditors, adapters, profiles, and the AI-provider abstraction in `tools/`.
- Hosted service ([../server/](../server/)): [../server/API.md](../server/API.md) (HTTP routes, also served at `GET /v1/meta`) · [CONTRACT.md](../server/CONTRACT.md) (wire contract) · [DEPLOYMENT.md](../server/DEPLOYMENT.md) (runbook; placeholders only — real instance details are deliberately not in the repo).

## Consumer / feature references

- [artinsight-integration.md](artinsight-integration.md) — A second, non-web consumer of the toolkit (Swift conformer, profile blob, insight outbox) — a worked example of embedding the core in another host.
- [voice-mode.md](voice-mode.md) — A host controlling the toolkit by voice via the actuation port (consent invariants, reversible undo) — the pattern a host follows to drive adaptations agentically.

## Community

- [projects.md](projects.md) — Inventory of collective team projects building on the toolkit.
- [agent-card.md](agent-card.md) — Contribution/agent card template for proposing new capabilities.

## Design docs (internal, point-in-time)

[design/](design/) — proposals and analyses; snapshots, not necessarily current behavior:

- [toolkit-refactor-plan.md](design/toolkit-refactor-plan.md) — Extraction of the Librarian/datastore core into a portable toolkit (Phases 0–4, with status updates).
- [toolkit-adversarial-analysis.md](design/toolkit-adversarial-analysis.md) — W3C-persona adversarial analysis that stress-tested the refactor plan.
- [cross-surface-analysis.md](design/cross-surface-analysis.md) — How one AbilityModel renders to web/XR/mobile; the translation chain and its honest limits.
- [adapter-robustness-plan.md](design/adapter-robustness-plan.md) — Demand × differentiation plan behind the adapter-robustness program (W1–W5).
- [observable-settings.md](design/observable-settings.md) — Survey of OS/browser accessibility settings a host can observe.
- [adapter-overlap.md](design/adapter-overlap.md) — Overlap audit of built-in adapters vs. existing tools.
- [verifier-architecture.md](design/verifier-architecture.md) — The validation layer: validators, human contract, agent overlay.
- [skill-builder-plan.md](design/skill-builder-plan.md) — Original plan for the builder UI (predates the skill/adapter split).
- [skill-builder-handoff.md](design/skill-builder-handoff.md) — Original hand-off spec for that builder implementation.
- [generative-ephemeral-ui-brainstorm.md](design/generative-ephemeral-ui-brainstorm.md) — Brainstorm on generative ephemeral UI for accessibility.

## Assets

- [diagrams/](diagrams/) — Architecture diagrams: `architecture-overview.png`, `toolkit-layers.png`, `ability-profile-flow.png`, `skill-creation-flow.png`, `xr-agent-ideas.png`.
- [logos/](logos/) — Team and project logo image assets.
