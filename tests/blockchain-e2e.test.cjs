const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {readFileSync,readdirSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
const {JsonRpcProvider,HDNodeWallet,Contract,Interface,formatEther,TypedDataEncoder}=require('ethers');
const {wav}=require('./helpers/track-fixtures.cjs');
const enabled=process.env.CHAIN_TEST==='1' && process.env.SCHEMA_TEST_MYSQL_SOCKET;
test(process.env.SERVICE_AUDIO ? 'REAL AI + IPFS + Hardhat + MySQL service workflow' : 'REAL Hardhat + MySQL + HTTP registration, sale, NFT, splitter, withdrawal and durable event sync (AI/IPFS fixtures only)',{skip:!enabled},async t=>{
 const socket=process.env.SCHEMA_TEST_MYSQL_SOCKET,database=`track_chain_e2e_${process.pid}`,mysql=process.env.SCHEMA_TEST_MYSQL_BIN||'mysql';
 const sql=(s,use=true)=>execFileSync(mysql,['--no-defaults',`--socket=${socket}`,'-u','root','--batch','--skip-column-names',...(use?[database]:[])],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'track-chain-e2e-'));
 const manifest=JSON.parse(readFileSync(path.resolve(__dirname,'../src/blockchain/deployment.json'),'utf8'));
 const verifier=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/1");
 Object.assign(process.env,{DATABASE_URL:process.env.SCHEMA_TEST_DATABASE_URL ? process.env.SCHEMA_TEST_DATABASE_URL.replace(/\/[^/]*$/,`/${database}`) : `mysql://root@localhost/${database}?socket=${encodeURIComponent(socket)}`,UPLOAD_DIR:root,METADATA_DIR:path.join(root,'metadata'),JWT_ACCESS_SECRET:'chain-e2e-access',JWT_REFRESH_SECRET:'chain-e2e-refresh',NODE_ENV:'development',COOKIE_SECURE:'false',FRONTEND_URL:'http://localhost:3000',AI_PROVIDER_MODE:process.env.SERVICE_AUDIO?'http':'unconfigured',STORAGE_PROVIDER_MODE:process.env.SERVICE_AUDIO?'kubo':'unconfigured',PAYMENT_PROVIDER_MODE:'unconfigured',BLOCKCHAIN_NETWORK:'hardhat',BLOCKCHAIN_RPC_URL:'http://127.0.0.1:8545',BLOCKCHAIN_CHAIN_ID:'31337',BLOCKCHAIN_CONFIRMATIONS:'1',VERIFICATION_SIGNER_ADDRESS:verifier.address,VERIFICATION_SIGNER_PRIVATE_KEY:verifier.privateKey,TRACK_REGISTRY_ADDRESS:manifest.TrackRegistry,LICENSE_NFT_ADDRESS:manifest.LicenseNFT,LICENSE_MARKETPLACE_ADDRESS:manifest.LicenseMarketplace,REVENUE_SPLITTER_ADDRESS:manifest.RevenueSplitter,EIP712_DOMAIN_NAME:'TrackAI_Registry',EIP712_DOMAIN_VERSION:'1',EIP712_PRIMARY_TYPE:'RegisterTrack',EIP712_FIELD_TYPES_JSON:'{}',EIP712_HASHING_JSON:'{}'});
 sql(`CREATE DATABASE \`${database}\`;`,false);
 const {prisma:db}=require('../dist/utils/prisma');
 const {chainClient:chain,ChainClient}=require('../dist/blockchain/client');
 const {ChainSync}=require('../dist/blockchain/sync');
 let server;
 try {
  const migrations=path.resolve(__dirname,'../prisma/migrations');
  for(const dir of readdirSync(migrations).filter(n=>/^\d/.test(n)).sort()) sql(readFileSync(path.join(migrations,dir,'migration.sql'),'utf8'));
  const {default:app,blockchainIntegration}=require('../dist/app');
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(method,url,token,data)=>{const r=await fetch(base+url,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,result:await r.json()};};
  const ok=async(method,url,token,data,status=200)=>{const r=await call(method,url,token,data);assert.equal(r.status,status,JSON.stringify(r.result));return r.result;};
  assert.equal((await ok('GET','/api/blockchain/health')).connected,true);
  process.env.BLOCKCHAIN_START_BLOCK=String(await chain.provider.getBlockNumber()+1);
  const users=[];
  for(const [i,name] of ['Creator','Collaborator','Buyer','Stranger'].entries()) {
   await ok('POST','/api/v1/auth/signup',null,{email:`${name}@chain.test`,password:'test-password-123',nickname:name},201);
   const login=await ok('POST','/api/v1/auth/login',null,{email:`${name}@chain.test`,password:'test-password-123'});
   const token=login.result.accessToken,account=await chain.provider.getSigner(i+2),address=await account.getAddress();
   const challenge=await ok('POST','/api/users/me/wallet/challenge',token,{walletAddress:address},201);
   await ok('POST','/api/users/me/wallet',token,{signature:await account.signMessage(challenge.message)});
   const user=await db.user.findUniqueOrThrow({where:{email:`${name}@chain.test`}});
   users.push({id:user.id,token,account,address});
  }
  const [creator,collaborator,buyer,stranger]=users;
  const creatorBefore=await chain.contracts.RevenueSplitter.getPendingRevenue(creator.address), collaboratorBefore=await chain.contracts.RevenueSplitter.getPendingRevenue(collaborator.address);
  const form=new FormData();form.set('title','Actual Hardhat rights');form.set('audio',new Blob([wav()],{type:'audio/wav'}),'actual.wav');
  // Unique file content per run prevents collisions with older chain test registrations.
  const bytes=process.env.SERVICE_AUDIO?readFileSync(process.env.SERVICE_AUDIO):wav();if(!process.env.SERVICE_AUDIO)require('node:crypto').randomBytes(8).copy(bytes,bytes.length-8);form.set('audio',new Blob([bytes]),process.env.SERVICE_AUDIO?path.basename(process.env.SERVICE_AUDIO):'actual.wav');
  const upload=await fetch(base+'/api/tracks',{method:'POST',headers:{Authorization:`Bearer ${creator.token}`},body:form});assert.equal(upload.status,201);const track=await upload.json(),route=`/api/tracks/${track.id}`;
  await ok('POST',route+'/contributors',creator.token,{userId:creator.id,role:'COMPOSER',percentage:60},201);
  await ok('POST',route+'/contributors',creator.token,{userId:collaborator.id,role:'PRODUCER',percentage:40},201);
  await ok('POST',route+'/contributors/finalize',creator.token);
  const {RightsRepository}=require('../dist/repositories/rights.repository'),repo=new RightsRepository(db);
  const {VerificationService}=require('../dist/services/verification.service');
  // TEST-ONLY fixture: production AI/IPFS providers remain unconfigured. Chain proof is real RPC.
  if(process.env.SERVICE_AUDIO) {
   const verification=await ok('POST',route+'/verify',creator.token,{},202);
   assert.equal(verification.status,'VERIFIED',JSON.stringify(verification));
   assert.equal(verification.evidence?.decision,'PASS','Use a nonduplicate PASS sample; WARN/HOLD require review');
   await ok('POST',route+'/metadata/prepare',creator.token,{},201);
   await ok('POST',route+'/metadata/upload',creator.token,{});
  } else {
  await new VerificationService(repo,{source:'AI',verify:async()=>({duplicate:false,riskScore:0.82,status:'WARN',modelVersion:'TEST_FIXTURE_NOT_REAL_AI',similarTracks:[]})}).request(track.id,creator.id);
  const {MetadataService}=require('../dist/services/metadata.service');
  const cid='bafkreigh2akiscaildc6o6p2nhccz3u5c6afgzkgkbb37faqxnxm6woj5m';
  const metadata=new MetadataService(repo,{configured:true,upload:async input=>({source:'REAL',metadataHash:input.metadataHash,metadataCid:cid}),verify:async(input,result)=>input.metadataHash===result.metadataHash},path.join(root,'metadata'));
  await metadata.prepare(track.id,creator.id,{});await metadata.upload(track.id,creator.id);
  }
  const cid=(await db.track.findUniqueOrThrow({where:{id:track.id}})).metadataCid;
  const packet=await ok('POST',route+'/registration-payload',creator.token,{},202);
  assert.equal(packet.ready,true);assert.equal(packet.typedData.primaryType,'RegisterTrack');assert.equal(packet.typedData.domain.name,'TrackAI_Registry');assert.ok(!JSON.stringify(packet).includes(verifier.privateKey));
  const send=async(user,tx)=>{assert.equal(tx.chainId,'31337');const response=await user.account.sendTransaction({to:tx.to,data:tx.data,value:BigInt(tx.value)});await response.wait();return response.hash;};
  const txHash=await send(creator,packet.transaction);
  // A mined registration can arrive after its signature expires and is renewed.
  const {BlockchainService,blockchainOptions}=require('../dist/services/blockchain.service');
  const originalNow=Date.now;
  try {
   Date.now=()=>originalNow()+1000000;
   await new BlockchainService(repo,chain,blockchainOptions()).register(track.id,creator.id);
  } finally {Date.now=originalNow;}
  await new ChainSync(db,chain,blockchainIntegration.commerce).poll();
  assert.equal((await db.track.findUniqueOrThrow({where:{id:track.id}})).registrationStatus,'REGISTERED');
  await Promise.all([ok('POST',route+'/registration/confirm',creator.token,{txHash}),ok('POST',route+'/registration/confirm',creator.token,{txHash})]);
  const registered=await db.track.findUniqueOrThrow({where:{id:track.id}});assert.equal(registered.registrationStatus,'REGISTERED');assert.ok(registered.registeredAt);
  const chainId=registered.blockchainTrackId;
  const onTrack=await chain.contracts.TrackRegistry.getTrack(chainId);assert.equal(onTrack.registrant.toLowerCase(),creator.address.toLowerCase());assert.equal(onTrack.metadataCID,cid);
  const [addresses,shares]=await chain.contracts.TrackRegistry.getContributors(chainId);assert.deepEqual(shares.map(String),['60','40']);assert.equal(addresses[1].toLowerCase(),collaborator.address.toLowerCase());
  // Real EVM failures; no mock receipt provider.
  await assert.rejects(creator.account.sendTransaction({to:packet.transaction.to,data:packet.transaction.data})); // duplicate hash
  await assert.rejects(stranger.account.sendTransaction({to:packet.transaction.to,data:packet.transaction.data}));
  const registry=new Contract(manifest.TrackRegistry,chain.interfaces.TrackRegistry,creator.account);
  const encoded=chain.interfaces.TrackRegistry.parseTransaction({data:packet.transaction.data});
  const r=encoded.args[0], freshAudio=require('node:crypto').randomBytes(32);
  const invalid=[`0x${freshAudio.toString('hex')}`,r.metadataCID,[...r.contributors],[...r.shares],r.similarityScore,r.modelVersion,r.nonce+1n,r.deadline];
  await assert.rejects(registry.registerTrack(invalid,'0x'+'11'.repeat(65)));
  const expired=[...invalid];expired[6]+=1n;expired[7]=1n;
  const expiredValue={...packet.typedData.value,audioHash:expired[0],nonce:expired[6],deadline:'1'};
  const expiredSig=await verifier.signTypedData(packet.typedData.domain,packet.typedData.types,expiredValue);
  await assert.rejects(registry.registerTrack(expired,expiredSig));
  assert.equal((await call('POST',route+'/registration/confirm',creator.token,{txHash:'0x'+'0'.repeat(64)})).status,409);
  const listing=await ok('POST','/api/market/tracks',creator.token,{trackId:track.id,price:'0.000000000000000101',currency:'ETH',licenseType:'COMMERCIAL'},201);
  const price=await ok('POST',`/api/market/tracks/${listing.id}/price-payload`,creator.token,{});
  const priceTx=await send(creator,price.transaction);
  await new ChainSync(db,chain,blockchainIntegration.commerce).poll();
  assert.equal((await db.marketplaceListing.findUniqueOrThrow({where:{id:listing.id}})).status,'ACTIVE');
  await ok('POST',`/api/market/tracks/${listing.id}/price/confirm`,creator.token,{txHash:priceTx});
  assert.equal((await db.marketplaceListing.findUniqueOrThrow({where:{id:listing.id}})).status,'ACTIVE');
  const market=new Contract(manifest.LicenseMarketplace,chain.interfaces.LicenseMarketplace,buyer.account);
  await assert.rejects(market.purchaseLicense(chainId,{value:100n}));await assert.rejects(market.purchaseLicense(99999999n,{value:101n}));
  const held=[...invalid];held[0]='0x'+require('node:crypto').randomBytes(32).toString('hex');held[4]=9000n;held[6]+=3n;
  const heldValue={...packet.typedData.value,audioHash:held[0],similarityScore:'9000',nonce:held[6]};
  const holdReceipt=await(await registry.registerTrack(held,await verifier.signTypedData(packet.typedData.domain,packet.typedData.types,heldValue))).wait();
  const holdId=chain.events(holdReceipt,'TrackRegistry','TrackRegistered')[0].args.trackId;
  await(await new Contract(manifest.LicenseMarketplace,chain.interfaces.LicenseMarketplace,creator.account).setLicensePrice(holdId,101n)).wait();await assert.rejects(market.purchaseLicense(holdId,{value:101n}));
  const purchase=await ok('POST','/api/licenses/purchase',buyer.token,{trackId:track.id,idempotencyKey:'chain-buy'},201);
  assert.equal(purchase.status,'PENDING_PAYMENT');assert.equal(await db.license.count(),0);
  assert.equal((await call('POST',`/api/licenses/requests/${purchase.id}/cancel`,buyer.token)).status,409);
  assert.equal(purchase.priceWei,'101');assert.equal((await ok('POST','/api/licenses/purchase',buyer.token,{trackId:track.id,idempotencyKey:'chain-buy'},201)).id,purchase.id);
  const boughtTx=await send(buyer,purchase.transaction);
  assert.equal((await call('POST','/api/licenses/purchase/confirm',stranger.token,{requestId:purchase.id,txHash:boughtTx})).status,403);
  assert.equal((await call('POST','/api/licenses/purchase/confirm',buyer.token,{requestId:purchase.id,txHash:priceTx})).status,409);
  const strangerPurchase=await ok('POST','/api/licenses/purchase',stranger.token,{trackId:track.id,idempotencyKey:'other-buyer'},201);
  assert.equal((await call('POST','/api/licenses/purchase/confirm',stranger.token,{requestId:strangerPurchase.id,txHash:boughtTx})).status,409);
  // A legitimate mined purchase remains valid if the seller later hides the listing.
  await db.marketplaceListing.update({where:{id:listing.id},data:{status:'INACTIVE',activeTrackId:null}});
  await new ChainSync(db,chain,blockchainIntegration.commerce).poll();
  assert.equal((await db.purchaseRequest.findUniqueOrThrow({where:{id:purchase.id}})).status,'COMPLETED');
  const license=await ok('POST','/api/licenses/purchase/confirm',buyer.token,{requestId:purchase.id,txHash:boughtTx});assert.equal(license.status,'COMPLETED');
  await ok('POST','/api/licenses/purchase/confirm',buyer.token,{requestId:purchase.id,txHash:boughtTx});
  assert.equal(await db.license.count(),1);assert.equal(await chain.contracts.LicenseNFT.balanceOf(buyer.address,chainId),1n);
  assert.equal((await db.license.findFirst()).tokenId,chainId);
  assert.equal((await db.transaction.findFirst({where:{purchaseRequestId:purchase.id}})).chainId,'31337');
  const allocations=await db.revenueAllocation.findMany({orderBy:{userId:'asc'}});assert.deepEqual(allocations.map(a=>a.amount.toFixed(18)),['0.000000000000000060','0.000000000000000041']);
  const balance=await ok('GET','/api/users/me/revenue',creator.token);assert.equal(balance.availableWei,(creatorBefore+60n).toString());
  assert.equal((await ok('GET','/api/users/me/revenue',collaborator.token)).availableWei,(collaboratorBefore+41n).toString());
  const withdrawal=await ok('POST','/api/revenue/withdraw',creator.token,{idempotencyKey:'withdraw-all'},202);
  assert.equal(withdrawal.status,'PREPARING');assert.equal(withdrawal.txHash,null);
  // Revenue arrives after the full-balance withdrawal payload was prepared.
  await send(stranger,strangerPurchase.transaction);
  const withdrawTx=await send(creator,withdrawal.transaction);
  await new ChainSync(db,chain,blockchainIntegration.commerce).poll();
  const paid=await db.revenueWithdrawal.findUniqueOrThrow({where:{id:withdrawal.id}});
  assert.equal(paid.status,'COMPLETED');assert.ok(paid.amount.eq(formatEther(creatorBefore+120n)));
  await Promise.all([ok('POST','/api/revenue/withdraw/confirm',creator.token,{requestId:withdrawal.id,txHash:withdrawTx}),ok('POST','/api/revenue/withdraw/confirm',creator.token,{requestId:withdrawal.id,txHash:withdrawTx})]);
  assert.equal((await ok('GET','/api/users/me/revenue',creator.token)).availableWei,'0');assert.equal(await db.revenueWithdrawal.count({where:{status:'COMPLETED'}}),1);
  // Restarted listener catches up missing blocks; receipt confirmation is idempotent.
  await blockchainIntegration.sync.poll();
  const count=await db.blockchainEvent.count({where:{processedAt:{not:null}}});assert.ok(count>=8);
  const sync2=new ChainSync(db,chain,blockchainIntegration.commerce);await sync2.poll();await sync2.process(boughtTx);assert.equal(await db.blockchainEvent.count({where:{processedAt:{not:null}}}),count);assert.equal(await db.revenueAllocation.count(),4);
  assert.ok(await db.blockchainCursor.count());
  // Node reset/address mismatch: use actual code replacement, restore immediately.
  const original=await chain.provider.getCode(manifest.LicenseNFT);
  try {await chain.provider.send('hardhat_setCode',[manifest.LicenseNFT,'0x60006000']);assert.equal((await chain.health()).connected,false);} finally {await chain.provider.send('hardhat_setCode',[manifest.LicenseNFT,original]);}
  const originalAnchor=chain.manifest.anchorHash;chain.manifest.anchorHash='0x'+'0'.repeat(64);assert.equal((await chain.health()).connected,false);chain.manifest.anchorHash=originalAnchor;
  assert.equal((await chain.health()).connected,true);
  const oldUrl=process.env.BLOCKCHAIN_RPC_URL;process.env.BLOCKCHAIN_RPC_URL='http://127.0.0.1:18545';const offline=new ChainClient();try{assert.equal((await offline.health()).connected,false);}finally{await offline.provider.destroy();process.env.BLOCKCHAIN_RPC_URL=oldUrl;}
  t.diagnostic(process.env.SERVICE_AUDIO ? 'Real AI HTTP analysis, Kubo content verification, Hardhat receipts/ERC1155 and MySQL validated.' : 'Real Hardhat RPC/receipts/ERC1155/splitter/MySQL validated; AI and IPFS are labeled TEST-ONLY fixtures.');
 } finally {
  if(server) await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
  await db.$disconnect();await chain.provider.destroy();sql(`DROP DATABASE \`${database}\`;`,false);await fs.rm(root,{recursive:true,force:true});
 }
});

