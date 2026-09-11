# Docs

Documentation for the AI for Accessibility Toolkit, an open toolkit for
building solutions that adapt digital channels to the person. Links are
relative to this directory. Rule of thumb: **top level = current behavior**
(reference, guides); **[design/](design/) = internal, point-in-time** plans
and analyses that are not necessarily current.

## Where things moved

The repository used to hold the extensions, the CLI and team projects
alongside the core. The extensions and team projects now live in the
[extension repository](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Extension),
split out with **full history preserved** in both repositories. The CLI is
back in this repository under `cli/`.

| Old path | Now |
|---|---|
| `extension/`, `personalized-extension/` | The extension repository. |
| `webapp/` | The extension repository, as candidates to return to their originating teams. |
| `projects/` | The extension repository; the canonical list stays at [projects.md](projects.md). |
| `cli/` | Still here, at [`../cli/`](../cli/). See [`../cli/README.md`](../cli/README.md). |
| `toolkit/adapters/` | Renamed in place to `toolkit/platforms/`, to keep "adapter" for the catalog's adaptations. |

## Start here

- [TLDR.md](TLDR.md): The toolkit in plain words, for readers who won't parse the developer README.
- [QUICKSTART.md](QUICKSTART.md): Run the demos, then embed the core in twenty lines.
- [GLOSSARY.md](GLOSSARY.md): The four key terms, the code's own vocabulary, and the design principles.
- [COMPONENTS.md](COMPONENTS.md): What a host implements, and the paragraph-length version of every component: skills library and registry, catalog, Controller, onboarding service, CLI.
- [architecture.md](architecture.md): How the system is shaped: one need followed end to end, skill creation, the privacy and consent mechanics, and the invariants a change must not break.
- [../.claude/skills/ai4a11y-toolkit/SKILL.md](../.claude/skills/ai4a11y-toolkit/SKILL.md): Embedding walkthrough: wire the ports, call the API, implement a host, or use the HTTP service.
- [web-extension-getting-started.md](web-extension-getting-started.md): Short path for a browser-extension host: the Chrome port factories, skill-layer wiring, render-and-apply, the two AI seams.
- [xr-getting-started.md](xr-getting-started.md): Short path for a non-web host: demo, the needs model, embed-vs-HTTP integration, consent-gated write-back.
- [using-in-your-project.md](using-in-your-project.md): Consuming `@ai4a11y/toolkit` and `@ai4a11y/tools` in your own project (not on npm yet — the pack-and-vendor recipe).
- [HOW-THIS-WAS-BUILT.md](HOW-THIS-WAS-BUILT.md): Who built this, how, and what that means for what you can expect.

## Reference

- [../toolkit/API.md](../toolkit/API.md): The **core** API (Librarian/Datastore methods, ports, surfaces, protocol). Generated, regenerate with `npm run docs` in `toolkit/`, don't hand-edit.
- [API.md](API.md): The **catalog** API: auditors, adapters, profiles, and the AI-provider abstraction in `tools/`.
- [PROFILE-CARDS.md](PROFILE-CARDS.md): What each ability profile covers, what it deliberately omits, and its validation status.
- Hosted service ([../server/](../server/)): [../server/API.md](../server/API.md) (HTTP routes, also served at `GET /v1/meta`) · [CONTRACT.md](../server/CONTRACT.md) (wire contract) · [DEPLOYMENT.md](../server/DEPLOYMENT.md) (runbook; placeholders only, real instance details are deliberately not in the repo).
- [FOLLOW-UPS.md](FOLLOW-UPS.md): Deferred work that's been scoped but not (fully) done; receiver tasks vs toolkit tasks.

## Controller (optional control surface)

The ready-made text/voice control surface that drives any app through a neutral
`ControlPort`, a repo-root sibling ([`../controller/`](../controller/)), optional
and independent of the core.

- [COMPONENTS.md, "The Controller"](COMPONENTS.md#the-controller-optional): The overview.
- [../controller/DESIGN.md](../controller/DESIGN.md): Design + staged milestones: the neutral `ControlPort`, the hybrid intent engine, per-operator presentation, mounts, and the remote transport.
- [../controller/PROTOCOL.md](../controller/PROTOCOL.md): The wire contract a **receiver** implements (the seven `ControlPort` methods, the JSON envelope, the `task`/`navigate`/`search` actions, the receiver→Controller note): what a project like `browser-harness-a11y` builds against.
- [../onboarding/README.md](../onboarding/README.md): Example service that captures a profile and serves the Controller demo at `/controller`. Overview in [COMPONENTS.md](COMPONENTS.md#the-onboarding-and-chat-example-service).

## Consumer / feature references

- [artinsight-integration.md](artinsight-integration.md): Concept: testing the toolkit with a native app (Swift conformer, profile blob, insight outbox). Separates what exists in the repositories today from the prototype drafted outside them. ArtInsight is one candidate; the shape applies to any host.
- [voice-mode.md](voice-mode.md): How voice mode works in the **toolkit**: the Controller's speech input, the hybrid intent engine, per-operator delivery (live region vs TTS), earcons, confirmation, and driving a remote app. (The extension's own Gemini-Live voice mode lives, and is documented, in the extension repository.)

## Community

- [projects.md](projects.md): Inventory of Collective team projects building on the toolkit. **Canonical copy**, the extension repository carries a pointer.
- [agent-card.md](agent-card.md): Contribution/agent card template for proposing new capabilities. **Canonical copy**, the extension repository carries a pointer.

## Design docs (internal, point-in-time)

[design/](design/): proposals and analyses; snapshots, not necessarily current behavior:

- [toolkit-refactor-plan.md](design/toolkit-refactor-plan.md): Extraction of the Librarian/datastore core into a portable toolkit (Phases 0–4, with status updates).
- [toolkit-adversarial-analysis.md](design/toolkit-adversarial-analysis.md): W3C-persona adversarial analysis that stress-tested the refactor plan.
- [cross-surface-analysis.md](design/cross-surface-analysis.md): How one AbilityModel renders to web/XR/mobile; the translation chain and its honest limits.
- [adapter-robustness-plan.md](design/adapter-robustness-plan.md): Demand × differentiation plan behind the adapter-robustness program (W1–W5).
- [observable-settings.md](design/observable-settings.md): Survey of OS/browser accessibility settings a host can observe.
- [adapter-overlap.md](design/adapter-overlap.md): Overlap audit of built-in adapters vs. existing tools.
- [verifier-architecture.md](design/verifier-architecture.md): The validation layer: validators, human contract, agent overlay.
- [skill-builder-plan.md](design/skill-builder-plan.md): Original plan for the builder UI (predates the skill/adapter split).
- [skill-builder-handoff.md](design/skill-builder-handoff.md): Original hand-off spec for that builder implementation.
- [generative-ephemeral-ui-brainstorm.md](design/generative-ephemeral-ui-brainstorm.md): Brainstorm on generative ephemeral UI for accessibility.

## Assets

- [diagrams/](diagrams/): Architecture diagrams: `ability-profile-flow.png` and `skill-creation-flow.png`, used in architecture.md. 
- [logos/](logos/): Team and project logo image assets.
