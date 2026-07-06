# Phase 4 — ArtInsight as the toolkit's second consumer

Phase 4 proves the refactor's central claim: a *second, native* app can read
the same understanding of the user and contribute back to it, **without a
rewrite of the consolidation engine** and without ever re‑interviewing the user.
The target is **ArtInsight** (`/Users/jason/Downloads/ArtInsight-main`, an
iOS/SwiftUI app that describes art for blind / low‑vision users via an OpenAI
Assistant). It was chosen per plan §7/§Phase 4: LLM calls are centralized, it
has **no** existing profile layer (clean slate), and its highest‑value hook is
prompt‑context injection.

This is a **conformer**, not an embed: ArtInsight does not run the JS engine. It
implements the toolkit *spec* — the same blob schema, the same
AbilityModel shape, and the same **consent contract** (read = a user‑granted
scope; write = a proposal, never silent) — in native Swift. That is exactly the
"thin native conformers speak the same schema/protocol" strategy from plan §7.

## What was added (all additive)

New Swift group `Mixed-Ability-Artwork/…/Toolkit/`:

| File | Role |
|---|---|
| `ToolkitProfile.swift` | Codable mirror of the toolkit blob + AbilityModel (`toolkit/sync/blob.js`, `toolkit/core/ability.js`), and the **pure projection** `ArtInsightSurface.derive(from:)` — neutral needs → ArtInsight's own surface (verbosity / reading level / language). |
| `ToolkitStore.swift` | Persistence (`UserDefaults`) + the two flows: holds the imported profile and exposes `promptContext`; records interaction observations and turns durable ones into an **insight outbox**. |
| `ToolkitSettingsView.swift` | The user‑mediated transport UI: `.fileImporter` to load the profile the user exported from the web extension, `.fileExporter` to send the outbox back. |

One integration edit, clearly marked, in `Services/Open AI/OpenAI+Request.swift`
(both `describe` builders):

```swift
let toolkitContext = ToolkitStore.shared.promptContext
let userMessage = "Describe the image below, …"
    + (toolkitContext.isEmpty ? "" : "\n\n" + toolkitContext)
```

`promptContext` is empty until the user imports a profile, so **behavior is
unchanged** for anyone who never opts in.

To finish the loop on the toolkit side, the web extension gained
`Librarian.importInsightOutbox(outbox)` (+ the `librarianImportInsightOutbox`
route and an outbox branch in the popup's import handler): a user‑carried
outbox is drained through the **same** grant‑gated, never‑silent `importInsight`
per entry — the outbox is transport, it grants nothing.

## The two flows

### READ — the understanding, no re‑interview
1. On the web extension the user approves a grant for `artinsight`
   (`ability.categories`, `settings.text`, `language`) and **exports** their
   profile blob (`App sharing → Export profile`).
2. In ArtInsight the user **imports** that JSON (`Accessibility → Import
   profile…`). `ToolkitStore.importProfile` validates the `aa-profile-blob`
   handshake and derives `ArtInsightSurface`.
3. Every describe call now appends `promptContext`, so the assistant adapts its
   verbosity / reading level / language to that user.

Only the **modality‑neutral** AbilityModel travels. ArtInsight derives its *own*
surface locally (a detailed‑vs‑brief describe style) — the exact analogue of the
web `fontScale` SurfaceProfile, which is why SurfaceProfiles never leave a
device.

### WRITE — a suggestion, never a silent change
1. As the user repeatedly asks for more detail, or re‑records a description in
   their own words, `ToolkitStore` records observations and, past a small
   threshold, enqueues an **insight** (`add-memory`, soft by default).
2. The user **exports** the outbox and carries it to the web extension's
   `Import profile…` (it detects `aa-insight-outbox`).
3. Each insight is gated by ArtInsight's grant and surfaces as a **consent
   card** — accept / not now / don't‑suggest. Nothing changes until the user
   says yes, and ArtInsight can never resolve its own suggestion.

## The XR sensor loop (reference)
The flagship XR→web scenario uses the optional **`Sensors`** port
(`toolkit/ports/index.js`): a host that can *measure* the user (XR field‑of‑view,
a phone's Dynamic Type) reads the sensor, maps the reading to a neutral `need`,
and contributes it through the same `importInsight`/outbox path — so a
measurement is a proposal like any other. `toolkit/test/phase3-crossapp.test.mjs`
drives that full loop (XR posts a measured `textSize` insight → the user
approves → the AbilityModel carries it → ArtInsight reads it) end‑to‑end against
the real core.

## Wiring it into the app
Add the four files to the Xcode target, and present `ToolkitSettingsView` from a
tab or a settings sheet (e.g. in `TabInterfaceView`). To capture write‑side
signals, call `ToolkitStore.shared.recordDetailRequest()` where the user asks
for more detail and `recordRecordingCorrection()` from the recording flow. No
other change is required; the prompt injection is already in place.

## Deliberately out of scope (prototype)
Signed/encrypted blobs, an App‑Group shared container for same‑device transport
(the toolkit's `createSharedTransport` is ready for a host that provides one),
background sync, and a formal grant ledger — all **[product‑hardening]** per §6.
Note ArtInsight ships a placeholder OpenAI key (`OpenAI+Request.swift`); real use
requires the developer's own key, unchanged by this integration.
