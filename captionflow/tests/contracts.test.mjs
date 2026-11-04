import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTranscript, validatePreferences, validateProcessedCaptions, ContractError } from '../src/contracts.mjs';

const source = () => ({videoId:'vid-01',sourceLanguage:'en-KE',segments:[
  {id:'s1',start:0.5,end:2.2,text:'Some words'}, {id:'s2',start:2.4,end:4,text:'More words'}
]});

test('normalizes language tags and keeps timings', () => {
  const t = validateTranscript(source());
  assert.equal(t.sourceLanguage, 'en');
  assert.equal(t.segments[0].language, 'en');
  assert.equal(t.segments[0].start, 0.5);
});
test('rejects invalid time ranges', () => {
  const t = source(); t.segments[0].end = 0.5;
  assert.throws(() => validateTranscript(t), /end: must be greater than start/);
});
test('rejects negative or nonfinite timestamps', () => {
  const t = source(); t.segments[0].start = -1;
  assert.throws(() => validateTranscript(t), /start: must be a nonnegative/);
  t.segments[0].start = Number.NaN;
  assert.throws(() => validateTranscript(t), /start: must be a nonnegative/);
});
test('rejects out-of-order segments', () => {
  const t = source(); t.segments[1].start = 0.3;
  assert.throws(() => validateTranscript(t), /ordered by start time/);
});
test('allows overlapping dialogue if start times are ordered', () => {
  const t = source(); t.segments[1].start = 1.9;
  assert.equal(validateTranscript(t).segments.length, 2);
});
test('rejects duplicate IDs and no-speech input', () => {
  const t = source(); t.segments[1].id = 's1';
  assert.throws(() => validateTranscript(t), /must be unique/);
  t.segments = [];
  assert.throws(() => validateTranscript(t), /no speech/);
});
test('defaults preferences to the transcript language and allows Swahili', () => {
  const p = validatePreferences({mode:'plain'}, 'sw');
  assert.equal(p.captionLanguage,'sw');
  assert.equal(p.paceMode,'normal');
});
test('rejects invalid preference values and unknown keys', () => {
  assert.throws(() => validatePreferences({fontScale:8}), /between 0.8 and 2.5/);
  assert.throws(() => validatePreferences({autoReadSecretly:true}), /unsupported key/);
  assert.throws(() => validatePreferences({captionLanguage:'zz'}), /supports en and sw/);
});
test('does not allow processor to change timing, original text or count', () => {
  const t = validateTranscript(source());
  const cues = t.segments.map(s=>({id:s.id,start:s.start,end:s.end,originalText:s.text,displayText:s.text,language:s.language,mode:'original',status:'ready'}));
  assert.equal(validateProcessedCaptions(cues,t).length,2);
  cues[0].start = 0.6;
  assert.throws(() => validateProcessedCaptions(cues,t),/preserve source timing/);
  cues[0].start = 0.5;
  cues[0].originalText = 'changed';
  assert.throws(() => validateProcessedCaptions(cues,t),/preserve source text/);
  assert.throws(() => validateProcessedCaptions(cues.slice(1),t),/one output per input/);
});
test('cannot label translated text as ready original', () => {
  const t = validateTranscript(source());
  const cues = t.segments.map(s=>({id:s.id,start:s.start,end:s.end,originalText:s.text,displayText:'Tafsiri',language:'sw',mode:'original',status:'ready'}));
  assert.throws(() => validateProcessedCaptions(cues,t),/must not claim a translated/);
});
test('uses specialized contract errors', () => {
  assert.throws(() => validateTranscript({}), ContractError);
});
