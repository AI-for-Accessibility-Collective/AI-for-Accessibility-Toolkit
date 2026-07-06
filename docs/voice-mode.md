# Voice Mode — Full Toolkit Control via Gemini Live

The extension's voice mode (side panel + offscreen document) is a hands-free
control surface for the whole toolkit. It streams microphone audio to the
Gemini Live API over a raw WebSocket and acts through **function calls** that
route back through the extension's existing, consent-guarded machinery. This
phase graduates it from "explain mode" (narrate the browser agent) to full
control: settings, page Q&A, browser tasks, capability suggestions, and the
memory layer.

## Architecture

```
Side panel UI  ←(voiceState via storage)←  Offscreen doc                     Service worker
 - transcript + captions                    - Live WS client (client.js)      - voice-routes.js (5 data routes)
 - action chips + Undo button               - tools.js: 12 declarations,      - librarian* routes (memory)
 - type-instead-of-speak input                dispatch, undo stack,           - bhAgent* routes (browser agent)
 - pending-suggestions pill                   seen-id consent gates           - chrome.tabs / scripting / zoom
                                            - prompt.js: builder + vocabulary
```

The offscreen document has no `chrome.tabs`/`chrome.scripting` access, so every
tool is a `chrome.runtime.sendMessage` to the SW. The permission semantics live
in the Librarian and are not bypassed — the voice surface only calls the same
routes the popup uses.

## Tool surface (offscreen/src/live/tools.js)

| Tool | What it does |
|---|---|
| `get_context` | Tab title/origin, page zoom, non-default settings (+ site-scoped keys), memoryPaused |
| `adjust_settings` | Batched settings + virtual `pageZoom`; persists (popup semantics: provenance-scoped or one `sync.set`) **and** live-applies; pushes previous values for undo |
| `undo_last_change` | Pops the session undo stack and replays previous values (LIFO) |
| `get_page_content` | Reads the active tab via `chrome.scripting` — outline or 4000-char text chunks |
| `start_browser_task` / `get_browser_status` / `stop_browser_task` | Browser agent (`use_current_tab` → `tabMode:'current'`) |
| `suggest_capabilities` | `Librarian.interpretNeedsPrompt` + Gemini → compact suggestion the model reads aloud |
| `get_memory` | Profile + memories (≤12, with ids) + pending proposals (≤5); ids feed the seen-sets |
| `remember` | `logObservation({type:'voice', weight:3})` — distilled by extraction; respects memoryPaused |
| `forget_memory` / `respond_to_proposal` | Gated: the id must have been returned by `get_memory` this session, and the prompt requires read-aloud + explicit verbal yes |

The `adjust_settings` schema and the prompt's capability vocabulary are both
**generated from `skills/registry.js` `settingsMeta`** — one source of truth
with the popup.

## Consent model

- **Immediate-apply** (a spoken request = explicit local user intent, same as
  tapping the popup): `adjust_settings`, `undo_last_change`, `remember`.
  Contract: the model narrates the change and mentions undo; the panel shows an
  action chip with an Undo button on the newest undoable change.
- **Confirm class**: `forget_memory`, `respond_to_proposal` — prompt-enforced
  read-back + explicit yes, plus the mechanical seen-id gate (a hallucinated id
  cannot delete anything).
- Librarian invariants (weekly proposal budget, suppressions, cooldowns,
  memoryPaused, sharingPaused) apply unchanged — voice calls existing routes.

## Session grounding

At connect, `index.js` fetches `voiceGetContext` + `voiceGetMemory` (1.5s
timeout each, sections dropped on failure) and composes them into the system
instruction via `buildSystemInstruction()` — the model starts knowing the
current tab, non-default settings, a two-line profile summary, and the pending
proposal count, and is instructed to trust tool results over that snapshot.

## Panel affordances (non-technical audience)

- **Action chips**: every state-changing tool call renders "✓ Text size: 150%".
- **Undo button** on the newest undoable chip while connected (the undo stack
  lives in the offscreen page); pressing it also injects a `[UI update]` turn
  so the model knows.
- **Type instead of speaking**: a text input that submits `voiceTextTurn` into
  the same conversation — for speech-impaired users, noisy rooms, and
  deterministic tests.
- **Pending-suggestions pill**: click → asks the agent "What suggestions are
  waiting for me?" (visual consent cards stay in the popup).

## Testing

- `node test/voice-tools-test.mjs` — 70 unit checks (mocked chrome): dispatch
  mapping, clamping, provenance-scoped persistence, the full-merge
  VisualAssist guard, undo LIFO, seen-id gates, prompt builder.
- `node test/run-tests.js` — static wiring checks (tool names ⟷ prompt ⟷
  routes ⟷ panel).
- `node test/voice-e2e.js` — real Chrome, **no API key**: drives tools through
  `voiceDebugToolCall` (offscreen → SW → storage → content script), asserts the
  page actually changes, undo reverts, chips land.
- `node test/voice-e2e.js --live` (with `GEMINI_API_KEY`) — opens a real Live
  session with fake-device mic, drives it over the typed path, and checks the
  model performs `adjust_settings`. Model-behavior assertions degrade to WARN.

## Adversarial review

A three-lens Fable review (consent/safety, correctness, MV3 lifecycle) with
per-finding verification ran against the tool surface. It confirmed 21 issues;
the fixed ones:

- **Undo scope/tab corruption (mustFix)**: undo re-resolved each setting's
  scope against whatever tab was active at undo time, so a cross-tab undo
  clobbered the global baseline instead of reverting the real record. Fixed by
  capturing a precise per-key restore plan (`{writes:[{key,value,scope}],
  pageZoom:{value,tabId}}`) at change time and replaying it to the exact
  scopes/tab — no re-resolution.
- **Undo consumed the entry before the revert landed**: now peeks and only pops
  on success.
- **Scope silently coerced to global**: `origin:YouTube.com` (or a category not
  in the taxonomy) was accepted by voice but coerced to a global change by the
  Librarian. Now validated/lowercased and rejected up front.
- **Out-of-scope live preview**: an explicitly scoped change re-styled the
  current tab even when it didn't match the scope. Now gated by
  `scopeMatchesTab`.
- **Cross-app grant via voice**: grant/insight proposals are excluded from the
  voice listing and resolution — they belong on the popup's visual consent
  cards.
- **Prompt injection**: page content and the page title are labeled untrusted
  and the prompt forbids treating them as instructions; the title is stripped
  of control characters before it can reach the system instruction.
- **Concurrent connect / goAway reconnect race**: an in-flight `connecting`
  guard + cancellable goAway timer prevent two billed Live sessions.
- Also: `forget_memory` chip now names the deleted memory; partial-save still
  records an undo entry; `get_browser_status` uses the storage shim; the panel
  Undo button has a double-activation guard; autoscroll only when at bottom.

## Accepted limitations (prototype-scoped)

- **Undo of a newly-created scoped record can't truly delete it** — the
  Librarian has no delete-record primitive, so undo writes the prior value back
  into the correct scope rather than removing the record. It reverts the right
  place (the cross-scope corruption is fixed); a set+undo of a
  previously-unset key is not a perfect no-op.
- `storage.sync` write quota (120/min): writes are batched per tool call;
  quota errors surface as tool errors. A pathologically chatty model is an
  accepted residual.
- A tool cancelled (`toolCallCancellation`) or timed out (30s) after its write
  landed: the write commits; the undo entry is still recorded from the
  route's returned `previous`. A true SW crash mid-write (no response) can't be
  reconstructed client-side — accepted residual.
- The undo stack dies with the offscreen page; the panel hides the Undo button
  when not connected, and a fresh (no-handle) connect resets the session gates.
- `start_browser_task`/`remember`/`adjust_settings` remain immediate (no
  mechanical confirm dialog); page text is defended by the untrusted-data
  framing + the narrate+undo contract, not a gate. First-party threat model.
