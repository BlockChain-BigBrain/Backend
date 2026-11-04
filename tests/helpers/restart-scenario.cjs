const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {wav}=require('./track-fixtures.cjs');
module.exports=async({db,chain,root,database,sql,creator,buyer,collaborator,track,listing,route,ok,send,sync,stop,restart,port,t})=>{
 const {inspectChainState}=require('../../dist/blockchain/identity');
 const {readChainRows,resetPlan,digest}=require('../../dist/blockchain/reconciliation');
 // Match the user's five-track preservation case, including off-chain creator data.
 for(let i=0;i<4;i++){
  const bytes=wav();bytes.writeInt16LE(i+111,44);const filename=`preserved-${i}.wav`;await fs.writeFile(path.join(root,filename),bytes);
  await db.track.create({data:{title:`Preserved audio ${i}`,ownerId:creator.id,audioPath:`/uploads/${filename}`,mimeType:'audio/wav',audioHash:createHash('sha256').update(bytes).digest('hex'),fileSize:BigInt(bytes.length)}});
 }
 const preserved=async()=>({users:await db.user.findMany({orderBy:{id:'asc'}}),tracks:(await db.track.findMany({orderBy:{id:'asc'}})).map(({registrationStatus,blockchainTrackId,registeredAt,registrationTxHash,updatedAt,...row})=>row),contributions:await db.contribution.findMany(),invitations:await db.contributionInvitation.findMany(),verifications:await db.verification.findMany(),metadata:await db.metadataSnapshot.findMany(),files:await Promise.all((await fs.readdir(root)).filter(n=>!n.endsWith('metadata')).sort().map(async n=>{const p=path.join(root,n);return(await fs.stat(p)).isFile()?[n,createHash('sha256').update(await fs.readFile(p)).digest('hex')]:[n,'directory']}))});
 const before=await preserved();assert.equal(before.tracks.length,5);
 const business=rows=>digest({...rows,events:rows.events.map(({attempts,...row})=>row)});
 const unchanged=business(await readChainRows(db));await sync.poll();assert.equal(business(await readChainRows(db)),unchanged);
 const stable=digest(await readChainRows(db));
 t.diagnostic('PASS same-chain worker/backend restart preserves DB state');
 // Hardhat 3 removed hardhat_reset; restart the isolated process owned by the runner.
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Isolated node restart timed out')),30000);
  process.once('message',message=>{clearTimeout(timer);process.channel?.unref();message?.type==='isolated-hardhat-restarted'?resolve():reject(Error('Isolated node restart failed'))});
  process.send({type:'restart-isolated-hardhat'});
 });
 await assert.rejects(sync.poll());assert.equal(digest(await readChainRows(db)),stable);
 const manifest=await require('./deploy-local-fixture.cjs')(chain.provider,process.env.BLOCKCHAIN_DEPLOYMENT_FILE);
 Object.assign(chain.manifest,manifest);chain.blockedReason=undefined;
 const mismatch=await inspectChainState(db,chain);assert.equal(mismatch.consistent,false);assert.equal(mismatch.deploymentReady,true);
 const cli=(command,extra=[],env={})=>spawnSync(process.execPath,['--import','tsx','scripts/local-chain-state.ts',command,...extra],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,LOCAL_CHAIN_RECONCILE_ALLOWED:'1',LOCAL_CHAIN_RECONCILE_DATABASE:database,PORT:String(port),...env},encoding:'utf8',timeout:60000});
 const check=cli('check');assert.equal(check.status,2,check.stderr);
 const dry=cli('dry');assert.equal(dry.status,0,dry.stderr);assert.equal(digest(await readChainRows(db)),stable);
 assert.equal(cli('reconcile').status,1);assert.equal(digest(await readChainRows(db)),stable);
 const confirmation=['--confirm=RESET_LOCAL_CHAIN_31337'];
 const live=cli('reconcile',confirmation);assert.equal(live.status,1);assert.match(live.stderr,/Stop Backend/);
 t.diagnostic('PASS reset detected without modifying DB; dry-run/no-confirm/running-server guards');
 await stop();
 // Real SQL dump, then a forced FK-stage failure must roll back all prior deletes.
 sql("CREATE TRIGGER fail_local_reset BEFORE DELETE ON License FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected reset failure'");
 const failed=cli('reconcile',confirmation);assert.equal(failed.status,1);assert.equal(digest(await readChainRows(db)),stable);assert.equal((await inspectChainState(db,chain)).consistent,false);
 sql('DROP TRIGGER fail_local_reset');
 const badBackup=cli('reconcile',confirmation,{LOCAL_CHAIN_BACKUP_CONTAINER:'missing-reconcile-test-container'});assert.equal(badBackup.status,1);assert.equal(digest(await readChainRows(db)),stable);
 const success=cli('reconcile',confirmation);assert.equal(success.status,0,success.stderr+'\n'+success.stdout);
 assert.equal((await inspectChainState(db,chain)).consistent,true);
 assert.deepEqual(await preserved(),before);
 assert.equal(await db.registrationRequest.count(),0);assert.equal(await db.license.count(),0);assert.equal(await db.transaction.count(),0);assert.equal(await db.revenueAllocation.count(),0);assert.equal(await db.revenueWithdrawal.count(),0);assert.equal(await db.purchaseRequest.count(),0);assert.equal(await db.blockchainCursor.count(),0);assert.equal(await db.blockchainEvent.count(),0);
 // Verify the backup is restorable into a different disposable DB, not just a nonempty file.
 const backupLine=success.stdout.split('\n').find(line=>line.startsWith('{"backup":'));
 const backup=JSON.parse(backupLine).backup;
 const restore=database+'_restore',bin=process.env.SCHEMA_TEST_MYSQL_BIN;
 sql(`CREATE DATABASE \`${restore}\``,false);
 try{
  const run=spawnSync(bin,['--no-defaults',`--socket=${process.env.SCHEMA_TEST_MYSQL_SOCKET}`,'-u','root',restore],{input:await fs.readFile(backup),encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const count=spawnSync(bin,['--no-defaults',`--socket=${process.env.SCHEMA_TEST_MYSQL_SOCKET}`,'-u','root','--batch','--skip-column-names',restore,'-e','SELECT COUNT(*) FROM Track; SELECT COUNT(*) FROM License;'],{encoding:'utf8'});assert.equal(count.status,0,count.stderr);assert.equal(count.stdout.trim(),'5\n2');
 }finally{sql(`DROP DATABASE \`${restore}\``,false)}
 t.diagnostic('PASS SQL backup/restore, transaction rollback, five audio files/users/auth/contributors/invitations/AI/IPFS preserved');
 chain.blockedReason=undefined;delete process.env.BLOCKCHAIN_START_BLOCK;
 await sync.poll();assert.ok(await db.blockchainCursor.count());
 await restart();
 // Real registration -> sale -> NFT -> allocation -> withdrawal again after reset.
 const packet=await ok('POST',route+'/registration-payload',creator.token,{},202);
 const registrationHash=await send(creator,packet.transaction);await ok('POST',route+'/registration/confirm',creator.token,{txHash:registrationHash});
 await db.marketplaceListing.update({where:{id:listing.id},data:{status:'PREPARING',activeTrackId:null}});
 const price=await ok('POST',`/api/market/tracks/${listing.id}/price-payload`,creator.token,{});
 await ok('POST',`/api/market/tracks/${listing.id}/price/confirm`,creator.token,{txHash:await send(creator,price.transaction)});
 const purchase=await ok('POST','/api/licenses/purchase',buyer.token,{trackId:track.id,idempotencyKey:'post-reset-purchase'},201);
 await ok('POST','/api/licenses/purchase/confirm',buyer.token,{requestId:purchase.id,txHash:await send(buyer,purchase.transaction)});
 const registered=await db.track.findUniqueOrThrow({where:{id:track.id}});
 assert.equal(await chain.contracts.LicenseNFT.balanceOf(buyer.address,registered.blockchainTrackId),1n);assert.equal(await db.revenueAllocation.count(),2);
 const withdrawal=await ok('POST','/api/revenue/withdraw',creator.token,{idempotencyKey:'post-reset-withdraw'},202);
 await ok('POST','/api/revenue/withdraw/confirm',creator.token,{requestId:withdrawal.id,txHash:await send(creator,withdrawal.transaction)});
 assert.equal((await db.revenueWithdrawal.findUniqueOrThrow({where:{id:withdrawal.id}})).status,'COMPLETED');
 assert.equal(await db.track.count(),5);assert.equal((await inspectChainState(db,chain)).consistent,true);
 t.diagnostic('PASS resumed blockchain_sync and real registration/purchase/ERC1155/revenue withdrawal after reconciliation');
};
