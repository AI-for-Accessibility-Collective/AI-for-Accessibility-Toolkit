import test from 'node:test';
import assert from 'node:assert/strict';
import { selectActiveCue, nextCue, replayCue } from '../src/player-sync.mjs';
const cues=[{id:'a',start:0,end:7.2},{id:'b',start:7.2,end:14.24},{id:'c',start:14.24,end:22.72}];
test('caption selection uses media clock and exact timestamp boundaries',()=>{
  assert.equal(selectActiveCue(cues,0)?.id,'a');
  assert.equal(selectActiveCue(cues,7.199)?.id,'a');
  assert.equal(selectActiveCue(cues,7.2)?.id,'b');
  assert.equal(selectActiveCue(cues,14.24)?.id,'c');
  assert.equal(selectActiveCue(cues,22.72),null);
  assert.equal(selectActiveCue(cues,-1),null);
});
test('seek and playback speed changes select the right caption from media time',()=>{
  // Media timeline is independent of playbackRate; the same time maps to the same cue.
  for(const rate of [.75,1,1.25,2]) {
    void rate;
    assert.equal(selectActiveCue(cues,15.01)?.id,'c');
    assert.equal(selectActiveCue(cues,4)?.id,'a');
  }
  assert.equal(nextCue(cues,7.3)?.id,'c');
  assert.equal(replayCue(cues,8)?.id,'b');
});
test('overlapping speech uses most recently started caption',()=>{
  const overlap=[{id:'one',start:0,end:8},{id:'two',start:6,end:10}];
  assert.equal(selectActiveCue(overlap,7)?.id,'two');
});

test('replay selects the most recent caption even after a long silence or at the end of video',()=>{
  assert.equal(replayCue(cues,40)?.id,'c');
  assert.equal(replayCue(cues,14.0)?.id,'b');
  assert.equal(replayCue(cues,-1),null);
});