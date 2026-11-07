import unittest
from types import SimpleNamespace
from caption_segments import CaptionLimits, readable_text, split_segment


def fixture(text, words, start=0, end=9):
    word_objs = [SimpleNamespace(word=t, start=s, end=e) for t, s, e in words]
    return SimpleNamespace(text=text, words=word_objs, start=start, end=end)


class SegmentationTests(unittest.TestCase):
    def test_word_aligned_short_cues(self):
        words = [
            (' Africa', 0, .4), (' is', .4, .7), (' not', .7, 1.0),
            (' short', 1., 1.4), (' of', 1.4, 1.6), (' data.', 1.6, 2.0),
            (' Every', 2.1, 2.6), (' day,', 2.6, 3.0), (' people', 3.0, 3.6),
            (' share', 3.6, 4.0), (' information.', 4.0, 4.5),
        ]
        segment = fixture('Africa is not short of data. Every day, people share information.', words, end=5)
        cues = split_segment(segment, CaptionLimits(max_chars=40, max_seconds=3.5, max_words=10))
        self.assertGreaterEqual(len(cues), 2)
        self.assertEqual(cues[0], {'start': 0, 'end': 2, 'text': 'Africa is not short of data.'})
        self.assertEqual(cues[1]['start'], 2.1)
        self.assertEqual(' '.join(c['text'] for c in cues), segment.text)
        self.assertTrue(all(c['end'] > c['start'] for c in cues))

    def test_caps_duration_and_words_with_real_timings(self):
        words = [(f' word{i}', i * .8, (i + 1) * .8) for i in range(10)]
        segment = fixture(' '.join(f'word{i}' for i in range(10)), words, end=8)
        cues = split_segment(segment, CaptionLimits(max_chars=120, max_seconds=2.6, max_words=8))
        self.assertGreater(len(cues), 1)
        self.assertLessEqual(max(c['end'] - c['start'] for c in cues), 2.61)
        self.assertEqual(sum(len(c['text'].split()) for c in cues), 10)

    def test_fallback_never_fakes_timings(self):
        segment = fixture('Hello world.', [], start=.4, end=5)
        self.assertEqual(split_segment(segment), [{'start': .4, 'end': 5, 'text': 'Hello world.'}])
        bad = fixture('Hello world.', [(' Hello', .4, 1.)], start=.4, end=5)
        self.assertEqual(split_segment(bad), [{'start': .4, 'end': 5, 'text': 'Hello world.'}])

    def test_punctuation_and_invalid_alignment(self):
        words = [(' Hello,', 0, .5), (' there!', .5, 1.0)]
        segment = fixture('Hello, there!', words, end=1.0)
        self.assertEqual(readable_text(segment.words), 'Hello, there!')
        self.assertEqual(split_segment(segment)[0]['text'], 'Hello, there!')
        broken = fixture('Hello, there!', [(' Hello,', 1., 1.5), (' there!', .5, 1.)], end=2)
        self.assertEqual(len(split_segment(broken)), 1)
        self.assertEqual(split_segment(broken)[0]['start'], 0)

    def test_limits_are_bounded(self):
        with self.assertRaises(ValueError):
            CaptionLimits(max_chars=5)
        with self.assertRaises(ValueError):
            CaptionLimits(max_seconds=.2)


if __name__ == '__main__':
    unittest.main()