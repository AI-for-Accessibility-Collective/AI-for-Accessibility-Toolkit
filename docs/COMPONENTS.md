# The components

The [README](../README.md) gives one line per component. This page gives
the paragraph. Every component can be used on its own; a host takes the ones
that fit. Counts on this page are as of early September 2026.

Contents: [What a host implements](#what-a-host-implements) ·
[When no AI provider is configured](#when-no-ai-provider-is-configured) ·
[The skills library and registry](#the-skills-library-and-registry) ·
[The catalog](#the-catalog) · [Built on existing tools](#built-on-existing-tools) ·
[The Controller](#the-controller-optional) ·
[The onboarding and chat example service](#the-onboarding-and-chat-example-service) ·
[The CLI](#the-cli-experimental)

## What a host implements

The toolkit is not a complete story on its own. A host brings:

- **Ports** ([`../toolkit/ports/index.js`](../toolkit/ports/index.js)): `KVStore` is the one required argument to `createToolkit`; `Clock`, `Scheduler` and `Consent` default to built-ins and no-ops. Mind the `Consent` default: it is a no-op, so a host that does not wire a consent surface gets a toolkit whose proposals are never shown to anyone. The "suggest, never apply" guarantee holds either way; the core keeps proposals pending until a person resolves them, and the consent surface is what lets a person see and resolve them.
- **An actuation port** ([`../toolkit/ports/actuation.js`](../toolkit/ports/actuation.js)) if the host applies changes to a live surface. Import it directly; it is not re-exported from the index.
- **An LLM caller**, wired in two places if the host wants all the generative features: `librarian.setGeminiCaller(fn)` after construction enables the core's slow lane, and `setAIProvider(provider)` from [`../tools/utils/ai.js`](../tools/utils/ai.js) enables the catalog adapters that can call a provider. They are separate seams; wiring one does not enable the other. Everything structural works with neither.
- **Onboarding**: a way to capture `supportAreas`, free text and a note into a profile. [`../onboarding/`](../onboarding/) is a runnable reference.

## When no AI provider is configured

The catalog degrades deliberately rather than failing as a whole, in two lanes defined in [`../tools/utils/ai.js`](../tools/utils/ai.js) (the provider a host supplies via `setAIProvider`): six core methods (image description, simplification, labeling and similar) throw a clear error when no provider supplies them, and ten optional methods return `null` so the caller skips that enhancement. Adapters catch both, so a missing provider narrows results instead of crashing the page: heuristic-first adapters such as `fix-tables` still land their adaptation with a deterministic fallback, while purely generative ones such as `generate-alt` produce nothing. The check is per method, so a host can supply a partial provider and only the missing capabilities degrade.

One honest limit of the current convention: an adapter does not report upward why it produced nothing, so a host cannot yet tell "no API key" from "the model declined" from "nothing on this page needed it". A structured way to say so is an open item on the [roadmap](../ROADMAP.md).

## The skills library and registry

A **skill** is a `SKILL.md` recipe naming which adapters to apply, with what settings, for a need. It resolves deterministically at apply time; no model runs when a skill is applied. Skills are the best first contribution: no code, and they exercise the whole validation path (see [CONTRIBUTING.md](../CONTRIBUTING.md), "Adding a skill").

- **Starter skills** ([`../toolkit/skills/builtin/`](../toolkit/skills/builtin/)): four recipes composing adapters for common needs.
- **Registry** ([`../toolkit/registry/tools.js`](../toolkit/registry/tools.js)): the single catalog of tools and their settings vocabulary that grounds the skill builder and any host UI. Every tool declares which abilities it helps and where it applies (46 entries).
- **The skill builder** (`toolkit/core/skill-builder.js`, the Engineer): turns a plain-language need plus the profile into a recipe the person validates before it is saved. The `skill-demo` host shows the plumbing with a stub in place of a model.

## The catalog

A developer library of reusable accessibility building blocks in [`../tools/`](../tools/), usable on their own:

- **Adapters** ([`../tools/adapters/`](../tools/adapters/)): 49 modules (the count the conformance test reports): dark mode, text scaling, AI alt text, captions, reduced motion, reader mode, chart-to-table and more. Some can call an AI provider; the rest run with no key and no cost, built on DOM, CSS and browser APIs such as Web Speech and Web Audio.
- **Auditors** ([`../tools/auditors/`](../tools/auditors/)): seven detectors that find barriers for adapters to address (missing alt text, low contrast, unlabeled controls).
- **Validators** ([`../tools/validators/`](../tools/validators/)): the verifier engine for agentic flows. Checks that a page matches what the person asked an agent for and decides how hard to insist. Pairs with the `contract-mismatch` auditor and the `agent-watch` adapter. Machinery only; a host renders its own validation UI.
- **Profiles** ([`../tools/profiles/`](../tools/profiles/)): twelve research-informed, starting-point ability presets (Blind, Low Vision, Dyslexia, Motor, ...) mapping to settings. They are cold-start defaults grounded in WCAG and prior research, not characterizations of any person or group, and not yet validated by studies of this toolkit; see [PROFILE-CARDS.md](PROFILE-CARDS.md) for what each covers and deliberately omits.
- **Utils** ([`../tools/utils/`](../tools/utils/)): shared helpers, including the AI provider seam in `ai.js`.

Catalog API reference: [API.md](API.md).

## Built on existing tools

The catalog builds on established libraries rather than reimplementing them ("Build on existing tools" in [GLOSSARY.md](GLOSSARY.md#principles)):

| Need | Use |
|------|-----|
| WCAG detection | [axe-core](https://github.com/dequelabs/axe-core) |
| Dark mode | [darkreader](https://github.com/darkreader/darkreader) |
| AI descriptions | [Gemini API](https://ai.google.dev/) / [Claude API](https://docs.anthropic.com/) |
| Dyslexia-friendly font | [OpenDyslexic](https://opendyslexic.org/) |
| Focus management | [focus-trap](https://github.com/focus-trap/focus-trap) |
| Readability | [Mozilla Readability](https://github.com/mozilla/readability) |
| Browser automation | [browser-harness](https://github.com/browser-use/browser-harness) / [Playwright](https://playwright.dev/) |

## The Controller (optional)

A ready-made, **platform-neutral text and voice control surface** that lets a person drive any application ("bigger text", "reduce motion", "read this", "open wikipedia.org", or a free-form task) through one neutral **`ControlPort`**. It is an *optional* sibling of the core ([`../controller/`](../controller/)), not part of it: the toolkit never depends on the controller, and the controller consumes the toolkit's settings vocabulary.

- **One core, any receiver.** A local web page, or a remote application (mobile, desktop, XR, another browser) that implements the `ControlPort` and connects back over a channel. The same controller drives all of them. See [`../controller/PROTOCOL.md`](../controller/PROTOCOL.md).
- **Renders itself per operator.** The widget's own input and output (voice or text, spoken or a live region, large targets) is derived from the operator's profile. A screen-reader user hears results in their own voice, never a second TTS voice.
- **Deterministic first, LLM optional.** A zero-dependency grammar handles the settings vocabulary; a host-supplied LLM lane and a `task` catch-all handle the rest. Compound requests ("bigger text and dark mode") fall through to the LLM lane by design, so a host that wires no lane will see them declined.

`createController({ control, operator }) -> { handle, presentation }`. Design and milestones: [`../controller/DESIGN.md`](../controller/DESIGN.md). Voice: [voice-mode.md](voice-mode.md).

## The onboarding and chat example service

[`../onboarding/`](../onboarding/) is a tiny, zero-dependency web service: a runnable reference for the "capture a profile" half of a host. It embeds the toolkit locally or proxies a running `server/`, and (with an admin password) lists and deletes profiles. It serves three surfaces on one port:

| Path | What it is |
|---|---|
| **`/chat`** | The front door (`/` redirects here). One conversational input, text or voice, that does both halves: describing yourself (*"I'm blind"*) updates your profile, and a setting or command (*"bigger text"*, *"open google and search..."*) is carried to the application through the `ControlPort`. The profile stays visible; "back to my profile" undoes drift. |
| `/onboarding` | The step-by-step form: pick support areas, describe your needs, hear it read back. |
| `/controller` | The floating Controller widget driving a demo application, or a remote receiver. |

The chat is deliberately **deterministic-first**: the grammar and the self-description heuristic resolve instantly and offline, and anything they do not claim is passed to the application rather than guessed at. An LLM lane is optional; without a key the surface still works fully for settings and onboarding.

## The CLI (experimental)

[`../cli/`](../cli/) is the toolkit's command line. It drives a real Chromium page over the Chrome DevTools Protocol and injects the same adapters, auditors and profiles the catalog ships, so a developer or a coding agent can try them on a live page from a terminal:

```bash
pip install -e .                        # installs the ai4a11y command (Python 3.10+)
python -m playwright install chromium   # the browser the session commands drive
npm run build:cli                       # only after editing tools/; the bundle is committed

ai4a11y list tools               # every auditor and adapter, from tools/
ai4a11y session start            # launch a persistent Chromium
ai4a11y session go <url>
ai4a11y session audit            # axe-core WCAG audit of the live page
ai4a11y session profile lowVision
ai4a11y session stop
```

Thirteen of the 51 `ai4a11y session` commands call the locally installed Claude Code CLI, and say so in their own help text. Five more reach it as well: `summary`, `diff` and `fix-all` call it directly, while `go` and `profile` leave AI-backed adapters running on the tab. For all eighteen, a screenshot or the page's text leaves the browser, once per item rather than once per command. The rest run entirely locally. Without that CLI the AI-backed commands write nothing to the page and say `needs-ai`. [`../cli/README.md`](../cli/README.md) lists which commands are which, what each one sends, and what it costs. Experimental and pre-alpha, like the rest of this repository.
