# AI for Accessibility Toolkit

## Code Review Notes

### Known Tradeoffs (DO NOT flag in reviews)

1. **Gemini API key in URL query parameter** — This is required by the Gemini API when called from browser extensions. There's no alternative without adding a proxy server, which adds complexity and latency. Users are informed this is a client-side extension. This is an accepted tradeoff, not a security bug.

2. **Acting-user partition: job anchoring (RESOLVED in Phase 3 inc 3)** (`toolkit/core/`) — The datastore's `partitionKey` isolation is total. The earlier gap — background jobs running against whatever partition was active at *fire*-time — is now closed: the debounced `extract` is anchored to the partition that enqueued it (skips on switch, the periodic net drains it later); `extract`/`reflect`/`requestGrant`/`importInsight`/`respondToProposal`/`recordScopedSettings` hold a slow-lane drain gate so `setActingUser` waits for in-flight writes; the cross-app entry points also capture+verify the partition. Migrations no longer mutate the shared `_actingUserId` (they run against an explicit partition-bound view), and a **migrate-on-activation** sweep keeps a named partition current. Two **accepted residual limitations** (prototype-scoped, first-party/mistakes-not-malice): (a) `setActingUser`'s drain wait has no timeout, so a hung LLM call in an in-flight `extract` can delay a partition switch — a host should give its LLM fetch an `AbortSignal` timeout; (b) cross-app insight proposals share the user's single weekly proposal budget with no per-source sub-cap, so a buggy granted app spamming distinct insight `kind`s could crowd out the user's own device-learned proposals for the week.

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
