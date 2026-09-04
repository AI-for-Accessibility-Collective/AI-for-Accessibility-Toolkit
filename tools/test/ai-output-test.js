// AI output gates: unit tests for tools/utils/ai-output.js, plus a pin on
// the two gates that existed before it (isConfidentDescription in
// generate-alt.js, isValidLabel in generate-labels.js). Those two now import
// their refusal lists from the shared module, and these cases exist so a
// change to the shared lists that alters either gate shows up here.
// Run: node tools/test/ai-output-test.js
import { JSDOM } from 'jsdom';

// generate-alt.js and generate-labels.js read DOM globals at call time only,
// but a window is cheap and keeps this file safe if that changes.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
global.window = dom.window;
global.document = dom.window.document;

const {
  REFUSAL_PREFIXES, UNCERTAINTY_TERMS, REFUSAL_RE,
  startsWithRefusal, containsUncertainty, opensWithFirstPersonRefusal,
  rejectShortText, rejectRewrite, MAX_SHORT_TEXT_CHARS,
} = await import('../utils/ai-output.js');
const { isConfidentDescription } = await import('../adapters/generate-alt.js');
const { isValidLabel } = await import('../adapters/generate-labels.js');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

// ── shared vocabulary ────────────────────────────────────────────────────────
check('lists: refusal prefixes are exported and non-empty', Array.isArray(REFUSAL_PREFIXES) && REFUSAL_PREFIXES.length > 0);
check('lists: uncertainty terms are exported and non-empty', Array.isArray(UNCERTAINTY_TERMS) && UNCERTAINTY_TERMS.length > 0);
check('lists: the label refusal regex is exported', REFUSAL_RE instanceof RegExp);

// ── startsWithRefusal ────────────────────────────────────────────────────────
check('refusal: "I cannot ..." is a refusal', startsWithRefusal('I cannot determine where this link goes'));
check('refusal: lowercase "sorry, ..." is a refusal', startsWithRefusal('sorry, I am not able to help with that'));
check('refusal: "Unfortunately ..." is a refusal', startsWithRefusal('Unfortunately I cannot see the image'));
check('refusal: "N/A" is a refusal', startsWithRefusal('N/A'));
check('refusal: "Unknown" is a refusal', startsWithRefusal('Unknown'));
check('refusal: leading whitespace does not hide a refusal', startsWithRefusal('   I am unable to read this'));
check('refusal: a plain label is not a refusal', !startsWithRefusal('Open the Q3 report'));
check('refusal: a refusal phrase later in the text does not count', !startsWithRefusal('The Q3 report, which I cannot recommend enough'));
check('refusal: a non-string is handled without throwing', startsWithRefusal(null) === false);

// ── containsUncertainty ──────────────────────────────────────────────────────
check('uncertainty: "unclear" anywhere counts', containsUncertainty('The destination is unclear'));
check('uncertainty: matching is case-insensitive', containsUncertainty('CANNOT DETERMINE'));
check('uncertainty: confident text passes', !containsUncertainty('Quarterly revenue by region'));

// ── opensWithFirstPersonRefusal ──────────────────────────────────────────────
check('passage refusal: "Unfortunately, I cannot translate this." is a refusal', opensWithFirstPersonRefusal('Unfortunately, I cannot translate this text.'));
check('passage refusal: "I\'m sorry, but I can\'t help with that." is a refusal', opensWithFirstPersonRefusal("I'm sorry, but I can't help with that."));
check('passage refusal: "Sorry, I am unable to simplify this." is a refusal', opensWithFirstPersonRefusal('Sorry, I am unable to simplify this passage. It contains no text.'));
check('passage refusal: "Unfortunately, the museum is closed on Mondays." is content', !opensWithFirstPersonRefusal('Unfortunately, the museum is closed on Mondays. It opens again on Tuesday at nine.'));
check('passage refusal: "Sorry, we could not find that page." is content', !opensWithFirstPersonRefusal('Sorry, we could not find that page. Try the search box.'));
check('passage refusal: only the opening sentence is judged', !opensWithFirstPersonRefusal('Unfortunately, the museum is closed. I cannot wait to go back.'));
check('passage refusal: "I can\'t wait to see you." is content', !opensWithFirstPersonRefusal("I can't wait to see you. The train gets in at six."));
check('passage refusal: "I cannot stress this enough." is content', !opensWithFirstPersonRefusal('I cannot stress this enough: read the manual first.'));
check('passage refusal: "I am unable to help with this request." is a refusal', opensWithFirstPersonRefusal('I am unable to help with this request.'));
check('passage refusal: "I don\'t know what this text says." is a refusal', opensWithFirstPersonRefusal("I don't know what this text says."));
check('passage refusal: a non-string is handled without throwing', opensWithFirstPersonRefusal(undefined) === false);
// Ordinary first-person openings that a looser pattern rejected.
check('passage refusal: "I have a dream ..." is content', !opensWithFirstPersonRefusal('I have a dream that one day this nation will rise up.'));
check('passage refusal: a quoted "I cannot go on" is content', !opensWithFirstPersonRefusal('"I cannot go on," she said. "Not tonight."'));
check('passage refusal: "I can\'t help but think ..." is content', !opensWithFirstPersonRefusal("I can't help but think the plan was wrong from the start."));
check('passage refusal: "I can\'t see why ..." is content', !opensWithFirstPersonRefusal("I can't see why anyone would object to the new rule."));
check('passage refusal: "I\'m sorry for your loss." is content', !opensWithFirstPersonRefusal("I'm sorry for your loss."));
check('passage refusal: "I am not able to attend ..." is content', !opensWithFirstPersonRefusal('I am not able to attend the meeting on Friday.'));
check('passage refusal: "I\'m unable to sleep ..." is content', !opensWithFirstPersonRefusal("I'm unable to sleep most nights, and the doctors have no answer."));
check('passage refusal: "I don\'t know why, but ..." is content', !opensWithFirstPersonRefusal("I don't know why, but the results improved after the change."));
check('passage refusal: "I can\'t read without my glasses" is content', !opensWithFirstPersonRefusal("I can't read without my glasses anymore."));
// Refusal phrasings that a looser pattern missed.
check('passage refusal: "I\'m sorry." alone is a refusal', opensWithFirstPersonRefusal("I'm sorry."));
check('passage refusal: "I can\'t." alone is a refusal', opensWithFirstPersonRefusal("I can't."));
check('passage refusal: "I cannot translate." alone is a refusal', opensWithFirstPersonRefusal('I cannot translate.'));
check('passage refusal: "As an AI language model, I cannot ..." is a refusal', opensWithFirstPersonRefusal('As an AI language model, I cannot translate this.'));
check('passage refusal: "I apologize, but I cannot simplify this text." is a refusal', opensWithFirstPersonRefusal('I apologize, but I cannot simplify this text.'));
check('passage refusal: "I cannot provide a translation ..." is a refusal', opensWithFirstPersonRefusal('I cannot provide a translation of this content.'));
check('passage refusal: "I cannot restate this passage." is a refusal', opensWithFirstPersonRefusal('I cannot restate this passage.'));
check('passage refusal: "I can\'t assist with translating this." is a refusal', opensWithFirstPersonRefusal("I can't assist with translating this."));
check('passage refusal: a curly apostrophe still reads as a refusal', opensWithFirstPersonRefusal('I can\u2019t help with that request.'));
// Negations and verbs the first pattern did not cover.
check('passage refusal: "I won\'t translate this passage" is a refusal', opensWithFirstPersonRefusal("I won't translate this passage."));
check('passage refusal: "I could not simplify this text" is a refusal', opensWithFirstPersonRefusal('I could not simplify this text.'));
check('passage refusal: "I am not permitted to translate this content" is a refusal', opensWithFirstPersonRefusal('I am not permitted to translate this content.'));
check('passage refusal: "I cannot summarise this text" is a refusal', opensWithFirstPersonRefusal('I cannot summarise this text.'));
check('passage refusal: "I can\'t make out the content" is a refusal', opensWithFirstPersonRefusal("I can't make out the content."));
check('passage refusal: "I cannot render this" is a refusal', opensWithFirstPersonRefusal('I cannot render this.'));
check('passage refusal: "I will not interpret this passage" is a refusal', opensWithFirstPersonRefusal('I will not interpret this passage for you.'));
check('passage refusal: "I do not have the ability to translate this" is a refusal', opensWithFirstPersonRefusal('I do not have the ability to translate this text.'));
check('passage refusal: "I\'m not allowed to summarize this content" is a refusal', opensWithFirstPersonRefusal("I'm not allowed to summarize this content."));
check('passage refusal: "I couldn\'t care less" is content', !opensWithFirstPersonRefusal("I couldn't care less what the committee decides."));
check('passage refusal: "I won\'t be there" is content', !opensWithFirstPersonRefusal("I won't be there on Friday, so send the notes."));

// ── rejectShortText (aria-label, <th>) ───────────────────────────────────────
check('short: the default cap is 60 characters', MAX_SHORT_TEXT_CHARS === 60);
check('short: a good label passes', rejectShortText('Open the Q3 report') === null);
check('short: a number is rejected as not a string', rejectShortText(42) === 'not a string');
check('short: null is rejected as not a string', rejectShortText(null) === 'not a string');
check('short: an object is rejected as not a string', rejectShortText({ text: 'x' }) === 'not a string');
check('short: an empty string is rejected', rejectShortText('') === 'empty');
check('short: whitespace only is rejected as empty', rejectShortText('   \n ') === 'empty');
check('short: exactly 60 characters passes', rejectShortText('a'.repeat(60)) === null);
check('short: 61 characters is rejected as too long', rejectShortText('a'.repeat(61)) === 'longer than 60 characters');
check('short: a custom cap is honored', rejectShortText('a'.repeat(20), 10) === 'longer than 10 characters');
check('short: an embedded newline is rejected', rejectShortText('Open\nreport') === 'contains a line break');
check('short: a carriage return is rejected', rejectShortText('Open\rreport') === 'contains a line break');
check('short: surrounding whitespace is not a line break', rejectShortText('  Open report\n') === null);
check('short: a refusal is rejected', rejectShortText('I cannot determine where this link goes') === 'reads as a refusal');
check('short: "n/a" is rejected as a refusal', rejectShortText('n/a') === 'reads as a refusal');
check('short: a hedge is rejected as uncertain', rejectShortText('Unclear destination') === 'reads as uncertain');
check('short: type is checked before length', rejectShortText(['a']) === 'not a string');

// ── rejectRewrite (simplify, translate, summarize) ───────────────────────────
const INPUT = 'The aforementioned regulations shall be deemed applicable to all parties who have executed the agreement. '.repeat(3); // 318 chars
check('rewrite: a shorter but faithful rewrite passes', rejectRewrite('These rules apply to everyone who signed the agreement. '.repeat(3), INPUT, { minRatio: 0.3, maxRatio: 2 }) === null);
check('rewrite: a number is rejected as not a string', rejectRewrite(7, INPUT) === 'not a string');
check('rewrite: null is rejected as not a string', rejectRewrite(null, INPUT) === 'not a string');
check('rewrite: whitespace only is rejected as empty', rejectRewrite('  \n\t ', INPUT) === 'empty');
check('rewrite: a first-person refusal is rejected', rejectRewrite('I cannot simplify this text because it is already simple.', INPUT) === 'reads as a refusal');
check('rewrite: "Sorry, I can\'t translate that." is rejected', rejectRewrite("Sorry, I can't translate that.", INPUT) === 'reads as a refusal');
check('rewrite: a passage that opens "Unfortunately, the ..." passes', rejectRewrite('Unfortunately, the rules apply to everyone who signed. '.repeat(3), INPUT) === null);
check('rewrite: a fragment under the ratio is rejected', rejectRewrite('These rules apply.', INPUT, { minRatio: 0.3 }) === 'shorter than 0.3 of the input');
check('rewrite: exactly the ratio passes', rejectRewrite('x'.repeat(Math.ceil(INPUT.trim().length * 0.3)), INPUT, { minRatio: 0.3 }) === null);
check('rewrite: with no minRatio a very short output passes', rejectRewrite('Short.', INPUT) === null);
check('rewrite: output over the ratio is rejected', rejectRewrite('y'.repeat(INPUT.length * 2 + 1), INPUT, { maxRatio: 2 }) === 'longer than 2 times the input');
check('rewrite: with no maxRatio a long output passes', rejectRewrite('y'.repeat(INPUT.length * 5), INPUT) === null);
check('rewrite: a non-string input skips the ratio checks', rejectRewrite('Anything.', undefined, { minRatio: 0.5 }) === null);
check('rewrite: newlines inside a passage are allowed', rejectRewrite('One line.\nTwo lines.\nThree lines of plain text here. '.repeat(3), INPUT, { minRatio: 0.3 }) === null);

// ── pins on the two pre-existing gates ───────────────────────────────────────
check('alt gate: a real description passes', isConfidentDescription('A red bicycle leaning against a brick wall.'));
check('alt gate: a bare "image" is junk', !isConfidentDescription('image'));
check('alt gate: "I cannot describe this image" is a refusal', !isConfidentDescription('I cannot describe this image'));
check('alt gate: "Sorry, ..." is a refusal', !isConfidentDescription('Sorry, no description is available'));
check('alt gate: a hedge anywhere fails', !isConfidentDescription('A photo whose subject is unclear'));
check('alt gate: under 3 characters fails', !isConfidentDescription('ab'));
check('alt gate: over 300 characters fails', !isConfidentDescription('a'.repeat(301)));
check('alt gate: exactly 300 characters passes', isConfidentDescription('a'.repeat(300)));
check('alt gate: a non-string fails', !isConfidentDescription(42));
check('alt gate: prefix matching is case-sensitive (unchanged behavior)', isConfidentDescription('sorry excuse for a bicycle, rusted and leaning on a wall'));

check('label gate: a real label passes', isValidLabel('Search'));
check('label gate: "n/a" fails', !isValidLabel('n/a'));
check('label gate: "Unknown" fails', !isValidLabel('Unknown'));
check('label gate: "I don\'t know" fails', !isValidLabel("I don't know"));
check('label gate: lowercase "sorry" fails', !isValidLabel('sorry, no idea'));
check('label gate: a newline fails', !isValidLabel('Search\nbox'));
check('label gate: 61 characters fails', !isValidLabel('a'.repeat(61)));
check('label gate: 60 characters passes', isValidLabel('a'.repeat(60)));
check('label gate: empty fails', !isValidLabel(''));
check('label gate: a non-string fails', !isValidLabel(null));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
