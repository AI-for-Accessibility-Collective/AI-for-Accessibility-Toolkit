# Follow-ups

Deferred work that's been scoped but not (fully) done. Two kinds:

- **Receiver tasks** — the toolkit ships its half (protocol + a best-effort
  call); a receiving app (e.g. `browser-harness-a11y`) implements the other half.
- **Toolkit tasks** — work inside this repo.

Keep this list short: add an item when you defer something with a clear plan,
remove it when it's done.

> This file is **pending work only**. The canonical list of everything a receiver
> must implement is `controller/PROTOCOL.md` — start at its **§0 Conformance
> checklist**.

## Receiver tasks

### `muteAudio` — silence other tabs during dictation
**Toolkit half: shipped** (`61aba96`). On voice-input start the Controller /
`/chat` fires best-effort `performAction("muteAudio", …)` (only when driving a
remote receiver) and pauses its own tab's media + TTS. A page can't reach other
tabs; the receiver must.

**Receiver half: TODO.** Declare `"muteAudio"` in `actions` and, on it, pause
every `<audio>`/`<video>` and cancel `speechSynthesis` across all tabs (skip the
Controller tab) via CDP. Full guidance + a ready-to-adapt snippet:
`browser-harness-a11y/docs/receiver-issue-mute-audio.md`. Documented in
`controller/PROTOCOL.md`.

### `stop` — interrupt a running task
**Toolkit half: shipped** (`ed75dab`). Optional `stop()` in the ControlPort +
`canStop` capability; the Controller calls it from a Stop control shown while a
task runs. Documented in `controller/PROTOCOL.md`.

**Receiver half: DONE in browser-harness** (`control.py` implements the `stop`
action and lists it in `_actions()`). Any *other* receiver that runs long tasks
should implement `stop()` (abort the AbortSignal / kill the run) and set
`canStop: true`. Reference for new receivers.

## Toolkit tasks

### A task result is a CLAIM, and the Controller presents it as fact
**Open design question — no fix specified yet.**

Anything the grammar doesn't claim goes to the receiver as a `task`, and an
agent's answer comes back as an `aa-control-note` that the Controller shows and
speaks verbatim. Observed (browser-harness-a11y
`docs/toolkit-issue-caption-verb-forms.md`): "turn off live captioning" missed
the grammar, reached the agent, and returned *"Live captioning turned off."* —
while Live Caption was still on.

Why it matters more here than elsewhere: a model asked to turn something off
tends to report that it did, and **the person on the other end may have no way to
look.** That is precisely this toolkit's audience. A deterministic
`applySettings` result is *verified* — the receiver reports the keys it actually
wrote — but a task note is unverified prose, and today both are rendered
identically.

Directions worth weighing (not yet chosen):

1. **Distinguish verified from claimed in the UI.** A confirmation the Controller
   can stand behind ("Captions are off") vs. relaying someone else's words ("The
   app reports: Live captioning turned off"). Cheap, honest, no protocol change.
2. **Verify settings-shaped tasks after the fact.** When a task's text names a
   setting the receiver declares, follow up with `getContext()` and compare
   `activeSettings`; contradict the claim if it doesn't hold. Costs one round
   trip, only on those tasks.
3. **Note provenance in the protocol.** Let a note say whether the receiver
   *checked* — e.g. `{kind:"aa-control-note", text, verified:true}`. The receiver
   knows: its own floor (reading Chrome's toggle back) is verified; an agent's
   prose is not. Then (1) is driven by data instead of a guess.
4. **Keep narrowing the gap.** Every phrasing the grammar handles is one the
   agent can't misreport — the -ing widening (2b2356a) and the whole-utterance
   narrowing (29e2e50) are this. Necessary but not sufficient: the tail is
   endless.

(1) + (3) look like the honest pair; (2) is the strongest guarantee where it
applies. Decide before adding more agent-lane surface.

### `auto-transcriber` is catalog-unreachable
`tools/adapters/auto-transcriber.js` is exported but no `settingsMeta` key maps
to it in `adaptersForTools` (`tools/profiles/settings.js`) — the same
reachability gap `fix-landmarks` / `read-aloud` once had. It's AI-powered
(`getYouTubeTranscript`). **Decide:** wire it to `autoCaptions` (the AI
caption-generation key) or drop it from the catalog. Surfaced in
`browser-harness-a11y/docs/toolkit-issue-show-captions.md`; the rest of that
issue (the non-AI `showCaptions` adapter + splitting the caption keys) is done
(`44ddb72`).
