/** View selection without rerunning expensive transcription.
 * Switches between original speech and precomputed, flagged rewrite suggestions.
 */
export function viewCaptionsForMode(payload, { language, mode }) {
  const segments = payload?.transcript?.segments;
  if (!Array.isArray(segments) || !segments.length) throw new Error('Timed transcript is required');
  const candidates = payload?.captionVariants?.plain;
  return segments.map((source, index) => {
    const original = {
      id: source.id, start: source.start, end: source.end,
      originalText: source.text, displayText: source.text,
      language: source.language, mode: 'original', status: 'ready',
    };
    if (language !== source.language) return { ...original, status: 'fallback' };
    if (mode !== 'plain') return original;
    const proposal = Array.isArray(candidates) ? candidates[index] : null;
    if (!proposal || proposal.id !== source.id || proposal.start !== source.start ||
        proposal.end !== source.end || proposal.originalText !== source.text ||
        proposal.language !== source.language ||
        typeof proposal.displayText !== 'string' || !proposal.displayText.trim() ||
        !['needs-review', 'fallback'].includes(proposal.status)) {
      return { ...original, status: 'fallback' };
    }
    return { ...proposal };
  });
}