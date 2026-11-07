import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCaptionFlowDemoServer } from './server.mjs';

test('browser upload -> Gemini compatible gateway -> caption player JSON pipeline',async()=>{
  let requests=0;
  const remote=createServer(async(req,res)=>{
    requests++;
    assert.equal(req.url,'/api/public/gemini/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(req.headers['x-goog-api-key'],'test-token');
    assert.equal(req.headers['content-type'],'application/json');
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);
    assert.equal(Buffer.from(request.contents[0].parts[0].inlineData.data,'base64').toString(),'video-placeholder');
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
      sourceLanguage:'en',segments:[
        {start:0,end:1.5,text:'The campaign commenced.',language:'en'},
        {start:1.5,end:3.7,text:'Please visit the health centre.',language:'en'},
      ],
    })}]}}]}));
  });
  const storageDir=await mkdtemp(join(tmpdir(),'captionflow-gemini-storage-'));
  const uploadDir=await mkdtemp(join(tmpdir(),'captionflow-gemini-uploads-'));
  let demo;
  try {
    remote.listen(0,'127.0.0.1');await once(remote,'listening');
    const hostedUrl=`http://127.0.0.1:${remote.address().port}/api/public/gemini`;
    demo=await createCaptionFlowDemoServer({storageDir,uploadDir,userId:'gemini-test',hostedUrl,hostedToken:'test-token',hostedProtocol:'gemini',hostedModel:'gemini-3.8-flash'});
    demo.listen(0,'127.0.0.1');await once(demo,'listening');
    const url=`http://127.0.0.1:${demo.address().port}`;
    const r=await fetch(`${url}/api/transcribe?provider=hosted&consent=yes&language=en&mode=original`,{
      method:'POST',headers:{'Content-Type':'video/mp4'},body:'video-placeholder',
    });
    const output=await r.json();
    assert.equal(r.status,200,output.error);
    assert.equal(output.provider,'hosted');
    assert.equal(output.transcript.segments.length,2);
    assert.equal(output.captions[0].start,0);
    assert.equal(output.captions[1].end,3.7);
    assert.equal(output.captionVariants.plain[0].status,'needs-review');
  }finally{
    if(demo)await new Promise(resolve=>demo.close(resolve));
    await new Promise(resolve=>remote.close(resolve));
    await rm(storageDir,{recursive:true,force:true});
    await rm(uploadDir,{recursive:true,force:true});
  }
  assert.equal(requests,1);
});