const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ChainSync}=require('../dist/blockchain/sync');

function fixture({durable=false,reorg=false}={}) {
 let writes=0,reads=0;
 const hash='0x'+'1'.repeat(64);
 const db={
  blockchainCursor:{findUnique:async()=>null,upsert:async()=>{writes++;}},
  blockchainEvent:{findMany:async()=>[],count:async()=>durable?1:0},
 };
 const chain={configured:true,chainId:'31337',confirmations:2,addresses:{},ready:async()=>{},provider:{
  getBlockNumber:async()=>10,
  getBlock:async()=>({hash:reorg && ++reads>1?'changed':'canonical'}),
  getLogs:async()=>[{transactionHash:hash,blockNumber:8,transactionIndex:0,index:0}],
 }};
 const sync=new ChainSync(db,chain,{});
 return {sync,writes:()=>writes};
}

test('sync leaves cursor unchanged when a failed receipt has no durable retry row',async()=>{
 const f=fixture();
 f.sync.process=async()=>{throw Error('DB unavailable before inbox persistence');};
 await assert.rejects(f.sync.poll(),/DB unavailable/);
 assert.equal(f.writes(),0);
 // Failure must release the worker lock so recovery can rescan the range.
 f.sync.process=async()=>{};
 await f.sync.poll();assert.equal(f.writes(),1);
});

test('durably queued mapping errors do not block unrelated confirmed transactions',async()=>{
 const f=fixture({durable:true});
 f.sync.process=async()=>{throw Error('Unmapped external transaction');};
 await f.sync.poll();assert.equal(f.writes(),1);
});

test('sync does not checkpoint a range whose canonical block changed during scanning',async()=>{
 const f=fixture({reorg:true});f.sync.process=async()=>{};
 await assert.rejects(f.sync.poll(),/Chain changed/);assert.equal(f.writes(),0);
});
