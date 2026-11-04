const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const {Prisma}=require('@prisma/client');
const {InvitationService}=require('../dist/services/invitation.service');
const {RightsController}=require('../dist/controllers/rights.controller');
const {createRightsRoutes}=require('../dist/routes/rights.routes');
const {config}=require('../dist/config');
const {publicHttpError}=require('../dist/utils/errors');
const address='0xd15572E7613141e1b67D6629ECdD1209a2fC8022';
const payload=percentage=>({walletAddress:address,role:'VOCAL',percentage});
function fixture(committed=0,reserved=0) {
  const track={id:10,ownerId:1,registrationStatus:'NOT_REGISTERED',contributionsFinalizedAt:null,
    contributions:committed?[{userId:1,role:'COMPOSER',percentage:new Prisma.Decimal(committed)}]:[]};
  const invitations=reserved?[{id:1,trackId:10,walletAddress:'0x0000000000000000000000000000000000000001',percentage:new Prisma.Decimal(reserved),status:'PENDING'}]:[];
  const tx={
    contributionInvitation:{
      findMany:async()=>invitations.filter(x=>x.status==='PENDING'),
      create:async({data})=>{const row={id:invitations.length+1,status:'PENDING',...data};invitations.push(row);return row;},
      findUnique:async({where})=>invitations.find(x=>x.id===where.id),
      findUniqueOrThrow:async({where})=>invitations.find(x=>x.id===where.id),
      update:async({where,data})=>Object.assign(invitations.find(x=>x.id===where.id),data),
    },
    user:{findUniqueOrThrow:async()=>({email:'voice@example.test',walletAddress:address.toLowerCase()})},
    contribution:{create:async({data})=>{track.contributions.push(data);return data;}},
  };
  const repo={db:tx,locked:async(_id,operation)=>operation(tx,track)};
  return {service:new InvitationService(repo),track,invitations};
}
test('VOCAL invitations accept numeric percentage boundaries',async()=>{
  for(const percentage of [20,10.5,0.01,100]) {
    const {service,invitations}=fixture();
    const result=await service.create(10,1,payload(percentage));
    assert.equal(result.percentage.toString(),String(percentage));
    assert.equal(result.walletAddress,address.toLowerCase());
    assert.equal(result.delivery,'IN_APP_PENDING');assert.equal(invitations.length,1);
  }
});
test('VOCAL invitations reject invalid percentages without creating an invitation',async()=>{
  for(const percentage of [0,-1,100.01,101,0.001,20.123,'20','0.01',NaN,Infinity,-Infinity,null,undefined]) {
    const {service,invitations}=fixture();
    await assert.rejects(service.create(10,1,payload(percentage)),{statusCode:400,message:'Invalid percentage'});
    assert.equal(invitations.length,0);
  }
});
test('invitation reservations, ownership, registration and finalization guards are preserved',async()=>{
  const exact=fixture(70,10);await exact.service.create(10,1,payload(20));
  const over=fixture(70,10);
  await assert.rejects(over.service.create(10,1,payload(20.01)),{statusCode:400,message:'Contribution total exceeds 100%'});
  const f=fixture();
  await assert.rejects(f.service.create(10,2,payload(20)),{statusCode:403});
  const invitation=await f.service.create(10,1,payload(20));
  await assert.rejects(f.service.create(10,1,payload(20)),{statusCode:409,message:'Invitation already pending'});
  const accepted=await f.service.respond(invitation.id,2,'ACCEPTED');
  assert.equal(accepted.status,'ACCEPTED');assert.equal(f.track.contributions[0].percentage.toString(),'20');
  await assert.rejects(f.service.respond(invitation.id,2,'ACCEPTED'),{statusCode:409});
  const full=fixture(90);full.invitations.push({id:1,trackId:10,walletAddress:address.toLowerCase(),role:'VOCAL',percentage:new Prisma.Decimal(20),status:'PENDING'});
  await assert.rejects(full.service.respond(1,2,'ACCEPTED'),{statusCode:409,message:'Contribution total exceeds 100%'});
  assert.equal(full.track.contributions.length,1);
  for(const state of ['finalized','REGISTERED','PENDING']) {
    const locked=fixture();
    if(state==='finalized')locked.track.contributionsFinalizedAt=new Date();else locked.track.registrationStatus=state;
    await assert.rejects(locked.service.create(10,1,payload(20)),{statusCode:409});
    assert.equal(locked.invitations.length,0);
  }
});
test('authenticated invitation HTTP API accepts the frontend VOCAL 20% payload',async t=>{
  const {service,invitations}=fixture(80);
  const saved=config.jwtSecret;config.jwtSecret='invitation-http-test-secret';t.after(()=>{config.jwtSecret=saved;});
  const app=express();app.use(express.json());
  app.use('/api',createRightsRoutes(new RightsController({invitations:service})));
  app.use((error,_req,res,_next)=>{const e=publicHttpError(error);res.status(e.statusCode).json({error:e.message});});
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const url=`http://127.0.0.1:${server.address().port}/api/tracks/10/invitations`;
  const token=jwt.sign({tokenType:'access'},config.jwtSecret,{subject:'1',expiresIn:'5m',algorithm:'HS256'});
  const send=(body,authenticated=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  assert.equal((await send(payload(20),false)).status,401);
  for(const value of [0,20.123,'20']) {const r=await send(payload(value));assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:'Invalid percentage'});}
  const response=await send(payload(20));assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.percentage,'20');assert.equal(result.role,'VOCAL');assert.equal(result.delivery,'IN_APP_PENDING');
  assert.equal(invitations.length,1);
});
