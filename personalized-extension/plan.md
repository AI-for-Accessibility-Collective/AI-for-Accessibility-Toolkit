# Plan: Build the Skill Builder for the AI-for-Accessibility-Toolkit-Draft extension

## Context

The original skill-creator was for Claude Code skills — Markdown + Python + subagent grading. We are NOT publishing a new standalone extension. We are contributing one component to an existing Chrome extension being built concurrently by another team:

> **Repo**: Here
>
> The other team has built the onboarding flow (support areas → site types → free-text needs → AI recommendation → either save preferences or hand off to the Skill Builder for any needs the built-in skills can't cover).
>
> Our deliverable is the **Skill Builder**, a full-tab page that takes either (a) a list of pending skill descriptions from onboarding via `?pending=<JSON>` or (b) an `openSkillBuilder` request from the popup, and produces saved custom skills in the format the existing infrastructure expects.

Inherited constraints from the hand-off doc:
- **Entry point**: `extension/skill-builder/builder.html` — standalone HTML, no bundler
- **LLM**: Gemini, accessed via `chrome.runtime.sendMessage({ type: 'gemini', prompt })`
- **API key**: already managed (`getApiKey` message)
- **Skill artifact**: a `CustomSkill` record whose `code` field is a **plain JavaScript string executed via `new Function(code)` in content-script context** with full DOM access. No DSL, no sandboxing — the existing infra has already taken the arbitrary-code path.
- **Message API**: `gemini`, `saveCustomSkill`, `deleteCustomSkill`, `getActiveSkills`, `setActiveSkills`, `executeCustomSkill`, `getApiKey` — these are the primitives we have.
- **Audience**: people with accessibility needs across vision, cognitive, hearing, motor, sensory, reading. UI must be high-contrast, screen-reader friendly, and avoid jargon.

This wipes out most of my earlier plan: no manifest of our own, no service worker, no DSL interpreter, no Anthropic SDK, no URL-pattern wizard. What survives is the **creation UX philosophy** (chat + try it + lightweight 3-button feedback) and a few visual idioms from [assets/eval_review.html](/Users/jason/Downloads/skill-creator/assets/eval_review.html).

User-confirmed for this round: **plan only**, no code.

## Integration points with the existing repo

What we provide:
- `extension/skill-builder/builder.html`
- `extension/skill-builder/builder.js`
- `extension/skill-builder/builder.css`
- `extension/skill-builder/prompts/creator.txt` — system prompt template fed to `gemini`
- `extension/skill-builder/prompts/refine.txt` — system prompt template for code revision

What we rely on (must NOT modify; coordinate with the other team if changes are needed):
- `extension/background.js` — message handlers listed in the hand-off doc
- `extension/popup.js` — sends `openSkillBuilder` (already wired)
- The onboarding flow — opens us with `?pending=` and expects us to save skills with `saveCustomSkill`
- The active-skill manager (whatever consumes `getActiveSkills` / `setActiveSkills`) — we register saved skills as active by default unless the user opts out

What we explicitly will NOT add:
- Any chrome.* API outside the message API (no direct chrome.tabs, chrome.scripting from our page — go through `executeCustomSkill`)
- A second LLM provider — Gemini only
- New permissions in `manifest.json` — keep our footprint inside the existing manifest

## Two entry flows

### A. From onboarding — batch (`?pending=[...]`)

The onboarding flow has already gathered the user's needs and produced an array of proposed skills it couldn't match to built-ins. We walk the user through them.

1. **Parse `?pending=`** into a queue of `PendingSkill` items (`name`, `description`, `supportAreas`).
2. **Overview screen**: list all pending skills as cards with their proposed names + descriptions and a Skip / Build toggle per card. User confirms which to actually build (default: all on).
3. **For each enabled skill**, run the per-skill flow (below) sequentially. A persistent progress strip across the top says "Skill 2 of 4."
4. After the last skill, navigate to the popup or a confirmation page (whatever the existing flow expects after onboarding).

### B. From popup — single skill (`openSkillBuilder` message)

The popup sends `openSkillBuilder`; background opens our page in a new tab. There is no `?pending=`, so we start with a blank single-skill flow.

1. **Intent capture**: chat box, "What do you want this skill to help you with?" with example chips drawn from the user's saved support areas (we read these via `getActiveSkills` if the existing infra exposes them, or via a separate read of `chrome.storage` if not — coordinate with the other team).
2. Then run the per-skill flow.

## Per-skill flow (the heart of the Skill Builder)

Steps are screen-reader friendly: every interactive element has labels, focus is managed explicitly, color is never the only signal.

1. **Confirm intent** — display the proposed name + description as plain language. User can edit either inline before generation. "What I'm going to build for you: [description]. Sound right? [Yes, build it] [Change something]."
2. **Pick a target page** — required to "Try it" (we need a tab to inject into). Three options:
   - "I'm on the page right now" → opens the user's last-active non-extension tab in a side-by-side window for testing.
   - "Use this URL" → opens a new tab.
   - "Skip preview, just save" → for users who already know what they want; saves without trying.
3. **Generate code** — send Gemini a system prompt (`prompts/creator.txt`) plus user's description and (when available) a compact DOM snapshot of the target page captured by injecting a small reader function via `executeCustomSkill`. Receive raw JS code via `gemini` message. Strict-validate (parse with `new Function` in a try/catch *only for syntax checking*, never executed in our page) and reject non-string output.
4. **Try it** — send `executeCustomSkill` with `tabId` of the target tab and the generated `code`. Show a status pane: "Running on the page now…" → "Done." If the existing handler returns `{ success: false, error }`, surface the error in plain language.
5. **Tweak loop** — three buttons:
   - **Looks good** → proceed to save.
   - **Almost — change this** → small textbox: "What's still wrong?" Send to Gemini with `prompts/refine.txt` (current code + user feedback + DOM snapshot if relevant) → get revised code → re-run `executeCustomSkill`.
   - **Different idea** → discards code, returns to step 1.

   Iteration cap: 8 refinements per skill, with a clear "Start over" affordance if it stalls.
6. **Show the generated code** behind a "See what this does" disclosure — collapsed by default; expanded view shows the JS plus a Gemini-generated plain-English explanation. Important for trust; some accessibility users need to know exactly what is running.
7. **Name + save** — auto-suggested name + supportAreas (carried from `PendingSkill` or derived from the chat). Build a `CustomSkill` (id = `custom-` + slug, timestamps, code, etc.) and send `saveCustomSkill`. Then call `setActiveSkills` to add it to the active list.
8. **Confirmation** — "Saved! [Build the next one] / [Try it on another page] / [Done]."

## Generated code: shape and conventions

Since the existing infra runs `new Function(code)` in the content-script context with full DOM access, the system prompt must produce code that:

- Defines an **idempotent** modification (running it twice does not double-apply — guard with a `data-skill-applied="<id>"` attribute or similar).
- Reads `location` itself if it needs to URL-scope (no external matching).
- Wraps work in `try { … } catch (e) { console.warn('skill <name>:', e) }` so one skill never crashes the page.
- Uses `MutationObserver` for dynamic pages when appropriate, with explicit teardown on a sentinel.
- May call `chrome.runtime.sendMessage({ type: 'gemini', prompt })` at runtime when the skill needs LLM judgement (e.g. "summarize this article into bullets") — this is the equivalent of "LLM mode" from the original plan, but expressed inline in JS rather than as a separate execution mode. The system prompt instructs Gemini whether to inline a runtime LLM call or do everything statically based on the user's intent.
- Does NOT submit forms, navigate, mutate cookies/storage, or fetch arbitrary URLs (other than the `gemini` runtime call). This is a **convention enforced by the system prompt** plus a post-generation lint, not a hard sandbox — the existing infra is permissive.

## UX accessibility considerations

This audience deserves more than "non-technical user" generality:

- **Color**: WCAG AA contrast minimum on all states. The `#d97757` accent from the original `eval_review.html` is too low-contrast for primary buttons; use it as a hover/focus highlight only.
- **Typography**: minimum 16px body, scalable to 200% without layout breakage; a "Larger text" toggle in the page header.
- **Motion**: respect `prefers-reduced-motion`; no autoplay animations on success states.
- **Keyboard**: every action reachable without a mouse; visible focus rings; logical tab order.
- **Screen readers**: `aria-live="polite"` on the status pane during generation/iteration; section landmarks; explicit labels on all chat suggestion chips.
- **Cognitive load**: one decision per screen during the per-skill flow; "Where am I?" indicator always visible; an undo/back option on every step.
- **Read-aloud**: a "Read this to me" button in the disclosure pane that describes what the generated skill does (uses the Web Speech API; available in Chrome out of the box, no permission needed).

## What carries over from the original skill-creator

| From | What we take | What we drop |
|---|---|---|
| `skill-creator/SKILL.md` | "Explain the why," progressive disclosure, lean writing — distilled into `prompts/creator.txt` and `prompts/refine.txt`. | Subagent orchestration, baselines, train/test splits, `claude -p` calls, Markdown frontmatter, packaging — all out. |
| `skill-creator/assets/eval_review.html` | The visual idiom of "review a list of cases with toggle rows" — informs the **batch overview screen** for the onboarding entry. Borrow row layout and the per-row toggle pattern; raise contrast for accessibility. | Eval-set semantics, the export-to-JSON button, the file:// quirks. |
| `skill-creator/scripts/improve_description.py` | The conceptual shape of the refinement loop — current artifact + user feedback → Gemini → revised artifact. Inline this in `builder.js` as a function calling the `gemini` message. | The 1024-char description budget, the train/test holdout, the Python subprocess, the iteration-history file. |
| `skill-creator/scripts/quick_validate.py` | Pre-save schema checks (id slug, name length, code is a non-empty string). Inline as a small `validate()` function. | YAML frontmatter parsing. |
| Everything else (`agents/*`, the rest of `scripts/*`, `eval-viewer/`, `references/schemas.md`) | — | Removed. Not relevant to this deliverable. |

## File-by-file deliverables

- `extension/skill-builder/builder.html` — semantic structure: header (logo + "Larger text" toggle), main with named landmarks per phase (overview / per-skill flow / confirmation), footer with help link. No inline scripts (CSP). All step containers in one document; show/hide via `hidden` attribute.
- `extension/skill-builder/builder.js` — single module:
  - URL parser for `?pending=`
  - State machine: `overview` → `intent` → `target` → `generate` → `try` → `iterate` → `code-review` → `name-save` → `confirm`
  - Wrappers around each background message (`gemini`, `executeCustomSkill`, `saveCustomSkill`, `setActiveSkills`, `getApiKey`, `getActiveSkills`)
  - DOM-snapshot helper sent via `executeCustomSkill` to capture a pruned outline of the target tab
  - Validate + lint helpers for generated code
  - Web Speech read-aloud helper
  - Focus management on step transitions
- `extension/skill-builder/builder.css` — accessible palette + the focus-visible ring + reduced-motion rules + scalable typography. Reuse the family choices and overall warmth of the original `eval_review.html` but with tightened contrast.
- `extension/skill-builder/prompts/creator.txt` — system prompt for first-pass code generation. Specifies the conventions in §"Generated code" above, includes few-shot examples for hide / replace_text / runtime-Gemini-call.
- `extension/skill-builder/prompts/refine.txt` — system prompt for revision based on user feedback.

## Verification

Before declaring v1 done:

1. **Onboarding hand-off**: open `chrome-extension://<id>/skill-builder/builder.html?pending=%5B%7B%22name%22%3A%22Test%22%2C%22description%22%3A%22hide%20ads%22%2C%22supportAreas%22%3A%5B%22cognitive%22%5D%7D%5D` directly; confirm the overview screen renders that one item.
2. **Popup hand-off**: from the popup, click "Add Skills"; confirm `openSkillBuilder` lands us on a blank single-skill flow.
3. **Generate + try**: walk a skill through to "Try it" on a real site (e.g., make an article's font larger). Confirm `executeCustomSkill` returns success and the page changes.
4. **Save + reload**: save the skill; reload the target page; confirm the active-skill machinery re-applies it (this is owned by the other team's runtime, but we verify the round-trip via `getActiveSkills`).
5. **Iteration**: provide "almost — make the headings purple too" feedback; confirm refined code applies the requested change without losing the original behavior.
6. **Runtime LLM**: build a "summarize this article" skill; on a long article, confirm the generated code calls `chrome.runtime.sendMessage({ type: 'gemini', … })` and renders the response into the page.
7. **Accessibility audit**: run axe-core / Lighthouse against `builder.html` in each phase state; fix any AA failures. Manual: tab through the entire flow with no mouse; navigate with VoiceOver; toggle reduced-motion.
8. **Idempotency**: run a saved skill twice on the same page; confirm no duplication.
9. **Error path**: configure Gemini with a bad API key (via the existing settings); confirm we surface the `{ error }` from the `gemini` message in plain language with an "Open settings" link.
10. **Cancel / start over**: at every step, confirm Back returns to the previous state with prior input intact.

## Open items for implementation

- **Repo conventions**: I haven't read the existing repo. Before writing code, fetch `extension/background.js`, `extension/popup.js`, `skills/registry.js`, and any existing CSS to match style, naming, and any helper modules already present.
- **Where the target tab comes from**: confirm whether `executeCustomSkill` accepts an arbitrary `tabId` or implicitly uses the active tab. Affects whether we open a side window vs. inject into the user's last tab.
- **Active-skill lifecycle**: confirm whether saving a `CustomSkill` is enough or whether we must also call `setActiveSkills`. The hand-off doc implies separate calls.
- **Onboarding completion contract**: where to navigate after the last pending skill is built — back to onboarding's confirmation, the popup, or a Skill Builder "all done" page?
- **Storage observability**: whether the user has any existing custom skills with name collisions; if so, suffix the slug.

## Out of scope for v1

- Any change to the existing background service worker, popup, or onboarding flow (coordinate with the other team).
- Editing previously saved skills — read-only library; edits go through delete + recreate. (A real editor is a v2.)
- Sharing skills between users; cloud sync; an extension-level skill marketplace.
- Multi-tab orchestration; running a skill across many tabs simultaneously.
- Internationalization beyond externalizing copy strings; English UI v1.
- Hard sandboxing of generated code. The existing infra is permissive by design; we lint and convention-enforce, but a malicious skill author could still write damaging JS — out of scope to fix here.
- Firefox / Safari compatibility — Chrome MV3 only, matching the parent extension.
