/** Experimental, conservative caption rewrite stage.
 * Rewrites only a small, auditable English glossary; every changed cue is
 * explicitly marked needs-review. This is NOT an LLM or a Swahili translator.
 * Original speech wording and timestamps remain intact and available.
 */

const RULES = Object.freeze([
  ['due to the fact that', 'because'],
  ['in order to', 'to'],
  ['prior to', 'before'],
  ['subsequent to', 'after'],
  ['at this point in time', 'now'],
  ['commencement', 'start'],
  ['commenced', 'started'],
  ['commence', 'start'],
  ['utilization', 'use'],
  ['utilize', 'use'],
  ['approximately', 'about'],
  ['consequential', 'important'],
  ['facilitate', 'help'],
  ['implementing', 'putting in place'],
]);

function keepCase(original, replacement) {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function numericTokens(text) {
  return (text.match(/\b\d+(?:[.,:/-]\d+)*\b/g) || []).join('|');
}

export function suggestPlainEnglish(text) {
  if (typeof text !== 'string') return null;
  let result = text;
  // Preserve quoted sentences and numeric content rather than guessing at
  // the semantics of critical instructions, named initiatives or dates.
  if (/['"\u201c\u201d]/.test(text)) return null;
  for (const [phrase, replacement] of RULES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(matcher, match => keepCase(match, replacement));
  }
  if (result === text || numericTokens(result) !== numericTokens(text)) return null;
  // A small glossary is not a semantic validator. Every change needs review.
  return result;
}

/** Allows a future LLM provider to be injected without changing the caption
 * processor contract: rewrite({text,language,context}) -> string | null.
 * Failed, missing or untrusted rewrites fall back to original speech.
 */
export function createPlainCaptionProcessor({ rewrite = ({ text, language }) =>
  language === 'en' ? suggestPlainEnglish(text) : null,
} = {}) {
  if (typeof rewrite !== 'function') throw new TypeError('rewrite must be a function');
  return {
    async process({ transcript, preferences }) {
      const cues = [];
      for (let i = 0; i < transcript.segments.length; i += 1) {
        const segment = transcript.segments[i];
        const original = {
          id: segment.id, start: segment.start, end: segment.end,
          originalText: segment.text, displayText: segment.text,
          language: segment.language, mode: 'original', status: 'ready',
        };
        if (preferences.mode !== 'plain' || preferences.captionLanguage !== segment.language) {
          const requestedUnmodified = preferences.mode === 'original' &&
            preferences.captionLanguage === segment.language;
          cues.push({ ...original, status: requestedUnmodified ? 'ready' : 'fallback' });
          continue;
        }
        let proposal = null;
        try {
          proposal = await rewrite({
            text: segment.text,
            language: segment.language,
            context: transcript.segments.slice(Math.max(0, i - 1), i + 2).map(s => s.text),
          });
        } catch {
          // Never hide source captions because a simplifier failed.
        }
        if (typeof proposal !== 'string') { cues.push({ ...original, status: 'fallback' }); continue; }
        const simplified = proposal.trim();
        if (!simplified || simplified === segment.text ||
            numericTokens(simplified) !== numericTokens(segment.text) ||
            simplified.length > segment.text.length * 2.0) {
          cues.push({ ...original, status: 'fallback' });
          continue;
        }
        cues.push({ ...original, displayText: simplified, mode: 'plain', status: 'needs-review' });
      }
      return cues;
    },
  };
}