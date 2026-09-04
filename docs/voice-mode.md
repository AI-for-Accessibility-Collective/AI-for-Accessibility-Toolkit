# Voice Mode — hands-free control via the Controller

Voice mode is how a person drives an app by **speaking (or typing)** instead of
pointing. In this repo it is the **Controller** ([`controller/`](../controller/))
— a platform-neutral text/voice control surface — not a bundled browser-extension
feature. The extension's old voice mode (Gemini Live over a raw WebSocket, an
offscreen document, `chrome.runtime.sendMessage` to a service worker) was retired
in the re-architecture; the toolkit kept the **port** and rebuilt the **UI**
host-agnostic. No `chrome.*`, no required cloud model, no API key.

> Full design + wire contract: [`controller/DESIGN.md`](../controller/DESIGN.md)
> and [`controller/PROTOCOL.md`](../controller/PROTOCOL.md). This page is the
> "how voice works" view.

## The shape

```
Person speaks / types  →  Controller (web/ui.js + core)  →  ControlPort  →  the app
   mic / text field          recognize → resolve → dispatch   7 methods + stop  (local or remote)
   ← live region + TTS + earcons  ←  deliver result  ←───────────────────────────────┘
```

Two surfaces run this same stack: the **floating widget**
([`controller/web/ui.js`](../controller/web/ui.js), mounted on any page) and the
**chat window** at `/chat` — a different shape over the same `createController`
core, where the same utterance can also update the person's profile.

- **Input** — the Web Speech `SpeechRecognition` API (feature-detected; the same
  code `onboarding/` uses). A 🎤 Speak button dictates into the field and
  auto-submits when recognition ends; **Ctrl+Space** toggles it from anywhere; a
  text field is always available too (speech-impaired users, noisy rooms,
  deterministic tests). Starting dictation **silences playback first** — it
  cancels any in-progress TTS and pauses local media, and asks a connected
  receiver to `muteAudio` so other tabs don't get transcribed (a page can't reach
  them itself).
- **Understanding** — a **hybrid** engine, no model required
  ([`controller/grammar.js`](../controller/grammar.js) +
  [`router.js`](../controller/router.js)): a zero-dependency grammar over the
  registry `settingsMeta` vocabulary ("bigger text", "dark mode", "high contrast",
  "reduce motion", "read this", "undo", "speak slower", "scroll down"), an
  **optional** host-supplied LLM lane for free-form phrasing
  ([`llm-lane.js`](../controller/llm-lane.js)), and a `task` catch-all that hands
  anything else to a task-capable app (e.g. an agent).
- **Action** — every effect goes through the neutral **`ControlPort`**:
  `applySettings` / `undoLast` (adaptations), `getContent` (read the page),
  `performAction` (scroll / activate / navigate / search / back / task),
  `getContext` / `describeCapabilities`. Same contract whether the receiver is a
  local DOM page or a remote mobile / XR / desktop app.
- **Output** — results land in an **ARIA live region** so a screen reader
  announces them in the person's own voice, and are **spoken via TTS** when the
  "Speak results aloud" toggle is on. The voice is **chosen, not inherited**
  (`bestVoice`: a local Premium/Enhanced voice, else a network one, else the
  platform default — the OS default is often a poor compact voice), and is
  selectable and persisted. Spoken text is stripped of markdown first
  (`forSpeech`) so a task's `**bold**` and backticks aren't read aloud as
  punctuation. While a task runs, an animated waiting indicator + a Web-Audio
  "thinking" earcon play, with a **Stop** control that calls the port's `stop()`,
  then a done / error chime.

## Voice output that doesn't fight a screen reader

The single most important correctness rule: a port method that *returns* text must
not itself speak, and the Controller must not put a second synthetic voice over a
screen reader (the failure mode for exactly the users it serves).

- `getContent` **returns** text; the Controller decides delivery.
- Delivery follows the operator's **presentation**
  ([`controller/presentation.js`](../controller/presentation.js), derived from
  their AbilityModel): a screen-reader operator (`output.assistiveTech`) gets the
  **live region only** — their own voice, at their rate; a speech-output profile
  also gets TTS.
- The **"Speak results aloud"** toggle (default on, persisted) makes it the
  person's *choice*, not an inference — a blind person on an AT-less kiosk can
  turn TTS on; a low-vision person with a screen reader running can turn it off.
  Either way the live region always carries the text.
- **Two live regions**: acknowledgements and errors are `assertive` (they confirm
  an action just started and are the only chance to catch a mis-recognition);
  task results and content reads are `polite`.
- **Earcons** (ported from browser-harness): a repeating 440+620 Hz "thinking"
  pulse while a task runs, a 660+880 done chime, a 300+210 error chime.
  Non-verbal, so they don't collide with a screen reader and play regardless of
  the TTS toggle.

## Consent & safety

- **Confirmation** — a state-changing command (activate / submit / navigate)
  waits for a spoken or typed "yes" when the operator's profile asks for it
  (`presentation.confirmActions`, e.g. motor / cognitive). Benign navigation
  (scroll / back) is never gated.
- **Adaptations are explicit** — a spoken "bigger text" is an explicit local
  request and applies immediately (with `undoLast`), the same posture the old
  voice mode took for direct user intent.
- **Untrusted content** — `getContent` marks its text `source:
  'untrusted-content'` (data, never instructions); the optional LLM lane only
  ever sees the person's own utterance + the receiver's capabilities, never page
  content, so there is no injection surface.
- **Read the utterance back** — the task acknowledgement is `Ok, running:
  <utterance>`, the only chance for a blind user to catch a mis-recognition
  before the app spends a minute on it.

## Driving a remote app (e.g. `browser-harness-a11y`)

A web Controller can drive a receiver in another process or on another device: the
receiver hosts a WebSocket endpoint and implements the `ControlPort`; the
Controller connects out with `connectRemoteReceiver('ws://…')`
([`controller/transport/remote.js`](../controller/transport/remote.js)). Because a
real browsing task takes 30–120s (past the 10s request timeout), the receiver
pushes the result later as an out-of-band `{ kind: "aa-control-note", text }`
message the Controller routes into its live region. A "Return to controller after
running" flag (default on) rides along as `meta.returnToController`, asking the
app — which owns the browser over CDP — to bring focus back to the Controller's
tab when the task finishes; a background notification is the web-native fallback.
When driving a URL, **raw mode** sends *all* input to the app as tasks (no local
grammar). Receiver spec: [`controller/PROTOCOL.md`](../controller/PROTOCOL.md).

## What changed from the extension voice mode

| Then (retired) | Now (the Controller) |
|---|---|
| Gemini Live over a raw WebSocket, offscreen doc, service worker | No required cloud model; deterministic grammar + optional host LLM lane |
| `chrome.tabs` / `chrome.scripting` / `chrome.storage` via `chrome.runtime.sendMessage` | The neutral `ControlPort` (a local object or a remote proxy over a channel) |
| 12 tool `function` declarations generated from `settingsMeta` | Intents dispatched to 7 `ControlPort` methods; grammar built from `settingsMeta` |
| Speak everything via `speechSynthesis` | Live-region-first delivery gated per operator; TTS optional; earcons |
| Extension-bound (Chrome MV3 lifecycle) | Host-agnostic surface; web today, native later |

The consent invariants the old design fought for — narrate + reversible undo,
untrusted page content, explicit user intent, no silent cross-app grants — carry
over: they now live in the Controller's presentation / confirmation flow and the
toolkit's Librarian, which still owns the memory / proposal / sharing rules any
host writes through.

## Testing

The Controller ships its own suite in [`controller/test/`](../controller/test/)
(run from the repo root with `npm test`, or a file individually):

- `controller.test.mjs` — grammar + dispatch + presentation (M0/M1).
- `controller-web.test.mjs` — the DOM `ControlPort` receiver.
- `controller-llm.test.mjs` — the optional LLM lane (offline, a fake `complete`).
- `controller-cmd.test.mjs` — command intents, confirmation, navigate / search,
  the `task` catch-all + `rawToTask`.
- `controller-remote.test.mjs` — the remote transport, `websocketChannel`, and
  the receiver→Controller note.
- `controller-ui.test.mjs` — the web UI: two live regions, the Speak-results
  toggle, waiting dots, notifications, `returnToController`.
- `controller-grammar-off.test.mjs` — behavior with the settings grammar
  bypassed (the `rawToTask` path).
