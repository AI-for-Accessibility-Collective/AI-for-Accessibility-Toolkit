"""faster-whisper -> CaptionFlow V1 timed transcript; invoked only by local Node host.

Usage: python transcribe_whisper.py MEDIA_PATH VIDEO_ID LANGUAGE_OR_AUTO MODEL
Only JSON is written to stdout. Model weights are cached by faster-whisper after first download.
"""
import json
import sys


def main():
    if len(sys.argv) != 5:
        raise ValueError("Expected MEDIA_PATH VIDEO_ID LANGUAGE_OR_AUTO MODEL")
    media_path, video_id, language, model_name = sys.argv[1:]
    if language not in {"en", "sw", "auto"}:
        raise ValueError("Speech language must be en, sw or auto")

    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        media_path,
        language=None if language == "auto" else language,
        task="transcribe",  # original speech language; translation is a separate component
        beam_size=5,
    )
    cues = []
    for i, segment in enumerate(segments, start=1):
        text = segment.text.strip()
        start = round(float(segment.start), 3)
        end = round(float(segment.end), 3)
        if not text or end <= start:
            continue
        cues.append({
            "id": f"seg-{i:04d}",
            "start": start,
            "end": end,
            "text": text,
            "language": info.language,
        })

    print(json.dumps({
        "videoId": video_id,
        "sourceLanguage": info.language,
        "segments": cues,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Local Whisper error: {exc}", file=sys.stderr)
        sys.exit(1)