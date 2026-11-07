# CaptionFlow — runnable local / fixture / hosted browser demo

This demo uses the existing CaptionFlow pipeline/contracts, Kenn's toolkit-backed text-size provider, and a video player that displays cues against the video media clock.

## 1. Start the player

From the repository root (run in the same terminal where your virtual environment is active):

```bash
source captionflow/.venv/bin/activate
CAPTIONFLOW_AI_BACKEND=local node captionflow/demo/server.mjs
```

Open **http://127.0.0.1:8787**. The server listens only on `127.0.0.1` and is **not suitable for public deployment**.

If your venv is at a different location, explicitly point the Node host at its Python interpreter:

```bash
CAPTIONFLOW_PYTHON="/absolute/path/to/your/venv/bin/python" \
CAPTIONFLOW_WHISPER_MODEL=base \
CAPTIONFLOW_AI_BACKEND=local \
node captionflow/demo/server.mjs
```

Select **Local: faster-whisper**, choose **your `test_video.mp4`**, select English, and click **Generate captions from this video**. This uploads the selected video to your *own loopback server*, where Python runs faster-whisper and returns timed JSON. The server deletes its temporary file after processing; the browser keeps its own file object for playback. On a CPU, the first model load/transcription can take time. The first model download also needs internet access.

You can use **Fixture: sample captions** without an AI model. These three fictional captions do not match a random video; they test the interface only. You can also load CaptionFlow output JSON or a V1 `TimedTranscript` JSON into the player and manually associate it with a matching video.

### Headless provider checks (optional)

You can also run the complete pipeline without opening the browser:

```bash
node captionflow/scripts/run-providers.mjs --provider=fixture --lang=sw --mode=plain
CAPTIONFLOW_PYTHON="$PWD/captionflow/.venv/bin/python" \
  node captionflow/scripts/run-providers.mjs --provider=local --file=captionflow/test_video.mp4 --lang=en
```

The CLI emits pipeline JSON on stdout. Unlike the browser, the CLI accepts a server-side file path directly. Hosted mode requires the URL/token configuration and `--consent-hosted=yes`.

### Python transcription code location

The local model bridge lives in `captionflow/local_transcriber/transcribe_whisper.py`.
The JavaScript adapter at `captionflow/src/providers/local-whisper.mjs` starts it using
`CAPTIONFLOW_PYTHON`. The folder name `local_transcriber` refers to our **source code**;
it is not the Python virtual environment. Keep your existing `captionflow/.venv` folder as-is.

## 2. Provider switch

| Mode | Behavior | Required setup |
|---|---|---|
| `fixture` | Prewritten, fictional sample captions | None |
| `local` | Real ASR + segment timestamps via faster-whisper; original speech language | Python venv with `faster-whisper`, cached Whisper model |
| `hosted` | Sends the selected video as multipart/form-data to a **compatible** configured endpoint | `CAPTIONFLOW_HOSTED_URL`, `CAPTIONFLOW_HOSTED_TOKEN` (except local test endpoint), explicit UI consent |

`CAPTIONFLOW_AI_BACKEND` sets the **default selected mode**; the user can change it in the UI. Hosted is disabled unless an endpoint is configured. The provider switch only changes transcription. **Neither live AI simplification nor English-to-Swahili translation is implemented.** Selecting Plain for generated ASR correctly falls back to original text. The text is never falsely labeled as translated.

### Hosted provider wire contract (generic, until organiser details are available)

```
POST {CAPTIONFLOW_HOSTED_URL}
Authorization: Bearer {CAPTIONFLOW_HOSTED_TOKEN}
Content-Type: multipart/form-data
  file: binary video file
  videoId: string
  language: "en" | "sw" | "auto"
```

Return a JSON body conforming to CaptionFlow V1:

```json
{
  "videoId": "clip-...",
  "sourceLanguage": "en",
  "segments": [
    { "id": "seg-0001", "start": 0.0, "end": 2.5,
      "text": "Hello, welcome.", "language": "en" }
  ]
}
```

The generic hosted provider is **not** automatically compatible with OpenAI, Gemini, or a hackathon-specific API. Once the event provides API specifications, adapt `src/providers/hosted-asr.mjs` to their actual request/response shapes. Never put event tokens into the browser or the repository. Non-loopback hosted endpoints must use HTTPS. The app requires an explicit hosted-upload consent checkbox.

### Environment variables

```bash
CAPTIONFLOW_AI_BACKEND=fixture     # fixture / local / hosted
CAPTIONFLOW_PYTHON=python3         # prefer absolute venv python path
CAPTIONFLOW_WHISPER_MODEL=base     # optional: tiny / base / small / ...
CAPTIONFLOW_HOSTED_URL=https://example.org/your-compatible-asr-endpoint
CAPTIONFLOW_HOSTED_TOKEN=YOUR_TOKEN
PORT=8787
```

Don't set example hosted values literally. Export them only once you have the actual API specification.

## 3. Test the whole patch

```bash
node --test captionflow/demo/*.test.mjs captionflow/tests/*.test.mjs
node --check captionflow/demo/app.js
node --check captionflow/demo/server.mjs
npm test
```

After starting the server, manually test:

1. Load the video you actually transcribed (e.g. `test_video.mp4`), generate Local captions, and watch. Check words and times against the spoken content.
2. Pause, seek to 7.2s and 14.24s, and change playback speed. Caption changes use `video.currentTime`, so playback rate does not require retiming the transcript.
3. Choose Pause-at-caption, replay and next caption.
4. Adjust font size, refresh, and undo; ensure toolkit preferences persist.
5. Switch to Plain or a different language and confirm the app shows the original words with a fallback notice instead of inventing a translation.
6. Download caption JSON, refresh, and load the JSON with the **matching video**.
7. Run the same fixture-only path without Whisper installed.

## 4. Known limitations and safety

- `faster-whisper` uses segment timestamps; they approximate speech boundaries, not necessarily exact word timing. Long 7–9 second cues can be too long to read comfortably; segmentation and alignment are separate future work.
- ASR can mistranscribe names and technical terms. Review the output, especially for health and government information.
- No live simplification, accurate translation, or actual hosted vendor adapter is claimed.
- Local upload limit: **75 MiB** per video; this is a lightweight single-user demo and serializes transcription requests. Hosted mode reads the video into memory before forwarding it.
- The default fixture text belongs to a fictional notice and MUST NOT be used to claim synchronization with an unrelated video.
- Don't expose `127.0.0.1` server on a public interface or send the localhost URL to the co-designer. For co-designer testing, use a consented screen share or prepare a properly secured deployment.
- Playback and text controls need in-person or remote evaluation with the Deaf co-designer. Manual E2E browser checks are necessary; automated tests mainly verify API and timing logic.

## 5. Ownership

- **Brian:** provider switch, browser ↔ pipeline wiring, sync/error integration, regression tests.
- **Joan:** validate local/hosted ASR timestamps, English/Swahili accuracy, and supply matching demo video/reference transcript.
- **Kenn:** toolkit preference mapping and user experience, review caption alternatives and actual co-designer feedback.

All changes should go through a feature branch → PR to **`CaptionFlow/dev`**; preserve the shared V1 contracts.