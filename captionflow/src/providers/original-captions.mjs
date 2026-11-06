/** No live simplifier is claimed: original captions remain visible and accurate.
 * Requests for plain wording or a different language safely fall back to the original.
 */
export function createOriginalOnlyCaptionProcessor() {
  return {
    async process({ transcript, preferences }) {
      return transcript.segments.map(segment => {
        const unmodified = preferences.mode === 'original' &&
          preferences.captionLanguage === segment.language;
        return {
          id: segment.id,
          start: segment.start,
          end: segment.end,
          originalText: segment.text,
          displayText: segment.text,
          language: segment.language,
          mode: 'original',
          status: unmodified ? 'ready' : 'fallback',
        };
      });
    },
  };
}