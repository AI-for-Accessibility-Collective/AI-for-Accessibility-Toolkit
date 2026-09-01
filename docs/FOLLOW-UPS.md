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

### boolean `false` settings are rejected by browser-harness
**Toolkit half: correct.** "stop live captions" resolves to
`applySettings({showCaptions:false})`, the right payload for a `boolean`
settingsMeta key.

**Receiver half: BUG.** browser-harness applies `showCaptions:true` but returns
`{"error":"nothing applied"}` for `false` (with an empty `rejected`) — a
truthiness test treating `False` as "no value". Every boolean key can likely be
switched on by voice but not off. Spec + fix:
`browser-harness-a11y/docs/receiver-issue-boolean-false-settings.md`.

### `stop` — interrupt a running task
**Toolkit half: shipped** (`ed75dab`). Optional `stop()` in the ControlPort +
`canStop` capability; the Controller calls it from a Stop control shown while a
task runs. Documented in `controller/PROTOCOL.md`.

**Receiver half: DONE in browser-harness** (`control.py` implements the `stop`
action and lists it in `_actions()`). Any *other* receiver that runs long tasks
should implement `stop()` (abort the AbortSignal / kill the run) and set
`canStop: true`. Reference for new receivers.

## Toolkit tasks

### `auto-transcriber` is catalog-unreachable
`tools/adapters/auto-transcriber.js` is exported but no `settingsMeta` key maps
to it in `getEnabledAdapters` (`tools/profiles/settings.js`) — the same
reachability gap `fix-landmarks` / `read-aloud` once had. It's AI-powered
(`getYouTubeTranscript`). **Decide:** wire it to `autoCaptions` (the AI
caption-generation key) or drop it from the catalog. Surfaced in
`browser-harness-a11y/docs/toolkit-issue-show-captions.md`; the rest of that
issue (the non-AI `showCaptions` adapter + splitting the caption keys) is done
(`44ddb72`).
