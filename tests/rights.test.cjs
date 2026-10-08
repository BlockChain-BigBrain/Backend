const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Prisma}=require('@prisma/client');
const {Wallet,TypedDataEncoder,verifyTypedData}=require('ethers');
const {body,money,currency,riskStatus,wallet}=require('../dist/dto/rights.dto');
const {validateAiResult,MockAiVerificationProvider,UnconfiguredAiVerificationProvider}=require('../dist/providers/ai.provider');
const {matchingPayment,UnconfiguredPaymentProvider,MockPaymentProvider}=require('../dist/providers/payment.provider');
const {allocateRevenue}=require('../dist/services/revenue.service');
const {creatorShares}=require('../dist/services/contribution.service');
const {metadataDocument,validCid}=require('../dist/services/metadata.service');
const {typedRegistration,registrationPrerequisites,blockchainOptions}=require('../dist/services/blockchain.service');
const {eligibleTrack}=require('../dist/services/marketplace.service');
function fixture() {
  const creator=Wallet.createRandom(), collaborator=Wallet.createRandom(), signer=Wallet.createRandom();
  const track={id:1,title:'Summer',audioHash:'a'.repeat(64),prompt:'Private secret',workLog:'Private journal',ownerId:1,isPublic:true,
    owner:{id:1,name:'Creator',walletAddress:creator.address},contributionsFinalizedAt:new Date(),
    contributions:[{id:1,userId:1,role:'COMPOSER',percentage:new Prisma.Decimal(40),user:{walletAddress:creator.address}}, {id:2,userId:1,role:'PROMPT',percentage:new Prisma.Decimal(20),user:{walletAddress:creator.address}}, {id:3,userId:2,role:'PRODUCER',percentage:new Prisma.Decimal(40),user:{walletAddress:collaborator.address}}],
    verifications:[{id:1,status:'VERIFIED',source:'MOCK',duplicate:false,riskScore:new Prisma.Decimal('0.72'),riskStatus:'PASS',modelVersion:'fixture-clap-v1'}],
    metadataCid:null,metadataSnapshots:[],registrationRequests:[],registrationStatus:'NOT_REGISTERED',registrationTxHash:null};
  const options={chainId:'31337',contractAddress:Wallet.createRandom().address,name:'TrackRegistry',version:'1',primaryType:'TrackVerification',fieldOrder:['audioHash','metadataCIDHash','registrant','contributorsHash','similarityScore','modelVersion','nonce','deadline'],signingKey:signer.privateKey,signerAddress:signer.address,ttlSeconds:900,confirmations:2};
  const request={id:1,nonce:'123',deadline:new Date(Date.now()+600000),chainId:'31337',status:'PENDING'};
  return {track,creator,collaborator,signer,options,request};
}
test('risk boundaries, deterministic mock source and malformed AI fixtures',async()=>{
  for(const [score,status] of [[0,'PASS'],[0.7999,'PASS'],[0.8,'WARN'],[0.8999,'WARN'],[0.9,'HOLD'],[1,'HOLD']]) assert.equal(riskStatus(score),status);
  for(const score of [-1,1.1,NaN,'0.8']) assert.throws(()=>riskStatus(score),{statusCode:400});
  const provider=new MockAiVerificationProvider();assert.equal(provider.source,'MOCK');
  const result=await provider.verify({});assert.deepEqual(result,await provider.verify({}));assert.doesNotThrow(()=>validateAiResult(result));
  for(const value of [{...result,status:'WARN'}, {...result,duplicate:'false'}, {...result,riskScore:0.79999}, {...result,similarTracks:[{trackId:2,score:1.1}]}, {...result,similarTracks:[{url:'file:///etc/passwd',score:0.2}]}, {...result,similarTracks:[{trackId:2,score:0.2},{trackId:2,score:0.3}]}]) assert.throws(()=>validateAiResult(value));
  await assert.rejects(new UnconfiguredAiVerificationProvider().verify({}),{statusCode:503});
});
test('money validation enforces per-currency units and revenue keeps every minor unit',()=>{
  for(const [value,unit] of [['1.01','KRW'],['1.001','USD'],['0','USD'],['-1','ETH'],['1e3','USD'],['0.0000000000000000001','ETH']]) assert.throws(()=>money(value,unit),{statusCode:400});
  assert.throws(()=>currency('UNKNOWN'),{statusCode:400});assert.throws(()=>body({source:'REAL'},[]),{statusCode:400});
  const shares=[{userId:1,percentage:'60'},{userId:2,percentage:'40'}];
  assert.deepEqual(allocateRevenue('100','USD',shares).map(row=>row.amount.toString()),['60','40']);
  assert.deepEqual(allocateRevenue('0.01','USD',[{userId:2,percentage:'50'},{userId:1,percentage:'50'}]).map(row=>row.amount.toString()),['0.01','0']);
  const amount='999999999999999999.123456789012345678';
  const rows=allocateRevenue(amount,'ETH',shares);
  assert.equal(rows[0].amount.plus(rows[1].amount).toFixed(18),amount);
  assert.deepEqual(allocateRevenue('100','KRW',[{userId:1,percentage:'30'},{userId:1,percentage:'30'},{userId:2,percentage:'40'}]).map(row=>row.amount.toString()),['60','40']);
  assert.throws(()=>allocateRevenue('100','USD',[{userId:1,percentage:'99'}]),{statusCode:409});
});
test('creator shares aggregate roles, require exact totals and never invent wallets',()=>{
  const {track}=fixture();assert.deepEqual(creatorShares(track).map(item=>item.percentage),['60.00','40.00']);
  track.contributions[0].user.walletAddress=null;assert.throws(()=>creatorShares(track),{statusCode:409});
  track.contributions[0].user.walletAddress=Wallet.createRandom().address;track.contributions[0].percentage=new Prisma.Decimal(39.99);assert.throws(()=>creatorShares(track),{statusCode:409});
  assert.throws(()=>wallet('0xnot-a-wallet'),{statusCode:409});
});
test('metadata excludes private fields by default and requires explicit disclosure consent',()=>{
  const {track}=fixture();const document=metadataDocument(track);
  assert.equal('prompt' in document,false);assert.equal('workLog' in document,false);assert.equal('userId' in document.contributors[0],false);assert.equal(document.verification.source,'MOCK');
  assert.throws(()=>metadataDocument(track,{publishPrompt:true}),{statusCode:400});
  assert.equal(metadataDocument(track,{publishPrompt:true,acceptPublicDisclosure:true}).prompt,'Private secret');
  track.contributionsFinalizedAt=null;assert.throws(()=>metadataDocument(track),{statusCode:409});
  assert.equal(validCid('fake-cid'),false);assert.equal(validCid('b'+'a'.repeat(58)),false);
  assert.equal(validCid('bafkreigh2akiscaildc6o6p2nhccz3u5c6afgzkgkbb37faqxnxm6woj5m'),true);
});
test('EIP-712 readiness blocks mock/missing CIDs; typed data can be signed and verified',async()=>{
  const {track,options,request,signer}=fixture();assert.ok(registrationPrerequisites(track,options).includes('realMetadataCid'));assert.ok(registrationPrerequisites(track,options).includes('realEligibleAiVerification'));
  assert.equal(typedRegistration(track,request,options).typedData,null);
  track.verifications[0].source='AI';track.metadataCid='bafkreigh2akiscaildc6o6p2nhccz3u5c6afgzkgkbb37faqxnxm6woj5m';
  const document=metadataDocument(track);
  track.metadataSnapshots=[{id:1,status:'UPLOADED',metadataCid:track.metadataCid,document,hash:require('node:crypto').createHash('sha256').update(JSON.stringify(document)).digest('hex')}];
  const payload=typedRegistration(track,request,options);assert.equal(payload.ready,true);
  assert.equal(payload.typedData.value.similarityScore,'7200');
  const signature=await signer.signTypedData(payload.typedData.domain,payload.typedData.types,payload.typedData.value);
  assert.equal(verifyTypedData(payload.typedData.domain,payload.typedData.types,payload.typedData.value,signature),signer.address);
  const digest=TypedDataEncoder.hash(payload.typedData.domain,payload.typedData.types,payload.typedData.value);
  assert.notEqual(digest,TypedDataEncoder.hash(payload.typedData.domain,payload.typedData.types,{...payload.typedData.value,nonce:'124'}));
  const alternativeOptions={...options,fieldOrder:[...options.fieldOrder].reverse(),fieldTypes:{...Object.fromEntries(payload.typedData.types[options.primaryType].map(item=>[item.name,item.type])),modelVersion:'bytes32',similarityScore:'uint32',deadline:'uint64'},hashingRules:{metadataEncoding:'CID_BYTES',contributorsEncoding:'ABI_TUPLES',similarityScale:100000,percentageScale:10000}};
  const alternative=typedRegistration(track,request,alternativeOptions);assert.equal(alternative.ready,true);assert.equal(alternative.typedData.value.similarityScore,'72000');
  assert.notEqual(alternative.typedData.value.metadataCIDHash,payload.typedData.value.metadataCIDHash);assert.notEqual(alternative.typedData.value.contributorsHash,payload.typedData.value.contributorsHash);
  const alternativeSignature=await signer.signTypedData(alternative.typedData.domain,alternative.typedData.types,alternative.typedData.value);
  assert.equal(verifyTypedData(alternative.typedData.domain,alternative.typedData.types,alternative.typedData.value,alternativeSignature),signer.address);
  request.deadline=new Date(0);assert.throws(()=>typedRegistration(track,request,options),{statusCode:409});
});
test('marketplace never treats mock verification or HOLD/duplicate as actual sale eligible',()=>{
  const {track}=fixture();assert.doesNotThrow(()=>eligibleTrack(track,false));assert.throws(()=>eligibleTrack(track,true),{statusCode:409});
  track.verifications[0].duplicate=true;assert.throws(()=>eligibleTrack(track,false),{statusCode:409});
  track.verifications[0].duplicate=false;track.verifications[0].riskScore=new Prisma.Decimal(0.9);track.verifications[0].riskStatus='HOLD';assert.throws(()=>eligibleTrack(track,false),{statusCode:409});
});
test('payment proof must match price and identity; mock proofs contain no txHash or tokenId',async()=>{
  const expected={requestId:1,buyerId:2,trackId:1,licenseType:'COMMERCIAL',amount:'100',currency:'USD',preparation:true};
  const mock=await new MockPaymentProvider().verifyPayment(expected);assert.doesNotThrow(()=>matchingPayment(expected,mock));
  for(const result of [{...mock,amount:'99'},{...mock,buyerId:3},{...mock,txHash:'0x'+'a'.repeat(64)},{...mock,tokenId:'1'},{...mock,paymentReference:'actual'},{...mock,source:'REAL',txHash:'0x'+'a'.repeat(64),tokenId:'1'}]) assert.throws(()=>matchingPayment(expected,result));
  await assert.rejects(new UnconfiguredPaymentProvider().verifyPayment(expected),{statusCode:503});
});
test('blockchain configuration detects private-key/signer mismatch and invalid field order',()=>{
  const saved={...process.env};
  try {
    process.env.VERIFICATION_SIGNER_PRIVATE_KEY=Wallet.createRandom().privateKey;process.env.VERIFICATION_SIGNER_ADDRESS=Wallet.createRandom().address;
    assert.throws(()=>blockchainOptions(),/does not match/);
    delete process.env.VERIFICATION_SIGNER_PRIVATE_KEY;delete process.env.VERIFICATION_SIGNER_ADDRESS;
    process.env.EIP712_FIELD_ORDER='nonce,nonce';assert.throws(()=>blockchainOptions(),/FIELD_ORDER/);
  } finally { for(const key of Object.keys(process.env)) if(!(key in saved)) delete process.env[key];Object.assign(process.env,saved); }
});

test('common errors hide DB details while retaining explicit provider configuration failures',()=>{
  const {publicHttpError,AppError}=require('../dist/utils/errors');
  const conflict=new Prisma.PrismaClientKnownRequestError('secret database values',{code:'P2002',clientVersion:'test'});
  assert.deepEqual(publicHttpError(conflict),{statusCode:409,message:'Database conflict or concurrent update'});
  assert.deepEqual(publicHttpError(new Error('secret private path')),{statusCode:500,message:'Internal server error'});
  assert.deepEqual(publicHttpError(new AppError(503,'Payment provider is not configured')),{statusCode:503,message:'Payment provider is not configured'});
});
test('every rights API is documented, including pending purchase status and external boundaries',()=>{
  const {swaggerSpec}=require('../dist/docs/swagger');
  for(const [route,method] of [['/api/tracks/{id}/contributors/finalize','post'],['/api/tracks/{id}/reverify','post'],['/api/tracks/{id}/metadata/prepare','post'],['/api/tracks/{id}/register','post'],['/api/market/tracks','get'],['/api/licenses/purchase','post'],['/api/licenses/{id}/status','get'],['/api/users/me/revenue','get'],['/api/revenue/withdraw','post']]) assert.ok(swaggerSpec.paths[route][method]);
  assert.ok(swaggerSpec.paths['/api/tracks/{id}/verify'].post.responses['202']);
  assert.ok(swaggerSpec.components.schemas.PurchaseRequest.properties.status.enum.includes('SIMULATED'));
  for(const methods of Object.values(swaggerSpec.paths)) for(const operation of Object.values(methods)) for(const parameter of operation.parameters ?? []) if(parameter.in==='path') assert.equal(parameter.required,true);
});

test('AI timeout aborts the provider and never turns a stalled analysis into a success',async()=>{
  const {verificationWithTimeout}=require('../dist/services/verification.service');
  let signal;
  const provider={source:'MOCK',verify:async(_request,provided)=>{signal=provided;return new Promise(()=>{});}};
  await assert.rejects(verificationWithTimeout(provider,{trackId:1,audioHash:'a'.repeat(64),audioPath:'/uploads/fixture'},20),{statusCode:503});
  assert.equal(signal.aborted,true);
});
