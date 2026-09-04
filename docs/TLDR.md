# Toolkit TL;DR

> Originally written 2026-08-24 as the summary of the re-architecture branch;
> that work has since merged into this repository, and the links below now
> point here. For current per-component detail, start at the
> [README](../README.md) and [docs/README.md](README.md).

A general, platform-agnostic toolkit for adding agentic accessibility to any app (see the [README](../README.md)).

What does the toolkit do and why is it useful? The core value proposition:

* Collect accessibility needs from users into ability profiles
* Provide example surfaces (web, XR, mobile) that render needs per platform, example platform bindings, and a catalog of web adapters — all of which a developer can use or override
* Provide the model, recipes, and catalog that the developer's interface layer consumes

tl;dr: The toolkit understands the person and decides what should change; the developer's app renders and applies it.

Developer flow:

* A developer implements a different repository with their application in it.
* That repository links into the toolkit as a local directory or package… OR uses the toolkit in [server mode](../server/).
* The developer's task is to use the toolkit and create the interface layer that makes the application accessible for users across ability profiles.

Disabled user's experience in an app that uses the toolkit:

* A user with any specific needs should be able to come to the app.
* They request what type of support they need. The toolkit captures that need.
* The toolkit figures out what adaptations serve the need (learning + skill-building, with consent), and hands the host a deterministic settings plan; the host orchestrates applying that layer on top of the app.

tl;dr: Capture a person's accessibility needs as a portable, consent-gated ability model; use an agent to turn plain-language needs into reusable skill recipes grounded in a catalog of fixes; and resolve those, deterministically, into a settings plan the developer's app applies — the same understanding rendering natively across web, XR, and mobile surfaces.

## Also in this repository

- **Controller** ([`controller/`](../controller/)) — an *optional*, platform-neutral text/voice control surface a person uses to drive any app through a neutral `ControlPort` (a sibling of the toolkit, not part of the core). It renders itself per the operator's ability profile, works local or over a remote channel, and hands anything it can't parse to a task-capable app.
- **Onboarding** ([`onboarding/`](../onboarding/)) — a tiny example web service with one conversational front door (`/chat` — profile capture and app control through the same input; `/` redirects there), a step-by-step onboarding form, and the Controller demo, all served from the same port.
