const {test}=require('node:test');
const assert=require('node:assert/strict');
const {VerificationService}=require('../dist/services/verification.service');
const {AiProviderError}=require('../dist/providers/ai.errors');
function fixture(provider,saveFails=false) {
  const old={id:6,trackId:18,status:'REJECTED',source:'AI',errorCode:'AI_ANALYSIS_FAILED',updatedAt:new Date()};
  const rows=[structuredClone(old)];
  const track={id:18,ownerId:1,registrationStatus:'NOT_REGISTERED',audioHash:'a'.repeat(64),audioPath:'/uploads/private.wav',verifications:rows};
  const tx={marketplaceListing:{updateMany:async()=>({count:0})},verification:{
    create:async({data})=>{const row={id:8,updatedAt:new Date(),...data};rows.push(row);return row;},
    findUniqueOrThrow:async({where})=>rows.find(r=>r.id===where.id),
    updateMany:async({where,data})=>{for(const row of rows)if(row.id===where.id&&row.status===where.status)Object.assign(row,data);},
    update:async({where,data})=>{if(saveFails)throw Error('private SQL containing credentials');return Object.assign(rows.find(r=>r.id===where.id),data);},
  }};
  const repo={locked:async(_id,op)=>op(tx,track),db:{$transaction:async op=>op(tx),verification:tx.verification}};
  return {service:new VerificationService(repo,provider,100),rows,old};
}
test('verification persists safe failure codes and structured logs while retaining rejected history',async t=>{
  const logs=[];t.mock.method(console,'error',line=>logs.push(line));
  for(const [code,stage] of [['AI_AUTH_FAILED','upload'],['AI_CONNECTION_FAILED','upload'],['AI_TIMEOUT','poll'],['AI_JOB_FAILED','poll'],['AI_INVALID_JSON','poll'],['AI_INVALID_RESPONSE','result'],['AI_AUDIO_HASH_MISMATCH','result'],['AI_POLICY_FAILED','result']]) {
    const f=fixture({source:'AI',verify:async()=>{throw new AiProviderError(code,stage,502,code==='AI_AUTH_FAILED'?401:undefined);}});
    const result=await f.service.request(18,1,true);
    assert.equal(result.status,'REJECTED');assert.equal(result.errorCode,code);
    assert.deepEqual(f.rows[0],f.old);assert.equal(f.rows.length,2);
    const log=JSON.parse(logs.at(-1));assert.equal(log.code,code);assert.equal(log.stage,stage);
  }
  const f=fixture({source:'AI',verify:async()=>{throw Error('secret token and personal details');}});
  const result=await f.service.request(18,1,true);assert.equal(result.errorCode,'AI_ANALYSIS_FAILED');
  assert.ok(!JSON.stringify({logs,result}).includes('secret token'));
});
test('verified AI results distinguish persistence failures and keep BLOCK independently from HOLD',async t=>{
  t.mock.method(console,'error',()=>{});
  const block={duplicate:true,riskScore:1,status:'BLOCK',modelVersion:'fixture',similarTracks:[],evidence:{decision:'BLOCK'}};
  const provider={source:'AI',verify:async()=>block};
  const failed=fixture(provider,true),result=await failed.service.request(18,1,true);
  assert.equal(result.status,'REJECTED');assert.equal(result.errorCode,'AI_RESULT_SAVE_FAILED');assert.ok(!result.errorMessage.includes('private SQL'));
  assert.deepEqual(failed.rows[0],failed.old);
  const ok=fixture(provider),saved=await ok.service.request(18,1,true);
  assert.equal(saved.status,'VERIFIED');assert.equal(saved.riskStatus,'BLOCK');assert.equal(saved.duplicate,true);assert.deepEqual(ok.rows[0],ok.old);
});
