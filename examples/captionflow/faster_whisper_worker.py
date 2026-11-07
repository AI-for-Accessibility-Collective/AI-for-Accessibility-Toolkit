#!/usr/bin/env python3
"""Local speech-to-text for CaptionFlow, using faster-whisper.

transcribe.mjs starts this once and sends it one audio chunk per line, so the
model loads once rather than for every chunk. The protocol is JSON lines:

  stdin  <- {"audio": "/abs/path.wav", "lang": "en" | "sw" | "auto"}
  stdout -> {"segments": [{"start", "end", "text", "confidence", "lang"}]}
            or {"error": "message"}

On startup it prints {"ready": true} once the model is loaded. Anything the
libraries print goes to stderr, so stdout only carries protocol lines.

Environment:
  FASTER_WHISPER_MODEL      tiny, base, small, medium, large-v3 (default small)
  FASTER_WHISPER_DEVICE     cpu or cuda (default cpu)
  FASTER_WHISPER_COMPUTE    int8, float16, float32 (default int8)
"""

import json
import math
import os
import sys

from faster_whisper import WhisperModel

LANGUAGE_CODES = {"en": "en", "sw": "sw"}


def load_model():
    return WhisperModel(
        os.environ.get("FASTER_WHISPER_MODEL", "small"),
        device=os.environ.get("FASTER_WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("FASTER_WHISPER_COMPUTE", "int8"),
    )


def language_argument(lang):
    return lang if lang in LANGUAGE_CODES else None


def segment_language(detected):
    return LANGUAGE_CODES.get(detected)


def transcribe(model, request):
    segments, info = model.transcribe(
        request["audio"],
        language=language_argument(request.get("lang", "auto")),
        vad_filter=True,
        beam_size=5,
        temperature=0.0,
        condition_on_previous_text=False,
    )
    detected = segment_language(info.language)
    kept = []
    for segment in segments:
        if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1:
            continue
        kept.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
            "confidence": math.exp(segment.avg_logprob) if math.isfinite(segment.avg_logprob) else None,
            "lang": detected,
        })
    return {"segments": kept}


def main():
    model = load_model()
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        try:
            response = transcribe(model, json.loads(line))
        except Exception as error:  # report per chunk; the Node side decides what to do
            response = {"error": f"{type(error).__name__}: {error}"}
        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
