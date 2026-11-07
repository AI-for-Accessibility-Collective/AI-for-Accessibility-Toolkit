import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLocalWhisperTranscriber } from '../src/providers/local-whisper.mjs';
import { createHostedTranscriber } from '../src/providers/hosted-asr.mjs';
import { createOriginalOnlyCaptionProcessor } from '../src/providers/original-captions.mjs';

const makeTranscript = videoId => ({ videoId, sourceLanguage: 'en', segments: [
  {id:'seg-0001',start:0,end:2,text:'Hello CaptionFlow.',language:'en'},
  {id:'seg-0002',start:2.2,end:4.3,text:'This is synced.',language:'en'},
]});

test('local provider uses argv not shell and validates transcript', async () => {
  let captured;
  const provider = createLocalWhisperTranscriber({ python:'/my/venv/bin/python', model:'base', runner:async (exe,args,opts)=>{
    captured={exe,args,opts};return {stdout:JSON.stringify(makeTranscript('clip-1'))};
  }});
  const result = await provider.transcribe({videoId:'clip-1',media:{kind:'local-file',path:'/tmp/clip.mp4',language:'en'}});
  assert.equal(result.segments.length,2);
  assert.equal(captured.exe,'/my/venv/bin/python');
  assert.match(captured.args[0], /[/\\]local_transcriber[/\\]transcribe_whisper\.py$/);
  assert.equal(captured.args[1],'/tmp/clip.mp4');
  assert.equal(captured.args[3],'en');
  assert.equal(captured.args[4],'base');
  assert.equal(captured.opts.maxBuffer,8*1024*1024);
});

test('local provider rejects unsupported media and corrupt or invalid ASR output', async () => {
  const local = createLocalWhisperTranscriber({runner:async()=>({stdout:'not-json'})});
  await assert.rejects(local.transcribe({videoId:'a',media:{kind:'fixture'}}),/local-file/);
  await assert.rejects(local.transcribe({videoId:'a',media:{kind:'local-file',path:'/tmp/a.mp4'}}),/valid transcript JSON/);
  const bad = createLocalWhisperTranscriber({runner:async()=>({stdout:JSON.stringify({videoId:'a',sourceLanguage:'en',segments:[]})})});
  await assert.rejects(bad.transcribe({videoId:'a',media:{kind:'local-file',path:'/tmp/a.mp4'}}),/no speech/);
  const failed = createLocalWhisperTranscriber({runner:async()=>{throw new Error('python not found');}});
  await assert.rejects(failed.transcribe({videoId:'a',media:{kind:'local-file',path:'/tmp/a.mp4'}}),/python not found/);
});

test('original processor preserves words and timings and flags unavailable transformations', async () => {
  const transcript = makeTranscript('demo');
  const process = createOriginalOnlyCaptionProcessor().process;
  const output = await process({transcript,preferences:{mode:'original',captionLanguage:'en'}});
  assert.equal(output.length,2);assert.equal(output[0].status,'ready');
  assert.equal(output[0].originalText,output[0].displayText);
  const plain = await process({transcript,preferences:{mode:'plain',captionLanguage:'en'}});
  assert.equal(plain[0].status,'fallback');assert.equal(plain[0].displayText,transcript.segments[0].text);
  const sw = await process({transcript,preferences:{mode:'original',captionLanguage:'sw'}});
  assert.equal(sw[0].status,'fallback');assert.equal(sw[0].language,'en');
});

test('hosted endpoint posts video with bearer token and validates timed transcript', async () => {
  const folder = await mkdtemp(join(tmpdir(),'captionflow-hosted-'));
  const path = join(folder,'clip.mp4');
  await writeFile(path,Buffer.from('testing-video'));
  const server = createServer(async (req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-token');
    assert.match(req.headers['content-type'],/multipart\/form-data/);
    let chunks=[];for await (const chunk of req)chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    assert.match(body,/name="videoId"/);assert.match(body,/clip-4/);
    assert.match(body,/filename="captionflow-upload.mp4"/);
    assert.match(body,/testing-video/);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(makeTranscript('clip-4')));
  });
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const provider = createHostedTranscriber({endpoint:`http://127.0.0.1:${server.address().port}`,token:'test-token'});
    const result = await provider.transcribe({videoId:'clip-4',media:{kind:'local-file',path,language:'en',contentType:'video/mp4'}});
    assert.equal(result.segments.length,2);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(folder,{recursive:true,force:true});
  }
});

test('hosted provider does not silently accept insecure nonloopback HTTP',()=>{
  assert.throws(()=>createHostedTranscriber({endpoint:'http://example.com/asr',token:'a'}),/HTTPS/);
  assert.throws(()=>createHostedTranscriber({endpoint:'https://example.com/asr'}),/TOKEN/);
});