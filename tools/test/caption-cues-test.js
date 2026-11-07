// Caption cues (CaptionFlow) — pure-function tests.
// Run: node tools/test/caption-cues-test.js
import { buildCues, layoutLines, sameWords, minCueSeconds, presentationSeconds, DCMP } from '../utils/caption-cues.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

const longSpeech = [
  { start: 0, end: 4, text: 'Welcome to the health update for this week.' },
  { start: 4, end: 9, text: 'Clinics across the county will open early on Saturday.' },
  { start: 9, end: 12, text: 'Thank you for listening, and stay safe.' },
];

// --- layoutLines ------------------------------------------------------------
{
  const lines = layoutLines('Thank you for listening.'.split(' '), 32);
  check('short sentence fits on one line', lines.length === 1);
}
{
  const words = 'Clinics across the county will open early on Saturday morning.'.split(' ');
  const lines = layoutLines(words, 32);
  check('long sentence splits into two lines', lines !== null && lines.length === 2);
  check('each line within 32 characters', lines.every((l) => l.length <= 32));
  check('no line starts or ends with lost words', lines.join(' ') === words.join(' '));
}
check('impossible to fit returns null', layoutLines(['a'.repeat(40)], 32) === null);

// --- buildCues: meaning is preserved ---------------------------------------
{
  const cues = buildCues(longSpeech);
  check('every word is shown, in order', sameWords(longSpeech, cues));
  check('no word is added', !sameWords([{ start: 0, end: 1, text: 'one two' }], [{ text: 'one two three' }]));
  check('a dropped word is caught', !sameWords([{ start: 0, end: 1, text: 'one two' }], [{ text: 'one' }]));
}

// --- buildCues: layout limits -----------------------------------------------
{
  const cues = buildCues(longSpeech);
  check('at most two lines per cue', cues.every((c) => c.lines.length <= DCMP.maxLines));
  check('no cue wider than 32 characters per line', cues.every((c) => c.lines.every((l) => l.length <= 32)));
  check('no cue runs past 6 seconds', cues.every((c) => c.endSeconds - c.startSeconds <= DCMP.maxSeconds + 0.001));
}

// --- buildCues: timing ------------------------------------------------------
{
  const cues = buildCues([{ start: 0, end: 0.4, text: 'Yes.' }, { start: 2, end: 5, text: 'Next line here.' }]);
  const first = cues[0];
  check('very short cue lasts at least 1 s 10 frames', first.endSeconds - first.startSeconds >= minCueSeconds() - 0.01);
  check('short cue is extended into the gap, not overlapping the next', first.endSeconds <= cues[1].startSeconds + 0.001);
}
check('minimum seconds at 30 fps is 1.333', Math.abs(minCueSeconds(30) - 1.3333) < 0.001);
check('minimum seconds at 25 fps is 1.4', Math.abs(minCueSeconds(25) - 1.4) < 0.001);
check('160 wpm: 16 words take 6 s', Math.abs(presentationSeconds(16, 160) - 6) < 1e-9);

{
  const fast = [
    { start: 0, end: 1, text: 'one two three four five six seven eight nine ten.' },
    { start: 1.2, end: 3, text: 'Next caption.' },
  ];
  const cues = buildCues(fast);
  check('a dense cue is marked tooFast when there is no time', cues[0].tooFast === true);
}

// --- buildCues: sentence boundaries -----------------------------------------
{
  const cues = buildCues(longSpeech);
  check('a cue ends at each sentence end', cues.some((c) => c.text.endsWith('week.')));
  check('a sentence end only ever closes a cue', cues.every((c) => {
    const words = c.text.split(' ');
    return words.slice(0, -1).every((w) => !/[.!?]$/.test(w));
  }));
}

// --- buildCues: input forms -------------------------------------------------
check('accepts a transcript object', sameWords({ segments: longSpeech }, buildCues({ segments: longSpeech })));
check('empty input gives no cues', buildCues([]).length === 0);

console.log(`caption-cues: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
