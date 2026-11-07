# CaptionFlow: captions I can follow

A demo for the "Captions I Can Follow" challenge: turn an uncaptioned Kenyan
video into a time-aligned transcript, then play it with large captions while
**the video slows down to the viewer's reading speed**, so a Deaf viewer can
read every line as it plays. It works in a phone or laptop browser.

> Status: a hackathon prototype built on a pre-alpha research toolkit. The
> captions are machine-generated and can mishear or miss words, and a viewer
> who cannot hear the audio cannot catch those mistakes. Do not rely on it
> for health or safety information without checking against the source.

## What is here

| File | What it does |
|---|---|
| `transcribe.mjs` | Video → `<name>.transcript.json` + `<name>.vtt`. Cuts the audio into short overlapping chunks with ffmpeg, transcribes each chunk with Gemini or Whisper, and merges them into one timed transcript. |
| `serve.mjs` | Serves the player to this laptop and to phones on the same Wi-Fi. |
| `player/` | The player: big captions, slowed playback, a reading-speed check, caption size and colours, and the full transcript. |
| `media/` | Put videos here. Their captions are written beside them, and the player lists every video that has captions. |
| `../../tools/utils/timed-transcript.js` | The timed-transcript format and helpers: chunk merging, VTT/SRT reading and writing, long-line splitting. |
| `../../tools/utils/caption-pacing.js` | The pacing engine: the playback speed and any pause each caption needs, for a given reading speed. |

Tests: `node tools/test/timed-transcript-test.js`. This also runs as part of `npm test`.

## Run it

You need Node 20 or newer, and ffmpeg (`sudo apt install ffmpeg`,
`brew install ffmpeg`, or `winget install ffmpeg`).

```bash
# 1. a key for one transcription engine
export GEMINI_API_KEY=...          # or: export WHISPER_API_KEY=...  (Groq by default)

# 2. caption a video
cp ~/Downloads/moh-announcement.mp4 examples/captionflow/media/
node examples/captionflow/transcribe.mjs examples/captionflow/media/moh-announcement.mp4 --lang auto

# 3. watch it on the laptop, or on a phone on the same Wi-Fi
node examples/captionflow/serve.mjs
```

The server prints two addresses: one for the laptop and one for a phone on
the same Wi-Fi. On the phone you can also pick a video and its captions file
from the phone itself.

Useful options:

- `--lang en|sw|auto`: what is spoken. `auto` handles English, Swahili and code-switching.
- `--provider gemini|whisper|faster-whisper|mock`: `mock` runs the whole pipeline offline, without a key. `faster-whisper` runs on this machine with no key and no upload (see below).
- `--import-vtt captions.vtt`: if a video already has captions (for example from YouTube), convert them instead of transcribing.

## Local transcription with faster-whisper

`faster_whisper_worker.py` runs [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
on this machine. The model downloads once on first use (a few hundred MB for
`small`). Set it up once:

```bash
python3 -m venv ~/.local/share/captionflow/venv
~/.local/share/captionflow/venv/bin/pip install faster-whisper "av>=16,<17"
```

`av` is pinned because faster-whisper 1.2.1 does not work with PyAV 17 or
later. The transcriber finds the venv at that path, or at `FASTER_WHISPER_PYTHON`.

- `FASTER_WHISPER_MODEL`: `tiny`, `base`, `small` (default), `medium`, `large-v3`. Larger is more accurate and slower; `medium` or larger is worth trying for Swahili.
- `FASTER_WHISPER_DEVICE`: `cpu` (default) or `cuda`.
- `FASTER_WHISPER_COMPUTE`: `int8` (default on CPU).

On CPU, `small` took about one second per second of audio on the test
machine. Swahili has not been tested yet.

## How the timing works

**Transcription.** Audio is cut into chunks (30 s for Gemini, 10 min for
Whisper) that overlap by 2 s. Each chunk returns segments timed from the
start of that chunk, and the chunk's offset is added. Each overlap is cut at
its midpoint, and a segment goes to the chunk on whose side its own middle
falls. That way a phrase on a boundary is neither lost nor shown twice. If
a chunk fails, the transcript says "[captions unavailable for this part]"
instead of leaving a silent gap.

**Pacing.** For each caption, the reading time is its word count divided by
the viewer's reading speed (at least 1 s). If the speech is shorter than
that, the video plays slower: speech time ÷ reading time, but never below
the "slowest" setting (50% by default). If that still isn't enough, the
video pauses at the end of the caption for the remaining time, shows a
countdown, and carries on by itself. Pressing play, or seeking, cancels the
pause.

## Choosing an engine

Run the same 3–5 clips through both engines and compare them before the
demo. For each one, check word errors, whether names, numbers and dates are
exact, and whether captions appear when the words are spoken. Whisper's
segment times come from the model's own timestamps. Gemini's come from
asking for timestamps per 30-second chunk, so they are rougher.

## Next steps

- Plain-language rewrite and English↔Swahili translation per segment,
  keeping each segment's timing (the toolkit's `simplify-text` and
  `translate-page` adapters do this for page text).
- Store the reading speed in the person's toolkit profile, so it follows
  them to other apps. `readingSpeedNeed()` in `caption-pacing.js` already
  produces the need.
- An adapter, so the same pacing works on videos on any website in the
  browser extension.
