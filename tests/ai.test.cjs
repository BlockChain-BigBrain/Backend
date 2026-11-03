const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AiClient,isAiEvidence}=require('../dist/services/ai.client');
const evidence={decision:'HOLD',audioHash:'a'.repeat(64),modelVersion:'laion/clap-htsat-unfused',scoreVersion:'hybrid_query_top3_pairwise_hold-v5',decisionPolicyVersion:'track-ai-balanced-policy-v5-20261102',corpusVersion:'corpus',
  durationSeconds:30,similarityScore:.95,queryVerifierScore:.4,thresholds:{warn:.351229127861893,hold:.9471999941293027},similarTracks:[],duplicate:{detected:false,matchedTrackId:null},provisional:true};

test('AI failed and malformed responses cannot become PASS evidence',async()=>{
  const original=global.fetch;const oldKey=process.env.TRACK_AI_API_KEY;process.env.TRACK_AI_API_KEY='test-only';
  try{
    const client=new AiClient();
    global.fetch=async()=>new Response(JSON.stringify({state:'FAILED',result:null}));
    await assert.rejects(client.wait('job'),/AI_ANALYSIS_FAILED/);
    global.fetch=async()=>new Response(JSON.stringify({state:'SUCCEEDED',result:{decision:'PASS'}}));
    await assert.rejects(client.wait('job'),/AI_INVALID_RESULT/);
    global.fetch=async()=>new Response(JSON.stringify({state:'SUCCEEDED',result:evidence}));
    assert.equal((await client.wait('job')).decision,'HOLD');
  }finally{global.fetch=original;if(oldKey===undefined)delete process.env.TRACK_AI_API_KEY;else process.env.TRACK_AI_API_KEY=oldKey;}
});
test('BLOCK requires duplicate evidence, and ordinary results require numeric similarity',()=>{
  assert.equal(isAiEvidence({...evidence,decision:'BLOCK'}),false);
  assert.equal(isAiEvidence({...evidence,similarityScore:null}),false);
  assert.equal(isAiEvidence({...evidence,decision:'BLOCK',similarityScore:null,duplicate:{detected:true,matchedTrackId:'reference'}}),true);
});
test('legacy thresholds and policy versions are rejected',()=>{
  assert.equal(isAiEvidence({...evidence,thresholds:{warn:.8,hold:.9}}),false);
  assert.equal(isAiEvidence({...evidence,decisionPolicyVersion:'policy-v5'}),false);
});
