# Contributing

Most contributions add a new auditor, adapter, skill, or profile.

## Set up

```bash
git clone https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git
cd AI-for-Accessibility-Toolkit && npm install && pip install -e .

ai4a11y create my-adapter --type adapter   # scaffold
npm run build                               # build
# Chrome: chrome://extensions → Load unpacked → extension/
```

## Skill or adapter — which am I building?

This is the first decision, and you usually build **one, not both**:

- **Adapter** = executable **code** that performs one page adaptation (the "hands"). Build a new adapter only when you need a **brand-new capability** no existing adapter provides (e.g. "collapse comment threads deeper than 2 levels"). Lives in `tools/adapters/`.
- **Skill** = a `SKILL.md` **recipe** that composes existing adapters for a need (the "brain"). Build a skill when you want a **reusable combination/tuning** of things that already exist (e.g. "calm, readable news" = `visual-assist` + `focus-mode`). No code. Lives in `toolkit/skills/builtin/`.

Rule of thumb: **need a new primitive → adapter (code); need a new recipe → skill (no code).** A skill can only reference adapters that already exist, so if your recipe needs something missing, build that adapter first, then compose it in a skill.

## Cheat Sheet

| I want to... | Do this |
|--------------|---------|
| **Find an issue** | Add auditor → `tools/auditors/` → export from `index.js` |
| **Fix an issue** | Add adapter → `tools/adapters/` → add to `axeHandlers` in `index.js` |
| **Combine adapters for a need** | Add skill → `toolkit/skills/builtin/<name>.md` (see [Adding a Skill](#adding-a-skill)) |
| **Add a profile** | Edit `tools/profiles/settings.json` |
| **Add AI feature** | `tools/utils/ai.js` + `extension/background.js` + `cli/ai4a11y.py` |
| **Test changes** | `npm run build` → load in Chrome → test on real sites |

## Adding an Auditor

Auditors find accessibility issues. Use **axe-core** for standard WCAG; custom auditors for issues axe misses.

```bash
ai4a11y create missing-headings --type auditor
```

```js
// tools/auditors/missing-headings.js
import { isVisible, wasProcessed } from '../utils/dom.js';

export function findSectionsWithoutHeadings() {
  return Array.from(document.querySelectorAll('section, article'))
    .filter(el => !wasProcessed(el) && isVisible(el) && !el.querySelector('h1,h2,h3,h4,h5,h6'));
}
```

Then add to `tools/auditors/index.js`: `export * from './missing-headings.js';`

## Adding an Adapter

Adapters fix issues. They can handle specific [axe rule IDs](https://dequeuniversity.com/rules/axe/).

```bash
ai4a11y create fix-carousels --type adapter --profiles blind,motor
```

```js
// tools/adapters/fix-carousels.js
import { markProcessed } from '../utils/dom.js';

export const name = 'fix-carousels';
export const profiles = ['blind', 'motor'];

export function fixCarouselControls(carousel) {
  if (carousel.dataset.ai4a11yProcessed) return;
  markProcessed(carousel, 'pending');
  // ... fix logic ...
  markProcessed(carousel, 'done');
}

export const axeHandlers = { 'aria-required-attr': fixCarouselControls };
```

Then in `tools/adapters/index.js`, add the export and spread its handlers:

```js
export * from './fix-carousels.js';
import { axeHandlers as carouselHandlers } from './fix-carousels.js';
// In the axeHandlers export, add: ...carouselHandlers,
```

For a real end-to-end example, read `tools/adapters/fix-tables.js` (heuristic + AI fallback) or `tools/adapters/fix-landmarks.js` (deterministic, with axe handler).

## Adding a Profile

Edit `tools/profiles/settings.json`:

```json
"myProfile": {
  "name": "My Profile",
  "description": "What it does",
  "tools": { "fontScale": 130, "darkMode": true, "autoSimplify": true }
}
```

**Available tools:** `fontScale`, `lineHeight`, `letterSpacing`, `largeCursor`, `enhanceFocus`, `readingGuide`, `dyslexiaFont`, `darkMode`, `motionReducer`, `colorFilter`, `contrastMode`, `fixContrast`, `autoWcagFix`, `autoDescribe`, `autoVideoDescribe`, `autoFixLabels`, `autoSimplify`, `autoSummarize`, `autoCaptions`, `focusMode`, `hideDistractions`, `showProgress`, `readerMode`, `keyboardNav`, `voiceCommands`

## Adding a Skill

A skill composes existing adapters into a reusable recipe for a need — **no code**. Add a `SKILL.md` file in `toolkit/skills/builtin/`:

```markdown
---
name: quiet-reading
description: Distraction-free, high-contrast reading. Use on articles and docs for focus-sensitive readers.
supportAreas: [cognitive, reading, sensory]
siteRelevance: [news, education, reference]
---

# Quiet Reading
Strips clutter and boosts contrast so text is easy to focus on.

## What it does
1. **reader-mode** — extracts the article into a clean view.
2. **focus-mode** — hides ads and side content.

## Recipe
```json
{
  "adapters": [
    { "id": "reader-mode", "settings": { "readerMode": true } },
    { "id": "focus-mode", "settings": { "focusMode": true, "hideDistractions": true } }
  ]
}
```
```

Rules:
- The `Recipe` JSON is the runnable truth. Reference only **adapter ids that exist** (`ai4a11y list tools`) and **setting keys** from the profile list above — `validateSkill` rejects unknown ones.
- Keep it minimal: 1–4 adapters that directly serve the need. Make the prose match the recipe.
- `npm run build` regenerates the extension's built-in `AA_SKILLS`. Verify with `node toolkit/test/skill-test.js`.

Users can also build skills without editing files — the **Skill Builder** in the personalized extension does this from a plain-language description via the Engineer.

## Adding an AI Tool

AI tools need implementations in three places:

1. **`tools/utils/ai.js`** — provider-agnostic interface
2. **`extension/background.js`** — Gemini handler (add to `handlers` object)
3. **`cli/ai4a11y.py`** — Claude handler (via `page.expose_function`)

## Testing

```bash
npm run build                                   # Build extension
ai4a11y session start                           # Launch test browser
ai4a11y session go https://example.com
ai4a11y session audit                           # Run accessibility audit
ai4a11y session describe                        # AI describes the page
ai4a11y session stop
```

Load extension in Chrome and test on real sites.

## PR Guidelines

- One feature per PR
- Test on real sites
- `npm run build` must pass
- Describe who benefits (which disability/profile)

## Code Style

- ES modules in `tools/`, bundled by esbuild
- Use the AI provider abstraction (`tools/utils/ai.js`) for AI features
- Document which profiles/disabilities the feature helps
- No large binaries — use Git LFS or link externally

## Ethics

- People with disabilities must be involved in design and evaluation
- Compensate participants
- Handle user profiles and personalization data carefully
- Don't simulate ability profiles without community input

## Questions?

Open an issue or ping [@chuanenlin](https://github.com/chuanenlin) (David).
