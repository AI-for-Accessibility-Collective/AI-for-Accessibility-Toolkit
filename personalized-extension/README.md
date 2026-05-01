# Agentic A11y

AI-powered accessibility Chrome extension with dynamic skill recommendations and custom skill building.

Instead of mapping disability profiles to fixed tool sets, this extension uses an AI-powered onboarding flow: users describe their needs (high-level support areas, site types, free text), and Gemini suggests which built-in skills to enable — and identifies gaps where new custom skills can be built.

## Install

```bash
git clone <repo-url>
cd agentic-a11y
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select the `extension/` folder.

## Gemini API Key

The extension uses Google's Gemini API for skill recommendations and AI-powered features (alt text, text simplification). Get a key from [Google AI Studio](https://aistudio.google.com/apikey) — the free tier allows 15 requests/minute.

Enter the key during onboarding or in the popup Settings section.

## How It Works

1. **Onboarding** — On first install, a full-tab onboarding flow walks through:
   - Support areas (Vision, Cognitive, Hearing, Motor, Sensory, Reading)
   - Site types (News, Shopping, Video, Social, Education, Games)
   - Free-text description of additional needs
   - Gemini API key setup
   - AI-generated skill recommendations

2. **Popup** — Quick access to toggle active skills, open the skill builder, or re-run onboarding.

3. **Content Script** — On every page load, active skills are applied automatically.

4. **Skill Builder** — Create custom AI-generated skills for needs not covered by built-in skills (see `extension/skill-builder/HANDOFF.md`).

## Built-in Skills

| Skill | Description | Support Areas |
|-------|-------------|---------------|
| Auto Alt Text | AI-generated image descriptions | Vision |
| Fix Contrast | Fixes poor color contrast (WCAG AA) | Vision |
| Simplify Text | AI rewrites complex text to simpler reading level | Cognitive, Reading |
| Dark Mode | Inverts page to dark theme | Vision, Sensory |
| Focus Mode | Dims distractions, highlights current paragraph | Cognitive, Reading, Sensory |
| Reader Mode | Clean distraction-free article view | Cognitive, Reading, Sensory |
| Reduce Motion | Stops animations, GIFs, auto-playing videos | Sensory, Cognitive, Vision |
| Large Cursor | Larger, more visible mouse cursor | Vision, Motor |
| Dyslexia Font | OpenDyslexic font with wider spacing | Reading, Cognitive |
| Keyboard Nav | Skip links, focus indicators, shortcuts | Motor, Vision |
| Auto Captions | Caption controls for media | Hearing |
| Voice Commands | Hands-free browsing via voice | Motor |
| Color Filter | Color correction for color vision deficiencies | Vision |
| Visual Assist | Adjustable font size, line height, spacing | Vision, Reading |

## Project Structure

```
agentic-a11y/
├── extension/
│   ├── manifest.json
│   ├── background.js           # Service worker: Gemini API, storage, skill injection
│   ├── onboarding/             # Full-tab onboarding flow
│   ├── skill-builder/          # Skill builder (stub + handoff doc)
│   ├── popup/                  # Extension popup
│   ├── content/                # Content script (bundled by esbuild)
│   └── icons/
├── skills/
│   ├── registry.js             # Skill catalog with metadata for AI recommender
│   └── builtin/                # 14 built-in skill modules
├── utils/
│   ├── ai.js                   # Gemini provider abstraction
│   ├── dom.js                  # DOM utilities
│   └── recommender.js          # AI-powered skill recommendation
├── build.js                    # esbuild config
└── package.json
```

## Development

```bash
npm run watch    # Rebuild on changes
npm run build    # One-time build
```

After building, reload the extension in `chrome://extensions` to pick up changes.
