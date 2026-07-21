<div align="center">

# AI for Accessibility Toolkit

**AI-powered web accessibility that adapts pages in real time**

[![CI](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![Contributors](https://img.shields.io/github/contributors/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit)](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/graphs/contributors)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

[Quick Start](#quick-start) · [Examples](#examples) · [How It Works](#how-it-works) · [Profiles](#profiles) · [Docs](docs/README.md) · [Contributing](#contributing)

</div>

---

[axe-core](https://github.com/dequelabs/axe-core) and [Pa11y](https://github.com/pa11y/pa11y) find accessibility problems and hand you a report. This one fixes them instead, live in the browser and tuned to whoever's reading.

It's a Chrome extension, a developer CLI, and a small platform-agnostic core other apps can build on.

## Quick Start

**Chrome extension.** It isn't on the Chrome Web Store yet, so for now you build it from source once.

```bash
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit
npm install && npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder. Add a free [Gemini key](https://aistudio.google.com/apikey) in the popup. From here it's all no-code: choose your profile(s) and browse — pages adapt as you go. Try the [test site](https://ai4a11y-test-site.vercel.app/) first.

**CLI** — for developers and coding agents:

```bash
pip install -e . && playwright install chromium
export ANTHROPIC_API_KEY=sk-...

ai4a11y session start
ai4a11y session go https://example.com
ai4a11y session audit
```

Add `--json` to any command for output that drops into scripts, CI, and agents.

## Examples

**In the extension** (no code). Once it's loaded:

- Turn on **Dyslexia** and open a long article. Text enlarges, spacing opens up, and side clutter dims.
- Land on a page of unlabeled images or an uncaptioned video. It writes the alt text and generates captions for you.
- Open the **Skill Builder**, type *"make Reddit calmer to read,"* and it assembles a reusable skill (less motion, fewer distractions) that you approve before it saves.

**From the CLI** (developers and coding agents):

```bash
# Audit a page (JSON, for CI or an agent)
ai4a11y session audit --json

# Adapt the page for a specific person
ai4a11y session profile dyslexia
ai4a11y session enable visualAssist fontScale=150

# Describe what's on screen (for an agent that can't see it)
ai4a11y session describe

# Scaffold your own fix
ai4a11y create fix-carousels --type adapter --profiles blind,motor
```

## How It Works

Pick an ability profile. There are twelve, from Low Vision to Dyslexia to Deaf/HoH, and the page adapts as you browse.

Underneath, **auditors** scan for problems like missing alt text or low contrast, and **adapters** fix them (dark mode, bigger text, AI alt text, captions). A **skill** bundles a few adapters into a named recipe for a common case, such as a reading aid that enlarges text and strips clutter at once.

The personalized extension goes further: it remembers what you need, and its Skill Builder turns a plain-language request into a new skill. That engine lives in `toolkit/`, a standalone core meant to run beyond the browser.

![Toolkit layers](docs/diagrams/toolkit-layers.png)

The [architecture doc](docs/architecture.md) walks through the rest — the Librarian, Engineer, and Assistant agents, and how the core stays portable.

## Profiles

Twelve built-in profiles — Blind, Low Vision, Color Blind, Deaf/HoH, Motor, Dyslexia, ADHD, Cognitive, Elderly, Anxiety, Sensory, Photosensitive. Each maps to evidence-based settings (W3C WCAG/COGA, WebAIM, NNGroup) in [`tools/profiles/settings.json`](tools/profiles/settings.json). Combine them and they merge — any profile that enables a fix wins, and the largest text size wins.

## Contributing

The common contributions:

- **Fix an issue** → add an adapter in `tools/adapters/`
- **Detect an issue** → add an auditor in `tools/auditors/`
- **Combine adapters for a need** → add a skill (`SKILL.md`) in `toolkit/skills/builtin/`
- **Add a profile** → edit `tools/profiles/settings.json`

Scaffold most of it with `ai4a11y create <name> --type adapter|auditor`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and [docs/API.md](docs/API.md) for the API. The full list of interfaces and teams is in [docs/](docs/README.md).

## Roadmap

### Month 1 — Collect
- [x] Set up repo
- [x] Define architecture spec
- [x] Define agent cards
- [x] Collect agent cards from all teams

### Month 3 — Build
- [ ] Collect team codebases (in progress)
- [x] Build Chrome extension (prototype 1)
- [x] Build personalized extension (onboarding + memory)
- [x] Build CLI (prototype 2)
- [x] Implement ability profiles
- [x] Support multiple ability profiles
- [x] Build Ability Profile agent (learns your needs over time)
- [x] Prepopulate basic accessibility tools (alt text, labels, contrast, dark mode, focus mode, etc.)
- [x] Build skill layer (skills that combine adapters)
- [x] Build Skill Builder agent (turns a plain-language request into a skill)
- [x] Build a reusable core that works beyond the browser
- [x] Add automated tests
- [ ] Define design principles (in progress)
- [x] Build adaptive validation interface (people review and correct adaptations)
- [x] Add privacy and sharing controls (keep private, or share with friends/family/org)
- [ ] Build evaluation benchmark (test sites arena) (in progress)
- [ ] Integrate team projects
- [ ] Unify the two extensions on shared tools
- [x] Co-design with disability community

### Month 6 — Ship
- [ ] Write documentation (in progress)
- [ ] Create example applications (in progress)
- [ ] Test with users (in progress)
- [ ] Developer validation (hackathon)
- [ ] Native mobile app (iOS)
- [ ] XR agent — real-time adaptations in the physical world
- [ ] Security review before public release
- [ ] Publish to Chrome Web Store
- [ ] Publish CLI to PyPI
- [ ] Release publicly

## Contributors

[![Contributors](https://contrib.rocks/image?repo=AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit)](https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit/graphs/contributors)

## Security & License

Custom adapters are linted before running but have full page access — only install ones you trust. Report vulnerabilities via [SECURITY.md](SECURITY.md). Licensed under Apache 2.0 ([LICENSE](LICENSE)).

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
