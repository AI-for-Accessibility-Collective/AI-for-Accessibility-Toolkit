// AI output gates — shared checks a model answer must pass before an adapter
// writes it into the page.
//
// Every AI adapter faces the same failure: the model refuses, hedges, or
// answers in the wrong shape, and the adapter writes that straight into an
// attribute, a header cell, or a paragraph. For a screen reader user a
// refusal sentence in aria-label is worse than the "click here" it replaced,
// because it is announced as the link's name with full confidence. For a
// reader who relies on simplified or translated text, a passage that comes
// back at a fraction of its length is content lost with no sign that
// anything is missing. A rejected answer must degrade the way a null answer
// already does: leave the element alone.
//
// generate-alt.js (isConfidentDescription) and generate-labels.js
// (isValidLabel) already gate their output. They keep their own logic and
// only import the lists below, so their behavior is unchanged. The other
// adapters use the two reject* helpers so they gate the same way instead of
// each copying the lists.
//
// Each reject* helper returns a short reason string when the answer must not
// be used, or null when it may be, so the adapter can log why nothing changed.
// FLAG(review): adapters report a rejection with console.warn. The logFix and
// incrementStat hooks record a fix that was applied, so routing a rejection
// through them would count it as a fix in the host's stats.

// Openings that mean the model declined rather than answered.
export const REFUSAL_PREFIXES = ['I cannot', "I'm unable", 'I am unable', 'Sorry', 'I cannot describe', 'Unfortunately'];
// Words that mean the model is guessing. Only meaningful in a short value:
// a long passage can use "unclear" legitimately.
export const UNCERTAINTY_TERMS = ['unsure', "I don't know", 'unclear', 'I cannot tell', 'cannot determine'];
// The label gate's anchored, case-insensitive form of the same idea, with the
// short non-answers a model gives when asked for one or two words.
export const REFUSAL_RE = /^(i (cannot|can't|am unable|don't know)|sorry|unable to|n\/a|unknown|no label|not (sure|available)|unsure)/i;

// Longest value that may land in an attribute or a header cell. Matches the
// cap isValidLabel() already applies to aria-label.
export const MAX_SHORT_TEXT_CHARS = 60;

// True when the text opens like a refusal. Case-insensitive and anchored at
// the start: a refusal is how the model begins, not a word it uses later.
export function startsWithRefusal(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  const lower = t.toLowerCase();
  return REFUSAL_RE.test(t) || REFUSAL_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
}

// True when the text hedges anywhere ("unclear", "cannot determine").
export function containsUncertainty(text) {
  if (typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return UNCERTAINTY_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

// A passage that opens with the model declining in the first person. The
// short-value lists above are too broad for a passage: "Unfortunately, the
// museum is closed on Mondays." and "Sorry, we could not find that page."
// are content and must be kept, and so is "I can't wait to see you." What
// is rejected is an opening like "Unfortunately, I cannot translate this",
// "I'm sorry, but I can't help with that", or "I am unable to simplify
// this": an apology or a hedge, then "I", then a refusal verb.
// FLAG(review): English only. A model that declines in the target language
// of a translation passes this check. The verb list is a judgment call.
const REFUSAL_VERBS = 'translate|simplify|summarize|rewrite|rephrase|help|assist|provide|process|read|access'
  + '|determine|see|view|do|fulfill|complete|comply|generate|produce|answer|respond|perform|proceed|continue|work';
const FIRST_PERSON_REFUSAL_RE = new RegExp(
  String.raw`^(?:(?:unfortunately|sorry|i(?:'m| am) sorry)\b[,\s]*(?:but\s+)?)*`
  + String.raw`(?:i(?:'m| am) sorry\b|i(?:'m| am)(?: not able| unable)\b|i do(?:n't| not) know\b`
  + String.raw`|i can(?:'t|not)\s+(?:${REFUSAL_VERBS})\b)`,
  'i',
);

export function opensWithFirstPersonRefusal(text) {
  if (typeof text !== 'string') return false;
  return FIRST_PERSON_REFUSAL_RE.test(text.trim());
}

// Gate for a short, single-line value that lands in an attribute or a header
// cell (fix-links aria-label, fix-tables <th>).
export function rejectShortText(text, maxChars = MAX_SHORT_TEXT_CHARS) {
  if (typeof text !== 'string') return 'not a string';
  const t = text.trim();
  if (!t) return 'empty';
  if (t.length > maxChars) return `longer than ${maxChars} characters`;
  if (/[\r\n]/.test(t)) return 'contains a line break';
  if (startsWithRefusal(t)) return 'reads as a refusal';
  if (containsUncertainty(t)) return 'reads as uncertain';
  return null;
}

// Gate for a rewrite that replaces or stands in for a passage (simplify,
// translate, summarize). Length is judged against the input as a ratio,
// because the right length depends on the task: a simplification is a bit
// shorter, a translation into another script can be much shorter or longer,
// a summary is short by design. Each adapter passes the band that fits it.
// Newlines are allowed: this is passage text, not an attribute.
export function rejectRewrite(output, input, { minRatio = 0, maxRatio = Infinity } = {}) {
  if (typeof output !== 'string') return 'not a string';
  const out = output.trim();
  if (!out) return 'empty';
  if (opensWithFirstPersonRefusal(out)) return 'reads as a refusal';
  const inLen = typeof input === 'string' ? input.trim().length : 0;
  if (inLen > 0) {
    if (out.length < inLen * minRatio) return `shorter than ${minRatio} of the input`;
    if (out.length > inLen * maxRatio) return `longer than ${maxRatio} times the input`;
  }
  return null;
}
