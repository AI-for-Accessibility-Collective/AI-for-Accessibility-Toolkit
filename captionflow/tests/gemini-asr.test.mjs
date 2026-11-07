import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiGenerateContentUrl, createGeminiHostedTranscriber, parseGeminiTranscript } from '../src/providers/gemini-asr.mjs';
import { createConfiguredHostedTranscriber } from '../src/providers/hosted-asr.mjs';

const BASE='https://ai4a11y.lovable.app/api/public/gemini';
const RESULT = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
  sourceLanguage: 'en', segments: [
    {start: 0, end: 2.4, text: 'A public health message.', language: 'en'},
    {start: 2.4, end: 4.7, text: 'Please take note.', language: 'en'},
  ],
}) }] }}] };

const opts = {
  protocol: 'gemini', endpoint: BASE, model: 'gemini-3.8-flash', token: 'fake-secret',
  mediaStat: async()=>({size:12}), readMedia: async()=>Buffer.from('test-video'),
};
const media = {kind:'local-file',path:'/tmp/sample.mp4',language:'en',contentType:'video/mp4'};

test('Gemini base URL builds correct hackathon generateContent endpoint',()=>{
  assert.equal(geminiGenerateContentUrl(BASE,'gemini-3.8-flash').href,
    `${BASE}/v1beta/models/gemini-3.8-flash:generateContent`);
  const full = `${BASE}/v1beta/models/gemini-3.8-flash:generateContent`;
  assert.equal(geminiGenerateContentUrl(full).href,full);
  assert.throws(()=>geminiGenerateContentUrl('http://example.org/gemini'),/HTTPS/);
  assert.throws(()=>geminiGenerateContentUrl(BASE,'../bad'),/Invalid/);
});

test('Gemini adapter sends inline video JSON with x-goog-api-key and produces a validated transcript',async()=>{
  let captured;
  const transcriber = createConfiguredHostedTranscriber({...opts,fetchImpl:async (url,options)=>{
    captured={url:url.href,...options};
    return Response.json(RESULT);
  }});
  const result=await transcriber.transcribe({videoId:'clip-99',media});
  assert.equal(captured.url, `${BASE}/v1beta/models/gemini-3.8-flash:generateContent`);
  assert.equal(captured.headers['x-goog-api-key'],'fake-secret');
  assert.equal(captured.headers.authorization,undefined);
  assert.equal(captured.headers['Content-Type'],'application/json');
  const req=JSON.parse(captured.body);
  assert.equal(req.contents[0].parts[0].inlineData.mimeType,'video/mp4');
  assert.equal(Buffer.from(req.contents[0].parts[0].inlineData.data,'base64').toString(),'test-video');
  assert.match(req.contents[0].parts[1].text,/Transcribe only the SPOKEN WORDS/);
  assert.equal(result.videoId,'clip-99');
  assert.equal(result.sourceLanguage,'en');
  assert.equal(result.segments[0].id,'seg-0001');
  assert.equal(result.segments[1].end,4.7);
});

test('Gemini handles timestamp strings and fenced JSON while ignoring thought metadata',()=>{
  const p={candidates:[{finishReason:'STOP',content:{parts:[
    {thought:true,text:'internal'},
    {text:'```json\n{"sourceLanguage":"sw","segments":[{"start":"00:00.50","end":"00:03.10","text":"Habari zenu","language":"sw"}]}\n```',thoughtSignature:'opaque'},
  ]}}]};
  const result=parseGeminiTranscript(p,{videoId:'x',language:'sw'});
  assert.equal(result.segments[0].start,0.5);
  assert.equal(result.segments[0].end,3.1);
  assert.equal(result.sourceLanguage,'sw');
});

test('Malformed or un-timed Gemini output is rejected; timestamps are never invented',()=>{
  assert.throws(()=>parseGeminiTranscript({candidates:[{content:{parts:[{text:'not-json'}]}}]},{videoId:'x',language:'en'}),/timestamped JSON/);
  const bad={candidates:[{content:{parts:[{text:JSON.stringify({sourceLanguage:'en',segments:[{text:'some words'}]})}]}}]};
  assert.throws(()=>parseGeminiTranscript(bad,{videoId:'x',language:'en'}),/start/);
  assert.throws(()=>parseGeminiTranscript({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]},{videoId:'x',language:'en'}),/incomplete/);
});

test('Gemini refuses oversize inline video before reading, with actionable error',async()=>{
  let readCalls=0;
  const provider=createGeminiHostedTranscriber({...opts,maxInlineMiB:1,mediaStat:async()=>({size:2*1024*1024}),readMedia:async()=>{readCalls++;return Buffer.from('x');}});
  await assert.rejects(provider.transcribe({videoId:'x',media}),/too large for inline Gemini/);
  assert.equal(readCalls,0);
});

test('Gemini reports HTTP errors and requires a configured key',async()=>{
  assert.throws(()=>createGeminiHostedTranscriber({...opts,token:''}),/Set API_KEY/);
  const provider=createGeminiHostedTranscriber({...opts,fetchImpl:async()=>Response.json({error:{message:'Requested model was not found'}},{status:404})});
  await assert.rejects(provider.transcribe({videoId:'x',media}),/HTTP 404: Requested model was not found/);
});

test('Existing generic hosted provider is still selected by protocol',()=>{
  const provider=createConfiguredHostedTranscriber({endpoint:'http://127.0.0.1:9123/asr',token:'abc',protocol:'generic'});
  assert.equal(typeof provider.transcribe,'function');
  assert.throws(()=>createConfiguredHostedTranscriber({...opts,protocol:'unknown'}),/must be generic or gemini/);
});