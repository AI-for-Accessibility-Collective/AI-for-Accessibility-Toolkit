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

[axe-core](https://github.com/dequelabs/axe-core) and [Pa11y](https://github.com/pa11y/pa11y) find accessibility problems and hand you a report. This one fixes them instead, live in the browser and tuned to the person reading the page.

It's a Chrome extension, a developer CLI, and a small platform-agnostic core other apps can build on.

## Quick Start

### Chrome extension — no code

It isn't on the Chrome Web Store yet, so build it once from source:

```bash
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit
npm install && npm run build
```

Then load it and try it:

1. Open `chrome://extensions` and turn on **Developer mode** (top-right).
2. Click **Load unpacked** and choose the `extension/` folder.
3. Open the [test site](https://ai4a11y-test-site.vercel.app/), click the toolbar icon, pick a profile, and watch the page change.

Most adapters — bigger text, dark mode, wider spacing, a single-column reading view, dismissing popups, keeping focus visible — work right away with **no key**. The AI features (writing alt text, captions, plain-language summaries, translation) need a free [Gemini key](https://aistudio.google.com/apikey); paste it into the popup once.

### Command line — for developers and agents

```bash
pip install -e . && playwright install chromium

ai4a11y session start                    # open a browser
ai4a11y session go https://example.com
ai4a11y session audit                    # list what's inaccessible
```

`audit` runs [axe-core](https://github.com/dequelabs/axe-core) and needs no key. The AI commands (`describe`, `simplify`) use Claude — run `export ANTHROPIC_API_KEY=sk-...` first. Add `--json` to any command for output you can pipe into scripts, CI, or an agent.

## Examples

### In the extension

Open the [test site](https://ai4a11y-test-site.vercel.app/) and try these — the first three need no key:

- **Dyslexia** → text grows, line and letter spacing open up, and side clutter dims on a long article.
- **Low Vision** → 150% text, a bold focus ring that follows your keyboard, and a magnifier that tracks the cursor.
- **Motor** → bigger click targets, sticky bars unpinned, and a "click again to confirm" guard on Delete / Submit buttons.
- **Blind** *(needs a Gemini key)* → missing alt text and video captions get written for you; press **Alt+D** on any element to hear what it is.
- **Skill Builder** → type *"make Reddit calmer to read"* and it assembles a reusable recipe (less motion, fewer popups) you approve before it saves.

### From the command line

```bash
# 1. What's inaccessible on a page? (JSON pipes straight into CI or an agent)
ai4a11y session start
ai4a11y session go https://news.ycombinator.com
ai4a11y session audit --json

# 2. Adapt the page for someone, then read it back in plain language
ai4a11y session profile dyslexia
ai4a11y session enable visualAssist fontScale=150
ai4a11y session describe

# 3. Scaffold a new fix, pre-wired to the profiles it serves
ai4a11y create fix-carousels --type adapter --profiles blind,motor
```

## How It Works

Pick an ability profile. There are twelve, from Low Vision to Dyslexia to Deaf/HoH, and the page adapts as you browse.

Underneath, **auditors** scan for problems like missing alt text or low contrast, and **adapters** fix them (dark mode, bigger text, AI alt text, captions). A **skill** bundles a few adapters into a named recipe for a common case, such as a reading aid that enlarges text and strips clutter at once.

The personalized extension goes further: it remembers what you need, and its Skill Builder turns a plain-language request into a new skill. That engine lives in `toolkit/`, a standalone core meant to run beyond the browser.

<p align="center">
  <img src="docs/diagrams/toolkit-layers.png" alt="Toolkit layers: every interface runs on the same core" width="440">
</p>

The [architecture doc](docs/architecture.md) walks through the rest — the Librarian, Engineer, and Assistant agents, and how the core stays portable.

## Profiles

Twelve built-in profiles — Blind, Low Vision, Color Blind, Deaf/HoH, Motor, Dyslexia, ADHD, Cognitive, Older Adult, Anxiety, Sensory, Light Sensitive. Each maps to evidence-based settings (W3C WCAG/COGA, WebAIM, NNGroup) in [`tools/profiles/settings.json`](tools/profiles/settings.json). Combine them and they merge — any profile that enables a fix wins, and the largest text size wins.

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
