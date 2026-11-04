import { readFile } from 'node:fs/promises';

/**
 * Prewritten caption alternatives exercise the contract WITHOUT calling an LLM.
 * Never imply these samples were verified by a co-designer.
 */
export function createFixtureCaptionProcessor({ fileUrl }) {
  return {
    async process({ transcript, preferences }) {
      const variants = JSON.parse(await readFile(fileUrl, 'utf8'));
      return transcript.segments.map(segment => {
        const original = {
          id: segment.id, start: segment.start, end: segment.end,
          originalText: segment.text, displayText: segment.text,
          language: segment.language, mode: 'original', status: 'ready',
        };
        const wantsOriginal = preferences.mode === 'original' && preferences.captionLanguage === segment.language;
        if (wantsOriginal) return original;
        const alt = variants[segment.id]?.[preferences.captionLanguage]?.[preferences.mode];
        if (typeof alt === 'string' && alt.trim()) {
          return { ...original, displayText: alt.trim(), language: preferences.captionLanguage,
            mode: preferences.mode, status: 'needs-review' };
        }
        return { ...original, status: 'fallback' };
      });
    },
  };
}
