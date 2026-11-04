const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {HttpAiVerificationProvider,normalizeAiEvidence,aiRequiresReview}=require('../dist/providers/http-ai.provider'),{KuboStorageProvider}=require('../dist/providers/kubo-storage.provider'),{TrackFiles}=require('../dist/utils/trackFiles');
const hash=b=>createHash('sha256').update(b).digest('hex'),cid='bafkreigh2akiscaildc6o6p2nhccz3u5c6afgzkgkbb37faqxnxm6woj5m';
function evidence(audioHash,score=.72){return {audioHash,decision:score>=.894406?'HOLD':score>=.856638?'WARN':'PASS',similarityScore:score,queryVerifierScore:score,duplicate:{detected:false,matchedTrackId:null},thresholds:{warn:.856638,hold:.894406},modelVersion:'clap-test',scoreVersion:'seg_top3_centered-v1',corpusVersion:'fixture-corpus',decisionPolicyVersion:'layer2-risk-v1',decisionReason:'TEST_ONLY',disposition:score>=.856638?'HUMAN_REVIEW':'ALLOW',reviewRequired:score>=.856638,provisional:true,processingSeconds:.01,similarTracks:[{trackId:'external-123',score:.55,matchedSegments:[]}]};}
async function serve(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));return `http://127.0.0.1:${s.address().port}`;}
async function audio(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'external-providers-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const bytes=require('./helpers/track-fixtures.cjs').wav();await fs.writeFile(path.join(root,'audio.wav'),bytes);return {files:new TrackFiles(root),bytes,input:{trackId:42,audioPath:'/uploads/audio.wav',audioHash:hash(bytes),requestId:'verification-9'}};}
test('AI uploads multipart audio with stable ID, polls authenticated jobs, and preserves corpus evidence',async t=>{const {files,bytes,input}=await audio(t);let polls=0;const url=await serve(t,async(req,res)=>{assert.equal(req.headers.authorization, 'Bearer test-key');assert.equal(req.headers['x-internal-api-key'],undefined);const b=[];for await(const c of req)b.push(c);res.setHeader('Content-Type','application/json');if(req.method==='POST'){const text=Buffer.concat(b).toString();assert.ok(Buffer.concat(b).includes(bytes));assert.ok(text.includes('filename="track-42.wav"'));assert.ok(text.includes('verification-9'));res.statusCode=202;res.end(JSON.stringify({jobId:'job-9',statusUrl:'https://ignored.invalid'}));}else res.end(JSON.stringify({jobId:'job-9',trackId:'42',state:++polls===1?'RUNNING':'SUCCEEDED',result:evidence(input.audioHash)}));});const r=await new HttpAiVerificationProvider(url,'test-key',files,1).verify(input);assert.equal(polls,2);assert.equal(r.riskScore,.72);assert.equal(r.similarTracks[0].externalTrackId,'external-123');assert.equal(r.similarTracks[0].trackId,undefined);assert.equal(r.evidence.corpusVersion,'fixture-corpus');});
test('AI rejects wrong hashes and contradictory verdicts; polling respects cancellation',async t=>{const {files,input}=await audio(t);assert.throws(()=>normalizeAiEvidence(evidence('wrong'),input.audioHash));assert.throws(()=>normalizeAiEvidence({...evidence(input.audioHash),decision:'HOLD'},input.audioHash));const url=await serve(t,(_q,r)=>r.end(JSON.stringify({jobId:'job',trackId:'42',state:'RUNNING'})));await assert.rejects(new HttpAiVerificationProvider(url,'key',files,1).verify({...input,audioHash:'a'.repeat(64)}),{statusCode:409});await assert.rejects(new HttpAiVerificationProvider(url,'key',files,1).verify(input,AbortSignal.timeout(30)));});
test('v5 WARN uses query classifier, preserves pairwise score, and accepts omitted derived review fields',()=>{const hash='a'.repeat(64);const raw={...evidence(hash,.72),decision:'WARN',queryVerifierScore:.91,similarityScore:.72,thresholds:{warn:.9,hold:.95}};delete raw.reviewRequired;delete raw.disposition;delete raw.decisionReason;const result=normalizeAiEvidence(raw,hash);assert.equal(result.status,'WARN');assert.equal(result.riskScore,.72);assert.equal(result.evidence.queryVerifierScore,.91);assert.equal(result.evidence.reviewRequired,true);assert.equal(result.evidence.disposition,'HUMAN_REVIEW');assert.throws(()=>normalizeAiEvidence({...raw,decision:'PASS'},hash));});
test('AI review gate preserves HOLD despite different contract thresholds; BLOCK keeps null raw score',()=>{const raw=evidence('a'.repeat(64),.895),r=normalizeAiEvidence(raw,raw.audioHash);assert.equal(r.status,'HOLD');assert.equal(r.evidence.decision,'HOLD');assert.equal(aiRequiresReview(r.evidence),true);assert.equal(aiRequiresReview(normalizeAiEvidence(evidence(raw.audioHash,.87),raw.audioHash).evidence),true);const b=normalizeAiEvidence({...raw,decision:'BLOCK',similarityScore:null,duplicate:{detected:true,matchedTrackId:'external-1'},reviewRequired:false,disposition:'AUTO_BLOCK',similarTracks:[]},raw.audioHash);assert.equal(b.duplicate,true);assert.equal(b.status,'BLOCK');assert.equal(b.evidence.similarityScore,null);});
test('Kubo uploads audio/metadata and rejects CID contents whose SHA256 differs',async t=>{const {files,input,bytes}=await audio(t),metadata={audioHash:input.audioHash,title:'TEST_ONLY'},request={...input,metadata,metadataHash:hash(JSON.stringify(metadata))};let adds=0,cats=0,corrupt=false;const url=await serve(t,async(req,res)=>{if(req.url.startsWith('/api/v0/add')){const b=[];for await(const c of req)b.push(c);assert.ok(Buffer.concat(b).toString().includes(adds++%2===0?bytes.toString():JSON.stringify(metadata)));res.end(JSON.stringify({Hash:cid}));}else if(req.url.startsWith('/api/v0/cat'))res.end(corrupt?'tampered':cats++%2===0?JSON.stringify(metadata):bytes);else{res.statusCode=404;res.end();}});const p=new KuboStorageProvider(url,files),r=await p.upload(request);assert.equal(adds,2);assert.equal(await p.verify(request,r),true);corrupt=true;assert.equal(await p.verify(request,r),false);await assert.rejects(p.upload({...request,audioHash:'b'.repeat(64)}),{statusCode:409});});

test('metadata serialization is stable after MySQL reorders nested JSON keys',()=>{const {canonicalJson}=require('../dist/utils/canonicalJson');assert.equal(canonicalJson({b:{z:1,a:2},a:[{d:3,c:4}]}),canonicalJson({a:[{c:4,d:3}],b:{a:2,z:1}}));});


test('AI missing credentials and invalid URLs fail before file access or network calls',async t=>{
  let opened=0,requests=0;
  const files={open:async()=>{opened++;throw Error('Unexpected file access');}};
  t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('Unexpected AI request');});
  for(const [url,key] of [['http://ai-unavailable.invalid',''],['http://ai-unavailable.invalid','   '],['invalid-url','test-key'],['file:///tmp/audio','test-key']]) {
    const provider=new HttpAiVerificationProvider(url,key,files);
    await assert.rejects(provider.verify({trackId:42,audioPath:'/uploads/missing.wav',audioHash:'a'.repeat(64)}),{statusCode:503});
  }
  assert.equal(opened,0);assert.equal(requests,0);
});

test('AI rejects unauthorized uploads and polling without returning a verification result',async t=>{
  const {files,input}=await audio(t);
  for(const deniedStage of ['upload','poll']) {
    let uploads=0,polls=0;
    const url=await serve(t,async(req,res)=>{
      assert.equal(req.headers.authorization,'Bearer invalid-test-key');
      assert.equal(req.headers['x-internal-api-key'],undefined);
      for await(const _chunk of req) {}
      if(req.method==='POST') {
        uploads++;
        if(deniedStage==='upload') {res.statusCode=401;res.end('{}');return;}
        res.statusCode=202;res.end(JSON.stringify({jobId:'auth-job'}));
      } else {polls++;res.statusCode=403;res.end('{}');}
    });
    await assert.rejects(new HttpAiVerificationProvider(url,'invalid-test-key',files,1).verify(input),{statusCode:502,code:'AI_AUTH_FAILED'});
    assert.equal(uploads,1);assert.equal(polls,deniedStage==='upload'?0:1);
  }
});

test('AI transport distinguishes HTTP, JSON, schema, job, hash and verdict failures',async t=>{
  const {files,input}=await audio(t);
  const cases=[
    {name:'http',code:'AI_HTTP_ERROR',status:503,body:'private remote text'},
    {name:'json',code:'AI_INVALID_JSON',body:'not JSON with private details'},
    {name:'null',code:'AI_INVALID_RESPONSE',body:'null'},
    {name:'job-id',code:'AI_INVALID_RESPONSE',body:JSON.stringify({jobId:'../unsafe'})},
    {name:'identity',code:'AI_INVALID_RESPONSE',job:{jobId:'other',trackId:'42',state:'RUNNING'}},
    {name:'state',code:'AI_INVALID_RESPONSE',job:{jobId:'job',trackId:'42',state:'UNKNOWN'}},
    {name:'failed',code:'AI_JOB_FAILED',job:{jobId:'job',trackId:'42',state:'FAILED',error:'private worker error'}},
    {name:'hash',code:'AI_AUDIO_HASH_MISMATCH',job:{jobId:'job',trackId:'42',state:'SUCCEEDED',result:evidence('wrong-hash')}},
    {name:'policy',code:'AI_POLICY_FAILED',job:{jobId:'job',trackId:'42',state:'SUCCEEDED',result:{...evidence(input.audioHash),decision:'HOLD'}}},
  ];
  for(const c of cases) {
    const url=await serve(t,async(req,res)=>{
      for await(const _chunk of req) {}
      res.statusCode=c.status??200;
      res.end(c.job?(req.method==='POST'?JSON.stringify({jobId:'job'}):JSON.stringify(c.job)):c.body);
    });
    await assert.rejects(new HttpAiVerificationProvider(url,'test-key',files,1).verify(input),e=>{
      assert.equal(e.code,c.code,c.name);assert.ok(!e.message.includes('private'));return true;
    });
  }
});

test('AI connection failures and timeouts are classified without leaking transport errors',async t=>{
  const {files,input}=await audio(t);
  const mocked=t.mock.method(globalThis,'fetch',async()=>{throw Error('private network address and token');});
  await assert.rejects(new HttpAiVerificationProvider('http://unused.invalid','test-key',files).verify(input),{code:'AI_CONNECTION_FAILED'});
  mocked.mock.restore();
  const url=await serve(t,async(req,res)=>{for await(const _chunk of req){};res.end(JSON.stringify(req.method==='POST'?{jobId:'job'}:{jobId:'job',trackId:'42',state:'PENDING'}));});
  await assert.rejects(new HttpAiVerificationProvider(url,'test-key',files,100).verify(input,AbortSignal.timeout(30)),{code:'AI_TIMEOUT'});
});

test('AI result normalization preserves every PASS/WARN/HOLD/BLOCK decision and rejects malformed matches',()=>{
  const audioHash='a'.repeat(64);
  for(const [score,status] of [[.72,'PASS'],[.87,'WARN'],[.895,'HOLD']]) {
    const result=normalizeAiEvidence(evidence(audioHash,score),audioHash);assert.equal(result.status,status);assert.equal(result.duplicate,false);
  }
  const blocked={...evidence(audioHash),decision:'BLOCK',similarityScore:null,queryVerifierScore:null,duplicate:{detected:true,matchedTrackId:'external-fixture'},similarTracks:[],reviewRequired:false,disposition:'AUTO_BLOCK'};
  const result=normalizeAiEvidence(blocked,audioHash);assert.equal(result.status,'BLOCK');assert.equal(result.duplicate,true);assert.equal(result.evidence.similarityScore,null);
  assert.throws(()=>normalizeAiEvidence({...blocked,duplicate:{detected:false}},audioHash),{code:'AI_POLICY_FAILED'});
  assert.throws(()=>normalizeAiEvidence({...evidence(audioHash),modelVersion:null},audioHash),{code:'AI_INVALID_RESPONSE'});
  assert.throws(()=>normalizeAiEvidence({...evidence(audioHash),similarTracks:[null]},audioHash),{code:'AI_INVALID_RESPONSE'});
});
