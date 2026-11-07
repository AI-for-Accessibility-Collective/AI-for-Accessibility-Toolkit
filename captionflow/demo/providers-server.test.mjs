import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCaptionFlowDemoServer } from './server.mjs';

async function withServer(providers, callback, opts={}) {
  const storageDir=await mkdtemp(join(tmpdir(),'captionflow-provider-api-'));
  const uploadDir=await mkdtemp(join(tmpdir(),'captionflow-media-api-'));
  const server=await createCaptionFlowDemoServer({ storageDir, uploadDir, providers, userId:'provider-test', ...opts });
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    await callback(base, uploadDir);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await rm(storageDir,{recursive:true,force:true});
    await rm(uploadDir,{recursive:true,force:true});
  }
}
const fakeTranscript = videoId=>({videoId,sourceLanguage:'en',segments:[
  {id:'a',start:0,end:1.5,text:'A short sentence.',language:'en'},
  {id:'b',start:1.5,end:3.5,text:'Another sentence.',language:'en'},
]});

const fakeLocal = { async transcribe({videoId,media}) {
  assert.equal(media.kind,'local-file');
  assert.equal(media.language,'en');
  assert.equal((await readFile(media.path)).toString(),'simulated-video-data');
  return fakeTranscript(videoId);
}};

test('provider status + real-video HTTP path uses local transcriber and preserves timed captions',async()=>{
  await withServer({local:fakeLocal},async(base, uploadDir)=>{
    const providers=await (await fetch(`${base}/api/providers`)).json();
    assert.equal(providers.providers.fixture,true);assert.equal(providers.providers.local,true);assert.equal(providers.providers.hosted,false);
    assert.equal((await fetch(`${base}/player-sync.mjs`)).status,200);
    assert.equal((await fetch(`${base}/caption-view.mjs`)).status,200);
    const response=await fetch(`${base}/api/transcribe?provider=local&language=en&mode=original`,{
      method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data',
    });
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.provider,'local');assert.equal(result.captions.length,2);
    assert.equal(result.captions[0].start,0);assert.equal(result.captions[1].end,3.5);
    assert.equal(result.captions[0].status,'ready');
    assert.equal(result.warnings.length,0);
    assert.equal(result.captionVariants.plain.length,2);
    assert.equal(result.captionVariants.plain[0].status,'fallback');
    assert.deepEqual(await (await import('node:fs/promises')).readdir(uploadDir),[]);
    const plain=await fetch(`${base}/api/transcribe?provider=local&language=en&mode=plain`,{
      method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data',
    });
    assert.equal(plain.status,200);
    assert.equal((await plain.json()).captions[0].status,'fallback');
  });
});

test('provider errors, MIME checks, file limits and hosted consent are enforced',async()=>{
  await withServer({local:fakeLocal,hosted: {transcribe: async ({videoId})=>fakeTranscript(videoId)}},async(base)=>{
    assert.equal((await fetch(`${base}/api/transcribe?provider=hosted&language=en`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data'})).status,400);
    assert.equal((await fetch(`${base}/api/transcribe?provider=local&language=fr`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data'})).status,400);
    assert.equal((await fetch(`${base}/api/transcribe?provider=local&language=en`,{method:'POST',headers:{'Content-Type':'text/plain'},body:'simulated-video-data'})).status,415);
    assert.equal((await fetch(`${base}/api/transcribe?provider=local&language=en`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data'})).status,413);
    const good=await fetch(`${base}/api/transcribe?provider=hosted&language=en&consent=yes`,{method:'POST',headers:{'Content-Type':'video/mp4'},body:'test'});
    assert.equal(good.status,200);
  },{maxMediaBytes:8});
});


test('API supplies reviewed plain variant alongside original without transcribing twice',async()=>{
  let calls=0;
  const local={async transcribe({videoId}){
    calls++;
    return {videoId,sourceLanguage:'en',segments:[
      {id:'first',start:0,end:2.5,text:'The project commenced prior to Friday at 2:00 PM.',language:'en'},
      {id:'second',start:2.5,end:4.8,text:'Please visit our local library.',language:'en'},
    ]};
  }};
  await withServer({local},async(base)=>{
    const response=await fetch(`${base}/api/transcribe?provider=local&language=en&mode=original`,{
      method:'POST',headers:{'Content-Type':'video/mp4'},body:'simulated-video-data',
    });
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(calls,1);
    assert.equal(result.captions[0].displayText,'The project commenced prior to Friday at 2:00 PM.');
    assert.equal(result.captionVariants.plain[0].displayText,'The project started before Friday at 2:00 PM.');
    assert.equal(result.captionVariants.plain[0].originalText,result.captions[0].displayText);
    assert.equal(result.captionVariants.plain[0].status,'needs-review');
    assert.deepEqual([result.captions[0].start,result.captions[0].end],
      [result.captionVariants.plain[0].start,result.captionVariants.plain[0].end]);
    assert.equal(result.captionVariants.plain[1].status,'fallback');
  });
});