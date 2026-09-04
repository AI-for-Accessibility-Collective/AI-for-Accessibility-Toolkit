// AI output gates: shared checks a model answer must pass before an adapter
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
// short non-answers a model gives when asked for one or two words. The
// sentence openers ("I cannot", "sorry", "not sure") match as prefixes. The
// bare non-answers ("n/a", "unknown", "no label", "not available", "unsure")
// must be the whole value, with at most closing punctuation after them:
// "Unknown Pleasures album" and "Not available in your region" are labels.
export const REFUSAL_RE = /^(i (cannot|can't|am unable|don't know)|sorry|unable to|not sure|(n\/a|unknown|no label|not available|unsure)[.!]?\s*$)/i;

// Longest value that may land in an attribute or a header cell. Matches the
// cap isValidLabel() already applies to aria-label.
export const MAX_SHORT_TEXT_CHARS = 60;

// A model often returns a typographic apostrophe, so "I can't" arrives as
// "I can’t". The lists above are written with a straight one, and
// generate-alt.js and generate-labels.js match them character for character,
// so the two checks below straighten the text they judge rather than the
// lists themselves. Only the comparison is straightened; the value an
// adapter writes keeps the apostrophe the model sent.
function straightenApostrophes(text) {
  return text.replace(/[’ʼ]/g, "'");
}

// True when the text opens like a refusal. Case-insensitive and anchored at
// the start: a refusal is how the model begins, not a word it uses later.
export function startsWithRefusal(text) {
  if (typeof text !== 'string') return false;
  const t = straightenApostrophes(text.trim());
  const lower = t.toLowerCase();
  return REFUSAL_RE.test(t) || REFUSAL_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()));
}

// True when the text hedges anywhere ("unclear", "cannot determine").
export function containsUncertainty(text) {
  if (typeof text !== 'string') return false;
  const lower = straightenApostrophes(text).toLowerCase();
  return UNCERTAINTY_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

// A passage that opens with the model declining in the first person. The
// short-value lists above are too broad for a passage: "Unfortunately, the
// museum is closed on Mondays." and "Sorry, we could not find that page."
// are content and must be kept, and so are ordinary first-person openings
// such as "I can't help but think", "I can't see why", "I'm sorry for your
// loss", "I am not able to attend" and "I don't know why, but". What is
// rejected is an apology or a hedge, then "I", then a negation (cannot,
// can't, could not, won't, will not, am unable to, am not able, permitted
// or allowed to, do not have the ability or permission to), then a refusal
// verb pointed at the task ("I cannot translate this text", "I'm sorry, but
// I can't help with that", "I am not permitted to simplify this passage"),
// or "I'm sorry" or "I can't" standing alone as the whole answer.
// FLAG(review): English only. A model that declines in the target language
// of a translation passes this check. The verb and object lists are a
// judgment call: "I cannot do this alone" is still rejected, a refusal
// built on a verb that is not listed goes through, and so does one whose
// object is not a listed task noun ("I cannot process the document").
const REFUSAL_VERBS = 'translate|simplify|summari[sz]e|rewrite|rephrase|restate|interpret|render|make\\s+out'
  + '|help|assist|provide|process|read|access|determine|identify|see|view|do|fulfill|complete|comply'
  + '|generate|produce|answer|respond|perform|proceed|continue|work';
// What the verb must point at for the sentence to be about the task rather
// than an ordinary first-person opening ("I can't help but", "I can't see
// why") or testimony ("I cannot see the screen well", "I cannot read the
// instructions without a screen reader"). Only words that name the task
// count: a demonstrative on its own, "it" as the last word, or a task noun
// with an optional article. "the screen" and "the instructions" are not the
// task, so those sentences are content.
const TASK_NOUN = 'text|content|passage|page|request|translation|simplification|summary|rewrite|rephrasing';
const TASK_OBJECT = String.raw`(?:with\s+|on\s+)?(?:(?:translat|simplify|summari[sz]|rewrit|rephras)ing\s+)?`
  + String.raw`(?:(?:this|that|these|those)\b|it[,.!]?\s*$|(?:(?:a|an|the|this|that|these|those|your|any)\s+)?(?:${TASK_NOUN})\b)`;
const APOLOGY = String.raw`unfortunately|sorry|i(?:['’]m| am) sorry|i apologi[sz]e|as an ai(?: language model| assistant| model)?`;
// "I" plus a negated modal: can't, cannot, could not, won't, will not.
const CANNOT = String.raw`i\s+(?:can(?:['’]t|not)|could(?:n['’]t|\s+not)|won['’]t|will\s+not)`;
// "I" plus a negated ability or permission: I am unable to, I'm not able to,
// I am not permitted to, I'm not allowed to, I do not have the ability to,
// I don't have permission to.
const UNABLE = String.raw`i(?:['’]m|\s+am)\s+(?:unable|not\s+(?:able|permitted|allowed))\s+to`
  + String.raw`|i\s+do(?:n['’]t|\s+not)\s+have\s+(?:the\s+)?(?:ability|permission)\s+to`;
const FIRST_PERSON_REFUSAL_RE = new RegExp(
  String.raw`^(?:(?:${APOLOGY})\b[,\s]*(?:but\s+)?)*`
  + String.raw`(?:i(?:['’]m| am) sorry[,.!]?\s*$`
  + String.raw`|(?:${CANNOT})(?:\s+(?:${REFUSAL_VERBS}))?[,.!]?\s*$`
  + String.raw`|(?:${UNABLE})\s+(?:${REFUSAL_VERBS})\b`
  + String.raw`|i do(?:n['’]t| not) know\s+(?:what|which|the|this|that|enough)\b`
  + String.raw`|(?:${CANNOT})\s+(?:${REFUSAL_VERBS})\s+${TASK_OBJECT})`,
  'i',
);

export function opensWithFirstPersonRefusal(text) {
  if (typeof text !== 'string') return false;
  return FIRST_PERSON_REFUSAL_RE.test(text.trim());
}

// The same refusal in the passive voice: "This text cannot be summarized."
// The subject must be a task noun and the participle a task verb, so "The
// page cannot be printed" is content.
const PASSIVE_REFUSAL_RE = new RegExp(
  String.raw`^(?:(?:${APOLOGY})\b[,\s]*(?:but\s+)?)*`
  + String.raw`(?:this|that|the|your)\s+(?:${TASK_NOUN})\s+`
  + String.raw`(?:can(?:['’]t|not)|could(?:n['’]t|\s+not)|won['’]t|will\s+not)\s+be\s+`
  + String.raw`(?:translated|simplified|summari[sz]ed|rewritten|rephrased|restated|interpreted|rendered|processed)\b`,
  'i',
);

export function opensWithPassiveRefusal(text) {
  if (typeof text !== 'string') return false;
  return PASSIVE_REFUSAL_RE.test(text.trim());
}

// One layer of the wrapping a model adds to a short value despite the
// contract in ai.js: matching straight or curly quotes, ** or backticks, and
// a one- or two-word label ("Header: City", "Link text: Open the report").
// Only these shapes, and only once: '""City""' becomes '"City"', an unmatched
// quote is kept, and so is a colon with no space after it.
const WRAP_PAIRS = [['"', '"'], ["'", "'"], ['\u201c', '\u201d'], ['\u2018', '\u2019'], ['**', '**'], ['`', '`']];
const LABEL_PREFIX_RE = /^[A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?:\s+(?=\S)/;

// The value with one layer of the wrapping above removed, or unchanged when
// it carries none. A value that merely begins and ends with a delimiter is
// not a wrapped value: 'Read "Terms" and "Privacy"' opens and closes with a
// double quote, and stripping those would leave the inner quotes dangling.
// So the layer comes off only when what is inside carries no opener of its
// own, or is itself wrapped the same way ('""City""' is the second case).
function unwrapOnce(value) {
  for (const [open, close] of WRAP_PAIRS) {
    if (value.length < open.length + close.length) continue;
    if (!value.startsWith(open) || !value.endsWith(close)) continue;
    const inner = value.slice(open.length, value.length - close.length);
    const nested = inner.startsWith(open) && inner.endsWith(close);
    if (inner.includes(open) && !nested) continue;
    return inner.trim();
  }
  return value;
}

// The value as it should reach an attribute or a header cell: trimmed, with
// the wrapping above removed. Anything that is not a string comes back as
// it is, so rejectShortText() can report it.
export function cleanShortText(text) {
  if (typeof text !== 'string') return text;
  let t = unwrapOnce(text.trim());
  const unlabeled = t.replace(LABEL_PREFIX_RE, '');
  if (unlabeled !== t) {
    // "Header: "City"" wraps the value after the label; unwrap that too.
    t = unwrapOnce(unlabeled);
  }
  return t;
}

// A first-person non-answer, in a value that is on its way to an attribute
// or a header cell. The passage gate cannot use these openings, because in a
// paragraph they are ordinary content ("I'm not sure I agree with that",
// "I do not know why he left"). In a value of at most 60 characters that
// becomes a link's accessible name or a column header, they are the model
// saying it could not answer. "I don't know" is already covered by
// UNCERTAINTY_TERMS; this adds the spelled-out and the "not sure" forms.
// FLAG(review): a real name that opens this way ("I Do Not Know Where I Am",
// a record on No Idea Records) is rejected, and the element is left as it
// was, which is the same place a null answer leaves it.
const SHORT_NON_ANSWER_RE = /^(?:i(?:'m| am) not sure|i do not know|(?:i have )?no idea)\b/i;

// Gate for a short, single-line value that lands in an attribute or a header
// cell (fix-links aria-label, fix-tables <th>). The value is judged after
// cleanShortText(), so an adapter should write the cleaned value.
export function rejectShortText(text, maxChars = MAX_SHORT_TEXT_CHARS) {
  if (typeof text !== 'string') return 'not a string';
  const t = cleanShortText(text);
  if (!t) return 'empty';
  if (t.length > maxChars) return `longer than ${maxChars} characters`;
  if (/[\r\n]/.test(t)) return 'contains a line break';
  if (startsWithRefusal(t)) return 'reads as a refusal';
  // The passage gate's patterns too. They catch the openers the lists above
  // miss ("As an AI, I cannot do this", "I apologize, but I cannot",
  // "I could not determine this"), and they are anchored, so they do not
  // widen the lists that generate-alt.js and generate-labels.js share.
  if (opensWithFirstPersonRefusal(t) || opensWithPassiveRefusal(t)) return 'reads as a refusal';
  if (SHORT_NON_ANSWER_RE.test(straightenApostrophes(t))) return 'reads as a refusal';
  if (containsUncertainty(t)) return 'reads as uncertain';
  return null;
}

// Shortest input (trimmed) that a length ratio is judged against. A block of
// a few characters has no useful ratio: "目录" to "Table of contents" is 8.5
// times the source and a correct translation. Below this the ratio checks
// are skipped and only the shape checks run; a paragraph that comes back at
// five times its length is still caught.
export const RATIO_MIN_INPUT_CHARS = 16;

// Gate for a rewrite that replaces or stands in for a passage (simplify,
// translate, summarize). Length is judged against the input as a ratio,
// because the right length depends on the task: a simplification is a bit
// shorter, a translation into another script can be much shorter or longer,
// a summary is short by design. Each adapter passes the band that fits it.
// Newlines are allowed: this is passage text, not an attribute. minChars is
// an absolute floor for a task that has no ratio floor: a summary is short
// by design, but "Ok." is not a summary.
export function rejectRewrite(output, input, { minRatio = 0, maxRatio = Infinity, minChars = 0 } = {}) {
  if (typeof output !== 'string') return 'not a string';
  const out = output.trim();
  if (!out) return 'empty';
  if (opensWithFirstPersonRefusal(out) || opensWithPassiveRefusal(out)) return 'reads as a refusal';
  if (out.length < minChars) return `shorter than ${minChars} characters`;
  const inLen = typeof input === 'string' ? input.trim().length : 0;
  if (inLen >= RATIO_MIN_INPUT_CHARS) {
    if (out.length < inLen * minRatio) return `shorter than ${minRatio} of the input`;
    if (out.length > inLen * maxRatio) return `longer than ${maxRatio} times the input`;
  }
  return null;
}
