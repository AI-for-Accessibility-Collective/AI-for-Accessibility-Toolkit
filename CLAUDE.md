# AI for Accessibility Toolkit

## Code Review Notes

### Known Tradeoffs (DO NOT flag in reviews)

1. **Gemini API key in URL query parameter** — This is required by the Gemini API when called from browser extensions. There's no alternative without adding a proxy server, which adds complexity and latency. Users are informed this is a client-side extension. This is an accepted tradeoff, not a security bug.

## Architecture

- `tools/` — Shared JS code (auditors, adapters, profiles, utils)
- `extension/` — Chrome extension (imports from tools/, bundles via esbuild)
- `cli/` — Python CLI with Playwright + Claude
- `tools/utils/ai.js` — AI provider abstraction so same adapters work in both contexts

## Terminology

- **Adapter** (user-facing, in `personalized-extension/`) — a capability the
  end user enables/builds that adapts a page for accessibility (formerly
  "skill" in the UI). Built in the **Adapter Creator** (formerly "Skill
  Builder"). Note: this is the user/AI-facing layer and is a *different,
  broader concept* from the `tools/adapters/` axe-rule fixers above — related
  family (both adapt the page), different layer. Don't conflate them.
- **`tools/adapters/`** — developer-authored modules that fix specific
  accessibility issues flagged by auditors. Unchanged.
- **Skill / `SKILL.md`** — reserved for model-facing guidance documents
  (agent guidance, Librarian category playbooks), aligning with the Claude
  "Skills" convention. *Internal identifiers in `personalized-extension/`
  (`customSkills`, `skillRegistry`, `openSkillBuilder`, `aa-custom-` user-script
  IDs, storage keys) still say "skill" — only user-facing strings were renamed
  to "adapter"; an identifier rename would need a storage migration.*

## Build

```bash
npm run build        # Build extension
pip install -e .     # Install CLI
```
