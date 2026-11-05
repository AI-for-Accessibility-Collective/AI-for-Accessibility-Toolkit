# CaptionFlow — Integration Skeleton (Role 1)

A small **mocked** end-to-end application pipeline within the AI for Accessibility Toolkit fork. It is not a finished accessible video player, does not play a video, and does not call ASR, Gemini, other AI or the toolkit profile service yet.

## Run from repository root

```bash
node captionflow/scripts/run-mock.mjs
node captionflow/scripts/run-mock.mjs --lang=sw --mode=plain
node captionflow/scripts/run-mock.mjs --lang=en --mode=original
node --test captionflow/tests/*.test.mjs
```

`run-mock.mjs` uses fixed fixture preferences (`--lang`/`--mode`/`--font-scale`
flags). To see preferences actually read from and persisted to the toolkit's
Librarian instead, use `run-toolkit.mjs` (Role 5, see
[`TOOLKIT_PREFERENCES.md`](TOOLKIT_PREFERENCES.md)):

```bash
node captionflow/scripts/run-toolkit.mjs --user=alice --set-text-size=1.3
node captionflow/scripts/run-toolkit.mjs --user=alice   # loads the saved value back
```

No extra npm dependencies or API credentials are required. Stdout contains JSON for a future player; stderr contains a mock-only disclaimer.

## What you will see

A fictional public-information announcement flows through:

`local timed-transcript fixture → validation → app preferences → caption processor fixture → validation → player-ready JSON`

Every output cue has `id`, `start`, `end`, `originalText`, `displayText`, `language`, `mode`, and `status`. A cue with `status=needs-review` is **not approved by the co-designer**: the transformed text is illustrative. The fixture has no associated playable media asset and does not verify real synchronization.

## Folder ownership and swap points

| Owner | Replace | Interface |
|---|---|---|
| Brian (Role 1) | `src/pipeline.mjs`, `src/contracts.mjs` | `createCaptionFlowPipeline(...)`; contracts and orchestration |
| Joan (Role 2) | `src/mocks/fixture-transcriber.mjs` | `transcribe({ videoId, media }) -> TimedTranscript` |
| Role 3 | `src/mocks/fixture-caption-processor.mjs` | `process({ transcript, preferences }) -> ProcessedCaption[]` |
| Role 4 | No player built in this PR | Consume `{videoId, captions, preferences, warnings}` returned by `run()` |
| Ken (Role 5) | `src/mocks/fixture-preferences.mjs` | `getPreferences({ videoId, sourceLanguage }) -> CaptionPreferences` |

**Do not modify upstream toolkit code just to satisfy these mock contracts.** Keep reusable toolkit fixes in separate small PRs. Real video upload/transcription must obtain permission and handle media/provider errors; store any credentials on the server, not in browser JavaScript.

See [`docs/captionflow/TEAM_CONTRACTS.md`](../docs/captionflow/TEAM_CONTRACTS.md) for interface definitions and acceptance criteria.

## Scope limitations by design

- This is **not** speech-to-text. Timings are manually written fixtures; real sync is not verified.
- English and Swahili transformed wording are demonstration samples requiring human review; no translation accuracy is claimed.
- This version enforces one output cue per input segment and **unchanged time boundaries**. If the team introduces merging/resegmenting cues, agree and version a new contract first.
- `paceMode` is metadata only until the player implements playback control. It does **not** alter timing in this pipeline.
- CaptionFlow app preference names are **not** implied to be native AbilityModel dimensions. Ken will map supported needs through toolkit APIs and store only host-specific preferences where necessary.
- No claim of being KSL accessible is made until the Deaf KSL co-designer actually tests the experience.
