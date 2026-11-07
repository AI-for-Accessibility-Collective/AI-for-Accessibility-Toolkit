"""Caption segmentation using genuine faster-whisper word timestamps.

No timing is guessed from characters or word counts. A whole ASR segment is kept
unchanged if usable word-level timestamps are unavailable.
This module has no third-party dependencies so it can be unit-tested separately.
"""

import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class CaptionLimits:
    max_chars: int = 48
    max_seconds: float = 3.5
    max_words: int = 10

    def __post_init__(self):
        if not (20 <= self.max_chars <= 120):
            raise ValueError('Caption max chars must be between 20 and 120')
        if not (1.0 <= self.max_seconds <= 10.0):
            raise ValueError('Caption max seconds must be between 1 and 10')
        if not (4 <= self.max_words <= 24):
            raise ValueError('Caption max words must be between 4 and 24')


def readable_text(words):
    """Build readable text from Whisper words, retaining punctuation."""
    text = ' '.join(str(word.word).strip() for word in words)
    text = re.sub(r'\s+([,.;:!?%)\]])', r'\1', text)
    text = re.sub(r'([(\[])\s+', r'\1', text)
    return ' '.join(text.split())


def _source_cue(segment):
    return {
        'start': round(float(segment.start), 3),
        'end': round(float(segment.end), 3),
        'text': str(segment.text).strip(),
    }


def split_segment(segment, limits=CaptionLimits()):
    """Split one Whisper segment at actual word boundaries.

    Returns short timed cues, or the original segment if word timing is absent,
    inconsistent or insufficient to preserve the full transcript.
    """
    original = _source_cue(segment)
    if not original['text'] or original['end'] <= original['start']:
        return []
    words = getattr(segment, 'words', None)
    if not words:
        return [original]
    checked = []
    prior_start = -math.inf
    for w in words:
        value = str(getattr(w, 'word', '')).strip()
        start = getattr(w, 'start', None)
        end = getattr(w, 'end', None)
        if (not value or not isinstance(start, (float, int)) or
                not isinstance(end, (float, int)) or
                not math.isfinite(start) or not math.isfinite(end) or
                start < 0 or end <= start or start < prior_start or
                start < float(segment.start) - 0.15 or
                end > float(segment.end) + 0.15):
            return [original]
        checked.append(w)
        prior_start = start

    # Do not use word timing if the recognized words fail to cover the ASR text.
    # Punctuation and spacing sometimes differ; compare alphanumeric tokens.
    tokens = lambda s: re.findall(r'[^\W_]+', s.casefold(), flags=re.UNICODE)
    if tokens(readable_text(checked)) != tokens(original['text']):
        return [original]

    groups = []
    current = []

    def flush():
        nonlocal current
        if current:
            groups.append(current)
            current = []

    for w in checked:
        candidate = current + [w]
        if current and (
            len(readable_text(candidate)) > limits.max_chars or
            float(w.end) - float(current[0].start) > limits.max_seconds or
            len(candidate) > limits.max_words
        ):
            flush()
        current.append(w)
        # End a sentence when we already have enough text for a meaningful cue.
        if len(current) >= 3 and re.search(r'[.!?][\"\u201d\']?$', str(w.word).strip()):
            flush()
    flush()

    captions = []
    for group in groups:
        start = max(float(segment.start), float(group[0].start))
        end = min(float(segment.end), float(group[-1].end))
        if end <= start:
            return [original]
        captions.append({
            'start': round(start, 3),
            'end': round(end, 3),
            'text': readable_text(group),
        })
    # If words overlap, keep nondecreasing cue starts; overlaps are valid for
    # dialogue, and the V1 contract allows them.
    if any(not cue['text'] for cue in captions):
        return [original]
    return captions