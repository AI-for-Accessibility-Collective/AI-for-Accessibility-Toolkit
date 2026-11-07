import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionFlowPipeline, PipelineError } from '../src/pipeline.mjs';
import { createFixtureTranscriber } from '../src/mocks/fixture-transcriber.mjs';
import { createFixtureCaptionProcessor } from '../src/mocks/fixture-caption-processor.mjs';
import { createFixturePreferenceProvider } from '../src/mocks/fixture-preferences.mjs';

const transcriber = createFixtureTranscriber({ fileUrl: new URL('../fixtures/notice.transcript.json', import.meta.url) });
const captionProcessor = createFixtureCaptionProcessor({ fileUrl: new URL('../fixtures/notice.variants.json', import.meta.url) });
const make = p => createCaptionFlowPipeline({ transcriber, captionProcessor, preferenceProvider:createFixturePreferenceProvider(p) });
const request = {videoId:'fictional-notice-001',media:{kind:'fixture'}};

test('mock pipeline provides complete player-ready output', async () => {
  const r = await make({mode:'plain',fontScale:1.3,paceMode:'slow'}).run(request);
  assert.equal(r.captions.length,3);
  assert.equal(r.captions[0].originalText, r.transcript.segments[0].text);
  assert.notEqual(r.captions[0].displayText, r.captions[0].originalText);
  assert.equal(r.captions[0].status, 'needs-review');
  assert.equal(r.preferences.paceMode,'slow');
  assert.equal(r.warnings.length,3);
});
test('original captions require no AI or transformation', async () => {
  const r = await make({mode:'original'}).run(request);
  assert.deepEqual(r.captions.map(c=>c.status), ['ready','ready','ready']);
  assert.equal(r.warnings.length,0);
  assert.equal(r.captions[0].displayText,r.captions[0].originalText);
});
test('Swahili variants are explicitly marked unreviewed', async () => {
  const r = await make({captionLanguage:'sw',mode:'plain'}).run(request);
  assert.equal(r.captions[0].language,'sw');
  assert.equal(r.captions[0].status,'needs-review');
});
test('unavailable translation falls back without false language claim', async () => {
  const proc = {async process({transcript}) { return transcript.segments.map(s=>({
    id:s.id,start:s.start,end:s.end,originalText:s.text,displayText:s.text,language:s.language,mode:'original',status:'fallback'
  })); }};
  const p = createCaptionFlowPipeline({transcriber,captionProcessor:proc, preferenceProvider:createFixturePreferenceProvider({captionLanguage:'sw'})});
  const r = await p.run(request);
  assert.equal(r.captions[0].language, 'en');
  assert.equal(r.captions[0].status, 'fallback');
  assert.ok(r.warnings.length);
});
test('provider exceptions identify the failed stage', async () => {
  const p = createCaptionFlowPipeline({transcriber:{async transcribe(){throw new Error('offline');}},
    captionProcessor,preferenceProvider:createFixturePreferenceProvider()});
  await assert.rejects(p.run(request),e=>e instanceof PipelineError && e.stage==='transcription' && /offline/.test(e.message));
});
test('invalid provider transcript is rejected at transcription stage', async () => {
  const p = createCaptionFlowPipeline({transcriber:{async transcribe(){return {videoId:request.videoId,sourceLanguage:'en',segments:[]};}},
    captionProcessor,preferenceProvider:createFixturePreferenceProvider()});
  await assert.rejects(p.run(request),e=>e instanceof PipelineError && e.stage==='transcription');
});
test('processor cannot secretly retime caption', async () => {
  const p = createCaptionFlowPipeline({transcriber,captionProcessor:{async process({transcript}){return transcript.segments.map(s=>({
    id:s.id,start:s.start+1,end:s.end,originalText:s.text,displayText:s.text,language:'en',mode:'original',status:'ready'
  }));}},preferenceProvider:createFixturePreferenceProvider()});
  await assert.rejects(p.run(request),e=>e instanceof PipelineError && e.stage==='caption processing' && /timing/.test(e.message));
});
test('missing dependencies fail early', () => {
  assert.throws(()=>createCaptionFlowPipeline({}),/transcriber/);
});
test('fixture transcriber rejects non-fixture media', async () => {
  await assert.rejects(make().run({videoId:request.videoId,media:{kind:'url',url:'https://example.com/a.mp4'}}),
    e=>e instanceof PipelineError && e.stage==='transcription');
});
