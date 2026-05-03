# Architecture

> Chrome extension that adapts web pages in real-time using AI.

## Core Idea

Existing accessibility tools (axe-core, Pa11y) give you a report. This toolkit *adapts* the page — AI analyzes what's on the page, understands what the user needs, and fixes it live. Not a report. A working page.

Teams across the collective contribute capabilities: accessible simulations, atypical speech recognition, memory aids, art descriptions. The extension provides shared infrastructure that these projects can plug into.

## Principles

- **Adapt, don't just audit** — fix issues in real-time, not just report them
- **Ability-based design** — adapt to what users can do, not what they can't
- **Human in the loop** — people with disabilities involved in design and evaluation
- **Build on existing tools** — axe-core for detection, Gemini for AI, darkreader for dark mode
- **Easy to extend** — add new auditors/adapters with `ai4a11y create`

## How It Works

```mermaid
flowchart TD
    subgraph Tools[Tools Library]
        direction LR
        T1[Accessible<br/>Simulations]
        T2[Non-Standard<br/>Speech]
        T3[Memory<br/>Assistant]
        T4[Storytelling]
        T5[Tutoring<br/>Agent]
        T6[Cognitive<br/>A11y]
        T7[Meeting<br/>Agent]
        T8[...]
    end

    subgraph Agents[Shared Agent Services]
        O[Orchestrator]
        U[User Agent]
        App[App Agent]
        Adapt[Adapt Agent]
    end

    Corpus[(Collective Corpus<br/>guidelines, benchmarks,<br/>personas, patterns)]
    
    Web[Web App / Content]

    Tools <--> O
    Corpus -.-> O
    O <--> U
    O <--> App
    O <--> Adapt
    App <--> Web
    Adapt <--> Web
```

### Agent Services

| Agent | Role |
|-------|------|
| **Orchestrator** | AI plans which tools to activate based on page content + user profile |
| **User Agent** | Preferences, ability profiles, interaction history |
| **App Agent** | Parses web app UI, semantic analysis, accessibility APIs |
| **Adapt Agent** | Generates adaptations, runs modality transforms, resolves conflicts |

### Chrome Extension Implementation

The extension implements this architecture for web browsers:

```mermaid
flowchart LR
    subgraph Extension[Chrome Extension]
        direction TB
        subgraph Content[Content Script]
            Auditors[Auditors<br/>axe-core, custom]
            Adapters[Adapters<br/>generate-alt, fix-contrast,<br/>dark-mode, dyslexia-font]
        end
        BG[Background Worker]
    end
    
    Storage[(chrome.storage)]
    Gemini[Gemini API]
    Libs[/libs: axe-core,<br/>darkreader, readability/]
    
    Libs --> Auditors
    Auditors --> Adapters
    Storage <--> Content
    Adapters <--> BG <--> Gemini
```

**Flow:**
1. Page loads → extension runs
2. **Auditors** scan for issues (axe-core + custom detectors)
3. **Adapters** fix issues (immediate DOM changes or via AI) and apply visual presets
4. **Background** handles AI API calls (Gemini for descriptions, simplification)

## Profiles

Users select a profile that auto-enables the right tools:

| Profile | What it enables |
|---------|-----------------|
| `blind` | Auto alt text, labels, WCAG fixes, keyboard nav |
| `lowVision` | Large text (150%), enhanced focus, high contrast |
| `colorBlind` | Color filters, enhanced contrast |
| `deaf` | Auto captions, visual emphasis |
| `motor` | Large cursor, keyboard nav, voice commands |
| `dyslexia` | OpenDyslexic font, wider spacing, focus mode |
| `adhd` | Focus mode, reduced motion, reader mode |
| `cognitive` | Simplified text, summaries |
| `elderly` | Large text, enhanced focus, simplified text |
| `anxiety` | Calm UI, reduced motion, reader mode |
| `sensory` | Reduced motion, dark mode, focus mode |
| `photosensitive` | Dark mode, reduced motion |

Profiles are defined in `tools/profiles/settings.json`. Users can also toggle individual tools.

## Directory Structure

```
AI-for-Accessibility-Toolkit/
├── tools/                       # Shared JS code (browser-native)
│   ├── auditors/               # Find issues
│   │   ├── missing-alt.js
│   │   ├── missing-labels.js
│   │   ├── missing-captions.js
│   │   ├── poor-contrast.js
│   │   ├── wcag-issues.js      # axe-core wrapper
│   │   └── index.js
│   ├── adapters/               # Fix issues + visual presets
│   │   ├── generate-alt.js     # AI image descriptions
│   │   ├── generate-labels.js  # AI form labels
│   │   ├── generate-captions.js # AI audio/video captions
│   │   ├── fix-contrast.js
│   │   ├── simplify-text.js    # AI text simplification
│   │   ├── wcag-fixes.js       # Generic WCAG violation fixes
│   │   ├── visual-assist.js    # fonts, spacing, cursor, focus
│   │   ├── dark-mode.js        # DarkReader + CSS fallback
│   │   ├── motion-reducer.js   # animations, GIFs, parallax
│   │   ├── color-blind.js      # color correction filters
│   │   ├── focus-mode.js       # distraction hiding, progress
│   │   ├── reader-mode.js      # Readability-based reading view
│   │   ├── read-aloud.js       # text-to-speech
│   │   ├── voice-commands.js   # voice navigation
│   │   ├── keyboard-nav.js     # skip links, tab sequence
│   │   ├── auto-transcriber.js # video/audio captions
│   │   └── index.js
│   ├── profiles/               # User presets
│   │   ├── settings.js
│   │   └── settings.json
│   └── utils/                  # Shared utilities (ai.js, dom.js, color.js)
│
├── extension/                   # Chrome extension
│   ├── src/content.js          # Entry point (imports from tools/)
│   ├── background.js           # Service worker (Gemini API)
│   ├── popup.html / popup.js   # Extension UI
│   ├── lib/                    # Vendor libraries (axe, darkreader, etc.)
│   └── manifest.json
│
├── cli/                         # Python CLI
│   ├── ai4a11y.py              # Playwright + Claude vision
│   └── cli.py                  # Command wrapper
│
└── pyproject.toml               # pip install ai4a11y
```

## Adding Capabilities

```bash
# Install CLI (one-time)
pip install -e .

# Scaffold new components
ai4a11y create missing-landmarks --type auditor
ai4a11y create fix-tables --type adapter

# Build extension
npm run build
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

## Multi-Team Collaboration

Teams across the collective contribute specialized capabilities. See [projects.md](projects.md) for detailed cards.

| Project | Team | What it does | Status |
|---------|------|--------------|--------|
| **NAI** | Google | Multimodal AI agents that adapt UIs in real-time | Demo |
| **Accessible Interactive Simulations** | Stanford | Sonification of STEM content for BLV learners | Prototype |
| **Universal Memory Assistant** | MIT Media Lab | Wearable memory assistant for older adults | TBD |
| **AI-Augmented Storytelling** | UW | Creative expression tools for BLV children | TBD |
| **Non-Standard Speech** | UCL GDI Hub | Whisper fine-tunes for atypical speech (13 models) | Published |
| **Founders Think** | UCL GDI Hub | AI tool for disability-innovation founders | TBD |
| **Videoconferencing Agent** | RNID | Real-time accessibility nudges in video calls | Zoom app |
| **AI-Powered Tutoring Agent** | NTID | English grammar tutor for DHH students | TBD |
| **AI for Cognitive Accessibility** | The Arc | Text simplification for IDD users | TBD |

### How projects plug in

Projects contribute as extension components or inform their design:

| Contribution type | Example |
|-------------------|---------|
| **Auditor** | Stanford: detect inaccessible simulations |
| **Adapter** | The Arc: simplify text for cognitive accessibility |
| **Adapter** | MIT: user context/memory tracking |
| **ASR integration** | UCL: non-standard speech recognition |
| **Patterns** | Google NAI: orchestration architecture |
| **Validation** | The Arc: PWD reviewer network |

## Build On, Don't Rebuild

| Need | Use |
|------|-----|
| WCAG detection | [axe-core](https://github.com/dequelabs/axe-core) |
| Dark mode | [darkreader](https://github.com/nicoth-in/darkreader) |
| AI descriptions | [Gemini API](https://ai.google.dev/) |
| Dyslexia font | [OpenDyslexic](https://opendyslexic.org/) |
| Focus management | [focus-trap](https://github.com/focus-trap/focus-trap) |
| Readability | [Mozilla Readability](https://github.com/nicoth-in/readability) |
