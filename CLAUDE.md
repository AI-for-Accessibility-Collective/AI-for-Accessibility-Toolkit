# AI for Accessibility Toolkit

## Code Review Notes

### Known Tradeoffs (DO NOT flag in reviews)

1. **Gemini API key in URL query parameter** — This is required by the Gemini API when called from browser extensions. There's no alternative without adding a proxy server, which adds complexity and latency. Users are informed this is a client-side extension. This is an accepted tradeoff, not a security bug.

## Architecture

- `tools/` — Shared JS code (auditors, adapters, profiles, utils)
- `extension/` — Chrome extension (imports from tools/, bundles via esbuild)
- `toolkit/` — Platform-agnostic core (Librarian, datastore, skill layer)
- `cli/` — Python CLI with Playwright + Claude
- `tools/utils/ai.js` — AI provider abstraction so same adapters work in both contexts

## Terminology

- **Adapter** — the executable code that adapts a page. Developer-authored
  ones live in `tools/adapters/`; users generate their own in the **Adapter
  Builder** (`personalized-extension/extension/adapter-builder/`), which
  writes real JS run as a user-script. Build one only for a capability no
  adapter has yet.
- **Skill / `SKILL.md`** — a model-facing playbook that composes existing
  adapters into a recipe for a need. Built in the **Skill Builder**
  (`personalized-extension/extension/skill-builder/`) by the Engineer, or
  hand-written in `toolkit/skills/builtin/`. No code. This is the common
  case, and where onboarding sends the needs it couldn't cover — the Skill
  Builder hands off to the Adapter Builder only when composition fails.
- **Auditor** — code in `tools/auditors/` that finds issues for adapters to
  fix.
- *Internal identifiers in `personalized-extension/` (`customSkills`,
  `skillRegistry`, `openSkillBuilder` → the Adapter Builder,
  `openSkillManager` → the Skill Builder, `aa-custom-` user-script IDs,
  storage keys) still say "skill" from an earlier naming — renaming them
  needs a storage migration.*

## Build

```bash
npm run build        # Build extension
pip install -e .     # Install CLI
```
