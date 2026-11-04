const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspectChainState,guardChainState}=require('../dist/blockchain/identity');
const {requireLocalDevelopment,resetPlan,reconcileChain}=require('../dist/blockchain/reconciliation');
const names=['TrackRegistry','LicenseNFT','LicenseMarketplace','RevenueSplitter'];
function fixture(){
 const data={identity:null,cursor:null,registrations:[],transactions:[],events:[],withdrawals:[],tracks:[],licenses:[]};let writes=0;
 const db={blockchainIdentity:{findUnique:async()=>data.identity,upsert:async({create})=>{data.identity??=create;writes++}},blockchainCursor:{findUnique:async()=>data.cursor}};
 for(const [model,key]of [['registrationRequest','registrations'],['transaction','transactions'],['blockchainEvent','events'],['revenueWithdrawal','withdrawals'],['track','tracks'],['license','licenses']])db[model]={findMany:async()=>data[key]};
 const chain={chainId:'31337',health:async()=>({connected:true}),manifest:{runtimeCodeHashes:Object.fromEntries(names.map(n=>[n,'codehash']))},addresses:Object.fromEntries(names.map(n=>[n,'0x'+ '1'.repeat(40)])),provider:{getBlock:async n=>({number:n==='latest'?10:Number(n),hash:`hash-${n==='latest'?10:n}`}),getTransactionReceipt:async()=>null}};
 return {db,chain,data,writes:()=>writes};
}
test('check/dry inspection is read-only; same-chain backend restart preserves the enrolled identity',async()=>{
 const f=fixture();assert.equal((await inspectChainState(f.db,f.chain)).consistent,true);assert.equal(f.writes(),0);
 await guardChainState(f.db,f.chain);const before={...f.data.identity};await guardChainState(f.db,f.chain);assert.deepEqual(f.data.identity,before);
});
test('same chainId with changed genesis, identity or cursor blocks synchronization',async()=>{
 for(const change of ['genesis','identity','cursor','deployment']){
  const f=fixture();await guardChainState(f.db,f.chain);
  if(change==='genesis')f.data.identity.genesisHash='old';
  if(change==='identity')f.data.identity.blockHash='old';
  if(change==='cursor')f.data.cursor={blockNumber:8n,blockHash:'old'};
  if(change==='deployment')f.chain.addresses.TrackRegistry='0x'+'2'.repeat(40);
  await assert.rejects(guardChainState(f.db,f.chain),{statusCode:503});assert.ok(f.chain.blockedReason);
 }
});
test('without a cursor legacy registration/payment proofs are checked and missing proofs block bootstrap',async()=>{
 const f=fixture();f.data.registrations=[{id:1,contractAddress:f.chain.addresses.TrackRegistry,txHash:'missing'}];
 assert.equal((await inspectChainState(f.db,f.chain)).consistent,false);assert.equal(f.writes(),0);
 f.data.registrations=[{id:2,contractAddress:f.chain.addresses.TrackRegistry,txHash:null}];assert.equal((await inspectChainState(f.db,f.chain)).consistent,false);
 f.data.registrations=[];f.data.transactions=[{id:1,txHash:'missing',blockNumber:3n}];assert.equal((await inspectChainState(f.db,f.chain)).consistent,false);
});
test('deployment health failure (genesis/anchor/code/address/wiring) is fail-closed',async()=>{
 const f=fixture();f.chain.health=async()=>({connected:false,error:'runtime code mismatch'});
 const result=await inspectChainState(f.db,f.chain);assert.equal(result.deploymentReady,false);assert.equal(result.consistent,false);assert.equal(f.writes(),0);
});
test('reset requires explicit development, loopback services, exact database opt-in and chain 31337',()=>{
 const env={NODE_ENV:'development',BLOCKCHAIN_NETWORK:'hardhat',BLOCKCHAIN_CHAIN_ID:'31337',BLOCKCHAIN_RPC_URL:'http://127.0.0.1:8545',DATABASE_URL:'mysql://user:secret@127.0.0.1:33306/track_ai',LOCAL_CHAIN_RECONCILE_ALLOWED:'1',LOCAL_CHAIN_RECONCILE_DATABASE:'track_ai'};
 assert.equal(requireLocalDevelopment(env,true).database,'track_ai');
 for(const patch of [{NODE_ENV:'production'},{BLOCKCHAIN_CHAIN_ID:'80002'},{BLOCKCHAIN_RPC_URL:'https://example.test'},{DATABASE_URL:'mysql://user:secret@example.test/track_ai'},{LOCAL_CHAIN_RECONCILE_ALLOWED:'0'},{LOCAL_CHAIN_RECONCILE_DATABASE:'other'}])assert.throws(()=>requireLocalDevelopment({...env,...patch},true));
});
test('plan refuses mixed networks and unscoped financial records; mock/offchain records are preserved',()=>{
 const rows={tracks:[],registrations:[],purchases:[],licenses:[],transactions:[],allocations:[],withdrawals:[],listings:[],events:[],cursors:[],identities:[]};
 assert.equal(resetPlan(rows).counts.tracks,0);
 assert.throws(()=>resetPlan({...rows,cursors:[{chainId:'80002'}]}),/Mixed-network/);
 assert.throws(()=>resetPlan({...rows,transactions:[{id:1,source:'REAL',chainId:null}]}),/Unscoped/);
 const p=resetPlan({...rows,transactions:[{id:1,source:'MOCK',chainId:null}],licenses:[{id:1,source:'MOCK',trackId:1}],withdrawals:[{id:1,walletAddress:null,currency:'KRW'}]});assert.equal(p.counts.transactions,0);assert.equal(p.counts.licenses,0);assert.equal(p.counts.withdrawals,0);
});
test('core reset cannot write without explicit confirmation, even when called outside the CLI',async()=>{
 let writes=0;const db={$transaction:async()=>{writes++}};
 await assert.rejects(reconcileChain(db,{},{}),/Explicit reset confirmation/);
 await assert.rejects(reconcileChain(db,{},{},{confirmation:'yes'}),/Explicit reset confirmation/);
 assert.equal(writes,0);
});
