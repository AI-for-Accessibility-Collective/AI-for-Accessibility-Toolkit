<div align="center">

# AI for Accessibility Toolkit

**A general, platform-agnostic toolkit for adding agentic accessibility to any app.**

[Quick Start](#quick-start) · [Concepts](#core-concepts) · [Using the Toolkit](#using-the-toolkit) · [Controller](#the-controller-optional) · [Catalog](#the-catalog) · [Architecture](docs/architecture.md) · [API](toolkit/API.md)

</div>

---

Most accessibility tooling audits a single surface and hands you a report. This is different: it's an embeddable engine that learns **what a person needs** — bigger text, described images, reduced motion, simpler language — as one portable, consent-gated **AbilityModel**, and lets any host render that understanding natively. Onboard a user once; adapt everywhere they go.

It is **not an app.** It's a library you build on. Any developer — web, mobile, XR, desktop, server — can wire in a small set of platform ports and get a personalization core, an agent that turns plain-language needs into reusable recipes, and a catalog of ready-made accessibility fixes to draw from.

## Why

- **Understand the person, not just the page.** Per-app settings become one device-independent model of ability (`text.size × 1.4`, `vision.descriptions`, `motion: reduced`), with per-dimension confidence and provenance.
- **Onboard once, adapt everywhere.** The same model renders to web CSS settings, XR angular text sizing, or any surface you write — no re-interviewing the user per device.
- **Suggest, never apply.** Everything an inference could be wrong about flows through a proposal/consent queue. Nothing silently changes a person's profile.
- **Privacy by default.** Single-writer stores, no-memory zones for sensitive categories, and a permission broker that shares understanding with other apps only under explicit, revocable, audited grants.
- **Bring your own everything.** Inject your own storage, clock, scheduler, consent UI, and LLM. The core touches no platform API directly.

## Quick Start

The core is plain ES modules. Wire it to the reference Node platform bindings and go — no browser, no build, no API key:

```javascript
import { createToolkit } from './toolkit/index.js';
import { memoryKV } from './toolkit/platforms/node/kv.js';
import { nodeClock, nodeScheduler, consoleConsent } from './toolkit/platforms/node/ports.js';

const { datastore, librarian } = createToolkit({
  kv: memoryKV(),
  clock: nodeClock(),
  scheduler: nodeScheduler(),
  consent: consoleConsent({ silent: true }),
});

await datastore.runMigrations();
await librarian.setProfileField('supportAreas', ['vision']);

// One device-independent understanding of the person…
const model = await librarian.getAbilityModel();

// …rendered for whatever surface you're building:
import { renderWebSettings } from './toolkit/surfaces/web.js';
import { renderXRSettings } from './toolkit/surfaces/xr.js';
renderWebSettings(model);                        // { fontScale: 140, ... }
renderXRSettings(model, { fovDegrees: 100 });    // { text: { angularSizeDeg, ... }, ... }
```

Run the end-to-end demos with no setup:

```bash
node toolkit/hosts/xr-demo/demo.js      # onboard on web → grant → XR renders → insight flows back → accept
node toolkit/hosts/skill-demo/demo.js   # retrieve → resolve → build → validate → save a skill
node examples/cross-surface.mjs         # one AbilityModel → web + XR, side by side
```

Full method reference: [`toolkit/API.md`](toolkit/API.md).

## Core Concepts

| Concept | What it is |
|---|---|
| **AbilityModel** | The device-independent understanding of a person's needs — relative magnitudes, need-named enums, per-dimension confidence. The thing every surface renders. |
| **Librarian** | The personal memory/profile agent. Owns the profile and memory, learns from settings over time, retrieves/builds skills, and gatekeeps what other apps may read. |
| **Engineer** (skill builder) | Turns a plain-language need + the ability profile into a `SKILL.md` recipe that composes adapters. The user validates before it's saved. |
| **Ports** | The small interfaces a host implements — `KVStore`, `Clock`, `Scheduler`, `Consent`, and an actuation port. The core never calls a platform API directly. |
| **Surfaces** | Pure renderers (`toolkit/surfaces/*.js`) that map an AbilityModel to platform-specific settings. |
| **Adapter** | Executable code that performs one accessibility fix (dark mode, bigger text, AI alt text, …). The developer catalog lives in `tools/adapters/`. |
| **Skill** (`SKILL.md`) | A model-facing recipe naming which adapters to apply, with what settings, for a need — resolves deterministically at apply-time (no LLM). |

See [docs/architecture.md](docs/architecture.md) for how they fit together, and the [`ai4a11y-toolkit` skill](.claude/skills/ai4a11y-toolkit/SKILL.md) for an embedding walkthrough.

## Using the Toolkit

Three ways to build on it, depending on your host:

1. **Embed the core directly (any JS runtime).** `createToolkit({ ports }) → { datastore, librarian }`. Implement the ports for your platform — the Node bindings in [`toolkit/platforms/node/`](toolkit/platforms/node/) are the template; a Chrome host implementation lives in [`toolkit/platforms/chrome/`](toolkit/platforms/chrome/).
2. **Call the hosted HTTP service (any language).** Run [`server/`](server/) (locally or on Cloud Run) and hit the same Librarian methods over HTTP with a bearer token — for non-JS clients, or to keep the profile server-side. See [server/README.md](server/README.md).
3. **Draw from the catalog.** Use the ready-made accessibility fixes, detectors, and profiles in [`tools/`](tools/) — and the tools/skills registry in [`toolkit/registry/`](toolkit/registry/) — as building blocks, whether or not you embed the personalization core.
4. **Drop in the Controller.** Give people a text/voice way to drive your app: implement the `ControlPort` for your surface and mount the [`controller/`](controller/) widget (or connect it to a remote receiver). Optional and independent of the core.

## The Controller (optional)

A ready-made, **platform-neutral text/voice control surface** that lets a person
drive any app — "bigger text", "reduce motion", "read this", "open wikipedia.org",
or a free-form task — through one neutral **`ControlPort`**. It's an *optional*
sibling of the core ([`controller/`](controller/)), not part of it: the toolkit
never depends on the controller; the controller consumes the toolkit's settings
vocabulary.

- **One core, any receiver.** A local web page, or a remote app (mobile / desktop /
  XR / another browser) that implements the `ControlPort` and connects back over a
  channel — the same controller drives all of them. See
  [`controller/PROTOCOL.md`](controller/PROTOCOL.md).
- **Renders itself per operator.** The widget's own input/output (voice vs text,
  spoken vs a live region, large targets) is derived from the operator's
  AbilityModel — a screen-reader user hears results in their own voice, never a
  second TTS voice.
- **Deterministic first, LLM optional.** A zero-dependency grammar handles the
  settings vocabulary; a host-supplied LLM lane and a `task` catch-all handle the
  rest.

`createController({ control, operator }) → { handle, presentation }`. Design +
milestones: [`controller/DESIGN.md`](controller/DESIGN.md).

## Onboarding (example service)

[`onboarding/`](onboarding/) is a tiny, zero-dependency web service that captures
a person's needs into an ability profile (embedding the toolkit locally, or
proxying a running `server/`), and — with an admin password — lists and deletes
profiles. It also serves the Controller demo from the same port. A runnable
reference for the "capture a profile" half of a host.

## The Catalog

A developer library of reusable accessibility building blocks, usable on their own:

- **Adapters** ([`tools/adapters/`](tools/adapters/)) — 40+ fixes: dark mode, text scaling, AI alt text, captions, reduced motion, reader mode, chart-to-table, and more.
- **Auditors** ([`tools/auditors/`](tools/auditors/)) — detectors that find issues for adapters to fix (missing alt text, low contrast, unlabeled controls).
- **Validators** ([`tools/validators/`](tools/validators/)) — the verifier engine for agentic flows: check that a page matches what the person asked an agent for and decide how hard to insist. Pairs with the `contract-mismatch` auditor and the `agent-watch` adapter. Machinery only — a host renders its own validation UI.
- **Profiles** ([`tools/profiles/`](tools/profiles/)) — evidence-based ability presets (Blind, Low Vision, Dyslexia, Motor, …) mapping to settings.
- **Registry** ([`toolkit/registry/tools.js`](toolkit/registry/tools.js)) — the single catalog of tools + their settings vocabulary that grounds the Engineer and any host UI.
- **Starter skills** ([`toolkit/skills/builtin/`](toolkit/skills/builtin/)) — `SKILL.md` recipes composing adapters for common needs.

## The CLI (experimental)

[`cli/`](cli/) is the toolkit's command line, restored from the pre-split tree and rewired to this repository's catalog. It drives a real Chromium page over the Chrome DevTools Protocol and injects the same adapters, auditors, and profiles the catalog ships, so a developer or a coding agent can try them on a live page from a terminal:

```bash
pip install -e .       # installs the ai4a11y command (Python 3.10+)
npm run build:cli      # bundle the catalog for injection

ai4a11y list tools               # every auditor and adapter, from tools/
ai4a11y session start            # launch a persistent Chromium
ai4a11y session go <url>
ai4a11y session audit            # axe-core WCAG audit of the live page
ai4a11y session profile lowVision
ai4a11y session stop
```

About half the session commands reach the locally installed Claude Code CLI, which means a screenshot or the page's text leaves the browser, once per item rather than once per command. The rest run entirely locally. [`cli/README.md`](cli/README.md) lists which are which, what each sends, and what it costs. Without that CLI the AI-backed commands write nothing to the page and say `needs-ai`. Details in [`cli/README.md`](cli/README.md). Experimental and pre-alpha, like the rest of this repository.

## Repository Layout

```
toolkit/     Platform-agnostic core — Librarian, datastore, ability model, broker,
             skill engine, ports, sync, protocol, surfaces, reference platform bindings
tools/       Developer catalog — adapters, auditors, profiles, utils
controller/  Optional text/voice control surface — ControlPort, grammar, mounts,
             remote transport, web UI, demo (a sibling; the core never depends on it)
server/      Hosted HTTP service exposing the core to any language/runtime
cli/         Experimental Python CLI: try the catalog on a live page from a terminal
onboarding/  Example web service: capture a profile + serve the Controller demo
examples/    Runnable, dependency-free examples
docs/        Architecture, API, and design docs
```

## Contributing

Add an adapter or auditor to the catalog, a profile, a `SKILL.md` recipe, a surface renderer, or a platform port. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/API.md](docs/API.md).

## Principles

- **Ability-based** — adapt to what a person *can* do, not a diagnosis.
- **Suggest, never apply** — proposals with user validation; no silent changes.
- **Privacy by default** — single-writer stores, no-memory zones, permission-gated sharing.
- **Platform-agnostic** — the core stays free of any surface; hosts and surfaces bring the platform.
- **Build on existing tools** — axe-core, DarkReader, Readability, and your choice of LLM.

## Security & License

Report vulnerabilities via [SECURITY.md](SECURITY.md). Licensed under Apache 2.0 ([LICENSE](LICENSE)).

---

<h2 align="center">AI for Accessibility Collective</h2>

<div align="center">
<p>
  <a href="https://www.stanford.edu/"><img src="docs/logos/stanford.png" alt="Stanford University" height="38"></a>
  &nbsp;&nbsp;
  <a href="https://www.washington.edu/"><img src="docs/logos/uw.png" alt="University of Washington" height="32"></a>
  &nbsp;&nbsp;
  <a href="https://www.media.mit.edu/"><img src="docs/logos/mit.png" alt="MIT Media Lab" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://www.disabilityinnovation.com/"><img src="docs/logos/gdi.jpg" alt="UCL GDI Hub" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://www.rit.edu/ntid/"><img src="docs/logos/rit.png" alt="RIT/NTID" height="40"></a>
  &nbsp;&nbsp;
  <a href="https://thearc.org/"><img src="docs/logos/thearc.png" alt="The Arc" height="35"></a>
  &nbsp;&nbsp;
  <a href="https://rnid.org.uk/"><img src="docs/logos/rnid.png" alt="RNID" height="32"></a>
  &nbsp;&nbsp;
  <a href="https://www.google.org/"><img src="docs/logos/google.png" alt="Google.org" height="28"></a>
</p>
</div>
</div>
