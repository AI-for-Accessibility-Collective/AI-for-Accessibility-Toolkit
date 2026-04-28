# AI for Accessibility Toolkit

## Code Review Notes

### Known Tradeoffs (DO NOT flag in reviews)

1. **Gemini API key in URL query parameter** — This is required by the Gemini API when called from browser extensions. There's no alternative without adding a proxy server, which adds complexity and latency. Users are informed this is a client-side extension. This is an accepted tradeoff, not a security bug.

## Architecture

- `tools/` — Shared JS code (auditors, adapters, profiles, utils)
- `extension/` — Chrome extension (imports from tools/, bundles via esbuild)
- `cli/` — Python CLI with Playwright + Claude
- `tools/utils/ai.js` — AI provider abstraction so same adapters work in both contexts

## Build

```bash
npm run build        # Build extension
pip install -e .     # Install CLI
```
