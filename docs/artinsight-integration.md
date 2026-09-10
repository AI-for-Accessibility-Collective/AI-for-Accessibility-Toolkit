# Concept: ArtInsight as another example consumer of the toolkit

One way to test the toolkit's central claim is a *native* app that reads
the same understanding of a person and contributes back to it, without a
rewrite of the toolkit and without re-interviewing the person. ArtInsight is
one candidate for that test. Other Collective projects, or an app outside
the Collective, could serve the same purpose; nothing below is specific to
ArtInsight except the surface it derives (how detailed a description to
give) and the one line where it injects that into a prompt.

**ArtInsight** is a Collective research project: an iOS/SwiftUI app that
describes art for blind and low-vision people via an OpenAI Assistant. Its
distilled knowledge module is in
[`tools/insights/artinsight/`](../tools/insights/artinsight/). It has
centralized LLM calls and no existing profile layer, so the natural hook is
prompt-context injection.

The integration shape is a **conformer**, not an embed: the app does not
run the JS core. It implements the toolkit *spec* in native Swift: the same
blob schema, the same AbilityModel shape, and the same consent contract
(read = a person-granted scope; write = a proposal, never silent).

## Where this stands

Three states, and the rest of this page is organized by them.

1. **In the toolkit and extension repositories today.** The knowledge
   module; the optional `Sensors` port; the `phase3-crossapp` test (the name is a
   relic of the old refactor roadmap's phase numbering), which
   drives the whole cross-app loop against the real core with a stand-in
   for the native app; and, in the extension, `Librarian.importInsightOutbox`
   with its route and the outbox branch in the popup's import handler.
   This half is built
   and tested.
2. **Drafted as a prototype, outside both repositories.** Four Swift files
   and a one-line prompt edit were written against a local copy of the
   ArtInsight app during the refactor, to prove the spec could be met in
   Swift. They were not added to the app's Xcode target. Treat the Swift below as a worked design, not shipped
   code.
3. **Not built.** Signed or encrypted blobs, same-device
   transport, background sync, a formal grant ledger. Product hardening,
   tracked in [ROADMAP.md](../ROADMAP.md).

## 1. What exists in the toolkit today

- **The knowledge module**, `tools/insights/artinsight/`, distilled from the
  ArtInsight work. A catalog entry like any other.
- **The `Sensors` port** (`toolkit/ports/index.js`), optional: a host that
  can *measure* the person (an XR field of view, a phone's Dynamic Type)
  reads the sensor, maps the reading to a neutral need, and contributes it
  through the same `importInsight` path, so a measurement is a proposal
  like any other.
- **The cross-app test**, `toolkit/test/phase3-crossapp.test.mjs`: an XR
  host posts a measured `textSize` insight, the person approves it, the
  AbilityModel carries it, and a stand-in for ArtInsight reads it, end to
  end against the real core. This is the toolkit-side proof that the loop
  below works; the native app is simulated.
- **The outbox import on the extension side**:
  `Librarian.importInsightOutbox(outbox)`, the `librarianImportInsightOutbox`
  route, and an outbox branch in the popup's import handler. A
  person-carried outbox is drained through the same grant-gated,
  never-silent `importInsight` per entry. The outbox is transport; it
  grants nothing.

## 2. The prototype, as drafted

New Swift group `Mixed-Ability-Artwork/.../Toolkit/`, additive to the app:

| File | Role |
|---|---|
| `ToolkitProfile.swift` | Codable mirror of the toolkit blob and AbilityModel (`toolkit/sync/blob.js`, `toolkit/core/ability.js`), and the pure projection `ArtInsightSurface.derive(from:)`: neutral needs to ArtInsight's own surface (verbosity, reading level, language). |
| `ToolkitStore.swift` | Persistence (`UserDefaults`) and the two flows: holds the imported profile and exposes `promptContext`; records interaction observations and turns durable ones into an insight outbox. |
| `ToolkitSettingsView.swift` | The person-mediated transport UI: `.fileImporter` to load the profile exported from the web extension, `.fileExporter` to send the outbox back. |

One integration edit, in `Services/Open AI/OpenAI+Request.swift` (both
`describe` builders):

```swift
let toolkitContext = ToolkitStore.shared.promptContext
let userMessage = "Describe the image below, ..."
    + (toolkitContext.isEmpty ? "" : "\n\n" + toolkitContext)
```

`promptContext` is empty until a profile is imported, so behavior is
unchanged for anyone who never opts in.

### The two flows the prototype implements

**Read: the understanding, with no re-interview.**

1. In the web extension the person approves a grant for `artinsight`
   (`ability.categories`, `settings.text`, `language`) and exports their
   profile blob (App sharing, Export profile).
2. In ArtInsight the person imports that JSON (Accessibility, Import
   profile). `ToolkitStore.importProfile` validates the `aa-profile-blob`
   handshake and derives `ArtInsightSurface`.
3. Every describe call appends `promptContext`, so the assistant adapts its
   verbosity, reading level and language to that person.

Only the modality-neutral AbilityModel travels. ArtInsight derives its own
surface locally (a detailed-versus-brief describe style), the exact analogue
of the web `fontScale` surface, which is why surface settings never leave a
device.

**Write: a suggestion, never a silent change.**

1. As the person repeatedly asks for more detail, or re-records a
   description in their own words, `ToolkitStore` records observations and,
   past a small threshold, enqueues an insight (`add-memory`, soft by
   default).
2. The person exports the outbox and carries it to the web extension's
   Import profile (it detects `aa-insight-outbox`).
3. Each insight is gated by ArtInsight's grant and surfaces as a consent
   card: accept, not now, don't suggest. Nothing changes until the person
   says yes, and ArtInsight can never resolve its own suggestion.

### What wiring it in would take

Add the four files to the Xcode target, and present `ToolkitSettingsView`
from a tab or a settings sheet (for example in `TabInterfaceView`). To
capture write-side signals, call `ToolkitStore.shared.recordDetailRequest()`
where the person asks for more detail and `recordRecordingCorrection()` from
the recording flow. The prompt injection is the only other change. Note
that ArtInsight ships a placeholder OpenAI key (`OpenAI+Request.swift`);
real use needs the developer's own key, unchanged by this integration.

## 3. Deliberately out of scope

Signed or encrypted blobs; an App-Group shared container for same-device
transport (the toolkit's `createSharedTransport` is ready for a host that
provides one); background sync; a formal grant ledger. All product
hardening, not prototype work.

## Other ways to run the same test

The point of this page is the shape (conformer, blob, grant, outbox), not
the app. Any host with centralized model calls and no profile layer of its
own is a candidate: another Collective project, a mobile app outside the
Collective, or an XR runtime using the `Sensors` port directly. The
toolkit-side machinery in section 1 is the same for all of them.
