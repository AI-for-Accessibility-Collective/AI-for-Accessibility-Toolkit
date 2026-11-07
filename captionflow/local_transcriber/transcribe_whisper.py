"""faster-whisper -> CaptionFlow timed transcript with real word-aligned cues.

Usage: python transcribe_whisper.py MEDIA_PATH VIDEO_ID LANGUAGE_OR_AUTO MODEL
JSON only on stdout; diagnostic errors on stderr. No artificial timestamping.
"""
import json
import os
import sys

from caption_segments import CaptionLimits, split_segment


def get_limits(env=os.environ):
    return CaptionLimits(
        max_chars=int(env.get('CAPTIONFLOW_CAPTION_MAX_CHARS', '48')),
        max_seconds=float(env.get('CAPTIONFLOW_CAPTION_MAX_SECONDS', '3.5')),
        max_words=int(env.get('CAPTIONFLOW_CAPTION_MAX_WORDS', '10')),
    )


def main():
    if len(sys.argv) != 5:
        raise ValueError('Expected MEDIA_PATH VIDEO_ID LANGUAGE_OR_AUTO MODEL')
    media_path, video_id, language, model_name = sys.argv[1:]
    if language not in {'en', 'sw', 'auto'}:
        raise ValueError('Speech language must be en, sw or auto')

    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    segments, info = model.transcribe(
        media_path,
        language=None if language == 'auto' else language,
        task='transcribe',
        beam_size=5,
        word_timestamps=True,
    )
    limits = get_limits()
    language_code = info.language
    cues = []
    for segment in segments:
        for cue in split_segment(segment, limits):
            cues.append({
                'id': f'seg-{len(cues) + 1:04d}',
                **cue,
                'language': language_code,
            })

    print(json.dumps({
        'videoId': video_id,
        'sourceLanguage': language_code,
        'segments': cues,
    }, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Local Whisper error: {exc}', file=sys.stderr)
        sys.exit(1)