// AI Provider Abstraction
// Adapters call these functions; the provider is set by extension or CLI.
//
// ---------------------------------------------------------------------------
// The provider contract
//
// The host supplies transport: which model, whose key, how the call is made.
// The toolkit owns the meaning: what each function is for, what a good answer
// looks like, and what happens to it. This file is the contract a host author
// implements from. It does not carry prompts; a host writes its own from the
// description of each function below.
//
// Rules that apply to every function:
//
// - Return plain text unless the function says otherwise. No quotes around
//   the answer, no preamble ("Here is the alt text:"), no notes after it, no
//   markdown.
// - When the model cannot answer, return null. Never return a refusal or an
//   apology as the answer. The adapters treat null as "leave the element
//   alone", and most of them also run the answer through a gate that drops
//   anything that reads as a refusal (tools/utils/ai-output.js), but a
//   refusal that slips past the gate reaches a screen reader as if it were
//   the answer.
// - A thrown error is handled the same way as null by every adapter: the
//   element is left alone (or, for a panel the person opened, the panel
//   shows the same fixed sentence a null answer gets) and the error is
//   logged to the console. The error's text never reaches the page: a host's
//   message can carry internal detail, and a panel is read aloud.
// - Answer in the language of the input unless the function says otherwise.
// - Keep the reader in mind: these answers are read aloud by a screen
//   reader, shown as a tooltip, or put in place of the text a person came to
//   read. None of them are seen by the model's usual audience.
//
// "Required" below means the toolkit throws when the provider lacks the
// function, because the adapter has no fallback. "Optional" means the
// toolkit returns null and the adapter skips that enhancement.
// ---------------------------------------------------------------------------

let provider = null;

export function setAIProvider(p) {
  provider = p;
}

export function getAIProvider() {
  return provider;
}

/**
 * Describe an image for a person who cannot see it. Required.
 *
 * Input: `imageData`, a data URL (PNG, JPEG, or SVG) of the image, canvas,
 * or inline SVG.
 *
 * A good result is one or two sentences, up to 300 characters, that say what
 * the image shows: the subject, the action, any text in the image, and the
 * detail a reader needs to follow the page. Neutral register. No "image of"
 * or "picture of", because the screen reader already announces the role.
 *
 * Return null when the image cannot be made out. Never a sentence saying so.
 *
 * Consumed by generate-alt.js (alt on <img>, aria-label on <canvas>, <title>
 * in an inline <svg>) and describe-on-demand.js (a panel the person opens).
 * generate-alt.js gates the answer with isConfidentDescription(): 3 to 300
 * characters, not a bare generic word ("image", "photo"), not opening with
 * a refusal, not containing an uncertainty term. describe-on-demand.js shows
 * the answer as it is, on request.
 */
export async function describeImage(imageData) {
  if (!provider?.describeImage) {
    throw new Error('AI provider not set or missing describeImage');
  }
  return provider.describeImage(imageData);
}

/**
 * Describe a video from sampled frames. Required.
 *
 * Input: `frames`, an array of JPEG data URLs sampled across the video
 * (generate-alt.js samples 6; an entry can be null when a frame could not
 * be captured); `metadata`, an optional object such as { duration, title }.
 * No adapter passes metadata at present.
 *
 * A good result is the same shape as describeImage: one or two sentences,
 * up to 300 characters, saying what the video shows and what happens in it.
 *
 * Return null when the frames cannot be made out.
 *
 * Consumed by generate-alt.js, which writes it to aria-label on the <video>
 * after the same isConfidentDescription() gate as describeImage.
 */
export async function describeVideo(frames, metadata = {}) {
  if (!provider?.describeVideo) {
    throw new Error('AI provider not set or missing describeVideo');
  }
  return provider.describeVideo(frames, metadata);
}

/**
 * Rewrite a passage in plain language for an adult reader. Required.
 *
 * Input: `text`, the visible prose of one element (its text content with
 * style, script, noscript, template, hidden and aria-hidden children left
 * out), trimmed, between 100 and 10,000 characters. `options` is reserved;
 * no adapter passes any at present.
 *
 * The standard is adult plain language. The reader is an adult. Keep every
 * idea and every nuance of the original; simplify the sentence structure and
 * the vocabulary, not the concepts. Short sentences, common words, active
 * voice, one idea per sentence. Keep the order of ideas, the paragraph
 * breaks, names, numbers, and dates. Do not add explanation, do not drop
 * detail, do not change the register to one meant for a child.
 *
 * A good result is a little shorter than the input, or about the same
 * length. A result under a third of the input has dropped ideas; a result
 * over twice the input has added something that was not there.
 *
 * Return null when the text cannot be simplified, including when it is
 * already plain. Never a sentence saying so.
 *
 * Consumed by simplify-text.js, which puts the result in place of the visible
 * text (the original stays in the DOM behind a "Show original" toggle). The
 * answer is gated with rejectRewrite(): a string, not empty, not opening
 * with a first-person refusal, and between 0.3 and 2 times the length of the
 * input. A rejected answer leaves the element as it was.
 */
export async function simplifyText(text, options = {}) {
  if (!provider?.simplifyText) {
    throw new Error('AI provider not set or missing simplifyText');
  }
  return provider.simplifyText(text, options);
}

/**
 * Generate an accessible name for an interactive element. Required.
 *
 * Input: `context`, an object such as { elementType, html, context } (see
 * docs/API.md). No adapter under tools/ calls this at present; hosts that
 * wire it should treat it like inferLabel, and the same gate applies.
 */
export async function generateLabels(context) {
  if (!provider?.generateLabels) {
    throw new Error('AI provider not set or missing generateLabels');
  }
  return provider.generateLabels(context);
}

/**
 * Summarize a long passage. Required.
 *
 * Input: `text`, either the first 3,000 characters of an element's visible
 * prose (simplify-text.js, same definition as simplifyText) or the whole
 * text of an element longer than 60 characters (describe-on-demand.js).
 *
 * A good result is two or three sentences, main point first, in the language
 * of the input, that a reader can use to decide whether to read the whole
 * passage. Neutral register. No "This text is about".
 *
 * Return null when there is nothing to summarize.
 *
 * Consumed by simplify-text.js, which inserts the result in a labeled
 * "Summary" region before the content, and by describe-on-demand.js, which
 * shows it in a panel. simplify-text.js gates the answer with
 * rejectRewrite(): a string, at least 20 characters, not opening with a
 * refusal (the shared prefixes as well as the first-person and passive
 * forms), and not longer than the text it summarizes. There is no ratio
 * floor: a summary is short by design.
 */
export async function summarizeText(text) {
  if (!provider?.summarizeText) {
    throw new Error('AI provider not set or missing summarizeText');
  }
  return provider.summarizeText(text);
}

/**
 * Infer an accessible name for a link or button that has none. Required.
 *
 * Input: `context`, an object { elementType, html, context } where
 * elementType is 'link' or 'button', html is the first 500 characters of the
 * element's outerHTML, and context is the visible text, the href, and the
 * surrounding text joined with " | ".
 *
 * A good result is one to five words that name what the control does or
 * where it goes ("Search", "Open the pricing page"). No "button" or "link"
 * at the end: the screen reader announces the role. No trailing punctuation.
 *
 * Return null when the purpose cannot be told from the inputs.
 *
 * Consumed by generate-labels.js, which writes it to aria-label after the
 * isValidLabel() gate: 1 to 60 characters, no line break, not matching the
 * shared refusal pattern (REFUSAL_RE in tools/utils/ai-output.js).
 */
export async function inferLabel(context) {
  if (!provider?.inferLabel) {
    throw new Error('AI provider not set or missing inferLabel');
  }
  return provider.inferLabel(context);
}

/**
 * Suggest a text color with enough contrast. Optional.
 *
 * Input: `foreground` and `background`, CSS color strings.
 *
 * A good result is a single CSS hex color ("#1a2b3c") that meets WCAG AA
 * (4.5:1 for normal text) against the background and stays close to the
 * original hue. Nothing but the color.
 *
 * Return null when no such color can be suggested; fix-contrast.js then
 * computes the nearest accessible color itself.
 *
 * Consumed by fix-contrast.js, which assigns the result to the element's
 * inline color. It is used as it is once it is not null, so a host must make
 * sure it is a color and nothing else.
 * FLAG(review): not gated by the adapter. Outside the scope of #31 item 3.
 */
export async function fixContrast(foreground, background) {
  if (!provider?.fixContrast) {
    return null; // Fallback handled by caller
  }
  return provider.fixContrast(foreground, background);
}

/**
 * Fetch the captions YouTube already has for a video. Optional.
 *
 * Input: `videoId`, the YouTube video id.
 *
 * A good result is the transcript as plain text. Return null when there is
 * none. Consumed by auto-transcriber.js, which shows it in its caption box.
 */
export async function getYouTubeTranscript(videoId) {
  if (!provider?.getYouTubeTranscript) {
    return null;
  }
  return provider.getYouTubeTranscript(videoId);
}

/**
 * Announce a message to a screen reader user. Optional.
 *
 * Input: `message`, a short plain sentence. The extension routes it to a live
 * region; the CLI may skip it. Adapters call this to report what they did
 * ("Translated 12 passages to Spanish"), never to ask a question.
 */
export function announce(message) {
  if (provider?.announce) {
    provider.announce(message);
  }
}

/**
 * Transcribe a video. Optional.
 *
 * Input: `videoUrl`, the media source URL.
 *
 * A good result is an object { type, text } where text is the transcript,
 * an audio description, or a marker that the track is silent. Return null
 * when the media cannot be transcribed. Consumed by generate-captions.js,
 * which adds the text as a caption track on the <video>. Only result.text is
 * read, and a result without it is treated as null.
 */
export async function transcribeVideo(videoUrl) {
  if (!provider?.transcribeVideo) {
    return null;
  }
  return provider.transcribeVideo(videoUrl);
}

/**
 * Transcribe an audio element. Optional.
 *
 * Same shape as transcribeVideo. Consumed by generate-captions.js, which
 * inserts the text as a transcript block after the <audio>.
 */
export async function transcribeAudio(audioUrl) {
  if (!provider?.transcribeAudio) {
    return null;
  }
  return provider.transcribeAudio(audioUrl);
}

/**
 * Describe an element from a screenshot, with its type as a hint. Optional.
 *
 * Input: `imageData`, a data URL; `elementType`, such as 'canvas', 'svg', or
 * 'chart'; `context`, text near the element.
 *
 * A good result has the shape of describeImage. No adapter under tools/
 * calls this at present; the CLI wires it for hosts that do.
 */
export async function describeElement(imageData, elementType = 'canvas', context = '') {
  if (!provider?.describeElement) {
    return null;
  }
  return provider.describeElement(imageData, elementType, context);
}

/**
 * Give an ambiguous link ("click here", "read more") a descriptive name.
 * Optional.
 *
 * Input: `linkText`, the link's visible text, trimmed; `href`, the absolute
 * URL; `context`, up to 200 characters of the enclosing paragraph, list
 * item, cell, article, or section.
 *
 * A good result is two to six words that say where the link goes or what it
 * opens ("Open the Q3 report", "Read the pricing details"), taken from the
 * context and the URL. No "link" at the end, no trailing punctuation, one
 * line.
 *
 * Return null when the destination cannot be told from the inputs.
 *
 * Consumed by fix-links.js, which writes it to aria-label and leaves the
 * visible text as it is. The answer is gated with rejectShortText(): a
 * string, 1 to 60 characters after trimming, no line break, not opening with
 * a refusal, not containing an uncertainty term. It must also differ from the
 * visible text, or nothing is set. A rejected answer leaves the link alone.
 * As a backstop, one layer of quotes, ** or backticks, and a one- or
 * two-word label ("Link text: ...") are stripped before the check and the
 * cleaned value is what gets written; the rule above still stands.
 */
export async function improveLinkText(linkText, href, context) {
  if (!provider?.improveLinkText) {
    return null;
  }
  return provider.improveLinkText(linkText, href, context);
}

/**
 * Name a table column from sample values. Optional.
 *
 * Input: `sampleData`, an array of two to five non-empty cell strings from
 * one column, taken from the first rows of a table that has no header row.
 *
 * A good result is one to three words that name what the values are
 * ("City", "Unit price", "Order date"), on one line, in the register of the
 * page.
 *
 * Return null when the samples do not point to one clear meaning. The
 * adapter then writes "Column N", which is honest and still gives the
 * screen reader something to announce.
 *
 * Consumed by fix-tables.js, which writes it into a generated
 * <th scope="col">. The answer is gated with rejectShortText() (see
 * improveLinkText); a rejected answer falls back to "Column N".
 */
export async function inferColumnHeader(sampleData) {
  if (!provider?.inferColumnHeader) {
    return null;
  }
  return provider.inferColumnHeader(sampleData);
}

/**
 * Translate one block of text into a named language. Optional.
 *
 * Input: `text`, the full text content of one leaf block (a paragraph,
 * heading, list item, cell, or similar), whitespace included; `targetLang`,
 * the language as a name ("Spanish").
 *
 * A good result is the whole block in the target language and nothing else:
 * same meaning, same tone, names, numbers, and dates kept. If the block is
 * already in the target language, return it unchanged.
 *
 * Return null when the block cannot be translated.
 *
 * Consumed by translate-page.js, which puts the result in place of the
 * block's content (the original nodes are kept and restored on disable).
 * The answer is gated with rejectRewrite(): a string, not empty, not opening
 * with a first-person refusal, and between 0.1 and 8 times the length of
 * the input, a band wide enough for English into Chinese or Japanese and
 * back, so it only catches a block that came back as almost nothing or as
 * several times the source. A block under 16 characters is not held to the
 * band. A rejected answer leaves the block untouched.
 */
export async function translateText(text, targetLang) {
  if (!provider?.translateText) {
    return null;
  }
  return provider.translateText(text, targetLang);
}

/**
 * Define a word or phrase as it is used in a sentence. Optional.
 *
 * Input: `word`, the selected word or phrase; `context`, the sentence or
 * sentences around it.
 *
 * A good result is one short sentence in plain words that gives the meaning
 * in this context, in the language of the input. No "X is a word that
 * means". No etymology.
 *
 * Return null when there is no useful definition.
 *
 * Consumed by define-words.js, which shows the result in a tooltip the
 * person asked for and shows nothing on null. It is not gated beyond that:
 * the tooltip is temporary and requested, so the stakes are lower.
 * FLAG(review): not gated by the adapter. Outside the scope of #31 item 3.
 */
export async function defineWord(word, context) {
  if (!provider?.defineWord) {
    return null;
  }
  return provider.defineWord(word, context);
}

/**
 * Pull a chart's underlying data out of an image of it. Optional.
 *
 * Input: `imageDataUrl`, a data URL of the chart's pixels; `context`, text
 * near the chart (caption, heading, nearby paragraph).
 *
 * The result is structured, not free text: { caption: string, headers:
 * string[], rows: string[][] } with each row aligned to the headers. Values
 * are strings as they would be read from the chart. When the image is not a
 * data chart, return { caption: '', headers: [], rows: [] }; return null when
 * the image cannot be read at all.
 *
 * Consumed by explore-a-chart.js, which renders the result as a data table
 * in a panel. It checks that headers and rows are arrays and otherwise shows
 * a message, so a model that answers in prose produces no table.
 */
export async function extractChartData(imageDataUrl, context) {
  if (!provider?.extractChartData) {
    return null;
  }
  return provider.extractChartData(imageDataUrl, context);
}
